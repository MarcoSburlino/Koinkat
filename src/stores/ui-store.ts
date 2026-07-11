import { create } from 'zustand';

function loadPrivacyMode(): boolean {
  try {
    return localStorage.getItem('koinkat_privacy_mode') === '1';
  } catch {
    return false;
  }
}

function savePrivacyMode(value: boolean) {
  try {
    localStorage.setItem('koinkat_privacy_mode', value ? '1' : '0');
  } catch { /* ignore */ }
}

interface UiState {
  sidebarOpen: boolean;
  privacyMode: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  togglePrivacy: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: true,
  privacyMode: loadPrivacyMode(),

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  togglePrivacy: () =>
    set((s) => {
      const next = !s.privacyMode;
      savePrivacyMode(next);
      return { privacyMode: next };
    }),
}));
