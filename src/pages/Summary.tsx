import { UPPERCASE_LABEL } from '../lib/label-styles';
import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { chartTooltipStyle, chartAxisStyle, chartGridStyle } from '../lib/chart-style';
import { dec } from '../domain/money';
import { TrendingUp, TrendingDown, ChevronRight } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { InfoBanner } from '../components/ui/InfoBanner';
import { Select } from '../components/ui/Select';
import { PageHeader } from '../components/layout/PageHeader';
import { useAppStore } from '../stores/app-store';
import { formatAmount, formatMoney } from '../lib/format';
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

  // Load accounts and available years on mount
  useEffect(() => {
    async function init() {
      const [accts, yrs] = await Promise.all([
        accountService.listAccounts(),
        availableYears(),
      ]);
      setAccounts(accts);
      setYears(yrs);
      if (yrs.length > 0 && !yrs.includes(selectedYear)) {
        setSelectedYear(yrs[0]);
      }
    }
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load summary data when filters change
  const loadSummary = useCallback(async () => {
    if (accounts.length === 0) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
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
      setData(summary);
      setNonBudgeted(nb.total);
    } catch (err) {
      console.error('Failed to load summary:', err);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [selectedYear, selectedAccountId, settings.preferredCurrency, accounts]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  // Build chart data from payload
  const chartData = data
    ? data.chartPayload.labels.map((label, i) => ({
        month: label,
        Income: data.chartPayload.income[i],
        Expenses: data.chartPayload.expense[i],
      }))
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
        label="Overview"
        title="Yearly summary"
        subtitle="How your income, spending and balance moved across the year."
      />

      {/* One-time tip: month rows drill into Analysis, which is otherwise
          only discoverable by hovering. Sits directly under the header,
          same slot as the other pages' tips. */}
      <InfoBanner storageKey="koinkat.tip.summaryDrill" className="mb-6">
        Click a month in the table below to see that month's spending by
        category.
      </InfoBanner>

      {/* Filters - carded, matching the Analysis page's filter treatment. */}
      <Card className="mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Select
            label="Year"
            options={yearOptions}
            value={String(selectedYear)}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
          />
          <Select
            label="Account"
            options={accountOptions}
            value={selectedAccountId}
            onChange={(e) => setSelectedAccountId(e.target.value)}
          />
        </div>
      </Card>

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
          {/* Metrics bar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-3">
            <MetricCard
              label="Starting balance"
              amount={data.totals.startingBalance}
              currency={settings.preferredCurrency}
              decimalSeparator={settings.decimalSeparator}
            />
            <MetricCard
              label="Total income"
              amount={data.totals.income}
              currency={settings.preferredCurrency}
              decimalSeparator={settings.decimalSeparator}
              tint="var(--income)"
            />
            <MetricCard
              label="Total expenses"
              amount={data.totals.expense}
              currency={settings.preferredCurrency}
              decimalSeparator={settings.decimalSeparator}
              tint="var(--expense)"
              subLabel="Excluded from budget"
              subAmount={dec(nonBudgeted).gt(0) ? nonBudgeted : undefined}
            />
            <MetricCard
              label="Net profit"
              amount={data.totals.profit}
              currency={settings.preferredCurrency}
              decimalSeparator={settings.decimalSeparator}
              tint={profitPositive ? 'var(--income)' : 'var(--expense)'}
              subText={savingsRateText ?? undefined}
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
                .join(', ')}{' '}
              , converted to {settings.preferredCurrency} at today's rates.
            </p>
          )}

          {/* Bar chart */}
          <Card className="mb-6">
            <p
              className="uppercase mb-4"
              style={UPPERCASE_LABEL}
            >
              Monthly income vs expenses
            </p>
            <div className="w-full" style={{ height: 320 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} barGap={4}>
                  <CartesianGrid {...chartGridStyle} />
                  <XAxis
                    dataKey="month"
                    {...chartAxisStyle}
                  />
                  <YAxis
                    {...chartAxisStyle}
                    width={70}
                  />
                  <Tooltip
                    formatter={(value: number) =>
                      formatMoney(String(value), settings.preferredCurrency, settings.decimalSeparator)
                    }
                    {...chartTooltipStyle}
                  />
                  <Legend
                    wrapperStyle={{ color: 'var(--text-muted)', fontSize: 'var(--fs-body-sm)' }}
                  />
                  <Bar dataKey="Income" fill="var(--income)" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Expenses" fill="var(--expense)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

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

// ── Inline metric card for the top row ────────────────────────────────────

interface MetricCardProps {
  label: string;
  amount: string;
  currency: string;
  decimalSeparator: string;
  /** Optional color tint for the amount (income / expense / primary). */
  tint?: string;
  /** Optional secondary line below the amount (e.g. "Excluded from budget"). */
  subLabel?: string;
  /** Decimal-string amount for the secondary line; renders it when set. */
  subAmount?: string;
  /** Free-text secondary line (e.g. the savings rate). */
  subText?: string;
}

function MetricCard({
  label,
  amount,
  currency,
  decimalSeparator,
  tint,
  subLabel,
  subAmount,
  subText,
}: MetricCardProps) {
  return (
    <Card>
      <p
        className="uppercase mb-2"
        style={UPPERCASE_LABEL}
      >
        {label}
      </p>
      <div className="flex items-baseline" data-privacy-field>
        <span
          className="amount amount-md"
          style={{ color: tint ?? 'var(--text)' }}
        >
          {formatAmount(amount, decimalSeparator)}
        </span>
        <span className="currency-code">{currency}</span>
      </div>
      {subAmount !== undefined && (
        <p
          className="mt-1"
          style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-body-sm)' }}
        >
          {subLabel}{' '}
          <span data-privacy-field>
            {formatAmount(subAmount, decimalSeparator)} {currency}
          </span>
        </p>
      )}
      {subText !== undefined && (
        <p
          className="mt-1"
          style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-body-sm)' }}
        >
          {subText}
        </p>
      )}
    </Card>
  );
}
