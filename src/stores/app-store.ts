import { create } from 'zustand';
import type { Settings } from '../types/models';
import type { Theme, DecimalSeparator } from '../types/enums';
import { getPendingReviewCount } from '../services/categorization-service';
import { getTransferSuggestionCount } from '../services/transfer-detection-service';

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
  /**
   * Number of suggested transfer pairs waiting on the Review page. Shown
   * next to `pendingReviewCount`: a queue with nothing to categorize can
   * still have transfers to confirm.
   */
  transferSuggestionCount: number;
  /**
   * Bumped whenever data changed underneath the open page - a bank sync
   * finished, a first bank import landed. Pages reload on it through
   * `useDataChanged`, so the screen is current without switching view.
   */
  dataVersion: number;
  setSettings: (settings: Settings) => void;
  updateTheme: (theme: Theme) => void;
  updatePreferredCurrency: (currency: string) => void;
  updateDecimalSeparator: (sep: DecimalSeparator) => void;
  markInitialized: () => void;
  setPendingReviewCount: (n: number) => void;
  /** Refreshes both the review count and the transfer suggestion count. */
  refreshPendingReviewCount: () => Promise<void>;
  /** Tell every open page that the data changed, and refresh the counts. */
  notifyDataChanged: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  settings: {
    preferredCurrency: 'EUR',
    decimalSeparator: ',',
    theme: 'dark',
  },
  initialized: false,
  pendingReviewCount: 0,
  transferSuggestionCount: 0,
  dataVersion: 0,

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
    try {
      const n = await getTransferSuggestionCount(get().settings.preferredCurrency);
      set({ transferSuggestionCount: n });
    } catch (err) {
      console.warn('[app-store] transfer suggestion count failed:', err);
    }
  },

  notifyDataChanged: () => {
    set((state) => ({ dataVersion: state.dataVersion + 1 }));
    void get().refreshPendingReviewCount();
  },
}));
