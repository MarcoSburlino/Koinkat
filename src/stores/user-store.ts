import { create } from 'zustand';
import type { User } from '../types/models';
import {
  listUsers,
  getUserById,
  deleteUser as deleteUserSvc,
} from '../services/user-service';
import {
  hydrateActiveUserId,
  setActiveUserId,
  clearActiveUserId,
} from '../lib/active-user';
import { clearActiveKoinkatAccountId } from '../lib/active-koinkat-account';
import { clearDeviceProvisioned } from '../lib/device-provisioned';
import { backupBeforeDelete } from '../services/backup-service';

interface UserState {
  users: User[];
  activeUser: User | null;
  loaded: boolean;

  loadUsers: () => Promise<void>;
  /**
   * Rehydrate the active user from `app_state`.
   *
   * `autoSelectSingle` is passed ONLY by bootstrap(): on a cold start with
   * exactly one user and no pointer, silently pick that user. It is
   * deliberately off elsewhere so an explicit "switch user" still forces a
   * real choice instead of snapping straight back to the only account.
   */
  loadActiveUser: (opts?: { autoSelectSingle?: boolean }) => Promise<void>;
  setActive: (id: string) => Promise<void>;
  /**
   * Full user logout - clears both the active user AND the active koinkat
   * account, returning the app to the user-login screen.
   */
  logout: () => Promise<void>;
  deleteUser: (id: string) => Promise<void>;
}

export const useUserStore = create<UserState>((set, get) => ({
  users: [],
  activeUser: null,
  loaded: false,

  loadUsers: async () => {
    const users = await listUsers();
    set({ users, loaded: true });
  },

  loadActiveUser: async (opts) => {
    const id = await hydrateActiveUserId();

    if (!id) {
      // Self-heal: a device with exactly one user has nothing to disambiguate.
      // Without this, losing the pointer dumped a single-user install at the
      // "Who's using Koinkat?" screen for no reason at all.
      const users = get().users;
      if (opts?.autoSelectSingle && users.length === 1) {
        await setActiveUserId(users[0].id);
        set({ activeUser: users[0] });
        return;
      }
      set({ activeUser: null });
      return;
    }

    const user = await getUserById(id);
    if (!user) {
      // Confirmed absent by a read that SUCCEEDED, so clearing is safe. A read
      // that throws propagates instead of landing here, which is the point: a
      // transient database failure must never silently discard the pointer.
      await clearActiveUserId();
      await clearActiveKoinkatAccountId();
      set({ activeUser: null });
      return;
    }
    set({ activeUser: user });
  },

  setActive: async (id: string) => {
    await setActiveUserId(id);
    // Switching users always forces a fresh account selection.
    await clearActiveKoinkatAccountId();
    await get().loadActiveUser();
  },

  logout: async () => {
    await clearActiveUserId();
    await clearActiveKoinkatAccountId();
    set({ activeUser: null });
  },

  deleteUser: async (id: string) => {
    const before = get().users;
    const wasOnlyUser = before.length === 1 && before[0].id === id;
    // Deleting a user is permanent and takes every workspace with it, so a
    // snapshot comes first. Best-effort: the user typed the name to confirm.
    await backupBeforeDelete();
    await deleteUserSvc(id);
    if (get().activeUser?.id === id) {
      await clearActiveUserId();
      await clearActiveKoinkatAccountId();
      set({ activeUser: null });
    }
    await get().loadUsers();
    // Deleting the last user is a deliberate reset of this device. Without
    // this the provisioned breadcrumb outlived it, and the next launch saw
    // "zero users on a device set up before" and locked on the boot-error
    // screen for good. Both conditions are required: the user list agreed
    // before the delete that this was the only user, and a read that
    // SUCCEEDED agrees after it that none remain.
    if (wasOnlyUser && get().users.length === 0) {
      // Through the pointers' owners, so their in-memory caches and app_state
      // rows are reset too - not only the localStorage copies the breadcrumb
      // counts as evidence.
      await clearActiveUserId();
      await clearActiveKoinkatAccountId();
      clearDeviceProvisioned();
    }
  },
}));
