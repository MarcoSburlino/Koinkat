import { useEffect, useState } from 'react';
import { Link2 } from 'lucide-react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { formatAmount } from '../lib/format';
import { formatFullDate as formatDate } from '../lib/date-format';
import {
  findCounterpartsFor,
  confirmTransferPair,
  markAsTransferAlone,
  type TransferCounterpart,
} from '../services/transfer-detection-service';
import type { Transaction } from '../types/models';

/** Sentinel for "the other side isn't in Koinkat". */
const ALONE = '__alone__';

interface TransferPickerModalProps {
  /** The row being marked; null closes the modal. */
  transaction: Transaction | null;
  preferredCurrency: string;
  decimalSeparator: string;
  onClose: () => void;
  /** Called after the transfer was saved, with every row it now covers. */
  onDone: (transactionIds: string[]) => void;
}

/**
 * "This is a transfer": pick the row on your other account that it moved
 * money to (or from), or say that account isn't in Koinkat. Both choices
 * take the row out of income/expense totals and out of the Review queue.
 */
export function TransferPickerModal({
  transaction,
  preferredCurrency,
  decimalSeparator,
  onClose,
  onDone,
}: TransferPickerModalProps) {
  const [counterparts, setCounterparts] = useState<TransferCounterpart[]>([]);
  const [loading, setLoading] = useState(false);
  const [choice, setChoice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!transaction) return;
    let cancelled = false;
    setCounterparts([]);
    setChoice(null);
    setError(null);
    setLoading(true);
    findCounterpartsFor(transaction.id, preferredCurrency)
      .then((found) => {
        if (cancelled) return;
        setCounterparts(found);
        // Pre-select only a match the bank itself confirms.
        if (found[0]?.certain) setChoice(found[0].id);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [transaction, preferredCurrency]);

  async function handleSave() {
    if (!transaction || !choice) return;
    setSaving(true);
    setError(null);
    try {
      if (choice === ALONE) {
        await markAsTransferAlone(transaction.id);
        onDone([transaction.id]);
      } else {
        const [outflowId, inflowId] =
          transaction.type === 'expense' ? [transaction.id, choice] : [choice, transaction.id];
        await confirmTransferPair(outflowId, inflowId);
        onDone([transaction.id, choice]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const goingOut = transaction?.type === 'expense';

  return (
    <Modal open={transaction !== null} onClose={onClose} size="lg" title="Mark as a transfer">
      {transaction && (
        <>
          <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
            {goingOut
              ? 'Which of your accounts did this money go to?'
              : 'Which of your accounts did this money come from?'}{' '}
            A transfer between your own accounts is not income or spending, so it
            leaves your totals and this queue.
          </p>

          <div
            className="flex flex-col rounded-lg overflow-hidden mb-4"
            style={{ border: '1px solid var(--border)' }}
          >
            {loading ? (
              <p className="px-4 py-3 text-sm" style={{ color: 'var(--text-muted)' }}>
                Looking for the other side...
              </p>
            ) : counterparts.length === 0 ? (
              <p className="px-4 py-3 text-sm" style={{ color: 'var(--text-muted)' }}>
                No {goingOut ? 'incoming' : 'outgoing'} transaction on your other
                accounts within two weeks of this one.
              </p>
            ) : (
              counterparts.map((c) => (
                <label
                  key={c.id}
                  className="flex items-center gap-3 px-4 py-2.5 cursor-pointer"
                  style={{
                    borderBottom: '1px solid var(--border)',
                    backgroundColor:
                      choice === c.id ? 'var(--nav-active-bg)' : 'transparent',
                  }}
                >
                  <input
                    type="radio"
                    name="transfer-counterpart"
                    checked={choice === c.id}
                    onChange={() => setChoice(c.id)}
                  />
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: c.accountColor }}
                  />
                  <span className="flex-1 min-w-0">
                    <span
                      className="block truncate"
                      style={{ color: 'var(--text)', fontSize: 'var(--fs-body-sm)' }}
                    >
                      {c.accountName}
                      {c.note ? ` · ${c.note}` : ''}
                    </span>
                    <span
                      className="block"
                      style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-rate)' }}
                    >
                      {formatDate(c.date)}
                      {c.dayGap > 0 && ` · ${c.dayGap} day${c.dayGap !== 1 ? 's' : ''} apart`}
                    </span>
                  </span>
                  {c.certain && (
                    <span
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded shrink-0"
                      title="The bank reports that this is the other side."
                      style={{
                        backgroundColor: 'color-mix(in srgb, var(--income) 15%, transparent)',
                        color: 'var(--income)',
                        fontSize: 'var(--fs-rate)',
                      }}
                    >
                      <Link2 size={11} aria-hidden />
                      Same account number
                    </span>
                  )}
                  <span
                    className="amount amount-sm shrink-0"
                    style={{ color: c.type === 'income' ? 'var(--income)' : 'var(--expense)' }}
                    data-privacy-field
                  >
                    {c.type === 'income' ? '+' : '-'}
                    {formatAmount(c.amount, decimalSeparator)}
                  </span>
                  <span className="currency-code shrink-0">{c.currency}</span>
                </label>
              ))
            )}
            <label
              className="flex items-center gap-3 px-4 py-2.5 cursor-pointer"
              style={{
                backgroundColor: choice === ALONE ? 'var(--nav-active-bg)' : 'transparent',
              }}
            >
              <input
                type="radio"
                name="transfer-counterpart"
                checked={choice === ALONE}
                onChange={() => setChoice(ALONE)}
              />
              <span style={{ color: 'var(--text)', fontSize: 'var(--fs-body-sm)' }}>
                The other account isn't in Koinkat
              </span>
            </label>
          </div>

          {error && (
            <p className="text-sm mb-3" style={{ color: 'var(--danger)' }}>
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="button" onClick={handleSave} disabled={!choice || saving}>
              {saving ? 'Saving...' : 'Mark as transfer'}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
