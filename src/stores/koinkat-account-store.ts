import { create } from 'zustand';
import type { KoinkatAccount } from '../types/models';
import {
  listKoinkatAccounts,
  getKoinkatAccountById,
  deleteKoinkatAccount as deleteKoinkatAccountSvc,
  ensureKoinkatAccountSeeded,
} from '../services/koinkat-account-service';
import {
  getActiveKoinkatAccountId,
  setActiveKoinkatAccountId,
  clearActiveKoinkatAccountId,
} from '../lib/active-koinkat-account';

interface KoinkatAccountState {
  accounts: KoinkatAccount[];
  activeKoinkatAccount: KoinkatAccount | null;
  loaded: boolean;

  /** Load the list of koinkat accounts that belong to the given user. */
  loadAccounts: (userId: string) => Promise<void>;
  /** Rehydrate the active koinkat account from localStorage. */
  loadActiveKoinkatAccount: () => Promise<void>;
  /** Enter a koinkat account (persists to localStorage). */
  setActive: (id: string) => Promise<void>;
  /**
   * Leave the current koinkat account (returns user to the account hub).
   * Does NOT log out the user.
   */
  exit: () => void;
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

  loadActiveKoinkatAccount: async () => {
    const id = getActiveKoinkatAccountId();
    if (!id) {
      set({ activeKoinkatAccount: null });
      return;
    }
    const account = await getKoinkatAccountById(id);
    if (!account) {
      // Stale id - clear it
      clearActiveKoinkatAccountId();
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
    setActiveKoinkatAccountId(id);
    await get().loadActiveKoinkatAccount();
  },

  exit: () => {
    clearActiveKoinkatAccountId();
    set({ activeKoinkatAccount: null });
  },

  deleteKoinkatAccount: async (id: string) => {
    await deleteKoinkatAccountSvc(id);
    if (get().activeKoinkatAccount?.id === id) {
      clearActiveKoinkatAccountId();
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
