import { DEFAULT_CALLBACK_URL } from '../lib/constants';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Landmark,
  FlaskConical,
  Pencil,
  ArrowRight,
  AlertCircle,
  Trash2,
} from 'lucide-react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { CurrencyPicker } from '../components/ui/CurrencyPicker';
import { Modal } from '../components/ui/Modal';
import { BankSetupGuide } from '../components/BankSetupGuide';
import {
  saveCredentials,
  clearCredentials,
} from '../services/api-config-service';
import { verifyCredentials } from '../services/enable-banking-service';
import { createKoinkatAccount } from '../services/koinkat-account-service';
import { setActiveKoinkatAccountId } from '../lib/active-koinkat-account';
import { useUserStore } from '../stores/user-store';
import { useKoinkatAccountStore } from '../stores/koinkat-account-store';
import type { KoinkatAccount } from '../types/models';
import type { ConnectionType, Theme, DecimalSeparator } from '../types/enums';

type CreationMode = ConnectionType | null;

export function Connection() {
  const navigate = useNavigate();

  const activeUser = useUserStore((s) => s.activeUser);
  const userLogout = useUserStore((s) => s.logout);

  const accounts = useKoinkatAccountStore((s) => s.accounts);
  const loadAccounts = useKoinkatAccountStore((s) => s.loadAccounts);
  const setActiveAccount = useKoinkatAccountStore((s) => s.setActive);
  const deleteKoinkatAccount = useKoinkatAccountStore((s) => s.deleteKoinkatAccount);

  // Creation wizard state
  const [mode, setMode] = useState<CreationMode>(null);
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('EUR');
  const [theme, setTheme] = useState<Theme>('dark');
  const [decSep, setDecSep] = useState<DecimalSeparator>(',');

  // Credential form state (sandbox/linked only)
  const [appId, setAppId] = useState('');
  const [pemFileName, setPemFileName] = useState('');
  const [pemContent, setPemContent] = useState('');
  // Pre-filled with Koinkat's shared callback page. The user registers
  // this exact URL on their own Enable Banking application (or replaces
  // it with a page they host themselves).
  const [redirectUrl, setRedirectUrl] = useState(DEFAULT_CALLBACK_URL);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  // Delete confirmation. Local-first means no server copy exists - the
  // user must type the workspace name to arm the delete button.
  const [deleteTarget, setDeleteTarget] = useState<KoinkatAccount | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteNameInput, setDeleteNameInput] = useState('');

  // Refresh accounts whenever the active user changes.
  useEffect(() => {
    if (activeUser) {
      loadAccounts(activeUser.id);
    }
  }, [activeUser, loadAccounts]);

  function resetWizard() {
    setMode(null);
    setName('');
    setCurrency('EUR');
    setTheme('dark');
    setDecSep(',');
    setAppId('');
    setPemContent('');
    setPemFileName('');
    setRedirectUrl(DEFAULT_CALLBACK_URL);
    setError(null);
  }

  async function handlePickPem() {
    try {
      const filePath = await openDialog({
        multiple: false,
        filters: [{ name: 'PEM Key', extensions: ['pem', 'key'] }],
      });
      if (!filePath || typeof filePath !== 'string') return;
      const content = await readTextFile(filePath);
      setPemContent(content);
      const parts = filePath.replace(/\\/g, '/').split('/');
      const fileName = parts[parts.length - 1];
      setPemFileName(fileName);
      const baseName = fileName.replace(/\.(pem|key)$/i, '');
      if (!appId) setAppId(baseName);
      setError(null);
    } catch (err) {
      setError(
        `Failed to read PEM file: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async function handleEnterAccount(account: KoinkatAccount) {
    await setActiveAccount(account.id);
    // Shell watches activeKoinkatAccount and flips to 'app' automatically.
    // Navigate to Dashboard so the Outlet has the right route waiting.
    navigate('/');
  }

  async function handleSwitchUser() {
    userLogout();
    // Shell watches activeUser and flips to 'userLogin' automatically.
  }

  async function handleCreate() {
    if (!activeUser) {
      setError('No active user. Please restart the app.');
      return;
    }
    if (!mode) return;
    if (!name.trim()) {
      setError('Please give this account a name.');
      return;
    }
    if (mode !== 'manual') {
      if (!appId.trim()) {
        setError('Application ID is required.');
        return;
      }
      if (!pemContent.trim()) {
        setError('Private key file is required.');
        return;
      }
      const trimmedRedirect = redirectUrl.trim();
      if (!trimmedRedirect) {
        setError(
          'Redirect URL is required - the https:// callback URL you registered on your Enable Banking application.',
        );
        return;
      }
      if (!trimmedRedirect.startsWith('https://')) {
        setError('Redirect URL must start with https:// (Enable Banking rejects anything else).');
        return;
      }
    }

    setBusy(true);
    setError(null);

    try {
      // 1. Create the koinkat account row (tags + optional empty api_configs
      //    row are seeded by the service).
      const account = await createKoinkatAccount({
        userId: activeUser.id,
        name: name.trim(),
        connectionType: mode,
        preferredCurrency: currency,
        decimalSeparator: decSep,
        theme,
      });

      // 2. Mark it active so downstream services scope correctly.
      setActiveKoinkatAccountId(account.id);

      // 3. For sandbox/linked, save & verify credentials now. If the user
      //    bails here we roll back by clearing the api_configs row.
      if (mode !== 'manual') {
        try {
          await saveCredentials({
            appId: appId.trim(),
            privateKeyPem: pemContent,
            environment: mode === 'sandbox' ? 'sandbox' : 'production',
            redirectUrl: redirectUrl.trim(),
          });
          const verifyError = await verifyCredentials();
          if (verifyError) {
            await clearCredentials();
            throw new Error(verifyError);
          }
        } catch (err) {
          // Credential failure on a brand-new account - delete the account
          // we just created so the user doesn't end up with a broken shell.
          await deleteKoinkatAccount(account.id);
          throw err;
        }
      }

      // 4. Reload the account list so the new one shows up if the user
      //    backs out later.
      await loadAccounts(activeUser.id);

      // 5. Set active via the store (this also hydrates activeKoinkatAccount
      //    in the store so Shell's effect picks it up and flips to 'app').
      await setActiveAccount(account.id);

      // Manual workspaces land on the Dashboard. Bank-driven workspaces go
      // straight into the bank-link flow - the user just typed Enable
      // Banking credentials and expects to pick their bank next, not an
      // empty dashboard whose copy talks about creating manual accounts.
      navigate(mode === 'manual' ? '/' : '/bank-link');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setBusy(true);
    setDeleteError(null);
    try {
      await deleteKoinkatAccount(deleteTarget.id);
      setDeleteTarget(null);
      setDeleteNameInput('');
      if (activeUser) {
        await loadAccounts(activeUser.id);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Connection] delete workspace failed:', err);
      setDeleteError(msg);
    } finally {
      setBusy(false);
    }
  }

  function handleCloseDeleteModal() {
    setDeleteTarget(null);
    setDeleteError(null);
    setDeleteNameInput('');
  }

  const hasAccounts = accounts.length > 0;
  const showCredentialsForm = mode === 'sandbox' || mode === 'linked';

  return (
    <div
      className="min-h-[calc(100vh-56px)] w-full flex justify-center px-6 py-10 md:py-14"
      style={{ backgroundColor: 'var(--bg)' }}
    >
      <div className="w-full max-w-5xl flex flex-col gap-10">
        {/* Hero */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-4">
            <p
              className="text-xs uppercase tracking-[0.18em]"
              style={{ color: 'var(--text-muted)' }}
            >
              Workspace hub
            </p>
            <button
              type="button"
              onClick={handleSwitchUser}
              className="text-xs underline cursor-pointer"
              style={{ color: 'var(--text-muted)' }}
            >
              Switch user
            </button>
          </div>
          <h1
            className="text-3xl md:text-4xl font-semibold"
            style={{ color: 'var(--text)', fontFamily: 'var(--font-head)' }}
          >
            {activeUser ? `Welcome back, ${activeUser.name}` : 'Welcome'}
          </h1>
          <p className="text-sm md:text-base max-w-2xl" style={{ color: 'var(--text-muted)' }}>
            Pick a workspace to enter, or add a new one. Every workspace has
            its own accounts, budgets and categories: link a real bank, try
            the sandbox, or track things by hand.
          </p>
        </div>

        {/* Existing koinkat accounts */}
        {hasAccounts && (
          <section className="flex flex-col gap-4">
            <div className="flex items-baseline justify-between">
              <h2
                className="text-xs uppercase tracking-[0.18em] font-semibold"
                style={{ color: 'var(--text-muted)' }}
              >
                Your accounts
              </h2>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {accounts.length} {accounts.length === 1 ? 'account' : 'accounts'}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {accounts.map((a) => (
                <ExistingKoinkatAccountCard
                  key={a.id}
                  account={a}
                  onEnter={() => handleEnterAccount(a)}
                  onDelete={() => setDeleteTarget(a)}
                />
              ))}
            </div>
          </section>
        )}

        {/* Creation cards */}
        <section className="flex flex-col gap-4">
          <h2
            className="text-xs uppercase tracking-[0.18em] font-semibold"
            style={{ color: 'var(--text-muted)' }}
          >
            {hasAccounts ? 'Add another account' : 'Create your first account'}
          </h2>
          <div
            className={`grid grid-cols-1 ${
              __KOINKAT_ALLOW_SANDBOX_UI__ ? 'md:grid-cols-3' : 'md:grid-cols-2'
            } gap-4`}
          >
            <ModeCard
              icon={<Landmark size={22} style={{ color: 'var(--primary)' }} />}
              iconTint="var(--primary)"
              title="Connect a bank"
              description="Link a real bank via Enable Banking (PSD2)."
              selected={mode === 'linked'}
              onSelect={() => {
                resetWizard();
                setMode('linked');
              }}
            />
            {/* Sandbox workspace creation is hidden in production builds.
                Existing sandbox workspaces in the DB remain fully functional -
                only the "create a new sandbox workspace" surface is gated. */}
            {__KOINKAT_ALLOW_SANDBOX_UI__ && (
              <ModeCard
                icon={<FlaskConical size={22} style={{ color: 'var(--success)' }} />}
                iconTint="var(--success)"
                title="Sandbox"
                description="Try the app with Enable Banking sandbox credentials."
                selected={mode === 'sandbox'}
                onSelect={() => {
                  resetWizard();
                  setMode('sandbox');
                }}
              />
            )}
            <ModeCard
              icon={<Pencil size={22} style={{ color: 'var(--text)' }} />}
              iconTint="var(--text)"
              title="Manual"
              description="Track accounts and transactions by hand. No bank needed."
              selected={mode === 'manual'}
              onSelect={() => {
                resetWizard();
                setMode('manual');
              }}
            />
          </div>
        </section>

        {/* Inline creation wizard */}
        {mode && (
          <Card>
            <div className="flex flex-col gap-5">
              <div>
                <h3
                  className="text-base font-semibold mb-1"
                  style={{ color: 'var(--text)', fontFamily: 'var(--font-head)' }}
                >
                  {mode === 'manual'
                    ? 'New manual account'
                    : mode === 'sandbox'
                      ? 'New sandbox account'
                      : 'New bank-linked account'}
                </h3>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Give this workspace a name and its own preferences.
                </p>
              </div>

              <Input
                label="Workspace name"
                placeholder={
                  mode === 'manual'
                    ? 'e.g. Household, Side Hustle'
                    : mode === 'sandbox'
                      ? 'e.g. Sandbox playground'
                      : 'e.g. My Bank'
                }
                value={name}
                onChange={(e) => setName(e.target.value)}
              />

              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <CurrencyPicker
                  label="Preferred currency"
                  value={currency}
                  onChange={setCurrency}
                />
                <Select
                  label="Theme"
                  value={theme}
                  onChange={(e) => setTheme(e.target.value as Theme)}
                  options={[
                    { value: 'light', label: 'Light' },
                    { value: 'dark', label: 'Dark' },
                  ]}
                />
                <Select
                  label="Decimal separator"
                  value={decSep}
                  onChange={(e) => setDecSep(e.target.value as DecimalSeparator)}
                  options={[
                    { value: '.', label: '1,234.56 (dot)' },
                    { value: ',', label: '1.234,56 (comma)' },
                  ]}
                />
              </div>

              {showCredentialsForm && (
                <div className="flex flex-col gap-5 pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
                  <div>
                    <h4 className="text-sm font-semibold mb-1" style={{ color: 'var(--text)' }}>
                      {mode === 'sandbox' ? 'Sandbox credentials' : 'Enable Banking credentials'}
                    </h4>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {mode === 'sandbox'
                        ? 'Enter the sandbox credentials you generated on Enable Banking.'
                        : 'Enter your production Enable Banking API credentials (free tier available).'}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setGuideOpen(true)}
                    className="text-xs underline cursor-pointer self-start"
                    style={{ color: 'var(--primary)' }}
                  >
                    Need help getting these? Open the setup guide
                  </button>

                  <Input
                    label="Application ID"
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    value={appId}
                    onChange={(e) => setAppId(e.target.value)}
                  />

                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium" style={{ color: 'var(--text)' }}>
                      Private Key
                    </label>
                    <div className="flex items-center gap-3 flex-wrap">
                      <Button variant="secondary" onClick={handlePickPem}>
                        Choose .pem file...
                      </Button>
                      {pemFileName && (
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {pemFileName}
                        </span>
                      )}
                    </div>
                  </div>

                  <Input
                    label="Redirect URL"
                    placeholder={DEFAULT_CALLBACK_URL}
                    value={redirectUrl}
                    onChange={(e) => setRedirectUrl(e.target.value)}
                    helpText="Koinkat's shared callback page is pre-filled - register this exact URL (trailing slash included) on your Enable Banking application. You can replace it with a page you host yourself."
                  />
                </div>
              )}

              {error && (
                <p className="text-xs flex items-center gap-1.5" style={{ color: 'var(--danger)' }}>
                  <AlertCircle size={14} />
                  {error}
                </p>
              )}

              <div className="flex gap-3 flex-wrap">
                <Button onClick={handleCreate} disabled={busy}>
                  {busy
                    ? 'Creating...'
                    : mode === 'manual'
                      ? 'Create & enter'
                      : 'Create & verify'}
                  <ArrowRight size={16} />
                </Button>
                <Button variant="ghost" onClick={resetWizard} disabled={busy}>
                  Cancel
                </Button>
              </div>
            </div>
          </Card>
        )}
      </div>

      <BankSetupGuide open={guideOpen} onClose={() => setGuideOpen(false)} />

      <Modal
        open={deleteTarget !== null}
        onClose={handleCloseDeleteModal}
        title="Delete workspace?"
      >
        <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
          Deleting{' '}
          <strong style={{ color: 'var(--text)' }}>{deleteTarget?.name}</strong>{' '}
          will permanently remove all of its bank accounts, transactions,
          budgets, categories and bank connections.{' '}
          <strong style={{ color: 'var(--text)' }}>
            Your data lives only on this device - there is no copy to restore
            from.
          </strong>{' '}
          Consider exporting a backup first (Settings → Backup &amp; export).
        </p>
        <div className="mb-4">
          <Input
            label={`Type "${deleteTarget?.name ?? ''}" to confirm`}
            value={deleteNameInput}
            onChange={(e) => setDeleteNameInput(e.target.value)}
            placeholder={deleteTarget?.name ?? ''}
          />
        </div>
        {deleteError && (
          <p
            className="text-xs flex items-start gap-1.5 mb-4"
            style={{ color: 'var(--danger)' }}
          >
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span className="break-words">{deleteError}</span>
          </p>
        )}
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={handleCloseDeleteModal} disabled={busy}>
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
  );
}

// ── Subcomponents ────────────────────────────────────────────────────────

interface ExistingKoinkatAccountCardProps {
  account: KoinkatAccount;
  onEnter: () => void;
  onDelete: () => void;
}

function ExistingKoinkatAccountCard({
  account,
  onEnter,
  onDelete,
}: ExistingKoinkatAccountCardProps) {
  const typeMeta = getTypeMeta(account.connectionType);

  return (
    <div
      className="rounded-xl p-4 transition-all group"
      style={{
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--elev-1)',
      }}
    >
      <div className="flex items-start gap-4">
        <button
          type="button"
          onClick={onEnter}
          className="flex items-start gap-4 flex-1 min-w-0 text-left cursor-pointer"
        >
          <div
            className="w-11 h-11 rounded-lg shrink-0 flex items-center justify-center"
            style={{
              backgroundColor: 'var(--input-bg)',
              border: '1px solid var(--border)',
            }}
          >
            {typeMeta.icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-semibold truncate" style={{ color: 'var(--text)' }}>
                {account.name}
              </p>
              <span
                className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
                style={{
                  backgroundColor: 'var(--input-bg)',
                  color: typeMeta.tint,
                  border: `1px solid ${typeMeta.tint}33`,
                }}
              >
                {typeMeta.label}
              </span>
            </div>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {account.preferredCurrency} · {account.theme}
            </p>
          </div>
          <ArrowRight
            size={18}
            className="shrink-0 mt-1 transition-transform group-hover:translate-x-0.5"
            style={{ color: 'var(--text-muted)' }}
          />
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="p-2 rounded transition-colors hover:opacity-80 cursor-pointer shrink-0"
          style={{ color: 'var(--danger)' }}
          aria-label={`Delete ${account.name}`}
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}

interface ModeCardProps {
  icon: React.ReactNode;
  iconTint: string;
  title: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
}

function ModeCard({ icon, iconTint, title, description, selected, onSelect }: ModeCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="text-left rounded-xl p-5 transition-all cursor-pointer h-full hover:-translate-y-0.5"
      style={{
        backgroundColor: 'var(--surface)',
        border: `1px solid ${selected ? iconTint : 'var(--border)'}`,
        boxShadow: selected ? `0 0 0 2px ${iconTint}33, var(--elev-1)` : 'var(--elev-1)',
      }}
    >
      <div
        className="w-11 h-11 rounded-lg flex items-center justify-center mb-4"
        style={{
          backgroundColor: 'var(--input-bg)',
          border: '1px solid var(--border)',
        }}
      >
        {icon}
      </div>
      <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--text)' }}>
        {title}
      </h3>
      <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
        {description}
      </p>
    </button>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────

function getTypeMeta(type: ConnectionType): {
  label: string;
  tint: string;
  icon: React.ReactNode;
} {
  switch (type) {
    case 'linked':
      return {
        label: 'Linked bank',
        tint: 'var(--primary)',
        icon: <Landmark size={20} style={{ color: 'var(--primary)' }} />,
      };
    case 'sandbox':
      return {
        label: 'Sandbox',
        tint: 'var(--success)',
        icon: <FlaskConical size={20} style={{ color: 'var(--success)' }} />,
      };
    case 'manual':
      return {
        label: 'Manual',
        tint: 'var(--text-muted)',
        icon: <Pencil size={20} style={{ color: 'var(--text)' }} />,
      };
  }
}
