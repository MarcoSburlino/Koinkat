import { create } from 'zustand';
import type { User } from '../types/models';
import {
  listUsers,
  getUserById,
  deleteUser as deleteUserSvc,
} from '../services/user-service';
import {
  getActiveUserId,
  setActiveUserId,
  clearActiveUserId,
} from '../lib/active-user';
import { clearActiveKoinkatAccountId } from '../lib/active-koinkat-account';

interface UserState {
  users: User[];
  activeUser: User | null;
  loaded: boolean;

  loadUsers: () => Promise<void>;
  loadActiveUser: () => Promise<void>;
  setActive: (id: string) => Promise<void>;
  /**
   * Full user logout - clears both the active user AND the active koinkat
   * account, returning the app to the user-login screen.
   */
  logout: () => void;
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

  loadActiveUser: async () => {
    const id = getActiveUserId();
    if (!id) {
      set({ activeUser: null });
      return;
    }
    const user = await getUserById(id);
    if (!user) {
      clearActiveUserId();
      clearActiveKoinkatAccountId();
      set({ activeUser: null });
      return;
    }
    set({ activeUser: user });
  },

  setActive: async (id: string) => {
    setActiveUserId(id);
    // Switching users always forces a fresh account selection.
    clearActiveKoinkatAccountId();
    await get().loadActiveUser();
  },

  logout: () => {
    clearActiveUserId();
    clearActiveKoinkatAccountId();
    set({ activeUser: null });
  },

  deleteUser: async (id: string) => {
    await deleteUserSvc(id);
    if (get().activeUser?.id === id) {
      clearActiveUserId();
      clearActiveKoinkatAccountId();
      set({ activeUser: null });
    }
    await get().loadUsers();
  },
}));
