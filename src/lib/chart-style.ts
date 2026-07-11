/**
 * Shared Recharts axis/grid props. Summary and Budgets each inlined the
 * same tick/axisLine/grid config; spread these instead:
 *
 *   <XAxis dataKey="month" {...chartAxisStyle} />
 *   <CartesianGrid {...chartGridStyle} />
 */
export const chartAxisStyle = {
  tick: { fill: 'var(--text-muted)', fontSize: 12 },
  axisLine: { stroke: 'var(--border)' },
  tickLine: false,
} as const;

export const chartGridStyle = {
  strokeDasharray: '3 3',
  stroke: 'var(--border)',
} as const;

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
