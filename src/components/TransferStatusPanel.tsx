import { useCallback, useEffect, useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { Button } from './ui/Button';
import { TransferPickerModal } from './TransferPickerModal';
import { formatAmount } from '../lib/format';
import { formatFullDate as formatDate } from '../lib/date-format';
import {
  getTransferPartners,
  unpairTransfer,
  type TransferSide,
} from '../services/transfer-detection-service';
import type { Transaction } from '../types/models';

interface TransferStatusPanelProps {
  transaction: Transaction;
  preferredCurrency: string;
  decimalSeparator: string;
  /** The row's transfer state changed; the page should re-read it. */
  onChanged: () => void;
}

/**
 * On a bank-imported income or expense: whether it is part of a transfer
 * between the user's own accounts, with the way in (Mark as transfer) and
 * the way out (Not a transfer). Undo is therefore always reachable, not only
 * from the moment right after confirming.
 */
export function TransferStatusPanel({
  transaction,
  preferredCurrency,
  decimalSeparator,
  onChanged,
}: TransferStatusPanelProps) {
  const [partners, setPartners] = useState<TransferSide[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pairId = transaction.transferPairId;

  const loadPartners = useCallback(async () => {
    if (!pairId) {
      setPartners([]);
      return;
    }
    try {
      setPartners(await getTransferPartners(pairId, transaction.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [pairId, transaction.id]);

  useEffect(() => {
    void loadPartners();
  }, [loadPartners]);

  // Native transfers already are transfers; split rows, repayments and fees
  // have their own meaning; pending rows can't be paired until they book.
  const canMark =
    (transaction.type === 'income' || transaction.type === 'expense') &&
    transaction.status === 'booked' &&
    transaction.relationKind === null &&
    transaction.splitStatus === null;
  if (!pairId && !canMark) return null;

  async function handleUndo() {
    if (!pairId) return;
    setBusy(true);
    setError(null);
    try {
      await unpairTransfer(pairId);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="flex flex-col gap-2 rounded-lg px-4 py-3"
      style={{
        backgroundColor: pairId
          ? 'color-mix(in srgb, var(--transfer) 10%, var(--surface))'
          : 'var(--surface-alt)',
        border: `1px solid ${pairId ? 'color-mix(in srgb, var(--transfer) 35%, var(--border))' : 'var(--border)'}`,
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <ArrowLeftRight
            size={16}
            aria-hidden
            style={{ color: pairId ? 'var(--transfer)' : 'var(--text-muted)' }}
          />
          <span style={{ color: 'var(--text)', fontSize: 'var(--fs-body-sm)' }}>
            {pairId
              ? 'Transfer between your accounts: not counted as income or spending.'
              : 'Money moved between two of your own accounts?'}
          </span>
        </div>
        {pairId ? (
          <Button type="button" variant="ghost" onClick={handleUndo} disabled={busy}>
            {busy ? 'Undoing...' : 'Not a transfer'}
          </Button>
        ) : (
          <Button type="button" variant="secondary" onClick={() => setPickerOpen(true)}>
            Mark as transfer
          </Button>
        )}
      </div>

      {pairId && (
        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-rate)' }}>
          {partners.length === 0
            ? "The other account isn't in Koinkat."
            : partners.map((p) => (
                <span key={p.id} className="inline-flex items-center gap-1.5 mr-3">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: p.accountColor }}
                  />
                  {transaction.type === 'expense' ? 'To' : 'From'} {p.accountName} ·{' '}
                  <span data-privacy-field>{formatAmount(p.amount, decimalSeparator)}</span>{' '}
                  {p.currency} · {formatDate(p.date)}
                </span>
              ))}
        </p>
      )}

      {error && (
        <p style={{ color: 'var(--danger)', fontSize: 'var(--fs-body-sm)' }}>{error}</p>
      )}

      <TransferPickerModal
        transaction={pickerOpen ? transaction : null}
        preferredCurrency={preferredCurrency}
        decimalSeparator={decimalSeparator}
        onClose={() => setPickerOpen(false)}
        onDone={() => {
          setPickerOpen(false);
          onChanged();
        }}
      />
    </div>
  );
}
