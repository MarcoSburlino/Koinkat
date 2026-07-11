import Big from 'big.js';
import { getDb, withTransaction } from '../db/database';
import { dec, qCent, tryConvert } from '../domain/money';
import {
  TX_BOOKED_ONLY,
  TX_EXCLUDE_REPAYMENT,
  TX_NET_AMOUNT_AS,
} from '../domain/tx-sql';
import { getRatesForDate } from './exchange-rate-service';
import { requireActiveKoinkatAccountId } from '../lib/active-koinkat-account';
import {
  format,
  startOfMonth,
  endOfMonth,
  eachMonthOfInterval,
  endOfWeek,
  eachWeekOfInterval,
} from 'date-fns';
import type {
  RecurringBudget,
  BudgetPeriod,
  BudgetEvent,
  BudgetEventRow,
} from '../types/models';
import { toBudgetEvent } from '../types/models';
import type { BudgetRhythm } from '../types/enums';

/* ── Local row types (snake_case from SQLite) ──────────────────────── */

interface RecurringBudgetRow {
  id: string;
  year: number;
  start_month: number;
  end_month: number;
  rhythm: string;
  limit_amount: string;
  currency: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

interface BudgetPeriodRow {
  id: string;
  recurring_budget_id: string;
  period_start: string;
  period_end: string;
  limit_amount: string;
  currency: string;
  is_customized: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/* ── Mapper functions ──────────────────────────────────────────────── */

function toRecurringBudget(row: RecurringBudgetRow): RecurringBudget {
  return {
    id: row.id,
    year: row.year,
    startMonth: row.start_month,
    endMonth: row.end_month,
    rhythm: row.rhythm as BudgetRhythm,
    limitAmount: row.limit_amount,
    currency: row.currency,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toBudgetPeriod(row: BudgetPeriodRow): BudgetPeriod {
  return {
    id: row.id,
    recurringBudgetId: row.recurring_budget_id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    limitAmount: row.limit_amount,
    currency: row.currency,
    isCustomized: row.is_customized === 1,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// `toBudgetEvent` is now imported from `../types/models`.

/* ══════════════════════════════════════════════════════════════════════
   RECURRING BUDGETS
   ══════════════════════════════════════════════════════════════════════ */

export async function createRecurringBudget(params: {
  year: number;
  startMonth: number;
  endMonth: number;
  rhythm: BudgetRhythm;
  limitAmount: string;
  currency: string;
}): Promise<RecurringBudget> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();

  // Validate
  if (params.startMonth < 1 || params.startMonth > 12) {
    throw new Error('startMonth must be between 1 and 12');
  }
  if (params.endMonth < 1 || params.endMonth > 12) {
    throw new Error('endMonth must be between 1 and 12');
  }
  if (params.endMonth < params.startMonth) {
    throw new Error('endMonth must be >= startMonth');
  }

  const limitAmount = qCent(dec(params.limitAmount)).toFixed(2);
  const currency = params.currency.toUpperCase();

  // One budget per year per profile
  const existing = await db.select<RecurringBudgetRow[]>(
    'SELECT * FROM recurring_budgets WHERE koinkat_account_id = ? AND year = ?',
    [koinkatAccountId, params.year],
  );
  if (existing.length > 0) {
    throw new Error(`A budget already exists for year ${params.year}`);
  }

  const id = crypto.randomUUID();
  await db.execute(
    `INSERT INTO recurring_budgets
       (id, koinkat_account_id, year, start_month, end_month, rhythm, limit_amount, currency, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [id, koinkatAccountId, params.year, params.startMonth, params.endMonth, params.rhythm, limitAmount, currency],
  );

  const rows = await db.select<RecurringBudgetRow[]>(
    'SELECT * FROM recurring_budgets WHERE id = ? AND koinkat_account_id = ?',
    [id, koinkatAccountId],
  );
  return toRecurringBudget(rows[0]);
}

export async function getBudgetForYear(year: number): Promise<RecurringBudget | null> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const rows = await db.select<RecurringBudgetRow[]>(
    'SELECT * FROM recurring_budgets WHERE koinkat_account_id = ? AND year = ?',
    [koinkatAccountId, year],
  );
  return rows.length > 0 ? toRecurringBudget(rows[0]) : null;
}

export async function updateRecurringBudgetLimit(
  budgetId: string,
  newLimit: string,
): Promise<RecurringBudget> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const limitAmount = qCent(dec(newLimit)).toFixed(2);

  // Budget + period updates are atomic: a failure between them would show
  // the new limit on the budget while every period kept the old one.
  const rows = await withTransaction(async (tx) => {
    await tx.execute(
      `UPDATE recurring_budgets
          SET limit_amount = ?, updated_at = datetime('now')
        WHERE id = ? AND koinkat_account_id = ?`,
      [limitAmount, budgetId, koinkatAccountId],
    );

    // Also update all non-customized periods
    await tx.execute(
      `UPDATE budget_periods
          SET limit_amount = ?, updated_at = datetime('now')
        WHERE recurring_budget_id = ?
          AND koinkat_account_id = ?
          AND is_customized = 0`,
      [limitAmount, budgetId, koinkatAccountId],
    );

    return tx.select<RecurringBudgetRow[]>(
      'SELECT * FROM recurring_budgets WHERE id = ? AND koinkat_account_id = ?',
      [budgetId, koinkatAccountId],
    );
  });
  if (rows.length === 0) throw new Error('Budget not found');
  return toRecurringBudget(rows[0]);
}

export async function deleteRecurringBudget(budgetId: string): Promise<boolean> {
  const koinkatAccountId = requireActiveKoinkatAccountId();

  // Atomic: a failure after the periods DELETE would leave an orphaned
  // parent whose periods silently regenerate via ensurePeriodsForYear.
  return withTransaction(async (tx) => {
    await tx.execute(
      'DELETE FROM budget_periods WHERE recurring_budget_id = ? AND koinkat_account_id = ?',
      [budgetId, koinkatAccountId],
    );

    const result = await tx.execute(
      'DELETE FROM recurring_budgets WHERE id = ? AND koinkat_account_id = ?',
      [budgetId, koinkatAccountId],
    );
    return result.rowsAffected > 0;
  });
}

/** First/last ISO dates covered by a budget's month range. */
function budgetRangeDates(
  year: number,
  startMonth: number,
  endMonth: number,
): { startDate: string; endDate: string } {
  const startDate = `${year}-${String(startMonth).padStart(2, '0')}-01`;
  const lastDay = new Date(year, endMonth, 0).getDate();
  const endDate = `${year}-${String(endMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { startDate, endDate };
}

/**
 * Count expenses excluded from budgeting (`is_budgeted = 0`) inside a
 * budget's date range. Drives the Budgets page's backfill banner.
 */
export async function countUnbudgetedExpenses(params: {
  year: number;
  startMonth: number;
  endMonth: number;
}): Promise<number> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const { startDate, endDate } = budgetRangeDates(
    params.year,
    params.startMonth,
    params.endMonth,
  );
  const rows = await db.select<{ cnt: number }[]>(
    `SELECT COUNT(*) as cnt FROM transactions
     WHERE type = 'expense' AND is_budgeted = 0
       AND koinkat_account_id = ?
       AND date >= ? AND date <= ?`,
    [koinkatAccountId, startDate, endDate],
  );
  return rows[0]?.cnt ?? 0;
}

/**
 * Flip every excluded expense in the budget's range back to
 * `is_budgeted = 1`.
 *
 * TODO: this bulk-update overwrites transactions that the user explicitly
 * opted out of the budget. A proper fix needs a provenance flag or a
 * confirmation dialog listing affected rows before proceeding.
 */
export async function backfillBudgetedExpenses(params: {
  year: number;
  startMonth: number;
  endMonth: number;
}): Promise<void> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const { startDate, endDate } = budgetRangeDates(
    params.year,
    params.startMonth,
    params.endMonth,
  );
  await db.execute(
    `UPDATE transactions SET is_budgeted = 1
     WHERE type = 'expense' AND is_budgeted = 0
       AND koinkat_account_id = ?
       AND date >= ? AND date <= ?`,
    [koinkatAccountId, startDate, endDate],
  );
}

export async function getAvailableBudgetYears(): Promise<number[]> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const rows = await db.select<{ year: number }[]>(
    'SELECT DISTINCT year FROM recurring_budgets WHERE koinkat_account_id = ? ORDER BY year ASC',
    [koinkatAccountId],
  );
  const years = rows.map((r) => r.year);
  const currentYear = new Date().getFullYear();
  if (!years.includes(currentYear)) {
    years.push(currentYear);
    years.sort((a, b) => a - b);
  }
  return years;
}

/* ══════════════════════════════════════════════════════════════════════
   BUDGET PERIODS
   ══════════════════════════════════════════════════════════════════════ */

export async function ensurePeriodsForYear(budgetId: string): Promise<void> {
  // The whole body is wrapped so a mid-function throw becomes a
  // contextual error the Budgets page can surface, instead of being
  // swallowed by the page-level catch as a generic "Failed to load
  // budget data." Without this wrap, a Round 2 user couldn't tell
  // whether the budget was missing, the period generation failed, or
  // the workspace scope mismatched.
  try {
    const koinkatAccountId = requireActiveKoinkatAccountId();
    const db = await getDb();

    const budgetRows = await db.select<RecurringBudgetRow[]>(
      'SELECT * FROM recurring_budgets WHERE id = ? AND koinkat_account_id = ?',
      [budgetId, koinkatAccountId],
    );
    if (budgetRows.length === 0) throw new Error('Budget not found');

    const budget = toRecurringBudget(budgetRows[0]);
    const rhythm = budget.rhythm;

    // Build date range
    const rangeStart = new Date(budget.year, budget.startMonth - 1, 1);
    const rangeEnd = endOfMonth(new Date(budget.year, budget.endMonth - 1, 1));

    type PeriodDef = { start: string; end: string };
    const periods: PeriodDef[] = [];

    if (rhythm === 'monthly') {
      const months = eachMonthOfInterval({ start: rangeStart, end: rangeEnd });
      for (const monthDate of months) {
        periods.push({
          start: format(startOfMonth(monthDate), 'yyyy-MM-dd'),
          end: format(endOfMonth(monthDate), 'yyyy-MM-dd'),
        });
      }
    } else if (rhythm === 'yearly') {
      periods.push({
        start: format(rangeStart, 'yyyy-MM-dd'),
        end: format(rangeEnd, 'yyyy-MM-dd'),
      });
    } else if (rhythm === 'weekly') {
      const weeks = eachWeekOfInterval(
        { start: rangeStart, end: rangeEnd },
        { weekStartsOn: 1 }, // Monday
      );
      for (const weekStart of weeks) {
        const wStart = weekStart < rangeStart ? rangeStart : weekStart;
        const wEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
        const clampedEnd = wEnd > rangeEnd ? rangeEnd : wEnd;
        periods.push({
          start: format(wStart, 'yyyy-MM-dd'),
          end: format(clampedEnd, 'yyyy-MM-dd'),
        });
      }
    }

    if (periods.length === 0) return;

    // Fetch which period starts already exist in a single query, then
    // issue one INSERT OR IGNORE per missing period. This avoids a
    // SELECT-then-INSERT round-trip for every period slot.
    const existingRows = await db.select<{ period_start: string }[]>(
      'SELECT period_start FROM budget_periods WHERE recurring_budget_id = ? AND koinkat_account_id = ?',
      [budgetId, koinkatAccountId],
    );
    const existingStarts = new Set(existingRows.map((r) => r.period_start));

    for (const p of periods) {
      if (existingStarts.has(p.start)) continue;
      const id = crypto.randomUUID();
      await db.execute(
        `INSERT OR IGNORE INTO budget_periods
           (id, koinkat_account_id, recurring_budget_id, period_start, period_end, limit_amount, currency, is_customized)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
        [id, koinkatAccountId, budgetId, p.start, p.end, budget.limitAmount, budget.currency],
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to ensure periods for budget ${budgetId}: ${msg}`);
  }
}

export async function customizePeriod(
  periodId: string,
  newLimit: string,
  notes?: string,
): Promise<BudgetPeriod> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const limitAmount = qCent(dec(newLimit)).toFixed(2);

  // Fragments are hardcoded literals only - never interpolate user input into a clause string; bind values via '?'.
  const setClauses = [
    'limit_amount = ?',
    'is_customized = 1',
    "updated_at = datetime('now')",
  ];
  const values: unknown[] = [limitAmount];

  if (notes !== undefined) {
    setClauses.push('notes = ?');
    values.push(notes);
  }

  values.push(periodId, koinkatAccountId);

  await db.execute(
    `UPDATE budget_periods SET ${setClauses.join(', ')} WHERE id = ? AND koinkat_account_id = ?`,
    values,
  );

  const rows = await db.select<BudgetPeriodRow[]>(
    'SELECT * FROM budget_periods WHERE id = ? AND koinkat_account_id = ?',
    [periodId, koinkatAccountId],
  );
  if (rows.length === 0) throw new Error('Period not found');
  return toBudgetPeriod(rows[0]);
}

export async function listPeriodsForBudget(budgetId: string): Promise<BudgetPeriod[]> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const rows = await db.select<BudgetPeriodRow[]>(
    'SELECT * FROM budget_periods WHERE recurring_budget_id = ? AND koinkat_account_id = ? ORDER BY period_start ASC',
    [budgetId, koinkatAccountId],
  );
  return rows.map(toBudgetPeriod);
}

/* ══════════════════════════════════════════════════════════════════════
   SPENDING CALCULATION
   ══════════════════════════════════════════════════════════════════════ */

interface SpendingTxRow {
  amount_in_account_ccy: string;
  date: string;
  account_currency: string;
}

export interface SpendingResult {
  /** Grand total, converted into the caller's target currency. */
  total: string;
  /**
   * Per-currency native-amount totals (before conversion), keyed by
   * lowercase currency code. When this has more than one key the UI
   * can surface a "spent across EUR, DKK" note so the user knows the
   * total is a converted composite.
   */
  perCurrency: Record<string, string>;
  /**
   * Currencies (lowercase) whose rate was missing at aggregation time -
   * those transactions are NOT reflected in `total`. UI should surface
   * a warning when non-empty.
   */
  unconvertibleCurrencies: string[];
}

/**
 * Convert and total a set of expense rows into `targetCurrency`.
 *
 * Same-currency rows add directly; cross-currency rows convert via the
 * rate snapshot for the transaction's date and are SKIPPED if no rate is
 * available (recorded in `unconvertibleCurrencies`) rather than added at
 * a 1:1 fallback, which would silently corrupt the total. Also returns
 * per-currency native subtotals for the "spent across EUR, DKK" UI note.
 *
 * Shared by `calculatePeriodSpending` and `calculateEventSpending`, whose
 * loops were previously byte-identical - keeping the skip-on-missing-rate
 * logic in one place stops the two paths from diverging. `logContext` is
 * interpolated into the skipped-rows warning so each caller keeps its own
 * distinct log line (e.g. "period 123" / "event abc").
 */
async function sumSpendingRows(
  txRows: SpendingTxRow[],
  targetCurrency: string,
  logContext: string,
  rateMemo?: Map<string, Record<string, string> | null>,
): Promise<SpendingResult> {
  let total = new Big('0');
  const nativeByCcy: Record<string, Big> = {};
  const unconvertibleCurrencies = new Set<string>();

  for (const tx of txRows) {
    const txAmount = dec(tx.amount_in_account_ccy);
    const txCurrency = tx.account_currency;
    const ccyKey = txCurrency.toLowerCase();
    nativeByCcy[ccyKey] = (nativeByCcy[ccyKey] ?? new Big('0')).plus(txAmount);

    if (ccyKey === targetCurrency.toLowerCase()) {
      total = total.plus(txAmount);
      continue;
    }

    const rates = await getRatesForDate(tx.date, rateMemo);
    const converted = tryConvert(txAmount, txCurrency, targetCurrency, rates);
    if (converted === null) {
      unconvertibleCurrencies.add(ccyKey);
      continue;
    }
    total = total.plus(converted);
  }

  if (unconvertibleCurrencies.size > 0) {
    console.warn(
      `[budget] ${logContext} skipped ${[...unconvertibleCurrencies].join(
        ', ',
      )} rows (no FX rate).`,
    );
  }

  const perCurrency: Record<string, string> = {};
  for (const [ccy, sum] of Object.entries(nativeByCcy)) {
    perCurrency[ccy] = qCent(sum).toFixed(2);
  }

  return {
    total: qCent(total).toFixed(2),
    perCurrency,
    unconvertibleCurrencies: [...unconvertibleCurrencies].sort(),
  };
}

export async function calculatePeriodSpending(
  periodId: string,
  rateMemo?: Map<string, Record<string, string> | null>,
): Promise<SpendingResult> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();

  // Get the period to know date range and target currency
  const periodRows = await db.select<BudgetPeriodRow[]>(
    'SELECT * FROM budget_periods WHERE id = ? AND koinkat_account_id = ?',
    [periodId, koinkatAccountId],
  );
  if (periodRows.length === 0) throw new Error('Period not found');
  const period = toBudgetPeriod(periodRows[0]);

  // Derive the month key for summed-event lookups. Period rows are
  // always aligned on calendar boundaries (monthly rhythms start on the
  // 1st; weekly/yearly rhythms share the same slice granularity - we
  // still use the period's start month, and only fold events whose
  // sum_to_month matches it).
  const periodMonth = period.periodStart.slice(0, 7) + '-01';

  // Find active events whose limits + transactions fold into this month.
  const summedEventRows = await db.select<{ id: string }[]>(
    `SELECT id FROM budget_events
      WHERE koinkat_account_id = ?
        AND sum_to_budget = 1
        AND sum_to_month = ?
        AND is_expired = 0`,
    [koinkatAccountId, periodMonth],
  );
  const summedEventIds = summedEventRows.map((r) => r.id);

  // Query 1: regular budgeted expenses NOT linked to any event,
  // in the period's date range.
  //
  // Split-expense handling (Feature 1):
  //   - COALESCE(net_spent_in_account_ccy, amount_in_account_ccy): split
  //     parents contribute only the user's net share (gross − repayments);
  //     all other rows contribute their gross as before.
  //   - relation_kind filter: exclude repayment rows. (Already excluded
  //     implicitly by type='expense' since repayments are income, but
  //     kept for defense-in-depth.)
  const regularRows = await db.select<SpendingTxRow[]>(
    `SELECT ${TX_NET_AMOUNT_AS},
            t.date, a.currency AS account_currency
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
      WHERE t.koinkat_account_id = ?
        AND t.is_budgeted = 1
        AND t.type = 'expense'
        AND t.budget_event_id IS NULL
        AND t.transfer_pair_id IS NULL
        AND ${TX_EXCLUDE_REPAYMENT}
        AND ${TX_BOOKED_ONLY}
        AND t.date >= ?
        AND t.date <= ?`,
    [koinkatAccountId, period.periodStart, period.periodEnd],
  );

  // Query 2: expense transactions linked to any summed-into-this-month
  // event. No date filter - ALL transactions for the event count toward
  // the chosen month's spending regardless of when they occurred.
  // `is_budgeted = 1` still applies: spec §8 states that is_budgeted
  // exclusively controls recurring-budget inclusion, so a linked txn
  // with is_budgeted=0 should NOT count toward the monthly budget even
  // though it still counts toward the event's own spending.
  let eventRows: SpendingTxRow[] = [];
  if (summedEventIds.length > 0) {
    const placeholders = summedEventIds.map(() => '?').join(',');
    eventRows = await db.select<SpendingTxRow[]>(
      `SELECT ${TX_NET_AMOUNT_AS},
              t.date, a.currency AS account_currency
         FROM transactions t
         JOIN accounts a ON a.id = t.account_id
        WHERE t.koinkat_account_id = ?
          AND t.is_budgeted = 1
          AND t.type = 'expense'
          AND t.transfer_pair_id IS NULL
          AND ${TX_EXCLUDE_REPAYMENT}
          AND ${TX_BOOKED_ONLY}
          AND t.budget_event_id IN (${placeholders})`,
      [koinkatAccountId, ...summedEventIds],
    );
  }

  const txRows: SpendingTxRow[] = [...regularRows, ...eventRows];

  return sumSpendingRows(
    txRows,
    period.currency,
    `calculatePeriodSpending for period ${periodId}`,
    rateMemo,
  );
}

/**
 * Full summary of a period's spending AND its effective limit,
 * including any contributions from budget events that have been summed
 * into this month via `sum_to_budget = 1 AND sum_to_month = <this
 * month>`. Computed at query time; never stored.
 */
export interface PeriodSpendingSummary {
  periodId: string;
  periodStart: string;
  periodEnd: string;
  /** The period's own `limit_amount` (untouched by events). */
  baseLimit: string;
  /**
   * Sum of summed events' limits converted into the period's currency.
   * `"0.00"` when no events are summed into this month.
   */
  eventContribution: string;
  /** `baseLimit + eventContribution`. */
  effectiveLimit: string;
  /** Total spending in the period's currency (cross-currency converted). */
  totalSpent: string;
  /** `effectiveLimit - totalSpent`. Can be negative. */
  remaining: string;
  /**
   * `(totalSpent / effectiveLimit) * 100`. Zero when effectiveLimit is
   * zero (defensive against divide-by-zero in placeholder periods).
   */
  percentUsed: number;
  isCustomized: boolean;
  notes: string | null;
  spentPerCurrency: Record<string, string>;
  /**
   * Currencies whose rate was missing when we tried to convert either
   * a transaction or a summed event's limit into the period currency.
   */
  unconvertibleCurrencies: string[];
}

export interface PeriodWithSpending extends BudgetPeriod {
  spent: string;
  remaining: string;
  percentage: number;
  /**
   * Native-currency breakdown of the spending inside this period -
   * keyed by lowercase currency code. Populated from
   * `calculatePeriodSpending().perCurrency`.
   */
  spentPerCurrency: Record<string, string>;
  /** Period's own limit, untouched by summed-event contributions. */
  baseLimit: string;
  /** Sum of summed events' limits in the period's currency. */
  eventContribution: string;
  /** `baseLimit + eventContribution`. UI displays this as "Eff. Limit". */
  effectiveLimit: string;
  /** Currencies whose rate was missing during conversion (txns or events). */
  unconvertibleCurrencies: string[];
}

/**
 * Calculates the full spending + effective-limit summary for a single
 * period. Extends `calculatePeriodSpending` by additionally resolving
 * the event contribution and the derived fields (effectiveLimit,
 * remaining, percentUsed).
 */
export async function calculatePeriodSummary(
  periodId: string,
  rateMemo?: Map<string, Record<string, string> | null>,
): Promise<PeriodSpendingSummary> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();

  const periodRows = await db.select<BudgetPeriodRow[]>(
    'SELECT * FROM budget_periods WHERE id = ? AND koinkat_account_id = ?',
    [periodId, koinkatAccountId],
  );
  if (periodRows.length === 0) throw new Error('Period not found');
  const period = toBudgetPeriod(periodRows[0]);

  // Underlying spending (already includes summed-event transactions
  // thanks to calculatePeriodSpending's rewrite).
  const spending = await calculatePeriodSpending(periodId, rateMemo);

  // Resolve the period's calendar month - the key used to fold summed
  // events into this period.
  const periodMonth = period.periodStart.slice(0, 7) + '-01';
  const summedEvents = await db.select<
    { id: string; limit_amount: string; currency: string }[]
  >(
    `SELECT id, limit_amount, currency
       FROM budget_events
      WHERE koinkat_account_id = ?
        AND sum_to_budget = 1
        AND sum_to_month = ?
        AND is_expired = 0`,
    [koinkatAccountId, periodMonth],
  );

  // Convert each event's limit to the period's currency. Events whose
  // FX rate is missing get added to `unconvertibleCurrencies` and
  // contribute 0 - the UI will warn the user via the existing banner.
  const unconvertible = new Set<string>(spending.unconvertibleCurrencies);
  let eventContribution = new Big('0');
  // The period start is a reasonable "as-of" for converting event
  // limits - it matches the date the user is comparing against when
  // reading the period's Effective Limit column.
  const rates = summedEvents.length > 0
    ? await getRatesForDate(period.periodStart, rateMemo)
    : null;
  for (const ev of summedEvents) {
    const evLimit = dec(ev.limit_amount);
    if (ev.currency.toUpperCase() === period.currency.toUpperCase()) {
      eventContribution = eventContribution.plus(evLimit);
      continue;
    }
    const converted = tryConvert(
      evLimit,
      ev.currency,
      period.currency,
      rates,
    );
    if (converted === null) {
      unconvertible.add(ev.currency.toLowerCase());
      continue;
    }
    eventContribution = eventContribution.plus(converted);
  }
  const eventContributionStr = qCent(eventContribution).toFixed(2);

  const baseLimit = period.limitAmount;
  const effectiveLimitBig = qCent(dec(baseLimit).plus(dec(eventContributionStr)));
  const effectiveLimit = effectiveLimitBig.toFixed(2);
  const totalSpentBig = dec(spending.total);
  const remaining = qCent(effectiveLimitBig.minus(totalSpentBig)).toFixed(2);
  const percentUsed = effectiveLimitBig.gt(new Big('0'))
    ? parseFloat(
        totalSpentBig.div(effectiveLimitBig).times(new Big('100')).toFixed(2),
      )
    : 0;

  return {
    periodId: period.id,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    baseLimit,
    eventContribution: eventContributionStr,
    effectiveLimit,
    totalSpent: spending.total,
    remaining,
    percentUsed,
    isCustomized: period.isCustomized,
    notes: period.notes,
    spentPerCurrency: spending.perCurrency,
    unconvertibleCurrencies: [...unconvertible].sort(),
  };
}

export interface YearlyBudgetData {
  budget: RecurringBudget;
  periods: PeriodWithSpending[];
  totalSpent: string;
  totalLimit: string;
}

export async function getYearlyBudgetData(
  year: number,
): Promise<YearlyBudgetData | null> {
  const budget = await getBudgetForYear(year);
  if (!budget) return null;

  // Ensure periods exist
  await ensurePeriodsForYear(budget.id);

  const periods = await listPeriodsForBudget(budget.id);

  // One memo shared across all period summaries - FX lookups for a given
  // date are resolved once and reused across all periods in the same load.
  const rateMemo: Map<string, Record<string, string> | null> = new Map();

  const summaries = await Promise.all(
    periods.map((p) => calculatePeriodSummary(p.id, rateMemo)),
  );

  let totalSpent = new Big('0');
  let totalLimit = new Big('0');
  const periodsWithSpending: PeriodWithSpending[] = [];

  for (let i = 0; i < periods.length; i++) {
    const period = periods[i];
    const summary = summaries[i];

    totalSpent = totalSpent.plus(dec(summary.totalSpent));
    // Aggregate on effective limit so the annual totals reflect any
    // event contributions lifted into individual months.
    totalLimit = totalLimit.plus(dec(summary.effectiveLimit));

    periodsWithSpending.push({
      ...period,
      spent: summary.totalSpent,
      remaining: summary.remaining,
      percentage: summary.percentUsed,
      spentPerCurrency: summary.spentPerCurrency,
      baseLimit: summary.baseLimit,
      eventContribution: summary.eventContribution,
      effectiveLimit: summary.effectiveLimit,
      unconvertibleCurrencies: summary.unconvertibleCurrencies,
    });
  }

  return {
    budget,
    periods: periodsWithSpending,
    totalSpent: qCent(totalSpent).toFixed(2),
    totalLimit: qCent(totalLimit).toFixed(2),
  };
}

/**
 * Spending summary for a SINGLE month of the year's budget, plus the
 * budget currency. For callers that only show one month (the Dashboard's
 * "This month" card), this replaces `getYearlyBudgetData`, which computes
 * all 12 period summaries to answer a 1-period question.
 *
 * Returns null when no budget covers the year or the month has no period
 * (budget starts later / ends earlier in the year).
 */
export async function getBudgetPeriodForMonth(
  year: number,
  month: number,
): Promise<{ summary: PeriodSpendingSummary; currency: string } | null> {
  const budget = await getBudgetForYear(year);
  if (!budget) return null;
  await ensurePeriodsForYear(budget.id);

  const periods = await listPeriodsForBudget(budget.id);
  const monthKey = `${year}-${String(month).padStart(2, '0')}`;
  const period = periods.find((p) => p.periodStart.slice(0, 7) === monthKey);
  if (!period) return null;

  const summary = await calculatePeriodSummary(period.id);
  return { summary, currency: budget.currency };
}

/* ══════════════════════════════════════════════════════════════════════
   BUDGET EVENTS
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Normalizes + validates the four new optional event fields. Returns
 * the resolved final values that are safe to persist. Throws on
 * constraint violations ("both-or-neither" dates, `sum_to_budget` iff
 * `sum_to_month`, date order, sum_to_month format).
 *
 * `undefined` for any input means "keep the existing value" - callers
 * pass `existing.*` when updating and `null` when creating.
 */
function resolveEventExtras(input: {
  startDate: string | null | undefined;
  endDate: string | null | undefined;
  sumToBudget: boolean | undefined;
  sumToMonth: string | null | undefined;
  existingStartDate: string | null;
  existingEndDate: string | null;
  existingSumToBudget: boolean;
  existingSumToMonth: string | null;
}): {
  startDate: string | null;
  endDate: string | null;
  sumToBudget: boolean;
  sumToMonth: string | null;
} {
  // Resolve final date state. If startDate is explicitly set to null,
  // auto-clear endDate too (enforces "both-or-neither").
  let finalStart =
    input.startDate !== undefined ? input.startDate : input.existingStartDate;
  let finalEnd =
    input.endDate !== undefined ? input.endDate : input.existingEndDate;
  if (input.startDate === null) finalEnd = null;
  if (input.endDate === null && finalStart !== null && input.startDate === undefined) {
    // Caller cleared endDate but left startDate as-is → clear startDate
    // as well to honor "both-or-neither".
    finalStart = null;
  }

  if ((finalStart === null) !== (finalEnd === null)) {
    throw new Error('startDate and endDate must both be set or both be null');
  }
  if (finalStart !== null && finalEnd !== null && finalEnd < finalStart) {
    throw new Error('endDate must be on or after startDate');
  }

  // Resolve sum linkage.
  const finalSumToBudget =
    input.sumToBudget !== undefined ? input.sumToBudget : input.existingSumToBudget;
  let finalSumToMonth =
    input.sumToMonth !== undefined ? input.sumToMonth : input.existingSumToMonth;
  if (finalSumToBudget === false) finalSumToMonth = null;
  if (finalSumToBudget === true && !finalSumToMonth) {
    throw new Error('sumToMonth is required when sumToBudget is true');
  }
  if (finalSumToMonth && !/^\d{4}-\d{2}-01$/.test(finalSumToMonth)) {
    throw new Error('sumToMonth must be in YYYY-MM-01 format');
  }

  return {
    startDate: finalStart,
    endDate: finalEnd,
    sumToBudget: finalSumToBudget,
    sumToMonth: finalSumToMonth,
  };
}

export async function createBudgetEvent(params: {
  name: string;
  description?: string;
  limitAmount: string;
  currency: string;
  startDate?: string | null;
  endDate?: string | null;
  sumToBudget?: boolean;
  sumToMonth?: string | null;
  manualOnly?: boolean;
  autoCapture?: boolean;
}): Promise<BudgetEvent> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();

  const name = params.name.trim();
  if (!name) throw new Error('Event name is required');

  const limitAmount = qCent(dec(params.limitAmount)).toFixed(2);
  const currency = params.currency.toUpperCase();

  // Resolve the four new optional fields against a blank baseline
  // (there is no existing row yet). `undefined` for any input means
  // "use the defaults".
  const extras = resolveEventExtras({
    startDate: params.startDate,
    endDate: params.endDate,
    sumToBudget: params.sumToBudget,
    sumToMonth: params.sumToMonth,
    existingStartDate: null,
    existingEndDate: null,
    existingSumToBudget: false,
    existingSumToMonth: null,
  });

  const id = crypto.randomUUID();
  await db.execute(
    `INSERT INTO budget_events
       (id, koinkat_account_id, name, description, limit_amount, currency,
        is_expired, start_date, end_date, sum_to_budget, sum_to_month,
        manual_only, auto_capture)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      koinkatAccountId,
      name,
      params.description ?? null,
      limitAmount,
      currency,
      extras.startDate,
      extras.endDate,
      extras.sumToBudget ? 1 : 0,
      extras.sumToMonth,
      params.manualOnly ? 1 : 0,
      params.autoCapture ? 1 : 0,
    ],
  );

  // Auto-capture in-range expenses immediately. No-op when the event
  // isn't dated, isn't auto_capture, or is expired. Wrapped so a
  // capture failure never blocks event creation.
  try {
    await applyAutoCaptureForEvent(id);
  } catch (err) {
    console.warn(
      `[budget] applyAutoCaptureForEvent failed for new event ${id}:`,
      err,
    );
  }

  const rows = await db.select<BudgetEventRow[]>(
    'SELECT * FROM budget_events WHERE id = ? AND koinkat_account_id = ?',
    [id, koinkatAccountId],
  );
  return toBudgetEvent(rows[0]);
}

export async function listBudgetEvents(): Promise<BudgetEvent[]> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const rows = await db.select<BudgetEventRow[]>(
    'SELECT * FROM budget_events WHERE koinkat_account_id = ? ORDER BY is_expired ASC, created_at DESC',
    [koinkatAccountId],
  );
  return rows.map(toBudgetEvent);
}

export async function updateBudgetEvent(
  id: string,
  params: {
    name?: string;
    description?: string | null;
    limitAmount?: string;
    currency?: string;
    startDate?: string | null;
    endDate?: string | null;
    sumToBudget?: boolean;
    sumToMonth?: string | null;
    isExpired?: boolean;
    manualOnly?: boolean;
    autoCapture?: boolean;
  },
): Promise<BudgetEvent> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();

  // Load the existing row so we can resolve partial updates while
  // enforcing cross-field invariants.
  const existingRows = await db.select<BudgetEventRow[]>(
    'SELECT * FROM budget_events WHERE id = ? AND koinkat_account_id = ?',
    [id, koinkatAccountId],
  );
  if (existingRows.length === 0) throw new Error('Event not found');
  const existing = toBudgetEvent(existingRows[0]);

  const extras = resolveEventExtras({
    startDate: params.startDate,
    endDate: params.endDate,
    sumToBudget: params.sumToBudget,
    sumToMonth: params.sumToMonth,
    existingStartDate: existing.startDate,
    existingEndDate: existing.endDate,
    existingSumToBudget: existing.sumToBudget,
    existingSumToMonth: existing.sumToMonth,
  });

  // Fragments are hardcoded literals only - never interpolate user input into a clause string; bind values via '?'.
  const setClauses: string[] = [];
  const values: unknown[] = [];

  if (params.name !== undefined) {
    const name = params.name.trim();
    if (!name) throw new Error('Event name is required');
    setClauses.push('name = ?');
    values.push(name);
  }
  if (params.description !== undefined) {
    setClauses.push('description = ?');
    values.push(params.description);
  }
  if (params.limitAmount !== undefined) {
    const limitAmount = qCent(dec(params.limitAmount)).toFixed(2);
    setClauses.push('limit_amount = ?');
    values.push(limitAmount);
  }
  if (params.currency !== undefined) {
    setClauses.push('currency = ?');
    values.push(params.currency.toUpperCase());
  }
  if (params.isExpired !== undefined) {
    setClauses.push('is_expired = ?');
    values.push(params.isExpired ? 1 : 0);
  }
  if (params.manualOnly !== undefined) {
    setClauses.push('manual_only = ?');
    values.push(params.manualOnly ? 1 : 0);
  }
  if (params.autoCapture !== undefined) {
    setClauses.push('auto_capture = ?');
    values.push(params.autoCapture ? 1 : 0);
  }

  // Always flush the four extras fields if ANY of them was provided, so
  // resolveEventExtras' cross-field corrections (e.g. auto-clearing
  // endDate when startDate is nulled, or nulling sumToMonth when
  // sumToBudget is set to false) actually reach the DB.
  const extrasTouched =
    params.startDate !== undefined ||
    params.endDate !== undefined ||
    params.sumToBudget !== undefined ||
    params.sumToMonth !== undefined;
  if (extrasTouched) {
    setClauses.push('start_date = ?');
    values.push(extras.startDate);
    setClauses.push('end_date = ?');
    values.push(extras.endDate);
    setClauses.push('sum_to_budget = ?');
    values.push(extras.sumToBudget ? 1 : 0);
    setClauses.push('sum_to_month = ?');
    values.push(extras.sumToMonth);
  }

  if (setClauses.length === 0) {
    return existing;
  }

  setClauses.push("updated_at = datetime('now')");
  values.push(id, koinkatAccountId);

  await db.execute(
    `UPDATE budget_events SET ${setClauses.join(', ')} WHERE id = ? AND koinkat_account_id = ?`,
    values,
  );

  // Re-run auto-capture whenever something that affects which
  // transactions should be linked changed: dates moved (range widened
  // or shrank), auto_capture was toggled, or the event was expired/
  // reactivated. No-op if the event is no longer eligible.
  const capRelevantChanged =
    params.startDate !== undefined ||
    params.endDate !== undefined ||
    params.autoCapture !== undefined ||
    params.isExpired !== undefined;
  if (capRelevantChanged) {
    try {
      await applyAutoCaptureForEvent(id);
    } catch (err) {
      console.warn(
        `[budget] applyAutoCaptureForEvent failed for updated event ${id}:`,
        err,
      );
    }
  }

  const rows = await db.select<BudgetEventRow[]>(
    'SELECT * FROM budget_events WHERE id = ? AND koinkat_account_id = ?',
    [id, koinkatAccountId],
  );
  if (rows.length === 0) throw new Error('Event not found');
  return toBudgetEvent(rows[0]);
}

/**
 * Reactivates an expired budget event. Flips `is_expired` to 0 and
 * leaves the sum-to-budget linkage cleared (matching the v1 decision:
 * expiring an event severs its recurring-budget linkage, and
 * reactivation does not restore it - user must re-pick a target month
 * manually if desired).
 */
export async function reactivateBudgetEvent(id: string): Promise<BudgetEvent> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  await db.execute(
    `UPDATE budget_events
        SET is_expired = 0,
            updated_at = datetime('now')
      WHERE id = ? AND koinkat_account_id = ?`,
    [id, koinkatAccountId],
  );
  const rows = await db.select<BudgetEventRow[]>(
    'SELECT * FROM budget_events WHERE id = ? AND koinkat_account_id = ?',
    [id, koinkatAccountId],
  );
  if (rows.length === 0) throw new Error('Event not found');
  return toBudgetEvent(rows[0]);
}

export async function markEventExpired(id: string): Promise<BudgetEvent> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  // Expiring an event also severs its link to the monthly budget - the
  // event should no longer contribute its limit or roll its transactions
  // into a recurring-budget period. Users can reactivate + re-link it
  // manually if desired. Spec §8 "Simplest v1" recommendation.
  await db.execute(
    `UPDATE budget_events
        SET is_expired = 1,
            sum_to_budget = 0,
            sum_to_month = NULL,
            updated_at = datetime('now')
      WHERE id = ? AND koinkat_account_id = ?`,
    [id, koinkatAccountId],
  );

  const rows = await db.select<BudgetEventRow[]>(
    'SELECT * FROM budget_events WHERE id = ? AND koinkat_account_id = ?',
    [id, koinkatAccountId],
  );
  if (rows.length === 0) throw new Error('Event not found');
  return toBudgetEvent(rows[0]);
}

/**
 * Returns the list of active (non-expired) dated budget events whose
 * date range contains `date`. Used by the transaction form to pre-select
 * a matching event when the user picks a transaction date.
 *
 * Events flagged `manual_only = 1` are excluded regardless of their
 * date range - the user opted out of date-based auto-suggest for them
 * and must link transactions explicitly via the picker.
 *
 * Ordering: most specific event first. We approximate "specific" as
 * "shortest date range" - if two events cover the same day, the one
 * with the tighter window is preferred. Ties broken by creation time
 * (newest first).
 *
 * Returns an empty array when no dated events match. Undated events
 * (where start_date / end_date are NULL) are never returned.
 *
 * @param date ISO date string YYYY-MM-DD
 */
export async function getMatchingEventsForDate(
  date: string,
): Promise<BudgetEvent[]> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const rows = await db.select<BudgetEventRow[]>(
    `SELECT * FROM budget_events
      WHERE koinkat_account_id = ?
        AND is_expired = 0
        AND manual_only = 0
        AND start_date IS NOT NULL
        AND end_date IS NOT NULL
        AND start_date <= ?
        AND end_date >= ?
      ORDER BY (julianday(end_date) - julianday(start_date)) ASC,
               created_at DESC`,
    [koinkatAccountId, date, date],
  );
  return rows.map(toBudgetEvent);
}

export async function deleteBudgetEvent(id: string): Promise<boolean> {
  const koinkatAccountId = requireActiveKoinkatAccountId();

  // Atomic: failing between unlink and delete would strand transactions
  // unlinked from an event that still exists.
  return withTransaction(async (tx) => {
    // Unlink transactions referencing this event (within this profile)
    await tx.execute(
      'UPDATE transactions SET budget_event_id = NULL WHERE koinkat_account_id = ? AND budget_event_id = ?',
      [koinkatAccountId, id],
    );

    const result = await tx.execute(
      'DELETE FROM budget_events WHERE id = ? AND koinkat_account_id = ?',
      [id, koinkatAccountId],
    );
    return result.rowsAffected > 0;
  });
}

export async function calculateEventSpending(
  eventId: string,
): Promise<SpendingResult> {
  // Delegates to the batch form so the single-event and batch paths can
  // never drift apart (same SQL fragments, same FX handling).
  const results = await calculateEventSpendingBatch([eventId]);
  const result = results[eventId];
  if (!result) throw new Error('Event not found');
  return result;
}

/**
 * Batch form of `calculateEventSpending`: one grouped query for ALL the
 * given events instead of two queries per event (the Budgets page used to
 * fan out N per-event calls on every load). FX lookups share one memo, so
 * each rate date is resolved once across the whole batch.
 *
 * Returns a map keyed by event id; events with no linked spending map to
 * a zero result. Unknown/foreign ids are simply absent.
 */
export async function calculateEventSpendingBatch(
  eventIds: string[],
): Promise<Record<string, SpendingResult>> {
  const out: Record<string, SpendingResult> = {};
  if (eventIds.length === 0) return out;

  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const placeholders = eventIds.map(() => '?').join(', ');

  const eventRows = await db.select<BudgetEventRow[]>(
    `SELECT * FROM budget_events
      WHERE koinkat_account_id = ? AND id IN (${placeholders})`,
    [koinkatAccountId, ...eventIds],
  );
  if (eventRows.length === 0) return out;
  const events = eventRows.map(toBudgetEvent);

  const txRows = await db.select<(SpendingTxRow & { budget_event_id: string })[]>(
    `SELECT ${TX_NET_AMOUNT_AS},
            t.date, a.currency AS account_currency, t.budget_event_id
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
      WHERE t.koinkat_account_id = ?
        AND t.budget_event_id IN (${placeholders})
        AND t.type = 'expense'
        AND t.transfer_pair_id IS NULL
        AND ${TX_EXCLUDE_REPAYMENT}
        AND ${TX_BOOKED_ONLY}`,
    [koinkatAccountId, ...eventIds],
  );

  const byEvent = new Map<string, SpendingTxRow[]>();
  for (const row of txRows) {
    const bucket = byEvent.get(row.budget_event_id);
    if (bucket) bucket.push(row);
    else byEvent.set(row.budget_event_id, [row]);
  }

  const rateMemo: Map<string, Record<string, string> | null> = new Map();
  for (const event of events) {
    out[event.id] = await sumSpendingRows(
      byEvent.get(event.id) ?? [],
      event.currency,
      `calculateEventSpendingBatch for event ${event.id}`,
      rateMemo,
    );
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════
   AUTO-CAPTURE (Fix 3)
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Sweep all in-range expense transactions into the given event's
 * `budget_event_id`, and unlink any previously-linked transactions
 * that fall outside the current range. Skips:
 *   - transfers and split-pair rows (`transfer_pair_id IS NOT NULL`)
 *   - repayments (`relation_kind = 'repayment'`)
 *   - manually-pinned rows (`event_link_pinned = 1`), in both
 *     directions - pin always wins.
 *
 * Bails (returns 0/0) when the event is missing, expired, not dated,
 * or `auto_capture = 0`. Wrapped callers can invoke it unconditionally
 * after event create / update.
 *
 * Side note on math: a transaction linked to a `sum_to_budget = 1`
 * event whose `sum_to_month` matches a budgeted period contributes
 * via Query 2 of `calculatePeriodSpending`. Query 1 excludes any row
 * with a non-NULL `budget_event_id`, so each captured row is counted
 * exactly once.
 */
export async function applyAutoCaptureForEvent(
  eventId: string,
): Promise<{ linked: number; unlinked: number }> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();

  const eventRows = await db.select<BudgetEventRow[]>(
    'SELECT * FROM budget_events WHERE id = ? AND koinkat_account_id = ?',
    [eventId, koinkatAccountId],
  );
  if (eventRows.length === 0) return { linked: 0, unlinked: 0 };
  const event = toBudgetEvent(eventRows[0]);

  if (!event.autoCapture) return { linked: 0, unlinked: 0 };
  if (event.isExpired) return { linked: 0, unlinked: 0 };
  if (!event.startDate || !event.endDate) return { linked: 0, unlinked: 0 };

  // Atomic: a failure between the two sweeps would leave rows linked to
  // the event alongside stale captures that should have been released.
  return withTransaction(async (tx) => {
    // Link sweep: anything in range and currently unlinked (or pointing
    // at a different event without a pin) becomes ours.
    const linkRes = await tx.execute(
      `UPDATE transactions
          SET budget_event_id = ?,
              is_budgeted = 1,
              updated_at = datetime('now')
        WHERE koinkat_account_id = ?
          AND type = 'expense'
          AND transfer_pair_id IS NULL
          -- mirrors TX_EXCLUDE_REPAYMENT (tx-sql.ts); inlined un-aliased because
          -- this UPDATE has no t-table alias. Keep the two in sync.
          AND (relation_kind IS NULL OR relation_kind != 'repayment')
          AND date BETWEEN ? AND ?
          AND event_link_pinned = 0
          AND (budget_event_id IS NULL OR budget_event_id != ?)`,
      [eventId, koinkatAccountId, event.startDate, event.endDate, eventId],
    );

    // Unlink sweep: rows currently pointing at this event but no longer
    // in range (because the event's dates moved) drop their link. We
    // never touch is_budgeted here - that was set by the user.
    const unlinkRes = await tx.execute(
      `UPDATE transactions
          SET budget_event_id = NULL,
              updated_at = datetime('now')
        WHERE koinkat_account_id = ?
          AND budget_event_id = ?
          AND event_link_pinned = 0
          AND (date < ? OR date > ?)`,
      [koinkatAccountId, eventId, event.startDate, event.endDate],
    );

    return {
      linked: linkRes.rowsAffected ?? 0,
      unlinked: unlinkRes.rowsAffected ?? 0,
    };
  });
}

/**
 * Find a matching auto_capture event for a single transaction and link
 * the row to it. No-op if the transaction is pinned, is a transfer or
 * repayment, isn't an expense, already linked, or no event covers its
 * date.
 *
 * When multiple eligible events cover the date, picks the one with the
 * shortest range (most specific) - same tiebreaker as
 * `getMatchingEventsForDate`. Returns the linked event id, or null.
 */
export async function applyAutoCaptureForTransaction(
  txnId: string,
): Promise<string | null> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();

  const rows = await db.select<
    {
      id: string;
      type: string;
      date: string;
      transfer_pair_id: string | null;
      relation_kind: string | null;
      event_link_pinned: number;
      budget_event_id: string | null;
    }[]
  >(
    `SELECT id, type, date, transfer_pair_id, relation_kind,
            event_link_pinned, budget_event_id
       FROM transactions
      WHERE id = ? AND koinkat_account_id = ?`,
    [txnId, koinkatAccountId],
  );
  if (rows.length === 0) return null;
  const txn = rows[0];
  if (txn.event_link_pinned === 1) return null;
  if (txn.type !== 'expense') return null;
  if (txn.transfer_pair_id !== null) return null;
  if (txn.relation_kind === 'repayment') return null;
  if (txn.budget_event_id !== null) return null;

  const candidates = await db.select<{ id: string }[]>(
    `SELECT id FROM budget_events
      WHERE koinkat_account_id = ?
        AND auto_capture = 1
        AND is_expired = 0
        AND start_date IS NOT NULL
        AND end_date IS NOT NULL
        AND start_date <= ?
        AND end_date >= ?
      ORDER BY (julianday(end_date) - julianday(start_date)) ASC,
               created_at DESC
      LIMIT 1`,
    [koinkatAccountId, txn.date, txn.date],
  );
  if (candidates.length === 0) return null;
  const eventId = candidates[0].id;

  await db.execute(
    `UPDATE transactions
        SET budget_event_id = ?,
            is_budgeted = 1,
            updated_at = datetime('now')
      WHERE id = ? AND koinkat_account_id = ?`,
    [eventId, txnId, koinkatAccountId],
  );
  return eventId;
}
