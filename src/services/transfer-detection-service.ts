import Big from 'big.js';
import { getDb, withTransaction, type DbExecutor } from '../db/database';
import { dec, qCent, tryConvert } from '../domain/money';
import { getLatestCachedRates } from './exchange-rate-service';
import {
  requireActiveKoinkatAccountId,
  captureWorkspace,
} from '../lib/active-koinkat-account';

/*
 * Transfers between the user's own accounts.
 *
 * A bank transfer from account A to account B arrives as TWO imported rows:
 * an expense on A and an income on B. Left alone they count as spending and
 * as earnings. Confirming them as a transfer gives both rows the same
 * `transfer_pair_id`, and every income/expense aggregation skips rows that
 * carry one. Balances are never touched: the two rows already moved them.
 *
 * A pair can also have ONE member ("the other side isn't in Koinkat"): the
 * row gets its own `transfer_pair_id` and drops out of the totals the same
 * way.
 *
 * Detection only SUGGESTS. The user confirms every pair.
 */

/* ── Tunable detection parameters ─────────────────────────────────── */

/** Maximum date gap (days) between an outflow and a matching inflow. */
const MAX_DAY_GAP = 7;

/**
 * Maximum asymmetry between the two sides. 5% absorbs embedded fees and the
 * FX spread of cross-currency transfers (Wise, Revolut) against the cached
 * mid-market rate.
 */
const MAX_AMOUNT_DELTA_RATIO = 0.05;

/**
 * Looser limits for a pair the bank itself links: the outflow's counterparty
 * IBAN IS the inflow's account (or the other way round). International
 * transfers can take more than a week and carry larger fees.
 */
const CERTAIN_MAX_DAY_GAP = 10;
const CERTAIN_MAX_AMOUNT_DELTA_RATIO = 0.1;

/** Minimum score (0-1) for an uncertain candidate to be surfaced. */
const MIN_MATCH_SCORE = 0.6;

/** How far either side of a row the manual picker looks for its partner. */
const COUNTERPART_WINDOW_DAYS = 14;
const COUNTERPART_LIMIT = 10;

/* ── Types ────────────────────────────────────────────────────────── */

interface DetectionRow {
  id: string;
  account_id: string;
  type: string;
  amount_in_account_ccy: string;
  date: string;
  note: string | null;
  counterparty_iban: string | null;
  account_name: string;
  account_currency: string;
  account_color: string;
  account_iban: string | null;
}

interface Side {
  row: DetectionRow;
  /** Absolute amount in the account's currency. */
  amount: Big;
  /** Days since the epoch, for cheap gap arithmetic. */
  day: number;
  counterpartyIban: string | null;
  accountIban: string | null;
}

export interface TransferSide {
  id: string;
  accountId: string;
  accountName: string;
  accountColor: string;
  amount: string;
  currency: string;
  date: string;
  note: string | null;
}

export interface TransferCandidate {
  outflow: TransferSide;
  inflow: TransferSide;
  /** Score 0-1, higher = more confident this is a transfer. */
  score: number;
  /**
   * True when the bank links the two rows: one side's counterparty IBAN is
   * the other side's own account. Not a guess from amount and date.
   */
  certain: boolean;
  /** Absolute day gap between outflow and inflow dates. */
  dayGap: number;
  /**
   * How much MORE left the source than arrived, in `feeCurrency`. Positive
   * means a fee, zero a clean transfer, negative that the destination got
   * slightly more (FX spread).
   */
  fee: string;
  /** Account currency for a same-currency pair, else the preferred one. */
  feeCurrency: string;
  /** True when the outflow and inflow are in different currencies. */
  isCrossCurrency: boolean;
}

/** A possible partner for one row, for the manual "Transfer..." picker. */
export interface TransferCounterpart extends TransferSide {
  type: 'income' | 'expense';
  dayGap: number;
  certain: boolean;
}

/* ── Shared helpers ───────────────────────────────────────────────── */

function normalizeIban(iban: string | null | undefined): string | null {
  if (!iban) return null;
  const n = iban.replace(/\s+/g, '').toUpperCase();
  return n.length > 0 ? n : null;
}

function dayNumber(date: string): number {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

function toSide(row: DetectionRow): Side {
  return {
    row,
    amount: dec(row.amount_in_account_ccy).abs(),
    day: dayNumber(row.date),
    counterpartyIban: normalizeIban(row.counterparty_iban),
    accountIban: normalizeIban(row.account_iban),
  };
}

function publicSide(s: Side): TransferSide {
  return {
    id: s.row.id,
    accountId: s.row.account_id,
    accountName: s.row.account_name,
    accountColor: s.row.account_color,
    amount: s.amount.toFixed(2),
    currency: s.row.account_currency,
    date: s.row.date,
    note: s.row.note,
  };
}

/** The bank says one side's money went to (or came from) the other side. */
function isCertain(out: Side, inn: Side): boolean {
  return (
    (out.counterpartyIban !== null && out.counterpartyIban === inn.accountIban) ||
    (inn.counterpartyIban !== null && inn.counterpartyIban === out.accountIban)
  );
}

/**
 * The bank says the money went somewhere ELSE: a side's counterparty IBAN is
 * known, the other account's IBAN is known, and they differ.
 */
function isContradicted(out: Side, inn: Side): boolean {
  return (
    (out.counterpartyIban !== null &&
      inn.accountIban !== null &&
      out.counterpartyIban !== inn.accountIban) ||
    (inn.counterpartyIban !== null &&
      out.accountIban !== null &&
      inn.counterpartyIban !== out.accountIban)
  );
}

/**
 * Compare the two amounts. Same currency: directly, no rates involved, so a
 * missing rate never hides a pair. Cross-currency: both converted to the
 * preferred currency; null when a rate is missing.
 */
function compareAmounts(
  out: Side,
  inn: Side,
  preferredCurrency: string,
  rates: Record<string, string> | null,
): { ratio: number; fee: Big; feeCurrency: string; crossCurrency: boolean } | null {
  const outCcy = out.row.account_currency;
  const inCcy = inn.row.account_currency;
  if (outCcy.toLowerCase() === inCcy.toLowerCase()) {
    if (out.amount.lte('0')) return null;
    const delta = out.amount.minus(inn.amount);
    return {
      ratio: delta.div(out.amount).toNumber(),
      fee: delta,
      feeCurrency: outCcy,
      crossCurrency: false,
    };
  }
  const outPref = tryConvert(out.amount, outCcy, preferredCurrency, rates);
  const inPref = tryConvert(inn.amount, inCcy, preferredCurrency, rates);
  if (outPref === null || inPref === null || outPref.lte('0')) return null;
  const delta = qCent(outPref).minus(qCent(inPref));
  return {
    ratio: delta.div(qCent(outPref)).toNumber(),
    fee: delta,
    feeCurrency: preferredCurrency,
    crossCurrency: true,
  };
}

function scorePair(
  out: Side,
  inn: Side,
  preferredCurrency: string,
  rates: Record<string, string> | null,
): TransferCandidate | null {
  const certain = isCertain(out, inn);
  if (!certain && isContradicted(out, inn)) return null;

  const dayGap = Math.abs(inn.day - out.day);
  const maxGap = certain ? CERTAIN_MAX_DAY_GAP : MAX_DAY_GAP;
  if (dayGap > maxGap) return null;

  const cmp = compareAmounts(out, inn, preferredCurrency, rates);
  if (cmp === null) return null;
  const maxRatio = certain ? CERTAIN_MAX_AMOUNT_DELTA_RATIO : MAX_AMOUNT_DELTA_RATIO;
  if (Math.abs(cmp.ratio) > maxRatio) return null;

  // Amount match weighted heavier than date proximity; both normalised to
  // 0-1. Certain pairs are ranked ahead of uncertain ones by the caller,
  // and among themselves by this same score: two transfers to the same
  // account a few days apart must each find their closest amount.
  const amountScore = 1 - Math.abs(cmp.ratio) / maxRatio;
  const dateScore = 1 - dayGap / maxGap;
  const base = amountScore * 0.7 + dateScore * 0.3;
  if (!certain && base < MIN_MATCH_SCORE) return null;

  return {
    outflow: publicSide(out),
    inflow: publicSide(inn),
    score: base,
    certain,
    dayGap,
    fee: qCent(cmp.fee).toFixed(2),
    feeCurrency: cmp.feeCurrency,
    isCrossCurrency: cmp.crossCurrency,
  };
}

/**
 * Rows that can take part in a transfer: booked income/expense, not already
 * in a transfer, not a split parent or a split/fee child.
 */
const ELIGIBLE = `t.type IN ('income', 'expense')
        AND t.transfer_pair_id IS NULL
        AND t.relation_kind IS NULL
        AND t.split_status IS NULL
        AND t.status = 'booked'`;

const DETECTION_SELECT = `SELECT t.id, t.account_id, t.type, t.amount_in_account_ccy, t.date,
            t.note, t.counterparty_iban,
            a.name AS account_name, a.currency AS account_currency,
            a.color AS account_color,
            (SELECT la.iban FROM linked_accounts la
              WHERE la.account_id = t.account_id
                AND la.koinkat_account_id = t.koinkat_account_id
                AND la.iban IS NOT NULL
              LIMIT 1) AS account_iban
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id`;

async function loadRates(): Promise<Record<string, string> | null> {
  try {
    return await getLatestCachedRates();
  } catch {
    // Only cross-currency pairs need rates; same-currency ones still match.
    return null;
  }
}

/* ── Detection ────────────────────────────────────────────────────── */

/**
 * Suggest transfer pairs in the active workspace, across its whole history.
 *
 * An outflow on one account is paired with an inflow on ANOTHER account of
 * a similar amount a few days apart. When the bank reports the other side's
 * IBAN and it is one of the user's linked accounts, the pair is `certain`.
 * When the bank reports a DIFFERENT IBAN, the pair is rejected.
 *
 * Skips pairs the user dismissed. Rows dismissed by the pre-v15 per-row
 * behaviour (`transfer_reviewed_at` set, never paired) are suggested again:
 * that behaviour hid a row's real partner along with the wrong one, which
 * is how transfers went undetected, so one more "Not a transfer" (now
 * per pair) is the better trade.
 *
 * Returns mutually exclusive pairs (each row in at most one), certain pairs
 * first, then by score.
 */
export async function findCandidateTransfers(
  preferredCurrency: string,
): Promise<TransferCandidate[]> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();

  const rows = await db.select<DetectionRow[]>(
    `${DETECTION_SELECT}
      WHERE t.koinkat_account_id = ?
        AND ${ELIGIBLE}
      ORDER BY t.date ASC`,
    [koinkatAccountId],
  );
  if (rows.length < 2) return [];

  const outflows: Side[] = [];
  const inflows: Side[] = [];
  for (const r of rows) {
    if (r.type === 'expense') outflows.push(toSide(r));
    else if (r.type === 'income') inflows.push(toSide(r));
  }
  if (outflows.length === 0 || inflows.length === 0) return [];
  inflows.sort((a, b) => a.day - b.day);

  const dismissed = new Set(
    (
      await db.select<{ outflow_id: string; inflow_id: string }[]>(
        'SELECT outflow_id, inflow_id FROM transfer_pair_dismissals WHERE koinkat_account_id = ?',
        [koinkatAccountId],
      )
    ).map((d) => `${d.outflow_id}|${d.inflow_id}`),
  );

  const rates = await loadRates();

  // Sliding window: for each outflow only the inflows within the widest
  // allowed gap are scored, so the whole history stays cheap to scan.
  const scored: TransferCandidate[] = [];
  for (const out of outflows) {
    let lo = 0;
    let hi = inflows.length;
    const from = out.day - CERTAIN_MAX_DAY_GAP;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (inflows[mid].day < from) lo = mid + 1;
      else hi = mid;
    }
    for (let j = lo; j < inflows.length; j++) {
      const inn = inflows[j];
      if (inn.day > out.day + CERTAIN_MAX_DAY_GAP) break;
      if (inn.row.account_id === out.row.account_id) continue;
      if (dismissed.has(`${out.row.id}|${inn.row.id}`)) continue;
      const candidate = scorePair(out, inn, preferredCurrency, rates);
      if (candidate) scored.push(candidate);
    }
  }

  scored.sort((a, b) => {
    if (a.certain !== b.certain) return a.certain ? -1 : 1;
    if (b.score !== a.score) return b.score - a.score;
    return a.dayGap - b.dayGap;
  });
  const used = new Set<string>();
  const selected: TransferCandidate[] = [];
  for (const cand of scored) {
    if (used.has(cand.outflow.id) || used.has(cand.inflow.id)) continue;
    selected.push(cand);
    used.add(cand.outflow.id);
    used.add(cand.inflow.id);
  }
  return selected;
}

/** Number of suggested transfer pairs, for the Review badge. */
export async function getTransferSuggestionCount(
  preferredCurrency: string,
): Promise<number> {
  return (await findCandidateTransfers(preferredCurrency)).length;
}

/**
 * Possible partners for one row, for choosing a transfer's other side by
 * hand: rows of the opposite type on OTHER accounts, within two weeks,
 * closest amount first. Dismissals are ignored - the user is choosing
 * explicitly.
 */
export async function findCounterpartsFor(
  transactionId: string,
  preferredCurrency: string,
): Promise<TransferCounterpart[]> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();

  const targetRows = await db.select<DetectionRow[]>(
    `${DETECTION_SELECT}
      WHERE t.koinkat_account_id = ? AND t.id = ? AND ${ELIGIBLE}`,
    [koinkatAccountId, transactionId],
  );
  if (targetRows.length === 0) return [];
  const target = toSide(targetRows[0]);
  const wantType = target.row.type === 'expense' ? 'income' : 'expense';

  const [y, m, d] = target.row.date.slice(0, 10).split('-').map(Number);
  const shift = (days: number) =>
    new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);

  const rows = await db.select<DetectionRow[]>(
    `${DETECTION_SELECT}
      WHERE t.koinkat_account_id = ?
        AND ${ELIGIBLE}
        AND t.type = ?
        AND t.account_id != ?
        AND t.date >= ? AND t.date <= ?`,
    [
      koinkatAccountId,
      wantType,
      target.row.account_id,
      shift(-COUNTERPART_WINDOW_DAYS),
      shift(COUNTERPART_WINDOW_DAYS),
    ],
  );

  const rates = await loadRates();
  const ranked = rows.map((r) => {
    const other = toSide(r);
    const [out, inn] = target.row.type === 'expense' ? [target, other] : [other, target];
    const cmp = compareAmounts(out, inn, preferredCurrency, rates);
    const ratio = cmp === null ? Number.POSITIVE_INFINITY : Math.abs(cmp.ratio);
    const dayGap = Math.abs(other.day - target.day);
    return {
      side: other,
      // The IBAN names the ACCOUNT, not the row: only the row that also
      // matches in amount and date is the bank-confirmed partner.
      certain:
        isCertain(out, inn) &&
        ratio <= CERTAIN_MAX_AMOUNT_DELTA_RATIO &&
        dayGap <= CERTAIN_MAX_DAY_GAP,
      ratio,
      dayGap,
    };
  });
  ranked.sort((a, b) => {
    if (a.certain !== b.certain) return a.certain ? -1 : 1;
    if (a.ratio !== b.ratio) return a.ratio - b.ratio;
    return a.dayGap - b.dayGap;
  });

  return ranked.slice(0, COUNTERPART_LIMIT).map((c) => ({
    ...publicSide(c.side),
    type: c.side.row.type as 'income' | 'expense',
    dayGap: c.dayGap,
    certain: c.certain,
  }));
}

/* ── Confirm / Dismiss / Undo ─────────────────────────────────────── */

/**
 * What confirming a transfer writes on each member row. A transfer has no
 * category (like a native transfer) and nothing left to review, so the row
 * leaves the Review queue at the same time as it leaves the totals.
 */
const CONFIRM_SET = `transfer_pair_id = ?,
            transfer_reviewed_at = ?,
            needs_review = 0,
            category_id = NULL,
            categorization_source = NULL,
            applied_rule_id = NULL,
            updated_at = datetime('now')`;

async function requireEligible(
  tx: DbExecutor,
  workspaceId: string,
  ids: string[],
): Promise<{ id: string; type: string; account_id: string }[]> {
  const placeholders = ids.map(() => '?').join(', ');
  const rows = await tx.select<{ id: string; type: string; account_id: string }[]>(
    `SELECT t.id, t.type, t.account_id FROM transactions t
      WHERE t.koinkat_account_id = ? AND t.id IN (${placeholders}) AND ${ELIGIBLE}`,
    [workspaceId, ...ids],
  );
  if (rows.length !== ids.length) {
    throw new Error(
      'This transaction can no longer be marked as a transfer. It may already be part of one, or it may have changed.',
    );
  }
  return rows;
}

/**
 * Confirm two rows as one transfer: an expense on one account and an income
 * on another. Both get the same fresh `transfer_pair_id` and leave the
 * totals and the Review queue. Balances are NOT touched - the original
 * income and expense rows already moved them correctly.
 *
 * Returns the pair id so the UI can offer Undo via `unpairTransfer`.
 */
export async function confirmTransferPair(
  outflowId: string,
  inflowId: string,
): Promise<string> {
  const ws = captureWorkspace();
  const pairId = crypto.randomUUID();
  const now = new Date().toISOString();
  await withTransaction(async (tx) => {
    const rows = await requireEligible(tx, ws.id, [outflowId, inflowId]);
    const out = rows.find((r) => r.id === outflowId)!;
    const inn = rows.find((r) => r.id === inflowId)!;
    if (out.type !== 'expense' || inn.type !== 'income') {
      throw new Error('A transfer pairs money going out of one account with money coming into another.');
    }
    if (out.account_id === inn.account_id) {
      throw new Error('Both sides of a transfer are on the same account.');
    }
    ws.assertUnchanged();
    await tx.execute(
      `UPDATE transactions SET ${CONFIRM_SET}
        WHERE id IN (?, ?) AND koinkat_account_id = ?`,
      [pairId, now, outflowId, inflowId, ws.id],
    );
  });
  return pairId;
}

/**
 * Mark ONE row as a transfer whose other side is not in Koinkat (an account
 * the user doesn't track). The row gets its own `transfer_pair_id`, which
 * every aggregation already excludes.
 */
export async function markAsTransferAlone(transactionId: string): Promise<string> {
  const ws = captureWorkspace();
  const pairId = crypto.randomUUID();
  const now = new Date().toISOString();
  await withTransaction(async (tx) => {
    await requireEligible(tx, ws.id, [transactionId]);
    ws.assertUnchanged();
    await tx.execute(
      `UPDATE transactions SET ${CONFIRM_SET}
        WHERE id = ? AND koinkat_account_id = ?`,
      [pairId, now, transactionId, ws.id],
    );
  });
  return pairId;
}

/**
 * "These two are not a transfer." Remembers the PAIR only, so each row can
 * still be suggested with its real partner.
 */
export async function dismissTransferPair(
  outflowId: string,
  inflowId: string,
): Promise<void> {
  const ws = captureWorkspace();
  const db = await getDb();
  ws.assertUnchanged();
  await db.execute(
    `INSERT OR IGNORE INTO transfer_pair_dismissals
       (koinkat_account_id, outflow_id, inflow_id)
     VALUES (?, ?, ?)`,
    [ws.id, outflowId, inflowId],
  );
}

/**
 * Undo a transfer: its rows count as income / expense again and go back to
 * the Review queue for a category. A two-row pair is also remembered as
 * dismissed, so the detector doesn't suggest the same pair straight back.
 */
export async function unpairTransfer(transferPairId: string): Promise<void> {
  const ws = captureWorkspace();
  await withTransaction(async (tx) => {
    const members = await tx.select<{ id: string; type: string }[]>(
      'SELECT id, type FROM transactions WHERE transfer_pair_id = ? AND koinkat_account_id = ?',
      [transferPairId, ws.id],
    );
    ws.assertUnchanged();
    const out = members.find((m) => m.type === 'expense');
    const inn = members.find((m) => m.type === 'income');
    if (members.length === 2 && out && inn) {
      await tx.execute(
        `INSERT OR IGNORE INTO transfer_pair_dismissals
           (koinkat_account_id, outflow_id, inflow_id)
         VALUES (?, ?, ?)`,
        [ws.id, out.id, inn.id],
      );
    }
    await tx.execute(
      `UPDATE transactions
          SET transfer_pair_id = NULL,
              transfer_reviewed_at = NULL,
              needs_review = 1,
              updated_at = datetime('now')
        WHERE transfer_pair_id = ? AND koinkat_account_id = ?`,
      [transferPairId, ws.id],
    );
  });
}

/**
 * The other member(s) of a transfer, for showing "paired with ..." on a
 * transaction. Empty for a one-row transfer.
 */
export async function getTransferPartners(
  transferPairId: string,
  excludeTransactionId: string,
): Promise<TransferSide[]> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const rows = await db.select<DetectionRow[]>(
    `${DETECTION_SELECT}
      WHERE t.koinkat_account_id = ? AND t.transfer_pair_id = ? AND t.id != ?`,
    [koinkatAccountId, transferPairId, excludeTransactionId],
  );
  return rows.map((r) => publicSide(toSide(r)));
}
