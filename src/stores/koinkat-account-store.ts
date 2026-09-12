import { create } from 'zustand';
import type { KoinkatAccount } from '../types/models';
import {
  listKoinkatAccounts,
  getKoinkatAccountById,
  deleteKoinkatAccount as deleteKoinkatAccountSvc,
  ensureKoinkatAccountSeeded,
} from '../services/koinkat-account-service';
import {
  hydrateActiveKoinkatAccountId,
  setActiveKoinkatAccountId,
  clearActiveKoinkatAccountId,
} from '../lib/active-koinkat-account';

interface KoinkatAccountState {
  accounts: KoinkatAccount[];
  activeKoinkatAccount: KoinkatAccount | null;
  loaded: boolean;

  /** Load the list of koinkat accounts that belong to the given user. */
  loadAccounts: (userId: string) => Promise<void>;
  /**
   * Rehydrate the active koinkat account from `app_state`.
   *
   * `autoSelectSingle` is passed ONLY by bootstrap(): on a cold start with
   * exactly one workspace and no pointer, enter it silently. Off elsewhere,
   * so "Leave this workspace" and "switch user" still land on the hub rather
   * than bouncing the user straight back in.
   */
  loadActiveKoinkatAccount: (opts?: {
    autoSelectSingle?: boolean;
  }) => Promise<void>;
  /** Enter a koinkat account (persists to `app_state`). */
  setActive: (id: string) => Promise<void>;
  /**
   * Leave the current koinkat account (returns user to the account hub).
   * Does NOT log out the user.
   */
  exit: () => Promise<void>;
  /** Permanently delete a koinkat account and all of its data. */
  deleteKoinkatAccount: (id: string) => Promise<void>;
  /** Reset to empty state - used when the active user logs out. */
  reset: () => void;
}

export const useKoinkatAccountStore = create<KoinkatAccountState>((set, get) => ({
  accounts: [],
  activeKoinkatAccount: null,
  loaded: false,

  loadAccounts: async (userId: string) => {
    const accounts = await listKoinkatAccounts(userId);
    set({ accounts, loaded: true });
  },

  loadActiveKoinkatAccount: async (opts) => {
    let id = await hydrateActiveKoinkatAccountId();

    if (!id) {
      // Self-heal: exactly one workspace means there is nothing to choose.
      const accounts = get().accounts;
      if (!opts?.autoSelectSingle || accounts.length !== 1) {
        set({ activeKoinkatAccount: null });
        return;
      }
      await setActiveKoinkatAccountId(accounts[0].id);
      id = accounts[0].id;
    }

    const account = await getKoinkatAccountById(id);
    if (!account) {
      // Confirmed absent by a read that SUCCEEDED, so the id really is stale.
      // A read that throws propagates instead of landing here - a transient
      // database failure must never silently discard the pointer.
      await clearActiveKoinkatAccountId();
      set({ activeKoinkatAccount: null });
      return;
    }

    // Ensure the workspace has its categories + MCC mappings seeded.
    // Idempotent - pre-v4 workspaces get seeded here the first time the
    // user re-enters them after migrating to v4.
    try {
      await ensureKoinkatAccountSeeded(account.id);
    } catch (err) {
      console.warn('[koinkat-store] failed to ensure seeds:', err);
    }
    set({ activeKoinkatAccount: account });
  },

  setActive: async (id: string) => {
    await setActiveKoinkatAccountId(id);
    await get().loadActiveKoinkatAccount();
  },

  exit: async () => {
    await clearActiveKoinkatAccountId();
    set({ activeKoinkatAccount: null });
  },

  deleteKoinkatAccount: async (id: string) => {
    await deleteKoinkatAccountSvc(id);
    if (get().activeKoinkatAccount?.id === id) {
      await clearActiveKoinkatAccountId();
      set({ activeKoinkatAccount: null });
    }
    // Reload the remaining accounts for whichever user still owns any.
    const remaining = get().accounts.filter((a) => a.id !== id);
    set({ accounts: remaining });
  },

  reset: () => {
    set({ accounts: [], activeKoinkatAccount: null, loaded: false });
  },
}));
