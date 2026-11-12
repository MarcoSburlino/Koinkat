import { DEFAULT_CALLBACK_URL } from '../lib/constants';
import { IS_DEMO_APP } from '../lib/build-profile';
import { UPPERCASE_LABEL } from '../lib/label-styles';
import { AssistantSettingsCard } from '../components/assistant/AssistantSettingsCard';
import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { format, subDays } from 'date-fns';
import {
  Landmark,
  Clock,
  RotateCcw,
  LogOut,
  Download,
  CircleAlert,
  History,
  Check,
  ChevronRight,
  DatabaseBackup,
  Info,
  MessagesSquare,
  Moon,
  SlidersHorizontal,
  Sun,
} from 'lucide-react';
import {
  SettingsNav,
  SettingsSection,
  SettingsRow,
  SegmentedControl,
  type SettingsNavItem,
} from '../components/settings/SettingsLayout';
import { save, open as openDialog } from '@tauri-apps/plugin-dialog';
import { open as openUrl } from '@tauri-apps/plugin-shell';
import { writeTextFile, readTextFile } from '@tauri-apps/plugin-fs';
import { exportDatabaseSnapshot } from '../db/database';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { InfoBanner } from '../components/ui/InfoBanner';
import { BankSetupGuide } from '../components/BankSetupGuide';
import { CurrencyPicker } from '../components/ui/CurrencyPicker';
import { PageHeader } from '../components/layout/PageHeader';
import { useAppStore } from '../stores/app-store';
import { useBankStore } from '../stores/bank-store';
import { useKoinkatAccountStore } from '../stores/koinkat-account-store';
import { updateSettings } from '../services/settings-service';
import { getConnectionSyncFloor, disconnectBank } from '../services/bank-sync-service';
import { exportWorkspaceAsJson } from '../services/export-service';
import {
  BACKUPS_TO_KEEP,
  backupsDirectory,
  createBackup,
  listBackups,
  type BackupFile,
} from '../services/backup-service';
import { CopyPathButton } from '../components/ui/CopyPathButton';
import { loadApiConfig, saveCredentials, getPemStorage } from '../services/api-config-service';
import { verifyCredentials } from '../services/enable-banking-service';
import type { Theme, DecimalSeparator, BankEnvironment } from '../types/enums';
import type { BankConnection } from '../types/models';

type PrefField = 'currency' | 'format' | 'theme';

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
  const [savedField, setSavedField] = useState<PrefField | null>(null);
  const [prefError, setPrefError] = useState<string | null>(null);

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
  // Set when the local unlink succeeded but revoking the Enable Banking
  // session did not. The modal stays open on this so the warning cannot be
  // missed - the consent at the bank may still be live.
  const [revocationWarning, setRevocationWarning] = useState<string | null>(null);
  const [licensesOpen, setLicensesOpen] = useState(false);
  const [licensesText, setLicensesText] = useState<string | null>(null);
  const [gplOpen, setGplOpen] = useState(false);
  const [gplText, setGplText] = useState<string | null>(null);

  /**
   * The notice file is ~740 kB, so it is a lazy chunk rather than part of the
   * main bundle - inlining it statically nearly doubled the entry chunk for a
   * screen almost nobody opens. Vite still inlines the text at build time, so
   * what is shown here is exactly what shipped; no filesystem access needed.
   */
  const openLicenses = useCallback(async () => {
    setLicensesOpen(true);
    if (licensesText === null) {
      const mod = await import('../../THIRD-PARTY-LICENSES.md?raw');
      setLicensesText(mod.default);
    }
  }, [licensesText]);

  /**
   * Koinkat's OWN licence. GPL-3.0 section 5 requires the work to carry
   * appropriate legal notices, so the text ships as a bundle resource
   * (tauri.conf.json) and is reachable here, next to the third-party
   * notices. Same lazy-chunk treatment: ~35 kB nobody needs at startup.
   */
  const openGpl = useCallback(async () => {
    setGplOpen(true);
    if (gplText === null) {
      const mod = await import('../../LICENSE?raw');
      setGplText(mod.default);
    }
  }, [gplText]);

  /** Dismiss the remove-connection modal, clearing both failure states. */
  const closeDisconnectModal = useCallback(() => {
    setDisconnectTarget(null);
    setDisconnectError(null);
    setRevocationWarning(null);
  }, []);
  const [guideOpen, setGuideOpen] = useState(false);

  const [isExportingJson, setIsExportingJson] = useState(false);
  const [isExportingDb, setIsExportingDb] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);
  // Automatic backups: null until loaded (or if listing failed).
  const [backups, setBackups] = useState<BackupFile[] | null>(null);
  const [backupsDir, setBackupsDir] = useState<string | null>(null);
  const [isBackingUp, setIsBackingUp] = useState(false);

  function flashSuccess(msg: string) {
    setExportSuccess(msg);
    setTimeout(() => setExportSuccess(null), 2000);
  }

  const refreshBackups = useCallback(async () => {
    try {
      const [list, dir] = await Promise.all([listBackups(), backupsDirectory()]);
      setBackups(list);
      setBackupsDir(dir);
    } catch (err) {
      console.warn('[backup] could not list backups:', err);
      setBackups(null);
    }
  }, []);

  useEffect(() => {
    void refreshBackups();
  }, [refreshBackups]);

  async function handleBackupNow() {
    setIsBackingUp(true);
    setExportError(null);
    setExportSuccess(null);
    try {
      await createBackup('manual');
      await refreshBackups();
      flashSuccess('Backup saved.');
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Backup failed');
    } finally {
      setIsBackingUp(false);
    }
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
      const today = format(new Date(), 'yyyy-MM-dd');
      const path = await save({
        defaultPath: `koinkat-database-${today}.db`,
        filters: [{ name: 'SQLite database', extensions: ['db'] }],
      });
      if (!path) return;
      // One consistent snapshot, rather than checkpoint-then-copy. The old
      // two-step could capture a torn mixture if a sync committed between
      // the checkpoint and the read. See exportDatabaseSnapshot.
      await exportDatabaseSnapshot(path);
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

  /**
   * Save one preference immediately (no Save button). Writes to the active
   * workspace's row; the koinkat-account store is reloaded so the header
   * chip and theme follow at once.
   */
  async function persistPref(
    field: PrefField,
    changes: Partial<{ preferredCurrency: string; theme: Theme; decimalSeparator: DecimalSeparator }>,
  ) {
    setPrefError(null);
    try {
      await updateSettings(changes);
      setSettings({ ...useAppStore.getState().settings, ...changes });
      await loadActiveKoinkatAccount();
      setSavedField(field);
      setTimeout(() => setSavedField((f) => (f === field ? null : f)), 2000);
    } catch (e) {
      setPrefError(e instanceof Error ? e.message : String(e));
    }
  }

  const hasBank = !!activeKoinkatAccount && activeKoinkatAccount.connectionType !== 'manual';
  const navItems: SettingsNavItem[] = [
    { id: 'general', label: 'General', icon: SlidersHorizontal },
    ...(hasBank ? [{ id: 'bank', label: 'Bank connection', icon: Landmark }] : []),
    { id: 'assistant', label: 'AI assistant', icon: MessagesSquare },
    { id: 'data', label: 'Backups & data', icon: DatabaseBackup },
    { id: 'about', label: 'About', icon: Info },
  ];
  const saved = (field: PrefField) =>
    savedField === field ? (
      <span className="inline-flex items-center gap-1" style={{ color: 'var(--success)' }}>
        <Check size={13} /> Saved
      </span>
    ) : null;

  return (
    <div>
      <PageHeader
        serif
        label="Setup"
        title="Settings"
        subtitle={
          activeKoinkatAccount
            ? `Settings apply to the workspace "${activeKoinkatAccount.name}" unless marked "All workspaces".`
            : 'Settings apply to this workspace unless marked "All workspaces".'
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[200px_minmax(0,1fr)] gap-8 items-start">
        <SettingsNav items={navItems} />

        <div className="min-w-0 max-w-4xl">
          {/* ── General ─────────────────────────────────────────── */}
          <SettingsSection
            id="general"
            title="General"
            description="How amounts and the app look. Changes save as you make them."
            scope="workspace"
          >
            <SettingsRow
              label="Main currency"
              help="Net worth, totals and charts are shown in this currency. Accounts keep their own."
              status={saved('currency')}
            >
              <div className="md:w-[320px]">
                <CurrencyPicker
                  value={currency}
                  onChange={(c) => {
                    setCurrency(c);
                    void persistPref('currency', { preferredCurrency: c });
                  }}
                />
              </div>
            </SettingsRow>
            <SettingsRow label="Number format" help="How decimals and thousands are written." status={saved('format')}>
              <SegmentedControl
                label="Number format"
                value={decSep}
                onChange={(v) => {
                  setDecSep(v);
                  void persistPref('format', { decimalSeparator: v });
                }}
                options={[
                  { value: ',', label: <span className="amount">1.234,56</span> },
                  { value: '.', label: <span className="amount">1,234.56</span> },
                ]}
              />
            </SettingsRow>
            <SettingsRow label="Appearance" status={saved('theme')}>
              <SegmentedControl
                label="Appearance"
                value={theme}
                onChange={(v) => {
                  setTheme(v);
                  void persistPref('theme', { theme: v });
                }}
                options={[
                  { value: 'light', label: <span className="inline-flex items-center gap-1.5"><Sun size={14} /> Light</span> },
                  { value: 'dark', label: <span className="inline-flex items-center gap-1.5"><Moon size={14} /> Dark</span> },
                ]}
              />
            </SettingsRow>
            <SettingsRow
              label="Switch workspace"
              help="Go back to the list of workspaces. Nothing is deleted."
            >
              <Button variant="secondary" onClick={() => void exitWorkspace()}>
                <LogOut size={14} /> Workspace list
              </Button>
            </SettingsRow>
            {prefError && (
              <SettingsRow label={<span style={{ color: 'var(--danger)' }}>Could not save</span>} help={prefError} />
            )}
          </SettingsSection>

          {/* ── Bank connection ─────────────────────────────────── */}
          {hasBank && (
            <SettingsSection
              id="bank"
              title="Bank connection"
              description={
                !isConfigured
                  ? 'Enable Banking is not set up yet: add your credentials below.'
                  : isDemoMode
                    ? 'Enable Banking sandbox: test banks with made-up data.'
                    : 'Linked to your banks through Enable Banking.'
              }
              scope="workspace"
            >
              <SettingsRow
                label="Connected banks"
                help={
                  connections.length === 0
                    ? 'No bank linked yet.'
                    : 'Bank consent lasts up to 180 days; reconnecting keeps all history.'
                }
                stacked
              >
                {isSyncing && (
                  <p className="mb-3" style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-body-sm)' }}>
                    Importing transactions... long histories take a while.
                  </p>
                )}
                {lastSyncError && (
                  <p className="mb-3 break-words" style={{ color: 'var(--danger)', fontSize: 'var(--fs-body-sm)' }}>
                    Last sync failed: {lastSyncError}
                  </p>
                )}
                {syncResult && !isSyncing && (
                  <p className="mb-3" style={{ color: 'var(--text)', fontSize: 'var(--fs-body-sm)' }}>
                    {syncResult}
                  </p>
                )}
                <div className="flex flex-col gap-2">
                  {connections.map((c) => (
                    <div
                      key={c.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-lg"
                      style={{ backgroundColor: 'var(--surface-alt)' }}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="flex items-center gap-2" style={{ color: 'var(--text)', fontWeight: 'var(--fw-medium)' }}>
                          <span className="truncate">{c.aspspName}</span>
                          <span style={{ color: 'var(--text-muted)', fontWeight: 'var(--fw-regular)', fontSize: 'var(--fs-body-sm)' }}>
                            {c.aspspCountry}
                          </span>
                          <span className="kk-chip" data-tone={c.status === 'active' ? 'income' : 'warning'}>
                            {c.status === 'active' ? 'Active' : c.status === 'expired' ? 'Expired' : c.status}
                          </span>
                        </p>
                        <p className="mt-0.5" style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-body-sm)' }}>
                          {c.lastSyncedAt ? `Last synced ${format(new Date(c.lastSyncedAt), 'd MMM yyyy, HH:mm')}` : 'Not synced yet'}
                          {' · '}
                          {floors[c.id] ? `History from ${floors[c.id]}` : 'Last 180 days'}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {c.status !== 'active' && (
                          <Link to="/bank-link">
                            <Button variant="primary">Reconnect</Button>
                          </Link>
                        )}
                        <Button
                          variant="ghost"
                          disabled={isSyncing || c.status !== 'active'}
                          onClick={() => setPullOlderTarget(c)}
                          title="Import transactions from further back"
                        >
                          <Clock size={14} /> Older history
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={isSyncing || disconnecting}
                          onClick={() => {
                            setDisconnectError(null);
                            setDisconnectTarget(c);
                          }}
                          title="Its accounts become manual; all transactions are kept."
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                  <Link to="/bank-link">
                    <Button variant="secondary">
                      <Landmark size={14} /> Link another bank
                    </Button>
                  </Link>
                  <Button variant="ghost" onClick={() => setGuideOpen(true)}>
                    Setup guide
                  </Button>
                </div>
              </SettingsRow>

              <SettingsRow label="Enable Banking credentials" help="Application ID, private key and redirect URL. Rarely needed after setup." stacked>
                <details className="kk-details">
                  <summary className="kk-disclosure" aria-label="Show credentials">
                    <span>Show credentials</span>
                    <ChevronRight size={14} aria-hidden className="kk-disclosure-chevron" />
                  </summary>
                  <div className="mt-4">
                    <BankCredentialsCard bare onOpenGuide={() => setGuideOpen(true)} />
                  </div>
                </details>
              </SettingsRow>

              {connections.length > 0 && (
                <SettingsRow
                  label="Re-import everything"
                  help="Fetches the last 180 days again from every bank. Only for a clean slate: reviewed transactions go back to Review."
                >
                  <Button variant="ghost" disabled={isSyncing} onClick={() => setFullResyncConfirmOpen(true)}>
                    <RotateCcw size={14} /> Re-import...
                  </Button>
                </SettingsRow>
              )}
            </SettingsSection>
          )}

          {/* ── AI assistant ────────────────────────────────────── */}
          <SettingsSection
            id="assistant"
            title="AI assistant"
            description="Ask about your money in plain language. Read-only, off until you turn it on."
            scope="workspace"
          >
            <AssistantSettingsCard embedded />
          </SettingsSection>

          {/* ── Backups & data ──────────────────────────────────── */}
          <SettingsSection
            id="data"
            title="Backups & data"
            description="Everything lives only on this computer."
            scope="app"
          >
            {(exportError || exportSuccess) && (
              <SettingsRow
                label={
                  <span style={{ color: exportError ? 'var(--danger)' : 'var(--success)' }}>
                    {exportError ? 'Export failed' : 'Done'}
                  </span>
                }
                help={exportError ?? exportSuccess}
              />
            )}
            <SettingsRow
              label="Automatic backups"
              help={`A full copy every day you use Koinkat, after each bank sync and before deleting a user or workspace. The newest ${BACKUPS_TO_KEEP} are kept, and offered back if the database is ever empty.`}
              status={
                <span style={{ color: 'var(--text-secondary)' }}>
                  {backups === null
                    ? 'Backups could not be listed.'
                    : backups.length === 0
                      ? 'No backups yet.'
                      : `${backups.length} kept · newest ${format(backups[0].takenAt, 'd MMM yyyy, HH:mm')}`}
                </span>
              }
            >
              <div className="flex flex-wrap gap-2 md:justify-end">
                <Button variant="secondary" onClick={() => void handleBackupNow()} disabled={isBackingUp}>
                  <History size={14} /> {isBackingUp ? 'Backing up...' : 'Back up now'}
                </Button>
                {backupsDir && <CopyPathButton path={backupsDir} variant="ghost" />}
              </div>
            </SettingsRow>
            <SettingsRow
              label="Export this workspace"
              help="A JSON file of this workspace's data, to keep or to read in other tools. Bank credentials are left out."
            >
              <Button variant="secondary" onClick={handleExportJson} disabled={isExportingJson}>
                <Download size={14} /> {isExportingJson ? 'Exporting...' : 'Export JSON'}
              </Button>
            </SettingsRow>
            <SettingsRow
              label="Export everything"
              help="The whole database, every workspace: a complete backup to move to another computer. Keep it as private as the app itself."
            >
              <Button variant="secondary" onClick={handleExportDb} disabled={isExportingDb}>
                <Download size={14} /> {isExportingDb ? 'Exporting...' : 'Export database'}
              </Button>
            </SettingsRow>
          </SettingsSection>

          {/* ── About ───────────────────────────────────────────── */}
          <SettingsSection id="about" title="About">
            <SettingsRow
              label={`Koinkat ${__APP_VERSION__}`}
              help={`Free software under GPL-3.0-or-later, with no warranty. Source for this version: github.com/MarcoSburlino/Koinkat, tag v${__APP_VERSION__}.`}
            >
              <div className="flex flex-wrap gap-2 md:justify-end">
                <Button variant="ghost" onClick={openGpl}>
                  Licence
                </Button>
                <Button variant="ghost" onClick={openLicenses}>
                  Third-party licences
                </Button>
              </div>
            </SettingsRow>
          </SettingsSection>
        </div>
      </div>

      {/* Koinkat's own licence, loaded on demand - see openGpl. */}
      <Modal
        open={gplOpen}
        onClose={() => setGplOpen(false)}
        size="lg"
        title="GNU General Public License v3.0"
      >
        <pre
          className="text-xs overflow-auto whitespace-pre-wrap"
          style={{
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
            maxHeight: '60vh',
            lineHeight: '1.6',
          }}
        >
          {gplText ?? 'Loading licence...'}
        </pre>
        <div className="flex justify-end pt-4">
          <Button variant="primary" onClick={() => setGplOpen(false)}>
            Close
          </Button>
        </div>
      </Modal>

      {/* Third-party licences, loaded on demand - see openLicenses. */}
      <Modal
        open={licensesOpen}
        onClose={() => setLicensesOpen(false)}
        size="lg"
        title="Third-party licences"
      >
        <pre
          className="text-xs overflow-auto whitespace-pre-wrap"
          style={{
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
            maxHeight: '60vh',
            lineHeight: '1.6',
          }}
        >
          {licensesText ?? 'Loading licences...'}
        </pre>
        <div className="flex justify-end pt-4">
          <Button variant="primary" onClick={() => setLicensesOpen(false)}>
            Close
          </Button>
        </div>
      </Modal>

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
        onClose={closeDisconnectModal}
        title={revocationWarning ? 'Connection removed' : 'Remove bank connection?'}
      >
        {revocationWarning ? (
          <>
            <InfoBanner
              variant="warning"
              title="Your consent at the bank may still be active"
              className="mb-4"
            >
              <p className="mb-2">
                <strong>{disconnectTarget?.aspspName}</strong> has been removed from
                Koinkat and its accounts are now manual accounts. But Koinkat could
                not reach Enable Banking to revoke the consent, so your bank may
                still treat it as live.
              </p>
              <p className="mb-2">
                Revoke it yourself from your bank's own consent dashboard, or at
                Enable Banking. Revoking at your bank is the one that always works,
                because it does not depend on any other service being reachable.
              </p>
              <p className="mb-2">
                <Button
                  variant="secondary"
                  onClick={() => openUrl('https://enablebanking.com/data-sharing-consents/')}
                >
                  Open Enable Banking consents
                </Button>
              </p>
              <p style={{ color: 'var(--text-muted)' }}>Reason: {revocationWarning}</p>
            </InfoBanner>
            <div className="flex justify-end">
              <Button variant="primary" onClick={closeDisconnectModal}>
                Done
              </Button>
            </div>
          </>
        ) : (
          <>
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
                onClick={closeDisconnectModal}
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
                    const result = await disconnectBank(disconnectTarget.id);
                    await loadConnections();
                    await loadFloors();
                    if (result.sessionRevoked) {
                      setDisconnectTarget(null);
                    } else {
                      // Local teardown succeeded; hold the modal open on the
                      // warning so the live-consent caveat cannot be missed.
                      setRevocationWarning(
                        result.revocationError ?? 'Enable Banking could not be reached.',
                      );
                    }
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
          </>
        )}
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

function BankCredentialsCard({ onOpenGuide, bare = false }: { onOpenGuide: () => void; bare?: boolean }) {
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
  const [environment, setEnvironment] = useState<BankEnvironment>(IS_DEMO_APP ? 'sandbox' : 'production');
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
      <p className={bare ? '' : 'mt-6'} style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-body-sm)' }}>
        Loading bank credentials...
      </p>
    );
  }

  const showCoinkatWarning = redirectUrl.trim().startsWith('koinkat://');

  return (
    <CredentialsFrame bare={bare}>
      {!bare && (
        <p className="uppercase mb-3" style={UPPERCASE_LABEL}>
          Bank credentials
        </p>
      )}
      <p className="mb-4" style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-body-sm)' }}>
        Your Enable Banking application ({environment}). The redirect URL must
        match the one registered there exactly.
      </p>

      <div className={`flex flex-col gap-5 ${bare ? 'max-w-2xl' : ''}`}>
        {!bare && (
        <button
          type="button"
          onClick={onOpenGuide}
          className="text-xs underline cursor-pointer self-start"
          style={{ color: 'var(--primary)' }}
        >
          Need help getting these? Open the setup guide
        </button>
        )}

        <Input
          label="Application ID"
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          value={appId}
          onChange={(e) => setAppId(e.target.value)}
        />

        <div className="flex flex-col gap-1.5">
          <span className="font-medium" style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-body-sm)' }}>
            Private key
          </span>
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
            <CircleAlert size={14} className="mt-0.5 shrink-0" />
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
            <CircleAlert size={14} className="mt-0.5 shrink-0" />
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
    </CredentialsFrame>
  );
}

/** Module-level so the form keeps its identity (and input focus) across renders. */
function CredentialsFrame({ bare, children }: { bare: boolean; children: React.ReactNode }) {
  return bare ? <div>{children}</div> : <Card className="mt-6">{children}</Card>;
}
