/**
 * Shared Recharts chrome. Every chart in the app spreads these so axes,
 * grids and tooltips read as one system:
 *
 *   <XAxis dataKey="month" {...chartAxisStyle} />
 *   <YAxis {...chartValueAxisStyle} tickFormatter={axisTick(sep)} />
 *   <CartesianGrid {...chartGridStyle} />
 *   <Tooltip {...chartTooltipProps} content={<ChartTooltip ... />} />
 *
 * Rules (dataviz method): gridlines are solid 1px hairlines one step off
 * the surface, horizontal only; axis rules are dropped (the baseline grid
 * line carries it); tick text is muted and mono so digits align.
 */

const TICK_FONT = 'var(--font-mono)';

/** Category axis (months, labels). */
export const chartAxisStyle = {
  tick: { fill: 'var(--text-muted)', fontSize: 11, fontFamily: 'var(--font-sans)' },
  axisLine: false,
  tickLine: false,
  tickMargin: 8,
} as const;

/** Value axis (amounts). Pair with `tickFormatter={axisTick(sep)}`. */
export const chartValueAxisStyle = {
  tick: { fill: 'var(--text-muted)', fontSize: 11, fontFamily: TICK_FONT },
  axisLine: false,
  tickLine: false,
  width: 52,
  tickMargin: 6,
} as const;

export const chartGridStyle = {
  stroke: 'var(--chart-grid)',
  strokeWidth: 1,
  vertical: false,
} as const;

/** Spread on <Tooltip> alongside a `content={<ChartTooltip />}`. */
export const chartTooltipProps = {
  cursor: { fill: 'var(--surface-alt)', opacity: 0.6 },
  wrapperStyle: { outline: 'none', zIndex: 5 },
  isAnimationActive: false,
} as const;

/** Crosshair cursor for line/area charts. */
export const chartLineCursor = {
  stroke: 'var(--border-strong)',
  strokeWidth: 1,
} as const;

/**
 * @deprecated Kept for call sites not yet moved to `ChartTooltip`.
 */
export const chartTooltipStyle = {
  contentStyle: {
    backgroundColor: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-2)',
    color: 'var(--text)',
    fontSize: 'var(--fs-body-sm)',
    boxShadow: 'var(--elev-3)',
  },
  labelStyle: {
    color: 'var(--text-secondary)',
    fontSize: 'var(--fs-body-sm)',
    fontWeight: 500,
    marginBottom: 4,
  },
  itemStyle: {
    color: 'var(--text)',
    fontSize: 'var(--fs-body-sm)',
    padding: 0,
  },
} as const;

/**
 * Axis tick formatter. display-boundary: Recharts hands us a JS number
 * for an AXIS position, never an amount the user reads as money, so no
 * money math happens here. Full figures under 10 000 (0 / 1 500 / 3 000),
 * compact above (10K / 20K), one style per axis tick.
 */
export function axisTick(decimalSeparator: string) {
  const group = decimalSeparator === ',' ? '.' : ',';
  return (value: number): string => {
    if (!Number.isFinite(value)) return '';
    const abs = Math.abs(value);
    const sign = value < 0 ? '-' : '';
    if (abs >= 10000) {
      const k = abs / 1000;
      const txt = Number.isInteger(k) ? String(k) : k.toFixed(1);
      return `${sign}${txt.replace('.', decimalSeparator)}K`;
    }
    const whole = String(Math.round(abs));
    return sign + whole.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  };
}

/**
 * Round value-axis ticks: 0 and 3-5 evenly spaced clean steps (1/2/2.5/5
 * x 10^n) covering `max`. Recharts' own nice-ing is skipped when the
 * domain is a function, which produced ticks like 4 305.
 */
export function niceTicks(max: number, target = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0];
  const raw = max / target;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  const ticks: number[] = [];
  for (let v = 0; v < max + step * 0.999; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}

/** Number of validated categorical slots (see --viz-1..6 in index.css). */
export const CATEGORICAL_SLOTS = 6;

/**
 * Colour for the i-th category of a ranked list: the six validated slots
 * in fixed order, then the neutral "Other" for everything past them -
 * never a cycled or generated hue (cycling made the 7th category look
 * identical to the 1st).
 */
export function categoricalColor(i: number): string {
  return i < CATEGORICAL_SLOTS ? `var(--viz-${i + 1})` : 'var(--viz-other)';
}

/**
 * Text colour for a label printed INSIDE a categorical fill: white or
 * near-black, whichever has the higher contrast on that slot in the
 * current theme (--on-viz-N tokens in index.css, measured per fill).
 */
export function categoricalInk(i: number): string {
  return i < CATEGORICAL_SLOTS ? `var(--on-viz-${i + 1})` : 'var(--on-viz-other)';
}
