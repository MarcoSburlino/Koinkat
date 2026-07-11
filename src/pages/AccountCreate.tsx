import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { CurrencyPicker } from '../components/ui/CurrencyPicker';
import { ColorPicker } from '../components/ui/ColorPicker';
import { PageHeader } from '../components/layout/PageHeader';
import { useAppStore } from '../stores/app-store';
import { DEFAULT_COLOR } from '../domain/colors';
import Big from 'big.js';
import * as accountService from '../services/account-service';

export function AccountCreate() {
  const navigate = useNavigate();
  const preferredCurrency = useAppStore((s) => s.settings.preferredCurrency);

  const [name, setName] = useState('');
  const [currency, setCurrency] = useState(preferredCurrency);
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [startingBalance, setStartingBalance] = useState('0.00');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const newErrors: Record<string, string> = {};

    if (!name.trim()) newErrors.name = 'Name is required';
    if (!currency) newErrors.currency = 'Currency is required';

    try {
      if (startingBalance) {
        new Big(startingBalance);
      }
    } catch {
      newErrors.startingBalance = 'Invalid amount';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setSubmitting(true);
    try {
      await accountService.createAccount({
        name: name.trim(),
        currency,
        color,
        startingBalance: startingBalance || '0.00',
      });
      navigate('/');
    } catch (err) {
      setErrors({ form: err instanceof Error ? err.message : 'Failed to create account' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <PageHeader label="Accounts" title="Create account" />

      <Card className="max-w-2xl">
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <Input
            label="Account Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Main Bank, Savings, Wise EUR"
            error={errors.name}
          />

          <CurrencyPicker
            label="Currency"
            value={currency}
            onChange={setCurrency}
            error={errors.currency}
          />

          <ColorPicker value={color} onChange={setColor} />

          <Input
            label="Starting Balance"
            value={startingBalance}
            onChange={(e) => setStartingBalance(e.target.value)}
            placeholder="0.00"
            helpText="Your account's balance today, e.g. 1250.00"
            error={errors.startingBalance}
          />

          {errors.form && (
            <p className="text-sm" style={{ color: 'var(--danger)' }}>
              {errors.form}
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Creating...' : 'Create account'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => navigate('/')}>
              Cancel
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
