import type { ReactNode } from 'react';
import { formatAmount } from '../../lib/format';
import { UPPERCASE_LABEL_SM } from '../../lib/label-styles';

export type StatTone = 'default' | 'income' | 'expense' | 'danger' | 'muted';

const TONE_COLOR: Record<StatTone, string> = {
  default: 'var(--text)',
  income: 'var(--income)',
  expense: 'var(--expense)',
  danger: 'var(--danger)',
  muted: 'var(--text-muted)',
};

/**
 * The one stat tile used on every page (Summary, Analysis, Budgets,
 * Dashboard). Contract: label · value · optional hint line · optional
 * visual (sparkline / meter) underneath.
 *
 * - `amount` + `currency` render a money value (mono, privacy-blurred).
 * - `value` renders any other figure (a count, a percentage).
 * - `bare` drops the card chrome, for tiles grouped inside a parent card.
 */
export function StatTile({
  label,
  amount,
  currency,
  decimalSeparator = '.',
  value,
  tone = 'default',
  hint,
  icon,
  visual,
  size = 'md',
  bare = false,
  className = '',
}: {
  label: string;
  amount?: string | null;
  currency?: string;
  decimalSeparator?: string;
  value?: ReactNode;
  tone?: StatTone;
  hint?: ReactNode;
  icon?: ReactNode;
  visual?: ReactNode;
  size?: 'md' | 'lg';
  bare?: boolean;
  className?: string;
}) {
  const color = TONE_COLOR[tone];
  const valueSize = size === 'lg' ? 'var(--fs-amount-lg)' : 'var(--fs-amount-md)';

  const body = (
    <>
      <div className="flex items-center gap-1.5 mb-2">
        {icon && (
          <span style={{ color: 'var(--text-muted)' }} className="flex">
            {icon}
          </span>
        )}
        <p className="uppercase" style={UPPERCASE_LABEL_SM}>
          {label}
        </p>
      </div>
      {amount !== undefined ? (
        <div className="flex items-baseline" data-privacy-field>
          <span
            className="amount"
            style={{ color, fontSize: valueSize, fontWeight: 'var(--fw-semibold)' }}
          >
            {amount === null ? '--' : formatAmount(amount, decimalSeparator)}
          </span>
          {currency && amount !== null && <span className="currency-code">{currency}</span>}
        </div>
      ) : (
        <div
          className="amount"
          style={{ color, fontSize: valueSize, fontWeight: 'var(--fw-semibold)' }}
        >
          {value}
        </div>
      )}
      {hint && (
        <div
          className="mt-1.5"
          style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-body-sm)' }}
        >
          {hint}
        </div>
      )}
      {visual && <div className="mt-3">{visual}</div>}
    </>
  );

  if (bare) return <div className={`min-w-0 ${className}`}>{body}</div>;
  return (
    <div
      className={`min-w-0 p-5 ${className}`}
      style={{
        borderRadius: 'var(--radius-2)',
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--elev-1)',
      }}
    >
      {body}
    </div>
  );
}
