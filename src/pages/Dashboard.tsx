import { UPPERCASE_LABEL } from '../lib/label-styles';
import { useEffect, useState, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Plus,
  Star,
  Pencil,
  Trash2,
  ArrowLeftRight,
  List,
  RefreshCw,
  Building2,
  History,
  ArrowRight,
  ListChecks,
  Users,
  AlertTriangle,
  X,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { chartTooltipStyle } from '../lib/chart-style';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { InfoBanner } from '../components/ui/InfoBanner';
import { PageHeader } from '../components/layout/PageHeader';
import { useAppStore } from '../stores/app-store';
import { useBankStore, FX_UNAVAILABLE_MSG, SYNC_INCOMPLETE_MSG } from '../stores/bank-store';
import { ensureTodayRates } from '../services/exchange-rate-service';
import { useKoinkatAccountStore } from '../stores/koinkat-account-store';
import { formatAmount, formatMoney } from '../lib/format';
import { MONTH_NAMES, previousMonth } from '../lib/date-constants';
import { dec } from '../domain/money';
import { getPercentageColor } from '../lib/budget-colors';
import { monthPace } from '../lib/budget-pace';
import * as accountService from '../services/account-service';
import * as transactionService from '../services/transaction-service';
import * as budgetService from '../services/budget-service';
import type { OpenSplitsSummary } from '../services/transaction-service';
import { buildAccountOverview, categoryBreakdown } from '../services/reporting-service';
import { deactivateSandbox } from '../services/demo-service';
import type { Account } from '../types/models';
import type { AccountOverview, CategoryBreakdownRow } from '../services/reporting-service';
import type { PeriodSpendingSummary } from '../services/budget-service';

export function Dashboard() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [overview, setOverview] = useState<AccountOverview | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Account | null>(null);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [openSplits, setOpenSplits] = useState<OpenSplitsSummary>({
    count: 0,
    uncoveredByCurrency: {},
    ids: [],
  });
  const [pendingCount, setPendingCount] = useState(0);
  const settings = useAppStore((s) => s.settings);
  const pendingReviewCount = useAppStore((s) => s.pendingReviewCount);
  const refreshPendingReviewCount = useAppStore(
    (s) => s.refreshPendingReviewCount,
  );
  const {
    isConfigured,
    isDemoMode,
    isSyncing,
    syncIncomplete,
    lastSyncError,
    clearSyncError,
    connections,
    startSync,
    startFullResync,
    loadConfig,
    loadConnections,
    setFxError,
  } = useBankStore();
  const activeKoinkatAccount = useKoinkatAccountStore((s) => s.activeKoinkatAccount);
  const navigate = useNavigate();

  const connectionType = activeKoinkatAccount?.connectionType;
  const isBankDriven = connectionType === 'sandbox' || connectionType === 'linked';

  // Most-recent sync timestamp across active bank connections.
  // Used in the header pill - null when nothing has been synced yet or
  // when the workspace is purely manual.
  const lastSyncedAt = connections.reduce<string | null>((max, c) => {
    if (!c.lastSyncedAt) return max;
    if (!max || c.lastSyncedAt > max) return c.lastSyncedAt;
    return max;
  }, null);
  const showSyncPill = isConfigured;

  // Self-heal guard: only auto-attempt one FX refetch per mount when the
  // overview reports unconvertible balances (empty/stale rate cache).
  const didAttemptFxHealRef = useRef(false);
  const [refreshingRates, setRefreshingRates] = useState(false);

  const load = useCallback(async () => {
    const list = await accountService.listAccounts();
    setAccounts(list);
    if (list.length > 0) {
      let ov = await buildAccountOverview(list, settings.preferredCurrency);
      // If some balances couldn't be converted, the rate cache is likely
      // empty/stale. Try once per mount to fetch today's rates, then rebuild
      // so the dashboard self-heals without a manual click.
      if (ov.unconvertibleCurrencies.length > 0 && !didAttemptFxHealRef.current) {
        didAttemptFxHealRef.current = true;
        const ok = await ensureTodayRates();
        setFxError(ok ? null : FX_UNAVAILABLE_MSG);
        if (ok) {
          ov = await buildAccountOverview(list, settings.preferredCurrency);
        }
      }
      setOverview(ov);
    } else {
      setOverview(null);
    }
    try {
      const splits = await transactionService.getOpenSplitsSummary();
      setOpenSplits(splits);
    } catch {
      setOpenSplits({ count: 0, uncoveredByCurrency: {}, ids: [] });
    }
    try {
      setPendingCount(await transactionService.countPendingTransactions());
    } catch {
      setPendingCount(0);
    }
  }, [settings.preferredCurrency, setFxError]);

  // Manual "Refresh rates" from the warning banner.
  const handleRefreshRates = useCallback(async () => {
    setRefreshingRates(true);
    try {
      const ok = await ensureTodayRates();
      setFxError(ok ? null : FX_UNAVAILABLE_MSG);
      didAttemptFxHealRef.current = true;
      await load();
    } finally {
      setRefreshingRates(false);
    }
  }, [load, setFxError]);

  useEffect(() => {
    load().catch(console.warn);
    loadConfig().catch(console.warn);
    loadConnections().catch(console.warn);
    refreshPendingReviewCount().catch(console.warn);
  }, [load, loadConfig, loadConnections, refreshPendingReviewCount]);

  async function handleExitSandbox() {
    try {
      await deactivateSandbox();
      await loadConfig();
      await loadConnections();
      await load();
    } catch (err) {
      console.error('Failed to exit sandbox:', err);
    }
  }

  async function handlePin(account: Account) {
    try {
      if (account.isPinned) {
        await accountService.unpinAccount(account.id);
      } else {
        await accountService.pinAccount(account.id);
      }
      await load();
    } catch (err) {
      console.error('Failed to toggle pin:', err);
    }
  }

  async function handleDelete() {
    if (!deleteTarget || deletingAccount) return;
    setDeletingAccount(true);
    setDeleteError(null);
    try {
      await accountService.deleteAccount(deleteTarget.id);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : 'Failed to delete account',
      );
    } finally {
      setDeletingAccount(false);
    }
  }

  return (
    <div>
      {/* Sandbox mode banner */}
      {isDemoMode && (
        <div
          className="flex items-center justify-between rounded-lg px-4 py-2.5 mb-4"
          style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)' }}
        >
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Sandbox mode - connected to Enable Banking sandbox
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => navigate('/settings')}
              className="text-xs cursor-pointer px-2 py-1 rounded"
              style={{ color: 'var(--primary)' }}
            >
              Switch to production
            </button>
            <button
              onClick={handleExitSandbox}
              className="text-xs cursor-pointer px-2 py-1 rounded"
              style={{ color: 'var(--danger)' }}
            >
              Exit sandbox
            </button>
          </div>
        </div>
      )}

      {/* Standard page header (shared PageHeader component - Dashboard was
          the last page hand-rolling its own and had started to drift).
          Sync controls live in the right-side slot. */}
      <PageHeader
        serif
        label="Overview"
        title="Financial overview"
        subtitle="Your balances and this month at a glance."
        right={
          showSyncPill ? (
            <>
              {/* Last-synced status pill - colored dot encodes freshness. */}
              <div
                className="flex items-center gap-2 px-3 h-[40px] rounded"
                style={{
                  backgroundColor: 'var(--surface-alt)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-1)',
                }}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{
                    backgroundColor: lastSyncError
                      ? 'var(--danger)'
                      : getSyncStatusColor(lastSyncedAt),
                  }}
                />
                <span
                  style={{
                    color: 'var(--text-secondary)',
                    fontSize: 'var(--fs-body-sm)',
                  }}
                >
                  {lastSyncedAt
                    ? `Synced ${formatRelativeTime(lastSyncedAt)}`
                    : 'Not yet synced'}
                </span>
              </div>
              <Button
                variant="ghost"
                onClick={() =>
                  startSync()
                    .then(load)
                    .then(() => refreshPendingReviewCount())
                    .catch(console.error)
                }
                disabled={isSyncing}
              >
                <RefreshCw size={16} className={isSyncing ? 'animate-spin' : ''} />
                {isSyncing ? 'Syncing...' : 'Sync'}
              </Button>
              {isBankDriven && (
                <Button
                  variant="ghost"
                  onClick={() =>
                    startFullResync()
                      .then(load)
                      .then(() => refreshPendingReviewCount())
                      .catch(console.error)
                  }
                  disabled={isSyncing}
                  title="Clear delta cursor and re-fetch the last 180 days of transactions for every linked account."
                >
                  <History size={16} />
                  Resync history
                </Button>
              )}
            </>
          ) : undefined
        }
      />

      {/* One-time orientation tip for bank-driven workspaces: the sync →
          Review → analysis pipeline is invisible until you know it exists. */}
      {isBankDriven && (
        <InfoBanner
          storageKey="koinkat.tip.dashboardReview"
          title="How new transactions arrive"
          className="mb-6"
        >
          Each sync pulls transactions from your bank into the{' '}
          <Link to="/review" style={{ color: 'var(--primary)' }}>
            Review
          </Link>{' '}
          inbox with a suggested category. Confirming them teaches Koinkat
          your categories - after a few sessions most arrive pre-sorted.
        </InfoBanner>
      )}

      {/* Sync-failure notice - the last bank sync threw. Without this the
          failure is invisible: the pill keeps showing the stale "Synced X
          ago" and balances silently stop updating. Dismissible; Retry
          re-runs the same sync. */}
      {lastSyncError && (
        <div
          className="flex items-start gap-3 rounded-lg px-4 py-3 mb-6"
          style={{
            backgroundColor:
              'color-mix(in srgb, var(--danger) 10%, var(--surface))',
            border:
              '1px solid color-mix(in srgb, var(--danger) 35%, var(--border))',
          }}
        >
          <AlertTriangle
            size={20}
            strokeWidth={1.75}
            style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 2 }}
          />
          <div className="flex-1 min-w-0">
            <p
              style={{
                color: 'var(--text)',
                fontSize: 'var(--fs-body)',
                fontWeight: 'var(--fw-medium)',
              }}
            >
              The last bank sync failed
            </p>
            <p
              className="break-words"
              style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-body-sm)' }}
            >
              {lastSyncError}
            </p>
          </div>
          <Button
            variant="ghost"
            onClick={() =>
              startSync()
                .then(load)
                .then(() => refreshPendingReviewCount())
                .catch(console.error)
            }
            disabled={isSyncing}
          >
            Retry
          </Button>
          <button
            onClick={clearSyncError}
            className="cursor-pointer p-1 rounded shrink-0"
            aria-label="Dismiss sync error"
            style={{ color: 'var(--text-muted)' }}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Expired-consent notice - PSD2 consent always lapses within 180
          days, syncing then silently stops for that bank. Every user hits
          this eventually; without the banner it reads as "the app stopped
          working". */}
      {connections.some((c) => c.status === 'expired') && (
        <div
          className="flex items-start gap-3 rounded-lg px-4 py-3 mb-6"
          style={{
            backgroundColor:
              'color-mix(in srgb, var(--warning) 12%, var(--surface))',
            border:
              '1px solid color-mix(in srgb, var(--warning) 35%, var(--border))',
          }}
        >
          <AlertTriangle
            size={20}
            strokeWidth={1.75}
            style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 2 }}
          />
          <p
            className="flex-1 min-w-0"
            style={{ color: 'var(--text)', fontSize: 'var(--fs-body-sm)' }}
          >
            Bank consent expired for{' '}
            {connections
              .filter((c) => c.status === 'expired')
              .map((c) => c.aspspName)
              .join(', ')}
            {' '}- syncing is paused for{' '}
            {connections.filter((c) => c.status === 'expired').length === 1
              ? 'that bank'
              : 'those banks'}
            . Reconnect to resume; your accounts and history are kept.
          </p>
          <Button variant="primary" onClick={() => navigate('/bank-link')}>
            Reconnect
          </Button>
        </div>
      )}

      {/* Sync-incomplete notice - the bank's PSD2 rate limit truncated the
          last sync, so some transactions on the busiest accounts may be
          missing. Resolves itself on the next sync; hammering re-sync makes
          it worse, so we say so. */}
      {syncIncomplete && (
        <div
          className="flex items-start gap-3 rounded-lg px-4 py-3 mb-6"
          style={{
            backgroundColor:
              'color-mix(in srgb, var(--warning) 12%, var(--surface))',
            border:
              '1px solid color-mix(in srgb, var(--warning) 35%, var(--border))',
          }}
        >
          <AlertTriangle
            size={20}
            strokeWidth={1.75}
            style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 2 }}
          />
          <p
            className="flex-1 min-w-0"
            style={{ color: 'var(--text)', fontSize: 'var(--fs-body-sm)' }}
          >
            {SYNC_INCOMPLETE_MSG}
          </p>
        </div>
      )}

      {/* Review queue notification - appears when the categorization
          engine has flagged bank-imported transactions that need user
          confirmation or correction. */}
      {pendingReviewCount > 0 && (
        <div
          className="flex items-center gap-3 rounded-lg px-4 py-3 mb-6"
          style={{
            backgroundColor:
              'color-mix(in srgb, var(--primary) 10%, var(--surface))',
            border:
              '1px solid color-mix(in srgb, var(--primary) 30%, var(--border))',
          }}
        >
          <ListChecks
            size={20}
            strokeWidth={1.75}
            style={{ color: 'var(--primary)' }}
          />
          <div className="flex-1 min-w-0">
            <p
              style={{
                color: 'var(--text)',
                fontSize: 'var(--fs-body)',
                fontWeight: 'var(--fw-medium)',
              }}
            >
              {pendingReviewCount} transaction
              {pendingReviewCount !== 1 ? 's' : ''} need your review
            </p>
            <p
              style={{
                color: 'var(--text-muted)',
                fontSize: 'var(--fs-body-sm)',
              }}
            >
              We categorized them automatically. Confirm or correct each one
              to train the system.
            </p>
          </div>
          <Button variant="primary" onClick={() => navigate('/review')}>
            Review now
          </Button>
        </div>
      )}

      {/* Open splits notification - appears when there are expense rows
          flagged as split_status='open'. Shows a per-currency breakdown
          of how much the user is still net out-of-pocket across them. */}
      {openSplits.count > 0 && (
        <div
          className="flex items-center gap-3 rounded-lg px-4 py-3 mb-6"
          style={{
            backgroundColor:
              'color-mix(in srgb, var(--primary) 8%, var(--surface))',
            border:
              '1px solid color-mix(in srgb, var(--primary) 20%, var(--border))',
          }}
        >
          <Users
            size={20}
            strokeWidth={1.75}
            style={{ color: 'var(--primary)' }}
          />
          <div className="flex-1 min-w-0">
            <p
              style={{
                color: 'var(--text)',
                fontSize: 'var(--fs-body)',
                fontWeight: 'var(--fw-medium)',
              }}
            >
              {openSplits.count} open split expense
              {openSplits.count !== 1 ? 's' : ''}
            </p>
            <p
              data-privacy-field
              style={{
                color: 'var(--text-muted)',
                fontSize: 'var(--fs-body-sm)',
              }}
            >
              Net out-of-pocket:{' '}
              {Object.entries(openSplits.uncoveredByCurrency)
                .map(
                  ([ccy, amt]) =>
                    `${formatAmount(amt, settings.decimalSeparator)} ${ccy}`,
                )
                .join(' · ')}
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={() => navigate('/transactions?splits=open')}
          >
            View
          </Button>
        </div>
      )}

      {/* FX-unavailable warning - shown when one or more account balances
          couldn't be converted to the preferred currency (empty/stale rate
          cache). Non-dismissible: it's a data-integrity warning, not a tip.
          The net-worth total excludes these accounts until rates load. */}
      {overview && overview.unconvertibleCurrencies.length > 0 && (
        <InfoBanner
          variant="warning"
          title="Exchange rates unavailable"
          className="mb-6"
        >
          <div className="flex items-start justify-between gap-3">
            <span>
              Balances in{' '}
              {overview.unconvertibleCurrencies
                .map((c) => c.toUpperCase())
                .join(', ')}{' '}
              can’t be converted to {overview.currency} right now, so they’re
              excluded from your net worth. Check your connection and refresh.
            </span>
            <Button
              variant="secondary"
              onClick={handleRefreshRates}
              disabled={refreshingRates}
            >
              {refreshingRates ? 'Refreshing…' : 'Refresh rates'}
            </Button>
          </div>
        </InfoBanner>
      )}

      {/* Hero row: Net Worth (left) + Distribution (right).
          Both cards get `h-full` so they share the grid row's height,
          and the Distribution card's inner content becomes a flex column
          so the pie chart fills the vertical space instead of leaving
          dead air at the bottom. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8 lg:items-stretch">
        {/* Net Worth Card */}
        <Card highlight className="h-full">
          <p
            className="uppercase mb-3"
            style={UPPERCASE_LABEL}
          >
            Net worth
          </p>
          {!overview || accounts.length === 0 ? (
            <div className="flex flex-col items-start gap-3">
              <span
                className="amount amount-lg"
                style={{ color: 'var(--text-muted)' }}
              >
                --
              </span>
              <p
                style={{
                  color: 'var(--text-muted)',
                  fontSize: 'var(--fs-body-sm)',
                }}
              >
                No accounts yet. Add one below to see your balance.
              </p>
            </div>
          ) : (
            <>
              <div data-privacy-field className="flex items-baseline">
                <span
                  className="amount amount-lg"
                  style={{ color: 'var(--text)' }}
                >
                  {formatAmount(overview.totalBalance, settings.decimalSeparator)}
                </span>
                <span className="currency-code">{overview.currency}</span>
              </div>
              <p
                className="mt-1"
                style={{
                  color: 'var(--text-secondary)',
                  fontSize: 'var(--fs-body-sm)',
                }}
              >
                Across {accounts.length} account{accounts.length !== 1 ? 's' : ''}
                {overview.unconvertibleCurrencies.length > 0 &&
                  (() => {
                    const excluded = overview.entries.filter(
                      (e) => e.conversionFailed,
                    ).length;
                    return ` (${excluded} excluded - rates unavailable)`;
                  })()}
                {pendingCount > 0 &&
                  ` · includes ${pendingCount} pending`}
              </p>

              {/* Per-account breakdown */}
              <ul
                className="mt-5 flex flex-col gap-3 pt-5"
                style={{ borderTop: '1px solid var(--border)' }}
                data-privacy-field
              >
                {overview.entries.map((entry) => (
                  <li
                    key={entry.accountId}
                    className="flex items-center gap-3 min-w-0"
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: entry.color }}
                    />
                    <span
                      className="truncate min-w-0 flex-1"
                      style={{
                        color: 'var(--text)',
                        fontSize: 'var(--fs-body)',
                      }}
                    >
                      {entry.name}
                    </span>
                    <span
                      className="amount amount-md shrink-0 flex items-baseline"
                      style={{ color: 'var(--text)' }}
                    >
                      <span>
                        {formatAmount(entry.nativeAmount, settings.decimalSeparator)}
                      </span>
                      <span className="currency-code">{entry.nativeCurrency}</span>
                    </span>
                    {entry.isCrossCurrency &&
                      (entry.conversionFailed ? (
                        <span
                          className="shrink-0 italic"
                          style={{
                            color: 'var(--text-muted)',
                            fontSize: 'var(--fs-body-sm)',
                          }}
                          title={`No ${entry.convertedCurrency} exchange rate available`}
                        >
                          rate unavailable
                        </span>
                      ) : (
                        <>
                          <ArrowRight
                            size={12}
                            className="shrink-0"
                            style={{ color: 'var(--text-muted)' }}
                          />
                          <span
                            className="amount amount-sm shrink-0 flex items-baseline"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            <span>
                              {formatAmount(
                                entry.convertedAmount,
                                settings.decimalSeparator,
                              )}
                            </span>
                            <span className="currency-code">
                              {entry.convertedCurrency}
                            </span>
                          </span>
                        </>
                      ))}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>

        {/* Distribution Pie Chart - h-full + flex column so the chart
            area fills the remaining vertical space of the grid row. */}
        <Card className="h-full flex flex-col">
          <p
            className="uppercase mb-3"
            style={UPPERCASE_LABEL}
          >
            Account distribution
          </p>
          {!overview || overview.distribution.length === 0 ? (
            <p
              className="text-center flex-1 flex items-center justify-center"
              style={{
                color: 'var(--text-muted)',
                fontSize: 'var(--fs-body-sm)',
              }}
            >
              No positive balances to chart yet.
            </p>
          ) : (
            /* flex-1 so this row takes all remaining card height,
               min-h-0 so the child can shrink properly in the flex context. */
            <div className="flex items-center gap-5 flex-1 min-h-0">
              {/* Donut - aspect-square so width tracks height. Clamped to
                  [160, 260] so the pie is always legible but never dominates.
                  data-privacy-field: the tooltip exposes per-account amounts,
                  so privacy mode must blur the whole chart. */}
              <div
                className="relative shrink-0 aspect-square"
                data-privacy-field
                style={{
                  height: '100%',
                  minHeight: '160px',
                  maxHeight: '260px',
                  minWidth: '160px',
                  maxWidth: '260px',
                }}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={overview.distribution.map((d) => ({
                        ...d,
                        // display-boundary: geometry only - terminal coercion
                        // for Recharts, no arithmetic on the float.
                        value: parseFloat(d.amount),
                      }))}
                      dataKey="value"
                      nameKey="label"
                      cx="50%"
                      cy="50%"
                      /* Percentage radii so the donut scales with the
                         container. 50% inner / 90% outer preserves the
                         spec's ~55% inner-to-outer ratio. */
                      innerRadius="50%"
                      outerRadius="90%"
                      paddingAngle={2}
                      strokeWidth={0}
                    >
                      {overview.distribution.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: number) =>
                        formatMoney(
                          String(value),
                          overview.currency,
                          settings.decimalSeparator,
                        )
                      }
                      {...chartTooltipStyle}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              {/* Legend - vertically centered inside its own column so it
                  sits opposite the donut regardless of row height. */}
              <div className="flex-1 flex flex-col justify-center gap-2.5 min-w-0">
                {overview.distribution.map((entry, i) => (
                  <div key={i} className="flex items-center gap-2 min-w-0">
                    <div
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: entry.dotColor }}
                    />
                    <span
                      className="truncate"
                      style={{
                        color: 'var(--text)',
                        fontSize: 'var(--fs-body-sm)',
                      }}
                    >
                      {entry.label}
                    </span>
                    <span
                      className="ml-auto shrink-0 amount"
                      style={{
                        color: 'var(--text-muted)',
                        fontSize: 'var(--fs-rate)',
                      }}
                    >
                      {entry.percentage.toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* "This month" pulse - answers the question the user actually opens
          the app with ("how am I doing this month?"): spent so far, trend
          vs last month, budget pace, top categories. */}
      {accounts.length > 0 && (
        <MonthPulseCard
          preferredCurrency={settings.preferredCurrency}
          decimalSeparator={settings.decimalSeparator}
        />
      )}

      {/* Accounts Section - action buttons live here (context-specific).
          Sync controls live in the page header, not here. */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
        <h2
          className="text-lg font-semibold"
          style={{ color: 'var(--text)', fontFamily: 'var(--font-head)' }}
        >
          Your accounts
        </h2>
        <div className="flex gap-2 flex-wrap">
          {isBankDriven ? (
            /* Bank-driven: the only write action here is "link another bank".
               Sync/resync already live in the page header above. */
            <Link to="/bank-link">
              <Button variant="primary">
                <Plus size={16} />
                Add account
              </Button>
            </Link>
          ) : (
            /* Manual workspace: full write-action palette. */
            <>
              <Link to="/transactions/create">
                <Button variant="primary">
                  <Plus size={16} />
                  Transaction
                </Button>
              </Link>
              <Link to="/transactions/transfer">
                <Button variant="secondary">
                  <ArrowLeftRight size={16} />
                  Transfer
                </Button>
              </Link>
              {isConfigured && (
                <Link to="/bank-link">
                  <Button variant="secondary">
                    <Building2 size={16} />
                    Link Bank
                  </Button>
                </Link>
              )}
              <Link to="/accounts/create">
                <Button variant="secondary">
                  <Plus size={16} />
                  Account
                </Button>
              </Link>
            </>
          )}
        </div>
      </div>

      {accounts.length === 0 ? (
        <Card>
          <div className="text-center py-10 flex flex-col items-center gap-3">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center"
              style={{
                backgroundColor: 'var(--surface-alt)',
                border: '1px solid var(--border)',
              }}
            >
              <Plus size={20} style={{ color: 'var(--text-secondary)' }} />
            </div>
            <p
              style={{
                color: 'var(--text-secondary)',
                fontSize: 'var(--fs-body-sm)',
              }}
            >
              No accounts yet. Create your first account to get started.
            </p>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {accounts.map((account) => {
            const stripeColor = account.isPinned
              ? 'var(--accent)'
              : account.color || 'var(--border-strong)';
            return (
              <div
                key={account.id}
                className="relative overflow-hidden group"
                style={{
                  backgroundColor: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-2)',
                  boxShadow: 'var(--elev-1)',
                  transitionProperty: 'transform, box-shadow',
                  transitionDuration: 'var(--dur-std)',
                  transitionTimingFunction: 'var(--ease-standard)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.boxShadow = 'var(--elev-2)';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow = 'var(--elev-1)';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                {/* 4px LEFT border stripe - card identity lives here.
                    Uses --accent for pinned accounts, account color otherwise. */}
                <div
                  className="absolute top-0 left-0 bottom-0"
                  style={{ width: '4px', backgroundColor: stripeColor }}
                />

                <div
                  style={{
                    paddingLeft: 'var(--space-6)',
                    paddingRight: 'var(--space-5)',
                    paddingTop: 'var(--space-5)',
                    paddingBottom: 'var(--space-5)',
                  }}
                >
                  {/* Top row: account name + pin button */}
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <h3
                      className="truncate min-w-0"
                      style={{
                        color: 'var(--text-secondary)',
                        fontSize: 'var(--fs-body-sm)',
                        fontWeight: 'var(--fw-medium)',
                      }}
                    >
                      {account.name}
                    </h3>
                    <button
                      onClick={() => handlePin(account)}
                      className="p-1 -m-1 rounded transition-colors hover:opacity-80 cursor-pointer shrink-0"
                      style={{
                        color: account.isPinned
                          ? 'var(--accent)'
                          : 'var(--text-muted)',
                      }}
                      title={account.isPinned ? 'Unpin' : 'Pin'}
                      aria-label={
                        account.isPinned ? 'Unpin account' : 'Pin account'
                      }
                    >
                      <Star
                        size={15}
                        fill={account.isPinned ? 'var(--accent)' : 'none'}
                      />
                    </button>
                  </div>

                  {/* Balance - uses the .amount scale. Mono font, tabular nums,
                      tight mono letter-spacing for dense numeric readability. */}
                  <div
                    className="mb-4 flex items-baseline"
                    data-privacy-field
                  >
                    <span
                      className="amount amount-md"
                      style={{ color: 'var(--text)' }}
                    >
                      {formatAmount(
                        account.currentBalance,
                        settings.decimalSeparator,
                      )}
                    </span>
                    <span className="currency-code">{account.currency}</span>
                  </div>

                  {/* Actions - ghost buttons, destructive pushed right. */}
                  <div
                    className="flex items-center gap-1 pt-3"
                    style={{ borderTop: '1px solid var(--border)' }}
                  >
                    <Link to={`/transactions?account=${account.id}`}>
                      <button
                        className="flex items-center gap-1.5 px-2 py-1.5 rounded transition-colors cursor-pointer hover:opacity-80"
                        style={{
                          color: 'var(--text-secondary)',
                          fontSize: 'var(--fs-body-sm)',
                        }}
                      >
                        <List size={14} /> Transactions
                      </button>
                    </Link>
                    <Link to={`/accounts/${account.id}/edit`}>
                      <button
                        className="flex items-center gap-1.5 px-2 py-1.5 rounded transition-colors cursor-pointer hover:opacity-80"
                        style={{
                          color: 'var(--text-secondary)',
                          fontSize: 'var(--fs-body-sm)',
                        }}
                      >
                        <Pencil size={14} /> Edit
                      </button>
                    </Link>
                    <button
                      onClick={() => setDeleteTarget(account)}
                      className="flex items-center gap-1.5 px-2 py-1.5 rounded transition-colors cursor-pointer hover:opacity-80 ml-auto"
                      style={{
                        color: 'var(--danger)',
                        fontSize: 'var(--fs-body-sm)',
                      }}
                    >
                      <Trash2 size={14} /> Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <Modal
        open={deleteTarget !== null}
        onClose={() => { setDeleteTarget(null); setDeleteError(null); }}
        title="Delete account?"
      >
        <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
          Are you sure you want to delete <strong style={{ color: 'var(--text)' }}>{deleteTarget?.name}</strong>?
          All transactions in this account will be permanently deleted -
          including transfers to or from other accounts, whose balances will
          be adjusted accordingly. This cannot be undone.
        </p>
        {deleteError && (
          <p className="text-sm mb-4" style={{ color: 'var(--danger)' }}>
            {deleteError}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <Button
            variant="ghost"
            onClick={() => { setDeleteTarget(null); setDeleteError(null); }}
          >
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDelete} disabled={deletingAccount}>
            {deletingAccount ? 'Deleting...' : 'Delete'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Short relative-time formatter for the "synced X ago" pill. Intentionally
 * coarse - we don't want second-by-second re-renders on the header.
 */
function formatRelativeTime(iso: string | null): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

/**
 * Sync freshness → semantic color. PSD2 rate limits cap syncing at ~4
 * requests per account per day, so "hours old" is the NORMAL state - an
 * amber dot after one hour read as a permanent low-grade warning. Tiers:
 *   <24h → success (as fresh as the pipeline gets)
 *   <72h → warning (worth a manual sync)
 *   ≥72h or never → muted (stale / unknown)
 */
function getSyncStatusColor(iso: string | null): string {
  if (!iso) return 'var(--text-muted)';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'var(--text-muted)';
  const diff = Date.now() - then;
  if (diff < 86_400_000) return 'var(--success)';
  if (diff < 259_200_000) return 'var(--warning)';
  return 'var(--text-muted)';
}

// ── "This month" pulse card ───────────────────────────────────────────────

const pulseLabelStyles = UPPERCASE_LABEL;

/**
 * Current-month spending snapshot: total spent, last month as a reference,
 * budget pace (when a budget covers this month), and the top categories.
 * All amounts stay Big-backed decimal strings; floats appear only as CSS
 * width geometry.
 */
function MonthPulseCard({
  preferredCurrency,
  decimalSeparator,
}: {
  preferredCurrency: string;
  decimalSeparator: string;
}) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const [rows, setRows] = useState<CategoryBreakdownRow[]>([]);
  const [total, setTotal] = useState<string>('0.00');
  const [prevTotal, setPrevTotal] = useState<string | null>(null);
  const [budgetMonth, setBudgetMonth] = useState<{
    summary: PeriodSpendingSummary;
    currency: string;
  } | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const prev = previousMonth(year, month);
    (async () => {
      const [current, previous, budget] = await Promise.all([
        categoryBreakdown({
          year,
          month,
          type: 'expense',
          preferredCurrency,
        }).catch(() => null),
        categoryBreakdown({
          year: prev.year,
          month: prev.month,
          type: 'expense',
          preferredCurrency,
        }).catch(() => null),
        // Single-period summary - the card shows one month, so computing
        // the full year via getYearlyBudgetData was 12x the needed work.
        budgetService.getBudgetPeriodForMonth(year, month).catch(() => null),
      ]);
      if (cancelled) return;
      if (current) {
        setRows(current.rows);
        setTotal(current.total);
      }
      setPrevTotal(previous ? previous.total : null);
      setBudgetMonth(budget);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [year, month, preferredCurrency]);

  if (!loaded) return null;

  const monthName = MONTH_NAMES[month - 1];
  const prevMonthName = MONTH_NAMES[(month + 10) % 12];
  // A mid-month total against a FULL previous month is only comparable in
  // one direction - flag when we're already past last month's total, and
  // otherwise show last month as a neutral reference figure.
  const overLastMonth =
    prevTotal !== null && dec(prevTotal).gt(0) && dec(total).gt(dec(prevTotal));
  const topRows = rows.slice(0, 3);

  // Budget pace (only when a budget covers the current month). Shared
  // helper keeps this math identical to the Budgets focused-month card.
  const pace = monthPace(budgetMonth?.summary.remaining ?? '0', now);
  const clampedBudgetPct = budgetMonth
    ? Math.min(budgetMonth.summary.percentUsed, 100)
    : 0;

  return (
    <Card className="mb-8">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <p className="uppercase" style={pulseLabelStyles}>
          This month · {monthName}
        </p>
        <div className="flex items-center gap-4">
          <Link
            to={`/analysis?year=${year}&month=${month}&type=expense`}
            className="inline-flex items-center gap-1 hover:underline"
            style={{ color: 'var(--primary)', fontSize: 'var(--fs-body-sm)' }}
          >
            Full analysis <ArrowRight size={13} />
          </Link>
          <Link
            to="/budgets"
            className="inline-flex items-center gap-1 hover:underline"
            style={{ color: 'var(--primary)', fontSize: 'var(--fs-body-sm)' }}
          >
            Budget <ArrowRight size={13} />
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Spent so far + last-month reference */}
        <div>
          <p className="uppercase mb-2" style={pulseLabelStyles}>
            Spent so far
          </p>
          <div className="flex items-baseline" data-privacy-field>
            <span className="amount amount-lg" style={{ color: 'var(--expense)' }}>
              {formatAmount(total, decimalSeparator)}
            </span>
            <span className="currency-code">{preferredCurrency}</span>
          </div>
          {prevTotal !== null && dec(prevTotal).gt(0) && (
            <p
              className="mt-1 flex items-center gap-1.5"
              style={{
                color: overLastMonth ? 'var(--expense)' : 'var(--text-muted)',
                fontSize: 'var(--fs-body-sm)',
              }}
            >
              {overLastMonth ? (
                <>
                  <TrendingUp size={14} />
                  Already above {prevMonthName}'s total (
                  <span data-privacy-field>
                    {formatAmount(prevTotal, decimalSeparator)} {preferredCurrency}
                  </span>
                  )
                </>
              ) : (
                <>
                  <TrendingDown size={14} />
                  {prevMonthName} total:{' '}
                  <span data-privacy-field>
                    {formatAmount(prevTotal, decimalSeparator)} {preferredCurrency}
                  </span>
                </>
              )}
            </p>
          )}
        </div>

        {/* Budget pace */}
        <div>
          <p className="uppercase mb-2" style={pulseLabelStyles}>
            Budget
          </p>
          {budgetMonth ? (
            <>
              <div
                className="flex items-baseline justify-between mb-1.5"
                style={{ fontSize: 'var(--fs-body-sm)' }}
              >
                <span className="amount" data-privacy-field style={{ color: 'var(--text)' }}>
                  {formatAmount(budgetMonth.summary.totalSpent, decimalSeparator)} /{' '}
                  {formatAmount(budgetMonth.summary.effectiveLimit, decimalSeparator)}{' '}
                  <span className="currency-code">{budgetMonth.currency}</span>
                </span>
                <span
                  style={{
                    color: getPercentageColor(budgetMonth.summary.percentUsed),
                    fontWeight: 'var(--fw-medium)',
                  }}
                >
                  {budgetMonth.summary.percentUsed.toFixed(0)}%
                </span>
              </div>
              {/* Progress bar with a "today" tick: spent-vs-time in one glance. */}
              <div
                className="h-2 rounded-full overflow-hidden relative mb-1.5"
                style={{ backgroundColor: 'var(--surface-alt)' }}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${clampedBudgetPct}%`,
                    backgroundColor: getPercentageColor(budgetMonth.summary.percentUsed),
                  }}
                />
                <div
                  className="absolute top-0 bottom-0"
                  title={`Today - ${pace.monthElapsedPct.toFixed(0)}% of the month gone`}
                  style={{
                    left: `${pace.monthElapsedPct}%`,
                    width: 2,
                    backgroundColor: 'var(--text)',
                    opacity: 0.5,
                  }}
                />
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-body-sm)' }}>
                {pace.safePerDay ? (
                  <>
                    Safe to spend{' '}
                    <strong data-privacy-field style={{ color: 'var(--text)' }}>
                      {formatAmount(pace.safePerDay, decimalSeparator)} {budgetMonth.currency}
                    </strong>{' '}
                    per day until month end.
                  </>
                ) : (
                  <span style={{ color: 'var(--danger)' }}>
                    Over budget for {monthName}.
                  </span>
                )}
              </p>
            </>
          ) : (
            <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-body-sm)' }}>
              No budget covers {monthName}.{' '}
              <Link
                to="/budgets"
                className="hover:underline"
                style={{ color: 'var(--primary)' }}
              >
                Set a monthly limit
              </Link>{' '}
              to see your pace here.
            </p>
          )}
        </div>

        {/* Top categories */}
        <div>
          <p className="uppercase mb-2" style={pulseLabelStyles}>
            Top categories
          </p>
          {topRows.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-body-sm)' }}>
              Nothing spent yet this month.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {topRows.map((row, i) => (
                <div key={row.macroId ?? '__uncat__'} className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: `var(--viz-${(i % 8) + 1})` }}
                  />
                  <span
                    className="truncate flex-1"
                    style={{ color: 'var(--text)', fontSize: 'var(--fs-body-sm)' }}
                  >
                    {row.macroName}
                  </span>
                  <span
                    className="amount amount-sm shrink-0"
                    data-privacy-field
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {formatAmount(row.amount, decimalSeparator)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
