import type Big from 'big.js';
import type { SQLInputValue } from 'node:sqlite';
import { ReadDatabase, type Row } from './database.js';
import { convert, dec, type Rates } from './money.js';
import { filtersSchema, searchSchema, summarySchema, type Filters } from './schemas.js';
import type { z } from 'zod';

const MAX_SCAN = 100_000;
const TX_SELECT = `SELECT t.id, t.account_id AS accountId, a.name AS accountName,
  a.currency AS accountCurrency, t.type, t.amount, t.currency,
  t.amount_in_account_ccy AS amountInAccountCurrency,
  t.net_spent_in_account_ccy AS netSpentInAccountCurrency,
  t.date, t.status, t.note, t.category_id AS categoryId, c.name AS categoryName,
  t.merchant_normalized AS merchant, t.needs_review AS needsReview,
  t.is_budgeted AS isBudgeted, t.budget_event_id AS budgetEventId,
  t.recurring_series_id AS recurringSeriesId, t.transfer_pair_id AS transferPairId,
  t.related_transaction_id AS relatedTransactionId, t.relation_kind AS relationKind,
  t.split_status AS splitStatus, t.updated_at AS updatedAt
  FROM transactions t JOIN accounts a ON a.id = t.account_id AND a.koinkat_account_id = t.koinkat_account_id
  LEFT JOIN categories c ON c.id = t.category_id AND c.koinkat_account_id = t.koinkat_account_id`;

interface Transaction extends Row {
  id: string; accountId: string; accountName: string; accountCurrency: string;
  type: string; amount: string; currency: string; amountInAccountCurrency: string;
  netSpentInAccountCurrency: string | null; date: string; status: string;
  categoryId: string | null; categoryName: string | null; merchant: string | null;
  needsReview: number; isBudgeted: number; budgetEventId: string | null;
  recurringSeriesId: string | null; transferPairId: string | null;
  relationKind: string | null; relatedTransactionId: string | null; splitStatus: string | null;
}

function reportable(t: Transaction): boolean {
  return t.status === 'booked' && t.type !== 'transfer' && t.transferPairId === null && t.relationKind !== 'repayment';
}

function monday(value: string): string {
  const d = new Date(`${value}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
  return d.toISOString().slice(0, 10);
}

/** One immutable workspace binding per process; wrap public calls in snapshot(). */
export class FinanceRepository {
  constructor(readonly database: ReadDatabase) {}
  get workspaceId() { return this.database.workspaceId; }

  #bounded(rows: Row[]): Row[] {
    if (rows.length > MAX_SCAN) throw new Error('Query exceeds 100000 records; narrow the date range or filters');
    return rows;
  }

  #rates(onDate?: string): Rates | null {
    let row = onDate ? this.database.select(
      'SELECT rate_date, rates_json FROM exchange_rates WHERE rate_date <= ? ORDER BY rate_date DESC LIMIT 1', [onDate],
    )[0] : undefined;
    row ??= this.database.select('SELECT rate_date, rates_json FROM exchange_rates ORDER BY rate_date DESC LIMIT 1')[0];
    if (!row) return null;
    const parsed: unknown = JSON.parse(String(row.rates_json));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid cached exchange-rate data');
    const values: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string' || typeof value === 'number') values[key.toLowerCase()] = String(value);
    }
    return { date: String(row.rate_date), values };
  }

  #workspace() {
    const row = this.database.select(
      'SELECT id, name, preferred_currency AS preferredCurrency FROM koinkat_accounts WHERE id = ?', [this.workspaceId],
    )[0];
    if (!row) throw new Error('Authorized workspace no longer exists');
    return row;
  }

  getContext() {
    const workspace = this.#workspace();
    const history = this.database.select(`SELECT MIN(date) AS earliestDate, MAX(date) AS latestDate,
      COUNT(*) AS transactionCount, MAX(updated_at) AS lastTransactionUpdatedAt
      FROM transactions WHERE koinkat_account_id = ?`, [this.workspaceId])[0];
    const sync = this.database.select(
      'SELECT MAX(last_synced_at) AS lastBankSync FROM linked_accounts WHERE koinkat_account_id = ?', [this.workspaceId],
    )[0];
    return { workspace, history, ...sync, latestRateDate: this.#rates()?.date ?? null,
      observedAt: new Date().toISOString(), access: 'read-only', schemaCompatibility: 'Koinkat v16',
      warning: 'Freshness describes this database file. A snapshot does not receive subsequent app changes.' };
  }

  listAccounts(limit = 50, offset = 0) {
    const currency = String(this.#workspace().preferredCurrency);
    const rates = this.#rates();
    let total = dec('0');
    const missing = new Set<string>();
    const perCurrency: Record<string, Big> = {};
    const accounts = this.#bounded(this.database.select(`SELECT id, name, currency, current_balance AS balance,
      is_manual AS isManual FROM accounts WHERE koinkat_account_id = ? ORDER BY name, id LIMIT ?`,
    [this.workspaceId, MAX_SCAN + 1])).map(row => {
      const nativeCurrency = String(row.currency), balance = String(row.balance);
      perCurrency[nativeCurrency] = (perCurrency[nativeCurrency] ?? dec('0')).plus(dec(balance));
      const converted = convert(balance, nativeCurrency, currency, rates);
      if (converted === null) missing.add(nativeCurrency); else total = total.plus(converted);
      return { ...row, isManual: Boolean(row.isManual), convertedBalance: converted?.toFixed(2) ?? null };
    });
    return { accounts: accounts.slice(offset, offset + limit), limit, offset, totalAccounts: accounts.length,
      hasMore: offset + limit < accounts.length, currency, total: total.toFixed(2), perCurrency: Object.fromEntries(
      Object.entries(perCurrency).map(([c, amount]) => [c, amount.toFixed(2)])),
    rateDate: rates?.date ?? null, unconvertibleCurrencies: [...missing].sort(), complete: missing.size === 0 };
  }

  listCategories(limit = 50, offset = 0) {
    const rows = this.database.select(`SELECT id, name, type, parent_id AS parentId
      FROM categories WHERE koinkat_account_id = ? ORDER BY name, id LIMIT ? OFFSET ?`, [this.workspaceId, limit + 1, offset]);
    return { categories: rows.slice(0, limit), limit, offset, hasMore: rows.length > limit };
  }

  #transactions(raw: Filters = {}): Transaction[] {
    const filter = filtersSchema.parse(raw);
    if (filter.startDate && filter.endDate && filter.startDate > filter.endDate) throw new Error('startDate must not be after endDate');
    if (filter.minAmount && dec(filter.minAmount).lt(0) || filter.maxAmount && dec(filter.maxAmount).lt(0)) {
      throw new Error('Amount bounds must be non-negative');
    }
    if (filter.minAmount && filter.maxAmount && dec(filter.minAmount).gt(dec(filter.maxAmount))) throw new Error('Invalid amount range');
    const where = ['t.koinkat_account_id = ?'];
    const params: SQLInputValue[] = [this.workspaceId];
    const field = (sql: string, value: SQLInputValue | undefined) => {
      if (value !== undefined) { where.push(sql); params.push(value); }
    };
    field('t.date >= ?', filter.startDate); field('t.date <= ?', filter.endDate);
    field('t.account_id = ?', filter.accountId); field('t.category_id = ?', filter.categoryId);
    field('t.currency = ?', filter.transactionCurrency);
    field('t.budget_event_id = ?', filter.budgetEventId); field('t.type = ?', filter.type);
    field('t.status = ?', filter.status); field('t.needs_review = ?', filter.needsReview === undefined ? undefined : Number(filter.needsReview));
    if (filter.merchant !== undefined) field('instr(lower(COALESCE(t.merchant_normalized, \'\')), lower(?)) > 0', filter.merchant);
    if (filter.recurring !== undefined) where.push(`t.recurring_series_id IS ${filter.recurring ? 'NOT ' : ''}NULL`);
    const rows = this.#bounded(this.database.select(`${TX_SELECT} WHERE ${where.join(' AND ')}
      ORDER BY t.date DESC, t.id ASC LIMIT ?`, [...params, MAX_SCAN + 1])) as Transaction[];
    return rows.filter(row => (!filter.minAmount || dec(row.amount).gte(dec(filter.minAmount))) &&
      (!filter.maxAmount || dec(row.amount).lte(dec(filter.maxAmount))));
  }

  searchTransactions(raw: z.input<typeof searchSchema>) {
    const { limit, offset, ...filters } = searchSchema.parse(raw);
    const rows = this.#transactions(filters);
    return { transactions: rows.slice(offset, offset + limit).map(t => ({ ...t,
      needsReview: Boolean(t.needsReview), isBudgeted: Boolean(t.isBudgeted) })),
    filters, totalMatching: rows.length, limit, offset, hasMore: offset + limit < rows.length,
    amountFilterCurrency: 'Each row original transaction currency; scope to one account/currency for meaningful comparisons' };
  }

  getTransaction(transactionId: string) {
    const row = this.database.select(`${TX_SELECT} WHERE t.koinkat_account_id = ? AND t.id = ?`, [this.workspaceId, transactionId])[0];
    if (!row) throw new Error('Transaction not found in authorized workspace');
    const related = this.database.select(`${TX_SELECT} WHERE t.koinkat_account_id = ?
      AND (t.related_transaction_id = ? OR t.id = ? OR (? IS NOT NULL AND t.transfer_pair_id = ? AND t.id != ?))
      ORDER BY t.date, t.id LIMIT ?`, [this.workspaceId, transactionId, row.relatedTransactionId ?? null,
      row.transferPairId ?? null, row.transferPairId ?? null, transactionId, 201]);
    const external = this.database.select(`SELECT id, amount, currency, amount_in_parent_ccy AS amountInParentCurrency,
      date, source, note FROM split_external_reimbursements
      WHERE koinkat_account_id = ? AND parent_transaction_id = ? ORDER BY date, id LIMIT 201`, [this.workspaceId, transactionId]);
    return { transaction: row, relatedTransactions: related.slice(0, 200), externalReimbursements: external.slice(0, 200),
      relatedTruncated: related.length > 200, reimbursementsTruncated: external.length > 200 };
  }

  summarizeTransactions(raw: z.input<typeof summarySchema>) {
    const { groupBy, currency: requested, limit, offset, ...filters } = summarySchema.parse(raw);
    const currency = requested ?? String(this.#workspace().preferredCurrency);
    const all = this.#transactions(filters), rows = all.filter(reportable), rates = this.#rates();
    const missing = new Set<string>();
    const groups = new Map<string, { key: string; label: string; income: Big; expenses: Big; count: number; convertedCount: number }>();
    let income = dec('0'), expenses = dec('0'), convertedCount = 0;
    for (const t of rows) {
      const key = groupBy === 'category' ? t.categoryId ?? 'uncategorized' : groupBy === 'merchant' ? t.merchant ?? 'unknown' :
        groupBy === 'account' ? t.accountId : groupBy === 'month' ? t.date.slice(0, 7) : groupBy === 'week' ? monday(t.date) : 'all';
      const label = groupBy === 'category' ? t.categoryName ?? 'Uncategorized' : groupBy === 'account' ? t.accountName : key;
      let group = groups.get(key);
      if (!group) { group = { key, label, income: dec('0'), expenses: dec('0'), count: 0, convertedCount: 0 }; groups.set(key, group); }
      group.count++;
      const amount = convert(t.netSpentInAccountCurrency ?? t.amountInAccountCurrency, t.accountCurrency, currency, rates);
      if (amount === null) { missing.add(t.accountCurrency); continue; }
      convertedCount++; group.convertedCount++;
      if (t.type === 'income') { income = income.plus(amount); group.income = group.income.plus(amount); }
      else { expenses = expenses.plus(amount); group.expenses = group.expenses.plus(amount); }
    }
    const sorted = [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
    return { currency, filters, groupBy, rateDate: rates?.date ?? null, ratePolicy: 'latest-cached',
      income: income.toFixed(2), expenses: expenses.toFixed(2), net: income.minus(expenses).toFixed(2),
      matchingCount: all.length, includedCount: rows.length, excludedCount: all.length - rows.length, convertedCount,
      complete: missing.size === 0, unconvertibleCurrencies: [...missing].sort(),
      groups: sorted.slice(offset, offset + limit).map(g => ({ ...g, income: g.income.toFixed(2), expenses: g.expenses.toFixed(2), net: g.income.minus(g.expenses).toFixed(2) })),
      totalGroups: groups.size, limit, offset, hasMore: offset + limit < groups.size,
      semantics: 'Booked income/expenses only; excludes repayments and transfers; split parents contribute signed net cost' };
  }

  listRecurringExpenses(status: 'active' | 'paused' | 'ended', limit: number, offset: number) {
    const rows = this.database.select(`SELECT id, display_name AS displayName, merchant_normalized AS merchant,
      cadence, expected_amount AS expectedAmount, currency, next_expected_date AS nextExpectedDate,
      last_charge_date AS lastChargeDate, category_id AS categoryId, status
      FROM recurring_series WHERE koinkat_account_id = ? AND status = ? ORDER BY display_name, id LIMIT ? OFFSET ?`,
    [this.workspaceId, status, limit + 1, offset]);
    return { series: rows.slice(0, limit), limit, offset, hasMore: rows.length > limit,
      note: 'Confirmed series only; this does not discover subscriptions or guarantee future charges' };
  }

  listSplitExpenses(status: 'open' | 'settled' | 'all', limit: number, offset: number) {
    const rows = this.#transactions({ type: 'expense' }).filter(t => t.splitStatus !== null && (status === 'all' || t.splitStatus === status));
    return { splits: rows.slice(offset, offset + limit).map(t => ({ ...t,
      grossCost: t.amountInAccountCurrency, netCost: t.netSpentInAccountCurrency,
      reimbursed: t.netSpentInAccountCurrency === null ? null : dec(t.amountInAccountCurrency).minus(dec(t.netSpentInAccountCurrency)).toFixed(2) })),
    totalMatching: rows.length, limit, offset, hasMore: offset + limit < rows.length,
    note: 'Net costs are stored Koinkat values; open status does not specify a remaining amount owed by friends' };
  }

  getBudgets(year: number) {
    const budgets = this.database.select(`SELECT id, year, start_month AS startMonth, end_month AS endMonth,
      rhythm, limit_amount AS limitAmount, currency, is_active AS isActive
      FROM recurring_budgets WHERE koinkat_account_id = ? AND year = ?`, [this.workspaceId, year]);
    const periods = this.#bounded(this.database.select(`SELECT p.id, p.recurring_budget_id AS budgetId,
      p.period_start AS periodStart, p.period_end AS periodEnd, p.limit_amount AS limitAmount,
      p.currency, p.is_customized AS isCustomized FROM budget_periods p JOIN recurring_budgets b
      ON b.id = p.recurring_budget_id AND b.koinkat_account_id = p.koinkat_account_id
      WHERE p.koinkat_account_id = ? AND b.year = ? ORDER BY p.period_start, p.id LIMIT ?`, [this.workspaceId, year, MAX_SCAN + 1]));
    const events = this.#bounded(this.database.select(`SELECT id, name, limit_amount AS limitAmount, currency,
      start_date AS startDate, end_date AS endDate, sum_to_budget AS sumToBudget, sum_to_month AS sumToMonth,
      is_expired AS isExpired FROM budget_events WHERE koinkat_account_id = ? ORDER BY name, id LIMIT ?`, [this.workspaceId, MAX_SCAN + 1]));
    const expenses = this.#transactions({ type: 'expense' }).filter(reportable);
    const usedRateDates = new Set<string>(), fallbackDates = new Set<string>();
    const rateMemo = new Map<string, Rates | null>();
    const rateAt = (day: string) => {
      if (!rateMemo.has(day)) rateMemo.set(day, this.#rates(day));
      const rate = rateMemo.get(day) ?? null;
      if (rate) { usedRateDates.add(rate.date); if (rate.date !== day) fallbackDates.add(day); }
      return rate;
    };
    const sum = (rows: Transaction[], target: string) => {
      let total = dec('0'); const missing = new Set<string>();
      for (const t of rows) {
        const amount = convert(t.netSpentInAccountCurrency ?? t.amountInAccountCurrency, t.accountCurrency,
          target, t.accountCurrency === target ? null : rateAt(t.date));
        if (amount === null) missing.add(t.accountCurrency); else total = total.plus(amount);
      }
      return { total, missing };
    };
    const eventResults = events.map(event => {
      const { total, missing } = sum(expenses.filter(t => t.budgetEventId === event.id), String(event.currency));
      return { ...event, id: String(event.id), spent: total.toFixed(2), remaining: dec(String(event.limitAmount)).minus(total).toFixed(2),
        complete: missing.size === 0, unconvertibleCurrencies: [...missing].sort() };
    });
    const periodResults = periods.map(period => {
      const start = String(period.periodStart), end = String(period.periodEnd), target = String(period.currency);
      const summed = events.filter(e => e.sumToBudget === 1 && e.isExpired === 0 && e.sumToMonth === start.slice(0, 7) + '-01');
      const selected = expenses.filter(t => t.isBudgeted === 1 && (t.budgetEventId === null ?
        t.date >= start && t.date <= end : summed.some(e => e.id === t.budgetEventId)));
      const { total, missing } = sum(selected, target);
      let contribution = dec('0');
      for (const e of summed) {
        const converted = convert(String(e.limitAmount), String(e.currency), target, e.currency === target ? null : rateAt(start));
        if (converted === null) missing.add(String(e.currency)); else contribution = contribution.plus(converted);
      }
      const effective = dec(String(period.limitAmount)).plus(contribution);
      return { ...period, id: String(period.id), eventContribution: contribution.toFixed(2), effectiveLimit: effective.toFixed(2),
        spent: total.toFixed(2), remaining: effective.minus(total).toFixed(2), complete: missing.size === 0,
        unconvertibleCurrencies: [...missing].sort() };
    });
    return { year, budgets, periods: periodResults, events: eventResults,
      eventScope: 'All workspace events, including undated and expired events; recurring budgets/periods use the selected year',
      ratePolicy: 'Exact-date cache, otherwise nearest-earlier cache, otherwise latest cache; no network fetches',
      usedRateDates: [...usedRateDates].sort(), datesUsingFallbackRates: [...fallbackDates].sort(),
      note: 'Only already stored budget periods are returned; this read never creates missing periods' };
  }
}
