import { create } from 'zustand';
import { getDb } from '../db/database';
import { loadApiConfig } from '../services/api-config-service';
import { requireActiveKoinkatAccountId } from '../lib/active-koinkat-account';
import {
  syncAll,
  resyncFullHistory,
  resyncFullHistoryOverride,
  pullOlderHistory,
} from '../services/bank-sync-service';
import { ensureTodayRates } from '../services/exchange-rate-service';
import type { BankConnection, BankConnectionRow } from '../types/models';
import { toBankConnection } from '../types/models';

/**
 * Shown when today's FX rates could not be fetched. Cross-currency
 * balances will be excluded from totals until rates are available, so this
 * is surfaced (distinct from `lastSyncError`, which is bank-specific).
 */
export const FX_UNAVAILABLE_MSG =
  'Exchange rates are currently unavailable, so balances in other currencies can’t be converted.';

/**
 * Shown when a sync was cut short by the bank's PSD2 rate limit (~4
 * requests/account/day), so some transactions on the busiest accounts were
 * not fetched. The next sync resumes from the same window, so the fix is
 * simply to wait and let it sync again later.
 */
export const SYNC_INCOMPLETE_MSG =
  'Sync was interrupted by your bank’s rate limit, so some transactions may be missing. They’ll arrive on the next sync - avoid repeated manual re-syncs, which use up the daily limit faster.';

interface BankState {
  connections: BankConnection[];
  isConfigured: boolean;
  isDemoMode: boolean;
  isSyncing: boolean;
  lastSyncError: string | null;
  /** Non-null when the last FX-rate fetch failed. See FX_UNAVAILABLE_MSG. */
  lastFxError: string | null;
  /** True when the last sync was truncated by the bank rate limit. */
  syncIncomplete: boolean;

  loadConfig: () => Promise<void>;
  loadConnections: () => Promise<void>;
  startSync: () => Promise<void>;
  /**
   * Clear `last_synced_at` on every linked account in the current workspace
   * and run a full re-fetch. Respects each linked account's stored
   * `sync_start_date` as the floor (use `startFullResyncOverride` to
   * bypass the floor).
   */
  startFullResync: () => Promise<void>;
  /**
   * Full-history override: ignores the stored `sync_start_date` and
   * reaches back to the 180-day API maximum. Destructive for the
   * Review queue - only call after an explicit user confirmation.
   */
  startFullResyncOverride: () => Promise<void>;
  /**
   * Lower the floor on a single bank connection and re-import from there.
   * Used by the "Pull older history" action in Settings.
   */
  startPullOlderHistory: (
    bankConnectionId: string,
    newFloor: string,
  ) => Promise<{ imported: number; skipped: number; incomplete: boolean }>;
  setSyncing: (syncing: boolean) => void;
  /** Set/clear the FX-rate availability error (e.g. after a manual refresh). */
  setFxError: (msg: string | null) => void;
  /** Dismiss the last sync error (banner close button). */
  clearSyncError: () => void;
}

export const useBankStore = create<BankState>((set, get) => {
  /**
   * Shared wrapper for the four sync actions, which were previously
   * byte-identical save for the inner call and return type. Guards against
   * concurrent/unconfigured runs, refreshes FX rates (surfacing failure via
   * `lastFxError` WITHOUT aborting the bank sync), runs `work`, reloads
   * connections, and funnels any error into `lastSyncError`. Returns `work`'s
   * result, or `fallback` when the guard trips or `work` throws.
   */
  async function runFxSync<T>(work: () => Promise<T>, fallback: T): Promise<T> {
    const state = get();
    if (state.isSyncing || !state.isConfigured) return fallback;
    set({ isSyncing: true, lastSyncError: null, syncIncomplete: false });
    try {
      // Refresh FX rates too - the dashboard converts cross-currency
      // balances at display time using the cached rates, so a sync should
      // also recover from a stale/missing rate cache. An FX failure must
      // NOT abort the bank sync, so it only sets lastFxError.
      const fxOk = await ensureTodayRates();
      set({ lastFxError: fxOk ? null : FX_UNAVAILABLE_MSG });
      const result = await work();
      return result;
    } catch (err) {
      set({ lastSyncError: err instanceof Error ? err.message : String(err) });
      return fallback;
    } finally {
      // Refresh connections even when the sync threw: status changes that
      // happened before the failure (e.g. a connection flipped to expired)
      // must reach the UI.
      await get().loadConnections().catch(() => {});
      set({ isSyncing: false });
    }
  }

  return {
    connections: [],
    isConfigured: false,
    isDemoMode: false,
    isSyncing: false,
    lastSyncError: null,
    lastFxError: null,
    syncIncomplete: false,

    loadConfig: async () => {
      const config = await loadApiConfig();
      set({
        isConfigured: config.isConfigured,
        isDemoMode: config.isDemoMode,
      });
    },

    loadConnections: async () => {
      let koinkatAccountId: string;
      try {
        koinkatAccountId = requireActiveKoinkatAccountId();
      } catch {
        set({ connections: [] });
        return;
      }
      const db = await getDb();
      const rows = await db.select<BankConnectionRow[]>(
        'SELECT * FROM bank_connections WHERE koinkat_account_id = ? ORDER BY created_at DESC',
        [koinkatAccountId],
      );
      set({ connections: rows.map(toBankConnection) });
    },

    startSync: () =>
      runFxSync<void>(async () => {
        const { incomplete } = await syncAll();
        set({ syncIncomplete: incomplete });
      }, undefined),

    startFullResync: () =>
      runFxSync<void>(async () => {
        const { incomplete } = await resyncFullHistory();
        set({ syncIncomplete: incomplete });
      }, undefined),

    startFullResyncOverride: () =>
      runFxSync<void>(async () => {
        const { incomplete } = await resyncFullHistoryOverride();
        set({ syncIncomplete: incomplete });
      }, undefined),

    startPullOlderHistory: (bankConnectionId, newFloor) =>
      runFxSync(async () => {
        const result = await pullOlderHistory(bankConnectionId, newFloor);
        set({ syncIncomplete: result.incomplete });
        return result;
      }, {
        imported: 0,
        skipped: 0,
        incomplete: false,
      }),

    setSyncing: (syncing) => set({ isSyncing: syncing }),

    setFxError: (msg) => set({ lastFxError: msg }),

    clearSyncError: () => set({ lastSyncError: null }),
  };
});
