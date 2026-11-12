import { useId } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  chartAxisStyle,
  chartValueAxisStyle,
  chartGridStyle,
  chartTooltipProps,
  chartLineCursor,
  axisTick,
  niceTicks,
} from '../../lib/chart-style';
import { ChartTooltip } from './ChartTooltip';

export interface TrendPoint {
  label: string;
  /** Decimal string; coerced only for geometry. */
  value: string;
}

/**
 * Single-series area trend (balance over time). 2px line, a ~10% wash,
 * crosshair + tooltip on hover, the last point ringed and labelled.
 * The y-axis starts near the data rather than at zero: a balance moving
 * between 11 000 and 27 000 would otherwise be a flat line on a tall
 * empty plot (line charts may truncate; bar charts never do).
 */
export function TrendChart({
  points,
  currency,
  decimalSeparator,
  seriesLabel,
  color = 'var(--viz-1)',
  height = 200,
}: {
  points: TrendPoint[];
  currency: string;
  decimalSeparator: string;
  seriesLabel: string;
  color?: string;
  height?: number;
}) {
  const gid = useId().replace(/:/g, '');
  // display-boundary: geometry only.
  const data = points.map((p) => ({ ...p, num: Number(p.value) }));
  const nums = data.map((d) => d.num);
  const hi = Math.max(0, ...nums);
  const lo = Math.min(0, ...nums);
  const minPositive = Math.min(...nums);
  // Truncate the floor only when every value is positive and the range is
  // narrow relative to the level; otherwise keep zero for honesty.
  const floor = lo >= 0 && minPositive > hi * 0.4 ? Math.floor(minPositive * 0.9) : lo;
  const span = niceTicks(hi - floor);
  const step = span.length > 1 ? span[1] : hi;
  const start = step > 0 ? Math.floor(floor / step) * step : 0;
  const ticks: number[] = [];
  for (let v = start; v < hi + step * 0.999 && ticks.length < 8; v += step) ticks.push(v);

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.2} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid {...chartGridStyle} />
          <XAxis dataKey="label" {...chartAxisStyle} />
          <YAxis
            {...chartValueAxisStyle}
            tickFormatter={axisTick(decimalSeparator)}
            domain={[ticks[0] ?? 0, ticks[ticks.length - 1] ?? hi]}
            ticks={ticks}
          />
          <Tooltip
            {...chartTooltipProps}
            cursor={chartLineCursor}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as TrendPoint;
              return (
                <ChartTooltip
                  title={d.label}
                  currency={currency}
                  decimalSeparator={decimalSeparator}
                  rows={[{ key: 'v', label: seriesLabel, color, kind: 'line', value: d.value }]}
                />
              );
            }}
          />
          <Area
            dataKey="num"
            type="linear"
            stroke={color}
            strokeWidth={2}
            fill={`url(#${gid})`}
            dot={(props: { cx?: number; cy?: number; index?: number }) =>
              props.index === data.length - 1 && props.cx != null && props.cy != null ? (
                <circle
                  key="last"
                  cx={props.cx}
                  cy={props.cy}
                  r={4}
                  fill={color}
                  stroke="var(--surface)"
                  strokeWidth={2}
                />
              ) : (
                <g key={`d${props.index}`} />
              )
            }
            activeDot={{ r: 4, fill: color, stroke: 'var(--surface)', strokeWidth: 2 }}
            animationDuration={350}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
