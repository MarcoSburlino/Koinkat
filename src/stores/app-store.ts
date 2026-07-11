import { create } from 'zustand';
import type { Settings } from '../types/models';
import type { Theme, DecimalSeparator } from '../types/enums';
import { getPendingReviewCount } from '../services/categorization-service';

interface AppState {
  settings: Settings;
  initialized: boolean;
  /**
   * Count of transactions with `needs_review = 1` in the active
   * workspace. Displayed as a Sidebar badge and a Dashboard notification
   * card. Refreshed after every event that could change it (bank sync,
   * review queue actions, workspace switch).
   */
  pendingReviewCount: number;
  setSettings: (settings: Settings) => void;
  updateTheme: (theme: Theme) => void;
  updatePreferredCurrency: (currency: string) => void;
  updateDecimalSeparator: (sep: DecimalSeparator) => void;
  markInitialized: () => void;
  setPendingReviewCount: (n: number) => void;
  refreshPendingReviewCount: () => Promise<void>;
}

export const useAppStore = create<AppState>((set) => ({
  settings: {
    preferredCurrency: 'EUR',
    decimalSeparator: ',',
    theme: 'dark',
  },
  initialized: false,
  pendingReviewCount: 0,

  setSettings: (settings) => set({ settings }),

  updateTheme: (theme) =>
    set((state) => ({
      settings: { ...state.settings, theme },
    })),

  updatePreferredCurrency: (currency) =>
    set((state) => ({
      settings: { ...state.settings, preferredCurrency: currency },
    })),

  updateDecimalSeparator: (sep) =>
    set((state) => ({
      settings: { ...state.settings, decimalSeparator: sep },
    })),

  markInitialized: () => set({ initialized: true }),

  setPendingReviewCount: (n) => set({ pendingReviewCount: n }),

  refreshPendingReviewCount: async () => {
    try {
      const count = await getPendingReviewCount();
      set({ pendingReviewCount: count });
    } catch (err) {
      // Silent - the count is best-effort. If the query fails (e.g.
      // during a workspace switch with no active koinkat account yet),
      // leave the existing value alone.
      console.warn('[app-store] refreshPendingReviewCount failed:', err);
    }
  },
}));
