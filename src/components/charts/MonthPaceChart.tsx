import { useMemo } from 'react';
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ReferenceDot,
  ResponsiveContainer,
} from 'recharts';
import { dec, qCent } from '../../domain/money';
import type { PeriodDailySpending } from '../../services/budget-service';
import {
  chartAxisStyle,
  chartValueAxisStyle,
  chartGridStyle,
  chartTooltipProps,
  chartLineCursor,
  axisTick,
  niceTicks,
} from '../../lib/chart-style';
import { projectMonthEnd } from '../../lib/budget-pace';
import { ChartTooltip, type ChartTooltipRow } from './ChartTooltip';
import { MONTH_NAMES_SHORT } from '../../lib/date-constants';

interface PacePoint {
  day: number;
  date: string;
  /** Geometry only (display-boundary floats); labels use the strings. */
  actual: number | null;
  pace: number;
  projected: number | null;
  actualStr: string | null;
  paceStr: string;
  projectedStr: string | null;
}

/**
 * Burn-up chart for one budget month: the running total of what was
 * spent (solid line + wash) against a straight "on track" line from zero
 * to the limit, with the limit itself as a hairline ceiling.
 *
 * For the current month the line stops at today, a ringed dot marks
 * where you are, and a dashed projection continues today's average daily
 * spend to month end - the "where am I heading" a percentage can't show.
 *
 * All money math is Big on decimal strings; floats exist only as the
 * terminal coercion Recharts needs for geometry.
 */
export function MonthPaceChart({
  daily,
  limit,
  currency,
  decimalSeparator,
  today,
  height = 220,
}: {
  daily: PeriodDailySpending;
  /** Effective limit for the month (decimal string). */
  limit: string;
  currency: string;
  decimalSeparator: string;
  /** YYYY-MM-DD; days after it are in the future. */
  today: string;
  height?: number;
}) {
  const { points, todayPoint, overLimit, ticks } = useMemo(() => {
    const n = daily.days.length;
    const lim = dec(limit);
    const isFuture = today < daily.periodStart;
    const isPast = today > daily.periodEnd;
    // Projection shares projectMonthEnd with the "Projected" stat, so the
    // dashed line ends exactly on the figure printed above the chart.
    const proj = !isFuture && !isPast ? projectMonthEnd(daily.days, today) : null;
    const lastIdx = proj ? proj.todayIndex : isFuture ? -1 : n - 1;
    const typical = proj ? dec(proj.typicalDay) : null;

    const pts: PacePoint[] = daily.days.map((d, i) => {
      const paceD = qCent(lim.times(i + 1).div(n));
      const hasActual = i <= lastIdx;
      const projD =
        proj && typical && i >= lastIdx
          ? qCent(dec(daily.days[lastIdx].cumulative).plus(typical.times(i - lastIdx)))
          : null;
      return {
        day: i + 1,
        date: d.date,
        // display-boundary: geometry only; labels use the *Str fields.
        actual: hasActual ? Number(d.cumulative) : null,
        pace: paceD.toNumber(),
        projected: projD ? projD.toNumber() : null,
        actualStr: hasActual ? d.cumulative : null,
        paceStr: paceD.toFixed(2),
        projectedStr: projD ? projD.toFixed(2) : null,
      };
    });

    const tp = lastIdx >= 0 ? pts[lastIdx] : null;
    const max = Math.max(
      lim.toNumber(),
      ...pts.map((p) => Math.max(p.actual ?? 0, p.projected ?? 0)),
    );
    return {
      points: pts,
      todayPoint: tp,
      overLimit: tp?.actualStr ? dec(tp.actualStr).gt(lim) : false,
      ticks: niceTicks(max),
    };
  }, [daily, limit, today]);
  // Identity colour, not status: the meter and the stat tiles carry
  // "ahead of pace / over", so the legend swatch always matches the line.
  const lineColor = 'var(--viz-1)';

  const monthLabel = MONTH_NAMES_SHORT[parseInt(daily.periodStart.slice(5, 7), 10) - 1];
  const limitNum = Number(limit);
  const tick = axisTick(decimalSeparator);
  const gradientId = 'pace-wash';

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={lineColor} stopOpacity={0.22} />
              <stop offset="100%" stopColor={lineColor} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid {...chartGridStyle} />
          <XAxis
            dataKey="day"
            {...chartAxisStyle}
            ticks={[1, 8, 15, 22, points.length]}
            tickFormatter={(d: number) => `${d} ${monthLabel}`}
          />
          <YAxis
            {...chartValueAxisStyle}
            tickFormatter={tick}
            domain={[0, ticks[ticks.length - 1]]}
            ticks={ticks}
          />
          <Tooltip
            {...chartTooltipProps}
            cursor={chartLineCursor}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as PacePoint;
              const rows: ChartTooltipRow[] = [];
              if (p.actualStr !== null)
                rows.push({ key: 'a', label: 'Spent so far', color: lineColor, kind: 'line', value: p.actualStr });
              if (p.projectedStr !== null && p.actualStr === null)
                rows.push({ key: 'p', label: 'Projected', color: lineColor, kind: 'dash', value: p.projectedStr });
              rows.push({ key: 'o', label: 'On track', color: 'var(--text-muted)', kind: 'dash', value: p.paceStr });
              return (
                <ChartTooltip
                  title={`${p.day} ${monthLabel}`}
                  rows={rows}
                  currency={currency}
                  decimalSeparator={decimalSeparator}
                />
              );
            }}
          />
          <ReferenceLine
            y={limitNum}
            stroke="var(--text-secondary)"
            strokeWidth={1}
            ifOverflow="extendDomain"
            label={{
              value: 'Limit',
              position: 'insideBottomLeft',
              offset: 6,
              fill: 'var(--text-secondary)',
              fontSize: 11,
            }}
          />
          <Line
            dataKey="pace"
            stroke="var(--text-muted)"
            strokeWidth={1.5}
            strokeDasharray="4 4"
            dot={false}
            activeDot={false}
            isAnimationActive={false}
          />
          <Line
            dataKey="projected"
            stroke={lineColor}
            strokeOpacity={0.6}
            strokeWidth={2}
            strokeDasharray="2 4"
            strokeLinecap="round"
            dot={false}
            activeDot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
          <Area
            dataKey="actual"
            type="linear"
            stroke={lineColor}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={false}
            activeDot={{ r: 4, fill: lineColor, stroke: 'var(--surface)', strokeWidth: 2 }}
            connectNulls={false}
            animationDuration={350}
          />
          {todayPoint && todayPoint.actual !== null && (
            <ReferenceDot
              x={todayPoint.day}
              y={todayPoint.actual}
              r={5}
              fill={lineColor}
              stroke="var(--surface)"
              strokeWidth={2}
              ifOverflow="extendDomain"
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
      {overLimit && <span className="sr-only">Spending is over the limit.</span>}
    </div>
  );
}
