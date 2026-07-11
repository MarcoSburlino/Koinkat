// Recurring expense series - service layer.
//
// Owns: series CRUD, manual flag/unflag/dismiss, the import-time matcher
// (applyRecurringMatchOnImport) built on the pure scorer in
// domain/recurring-match.ts, cadence self-correction, missed-charge
// detection, and the two groupings for Analysis (recurringBreakdown) and
// Budgets (getRecurringForMonth). Every function scopes its queries to the
// active workspace via requireActiveKoinkatAccountId().
//
// Identity of a series is `merchant_normalized + cadence`; the amount is a
// tracked attribute that can change. A confident import match attaches
// silently and (if the series carries a category) categorizes the row so it
// skips Review. A doubtful one is left for Review with a pre-filled
// suggestion derived on demand by getRecurringSuggestion().

import Big from 'big.js';
import { format } from 'date-fns';
import { getDb, withTransaction } from '../db/database';
import { dec, qCent, tryConvert } from '../domain/money';
import {
  TX_BOOKED_ONLY,
  TX_EXCLUDE_REPAYMENT,
  TX_NET_AMOUNT_AS,
} from '../domain/tx-sql';
import { normalizeMerchantName } from '../domain/merchant';
import {
  pickMatch,
  scoreMatch,
  correctInterval,
  nextExpectedAfter,
  isOverdue,
  DEFAULT_CADENCE,
  DEFAULT_INTERVAL_DAYS,
  WINDOW_DAYS,
  type SeriesMatchInput,
  type TxnMatchInput,
  type MatchReason,
} from '../domain/recurring-match';
import { getRatesForDate, getLatestCachedRates } from './exchange-rate-service';
import { requireActiveKoinkatAccountId } from '../lib/active-koinkat-account';
import {
  toRecurringSeries,
  type RecurringSeries,
  type RecurringSeriesRow,
  type TransactionRow,
} from '../types/models';
import type { RecurrenceCadence, RecurringStatus } from '../types/enums';

function today(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

/** Map a DB row into the pure-matcher's input shape. */
function toMatchInput(row: RecurringSeriesRow): SeriesMatchInput & { id: string } {
  return {
    id: row.id,
    cadence: row.cadence as RecurrenceCadence,
    intervalDays: row.interval_days,
    expectedAmount: row.expected_amount,
    currency: row.currency,
    lastChargeDate: row.last_charge_date,
    nextExpectedDate: row.next_expected_date,
  };
}

// ── CRUD ─────────────────────────────────────────────────────────────────

export async function listActiveSeries(): Promise<RecurringSeries[]> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const rows = await db.select<RecurringSeriesRow[]>(
    `SELECT * FROM recurring_series
      WHERE koinkat_account_id = ? AND status = 'active'
      ORDER BY display_name COLLATE NOCASE ASC`,
    [koinkatAccountId],
  );
  return rows.map(toRecurringSeries);
}

export async function listAllSeries(): Promise<RecurringSeries[]> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const rows = await db.select<RecurringSeriesRow[]>(
    `SELECT * FROM recurring_series
      WHERE koinkat_account_id = ?
      ORDER BY status ASC, display_name COLLATE NOCASE ASC`,
    [koinkatAccountId],
  );
  return rows.map(toRecurringSeries);
}

export async function getSeries(id: string): Promise<RecurringSeries | null> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const rows = await db.select<RecurringSeriesRow[]>(
    'SELECT * FROM recurring_series WHERE id = ? AND koinkat_account_id = ?',
    [id, koinkatAccountId],
  );
  return rows.length ? toRecurringSeries(rows[0]) : null;
}

export interface UpdateSeriesPatch {
  displayName?: string;
  cadence?: RecurrenceCadence;
  categoryId?: string | null;
  expectedAmount?: string | null;
}

export async function updateSeries(id: string, patch: UpdateSeriesPatch): Promise<void> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.displayName !== undefined) {
    sets.push('display_name = ?');
    values.push(patch.displayName);
  }
  if (patch.cadence !== undefined) {
    sets.push('cadence = ?', 'interval_days = ?');
    values.push(patch.cadence, DEFAULT_INTERVAL_DAYS[patch.cadence]);
  }
  if (patch.categoryId !== undefined) {
    sets.push('category_id = ?');
    values.push(patch.categoryId);
  }
  if (patch.expectedAmount !== undefined) {
    sets.push('expected_amount = ?');
    values.push(patch.expectedAmount === null ? null : qCent(dec(patch.expectedAmount)).toFixed(2));
  }
  if (sets.length === 0) return;
  sets.push("updated_at = datetime('now')");
  values.push(id, koinkatAccountId);
  await db.execute(
    `UPDATE recurring_series SET ${sets.join(', ')} WHERE id = ? AND koinkat_account_id = ?`,
    values,
  );
}

export async function setSeriesStatus(id: string, status: RecurringStatus): Promise<void> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  await db.execute(
    `UPDATE recurring_series SET status = ?, updated_at = datetime('now')
      WHERE id = ? AND koinkat_account_id = ?`,
    [status, id, koinkatAccountId],
  );
}

export const pauseSeries = (id: string) => setSeriesStatus(id, 'paused');
export const endSeries = (id: string) => setSeriesStatus(id, 'ended');
export const reactivateSeries = (id: string) => setSeriesStatus(id, 'active');

/**
 * Delete a series. Its transactions are NOT deleted - the FK
 * `ON DELETE SET NULL` clears their recurring_series_id link.
 */
export async function deleteSeries(id: string): Promise<void> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  await db.execute(
    'DELETE FROM recurring_series WHERE id = ? AND koinkat_account_id = ?',
    [id, koinkatAccountId],
  );
}

// ── Manual flag / unflag / dismiss ────────────────────────────────────────

interface TxnWithCurrencyRow extends TransactionRow {
  account_currency: string;
}

async function loadTxnWithCurrency(
  txnId: string,
  koinkatAccountId: string,
): Promise<TxnWithCurrencyRow | null> {
  const db = await getDb();
  const rows = await db.select<TxnWithCurrencyRow[]>(
    `SELECT t.*, a.currency AS account_currency
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
      WHERE t.id = ? AND t.koinkat_account_id = ?`,
    [txnId, koinkatAccountId],
  );
  return rows.length ? rows[0] : null;
}

/** Resolve the merchant identity key for a row (bank or manual). */
function resolveMerchant(row: TransactionRow): string | null {
  return (
    row.merchant_normalized ||
    normalizeMerchantName(row.note) ||
    normalizeMerchantName(row.merchant_raw)
  );
}

/**
 * Flag a transaction as recurring - create or attach a series for its
 * merchant. Confirming once teaches the system: it tags the merchant's
 * series, not just this single row. Sets recurring_locked = 1 so the
 * matcher never overrides the user's choice.
 */
export async function flagTransactionAsRecurring(
  txnId: string,
  opts: { cadence?: RecurrenceCadence } = {},
): Promise<RecurringSeries> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const row = await loadTxnWithCurrency(txnId, koinkatAccountId);
  if (!row) throw new Error('Transaction not found');

  const merchant = resolveMerchant(row);
  if (!merchant) {
    throw new Error('Cannot mark recurring: this transaction has no merchant or description.');
  }
  const cadence = opts.cadence ?? DEFAULT_CADENCE;
  const chargeDate = row.date.slice(0, 10);
  const amount = qCent(dec(row.amount_in_account_ccy).abs()).toFixed(2);
  const currency = row.account_currency;

  // Attach to an existing active series for this merchant if one exists.
  const existing = await db.select<RecurringSeriesRow[]>(
    `SELECT * FROM recurring_series
      WHERE koinkat_account_id = ? AND merchant_normalized = ? AND status = 'active'
      ORDER BY updated_at DESC LIMIT 1`,
    [koinkatAccountId, merchant],
  );

  // Series write + transaction link are atomic: a failure between them
  // would leave an orphan series the user never sees (and a duplicate
  // would be created on the next attempt).
  const seriesId = await withTransaction(async (tx) => {
    let sid: string;
    if (existing.length > 0) {
      sid = existing[0].id;
      const interval = existing[0].interval_days;
      await tx.execute(
        `UPDATE recurring_series
            SET last_charge_date = ?, next_expected_date = ?, expected_amount = ?,
                currency = COALESCE(currency, ?),
                category_id = COALESCE(?, category_id),
                match_count = match_count + 1, last_matched_at = datetime('now'),
                updated_at = datetime('now')
          WHERE id = ? AND koinkat_account_id = ?`,
        [chargeDate, nextExpectedAfter(chargeDate, interval), amount, currency, row.category_id, sid, koinkatAccountId],
      );
    } else {
      sid = crypto.randomUUID();
      const interval = DEFAULT_INTERVAL_DAYS[cadence];
      const displayName = (row.merchant_raw || row.note || merchant).trim().slice(0, 80);
      await tx.execute(
        `INSERT INTO recurring_series
           (id, koinkat_account_id, merchant_normalized, display_name, cadence,
            interval_days, category_id, expected_amount, currency, status,
            last_charge_date, next_expected_date, match_count, last_matched_at, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, 1, datetime('now'), 'user')`,
        [
          sid, koinkatAccountId, merchant, displayName, cadence,
          interval, row.category_id, amount, currency,
          chargeDate, nextExpectedAfter(chargeDate, interval),
        ],
      );
    }

    // Link + lock the transaction; backfill merchant_normalized for manual rows.
    await tx.execute(
      `UPDATE transactions
          SET recurring_series_id = ?, recurring_locked = 1,
              merchant_normalized = COALESCE(merchant_normalized, ?),
              updated_at = datetime('now')
        WHERE id = ? AND koinkat_account_id = ?`,
      [sid, merchant, txnId, koinkatAccountId],
    );
    return sid;
  });

  const series = await getSeries(seriesId);
  if (!series) throw new Error('Series creation failed');
  return series;
}

/** Clear the series link and lock the row so the matcher won't re-attach it. */
export async function unflagRecurring(txnId: string): Promise<void> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  await db.execute(
    `UPDATE transactions
        SET recurring_series_id = NULL, recurring_locked = 1, updated_at = datetime('now')
      WHERE id = ? AND koinkat_account_id = ?`,
    [txnId, koinkatAccountId],
  );
}

/**
 * Mark "this merchant is NOT recurring" - record a dismissal so the matcher
 * stops nudging, and unflag+lock this row.
 */
export async function dismissMerchant(txnId: string): Promise<void> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const row = await loadTxnWithCurrency(txnId, koinkatAccountId);
  if (!row) throw new Error('Transaction not found');
  const merchant = resolveMerchant(row);
  if (merchant) {
    await db.execute(
      `INSERT OR IGNORE INTO recurring_dismissals
         (id, koinkat_account_id, merchant_normalized) VALUES (?, ?, ?)`,
      [crypto.randomUUID(), koinkatAccountId, merchant],
    );
  }
  await unflagRecurring(txnId);
}

// ── Import-time auto-recognition ──────────────────────────────────────────

export interface RecurringMatchSummary {
  attached: number;       // silently attached, no Review
  flaggedForReview: number;
}

/**
 * Run the recurring matcher over freshly-imported expense rows. Called from
 * the bank-sync categorization tail. Confident matches attach silently (and
 * categorize from the series); doubtful ones are left in Review with a
 * suggestion derivable via getRecurringSuggestion(). Idempotent: rows that
 * already carry a series link or are locked are skipped, and a duplicate in
 * the same cadence window routes to Review instead of double-attaching.
 *
 * future: recurrence discovery - a discovery pass could pre-tick the same
 * Review toggle for unflagged merchants here, respecting recurring_dismissals.
 */
export async function applyRecurringMatchOnImport(
  txnIds: string[],
): Promise<RecurringMatchSummary> {
  if (txnIds.length === 0) return { attached: 0, flaggedForReview: 0 };
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  let attached = 0;
  let flaggedForReview = 0;

  for (const id of txnIds) {
    const row = await loadTxnWithCurrency(id, koinkatAccountId);
    if (!row) continue;
    if (row.type !== 'expense') continue;
    if (row.recurring_series_id) continue;     // already linked → idempotent
    if (row.recurring_locked === 1) continue;  // user decided → never override

    const merchant = row.merchant_normalized;
    if (!merchant) continue;

    // Respect a dismissal for this merchant.
    const dismissed = await db.select<{ id: string }[]>(
      'SELECT id FROM recurring_dismissals WHERE koinkat_account_id = ? AND merchant_normalized = ?',
      [koinkatAccountId, merchant],
    );
    if (dismissed.length > 0) continue;

    const seriesRows = await db.select<RecurringSeriesRow[]>(
      `SELECT * FROM recurring_series
        WHERE koinkat_account_id = ? AND merchant_normalized = ? AND status = 'active'`,
      [koinkatAccountId, merchant],
    );
    const candidates = seriesRows.map(toMatchInput);
    const txnInput: TxnMatchInput = {
      date: row.date.slice(0, 10),
      amount: qCent(dec(row.amount_in_account_ccy).abs()).toFixed(2),
      currency: row.account_currency,
    };

    const { verdict, series } = pickMatch(txnInput, candidates);
    if (verdict.decision === 'none') continue;

    if (verdict.decision === 'silent' && series) {
      // Guard against an unexpected duplicate in the same period before
      // attaching silently - if one already exists, fall back to Review.
      const window = WINDOW_DAYS[series.cadence];
      const dupes = await db.select<{ cnt: number }[]>(
        `SELECT COUNT(*) AS cnt FROM transactions
          WHERE koinkat_account_id = ? AND recurring_series_id = ? AND id != ?
            AND ABS(julianday(date) - julianday(?)) <= ?`,
        [koinkatAccountId, series.id, id, txnInput.date, window],
      );
      if (dupes[0]?.cnt > 0) {
        await db.execute(
          "UPDATE transactions SET needs_review = 1, updated_at = datetime('now') WHERE id = ? AND koinkat_account_id = ?",
          [id, koinkatAccountId],
        );
        flaggedForReview++;
        continue;
      }
      await attachSilently(koinkatAccountId, id, row, series, seriesRows[0]);
      attached++;
      continue;
    }

    // 'review' - surface in the queue. For an amount jump, attach the link
    // (it IS the same plan, the price moved) but still ask.
    if (verdict.reason === 'amount-jump' && series) {
      await db.execute(
        `UPDATE transactions
            SET recurring_series_id = ?, needs_review = 1, updated_at = datetime('now')
          WHERE id = ? AND koinkat_account_id = ?`,
        [series.id, id, koinkatAccountId],
      );
    } else {
      await db.execute(
        "UPDATE transactions SET needs_review = 1, updated_at = datetime('now') WHERE id = ? AND koinkat_account_id = ?",
        [id, koinkatAccountId],
      );
    }
    flaggedForReview++;
  }

  return { attached, flaggedForReview };
}

/** Attach a confident match: link, self-correct, refresh, categorize. */
async function attachSilently(
  koinkatAccountId: string,
  txnId: string,
  txnRow: TxnWithCurrencyRow,
  series: SeriesMatchInput & { id: string },
  seriesRow: RecurringSeriesRow,
): Promise<void> {
  const chargeDate = txnRow.date.slice(0, 10);
  const newAmount = qCent(dec(txnRow.amount_in_account_ccy).abs()).toFixed(2);

  // Self-correct the interval from the real gap, then advance dates.
  const newInterval = series.lastChargeDate
    ? correctInterval(series.lastChargeDate, chargeDate, series.intervalDays, series.cadence)
    : series.intervalDays;
  const lastChargeDate =
    !series.lastChargeDate || chargeDate >= series.lastChargeDate
      ? chargeDate
      : series.lastChargeDate;

  // Series advance + transaction link are atomic: a crash between them
  // would advance next_expected_date while leaving the charge unlinked.
  await withTransaction(async (tx) => {
    await tx.execute(
      `UPDATE recurring_series
          SET last_charge_date = ?, next_expected_date = ?, expected_amount = ?,
              interval_days = ?, match_count = match_count + 1,
              last_matched_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ? AND koinkat_account_id = ?`,
      [
        lastChargeDate,
        nextExpectedAfter(lastChargeDate, newInterval),
        newAmount,
        newInterval,
        series.id,
        koinkatAccountId,
      ],
    );

    // Link the row. If it is uncategorized and the series carries a category,
    // apply it (source rule_auto) and clear needs_review so a fully-recognized
    // charge skips the Review queue entirely.
    if (txnRow.category_id === null && seriesRow.category_id) {
      await tx.execute(
        `UPDATE transactions
            SET recurring_series_id = ?, category_id = ?, categorization_source = 'rule_auto',
                needs_review = 0, updated_at = datetime('now')
          WHERE id = ? AND koinkat_account_id = ?`,
        [series.id, seriesRow.category_id, txnId, koinkatAccountId],
      );
    } else {
      await tx.execute(
        `UPDATE transactions
            SET recurring_series_id = ?, updated_at = datetime('now')
          WHERE id = ? AND koinkat_account_id = ?`,
        [series.id, txnId, koinkatAccountId],
      );
    }
  });
}

// ── Review suggestion (derived on demand, no persisted column) ────────────

export interface RecurringSuggestion {
  seriesId: string | null;
  displayName: string | null;
  cadence: RecurrenceCadence | null;
  reason: MatchReason;
  amountJumped: boolean;
  expectedAmount: string | null;
  newAmount: string;
  currency: string;
}

/**
 * Re-run the matcher for a single transaction to build the Review prompt
 * ("Looks like your monthly Netflix" / "amount changed €X → €Y - still the
 * same plan?"). Returns null when there's nothing to suggest.
 */
export async function getRecurringSuggestion(txnId: string): Promise<RecurringSuggestion | null> {
  // Delegates to the batch form so the single-row and batch paths can
  // never drift apart (same filters, same scoring).
  const suggestions = await getRecurringSuggestionsBatch([txnId]);
  return suggestions.get(txnId) ?? null;
}

/**
 * Batch form of `getRecurringSuggestion` for the Review queue: three
 * queries total (candidate rows, dismissals, series) instead of three
 * queries PER row. Same decision logic, applied in memory per row.
 *
 * Returns a map of txn id -> suggestion; rows with nothing to suggest are
 * simply absent.
 */
export async function getRecurringSuggestionsBatch(
  txnIds: string[],
): Promise<Map<string, RecurringSuggestion>> {
  const out = new Map<string, RecurringSuggestion>();
  if (txnIds.length === 0) return out;

  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const txnPh = txnIds.map(() => '?').join(', ');

  // Only rows the single-row path would consider: expenses, not locked,
  // with a bank-supplied normalized merchant.
  const rows = await db.select<TxnWithCurrencyRow[]>(
    `SELECT t.*, a.currency AS account_currency
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
      WHERE t.koinkat_account_id = ?
        AND t.id IN (${txnPh})
        AND t.type = 'expense'
        AND (t.recurring_locked IS NULL OR t.recurring_locked = 0)
        AND t.merchant_normalized IS NOT NULL`,
    [koinkatAccountId, ...txnIds],
  );
  if (rows.length === 0) return out;

  const merchants = [...new Set(rows.map((r) => r.merchant_normalized as string))];
  const merchantPh = merchants.map(() => '?').join(', ');

  const [dismissedRows, seriesRows] = await Promise.all([
    db.select<{ merchant_normalized: string }[]>(
      `SELECT merchant_normalized FROM recurring_dismissals
        WHERE koinkat_account_id = ? AND merchant_normalized IN (${merchantPh})`,
      [koinkatAccountId, ...merchants],
    ),
    db.select<RecurringSeriesRow[]>(
      `SELECT * FROM recurring_series
        WHERE koinkat_account_id = ?
          AND merchant_normalized IN (${merchantPh})
          AND status = 'active'`,
      [koinkatAccountId, ...merchants],
    ),
  ]);

  const dismissed = new Set(dismissedRows.map((d) => d.merchant_normalized));
  const seriesByMerchant = new Map<string, RecurringSeriesRow[]>();
  for (const s of seriesRows) {
    const bucket = seriesByMerchant.get(s.merchant_normalized);
    if (bucket) bucket.push(s);
    else seriesByMerchant.set(s.merchant_normalized, [s]);
  }

  for (const row of rows) {
    const merchant = row.merchant_normalized as string;
    if (dismissed.has(merchant)) continue;
    const candidates = seriesByMerchant.get(merchant);
    if (!candidates || candidates.length === 0) continue;

    const txnInput: TxnMatchInput = {
      date: row.date.slice(0, 10),
      amount: qCent(dec(row.amount_in_account_ccy).abs()).toFixed(2),
      currency: row.account_currency,
    };
    const candidate = candidates[0];
    const verdict: { reason: MatchReason; amountJumped: boolean } =
      candidates.length > 1
        ? { reason: 'ambiguous-multiple-series', amountJumped: false }
        : scoreMatch(txnInput, toMatchInput(candidate));

    out.set(row.id, {
      seriesId: candidate.id,
      displayName: candidate.display_name,
      cadence: candidate.cadence as RecurrenceCadence,
      reason: verdict.reason,
      amountJumped: verdict.amountJumped,
      expectedAmount: candidate.expected_amount,
      newAmount: txnInput.amount,
      currency: txnInput.currency,
    });
  }
  return out;
}

// ── Missed-charge detection ───────────────────────────────────────────────

export interface MissedCharge {
  series: RecurringSeries;
  /** ISO date the charge was expected around. */
  expectedDate: string;
  /** Whole days overdue past next_expected_date. */
  daysOverdue: number;
}

/**
 * Active series whose next expected charge is overdue past the grace window
 * with nothing matched yet. A quiet notice, never a Review row.
 *
 * The notice expires after one full cadence interval: past that point the
 * charge isn't "late", the commitment has evidently stopped - the card has
 * already self-retired from the Budgets list, and nagging forever about a
 * cancelled subscription would be noise.
 */
export async function listMissedCharges(): Promise<MissedCharge[]> {
  const series = await listActiveSeries();
  const ref = today();
  const out: MissedCharge[] = [];
  for (const s of series) {
    if (!s.nextExpectedDate) continue;
    if (isOverdue({ nextExpectedDate: s.nextExpectedDate }, ref)) {
      const daysOverdue = Math.max(
        0,
        Math.round(
          (Date.parse(ref) - Date.parse(s.nextExpectedDate)) / 86_400_000,
        ),
      );
      const interval = s.intervalDays || DEFAULT_INTERVAL_DAYS[s.cadence];
      if (daysOverdue > interval) continue;
      out.push({ series: s, expectedDate: s.nextExpectedDate, daysOverdue });
    }
  }
  return out;
}

// ── Aggregation: Analysis - recurring breakdown + fixed/variable ──────────

export interface RecurringBreakdownRow {
  seriesId: string;
  displayName: string;
  cadence: RecurrenceCadence;
  amount: string;   // converted to preferred currency
  count: number;
}

export interface RecurringBreakdownResult {
  rows: RecurringBreakdownRow[];
  total: string;          // sum of recurring rows (= fixed)
  fixedTotal: string;     // expenses WITH a series link
  variableTotal: string;  // expenses WITHOUT a series link
  unconvertibleCurrencies: string[];
}

/**
 * Group period expense spend by recurring series, plus a fixed-vs-variable
 * split of total expenses. This is a LENS over the same spend the category
 * breakdown already counts - never an addition. Honors the same exclusions
 * (transfers, repayment children, pending) and FX handling as siblings.
 */
export async function recurringBreakdown(params: {
  year?: number;
  month?: number;
  preferredCurrency: string;
}): Promise<RecurringBreakdownResult> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();

  const conditions: string[] = [
    't.koinkat_account_id = ?',
    't.transfer_pair_id IS NULL',
    "t.type = 'expense'",
    TX_EXCLUDE_REPAYMENT,
    TX_BOOKED_ONLY,
  ];
  const values: unknown[] = [koinkatAccountId];
  if (params.year !== undefined) {
    conditions.push('substr(t.date, 1, 4) = ?');
    values.push(String(params.year));
  }
  if (params.month !== undefined && params.month >= 1 && params.month <= 12) {
    conditions.push('substr(t.date, 6, 2) = ?');
    values.push(String(params.month).padStart(2, '0'));
  }

  const rows = await db.select<
    {
      amount_in_account_ccy: string;
      recurring_series_id: string | null;
      display_name: string | null;
      cadence: string | null;
      account_currency: string;
    }[]
  >(
    `SELECT ${TX_NET_AMOUNT_AS},
            t.recurring_series_id,
            rs.display_name,
            rs.cadence,
            a.currency AS account_currency
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       LEFT JOIN recurring_series rs ON rs.id = t.recurring_series_id
      WHERE ${conditions.join(' AND ')}`,
    values,
  );

  const rates = await getLatestCachedRates();
  const grouped = new Map<string, { displayName: string; cadence: string; total: Big; count: number }>();
  const unconvertible = new Set<string>();
  let fixed = new Big('0');
  let variable = new Big('0');

  for (const r of rows) {
    const amount = dec(r.amount_in_account_ccy).abs();
    const converted = tryConvert(amount, r.account_currency, params.preferredCurrency, rates);
    if (converted === null) {
      unconvertible.add(r.account_currency.toLowerCase());
      continue;
    }
    if (r.recurring_series_id) {
      fixed = fixed.plus(converted);
      const ex = grouped.get(r.recurring_series_id);
      if (ex) {
        ex.total = ex.total.plus(converted);
        ex.count += 1;
      } else {
        grouped.set(r.recurring_series_id, {
          displayName: r.display_name ?? 'Recurring',
          cadence: r.cadence ?? 'monthly',
          total: converted,
          count: 1,
        });
      }
    } else {
      variable = variable.plus(converted);
    }
  }

  const breakdownRows: RecurringBreakdownRow[] = [...grouped.entries()]
    .map(([seriesId, v]) => ({
      seriesId,
      displayName: v.displayName,
      cadence: v.cadence as RecurrenceCadence,
      amount: qCent(v.total).toFixed(2),
      count: v.count,
    }))
    .sort((a, b) => {
      // Sign-only comparator - no float extraction from monetary Bigs.
      const diff = dec(b.amount).minus(dec(a.amount));
      return diff.gt(0) ? 1 : diff.lt(0) ? -1 : 0;
    });

  return {
    rows: breakdownRows,
    total: qCent(fixed).toFixed(2),
    fixedTotal: qCent(fixed).toFixed(2),
    variableTotal: qCent(variable).toFixed(2),
    unconvertibleCurrencies: [...unconvertible].sort(),
  };
}

// ── Aggregation: Budgets - recurring costs for a month ────────────────────

export interface RecurringPeriodRow {
  series: RecurringSeries;
  expected: string | null;   // per-occurrence expected, converted
  actual: string;            // charged this month, converted
  charged: boolean;
}

export interface RecurringForMonthResult {
  rows: RecurringPeriodRow[];
  /** Recurring slice of this month's spend (the no-double-count figure). */
  totalActual: string;
  /** Monthly series expected this month but not yet charged. */
  remainingExpected: string;
  /** totalActual + remainingExpected - projected recurring for the month. */
  projectedTotal: string;
  unconvertibleCurrencies: string[];
}

/**
 * Recurring commitments for a focused month: each active series with its
 * expected amount and this-month actual, plus the recurring slice of spend.
 * A LENS over period spend - these amounts are already inside the period
 * total; never add them on top of it.
 */
export async function getRecurringForMonth(params: {
  year: number;
  month: number;
  targetCurrency: string;
}): Promise<RecurringForMonthResult> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const monthStr = String(params.month).padStart(2, '0');
  const monthStart = `${params.year}-${monthStr}-01`;
  const monthEnd = `${params.year}-${monthStr}-31`;

  const series = await listActiveSeries();
  const rateMemo = new Map<string, Record<string, string> | null>();
  const unconvertible = new Set<string>();

  // Per-series actual charged this month (in the account currency, then
  // converted). Same exclusions as every other aggregation.
  const chargeRows = await db.select<
    { recurring_series_id: string; amount_in_account_ccy: string; date: string; account_currency: string }[]
  >(
    `SELECT t.recurring_series_id, ${TX_NET_AMOUNT_AS},
            t.date, a.currency AS account_currency
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
      WHERE t.koinkat_account_id = ?
        AND t.type = 'expense'
        AND t.recurring_series_id IS NOT NULL
        AND t.transfer_pair_id IS NULL
        AND ${TX_EXCLUDE_REPAYMENT}
        AND ${TX_BOOKED_ONLY}
        AND substr(t.date, 1, 7) = ?`,
    [koinkatAccountId, `${params.year}-${monthStr}`],
  );

  const actualBySeries = new Map<string, Big>();
  for (const r of chargeRows) {
    const amount = dec(r.amount_in_account_ccy).abs();
    let converted: Big | null;
    if (r.account_currency.toUpperCase() === params.targetCurrency.toUpperCase()) {
      converted = amount;
    } else {
      const rates = await getRatesForDate(r.date, rateMemo);
      converted = tryConvert(amount, r.account_currency, params.targetCurrency, rates);
    }
    if (converted === null) {
      unconvertible.add(r.account_currency.toLowerCase());
      continue;
    }
    actualBySeries.set(
      r.recurring_series_id,
      (actualBySeries.get(r.recurring_series_id) ?? new Big('0')).plus(converted),
    );
  }

  const latest = await getLatestCachedRates();
  let totalActual = new Big('0');
  let remainingExpected = new Big('0');
  const rows: RecurringPeriodRow[] = [];

  for (const s of series) {
    const actual = actualBySeries.get(s.id) ?? new Big('0');
    totalActual = totalActual.plus(actual);
    const charged = actual.gt(new Big('0'));

    // Self-retiring display: a series whose expected charge did not arrive
    // by its due date (plus grace) simply disappears from the month view -
    // there is no manual pause/end on these cards. The series is NOT
    // ended in the DB: if the charge resumes, the importer's matcher
    // re-links it, next_expected_date advances, and the row returns on
    // its own. Months where it DID charge keep showing it.
    if (!charged && isOverdue({ nextExpectedDate: s.nextExpectedDate }, today())) {
      continue;
    }

    let expectedConv: string | null = null;
    if (s.expectedAmount && s.currency) {
      const expAmt = dec(s.expectedAmount).abs();
      const conv =
        s.currency.toUpperCase() === params.targetCurrency.toUpperCase()
          ? expAmt
          : tryConvert(expAmt, s.currency, params.targetCurrency, latest);
      if (conv !== null) {
        expectedConv = qCent(conv).toFixed(2);
        // Monthly series due this month but not yet charged → still expected.
        if (
          s.cadence === 'monthly' &&
          !charged &&
          s.nextExpectedDate &&
          s.nextExpectedDate >= monthStart &&
          s.nextExpectedDate <= monthEnd
        ) {
          remainingExpected = remainingExpected.plus(conv);
        }
      } else if (s.currency.toLowerCase() !== params.targetCurrency.toLowerCase()) {
        unconvertible.add(s.currency.toLowerCase());
      }
    }

    rows.push({ series: s, expected: expectedConv, actual: qCent(actual).toFixed(2), charged });
  }

  rows.sort((a, b) => {
    // Sign-only comparator - no float extraction from monetary Bigs.
    const diff = dec(b.actual).minus(dec(a.actual));
    return diff.gt(0) ? 1 : diff.lt(0) ? -1 : 0;
  });

  return {
    rows,
    totalActual: qCent(totalActual).toFixed(2),
    remainingExpected: qCent(remainingExpected).toFixed(2),
    projectedTotal: qCent(totalActual.plus(remainingExpected)).toFixed(2),
    unconvertibleCurrencies: [...unconvertible].sort(),
  };
}
