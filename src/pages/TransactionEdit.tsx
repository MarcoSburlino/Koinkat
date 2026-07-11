import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { CurrencyPicker } from '../components/ui/CurrencyPicker';
import { CategoryPicker } from '../components/ui/CategoryPicker';
import { BudgetEventPicker } from '../components/ui/BudgetEventPicker';
import { PageHeader } from '../components/layout/PageHeader';
import * as transactionService from '../services/transaction-service';
import * as accountService from '../services/account-service';
import * as recurringService from '../services/recurring-service';
import { dec } from '../domain/money';
import type { Account, Transaction } from '../types/models';
import type { RecurrenceCadence } from '../types/enums';

export function TransactionEdit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  // Loaded data
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  // Shared fields
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('');
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [feeAmount, setFeeAmount] = useState('');

  // Income/expense fields
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [isBudgeted, setIsBudgeted] = useState(true);
  const [isSplit, setIsSplit] = useState(false);
  // Recurring: initial reflects the stored link; cadence default monthly.
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurringCadence, setRecurringCadence] = useState<RecurrenceCadence>('monthly');

  // Budget event linkage - the picker is the single source of truth.
  // For in-range dates we still suggest a date-matching event, but ONLY
  // when nothing is currently picked - we never overwrite an explicit
  // user choice.
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  // Transfer fields
  const [sourceAccountId, setSourceAccountId] = useState('');
  const [destAccountId, setDestAccountId] = useState('');

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function load() {
      if (!id) return;

      const [txn, accts] = await Promise.all([
        transactionService.getTransactionById(id),
        accountService.listAccounts(),
      ]);

      if (!txn) {
        setLoading(false);
        return;
      }

      setTransaction(txn);
      setAccounts(accts);

      // Pre-fill shared fields
      setAmount(txn.amount);
      setCurrency(txn.currency);
      setDate(txn.date);
      setNote(txn.note ?? '');
      // Pre-fill from the existing fee child (if any): the service purges
      // and recreates fee children on every update, so an empty field on
      // save would silently delete the fee and shift the balance.
      const feeChild = await transactionService.getFeeChild(txn.id);
      setFeeAmount(feeChild ? feeChild.amount : '');

      if (txn.type === 'transfer') {
        setSourceAccountId(txn.accountId);
        setDestAccountId(txn.destinationAccountId ?? '');
      } else {
        setAccountId(txn.accountId);
        setCategoryId(txn.categoryId ?? null);
        setIsBudgeted(txn.isBudgeted);
        setIsSplit(txn.splitStatus != null);
        setIsRecurring(txn.recurringSeriesId != null);
      }

      // Seed picker from the stored transaction.
      setSelectedEventId(txn.budgetEventId);

      setLoading(false);
    }
    load();
  }, [id]);

  // NOTE: unlike TransactionCreate, Edit deliberately does NOT auto-suggest
  // a date-matching budget event. An existing row with no event is a state
  // the user (or the importer) already settled on - re-suggesting here
  // silently re-linked rows the user had left unassigned, and the
  // suggestion effect's null-check made picking "No event" snap back.

  const isTransfer = transaction?.type === 'transfer';

  function typeLabel(type: string): string {
    return type.charAt(0).toUpperCase() + type.slice(1);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!id) { navigate('/transactions'); return; }
    const newErrors: Record<string, string> = {};

    // Validate through `dec` (big.js), never raw `Number()` - consistent
    // with TransactionCreate/Transfer and the money-math invariant.
    if (!amount.trim()) {
      newErrors.amount = 'Amount must be greater than zero';
    } else {
      try {
        if (dec(amount.trim()).lte(0)) {
          newErrors.amount = 'Amount must be greater than zero';
        }
      } catch {
        newErrors.amount = 'Amount must be greater than zero';
      }
    }
    if (!currency) newErrors.currency = 'Currency is required';
    if (!date) newErrors.date = 'Date is required';

    if (isTransfer) {
      if (!sourceAccountId) newErrors.sourceAccountId = 'Source account is required';
      if (!destAccountId) newErrors.destAccountId = 'Destination account is required';
      if (sourceAccountId && destAccountId && sourceAccountId === destAccountId) {
        newErrors.destAccountId = 'Must differ from source account';
      }
    } else {
      if (!accountId) newErrors.accountId = 'Account is required';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setSubmitting(true);
    try {
      if (isTransfer) {
        await transactionService.updateTransfer(id!, {
          sourceAccountId,
          destAccountId,
          amount: amount.trim(),
          currency,
          date,
          note: note.trim() || undefined,
          feeAmount: feeAmount.trim() || undefined,
        });
      } else {
        await transactionService.updateIncomeExpense(id!, {
          accountId,
          amount: amount.trim(),
          currency,
          date,
          categoryId: categoryId ?? null,
          note: note.trim() || undefined,
          isBudgeted,
          budgetEventId: selectedEventId,
          feeAmount: feeAmount.trim() || undefined,
          // Only pass isSplit for expenses (income splitting is not a thing).
          isSplit: transaction?.type === 'expense' ? isSplit : undefined,
        });

        // Recurring: only act on a change, so the existing series link is
        // preserved when untouched. Flag/unflag both set recurring_locked.
        if (transaction?.type === 'expense') {
          const wasRecurring = transaction.recurringSeriesId != null;
          if (isRecurring && !wasRecurring) {
            try {
              await recurringService.flagTransactionAsRecurring(id!, {
                cadence: recurringCadence,
              });
            } catch (err) {
              console.warn('[TransactionEdit] flag recurring failed:', err);
            }
          } else if (!isRecurring && wasRecurring) {
            try {
              await recurringService.unflagRecurring(id!);
            } catch (err) {
              console.warn('[TransactionEdit] unflag recurring failed:', err);
            }
          }
        }

        // Mirroring Create: converting an existing expense to a split almost
        // always continues with "now link the repayments" - land on the
        // split detail page instead of stranding the user on the ledger.
        if (
          transaction?.type === 'expense' &&
          isSplit &&
          transaction.splitStatus == null
        ) {
          navigate(`/transactions/${id}/split`);
          return;
        }
      }
      navigate('/transactions');
    } catch (err) {
      setErrors({
        form: err instanceof Error ? err.message : 'Failed to update transaction',
      });
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        Loading...
      </p>
    );
  }

  if (!transaction) {
    return (
      <p className="text-sm" style={{ color: 'var(--danger)' }}>
        Transaction not found.
      </p>
    );
  }

  const accountOptions = accounts.map((a) => ({
    value: a.id,
    label: `${a.name} (${a.currency})`,
  }));

  return (
    <div>
      <PageHeader label="Transactions" title="Edit transaction" />

      <Card className="max-w-3xl mx-auto">
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          {/* Transaction type (read-only) */}
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium" style={{ color: 'var(--text)' }}>
              Type
            </span>
            <div
              className="h-11 rounded-lg px-3 text-sm flex items-center"
              style={{
                backgroundColor: 'var(--input-bg)',
                color: 'var(--text-muted)',
                border: '1px solid var(--input-border)',
              }}
            >
              {typeLabel(transaction.type)}
            </div>
          </div>

          {/* ── Income / Expense fields ─────────────────────────────── */}
          {!isTransfer && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <Select
                  label="Account"
                  options={accountOptions}
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  error={errors.accountId}
                />

                <Input
                  label="Amount"
                  type="number"
                  step="any"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  error={errors.amount}
                />

                <CurrencyPicker
                  label="Currency"
                  value={currency}
                  onChange={setCurrency}
                  error={errors.currency}
                />

                <Input
                  label="Date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  error={errors.date}
                />
              </div>

              <CategoryPicker
                label="Category"
                value={categoryId}
                onChange={setCategoryId}
                type={transaction.type === 'income' ? 'income' : 'expense'}
              />

              <Input
                label="Note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional note"
              />

              <Input
                label="Fee"
                type="number"
                step="any"
                min="0"
                value={feeAmount}
                onChange={(e) => setFeeAmount(e.target.value)}
                placeholder="0.00"
                helpText="Optional fee amount (deducted from account)"
              />

              <div className="flex items-center gap-2">
                <input
                  id="is-budgeted"
                  type="checkbox"
                  checked={isBudgeted}
                  onChange={(e) => setIsBudgeted(e.target.checked)}
                  className="h-4 w-4 cursor-pointer"
                />
                <label
                  htmlFor="is-budgeted"
                  className="text-sm cursor-pointer"
                  style={{ color: 'var(--text)' }}
                >
                  Include in budget
                </label>
              </div>

              {/* Budget event picker - lets the user link to ANY active
                  event regardless of date. For in-range dates we pre-fill
                  via the suggestion effect above. */}
              <BudgetEventPicker
                label="Budget event"
                value={selectedEventId}
                onChange={setSelectedEventId}
              />


              {/* Split expense toggle (expenses only) */}
              {transaction?.type === 'expense' && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <input
                      id="is-split"
                      type="checkbox"
                      checked={isSplit}
                      onChange={(e) => setIsSplit(e.target.checked)}
                      className="h-4 w-4 cursor-pointer"
                    />
                    <label
                      htmlFor="is-split"
                      className="text-sm cursor-pointer"
                      style={{ color: 'var(--text)' }}
                    >
                      Split this expense with others
                    </label>
                  </div>
                  {transaction.splitStatus != null && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => navigate(`/transactions/${transaction.id}/split`)}
                    >
                      Open split detail →
                    </Button>
                  )}
                </div>
              )}

              {/* Recurring toggle (expenses only) */}
              {transaction?.type === 'expense' && (
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <input
                      id="is-recurring"
                      type="checkbox"
                      checked={isRecurring}
                      onChange={(e) => setIsRecurring(e.target.checked)}
                      className="h-4 w-4 cursor-pointer"
                    />
                    <label
                      htmlFor="is-recurring"
                      className="text-sm cursor-pointer"
                      style={{ color: 'var(--text)' }}
                    >
                      Recurring expense
                    </label>
                  </div>
                  {isRecurring && transaction.recurringSeriesId == null && (
                    <Select
                      value={recurringCadence}
                      onChange={(e) => setRecurringCadence(e.target.value as RecurrenceCadence)}
                      options={[
                        { value: 'weekly', label: 'Weekly' },
                        { value: 'monthly', label: 'Monthly' },
                        { value: 'yearly', label: 'Yearly' },
                      ]}
                    />
                  )}
                </div>
              )}
            </>
          )}

          {/* ── Transfer fields ─────────────────────────────────────── */}
          {isTransfer && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <Select
                  label="Source Account"
                  options={accountOptions}
                  value={sourceAccountId}
                  onChange={(e) => setSourceAccountId(e.target.value)}
                  error={errors.sourceAccountId}
                />

                <Select
                  label="Destination Account"
                  options={accountOptions}
                  value={destAccountId}
                  onChange={(e) => setDestAccountId(e.target.value)}
                  error={errors.destAccountId}
                />

                <Input
                  label="Amount"
                  type="number"
                  step="any"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  error={errors.amount}
                />

                <CurrencyPicker
                  label="Currency"
                  value={currency}
                  onChange={setCurrency}
                  error={errors.currency}
                />
              </div>

              <Input
                label="Date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                error={errors.date}
              />

              <Input
                label="Note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional note"
              />

              <Input
                label="Fee"
                type="number"
                step="any"
                min="0"
                value={feeAmount}
                onChange={(e) => setFeeAmount(e.target.value)}
                placeholder="0.00"
                helpText="Optional fee amount (deducted from source account)"
              />
            </>
          )}

          {errors.form && (
            <p className="text-sm" style={{ color: 'var(--danger)' }}>
              {errors.form}
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving...' : 'Save changes'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => navigate('/transactions')}>
              Cancel
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
