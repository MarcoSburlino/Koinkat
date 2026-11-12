import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { dec } from '../../domain/money';
import {
  chartAxisStyle,
  chartValueAxisStyle,
  chartGridStyle,
  chartTooltipProps,
  axisTick,
  niceTicks,
} from '../../lib/chart-style';
import { ChartTooltip } from './ChartTooltip';

export interface CashflowMonth {
  label: string;
  /** Decimal strings; the chart coerces them only for bar geometry. */
  income: string;
  expense: string;
}

/**
 * Money in vs money out per month: paired thin columns (income, expense)
 * from one baseline, 2px surface gap between them, capped width so the
 * band's leftover stays air. The tooltip adds what was kept that month.
 */
export function CashflowChart({
  months,
  currency,
  decimalSeparator,
  onSelectMonth,
  height = 280,
}: {
  months: CashflowMonth[];
  currency: string;
  decimalSeparator: string;
  onSelectMonth?: (index: number) => void;
  height?: number;
}) {
  // display-boundary: terminal coercions for bar geometry only.
  const data = months.map((m) => ({
    ...m,
    incomeNum: Number(m.income),
    expenseNum: Number(m.expense),
  }));
  const max = Math.max(0, ...data.map((d) => Math.max(d.incomeNum, d.expenseNum)));
  const ticks = niceTicks(max);

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          barGap={2}
          barCategoryGap="28%"
          margin={{ top: 8, right: 4, bottom: 0, left: 0 }}
          onClick={(e) => {
            const i = e?.activeTooltipIndex;
            if (onSelectMonth && typeof i === 'number') onSelectMonth(i);
          }}
        >
          <CartesianGrid {...chartGridStyle} />
          <XAxis dataKey="label" {...chartAxisStyle} />
          <YAxis
            {...chartValueAxisStyle}
            tickFormatter={axisTick(decimalSeparator)}
            domain={[0, ticks[ticks.length - 1]]}
            ticks={ticks}
          />
          <Tooltip
            {...chartTooltipProps}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as CashflowMonth;
              const kept = dec(d.income).minus(dec(d.expense));
              return (
                <ChartTooltip
                  title={d.label}
                  currency={currency}
                  decimalSeparator={decimalSeparator}
                  rows={[
                    { key: 'i', label: 'Money in', color: 'var(--income)', value: d.income },
                    { key: 'e', label: 'Money out', color: 'var(--expense)', value: d.expense },
                    {
                      key: 'k',
                      label: kept.gte(0) ? 'Kept' : 'Overspent',
                      color: 'transparent',
                      value: kept.abs().toFixed(2),
                    },
                  ]}
                  footer={onSelectMonth ? 'Click to see this month by category' : undefined}
                />
              );
            }}
          />
          <Bar
            dataKey="incomeNum"
            fill="var(--income)"
            radius={[4, 4, 0, 0]}
            maxBarSize={18}
            cursor={onSelectMonth ? 'pointer' : undefined}
            animationDuration={350}
          />
          <Bar
            dataKey="expenseNum"
            fill="var(--expense)"
            radius={[4, 4, 0, 0]}
            maxBarSize={18}
            cursor={onSelectMonth ? 'pointer' : undefined}
            animationDuration={350}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
