import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { CurrencyPicker } from '../components/ui/CurrencyPicker';
import { PageHeader } from '../components/layout/PageHeader';
import { useAppStore } from '../stores/app-store';
import * as transactionService from '../services/transaction-service';
import * as accountService from '../services/account-service';
import { dec } from '../domain/money';
import { pickDefaultAccount } from '../lib/default-account';
import type { Account } from '../types/models';

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function TransactionTransfer() {
  const navigate = useNavigate();
  const preferredCurrency = useAppStore((s) => s.settings.preferredCurrency);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [sourceAccountId, setSourceAccountId] = useState('');
  const [destAccountId, setDestAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(preferredCurrency);
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const [feeAmount, setFeeAmount] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    accountService.listAccounts().then((list) => {
      setAccounts(list);
      if (list.length > 0) {
        // Shared rule with TransactionCreate: pinned manual → first manual
        // → pinned → first.
        const initial = pickDefaultAccount(list);
        setSourceAccountId(initial.id);
        setCurrency(initial.currency);
      }
    });
  }, []);

  // When source account changes, auto-set currency to that account's currency
  useEffect(() => {
    if (!sourceAccountId) return;
    const acct = accounts.find((a) => a.id === sourceAccountId);
    if (acct) {
      setCurrency(acct.currency);
    }
  }, [sourceAccountId, accounts]);

  const accountOptions = accounts.map((a) => ({
    value: a.id,
    label: `${a.name} (${a.currency})`,
  }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const newErrors: Record<string, string> = {};

    if (!sourceAccountId) newErrors.sourceAccountId = 'Source account is required';
    if (!destAccountId) newErrors.destAccountId = 'Destination account is required';
    if (sourceAccountId && destAccountId && sourceAccountId === destAccountId) {
      newErrors.destAccountId = 'Destination must differ from source';
    }

    // Validate money through `dec` (big.js) - never raw `Number()`, which
    // rejects grouped input and accepts exponent strings like "1e-3".
    // Mirrors TransactionCreate so sibling forms validate identically.
    const trimmedAmount = amount.trim();
    if (!trimmedAmount) {
      newErrors.amount = 'Amount is required';
    } else {
      try {
        if (dec(trimmedAmount).lte(0)) {
          newErrors.amount = 'Amount must be a positive number';
        }
      } catch {
        newErrors.amount = 'Amount must be a positive number';
      }
    }

    if (!currency) newErrors.currency = 'Currency is required';

    const trimmedFee = feeAmount.trim();
    if (trimmedFee) {
      try {
        if (dec(trimmedFee).lt(0)) {
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
      await transactionService.createTransfer({
        sourceAccountId,
        destAccountId,
        amount: trimmedAmount,
        currency,
        date: date || undefined,
        note: note.trim() || undefined,
        feeAmount: trimmedFee || undefined,
      });
      navigate('/transactions');
    } catch (err) {
      setErrors({ form: err instanceof Error ? err.message : 'Failed to create transfer' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <PageHeader label="Transactions" title="Record transfer" />

      <Card className="max-w-3xl mx-auto">
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
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
          </div>

          <Input
            label="Date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />

          <Input
            label="Note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note"
          />

          <Input
            label="Fee"
            value={feeAmount}
            onChange={(e) => setFeeAmount(e.target.value)}
            placeholder="0.00"
            helpText="Optional fee deducted from source account"
            error={errors.feeAmount}
          />

          {errors.form && (
            <p className="text-sm" style={{ color: 'var(--danger)' }}>
              {errors.form}
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving...' : 'Record transfer'}
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
