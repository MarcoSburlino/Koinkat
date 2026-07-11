import { useState } from 'react';
import { UserPlus, Trash2, User as UserIcon } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { useUserStore } from '../stores/user-store';
import type { User } from '../types/models';

interface UserLoginProps {
  /** User picked an existing identity; parent reloads app state. */
  onSelect: () => void;
  /** User wants to create a new identity. */
  onCreateNew: () => void;
}

export function UserLogin({ onSelect, onCreateNew }: UserLoginProps) {
  const users = useUserStore((s) => s.users);
  const setActive = useUserStore((s) => s.setActive);
  const deleteUser = useUserStore((s) => s.deleteUser);

  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  // Local-first: deleting a user is absolute, so the name must be typed
  // to arm the delete button.
  const [deleteNameInput, setDeleteNameInput] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSelect(user: User) {
    if (busy) return;
    setBusy(true);
    try {
      await setActive(user.id);
      onSelect();
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await deleteUser(deleteTarget.id);
      setDeleteTarget(null);
      setDeleteNameInput('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="min-h-[calc(100vh-56px)] w-full flex items-center justify-center p-6"
      style={{ backgroundColor: 'var(--bg)' }}
    >
      <div className="w-full max-w-2xl">
        <div className="mb-6 text-center">
          <h1
            className="text-2xl font-semibold"
            style={{ color: 'var(--text)', fontFamily: 'var(--font-head)' }}
          >
            Who's using Koinkat?
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            Pick a user to continue, or create a new one.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          {users.map((user) => (
            <button
              key={user.id}
              type="button"
              onClick={() => handleSelect(user)}
              disabled={busy}
              className="text-left rounded-lg p-4 transition-all cursor-pointer hover:opacity-90 disabled:opacity-60"
              style={{
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--border)',
              }}
            >
              <div className="flex items-center gap-4">
                <div
                  className="w-11 h-11 rounded-full shrink-0 flex items-center justify-center"
                  style={{ backgroundColor: 'var(--input-bg)' }}
                >
                  <UserIcon size={20} style={{ color: 'var(--text)' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: 'var(--text)' }}>
                    {user.name}
                  </p>
                  <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                    {user.email || '-'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteTarget(user);
                  }}
                  className="p-2 rounded transition-colors hover:opacity-80 cursor-pointer"
                  style={{ color: 'var(--danger)' }}
                  aria-label={`Delete ${user.name}`}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </button>
          ))}

          <Card>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="w-11 h-11 rounded-full shrink-0 flex items-center justify-center"
                  style={{ backgroundColor: 'var(--input-bg)' }}
                >
                  <UserPlus size={20} style={{ color: 'var(--primary)' }} />
                </div>
                <div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                    Create a new user
                  </p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    Start fresh with a new identity on this machine.
                  </p>
                </div>
              </div>
              <Button onClick={onCreateNew} disabled={busy}>
                Create
              </Button>
            </div>
          </Card>
        </div>

        <Modal
          open={deleteTarget !== null}
          onClose={() => { setDeleteTarget(null); setDeleteNameInput(''); }}
          title="Delete user?"
        >
          <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
            Deleting <strong style={{ color: 'var(--text)' }}>{deleteTarget?.name}</strong>{' '}
            will permanently remove every workspace they own and all of the accounts,
            transactions, budgets, and bank connections under them.{' '}
            <strong style={{ color: 'var(--text)' }}>
              Your data lives only on this device - there is no copy to restore from.
            </strong>
          </p>
          <div className="mb-4">
            <Input
              label={`Type "${deleteTarget?.name ?? ''}" to confirm`}
              value={deleteNameInput}
              onChange={(e) => setDeleteNameInput(e.target.value)}
              placeholder={deleteTarget?.name ?? ''}
            />
          </div>
          <div className="flex justify-end gap-3">
            <Button
              variant="ghost"
              onClick={() => { setDeleteTarget(null); setDeleteNameInput(''); }}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleConfirmDelete}
              disabled={busy || deleteNameInput.trim() !== (deleteTarget?.name ?? '')}
            >
              {busy ? 'Deleting...' : 'Delete permanently'}
            </Button>
          </div>
        </Modal>
      </div>
    </div>
  );
}
