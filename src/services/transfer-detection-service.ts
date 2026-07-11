import Big from 'big.js';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import { getDb } from '../db/database';
import { dec, qCent, tryConvert } from '../domain/money';
import { getLatestCachedRates } from './exchange-rate-service';
import { requireActiveKoinkatAccountId } from '../lib/active-koinkat-account';

/* ── Tunable detection parameters ─────────────────────────────────── */

/** Maximum date gap (days, absolute) between an outflow and a matching inflow. */
const MAX_DAY_GAP = 7;

/**
 * Maximum allowed asymmetry between source and destination (after FX
 * conversion). 5% covers embedded fees AND FX-spread for cross-currency
 * transfers via Wise/Revolut whose effective rate is a few cents off
 * the cached mid-market rate.
 */
const MAX_AMOUNT_DELTA_RATIO = 0.05;

/** Minimum score (0–1) for a candidate to be surfaced to the user. */
const MIN_MATCH_SCORE = 0.6;

/**
 * Only consider transactions imported in the last N days. Older
 * unreviewed rows are very unlikely to be transfers and are excluded
 * to keep the O(outflows × inflows) matching loop bounded.
 */
const DETECTION_WINDOW_DAYS = 90;

/* ── Types ────────────────────────────────────────────────────────── */

interface CandidateRow {
  id: string;
  account_id: string;
  account_name: string;
  account_currency: string;
  account_color: string;
  type: 'income' | 'expense';
  amount: string;                 // amount_in_account_ccy
  currency: string;               // account_currency (denormalised)
  date: string;
  note: string | null;
  preferred_amount: string | null; // converted to preferred ccy, or null if rates missing
}

export interface TransferCandidate {
  outflow: {
    id: string;
    accountId: string;
    accountName: string;
    accountColor: string;
    amount: string;
    currency: string;
    date: string;
    note: string | null;
  };
  inflow: {
    id: string;
    accountId: string;
    accountName: string;
    accountColor: string;
    amount: string;
    currency: string;
    date: string;
    note: string | null;
  };
  /** Score 0–1, higher = more confident this is a transfer. */
  score: number;
  /** Absolute day gap between outflow and inflow dates. */
  dayGap: number;
  /**
   * Estimated fee in the workspace's preferred currency: how much MORE
   * left the source than arrived at the destination. Positive means
   * there's a fee, zero means a clean transfer, negative means the
   * destination got slightly more (FX spread).
   */
  feeInPreferred: string;
  /** True when the outflow and inflow are in different currencies. */
  isCrossCurrency: boolean;
}

/* ── Detection ────────────────────────────────────────────────────── */

/**
 * Find candidate transfer pairs in the active workspace.
 *
 * Only considers rows where:
 *   - type IN ('income', 'expense')   - already-confirmed transfers excluded
 *   - transfer_pair_id IS NULL        - not already paired
 *   - transfer_reviewed_at IS NULL    - user hasn't already dismissed
 *   - date >= now - DETECTION_WINDOW_DAYS
 *
 * Returns a list of mutually-exclusive pairs (each transaction can be
 * in at most one pair), sorted by score descending.
 */
export async function findCandidateTransfers(
  preferredCurrency: string,
): Promise<TransferCandidate[]> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();

  const minDate = new Date();
  minDate.setDate(minDate.getDate() - DETECTION_WINDOW_DAYS);
  const minDateStr = minDate.toISOString().slice(0, 10);

  const rows = await db.select<
    {
      id: string;
      account_id: string;
      type: string;
      amount_in_account_ccy: string;
      date: string;
      note: string | null;
      account_name: string;
      account_currency: string;
      account_color: string;
    }[]
  >(
    `SELECT t.id, t.account_id, t.type, t.amount_in_account_ccy, t.date,
            t.note, a.name AS account_name, a.currency AS account_currency,
            a.color AS account_color
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
      WHERE t.koinkat_account_id = ?
        AND t.type IN ('income', 'expense')
        AND t.transfer_pair_id IS NULL
        AND t.transfer_reviewed_at IS NULL
        AND t.relation_kind IS NULL
        AND t.status = 'booked'
        AND t.date >= ?
      ORDER BY t.date ASC`,
    [koinkatAccountId, minDateStr],
  );

  if (rows.length < 2) return [];

  // Convert each row to a candidate enriched with its preferred-currency
  // amount. Rows we can't convert are dropped - we can't reliably
  // compare their amounts to anything else.
  const rates = await getLatestCachedRates();
  const candidates: CandidateRow[] = [];
  for (const r of rows) {
    if (r.type !== 'income' && r.type !== 'expense') continue;
    const amtBig = dec(r.amount_in_account_ccy).abs();
    const inPref = tryConvert(amtBig, r.account_currency, preferredCurrency, rates);
    candidates.push({
      id: r.id,
      account_id: r.account_id,
      account_name: r.account_name,
      account_currency: r.account_currency,
      account_color: r.account_color,
      type: r.type as 'income' | 'expense',
      amount: amtBig.toFixed(2),
      currency: r.account_currency,
      date: r.date,
      note: r.note,
      preferred_amount: inPref ? qCent(inPref).toFixed(2) : null,
    });
  }

  const outflows = candidates.filter((c) => c.type === 'expense');
  const inflows = candidates.filter((c) => c.type === 'income');
  if (outflows.length === 0 || inflows.length === 0) return [];

  // Score every (outflow, inflow) pair. O(n × m) - bounded by the
  // 90-day window and the user's transaction velocity.
  const scored: TransferCandidate[] = [];
  for (const out of outflows) {
    for (const inn of inflows) {
      if (out.account_id === inn.account_id) continue;
      const candidate = scorePair(out, inn);
      if (candidate) scored.push(candidate);
    }
  }

  // Sort by score desc, then greedily pick non-overlapping pairs so
  // each transaction appears in at most one suggestion.
  scored.sort((a, b) => b.score - a.score);
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

function scorePair(out: CandidateRow, inn: CandidateRow): TransferCandidate | null {
  // Date proximity check
  const outDate = parseISO(out.date);
  const innDate = parseISO(inn.date);
  const dayGap = Math.abs(differenceInCalendarDays(innDate, outDate));
  if (dayGap > MAX_DAY_GAP) return null;

  // Amount comparison happens in the workspace's preferred currency.
  // If either side doesn't have a preferred-currency amount (rates
  // missing for that currency), we can't compare and skip the pair.
  if (out.preferred_amount === null || inn.preferred_amount === null) return null;
  const outPref = dec(out.preferred_amount);
  const innPref = dec(inn.preferred_amount);
  if (outPref.lte(new Big('0'))) return null;

  // Compute the asymmetry. `delta` is positive when the outflow
  // exceeds the inflow (a fee on the source side, or FX spread).
  // We allow up to MAX_AMOUNT_DELTA_RATIO (5%) in EITHER direction.
  const delta = outPref.minus(innPref); // out - in
  const ratio = delta.div(outPref).toNumber();
  if (Math.abs(ratio) > MAX_AMOUNT_DELTA_RATIO) return null;

  // Score: amount match weighted heavier than date proximity. Both
  // axes are normalised to 0–1.
  const amountScore = 1 - Math.abs(ratio) / MAX_AMOUNT_DELTA_RATIO;
  const dateScore = 1 - dayGap / MAX_DAY_GAP;
  const score = amountScore * 0.7 + dateScore * 0.3;

  if (score < MIN_MATCH_SCORE) return null;

  return {
    outflow: {
      id: out.id,
      accountId: out.account_id,
      accountName: out.account_name,
      accountColor: out.account_color,
      amount: out.amount,
      currency: out.currency,
      date: out.date,
      note: out.note,
    },
    inflow: {
      id: inn.id,
      accountId: inn.account_id,
      accountName: inn.account_name,
      accountColor: inn.account_color,
      amount: inn.amount,
      currency: inn.currency,
      date: inn.date,
      note: inn.note,
    },
    score,
    dayGap,
    feeInPreferred: qCent(delta).toFixed(2),
    isCrossCurrency: out.currency.toLowerCase() !== inn.currency.toLowerCase(),
  };
}

/* ── Confirm / Dismiss ────────────────────────────────────────────── */

/**
 * Mark a candidate pair as a confirmed transfer. Both rows get the same
 * fresh `transfer_pair_id`, and `transfer_reviewed_at` is stamped so
 * the detector won't re-suggest them. Account balances are NOT touched
 * - the original income/expense entries already moved the balances
 * correctly; the flag is the only thing changing.
 */
export async function confirmTransferPair(
  outflowId: string,
  inflowId: string,
): Promise<string> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const pairId = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.execute(
    `UPDATE transactions
        SET transfer_pair_id = ?, transfer_reviewed_at = ?, updated_at = datetime('now')
      WHERE id IN (?, ?) AND koinkat_account_id = ?`,
    [pairId, now, outflowId, inflowId, koinkatAccountId],
  );
  // Returned so the UI can offer an immediate Undo via unpairTransfer.
  return pairId;
}

/**
 * Mark a candidate pair as "user reviewed and rejected" so it never
 * appears in suggestions again. Both rows get `transfer_reviewed_at`
 * stamped; `transfer_pair_id` stays NULL - they remain ordinary
 * income/expense rows.
 */
export async function dismissTransferPair(
  outflowId: string,
  inflowId: string,
): Promise<void> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const now = new Date().toISOString();
  await db.execute(
    `UPDATE transactions
        SET transfer_reviewed_at = ?, updated_at = datetime('now')
      WHERE id IN (?, ?) AND koinkat_account_id = ?`,
    [now, outflowId, inflowId, koinkatAccountId],
  );
}

/**
 * Reverse a previously-confirmed pair: clear `transfer_pair_id` on both
 * rows so they go back to being counted as income/expense. Leaves
 * `transfer_reviewed_at` set so the detector still won't re-suggest
 * them - the user explicitly opted them OUT.
 */
export async function unpairTransfer(transferPairId: string): Promise<void> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  await db.execute(
    `UPDATE transactions
        SET transfer_pair_id = NULL, updated_at = datetime('now')
      WHERE transfer_pair_id = ? AND koinkat_account_id = ?`,
    [transferPairId, koinkatAccountId],
  );
}
