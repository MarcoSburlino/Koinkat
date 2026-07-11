import { useState } from 'react';
import { ArrowRight, ArrowLeft, UserPlus } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { createUser } from '../services/user-service';
import { setActiveUserId } from '../lib/active-user';
import { useUserStore } from '../stores/user-store';

interface UserRegisterProps {
  /** Called once a user has been created and marked active. */
  onComplete: () => void;
  /** Called when the user wants to back out to the login screen. */
  onCancel?: () => void;
}

export function UserRegister({ onComplete, onCancel }: UserRegisterProps) {
  const loadUsers = useUserStore((s) => s.loadUsers);
  const loadActiveUser = useUserStore((s) => s.loadActiveUser);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  async function handleCreate() {
    if (!name.trim()) {
      setError('Please enter a name');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const user = await createUser({
        name: name.trim(),
        email: email.trim(),
      });
      setActiveUserId(user.id);
      await loadUsers();
      await loadActiveUser();
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="min-h-[calc(100vh-56px)] w-full flex items-center justify-center p-6"
      style={{ backgroundColor: 'var(--bg)' }}
    >
      <div className="w-full max-w-xl">
        <div className="mb-8 text-center">
          <div
            className="w-14 h-14 rounded-xl mx-auto mb-4 flex items-center justify-center"
            style={{ backgroundColor: 'var(--input-bg)' }}
          >
            <UserPlus size={26} style={{ color: 'var(--primary)' }} />
          </div>
          <h1
            className="text-3xl font-semibold"
            style={{ color: 'var(--text)', fontFamily: 'var(--font-head)' }}
          >
            Create your Koinkat user
          </h1>
          <p className="text-sm mt-2" style={{ color: 'var(--text-muted)' }}>
            Just the basics for now. You'll set up your first koinkat account next.
          </p>
        </div>

        <Card>
          <div className="flex flex-col gap-5">
            <Input
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
            />
            <Input
              label="Email (optional)"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              helpText="Only used as a label on this device - nothing is sent anywhere."
            />

            {error && (
              <p className="text-xs" style={{ color: 'var(--danger)' }}>
                {error}
              </p>
            )}

            <div className="flex items-center justify-between pt-2">
              {onCancel ? (
                <Button variant="ghost" onClick={onCancel}>
                  <ArrowLeft size={16} />
                  Back to users
                </Button>
              ) : (
                <span />
              )}
              <Button onClick={handleCreate} disabled={busy}>
                {busy ? 'Creating...' : 'Continue'}
                <ArrowRight size={16} />
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
