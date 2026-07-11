import { formatShortDate as formatDrawerDate } from '../lib/date-format';
import { monthFilterOptions, previousMonth } from '../lib/date-constants';
import { UPPERCASE_LABEL, UPPERCASE_LABEL_SM, UPPERCASE_HEADER_CELL } from '../lib/label-styles';
import { useState, useEffect, useCallback, Fragment } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import {
  ChevronDown,
  ChevronRight,
  ArrowRight,
  AlertTriangle,
  Pencil,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';
import { dec } from '../domain/money';
import { Card } from '../components/ui/Card';
import { InfoBanner } from '../components/ui/InfoBanner';
import { Select } from '../components/ui/Select';
import { PageHeader } from '../components/layout/PageHeader';
import { useAppStore } from '../stores/app-store';
import { formatAmount } from '../lib/format';
import { MONTH_NAMES } from '../lib/date-constants';
import { categoryBreakdown, availableYears, sumNonBudgetedExpenses } from '../services/reporting-service';
import * as transactionService from '../services/transaction-service';
import * as recurringService from '../services/recurring-service';
import type { CategoryBreakdownRow } from '../services/reporting-service';
import type { RecurringBreakdownResult } from '../services/recurring-service';
import type { Transaction } from '../types/models';

/* ── Constants ───────────────────────────────────────────────────── */

const MONTH_OPTIONS = monthFilterOptions({ value: '0', label: 'All year' });

const TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
];

const UNCATEGORIZED_KEY = '__uncategorized__';
type DrawerKey = string;

const labelStyles = UPPERCASE_LABEL;
const headerCellStyles = UPPERCASE_HEADER_CELL;

/* ── Component ───────────────────────────────────────────────────── */

export function Analysis() {
  const settings = useAppStore((s) => s.settings);
  const [searchParams, setSearchParams] = useSearchParams();

  const [years, setYears] = useState<number[]>([]);

  // ── URL-derived filter state ───────────────────────────────────
  const yearParam = parseInt(searchParams.get('year') ?? '', 10);
  const monthParam = parseInt(searchParams.get('month') ?? '', 10);
  const type: 'expense' | 'income' =
    searchParams.get('type') === 'income' ? 'income' : 'expense';

  const year = (() => {
    if (!isNaN(yearParam) && years.includes(yearParam)) return yearParam;
    if (!isNaN(yearParam) && years.length === 0) return yearParam;
    if (years.length > 0) return years[0];
    return new Date().getFullYear();
  })();
  const month =
    !isNaN(monthParam) && monthParam >= 1 && monthParam <= 12 ? monthParam : 0;

  // ── Page data ──────────────────────────────────────────────────
  const [rows, setRows] = useState<CategoryBreakdownRow[]>([]);
  const [total, setTotal] = useState<string>('0.00');
  const [count, setCount] = useState<number>(0);
  // Previous-period total for the comparison KPI ("am I spending more
  // than usual?"). null = previous period has no data / failed to load.
  const [prevTotal, setPrevTotal] = useState<string | null>(null);
  // Off-budget spend (is_budgeted = 0) for the current scope; only shown
  // for the expense view, as a sub-line under "Total spent".
  const [nonBudgeted, setNonBudgeted] = useState<string>('0.00');
  const [unconvertibleCurrencies, setUnconvertibleCurrencies] = useState<
    string[]
  >([]);
  const [contributingCurrencies, setContributingCurrencies] = useState<
    string[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Recurring breakdown (expense view only) - a LENS over the same spend.
  const [recurring, setRecurring] = useState<RecurringBreakdownResult | null>(null);

  // ── Drawer state (lazy-loaded transactions per category) ───────
  const [expanded, setExpanded] = useState<DrawerKey | null>(null);
  const [drawerData, setDrawerData] = useState<
    Record<DrawerKey, { loading: boolean; transactions: Transaction[] }>
  >({});

  // Load available years on mount; correct URL year if missing/stale.
  useEffect(() => {
    availableYears()
      .then((yrs) => {
        setYears(yrs);
        if (yrs.length === 0) return;
        const parsed = parseInt(searchParams.get('year') ?? '', 10);
        if (isNaN(parsed) || !yrs.includes(parsed)) {
          setSearchParams(
            (prev) => {
              const next = new URLSearchParams(prev);
              next.set('year', String(yrs[0]));
              return next;
            },
            { replace: true },
          );
        }
      })
      .catch((err) => {
        // The year selector falls back to the current calendar year; surface
        // the failure through the same error state the breakdown load uses
        // instead of dying as an unhandled rejection.
        setLoadError(
          err instanceof Error ? err.message : 'Failed to load available years',
        );
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load breakdown whenever filters change.
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      // Current and previous period are independent - fetch in parallel.
      // The previous period (shifted back one month/year) feeds the
      // comparison KPI; its failures degrade to "no comparison".
      const prev =
        month > 0
          ? previousMonth(year, month)
          : { year: year - 1, month: undefined };
      const [result, prevResult] = await Promise.all([
        categoryBreakdown({
          year,
          month: month > 0 ? month : undefined,
          type,
          preferredCurrency: settings.preferredCurrency,
        }),
        categoryBreakdown({
          year: prev.year,
          month: prev.month,
          type,
          preferredCurrency: settings.preferredCurrency,
        }).catch(() => null),
      ]);
      setRows(result.rows);
      setTotal(result.total);
      setCount(result.count);
      setUnconvertibleCurrencies(result.unconvertibleCurrencies);
      setPrevTotal(
        prevResult && prevResult.count > 0 ? prevResult.total : null,
      );
      const allCcys = new Set<string>();
      for (const r of result.rows)
        for (const c of r.currencies) allCcys.add(c);
      setContributingCurrencies([...allCcys].sort());
      if (type === 'expense') {
        const nb = await sumNonBudgetedExpenses({
          year,
          month: month > 0 ? month : undefined,
          preferredCurrency: settings.preferredCurrency,
        });
        setNonBudgeted(nb.total);
        const rb = await recurringService.recurringBreakdown({
          year,
          month: month > 0 ? month : undefined,
          preferredCurrency: settings.preferredCurrency,
        });
        setRecurring(rb);
      } else {
        setNonBudgeted('0.00');
        setRecurring(null);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load analysis data');
    } finally {
      setLoading(false);
    }
  }, [year, month, type, settings.preferredCurrency]);

  // Re-load + collapse drawers when filters change.
  useEffect(() => {
    load();
    setExpanded(null);
    setDrawerData({});
  }, [load]);

  const setFilter = useCallback(
    (key: 'year' | 'month' | 'type', value: string) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (value && value !== '0') {
          next.set(key, value);
        } else {
          next.delete(key);
        }
        return next;
      });
    },
    [setSearchParams],
  );

  const toggleDrawer = useCallback(
    async (key: DrawerKey) => {
      if (expanded === key) {
        setExpanded(null);
        return;
      }
      setExpanded(key);
      if (drawerData[key]) return; // cached
      setDrawerData((prev) => ({
        ...prev,
        [key]: { loading: true, transactions: [] },
      }));
      try {
        const isUncategorized = key === UNCATEGORIZED_KEY;
        const result = await transactionService.listTransactions({
          year,
          month: month > 0 ? month : undefined,
          type,
          // Drill by macro: match the macro directly OR any of its
          // subcategories (rollup).
          macroCategoryId: isUncategorized ? undefined : key,
          uncategorized: isUncategorized ? true : undefined,
          perPage: 200,
          sortBy: 'date',
          sortDir: 'desc',
          // The drawer renders one fixed page - no pagination UI, so the
          // COUNT(*) pass is skipped.
          skipCount: true,
        });
        setDrawerData((prev) => ({
          ...prev,
          [key]: { loading: false, transactions: result.transactions },
        }));
      } catch (err) {
        console.error('Failed to load drawer transactions:', err);
        setDrawerData((prev) => ({
          ...prev,
          [key]: { loading: false, transactions: [] },
        }));
      }
    },
    [expanded, drawerData, year, month, type],
  );

  // ── Derived display values ─────────────────────────────────────
  const yearOptions = years.map((y) => ({
    value: String(y),
    label: String(y),
  }));
  const hasData = rows.length > 0;
  const typeColor = type === 'expense' ? 'var(--expense)' : 'var(--income)';
  const typeNoun = type === 'expense' ? 'expense' : 'income';
  const totalLabel = type === 'expense' ? 'Total spent' : 'Total earned';
  const topCategory = rows.length > 0 ? rows[0] : null;

  // ── Previous-period comparison ─────────────────────────────────
  const nowDate = new Date();
  const periodInProgress =
    year === nowDate.getFullYear() &&
    (month === 0 || month === nowDate.getMonth() + 1);
  const prevLabel =
    month > 0
      ? `${MONTH_NAMES[(month + 10) % 12]}${month === 1 ? ` ${year - 1}` : ''}`
      : String(year - 1);
  const deltaPct =
    prevTotal !== null && dec(prevTotal).gt(0)
      ? // Big for the money division; toNumber() only for display formatting.
        dec(total).minus(dec(prevTotal)).div(dec(prevTotal)).times(100).toNumber()
      : null;
  // Spending more than before is bad for expenses, good for income.
  const deltaColor =
    deltaPct === null || Math.abs(deltaPct) < 0.05
      ? 'var(--text)'
      : (deltaPct > 0) === (type === 'income')
        ? 'var(--income)'
        : 'var(--expense)';

  return (
    <div>
      <PageHeader
        serif
        label="Overview"
        title="Analysis"
        subtitle="Visualize how your money is distributed across categories."
      />

      {/* One-time tip: the drill-down drawer is the page's best feature
          and its only affordance is a small chevron. Sits directly under
          the header, same slot as the other pages' tips. */}
      <InfoBanner storageKey="koinkat.tip.analysisDrill" className="mb-6">
        Click any category row to see the transactions behind the number.
      </InfoBanner>

      {/* ── Filters ─────────────────────────────────────────────── */}
      <Card className="mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Select
            label="Year"
            options={yearOptions}
            value={String(year)}
            onChange={(e) => setFilter('year', e.target.value)}
          />
          <Select
            label="Month"
            options={MONTH_OPTIONS}
            value={String(month)}
            onChange={(e) => setFilter('month', e.target.value)}
          />
          <Select
            label="Type"
            options={TYPE_OPTIONS}
            value={type}
            onChange={(e) => setFilter('type', e.target.value)}
          />
        </div>
        <div className="mt-4 flex justify-end">
          <Link
            to="/categories"
            className="inline-flex items-center gap-1.5 hover:underline"
            style={{
              color: 'var(--primary)',
              fontSize: 'var(--fs-body-sm)',
              fontWeight: 'var(--fw-medium)',
            }}
          >
            Manage categories
            <ArrowRight size={14} strokeWidth={1.75} />
          </Link>
        </div>
      </Card>

      {/* ── Body ────────────────────────────────────────────────── */}
      {loading ? (
        <Card>
          <p
            className="text-center py-12"
            style={{
              color: 'var(--text-muted)',
              fontSize: 'var(--fs-body-sm)',
            }}
          >
            Loading...
          </p>
        </Card>
      ) : loadError ? (
        <Card>
          <p
            className="text-center py-12"
            style={{
              color: 'var(--expense)',
              fontSize: 'var(--fs-body-sm)',
            }}
          >
            {loadError}
          </p>
        </Card>
      ) : !hasData ? (
        <Card>
          <div className="text-center py-12 flex flex-col items-center gap-2">
            <p
              style={{
                color: 'var(--text-muted)',
                fontSize: 'var(--fs-body-sm)',
              }}
            >
              No {typeNoun} transactions found for the selected period.
            </p>
            <p
              style={{
                color: 'var(--text-muted)',
                fontSize: 'var(--fs-body-sm)',
              }}
            >
              Try "All year", pick another year above, or{' '}
              <Link
                to="/transactions"
                className="hover:underline"
                style={{ color: 'var(--primary)' }}
              >
                browse all transactions
              </Link>
              .
            </p>
          </div>
        </Card>
      ) : (
        <>
          {/* ── KPI grid ──────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-3">
            <Card>
              <p className="uppercase mb-2" style={labelStyles}>
                {totalLabel}
              </p>
              <div className="flex items-baseline" data-privacy-field>
                <span
                  className="amount amount-md"
                  style={{ color: typeColor }}
                >
                  {formatAmount(total, settings.decimalSeparator)}
                </span>
                <span className="currency-code">
                  {settings.preferredCurrency}
                </span>
              </div>
              {type === 'expense' && dec(nonBudgeted).gt(0) && (
                <p
                  className="mt-1"
                  style={{
                    color: 'var(--text-muted)',
                    fontSize: 'var(--fs-body-sm)',
                  }}
                >
                  Excluded from budget{' '}
                  <span data-privacy-field>
                    {formatAmount(nonBudgeted, settings.decimalSeparator)}{' '}
                    {settings.preferredCurrency}
                  </span>
                </p>
              )}
            </Card>

            <Card>
              <p className="uppercase mb-2" style={labelStyles}>
                Transactions
              </p>
              <div className="flex items-baseline" data-privacy-field>
                <span
                  className="amount amount-md"
                  style={{ color: 'var(--text)' }}
                >
                  {count}
                </span>
              </div>
            </Card>

            <Card>
              <p className="uppercase mb-2" style={labelStyles}>
                vs {prevLabel}
              </p>
              {deltaPct !== null ? (
                <>
                  <div className="flex items-center gap-1.5">
                    {deltaPct >= 0 ? (
                      <TrendingUp size={16} style={{ color: deltaColor }} />
                    ) : (
                      <TrendingDown size={16} style={{ color: deltaColor }} />
                    )}
                    <span
                      className="amount amount-md"
                      style={{ color: deltaColor }}
                    >
                      {deltaPct >= 0 ? '+' : ''}
                      {deltaPct.toFixed(1)}%
                    </span>
                  </div>
                  <p
                    className="mt-1"
                    style={{
                      color: 'var(--text-muted)',
                      fontSize: 'var(--fs-body-sm)',
                    }}
                  >
                    {prevLabel}:{' '}
                    <span data-privacy-field>
                      {formatAmount(prevTotal!, settings.decimalSeparator)}{' '}
                      {settings.preferredCurrency}
                    </span>
                    {periodInProgress && ' · period in progress'}
                  </p>
                </>
              ) : (
                <span
                  style={{
                    color: 'var(--text-muted)',
                    fontSize: 'var(--fs-body-sm)',
                  }}
                >
                  No data for {prevLabel} to compare against.
                </span>
              )}
            </Card>

            <Card>
              <p className="uppercase mb-2" style={labelStyles}>
                Top category
              </p>
              {topCategory ? (
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: 'var(--viz-1)' }}
                  />
                  <span
                    className="truncate flex-1"
                    style={{
                      color: 'var(--text)',
                      fontSize: 'var(--fs-body)',
                      fontWeight: 'var(--fw-medium)',
                    }}
                  >
                    {topCategory.macroName}
                  </span>
                  <span
                    className="amount amount-sm shrink-0"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {topCategory.percentage.toFixed(1)}%
                  </span>
                </div>
              ) : (
                <span style={{ color: 'var(--text-muted)' }}>-</span>
              )}
            </Card>
          </div>

          {/* Multi-currency hints */}
          {contributingCurrencies.length > 1 && (
            <p
              className="mb-3"
              style={{
                color: 'var(--text-muted)',
                fontSize: 'var(--fs-body-sm)',
              }}
            >
              Aggregated across{' '}
              {contributingCurrencies
                .map((c) => c.toUpperCase())
                .join(', ')}{' '}
              , converted to {settings.preferredCurrency} at today's rates.
            </p>
          )}
          {unconvertibleCurrencies.length > 0 && (
            <div
              className="mb-6 flex items-start gap-2 px-4 py-3 rounded-lg"
              style={{
                backgroundColor:
                  'color-mix(in srgb, var(--warning) 12%, var(--surface))',
                border:
                  '1px solid color-mix(in srgb, var(--warning) 30%, transparent)',
              }}
            >
              <AlertTriangle
                size={16}
                strokeWidth={1.75}
                style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 2 }}
              />
              <p
                style={{
                  color: 'var(--text-secondary)',
                  fontSize: 'var(--fs-body-sm)',
                }}
              >
                Could not convert transactions in{' '}
                {unconvertibleCurrencies
                  .map((c) => c.toUpperCase())
                  .join(', ')}{' '}
                . Exchange rates missing.
              </p>
            </div>
          )}
          {contributingCurrencies.length > 1 &&
            unconvertibleCurrencies.length === 0 && <div className="mb-3" />}

          {/* ── Breakdown table (full width) ─────────────────── */}
          <Card>
              <p className="uppercase mb-3" style={labelStyles}>
                Breakdown by category
              </p>
              <div className="overflow-x-auto">
                <table className="w-full" style={{ tableLayout: 'fixed' }}>
                  <colgroup>
                    <col />
                    <col style={{ width: '160px' }} />
                    <col style={{ width: '80px' }} />
                    <col style={{ width: '380px' }} />
                    <col style={{ width: '40px' }} />
                  </colgroup>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <th
                        className="text-left py-2 pr-4 font-medium uppercase"
                        style={headerCellStyles}
                      >
                        Category
                      </th>
                      <th
                        className="text-right py-2 px-4 font-medium uppercase"
                        style={headerCellStyles}
                      >
                        Amount
                      </th>
                      <th
                        className="text-right py-2 px-4 font-medium uppercase"
                        style={headerCellStyles}
                      >
                        Count
                      </th>
                      <th
                        className="text-right py-2 px-4 font-medium uppercase"
                        style={headerCellStyles}
                      >
                        Share
                      </th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => {
                      const drawerKey: DrawerKey = row.macroId ?? UNCATEGORIZED_KEY;
                      const isExpanded = expanded === drawerKey;
                      const drawer = drawerData[drawerKey];
                      const colorVar = `var(--viz-${(i % 8) + 1})`;
                      return (
                        <Fragment key={drawerKey}>
                          <tr
                            onClick={() => toggleDrawer(drawerKey)}
                            className="cursor-pointer transition-colors"
                            style={{
                              borderBottom: '1px solid var(--border)',
                              backgroundColor: isExpanded
                                ? 'var(--surface-alt)'
                                : 'transparent',
                            }}
                            onMouseEnter={(e) => {
                              if (!isExpanded) {
                                e.currentTarget.style.backgroundColor =
                                  'var(--surface-alt)';
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (!isExpanded) {
                                e.currentTarget.style.backgroundColor =
                                  'transparent';
                              }
                            }}
                          >
                            <td className="py-2.5 pr-4 pl-1">
                              <div className="flex items-center gap-2 min-w-0">
                                <div
                                  className="w-2.5 h-2.5 rounded-full shrink-0"
                                  style={{ backgroundColor: colorVar }}
                                />
                                <span
                                  className="truncate"
                                  style={{
                                    color: 'var(--text)',
                                    fontSize: 'var(--fs-body)',
                                  }}
                                >
                                  {row.macroName}
                                </span>
                                {row.currencies.length > 1 && (
                                  <span
                                    className="shrink-0 px-1.5 py-0.5 rounded"
                                    style={{
                                      backgroundColor: 'var(--surface-alt)',
                                      color: 'var(--text-muted)',
                                      fontSize: 'var(--fs-rate)',
                                      fontFamily: 'var(--font-mono)',
                                      letterSpacing: 'var(--ls-currency)',
                                    }}
                                    title={`Sources: ${row.currencies
                                      .map((c) => c.toUpperCase())
                                      .join(', ')}`}
                                  >
                                    {row.currencies
                                      .map((c) => c.toUpperCase())
                                      .join(' · ')}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td
                              className="text-right py-2.5 px-4"
                              data-privacy-field
                            >
                              <span
                                className="amount amount-md"
                                style={{ color: 'var(--text)' }}
                              >
                                {formatAmount(
                                  row.amount,
                                  settings.decimalSeparator,
                                )}
                              </span>
                              <span className="currency-code">
                                {settings.preferredCurrency}
                              </span>
                            </td>
                            <td
                              className="text-right py-2.5 px-4 amount"
                              style={{
                                color: 'var(--text-muted)',
                                fontSize: 'var(--fs-body-sm)',
                              }}
                            >
                              {row.count}
                            </td>
                            <td className="py-2.5 px-4">
                              <div className="flex items-center gap-3">
                                <div
                                  className="flex-1 h-1.5 rounded-full overflow-hidden"
                                  style={{
                                    backgroundColor: 'var(--border)',
                                  }}
                                >
                                  <div
                                    className="h-full rounded-full"
                                    style={{
                                      width: `${row.percentage}%`,
                                      backgroundColor: colorVar,
                                      transition:
                                        'width var(--dur-std) var(--ease-standard)',
                                    }}
                                  />
                                </div>
                                <span
                                  className="amount amount-sm shrink-0"
                                  style={{
                                    color: 'var(--text-muted)',
                                    minWidth: '3rem',
                                    textAlign: 'right',
                                  }}
                                >
                                  {row.percentage.toFixed(1)}%
                                </span>
                              </div>
                            </td>
                            <td className="py-2.5 pl-1 pr-2 text-right">
                              {isExpanded ? (
                                <ChevronDown
                                  size={16}
                                  strokeWidth={1.75}
                                  style={{ color: 'var(--text-muted)' }}
                                />
                              ) : (
                                <ChevronRight
                                  size={16}
                                  strokeWidth={1.75}
                                  style={{ color: 'var(--text-muted)' }}
                                />
                              )}
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr>
                              <td
                                colSpan={5}
                                style={{
                                  padding: 0,
                                  borderBottom: '1px solid var(--border)',
                                }}
                              >
                                <DrawerContent
                                  drawer={drawer}
                                  decimalSeparator={settings.decimalSeparator}
                                />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
          </Card>

          {type === 'expense' && recurring && (
            <RecurringBreakdownCard
              recurring={recurring}
              decimalSeparator={settings.decimalSeparator}
              preferredCurrency={settings.preferredCurrency}
            />
          )}
        </>
      )}
    </div>
  );
}

/* ── Recurring breakdown (Analysis) ──────────────────────────────── */

function RecurringBreakdownCard({
  recurring,
  decimalSeparator,
  preferredCurrency,
}: {
  recurring: RecurringBreakdownResult;
  decimalSeparator: string;
  preferredCurrency: string;
}) {
  // Money math in Big (invariant: no float arithmetic on amounts);
  // toNumber() only at the final CSS-width boundary.
  const fixedD = dec(recurring.fixedTotal);
  const totalExpD = fixedD.plus(dec(recurring.variableTotal));
  const fixedPct = totalExpD.gt(0)
    ? fixedD.div(totalExpD).times(100).toNumber()
    : 0;

  return (
    <Card className="mt-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2
          style={{
            color: 'var(--text)',
            fontSize: 'var(--fs-h3)',
            fontWeight: 'var(--fw-semibold)',
          }}
        >
          Recurring breakdown
        </h2>
        <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-body-sm)' }}>
          Fixed{' '}
          <strong data-privacy-field style={{ color: 'var(--text)' }}>
            {formatAmount(recurring.fixedTotal, decimalSeparator)} {preferredCurrency}
          </strong>{' '}
          · Variable{' '}
          <strong data-privacy-field style={{ color: 'var(--text)' }}>
            {formatAmount(recurring.variableTotal, decimalSeparator)} {preferredCurrency}
          </strong>
        </span>
      </div>

      {/* Fixed-vs-variable bar */}
      <div
        className="h-2 rounded-full overflow-hidden mb-1"
        style={{ backgroundColor: 'var(--surface-alt)' }}
        title={`Fixed ${fixedPct.toFixed(0)}% of expenses`}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${fixedPct}%`, backgroundColor: 'var(--viz-3, #7c3aed)' }}
        />
      </div>
      <p className="mb-4" style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-rate)' }}>
        {fixedPct.toFixed(0)}% of this period's expenses are recurring commitments. This regroups
        the same spend - it is not added on top of category totals.
      </p>

      {recurring.unconvertibleCurrencies.length > 0 && (
        <p
          className="mb-3 inline-flex items-center gap-1.5"
          style={{ color: 'var(--warning)', fontSize: 'var(--fs-body-sm)' }}
        >
          <AlertTriangle size={14} aria-hidden />
          Some {recurring.unconvertibleCurrencies.join(', ').toUpperCase()} rows were skipped
          (no exchange rate).
        </p>
      )}

      {recurring.rows.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-body-sm)' }}>
          No recurring expenses in this period. Flag one from Review or a transaction's edit
          screen to start tracking it.
        </p>
      ) : (
        <table className="w-full" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th className="text-left py-2 px-3" style={headerCellStyles}>Series</th>
              <th className="text-left py-2 px-3" style={headerCellStyles}>Cadence</th>
              <th className="text-right py-2 px-3" style={headerCellStyles}>Total</th>
            </tr>
          </thead>
          <tbody>
            {recurring.rows.map((r) => (
              <tr key={r.seriesId} style={{ borderTop: '1px solid var(--border)' }}>
                <td className="py-2.5 px-3" style={{ color: 'var(--text)' }}>
                  {r.displayName}
                </td>
                <td
                  className="py-2.5 px-3 capitalize"
                  style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-body-sm)' }}
                >
                  {r.cadence}
                </td>
                <td
                  className="py-2.5 px-3 text-right amount"
                  data-privacy-field
                  style={{ color: 'var(--text)' }}
                >
                  {formatAmount(r.amount, decimalSeparator)} {preferredCurrency}
                </td>
              </tr>
            ))}
            <tr style={{ borderTop: '2px solid var(--border)' }}>
              <td className="py-2.5 px-3" style={{ color: 'var(--text)', fontWeight: 'var(--fw-semibold)' }}>
                Total recurring
              </td>
              <td />
              <td
                className="py-2.5 px-3 text-right amount"
                data-privacy-field
                style={{ color: 'var(--text)', fontWeight: 'var(--fw-semibold)' }}
              >
                {formatAmount(recurring.total, decimalSeparator)} {preferredCurrency}
              </td>
            </tr>
          </tbody>
        </table>
      )}
    </Card>
  );
}

/* ── Drawer (lazy-loaded transactions for an expanded category) ──── */

interface DrawerContentProps {
  drawer: { loading: boolean; transactions: Transaction[] } | undefined;
  decimalSeparator: string;
}

function DrawerContent({ drawer, decimalSeparator }: DrawerContentProps) {
  const navigate = useNavigate();
  if (!drawer || drawer.loading) {
    return (
      <div
        className="text-center py-6"
        style={{
          color: 'var(--text-muted)',
          fontSize: 'var(--fs-body-sm)',
          backgroundColor: 'var(--surface-alt)',
        }}
      >
        Loading transactions...
      </div>
    );
  }
  if (drawer.transactions.length === 0) {
    return (
      <div
        className="text-center py-6"
        style={{
          color: 'var(--text-muted)',
          fontSize: 'var(--fs-body-sm)',
          backgroundColor: 'var(--surface-alt)',
        }}
      >
        No transactions found.
      </div>
    );
  }

  return (
    <div
      className="overflow-y-auto"
      style={{
        maxHeight: '320px',
        backgroundColor: 'var(--surface-alt)',
      }}
    >
      <table className="w-full">
        <thead
          className="sticky top-0"
          style={{
            backgroundColor: 'var(--surface-alt)',
            zIndex: 1,
          }}
        >
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <th
              className="text-left py-2 px-4 font-medium uppercase"
              style={UPPERCASE_LABEL_SM}
            >
              Date
            </th>
            <th
              className="text-left py-2 px-4 font-medium uppercase"
              style={UPPERCASE_LABEL_SM}
            >
              Account
            </th>
            <th
              className="text-left py-2 px-4 font-medium uppercase"
              style={UPPERCASE_LABEL_SM}
            >
              Note
            </th>
            <th
              className="text-right py-2 px-4 font-medium uppercase"
              style={UPPERCASE_LABEL_SM}
            >
              Amount
            </th>
            <th className="py-2 px-3" aria-hidden="true" />
          </tr>
        </thead>
        <tbody>
          {drawer.transactions.map((txn) => (
            <tr key={txn.id} style={{ borderBottom: '1px solid var(--border)' }}>
              <td
                className="py-2 px-4 whitespace-nowrap"
                style={{
                  color: 'var(--text-secondary)',
                  fontSize: 'var(--fs-body-sm)',
                }}
              >
                {formatDrawerDate(txn.date)}
              </td>
              <td className="py-2 px-4">
                <div className="flex items-center gap-1.5 min-w-0">
                  <div
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{
                      backgroundColor:
                        txn.account?.color ?? 'var(--text-muted)',
                    }}
                  />
                  <span
                    className="truncate"
                    style={{
                      color: 'var(--text)',
                      fontSize: 'var(--fs-body-sm)',
                    }}
                  >
                    {txn.account?.name ?? '-'}
                  </span>
                </div>
              </td>
              <td
                className="py-2 px-4 max-w-[280px] truncate"
                style={{
                  color: 'var(--text-secondary)',
                  fontSize: 'var(--fs-body-sm)',
                }}
              >
                {txn.note ?? '-'}
              </td>
              <td className="py-2 px-4 text-right" data-privacy-field>
                <span
                  className="amount amount-sm"
                  style={{
                    color:
                      txn.type === 'income'
                        ? 'var(--income)'
                        : 'var(--expense)',
                  }}
                >
                  {/* Net share for split parents (matches the category
                      breakdown total, which uses COALESCE(net, gross));
                      plain rows fall back to their gross amount. */}
                  {formatAmount(
                    txn.netSpentInAccountCcy ?? txn.amountInAccountCcy,
                    decimalSeparator,
                  )}
                </span>
                <span className="currency-code">
                  {txn.account?.currency.toUpperCase() ?? ''}
                </span>
              </td>
              <td className="py-2 px-3 text-right whitespace-nowrap">
                <button
                  onClick={() => navigate(`/transactions/${txn.id}/edit`)}
                  className="p-1 rounded transition-opacity hover:opacity-70 cursor-pointer"
                  style={{ color: 'var(--text-muted)' }}
                  title="Edit transaction"
                  aria-label="Edit transaction"
                >
                  <Pencil size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

