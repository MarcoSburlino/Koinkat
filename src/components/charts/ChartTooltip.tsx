import type { ReactNode } from 'react';
import { formatAmount } from '../../lib/format';

export type SwatchKind = 'bar' | 'line' | 'dash' | 'dot';

export interface ChartTooltipRow {
  key: string;
  label: string;
  color: string;
  kind?: SwatchKind;
  /** Decimal STRING already quantized by the caller (never a float). */
  value: string | null;
  /** Optional muted text after the value (e.g. "of 1 800,00"). */
  suffix?: string;
}

/** Legend/tooltip key: the colored mark carries identity, text stays ink. */
export function Swatch({ color, kind = 'bar' }: { color: string; kind?: SwatchKind }) {
  if (kind === 'line' || kind === 'dash') {
    return (
      <svg width="14" height="8" aria-hidden className="shrink-0">
        <line
          x1="1"
          y1="4"
          x2="13"
          y2="4"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={kind === 'dash' ? '3 3' : undefined}
        />
      </svg>
    );
  }
  return (
    <span
      aria-hidden
      className="shrink-0 inline-block"
      style={{
        width: 8,
        height: 8,
        borderRadius: kind === 'dot' ? '9999px' : 2,
        backgroundColor: color,
      }}
    />
  );
}

/**
 * Tooltip body in the app's own type: label in sans, values in mono,
 * identity carried by the swatch. Callers build the rows from their own
 * string data (so amounts are formatted from decimal strings, not from
 * the floats Recharts was given for geometry). Render it from a
 * Recharts `content` callback:
 *
 *   <Tooltip {...chartTooltipProps}
 *     content={({ active, label, payload }) =>
 *       active && payload?.length ? <ChartTooltip title={label} rows={...} /> : null} />
 */
export function ChartTooltip({
  title,
  rows,
  currency,
  decimalSeparator,
  footer,
}: {
  title: string;
  rows: ChartTooltipRow[];
  currency: string;
  decimalSeparator: string;
  footer?: ReactNode;
}) {
  return (
    <div
      data-privacy-field
      style={{
        backgroundColor: 'var(--chart-tooltip-bg)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-2)',
        boxShadow: 'var(--elev-3)',
        padding: '10px 12px',
        minWidth: 180,
      }}
    >
      <p
        style={{
          color: 'var(--text)',
          fontSize: 'var(--fs-body-sm)',
          fontWeight: 'var(--fw-semibold)',
          marginBottom: 6,
        }}
      >
        {title}
      </p>
      <div className="flex flex-col gap-1">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center gap-2">
            <Swatch color={r.color} kind={r.kind} />
            <span
              className="flex-1"
              style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-body-sm)' }}
            >
              {r.label}
            </span>
            <span
              className="amount"
              style={{ color: 'var(--text)', fontSize: 'var(--fs-body-sm)' }}
            >
              {r.value === null ? '-' : formatAmount(r.value, decimalSeparator)}
              <span className="currency-code">{currency}</span>
            </span>
          </div>
        ))}
      </div>
      {footer && (
        <div
          className="mt-2 pt-2"
          style={{
            borderTop: '1px solid var(--border)',
            color: 'var(--text-muted)',
            fontSize: 'var(--fs-rate)',
          }}
        >
          {footer}
        </div>
      )}
    </div>
  );
}
