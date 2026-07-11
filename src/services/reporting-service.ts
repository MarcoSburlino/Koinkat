import Big from 'big.js';
import { dec, qCent, tryConvert } from '../domain/money';
import {
  TX_BOOKED_ONLY,
  TX_EXCLUDE_REPAYMENT,
  TX_NET_AMOUNT_AS,
} from '../domain/tx-sql';
import { getLatestCachedRates } from './exchange-rate-service';
import { getDb } from '../db/database';
import { requireActiveKoinkatAccountId } from '../lib/active-koinkat-account';
import type { Account } from '../types/models';

/* ── Chart color fallbacks for white/default accounts ─────────────── */

const CHART_COLORS = [
  '#2563eb', '#16a34a', '#f59e0b', '#d946ef',
  '#e53935', '#06b6d4', '#7c3aed', '#38bdf8',
];

function isWhiteColor(hex: string | undefined): boolean {
  if (!hex) return true;
  const low = hex.toLowerCase().replace(/\s/g, '');
  return low === '#fff' || low === '#ffffff' || low === '#6b7280';
}

/* ── Types ────────────────────────────────────────────────────────── */

export interface DistributionEntry {
  label: string;
  amount: string;          // decimal string in preferred currency
  color: string;           // chart slice color
  dotColor: string;        // legend dot color (original account color)
  percentage: number;      // 0–100
}

/**
 * Per-account snapshot for UI lists. Always includes ALL accounts (even
 * zero-balance ones), unlike `distribution` which is filtered to positive
 * balances for charting.
 */
export interface AccountEntry {
  accountId: string;
  name: string;
  nativeAmount: string;       // currentBalance, in account's own currency
  nativeCurrency: string;
  convertedAmount: string;    // converted to preferred currency; '' if no rate
  convertedCurrency: string;  // = preferred currency
  /** Account's chosen color, with the same white-fallback the chart uses. */
  color: string;
  /** True when nativeCurrency !== convertedCurrency (cross-currency display). */
  isCrossCurrency: boolean;
  /**
   * True when a cross-currency balance could NOT be converted (no FX rate
   * cached). `convertedAmount` is '' in that case and this account is
   * excluded from `totalBalance` and `distribution`. UI must show a
   * "rate unavailable" affordance instead of a fabricated 1:1 value.
   */
  conversionFailed: boolean;
}

export interface AccountOverview {
  totalBalance: string;    // decimal string in preferred currency
  currency: string;        // preferred currency code
  distribution: DistributionEntry[];
  entries: AccountEntry[]; // all accounts (manual + linked), in input order
  perCurrency: Record<string, string>;  // e.g. { EUR: '1234.56', USD: '500.00' }
  /**
   * Currencies (lowercase) whose rate was missing when this overview was
   * built. Any balance in these currencies is NOT reflected in
   * `totalBalance` or `distribution` - the aggregation skipped them to
   * avoid silently corrupting the total. Empty when every conversion
   * succeeded. UI can use this to render a "some amounts couldn't be
   * converted" warning.
   */
  unconvertibleCurrencies: string[];
}

/* ── Service ──────────────────────────────────────────────────────── */

export async function buildAccountOverview(
  accounts: Account[],
  preferredCurrency: string,
): Promise<AccountOverview> {
  const rates = await getLatestCachedRates();

  let total = new Big('0');
  const perCurrency: Record<string, Big> = {};
  const distRows: {
    label: string;
    converted: Big;
    chartColor: string;
    dotColor: string;
  }[] = [];
  const entries: AccountEntry[] = [];
  const unconvertibleCurrencies = new Set<string>();

  let fallbackIdx = 0;

  for (const acct of accounts) {
    const balance = dec(acct.currentBalance);

    // Per-currency totals (original currencies, no conversion)
    if (!perCurrency[acct.currency]) perCurrency[acct.currency] = new Big('0');
    perCurrency[acct.currency] = perCurrency[acct.currency].plus(balance);

    // Convert to preferred currency via the rate cache. When the rate
    // is missing, `tryConvert` returns null and we SKIP this balance in
    // the total - adding the raw foreign amount would inflate the total.
    const isCrossCurrency =
      acct.currency.toLowerCase() !== preferredCurrency.toLowerCase();
    const convertedOrNull = tryConvert(
      balance,
      acct.currency,
      preferredCurrency,
      rates,
    );
    if (convertedOrNull === null) {
      console.warn(
        `[reporting] No FX rate available to convert ${acct.currency}→${preferredCurrency}; balance of account "${acct.name}" excluded from total.`,
      );
      unconvertibleCurrencies.add(acct.currency.toLowerCase());
    } else {
      total = total.plus(convertedOrNull);
    }
    // A cross-currency balance with no rate can't be honestly converted.
    // Leave `convertedAmount` empty and flag it; the UI renders a clear
    // "rate unavailable" affordance rather than a fabricated 1:1 value
    // (which previously made e.g. 214 DKK look like 214 EUR).
    const conversionFailed = convertedOrNull === null && isCrossCurrency;

    // Resolve a sensible color for this account (user color, with palette
    // fallback for white/default colors). Used by both the chart and the
    // per-account entries list.
    const accountColor = acct.color || '';
    let resolvedColor = accountColor;
    if (isWhiteColor(accountColor)) {
      resolvedColor = CHART_COLORS[fallbackIdx % CHART_COLORS.length];
      fallbackIdx++;
    }

    entries.push({
      accountId: acct.id,
      name: acct.name,
      nativeAmount: qCent(balance).toFixed(2),
      nativeCurrency: acct.currency,
      convertedAmount: convertedOrNull ? qCent(convertedOrNull).toFixed(2) : '',
      convertedCurrency: preferredCurrency,
      color: resolvedColor,
      isCrossCurrency,
      conversionFailed,
    });

    // Only positive balances that converted successfully go into the
    // distribution chart - unconverted rows would skew the percentages.
    if (convertedOrNull !== null && convertedOrNull.gt(new Big('0'))) {
      distRows.push({
        label: `${acct.name} (${acct.currency})`,
        converted: convertedOrNull,
        chartColor: resolvedColor,
        dotColor: resolvedColor,
      });
    }
  }

  // Compute percentages
  const distTotal = distRows.reduce((sum, r) => sum.plus(r.converted), new Big('0'));
  const distribution: DistributionEntry[] = distRows.map((row) => ({
    label: row.label,
    amount: qCent(row.converted).toFixed(2),
    color: row.chartColor,
    dotColor: row.dotColor,
    percentage: distTotal.gt(new Big('0'))
      ? parseFloat(row.converted.div(distTotal).times(new Big('100')).toFixed(2))
      : 0,
  }));

  // Build per-currency map as plain strings
  const perCurrencyStr: Record<string, string> = {};
  for (const [ccy, val] of Object.entries(perCurrency)) {
    perCurrencyStr[ccy] = qCent(val).toFixed(2);
  }

  return {
    totalBalance: qCent(total).toFixed(2),
    currency: preferredCurrency,
    distribution,
    entries,
    perCurrency: perCurrencyStr,
    unconvertibleCurrencies: [...unconvertibleCurrencies].sort(),
  };
}

/* ── Category Breakdown (Analysis page) ──────────────────────────── */

export interface CategoryBreakdownRow {
  /**
   * The macro category id (parent), or null for the "Uncategorized"
   * synthetic row. Subcategory amounts are rolled up into their parent
   * macro, so the UI surfaces one row per macro and drills into the
   * subcategory split on expand.
   */
  macroId: string | null;
  macroName: string;
  macroIcon: string | null;
  amount: string;
  count: number;
  percentage: number;
  /**
   * Distinct source currencies (lowercase, sorted) that contributed to
   * this row's aggregate. When length > 1, the UI can surface a
   * "across EUR, DKK" note so the user knows the aggregate is composed
   * of multiple currencies - otherwise the single-currency case stays
   * visually quiet.
   */
  currencies: string[];
}

/**
 * Return distinct years that contain income/expense transactions.
 * Falls back to the current year when the table is empty.
 */
export async function availableYears(): Promise<number[]> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const rows = await db.select<{ year: string }[]>(
    "SELECT DISTINCT substr(date, 1, 4) as year FROM transactions WHERE koinkat_account_id = ? AND type IN ('income', 'expense') ORDER BY year DESC",
    [koinkatAccountId],
  );
  const years = rows.map((r) => parseInt(r.year, 10)).filter((y) => !isNaN(y));
  if (years.length === 0) years.push(new Date().getFullYear());
  return years;
}

const UNCATEGORIZED_KEY = '__uncategorized__';

/**
 * Aggregate transactions by macro category for a given year (optionally
 * filtered by month and type). Subcategory amounts are rolled up into
 * their parent macro. Amounts are converted to the preferred currency.
 */
export async function categoryBreakdown(params: {
  /** Optional year filter (`substr(date,1,4)`). Omit when scoping by event. */
  year?: number;
  month?: number;
  type?: 'income' | 'expense';
  /** Scope to a single budget event's transactions (`budget_event_id`). */
  budgetEventId?: string;
  preferredCurrency: string;
}): Promise<{
  rows: CategoryBreakdownRow[];
  total: string;
  count: number;
  unconvertibleCurrencies: string[];
}> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();

  // Build WHERE clause - always scope by koinkat account, exclude rows
  // that are part of a confirmed transfer pair (transfer_pair_id set).
  const conditions: string[] = [
    't.koinkat_account_id = ?',
    't.transfer_pair_id IS NULL',
    // Split-expense handling (Feature 1): exclude repayment rows so they
    // don't bucket into a synthetic income category of their own.
    TX_EXCLUDE_REPAYMENT,
    // Exclude bank-pending rows from all aggregations until they book.
    TX_BOOKED_ONLY,
  ];
  const values: unknown[] = [koinkatAccountId];

  if (params.year !== undefined) {
    conditions.push('substr(t.date, 1, 4) = ?');
    values.push(String(params.year));
  }

  if (params.month !== undefined && params.month >= 1 && params.month <= 12) {
    conditions.push("substr(t.date, 6, 2) = ?");
    values.push(String(params.month).padStart(2, '0'));
  }

  if (params.budgetEventId) {
    conditions.push('t.budget_event_id = ?');
    values.push(params.budgetEventId);
  }

  if (params.type) {
    conditions.push('t.type = ?');
    values.push(params.type);
  } else {
    conditions.push("t.type IN ('income', 'expense')");
  }

  const whereClause = conditions.join(' AND ');

  // Join the category twice: `c` is the transaction's direct category
  // (which may be a macro OR a subcategory), and `pc` is its parent
  // when `c` is a subcategory. The macro is `COALESCE(c.parent_id, c.id)`
  // and the macro's display name comes from `pc.name` when the txn sits
  // on a subcategory, else `c.name`.
  const rows = await db.select<
    {
      amount_in_account_ccy: string;
      category_id: string | null;
      macro_id: string | null;
      macro_name: string | null;
      macro_icon: string | null;
      account_currency: string;
    }[]
  >(
    // Split-expense: use the user's net share on split parents.
    `SELECT
       ${TX_NET_AMOUNT_AS},
       t.category_id,
       COALESCE(c.parent_id, c.id) AS macro_id,
       COALESCE(pc.name, c.name)   AS macro_name,
       COALESCE(pc.icon, c.icon)   AS macro_icon,
       a.currency AS account_currency
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     LEFT JOIN categories pc ON pc.id = c.parent_id
     JOIN accounts a ON a.id = t.account_id
     WHERE ${whereClause}`,
    values,
  );

  // Get exchange rates for currency conversion
  const rates = await getLatestCachedRates();

  // Aggregate by macro id. Uncategorized rows (category_id IS NULL)
  // bucket under a synthetic key so they still show up in the breakdown.
  const grouped = new Map<
    string,
    {
      macroId: string | null;
      macroName: string;
      macroIcon: string | null;
      total: Big;
      count: number;
      currencies: Set<string>;
    }
  >();
  const unconvertibleCurrencies = new Set<string>();

  for (const row of rows) {
    const macroId = row.macro_id;
    const key = macroId ?? UNCATEGORIZED_KEY;
    const macroName = row.macro_name ?? 'Uncategorized';
    const macroIcon = row.macro_icon ?? null;
    const amount = dec(row.amount_in_account_ccy).abs();
    const srcCcy = row.account_currency.toLowerCase();

    // Convert to preferred currency. SKIP rows whose rate is missing -
    // silently adding the raw foreign amount would inflate the total.
    const converted = tryConvert(
      amount,
      row.account_currency,
      params.preferredCurrency,
      rates,
    );
    if (converted === null) {
      unconvertibleCurrencies.add(srcCcy);
      console.warn(
        `[reporting] categoryBreakdown skipping ${row.account_currency}→${params.preferredCurrency} row for macro "${macroName}" (no rate).`,
      );
      continue;
    }

    const existing = grouped.get(key);
    if (existing) {
      existing.total = existing.total.plus(converted);
      existing.count += 1;
      existing.currencies.add(srcCcy);
    } else {
      grouped.set(key, {
        macroId,
        macroName,
        macroIcon,
        total: converted,
        count: 1,
        currencies: new Set([srcCcy]),
      });
    }
  }

  // Sort by amount descending. Sign-only comparator - no float extraction
  // from monetary Bigs (invariant #1).
  const sorted = [...grouped.entries()].sort((a, b) => {
    const diff = b[1].total.minus(a[1].total);
    return diff.gt(0) ? 1 : diff.lt(0) ? -1 : 0;
  });

  // Compute grand total
  const grandTotal = sorted.reduce(
    (sum, [, v]) => sum.plus(v.total),
    new Big('0'),
  );
  const totalCount = sorted.reduce((sum, [, v]) => sum + v.count, 0);

  // Build result rows with percentages
  const resultRows: CategoryBreakdownRow[] = sorted.map(([, v]) => ({
    macroId: v.macroId,
    macroName: v.macroName,
    macroIcon: v.macroIcon,
    amount: qCent(v.total).toFixed(2),
    count: v.count,
    percentage: grandTotal.gt(new Big('0'))
      ? parseFloat(v.total.div(grandTotal).times(new Big('100')).toFixed(2))
      : 0,
    currencies: [...v.currencies].sort(),
  }));

  return {
    rows: resultRows,
    total: qCent(grandTotal).toFixed(2),
    count: totalCount,
    unconvertibleCurrencies: [...unconvertibleCurrencies].sort(),
  };
}

/**
 * Sum expenses explicitly excluded from the monthly budget
 * (`is_budgeted = 0`) for a given scope, converted to the preferred
 * currency. Lets the Summary, Analysis, and Budget pages surface
 * off-budget spend (e.g. a one-off annual cost) as a single total.
 *
 * Mirrors categoryBreakdown's invariants: scoped by koinkat account,
 * excludes confirmed transfers and split repayments, and uses each split
 * parent's net share. Rows whose currency can't be converted to the
 * preferred currency are skipped and reported in `unconvertibleCurrencies`
 * rather than summed at face value.
 */
export async function sumNonBudgetedExpenses(params: {
  year: number;
  month?: number;
  accountId?: string;
  preferredCurrency: string;
}): Promise<{ total: string; count: number; unconvertibleCurrencies: string[] }> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();

  const conditions: string[] = [
    't.koinkat_account_id = ?',
    'substr(t.date, 1, 4) = ?',
    "t.type = 'expense'",
    't.is_budgeted = 0',
    't.transfer_pair_id IS NULL',
    TX_EXCLUDE_REPAYMENT,
    // Exclude bank-pending rows from all aggregations until they book.
    TX_BOOKED_ONLY,
  ];
  const values: unknown[] = [koinkatAccountId, String(params.year)];

  if (params.month !== undefined && params.month >= 1 && params.month <= 12) {
    conditions.push('substr(t.date, 6, 2) = ?');
    values.push(String(params.month).padStart(2, '0'));
  }
  if (params.accountId) {
    conditions.push('t.account_id = ?');
    values.push(params.accountId);
  }

  const rows = await db.select<
    { amount_in_account_ccy: string; account_currency: string }[]
  >(
    `SELECT
       ${TX_NET_AMOUNT_AS},
       a.currency AS account_currency
     FROM transactions t
     JOIN accounts a ON a.id = t.account_id
     WHERE ${conditions.join(' AND ')}`,
    values,
  );

  const rates = await getLatestCachedRates();
  const unconvertible = new Set<string>();
  let total = new Big('0');
  let count = 0;

  for (const row of rows) {
    const amount = dec(row.amount_in_account_ccy).abs();
    const converted = tryConvert(
      amount,
      row.account_currency,
      params.preferredCurrency,
      rates,
    );
    if (converted === null) {
      unconvertible.add(row.account_currency.toLowerCase());
      continue;
    }
    total = total.plus(converted);
    count += 1;
  }

  return {
    total: qCent(total).toFixed(2),
    count,
    unconvertibleCurrencies: [...unconvertible].sort(),
  };
}

/* ── Monthly Cashflow (Summary page) ─────────────────────────────── */

export interface MonthlyCashflowRow {
  month: number;
  income: string;
  expense: string;
}

export interface MonthlyCashflowResult {
  rows: MonthlyCashflowRow[];
  /**
   * Distinct source currencies (lowercase, sorted) that contributed any
   * income or expense to this year's aggregate. Used by the Summary page
   * to surface a "across EUR, DKK" note when the workspace is mixed.
   */
  contributingCurrencies: string[];
  /**
   * Currencies (lowercase) whose rate was missing when aggregating.
   * Any income/expense in these currencies is NOT reflected in the
   * returned row totals - the aggregation skipped them to avoid
   * silently corrupting the monthly sums.
   */
  unconvertibleCurrencies: string[];
}

/**
 * Query all income/expense transactions for a year, grouped by month.
 * Amounts are converted from account currency to targetCurrency.
 * Returns 12 rows (one per month); months with no data have "0.00".
 * Also reports the distinct source currencies that contributed.
 */
export async function monthlyCashflow(params: {
  year: number;
  accountId?: string;
  targetCurrency: string;
}): Promise<MonthlyCashflowResult> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();

  // Build WHERE clause - always scope by koinkat account, exclude rows
  // that are part of a confirmed transfer pair (transfer_pair_id set).
  const conditions: string[] = [
    't.koinkat_account_id = ?',
    'substr(t.date, 1, 4) = ?',
    "t.type IN ('income', 'expense')",
    't.transfer_pair_id IS NULL',
    // Split-expense: exclude repayment rows so they don't inflate monthly income.
    TX_EXCLUDE_REPAYMENT,
    // Exclude bank-pending rows from all aggregations until they book.
    TX_BOOKED_ONLY,
  ];
  const values: unknown[] = [koinkatAccountId, String(params.year)];

  if (params.accountId) {
    conditions.push('t.account_id = ?');
    values.push(params.accountId);
  }

  const whereClause = conditions.join(' AND ');

  const rows = await db.select<
    {
      month: string;
      type: string;
      amount_in_account_ccy: string;
      account_currency: string;
    }[]
  >(
    // Split-expense: use the user's net share on split parents.
    `SELECT substr(t.date, 6, 2) as month,
            t.type,
            ${TX_NET_AMOUNT_AS},
            a.currency as account_currency
     FROM transactions t
     JOIN accounts a ON t.account_id = a.id
     WHERE ${whereClause}`,
    values,
  );

  // Get exchange rates for currency conversion
  const rates = await getLatestCachedRates();

  // Aggregate by month + collect contributing currencies for the year.
  const incomeByMonth: Record<number, Big> = {};
  const expenseByMonth: Record<number, Big> = {};
  const contributingCurrencies = new Set<string>();
  const unconvertibleCurrencies = new Set<string>();

  for (const row of rows) {
    const m = parseInt(row.month, 10);
    if (isNaN(m) || m < 1 || m > 12) continue;

    const amount = dec(row.amount_in_account_ccy).abs();
    const srcCcy = row.account_currency.toLowerCase();
    contributingCurrencies.add(srcCcy);

    // Convert to target currency. SKIP rows whose rate is missing -
    // the else-branch used to silently add the raw foreign amount as if
    // it were already in the target currency, which inflated the
    // monthly sums by a factor of the exchange rate.
    const converted = tryConvert(
      amount,
      row.account_currency,
      params.targetCurrency,
      rates,
    );
    if (converted === null) {
      unconvertibleCurrencies.add(srcCcy);
      continue;
    }

    if (row.type === 'income') {
      incomeByMonth[m] = (incomeByMonth[m] ?? new Big('0')).plus(converted);
    } else {
      expenseByMonth[m] = (expenseByMonth[m] ?? new Big('0')).plus(converted);
    }
  }

  if (unconvertibleCurrencies.size > 0) {
    console.warn(
      `[reporting] monthlyCashflow skipped rows in these currencies due to missing FX rates: ${[
        ...unconvertibleCurrencies,
      ].join(', ')}.`,
    );
  }

  // Build 12 rows
  const cashflowRows: MonthlyCashflowRow[] = [];
  for (let m = 1; m <= 12; m++) {
    cashflowRows.push({
      month: m,
      income: qCent(incomeByMonth[m] ?? new Big('0')).toFixed(2),
      expense: qCent(expenseByMonth[m] ?? new Big('0')).toFixed(2),
    });
  }

  return {
    rows: cashflowRows,
    contributingCurrencies: [...contributingCurrencies].sort(),
    unconvertibleCurrencies: [...unconvertibleCurrencies].sort(),
  };
}

/* ── Yearly Summary (Summary page) ───────────────────────────────── */

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface SummaryRow {
  month: number;
  label: string;
  income: string;
  expense: string;
  profit: string;
  balance: string;
  changePct: number | null;
}

export interface YearlySummaryData {
  rows: SummaryRow[];
  totals: {
    income: string;
    expense: string;
    profit: string;
    startingBalance: string;
    currentBalance: string;
    /**
     * Distinct source currencies (lowercase, sorted) that contributed any
     * income or expense in this year. When length > 1, the Summary page
     * surfaces a "aggregated across EUR, DKK" meta note under the totals
     * so the user knows the number is a converted composite.
     */
    contributingCurrencies: string[];
    /**
     * Currencies whose rate was missing when aggregating. Amounts in
     * these currencies are NOT reflected in the returned totals.
     */
    unconvertibleCurrencies: string[];
  };
  chartPayload: {
    labels: string[];
    income: number[];
    expense: number[];
  };
}

/**
 * Compute the net profit (income − expense) from `year-01-01` onwards,
 * converted to the caller's target currency. Used by
 * `buildYearlySummary` so the start-of-year balance is correct even when
 * the user has transactions AFTER the year being viewed.
 *
 * If we only subtracted the selected year's net profit from the current
 * balance, any transactions in LATER years would leak into the
 * "starting balance" figure, inflating or deflating it depending on
 * whether they were net positive or negative.
 */
async function netProfitSinceYear(params: {
  year: number;
  accountId?: string;
  targetCurrency: string;
}): Promise<Big> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const conditions: string[] = [
    't.koinkat_account_id = ?',
    't.date >= ?',
    "t.type IN ('income', 'expense')",
    't.transfer_pair_id IS NULL',
    TX_EXCLUDE_REPAYMENT,
    // Exclude bank-pending rows from all aggregations until they book.
    TX_BOOKED_ONLY,
  ];
  const values: unknown[] = [koinkatAccountId, `${params.year}-01-01`];
  if (params.accountId) {
    conditions.push('t.account_id = ?');
    values.push(params.accountId);
  }
  const rows = await db.select<
    {
      type: string;
      amount_in_account_ccy: string;
      account_currency: string;
    }[]
  >(
    // Split-expense: use the user's net share on split parents, matching
    // every other aggregation. Selecting gross here once skewed the
    // Summary starting balance whenever a split parent existed.
    `SELECT t.type, ${TX_NET_AMOUNT_AS}, a.currency AS account_currency
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
      WHERE ${conditions.join(' AND ')}`,
    values,
  );
  const rates = await getLatestCachedRates();
  let total = new Big('0');
  for (const r of rows) {
    const amt = dec(r.amount_in_account_ccy).abs();
    const converted = tryConvert(
      amt,
      r.account_currency,
      params.targetCurrency,
      rates,
    );
    if (converted === null) continue;
    if (r.type === 'income') total = total.plus(converted);
    else total = total.minus(converted);
  }
  return total;
}

/**
 * Build a full yearly summary with monthly rows, totals, and chart payload.
 */
export async function buildYearlySummary(params: {
  year: number;
  accountId?: string;
  preferredCurrency: string;
  accounts: Account[];
}): Promise<YearlySummaryData> {
  const {
    rows: cashflow,
    contributingCurrencies,
    unconvertibleCurrencies,
  } = await monthlyCashflow({
    year: params.year,
    accountId: params.accountId,
    targetCurrency: params.preferredCurrency,
  });

  // Compute totals
  let totalIncome = new Big('0');
  let totalExpense = new Big('0');

  for (const row of cashflow) {
    totalIncome = totalIncome.plus(dec(row.income));
    totalExpense = totalExpense.plus(dec(row.expense));
  }

  const netProfit = totalIncome.minus(totalExpense);

  // Compute current balance - scoped to the filtered account if the user
  // picked one, otherwise across all accounts. Without this filter, a
  // single-account Summary would show a current balance sourced from ALL
  // accounts while showing a net profit sourced from ONE, which breaks the
  // starting-balance identity below.
  const relevantAccounts = params.accountId
    ? params.accounts.filter((a) => a.id === params.accountId)
    : params.accounts;
  const overview = await buildAccountOverview(
    relevantAccounts,
    params.preferredCurrency,
  );
  const currentBalance = dec(overview.totalBalance);

  // Starting balance = current balance − net profit accrued from the start
  // of `params.year` through today. This includes profit earned in LATER
  // years too, because the current balance already reflects them.
  //
  // Previously this subtracted only `netProfit` (the selected year's net),
  // which was wrong whenever the user had transactions in years after the
  // one they were looking at.
  const profitSinceYear = await netProfitSinceYear({
    year: params.year,
    accountId: params.accountId,
    targetCurrency: params.preferredCurrency,
  });
  const startingBalance = currentBalance.minus(profitSinceYear);

  // Build running balance row by row
  let runningBalance = new Big(startingBalance.toFixed(2));
  let prevBalance: Big | null = null;
  const rows: SummaryRow[] = [];

  for (const cf of cashflow) {
    const income = dec(cf.income);
    const expense = dec(cf.expense);
    const profit = income.minus(expense);
    runningBalance = runningBalance.plus(profit);

    let changePct: number | null = null;
    if (prevBalance !== null && !prevBalance.eq(new Big('0'))) {
      changePct = parseFloat(
        runningBalance.minus(prevBalance).div(prevBalance.abs()).times(new Big('100')).toFixed(2),
      );
    }

    rows.push({
      month: cf.month,
      label: MONTH_LABELS[cf.month - 1],
      income: qCent(income).toFixed(2),
      expense: qCent(expense).toFixed(2),
      profit: qCent(profit).toFixed(2),
      balance: qCent(runningBalance).toFixed(2),
      changePct,
    });

    prevBalance = new Big(runningBalance.toFixed(2));
  }

  // Build chart payload.
  // display-boundary: geometry only. Recharts needs JS numbers; these are
  // terminal coercions of already-qCent-quantized strings, with NO
  // arithmetic performed on the floats.
  const chartPayload = {
    labels: MONTH_LABELS,
    income: cashflow.map((cf) => parseFloat(cf.income)),
    expense: cashflow.map((cf) => parseFloat(cf.expense)),
  };

  return {
    rows,
    totals: {
      income: qCent(totalIncome).toFixed(2),
      expense: qCent(totalExpense).toFixed(2),
      profit: qCent(netProfit).toFixed(2),
      startingBalance: qCent(startingBalance).toFixed(2),
      currentBalance: qCent(currentBalance).toFixed(2),
      contributingCurrencies,
      unconvertibleCurrencies,
    },
    chartPayload,
  };
}
