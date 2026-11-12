import { UPPERCASE_LABEL } from '../lib/label-styles';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChartCard } from '../components/charts/ChartCard';
import { CashflowChart } from '../components/charts/CashflowChart';
import { TrendChart } from '../components/charts/TrendChart';
import { StatTile } from '../components/ui/StatTile';
import { dec } from '../domain/money';
import { TrendingUp, TrendingDown, ChevronRight } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { InfoBanner } from '../components/ui/InfoBanner';
import { Select } from '../components/ui/Select';
import { PageHeader } from '../components/layout/PageHeader';
import { useAppStore } from '../stores/app-store';
import { useDataChanged } from '../hooks/useDataChanged';
import { formatAmount } from '../lib/format';
import * as accountService from '../services/account-service';
import { availableYears, buildYearlySummary, sumNonBudgetedExpenses } from '../services/reporting-service';
import type { Account } from '../types/models';
import type { YearlySummaryData } from '../services/reporting-service';

export function Summary() {
  const settings = useAppStore((s) => s.settings);
  const navigate = useNavigate();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [data, setData] = useState<YearlySummaryData | null>(null);
  // Off-budget spend for the selected year/account (is_budgeted = 0),
  // shown as a sub-line under Total expenses.
  const [nonBudgeted, setNonBudgeted] = useState<string>('0.00');
  const [loading, setLoading] = useState(true);

  // Only the first load shows the loading state. Later reloads - a filter
  // change, or a sync re-reading the accounts - keep the current figures
  // on screen until the new ones arrive, and an older, slower request never
  // overwrites a newer one.
  const hasShownData = useRef(false);
  const latestRequest = useRef(0);

  // Load accounts and available years on mount
  const init = useCallback(async () => {
    const [accts, yrs] = await Promise.all([
      accountService.listAccounts(),
      availableYears(),
    ]);
    setAccounts(accts);
    setYears(yrs);
    setSelectedYear((current) =>
      yrs.length > 0 && !yrs.includes(current) ? yrs[0] : current,
    );
  }, []);
  useEffect(() => {
    init().catch(console.warn);
  }, [init]);

  // A sync finished: balances and rows changed. Re-reading the accounts
  // re-runs the summary below.
  useDataChanged(() => {
    init().catch(console.warn);
  });

  // Load summary data when filters change
  const loadSummary = useCallback(async () => {
    const request = ++latestRequest.current;
    if (accounts.length === 0) {
      setData(null);
      setLoading(false);
      return;
    }
    if (!hasShownData.current) setLoading(true);
    try {
      const [summary, nb] = await Promise.all([
        buildYearlySummary({
          year: selectedYear,
          accountId: selectedAccountId || undefined,
          preferredCurrency: settings.preferredCurrency,
          accounts,
        }),
        sumNonBudgetedExpenses({
          year: selectedYear,
          accountId: selectedAccountId || undefined,
          preferredCurrency: settings.preferredCurrency,
        }),
      ]);
      if (request !== latestRequest.current) return;
      setData(summary);
      setNonBudgeted(nb.total);
      hasShownData.current = true;
    } catch (err) {
      if (request !== latestRequest.current) return;
      console.error('Failed to load summary:', err);
      setData(null);
    } finally {
      if (request === latestRequest.current) setLoading(false);
    }
  }, [selectedYear, selectedAccountId, settings.preferredCurrency, accounts]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  // Chart data from the string rows (the numeric chartPayload is only
  // geometry; tooltips must format the exact decimal strings).
  const cashflowMonths = data
    ? data.rows.map((r) => ({ label: r.label, income: r.income, expense: r.expense }))
    : [];
  // Balance trend: month-end balances up to the current month of the
  // current year (future months would repeat the last balance as a flat,
  // made-up tail).
  const now = new Date();
  const balancePoints = data
    ? data.rows
        .filter((r) => selectedYear < now.getFullYear() || r.month <= now.getMonth() + 1)
        .map((r) => ({ label: r.label, value: r.balance }))
    : [];

  // Filter options
  const yearOptions = years.map((y) => ({ value: String(y), label: String(y) }));
  const accountOptions = [
    { value: '', label: 'All accounts' },
    ...accounts.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` })),
  ];

  const profitPositive = data ? dec(data.totals.profit).gte(0) : true;

  // Months with no activity are noise in the breakdown table - hide
  // all-zero rows. The bar chart keeps the full year so the shape of the
  // year stays visible.
  const activeRows = data
    ? data.rows.filter(
        (row) => !(dec(row.income).eq(0) && dec(row.expense).eq(0)),
      )
    : [];

  // Savings rate - the one number people quote to themselves. Big for the
  // money division; formatted only for display. null when there's no income.
  const savingsRateText = (() => {
    if (!data || !dec(data.totals.income).gt(0)) return null;
    const rate = dec(data.totals.profit)
      .div(dec(data.totals.income))
      .times(100);
    return rate.gte(0)
      ? `You kept ${rate.toFixed(1)}% of your income`
      : `You spent ${rate.abs().toFixed(1)}% more than you earned`;
  })();

  return (
    <div>
      <PageHeader
        serif
        label="Insights"
        title="Yearly summary"
        subtitle="How your income, spending and balance moved across the year."
        right={
          <>
            <Select
              aria-label="Account"
              className="h-9"
              options={accountOptions}
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
            />
            <Select
              aria-label="Year"
              className="h-9"
              options={yearOptions}
              value={String(selectedYear)}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
            />
          </>
        }
      />

      {/* One-time tip: month rows drill into Analysis, which is otherwise
          only discoverable by hovering. Sits directly under the header,
          same slot as the other pages' tips. */}
      <InfoBanner storageKey="koinkat.tip.summaryDrill" className="mb-6">
        Click a month in the chart or the table to see that month's spending
        by category.
      </InfoBanner>

      {loading ? (
        <Card>
          <p
            className="text-center py-12"
            style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-body-sm)' }}
          >
            Loading...
          </p>
        </Card>
      ) : !data ? (
        <Card>
          <p
            className="text-center py-12"
            style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-body-sm)' }}
          >
            No data available for the selected period.
          </p>
        </Card>
      ) : (
        <>
          {/* Totals */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-3">
            <StatTile
              label="Starting balance"
              amount={data.totals.startingBalance}
              currency={settings.preferredCurrency}
              decimalSeparator={settings.decimalSeparator}
              hint="On 1 January"
            />
            <StatTile
              label="Money in"
              amount={data.totals.income}
              currency={settings.preferredCurrency}
              decimalSeparator={settings.decimalSeparator}
              tone="income"
            />
            <StatTile
              label="Money out"
              amount={data.totals.expense}
              currency={settings.preferredCurrency}
              decimalSeparator={settings.decimalSeparator}
              tone="expense"
              hint={
                dec(nonBudgeted).gt(0) ? (
                  <>
                    <span data-privacy-field className="amount">
                      {formatAmount(nonBudgeted, settings.decimalSeparator)} {settings.preferredCurrency}
                    </span>{' '}
                    not in the budget
                  </>
                ) : undefined
              }
            />
            <StatTile
              label="Kept"
              amount={data.totals.profit}
              currency={settings.preferredCurrency}
              decimalSeparator={settings.decimalSeparator}
              tone={profitPositive ? 'income' : 'expense'}
              hint={savingsRateText ?? undefined}
            />
          </div>

          {data.totals.contributingCurrencies.length > 1 && (
            <p
              className="mb-6"
              style={{
                color: 'var(--text-muted)',
                fontSize: 'var(--fs-body-sm)',
              }}
            >
              Aggregated across{' '}
              {data.totals.contributingCurrencies
                .map((c) => c.toUpperCase())
                .join(', ')}
              , converted to {settings.preferredCurrency} at today's rates.
            </p>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-[3fr_2fr] gap-4 mb-6">
            <ChartCard
              title="Money in and out"
              hint="Click a month to see where the money went."
              legend={[
                { label: 'In', color: 'var(--income)' },
                { label: 'Out', color: 'var(--expense)' },
              ]}
            >
              <CashflowChart
                months={cashflowMonths}
                currency={settings.preferredCurrency}
                decimalSeparator={settings.decimalSeparator}
                onSelectMonth={(i) =>
                  navigate(`/analysis?year=${selectedYear}&month=${data.rows[i].month}&type=expense`)
                }
              />
            </ChartCard>
            <ChartCard
              title="Balance"
              hint="At the end of each month, across the selected accounts."
            >
              <TrendChart
                points={balancePoints}
                currency={settings.preferredCurrency}
                decimalSeparator={settings.decimalSeparator}
                seriesLabel="Balance"
                height={280}
              />
            </ChartCard>
          </div>

          {/* Monthly breakdown table */}
          <Card>
            <p
              className="uppercase mb-4"
              style={UPPERCASE_LABEL}
            >
              Monthly breakdown
            </p>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['Month', 'Income', 'Expense', 'Profit', 'Balance', 'Balance Δ'].map((h, i) => (
                      <th
                        key={h}
                        className="py-2 px-3 font-medium uppercase"
                        title={
                          h === 'Balance Δ'
                            ? 'Month-over-month change of your total balance'
                            : h === 'Balance'
                              ? 'Balance at the end of the month. Transfers and money paid back to you move it too, so it can change by more or less than the month’s profit.'
                              : undefined
                        }
                        style={{
                          color: 'var(--text-secondary)',
                          fontSize: 'var(--fs-body-sm)',
                          letterSpacing: 'var(--ls-uppercase)',
                          textAlign: i === 0 ? 'left' : 'right',
                        }}
                      >
                        {h}
                      </th>
                    ))}
                    {/* Affordance column: the rows navigate to Analysis. */}
                    <th aria-hidden="true" style={{ width: 28 }} />
                  </tr>
                </thead>
                <tbody>
                  {activeRows.length === 0 && (
                    <tr>
                      <td
                        colSpan={7}
                        className="py-6 text-center"
                        style={{
                          color: 'var(--text-muted)',
                          fontSize: 'var(--fs-body-sm)',
                        }}
                      >
                        No activity recorded in {selectedYear}.
                      </td>
                    </tr>
                  )}
                  {activeRows.map((row) => {
                    const profitPos = dec(row.profit).gte(0);
                    const pct = row.changePct;

                    return (
                      <tr
                        key={row.month}
                        onClick={() =>
                          navigate(
                            `/analysis?year=${selectedYear}&month=${row.month}&type=expense`,
                          )
                        }
                        className="cursor-pointer transition-colors"
                        style={{ borderBottom: '1px solid var(--border)' }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor =
                            'var(--surface-alt)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = '';
                        }}
                      >
                        <td
                          className="py-2.5 px-3 font-medium"
                          style={{
                            color: 'var(--text)',
                            fontSize: 'var(--fs-body)',
                          }}
                        >
                          {row.label}
                        </td>
                        <td className="py-2.5 px-3 text-right" data-privacy-field>
                          <span className="amount amount-sm" style={{ color: 'var(--income)' }}>
                            {formatAmount(row.income, settings.decimalSeparator)}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right" data-privacy-field>
                          <span className="amount amount-sm" style={{ color: 'var(--expense)' }}>
                            {formatAmount(row.expense, settings.decimalSeparator)}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right" data-privacy-field>
                          <span
                            className="amount amount-sm"
                            style={{ color: profitPos ? 'var(--income)' : 'var(--expense)' }}
                          >
                            {formatAmount(row.profit, settings.decimalSeparator)}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right" data-privacy-field>
                          <span className="amount amount-sm" style={{ color: 'var(--text)' }}>
                            {formatAmount(row.balance, settings.decimalSeparator)}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          {pct !== null ? (
                            <span
                              className="inline-flex items-center gap-1 font-medium"
                              style={{
                                color: pct >= 0 ? 'var(--income)' : 'var(--expense)',
                                fontSize: 'var(--fs-body-sm)',
                              }}
                            >
                              {pct >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                              {Math.abs(pct).toFixed(2)}%
                            </span>
                          ) : (
                            <span
                              style={{
                                color: 'var(--text-muted)',
                                fontSize: 'var(--fs-body-sm)',
                              }}
                            >
                              --
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 pr-1 text-right">
                          <ChevronRight
                            size={14}
                            aria-hidden="true"
                            style={{ color: 'var(--text-muted)' }}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
