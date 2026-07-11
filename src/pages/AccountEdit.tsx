import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { CurrencyPicker } from '../components/ui/CurrencyPicker';
import { ColorPicker } from '../components/ui/ColorPicker';
import { PageHeader } from '../components/layout/PageHeader';
import * as accountService from '../services/account-service';

export function AccountEdit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('');
  const [color, setColor] = useState('');
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function load() {
      if (!id) return;
      const account = await accountService.getAccountById(id);
      if (account) {
        setName(account.name);
        setCurrency(account.currency);
        setColor(account.color);
      }
      setLoading(false);
    }
    load();
  }, [id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = 'Name is required';
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setSubmitting(true);
    try {
      await accountService.updateAccount(id!, { name: name.trim(), color });
      navigate('/');
    } catch (err) {
      setErrors({ form: err instanceof Error ? err.message : 'Failed to update account' });
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

  return (
    <div>
      <PageHeader label="Accounts" title="Edit account" />

      <Card className="max-w-2xl">
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <Input
            label="Account Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={errors.name}
          />

          <div className="flex flex-col gap-1.5">
            <CurrencyPicker
              label="Currency"
              value={currency}
              onChange={setCurrency}
              disabled
            />
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Can't be changed after creation - create a new account for a
              different currency.
            </p>
          </div>

          <ColorPicker value={color} onChange={setColor} />

          {errors.form && (
            <p className="text-sm" style={{ color: 'var(--danger)' }}>
              {errors.form}
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving...' : 'Save changes'}
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
