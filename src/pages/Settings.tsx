import { DEFAULT_CALLBACK_URL } from '../lib/constants';
import { UPPERCASE_LABEL } from '../lib/label-styles';
import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { format, subDays } from 'date-fns';
import {
  Landmark,
  ArrowRight,
  Clock,
  RotateCcw,
  LogOut,
  Download,
  AlertCircle,
} from 'lucide-react';
import { save, open as openDialog } from '@tauri-apps/plugin-dialog';
import {
  writeTextFile,
  writeFile,
  readFile,
  readTextFile,
} from '@tauri-apps/plugin-fs';
import { appConfigDir, join } from '@tauri-apps/api/path';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { BankSetupGuide } from '../components/BankSetupGuide';
import { CurrencyPicker } from '../components/ui/CurrencyPicker';
import { PageHeader } from '../components/layout/PageHeader';
import { useAppStore } from '../stores/app-store';
import { useBankStore } from '../stores/bank-store';
import { useKoinkatAccountStore } from '../stores/koinkat-account-store';
import { updateSettings } from '../services/settings-service';
import { getConnectionSyncFloor, disconnectBank } from '../services/bank-sync-service';
import { exportWorkspaceAsJson } from '../services/export-service';
import { loadApiConfig, saveCredentials, getPemStorage } from '../services/api-config-service';
import { verifyCredentials } from '../services/enable-banking-service';
import type { Theme, DecimalSeparator, BankEnvironment } from '../types/enums';
import type { BankConnection } from '../types/models';

export function Settings() {
  const settings = useAppStore((s) => s.settings);
  const setSettings = useAppStore((s) => s.setSettings);
  const isConfigured = useBankStore((s) => s.isConfigured);
  const isDemoMode = useBankStore((s) => s.isDemoMode);
  const connections = useBankStore((s) => s.connections);
  const loadConnections = useBankStore((s) => s.loadConnections);
  const isSyncing = useBankStore((s) => s.isSyncing);
  const lastSyncError = useBankStore((s) => s.lastSyncError);
  const startFullResyncOverride = useBankStore((s) => s.startFullResyncOverride);
  const startPullOlderHistory = useBankStore((s) => s.startPullOlderHistory);
  const activeKoinkatAccount = useKoinkatAccountStore((s) => s.activeKoinkatAccount);
  const loadActiveKoinkatAccount = useKoinkatAccountStore(
    (s) => s.loadActiveKoinkatAccount,
  );
  const exitWorkspace = useKoinkatAccountStore((s) => s.exit);

  const [currency, setCurrency] = useState(settings.preferredCurrency);
  const [theme, setTheme] = useState<Theme>(settings.theme);
  const [decSep, setDecSep] = useState<DecimalSeparator>(settings.decimalSeparator);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Per-connection floor cache (min sync_start_date across its linked accounts).
  const [floors, setFloors] = useState<Record<string, string | null>>({});
  const [pullOlderTarget, setPullOlderTarget] = useState<BankConnection | null>(null);
  const [fullResyncConfirmOpen, setFullResyncConfirmOpen] = useState(false);
  // Outcome line for the last sync-shaped operation (pull older history /
  // full re-pull) - these run for minutes and previously finished with no
  // feedback at all.
  const [syncResult, setSyncResult] = useState<string | null>(null);

  // Remove-connection confirmation (wired to disconnectBank, which keeps
  // the accounts as manual ones so transaction history survives).
  const [disconnectTarget, setDisconnectTarget] = useState<BankConnection | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  const [isExportingJson, setIsExportingJson] = useState(false);
  const [isExportingDb, setIsExportingDb] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);

  function flashSuccess(msg: string) {
    setExportSuccess(msg);
    setTimeout(() => setExportSuccess(null), 2000);
  }

  async function handleExportJson() {
    setIsExportingJson(true);
    setExportError(null);
    setExportSuccess(null);
    try {
      const json = await exportWorkspaceAsJson();
      const today = format(new Date(), 'yyyy-MM-dd');
      const slug =
        (activeKoinkatAccount?.name ?? 'workspace')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '') || 'workspace';
      const path = await save({
        defaultPath: `koinkat-export-${slug}-${today}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (!path) return;
      await writeTextFile(path, json);
      flashSuccess('Exported.');
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setIsExportingJson(false);
    }
  }

  async function handleExportDb() {
    setIsExportingDb(true);
    setExportError(null);
    setExportSuccess(null);
    try {
      const src = await join(await appConfigDir(), 'koinkat.db');
      const today = format(new Date(), 'yyyy-MM-dd');
      const path = await save({
        defaultPath: `koinkat-database-${today}.db`,
        filters: [{ name: 'SQLite database', extensions: ['db'] }],
      });
      if (!path) return;
      const bytes = await readFile(src);
      await writeFile(path, bytes);
      flashSuccess('Database exported.');
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setIsExportingDb(false);
    }
  }

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  const loadFloors = useCallback(async () => {
    const next: Record<string, string | null> = {};
    for (const c of connections) {
      try {
        const { floor } = await getConnectionSyncFloor(c.id);
        next[c.id] = floor;
      } catch {
        next[c.id] = null;
      }
    }
    setFloors(next);
  }, [connections]);

  useEffect(() => {
    if (connections.length > 0) {
      loadFloors();
    }
  }, [connections, loadFloors]);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      const changes = {
        preferredCurrency: currency,
        theme,
        decimalSeparator: decSep,
      };
      // Writes to the active koinkat account's row, not a user-level record.
      await updateSettings(changes);
      setSettings({ ...settings, ...changes });
      // Keep the koinkat-account store in sync so the Header chip and
      // theme-reactive code see the new values immediately.
      await loadActiveKoinkatAccount();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  const connectionLabel = !isConfigured
    ? 'Not connected'
    : isDemoMode
      ? 'Sandbox'
      : 'Connected';

  return (
    <div>
      <PageHeader
        serif
        label="Settings"
        title="Account preferences"
        subtitle={
          activeKoinkatAccount
            ? `Preferences scoped to ${activeKoinkatAccount.name}. Each workspace has its own theme and currency.`
            : 'Preferences scoped to this koinkat account. Each workspace has its own theme and currency.'
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <Card>
          <div className="flex flex-col gap-5">
            <CurrencyPicker
              label="Preferred Currency"
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
              label="Decimal Separator"
              value={decSep}
              onChange={(e) => setDecSep(e.target.value as DecimalSeparator)}
              options={[
                { value: '.', label: '1,234.56 (dot)' },
                { value: ',', label: '1.234,56 (comma)' },
              ]}
            />

            <div className="flex items-center gap-3 pt-2">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : 'Save changes'}
              </Button>
              {saved && (
                <span className="text-sm" style={{ color: 'var(--success)' }}>
                  Saved!
                </span>
              )}
            </div>
          </div>
        </Card>

        {/* Link to bank linking for sandbox/linked koinkat accounts */}
        {activeKoinkatAccount && activeKoinkatAccount.connectionType !== 'manual' && (
          <div className="flex flex-col gap-2">
            <Link to="/bank-link" className="block">
              <Card>
                <div className="flex items-center gap-4">
                  <div
                    className="w-11 h-11 rounded-lg shrink-0 flex items-center justify-center"
                    style={{ backgroundColor: 'var(--input-bg)' }}
                  >
                    <Landmark size={22} style={{ color: 'var(--primary)' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                      Bank connection
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {connectionLabel} - link another bank to this workspace.
                    </p>
                  </div>
                  <ArrowRight size={18} style={{ color: 'var(--text-muted)' }} />
                </div>
              </Card>
            </Link>
            <button
              type="button"
              onClick={() => setGuideOpen(true)}
              className="text-xs underline cursor-pointer self-start"
              style={{ color: 'var(--primary)' }}
            >
              How to get Enable Banking credentials
            </button>
          </div>
        )}
      </div>

      {/* Edit Enable Banking credentials in-place (without recreating the
          workspace). Recovers from the case where the redirect URL was saved
          as koinkat://auth-callback and EB now rejects /auth requests with
          REDIRECT_URI_NOT_ALLOWED. */}
      {activeKoinkatAccount && activeKoinkatAccount.connectionType !== 'manual' && (
        <BankCredentialsCard onOpenGuide={() => setGuideOpen(true)} />
      )}

      {/* Per-connection management - pull older history + full resync override */}
      {activeKoinkatAccount &&
        activeKoinkatAccount.connectionType !== 'manual' &&
        connections.length > 0 && (
          <Card className="mt-6">
            <p
              className="uppercase mb-3"
              style={UPPERCASE_LABEL}
            >
              Connected banks · sync settings
            </p>
            {isSyncing && (
              <p
                className="mb-3"
                style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-body-sm)' }}
              >
                Syncing - importing transactions… this can take a while for
                long histories.
              </p>
            )}
            {lastSyncError && (
              <p
                className="mb-3 text-sm break-words"
                style={{ color: 'var(--danger)' }}
              >
                Last sync failed: {lastSyncError}
              </p>
            )}
            {syncResult && !isSyncing && (
              <p
                className="mb-3 text-sm"
                style={{ color: 'var(--text)' }}
              >
                {syncResult}
              </p>
            )}
            <div className="flex flex-col gap-3">
              {connections.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between gap-3 p-3 rounded"
                  style={{
                    border: '1px solid var(--border)',
                    backgroundColor: 'var(--input-bg)',
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <p
                      className="truncate"
                      style={{ color: 'var(--text)', fontSize: 'var(--fs-body)', fontWeight: 'var(--fw-medium)' }}
                    >
                      {c.aspspName}{' '}
                      <span style={{ color: 'var(--text-muted)', fontWeight: 'var(--fw-regular)' }}>
                        · {c.aspspCountry}
                      </span>
                    </p>
                    <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-rate)' }}>
                      Status: {c.status}
                      {' · '}
                      {floors[c.id]
                        ? `Import floor: ${floors[c.id]}`
                        : 'Import floor: default (180 days)'}
                      {c.lastSyncedAt && ` · Last synced ${c.lastSyncedAt}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {c.status !== 'active' && (
                      <Link to="/bank-link">
                        <Button
                          variant="primary"
                          title="Bank consent expires after at most 180 days. Re-linking the same bank reuses your existing accounts and preserves all transaction history."
                        >
                          Reconnect
                        </Button>
                      </Link>
                    )}
                    <Button
                      variant="secondary"
                      disabled={isSyncing || c.status !== 'active'}
                      onClick={() => setPullOlderTarget(c)}
                    >
                      <Clock size={14} /> Pull older history
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={isSyncing || disconnecting}
                      onClick={() => { setDisconnectError(null); setDisconnectTarget(c); }}
                      title="Remove this bank connection. Its accounts become manual and all transaction history is kept."
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <div
              className="mt-4 pt-4"
              style={{ borderTop: '1px solid var(--border)' }}
            >
              <p
                className="mb-2"
                style={{
                  color: 'var(--text)',
                  fontSize: 'var(--fs-body-sm)',
                  fontWeight: 'var(--fw-medium)',
                }}
              >
                Re-pull everything from scratch
              </p>
              <p
                className="mb-3"
                style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-rate)' }}
              >
                Re-import every transaction from 180 days ago (or as far back as each
                bank allows), ignoring any import floor you've set. Use only if your
                categorizations are in bad shape and you want a clean slate;
                confirmed transactions will be flagged for review again.
              </p>
              <Button
                variant="ghost"
                disabled={isSyncing}
                onClick={() => setFullResyncConfirmOpen(true)}
              >
                <RotateCcw size={14} /> Re-pull everything from scratch
              </Button>
            </div>
          </Card>
        )}

      {/* Backup & export */}
      <Card className="mt-6">
        <p
          className="uppercase mb-3"
          style={UPPERCASE_LABEL}
        >
          Backup &amp; export
        </p>
        <p
          className="mb-4"
          style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-rate)' }}
        >
          Your data lives only on this device. Export regularly so you can
          restore from another machine if needed.
        </p>

        {exportError && (
          <p
            className="mb-3 text-sm"
            style={{ color: 'var(--danger)' }}
          >
            {exportError}
          </p>
        )}
        {exportSuccess && (
          <p
            className="mb-3 text-sm"
            style={{ color: 'var(--success)' }}
          >
            {exportSuccess}
          </p>
        )}

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <div>
              <Button onClick={handleExportJson} disabled={isExportingJson}>
                <Download size={14} />{' '}
                {isExportingJson ? 'Exporting…' : 'Export as JSON'}
              </Button>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-rate)' }}>
              Active workspace only. Excludes Enable Banking credentials for
              security.
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <div>
              <Button
                variant="secondary"
                onClick={handleExportDb}
                disabled={isExportingDb}
              >
                <Download size={14} />{' '}
                {isExportingDb ? 'Exporting…' : 'Export database file'}
              </Button>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-rate)' }}>
              Entire database - all workspaces. The full nuclear-option backup.
              The Enable Banking private key normally lives in your OS
              keychain (not in this file), but treat the export as sensitive:
              it holds all your financial data, and on systems without a
              keychain the key is inside it too.
            </p>
          </div>
        </div>
      </Card>

      {/* Leave this workspace */}
      <div className="mt-8 flex flex-col items-start gap-1.5">
        <Button variant="ghost" onClick={() => exitWorkspace()}>
          <LogOut size={14} /> Leave this workspace
        </Button>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Returns you to the workspace hub. All data stays on this device -
          nothing is deleted.
        </p>
      </div>

      {/* Pull older history modal */}
      <PullOlderHistoryModal
        connection={pullOlderTarget}
        currentFloor={pullOlderTarget ? floors[pullOlderTarget.id] ?? null : null}
        isSyncing={isSyncing}
        onClose={() => setPullOlderTarget(null)}
        onConfirm={async (newFloor) => {
          if (!pullOlderTarget) return;
          setSyncResult(null);
          const result = await startPullOlderHistory(pullOlderTarget.id, newFloor);
          setPullOlderTarget(null);
          await loadFloors();
          // Surface the outcome - without this the modal just closes and the
          // user has to hunt through Review/Transactions to learn anything.
          if (!useBankStore.getState().lastSyncError) {
            setSyncResult(
              `Pulled older history: ${result.imported} imported, ${result.skipped} already present.` +
                (result.incomplete
                  ? ' The bank rate limit cut the pull short - the rest arrives on the next sync.'
                  : ''),
            );
          }
        }}
      />

      <BankSetupGuide open={guideOpen} onClose={() => setGuideOpen(false)} />

      {/* Remove-connection confirmation */}
      <Modal
        open={disconnectTarget !== null}
        onClose={() => setDisconnectTarget(null)}
        title="Remove bank connection?"
      >
        <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
          Removing{' '}
          <strong style={{ color: 'var(--text)' }}>
            {disconnectTarget?.aspspName}
          </strong>{' '}
          stops syncing and revokes the bank session. Its accounts stay in
          Koinkat as manual accounts, and every imported transaction is kept.
          You can re-link the same bank later - history is matched back up
          automatically.
        </p>
        {disconnectError && (
          <p className="text-sm mb-4" style={{ color: 'var(--danger)' }}>
            {disconnectError}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <Button
            variant="ghost"
            onClick={() => setDisconnectTarget(null)}
            disabled={disconnecting}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={disconnecting}
            onClick={async () => {
              if (!disconnectTarget) return;
              setDisconnecting(true);
              setDisconnectError(null);
              try {
                await disconnectBank(disconnectTarget.id);
                setDisconnectTarget(null);
                await loadConnections();
                await loadFloors();
              } catch (err) {
                setDisconnectError(
                  err instanceof Error ? err.message : 'Failed to remove the connection',
                );
              } finally {
                setDisconnecting(false);
              }
            }}
          >
            {disconnecting ? 'Removing...' : 'Remove connection'}
          </Button>
        </div>
      </Modal>

      {/* Full resync override confirmation */}
      <Modal
        open={fullResyncConfirmOpen}
        onClose={() => setFullResyncConfirmOpen(false)}
        title="Re-pull everything from scratch?"
      >
        <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>
          This will re-import every transaction from 180 days ago (or as far back as
          your bank allows) and put them back into Review. Use this only if your
          categorizations are a mess and you want a clean slate.
        </p>
        <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
          Everything you already reviewed and confirmed will return to the
          Review inbox and need confirming again.
        </p>
        <div className="flex justify-end gap-3">
          <Button
            variant="ghost"
            onClick={() => setFullResyncConfirmOpen(false)}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={isSyncing}
            onClick={async () => {
              setFullResyncConfirmOpen(false);
              setSyncResult(null);
              await startFullResyncOverride();
              await loadFloors();
              if (!useBankStore.getState().lastSyncError) {
                setSyncResult(
                  'Full re-pull finished. Re-imported transactions are back in the Review inbox.',
                );
              }
            }}
          >
            {isSyncing ? 'Re-pulling...' : 'Re-pull everything'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function PullOlderHistoryModal({
  connection,
  currentFloor,
  isSyncing,
  onClose,
  onConfirm,
}: {
  connection: BankConnection | null;
  currentFloor: string | null;
  isSyncing: boolean;
  onClose: () => void;
  onConfirm: (newFloor: string) => Promise<void>;
}) {
  const suggested =
    currentFloor ?? format(subDays(new Date(), 180), 'yyyy-MM-dd');
  const [floor, setFloor] = useState(suggested);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setFloor(suggested);
  }, [suggested, connection?.id]);

  async function handle() {
    if (!floor) return;
    setSubmitting(true);
    try {
      await onConfirm(floor);
    } finally {
      setSubmitting(false);
    }
  }

  const todayIso = format(new Date(), 'yyyy-MM-dd');

  return (
    <Modal
      open={connection !== null}
      onClose={onClose}
      title={connection ? `Pull older history: ${connection.aspspName}` : 'Pull older history'}
    >
      <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>
        Import transactions starting from a new date. Anything older than the date
        you pick won't be touched. Transactions already in Koinkat are deduped by
        external reference; you won't get duplicates.
      </p>
      <Input
        label="New import floor"
        type="date"
        value={floor}
        max={todayIso}
        onChange={(e) => setFloor(e.target.value)}
      />
      <div className="flex justify-end gap-3 mt-4">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={handle} disabled={submitting || isSyncing || !floor}>
          {submitting || isSyncing ? 'Pulling...' : 'Pull'}
        </Button>
      </div>
    </Modal>
  );
}

function BankCredentialsCard({ onOpenGuide }: { onOpenGuide: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const [appId, setAppId] = useState('');
  // Holds ONLY a freshly picked .pem file's content, transiently until the
  // user saves. The key already stored in the DB is deliberately NEVER
  // loaded into React state - keeping the private key in the fiber tree for
  // the whole page session would expose it to DevTools and heap dumps.
  const [pemContent, setPemContent] = useState('');
  // pemFileName non-empty = user picked a new file in this session.
  // Empty + pemHadInitialValue true = keep the PEM that's stored in the DB.
  const [pemFileName, setPemFileName] = useState('');
  const [pemHadInitialValue, setPemHadInitialValue] = useState(false);
  const [redirectUrl, setRedirectUrl] = useState(DEFAULT_CALLBACK_URL);
  const [environment, setEnvironment] = useState<BankEnvironment>('production');
  // Where the saved key lives: OS keychain (normal) or the local database
  // (fallback when no credential store is available). Drives a small notice.
  const [pemStorage, setPemStorage] = useState<'keychain' | 'database' | 'none'>('none');
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadApiConfig()
      .then(async (c) => {
        if (cancelled) return;
        const storage = await getPemStorage().catch(() => 'none' as const);
        if (cancelled) return;
        setAppId(c.appId ?? '');
        // "A key is saved" also when the DB holds the keychain sentinel but
        // the store was unreachable just now (transient failure) - otherwise
        // a hiccup would force re-picking the .pem to edit ANY field.
        setPemHadInitialValue(Boolean(c.privateKeyPem) || storage !== 'none');
        setRedirectUrl(c.redirectUrl || DEFAULT_CALLBACK_URL);
        setEnvironment(c.environment);
        setPemStorage(storage);
        setLoaded(true);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
      setPemFileName(parts[parts.length - 1]);
      setError(null);
    } catch (err) {
      setError(
        `Failed to read PEM file: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  function validate(): string | null {
    if (!appId.trim()) return 'Application ID is required.';
    if (!pemContent.trim() && !pemHadInitialValue) {
      return 'Private key is required.';
    }
    const r = redirectUrl.trim();
    if (!r) {
      return 'Redirect URL is required - the https:// callback URL you registered on your Enable Banking application.';
    }
    if (!r.startsWith('https://')) {
      return 'Redirect URL must start with https:// (Enable Banking rejects anything else).';
    }
    return null;
  }

  async function handleSave() {
    const v = validate();
    if (v) {
      setError(v);
      setSuccess(null);
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      // When the user didn't pick a new file, materialize the stored key
      // transiently for the save call - it never enters React state.
      let pem = pemContent;
      if (!pem.trim() && pemHadInitialValue) {
        const c = await loadApiConfig();
        pem = c.privateKeyPem ?? '';
        if (!pem.trim()) {
          // The stored key could not be resolved (OS keychain unreachable).
          // Abort rather than overwrite the stored key with an empty one.
          setError(
            'Could not read the stored private key (OS keychain unavailable right now). Retry later, or pick the .pem file again.',
          );
          setSaving(false);
          return;
        }
      }
      await saveCredentials({
        appId: appId.trim(),
        privateKeyPem: pem,
        environment,
        redirectUrl: redirectUrl.trim(),
      });
      // The key is persisted (keychain or DB fallback) - drop the transient
      // copy from state and collapse the "newly picked file" UI back into
      // "current key kept".
      setPemContent('');
      setPemFileName('');
      setPemHadInitialValue(true);
      setPemStorage(await getPemStorage().catch(() => 'none' as const));
      setSuccess('Credentials saved.');
      setTimeout(() => setSuccess(null), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleVerify() {
    setVerifying(true);
    setError(null);
    setSuccess(null);
    try {
      const verifyError = await verifyCredentials();
      if (verifyError) {
        setError(`Verify failed: ${verifyError}`);
      } else {
        setSuccess('Credentials verified.');
        setTimeout(() => setSuccess(null), 2000);
      }
    } finally {
      setVerifying(false);
    }
  }

  if (!loaded) {
    return (
      <Card className="mt-6">
        <p style={{ color: 'var(--text-muted)' }}>Loading bank credentials...</p>
      </Card>
    );
  }

  const showCoinkatWarning = redirectUrl.trim().startsWith('koinkat://');

  return (
    <Card className="mt-6">
      <p
        className="uppercase mb-3"
        style={UPPERCASE_LABEL}
      >
        Bank credentials
      </p>
      <p
        className="mb-4"
        style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-rate)' }}
      >
        Edit the Enable Banking API credentials for this workspace. The redirect
        URL must exactly match what you registered on Enable Banking. Environment:{' '}
        <strong style={{ color: 'var(--text)' }}>{environment}</strong>.
      </p>

      <div className="flex flex-col gap-5">
        <button
          type="button"
          onClick={onOpenGuide}
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
              {pemHadInitialValue ? 'Replace .pem file...' : 'Choose .pem file...'}
            </Button>
            {pemFileName && (
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {pemFileName} (new - save to apply)
              </span>
            )}
            {!pemFileName && pemHadInitialValue && (
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Current key kept. Pick a file to replace it.
              </span>
            )}
          </div>
          {pemStorage === 'keychain' && (
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Stored in your OS keychain (not in the app database).
            </span>
          )}
          {pemStorage === 'database' && (
            <span className="text-xs" style={{ color: 'var(--warning)' }}>
              Stored in the local app database - no OS keychain was available
              on this system. Re-save the credentials to retry the keychain.
            </span>
          )}
        </div>

        <Input
          label="Redirect URL"
          placeholder={DEFAULT_CALLBACK_URL}
          value={redirectUrl}
          onChange={(e) => setRedirectUrl(e.target.value)}
          helpText="Koinkat's shared callback page is pre-filled - register this exact URL (trailing slash included) on your Enable Banking application. You can replace it with a page you host yourself."
        />

        {showCoinkatWarning && (
          <p
            className="text-xs flex items-start gap-1.5"
            style={{ color: 'var(--danger)' }}
          >
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>
              Enable Banking rejects koinkat:// redirect URLs at runtime. Use the
              https:// URL you registered on the Enable Banking application page.
            </span>
          </p>
        )}

        {error && (
          <p
            className="text-xs flex items-start gap-1.5"
            style={{ color: 'var(--danger)' }}
          >
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span className="break-words">{error}</span>
          </p>
        )}
        {success && (
          <p className="text-xs" style={{ color: 'var(--success)' }}>
            {success}
          </p>
        )}

        <div className="flex gap-3 flex-wrap">
          <Button onClick={handleSave} disabled={saving || verifying}>
            {saving ? 'Saving...' : 'Save credentials'}
          </Button>
          <Button
            variant="secondary"
            onClick={handleVerify}
            disabled={verifying || saving}
          >
            {verifying ? 'Verifying...' : 'Verify'}
          </Button>
        </div>
      </div>
    </Card>
  );
}
