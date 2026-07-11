import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { CurrencyPicker } from '../components/ui/CurrencyPicker';
import { CategoryPicker } from '../components/ui/CategoryPicker';
import { BudgetEventPicker } from '../components/ui/BudgetEventPicker';
import { InfoBanner } from '../components/ui/InfoBanner';
import { PageHeader } from '../components/layout/PageHeader';
import { useAppStore } from '../stores/app-store';
import * as transactionService from '../services/transaction-service';
import * as accountService from '../services/account-service';
import * as budgetService from '../services/budget-service';
import * as recurringService from '../services/recurring-service';
import { dec } from '../domain/money';
import { pickDefaultAccount } from '../lib/default-account';
import type { Account } from '../types/models';
import type { RecurrenceCadence } from '../types/enums';

type TxnType = 'income' | 'expense';

function todayString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function TransactionCreate() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preferredCurrency = useAppStore((s) => s.settings.preferredCurrency);
  // Fast-action deep-link: /transactions/create?split=1 pre-selects expense
  // type AND ticks the "Split this expense" checkbox, so the user lands
  // ready to record a split.
  const presetSplit = searchParams.get('split') === '1';

  // ── Data loaded on mount ──────────────────────────────────────────────
  const [accounts, setAccounts] = useState<Account[]>([]);

  // ── Form state ────────────────────────────────────────────────────────
  const [type, setType] = useState<TxnType>('expense');
  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(preferredCurrency);
  const [date, setDate] = useState(todayString);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [feeAmount, setFeeAmount] = useState('');
  const [isBudgeted, setIsBudgeted] = useState(true);
  const [isSplit, setIsSplit] = useState(presetSplit);
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurringCadence, setRecurringCadence] = useState<RecurrenceCadence>('monthly');
  // Budget event linkage - picker is the single source of truth.
  // For in-range dates we pre-fill from a date match, but only while
  // nothing is currently picked, so explicit user choices stick.
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // ── Load accounts on mount ────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      const accts = await accountService.listAccounts();
      setAccounts(accts);

      // Default account: pinned manual → first manual → first. Manual
      // accounts are where hand-typed entries belong; defaulting to a
      // bank-linked account forces a corrective dropdown change on the
      // app's highest-frequency form. (Same rule as TransactionTransfer.)
      if (accts.length > 0 && !accountId) {
        const preferred = pickDefaultAccount(accts);
        setAccountId(preferred.id);
        setCurrency(preferred.currency);
      }
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── When account changes, update currency to that account's currency ──
  useEffect(() => {
    if (!accountId) return;
    const acct = accounts.find((a) => a.id === accountId);
    if (acct) setCurrency(acct.currency);
  }, [accountId, accounts]);

  // ── When type changes, clear categoryId (CategoryPicker reloads via its
  //     internal effect when `type` changes).
  useEffect(() => {
    setCategoryId(null);
  }, [type]);

  // ── When date changes, suggest a date-matching event - but only when
  // nothing is currently picked AND the user hasn't explicitly chosen
  // "No event". Without the ref, picking "No event" set the value back to
  // null, re-fired this effect (selectedEventId is a dependency), and
  // snapped the suggestion right back - making it impossible to opt an
  // expense out of a date-matching event.
  const userClearedEventRef = useRef(false);
  useEffect(() => {
    if (!date || selectedEventId !== null || userClearedEventRef.current) return;
    let cancelled = false;
    (async () => {
      const matches = await budgetService.getMatchingEventsForDate(date);
      if (!cancelled && matches[0]) setSelectedEventId(matches[0].id);
    })();
    return () => { cancelled = true; };
  }, [date, selectedEventId]);

  // ── Validation & submit ───────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const newErrors: Record<string, string> = {};

    if (!accountId) newErrors.accountId = 'Account is required';

    if (!amount.trim()) {
      newErrors.amount = 'Amount is required';
    } else {
      try {
        if (dec(amount.trim()).lte(0)) {
          newErrors.amount = 'Amount must be a positive number';
        }
      } catch {
        newErrors.amount = 'Amount must be a positive number';
      }
    }

    if (!currency) newErrors.currency = 'Currency is required';
    if (!date) newErrors.date = 'Date is required';

    if (type === 'expense' && feeAmount.trim()) {
      try {
        if (dec(feeAmount.trim()).lt(0)) {
          newErrors.feeAmount = 'Fee must be a non-negative number';
        }
      } catch {
        newErrors.feeAmount = 'Fee must be a non-negative number';
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setSubmitting(true);
    try {
      const created = await transactionService.createTransaction({
        type,
        accountId,
        amount,
        currency,
        date,
        categoryId: categoryId ?? undefined,
        note: note.trim() || undefined,
        isBudgeted,
        budgetEventId: selectedEventId,
        feeAmount: type === 'expense' && feeAmount.trim() ? feeAmount.trim() : undefined,
        isSplit: type === 'expense' ? isSplit : false,
      });
      // Flag as recurring if requested (expenses only). Best-effort - a
      // failure here shouldn't lose the just-created transaction.
      if (type === 'expense' && isRecurring) {
        try {
          await recurringService.flagTransactionAsRecurring(created.id, {
            cadence: recurringCadence,
          });
        } catch (err) {
          console.warn('[TransactionCreate] flag recurring failed:', err);
        }
      }
      // If the user opted into splitting, deep-link them straight to the
      // detail page so they can start adding repayments.
      if (type === 'expense' && isSplit) {
        navigate(`/transactions/${created.id}/split`);
      } else {
        navigate('/transactions');
      }
    } catch (err) {
      setErrors({ form: err instanceof Error ? err.message : 'Failed to create transaction' });
    } finally {
      setSubmitting(false);
    }
  }

  // ── Dropdown options ──────────────────────────────────────────────────
  const accountOptions = accounts.map((a) => ({
    value: a.id,
    label: `${a.name} (${a.currency})`,
  }));

  return (
    <div>
      <PageHeader label="Transactions" title="Record transaction" />

      <Card className="max-w-3xl mx-auto">
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          {/* Type radio buttons */}
          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-sm font-medium mb-1" style={{ color: 'var(--text)' }}>
              Type
            </legend>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer text-sm" style={{ color: 'var(--text)' }}>
                <input
                  type="radio"
                  name="txn-type"
                  value="expense"
                  checked={type === 'expense'}
                  onChange={() => setType('expense')}
                />
                Expense
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-sm" style={{ color: 'var(--text)' }}>
                <input
                  type="radio"
                  name="txn-type"
                  value="income"
                  checked={type === 'income'}
                  onChange={() => setType('income')}
                />
                Income
              </label>
            </div>
          </fieldset>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Select
              label="Account"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              options={accountOptions}
              error={errors.accountId}
            />

            <Input
              label="Amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
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
            type={type}
          />

          <Input
            label="Note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note"
          />

          {type === 'expense' && (
            <Input
              label="Fee"
              value={feeAmount}
              onChange={(e) => setFeeAmount(e.target.value)}
              placeholder="0.00"
              helpText="Optional fee amount deducted from the same account"
              error={errors.feeAmount}
            />
          )}

          {/* Is Budgeted checkbox */}
          <label className="flex items-center gap-2 cursor-pointer text-sm" style={{ color: 'var(--text)' }}>
            <input
              type="checkbox"
              checked={isBudgeted}
              onChange={(e) => setIsBudgeted(e.target.checked)}
            />
            Include in budget
          </label>

          {/* Recurring (expenses only) - flags this as a recurring series
              so future bank imports of the same merchant auto-recognize. */}
          {type === 'expense' && (
            <div className="flex items-center gap-3 flex-wrap">
              <label className="flex items-center gap-2 cursor-pointer text-sm" style={{ color: 'var(--text)' }}>
                <input
                  type="checkbox"
                  checked={isRecurring}
                  onChange={(e) => setIsRecurring(e.target.checked)}
                />
                Recurring expense
              </label>
              {isRecurring && (
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

          {/* Budget event picker - lets the user link to ANY active
              event regardless of date. Date-match auto-fills if no link
              is currently selected. */}
          <BudgetEventPicker
            label="Budget event"
            value={selectedEventId}
            onChange={(id) => {
              // An explicit "No event" pick must stick - remember it so the
              // date-match effect doesn't re-suggest.
              userClearedEventRef.current = id === null;
              setSelectedEventId(id);
            }}
          />

          {/* Split expense (expenses only) */}
          {type === 'expense' && (
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 cursor-pointer text-sm" style={{ color: 'var(--text)' }}>
                <input
                  type="checkbox"
                  checked={isSplit}
                  onChange={(e) => setIsSplit(e.target.checked)}
                />
                Split this expense with others
              </label>
              {isSplit && (
                <>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    Add the repayments you receive on the split detail page. Your net expense updates automatically.
                  </p>
                  <InfoBanner
                    storageKey="koinkat.splitExpenseBannerDismissed"
                    title="Splitting an expense"
                  >
                    Record the full payment as the Amount. Your account balance reflects what
                    actually moved; the full payment is debited now. On the next screen you can
                    add repayments as they arrive, in any currency, into any of your accounts.
                    Your <strong>net expense</strong> is always computed as{' '}
                    <em>gross minus everything that's been repaid</em>, and that's the number that
                    counts toward budgets and category totals. You don't need to know your share
                    upfront; it will update as repayments land over time.
                    <br />
                    <br />
                    <em>Repayments via services you don't track in Koinkat (e.g., PayPal,
                    MobilePay, cash) can be recorded as "external reimbursements" on the
                    detail page; they still reduce your net expense without affecting any
                    account balance.</em>
                  </InfoBanner>
                </>
              )}
            </div>
          )}

          {errors.form && (
            <p className="text-sm" style={{ color: 'var(--danger)' }}>
              {errors.form}
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving...' : 'Record transaction'}
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
