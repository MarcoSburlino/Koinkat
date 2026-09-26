import { ArrowLeftRight, Check, X, Link2 } from 'lucide-react';
import { PrivacyField } from './ui/PrivacyField';
import { formatAmount } from '../lib/format';
import { formatFullDate as formatDate } from '../lib/date-format';
import { dec } from '../domain/money';
import type {
  TransferCandidate,
  TransferSide,
} from '../services/transfer-detection-service';

interface TransferCandidateRowProps {
  candidate: TransferCandidate;
  decimalSeparator: string;
  busy: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
  /** Row divider colour; the Transactions banner tints it. */
  borderColor?: string;
}

/**
 * One suggested transfer: the outgoing row, the incoming row, how sure the
 * match is, and Confirm / Not a transfer. Shared by the Review page and the
 * Transactions banner so both read the same way.
 */
export function TransferCandidateRow({
  candidate: c,
  decimalSeparator,
  busy,
  onConfirm,
  onDismiss,
  borderColor = 'var(--border)',
}: TransferCandidateRowProps) {
  return (
    <div
      className="flex items-center justify-between gap-3 px-4 py-3"
      style={{ borderBottom: `1px solid ${borderColor}` }}
    >
      <div className="flex-1 min-w-0">
        <div
          className="flex items-center gap-2 flex-wrap"
          style={{ fontSize: 'var(--fs-body-sm)' }}
        >
          <SideLabel side={c.outflow} sign="-" color="var(--expense)" decimalSeparator={decimalSeparator} />
          <ArrowLeftRight size={14} style={{ color: 'var(--text-muted)' }} aria-label="to" />
          <SideLabel side={c.inflow} sign="+" color="var(--income)" decimalSeparator={decimalSeparator} />
        </div>
        <div className="mt-1 flex items-center gap-2 flex-wrap">
          {c.certain && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded"
              title="The bank reports that this money went to (or came from) your other account."
              style={{
                backgroundColor: 'color-mix(in srgb, var(--income) 15%, transparent)',
                color: 'var(--income)',
                fontSize: 'var(--fs-rate)',
                fontWeight: 'var(--fw-medium)',
              }}
            >
              <Link2 size={11} aria-hidden />
              Same account number
            </span>
          )}
          <PrivacyField
            as="span"
            style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-rate)' }}
          >
            {c.certain ? 'Confirmed by your bank' : `Match ${(c.score * 100).toFixed(0)}%`}
            {` · ${c.dayGap === 0 ? 'same day' : `${c.dayGap}-day gap`}`}
            {dec(c.fee).gt('0.005') &&
              ` · ~${formatAmount(c.fee, decimalSeparator)} ${c.feeCurrency} fee`}
            {c.isCrossCurrency && ' · cross-currency'}
          </PrivacyField>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 h-8 rounded cursor-pointer transition-opacity hover:opacity-85 disabled:opacity-50"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--income) 15%, transparent)',
            color: 'var(--income)',
            border: '1px solid color-mix(in srgb, var(--income) 40%, transparent)',
            fontSize: 'var(--fs-body-sm)',
            fontWeight: 'var(--fw-medium)',
          }}
        >
          <Check size={14} />
          It's a transfer
        </button>
        <button
          type="button"
          onClick={onDismiss}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 h-8 rounded cursor-pointer transition-opacity hover:opacity-85 disabled:opacity-50"
          style={{
            backgroundColor: 'transparent',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border)',
            fontSize: 'var(--fs-body-sm)',
            fontWeight: 'var(--fw-medium)',
          }}
        >
          <X size={14} />
          Not a transfer
        </button>
      </div>
    </div>
  );
}

function SideLabel({
  side,
  sign,
  color,
  decimalSeparator,
}: {
  side: TransferSide;
  sign: '-' | '+';
  color: string;
  decimalSeparator: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0" style={{ color: 'var(--text)' }}>
      <span
        className="w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: side.accountColor }}
      />
      <span className="truncate" style={{ fontWeight: 'var(--fw-medium)' }}>
        {side.accountName}
      </span>
      <span
        className="amount"
        style={{ color, fontSize: 'var(--fs-body-sm)' }}
        data-privacy-field
      >
        {sign}
        {formatAmount(side.amount, decimalSeparator)}
      </span>
      <span className="currency-code">{side.currency}</span>
      <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-rate)' }}>
        {formatDate(side.date)}
      </span>
    </span>
  );
}
