import { useMemo } from 'react';
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
import type { YearlyBudgetData } from '../../services/budget-service';
import {
  chartAxisStyle,
  chartValueAxisStyle,
  chartGridStyle,
  chartTooltipProps,
  axisTick,
  niceTicks,
} from '../../lib/chart-style';
import { ChartTooltip, type ChartTooltipRow } from './ChartTooltip';
import { MONTH_NAMES_SHORT } from '../../lib/date-constants';

interface MonthDatum {
  id: string;
  name: string;
  /** Geometry (display-boundary floats). */
  allowance: number;
  base: number;
  spentNum: number;
  /** Strings for every label/tooltip. */
  spent: string | null;
  baseLimit: string;
  eventContribution: string;
  effectiveLimit: string;
  remaining: string;
  isFuture: boolean;
  isFocused: boolean;
  isOver: boolean;
}

const MAX_BAR = 28;

/**
 * Bullet chart per month: a pale column is the allowance (usual limit,
 * with event top-ups as a gold cap), the solid bar inside it is what was
 * actually spent. Spending past the allowance continues above it in red.
 * Future months show the allowance alone. The focused month is outlined.
 */
export function AnnualBudgetChart({
  yearlyData,
  decimalSeparator,
  focusedPeriodId,
  onSelectPeriod,
  height = 240,
}: {
  yearlyData: YearlyBudgetData;
  decimalSeparator: string;
  focusedPeriodId: string | null;
  onSelectPeriod?: (periodId: string) => void;
  height?: number;
}) {
  const currency = yearlyData.budget.currency;
  const data = useMemo<MonthDatum[]>(() => {
    const currentMonth = new Date().toISOString().slice(0, 7);
    return yearlyData.periods.map((p) => {
      const isFuture = p.periodStart.slice(0, 7) > currentMonth;
      const spentD = dec(p.spent);
      return {
        id: p.id,
        name: MONTH_NAMES_SHORT[parseInt(p.periodStart.slice(5, 7), 10) - 1],
        // display-boundary: terminal coercions of quantized strings for
        // bar geometry; no arithmetic is done on these floats.
        allowance: Number(p.effectiveLimit),
        base: Number(p.baseLimit),
        spentNum: isFuture ? 0 : Number(p.spent),
        spent: isFuture ? null : p.spent,
        baseLimit: p.baseLimit,
        eventContribution: p.eventContribution,
        effectiveLimit: p.effectiveLimit,
        remaining: p.remaining,
        isFuture,
        isFocused: p.id === focusedPeriodId,
        isOver: !isFuture && spentD.gt(dec(p.effectiveLimit)),
      };
    });
  }, [yearlyData.periods, focusedPeriodId]);

  const maxValue = Math.max(0, ...data.map((d) => Math.max(d.allowance, d.spentNum)));
  const tick = axisTick(decimalSeparator);
  const ticks = niceTicks(maxValue);

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 8, right: 4, bottom: 0, left: 0 }}
          onClick={(e) => {
            const idx = e?.activeTooltipIndex;
            if (onSelectPeriod && typeof idx === 'number' && data[idx]) {
              onSelectPeriod(data[idx].id);
            }
          }}
        >
          <CartesianGrid {...chartGridStyle} />
          <XAxis dataKey="name" {...chartAxisStyle} />
          <YAxis
            {...chartValueAxisStyle}
            tickFormatter={tick}
            domain={[0, ticks[ticks.length - 1]]}
            ticks={ticks}
          />
          <Tooltip
            {...chartTooltipProps}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as MonthDatum;
              const rows: ChartTooltipRow[] = [];
              if (d.spent !== null)
                rows.push({
                  key: 's',
                  label: 'Spent',
                  color: d.isOver ? 'var(--expense)' : 'var(--viz-1)',
                  value: d.spent,
                });
              rows.push({ key: 'b', label: 'Usual limit', color: 'var(--chart-allowance)', value: d.baseLimit });
              if (dec(d.eventContribution).gt(0))
                rows.push({ key: 'e', label: 'From events', color: 'var(--viz-2)', value: d.eventContribution });
              if (d.spent !== null)
                rows.push({ key: 'r', label: dec(d.remaining).lt(0) ? 'Over by' : 'Left', color: 'transparent', value: dec(d.remaining).abs().toFixed(2) });
              return (
                <ChartTooltip
                  title={d.name}
                  rows={rows}
                  currency={currency}
                  decimalSeparator={decimalSeparator}
                  footer={onSelectPeriod ? 'Click to focus this month' : undefined}
                />
              );
            }}
          />
          <Bar
            dataKey="allowance"
            isAnimationActive={false}
            cursor={onSelectPeriod ? 'pointer' : undefined}
            shape={(props: unknown) => <BulletShape {...(props as BulletProps)} />}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

interface BulletProps {
  x: number;
  y: number;
  width: number;
  height: number;
  background?: { y: number; height: number };
  payload: MonthDatum;
}

function BulletShape({ x, y, width, height, payload: d }: BulletProps) {
  if (!Number.isFinite(height) || height <= 0 || d.allowance <= 0) return null;
  const w = Math.min(width * 0.7, MAX_BAR);
  const cx = x + (width - w) / 2;
  const baseline = y + height;
  const pxPerUnit = height / d.allowance;

  // Allowance column: usual limit + gold event cap, 2px surface gap.
  const eventPx = (d.allowance - d.base) * pxPerUnit;
  const basePx = height - eventPx;

  // Spent bar sits inside, slightly narrower; overflow continues above.
  const sw = Math.max(w - 10, 8);
  const sx = x + (width - sw) / 2;
  const spentPx = d.spentNum * pxPerUnit;
  const withinPx = Math.min(spentPx, height);
  const overPx = Math.max(spentPx - height, 0);
  const r = 4;

  return (
    <g>
      {d.isFocused && (
        <rect
          x={cx - 4}
          y={Math.min(y, baseline - spentPx) - 4}
          width={w + 8}
          height={Math.max(height, spentPx) + 4}
          rx={6}
          fill="none"
          stroke="var(--border-strong)"
          strokeWidth={1}
        />
      )}
      <path d={topRounded(cx, baseline - basePx, w, basePx, eventPx > 2 ? 0 : r)} fill="var(--chart-allowance)" />
      {eventPx > 2 && (
        <path
          d={topRounded(cx, y, w, eventPx - 2, r)}
          fill="color-mix(in srgb, var(--viz-2) 55%, var(--chart-allowance))"
        />
      )}
      {withinPx > 0 && (
        <path
          d={topRounded(sx, baseline - withinPx, sw, withinPx, overPx > 0 ? 0 : r)}
          fill={d.isOver ? 'var(--expense)' : 'var(--viz-1)'}
          opacity={d.isFuture ? 0 : 1}
        />
      )}
      {overPx > 0 && (
        <path d={topRounded(sx, y - overPx, sw, overPx, r)} fill="var(--expense)" />
      )}
      {/* Generous hit target for hover/click. */}
      <rect x={x} y={Math.min(y, baseline - spentPx)} width={width} height={Math.max(height, spentPx)} fill="transparent" />
    </g>
  );
}

/** Rect path rounded at the top corners only (square on the baseline). */
function topRounded(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return [
    `M${x},${y + h}`,
    `L${x},${y + rr}`,
    `Q${x},${y} ${x + rr},${y}`,
    `L${x + w - rr},${y}`,
    `Q${x + w},${y} ${x + w},${y + rr}`,
    `L${x + w},${y + h}`,
    'Z',
  ].join(' ');
}
