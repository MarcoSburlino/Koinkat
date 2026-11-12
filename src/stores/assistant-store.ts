import { create } from 'zustand';
import * as assistantService from '../services/assistant-service';
import { detectEnvironment, type AssistantEnvironment } from '../assistant/environment';
import type { AssistantSettings } from '../types/models';

/**
 * Assistant settings for the active workspace plus what was found on this
 * computer. Loaded by the Sidebar on workspace change (it decides whether
 * the Assistant link shows) and refreshed by Settings after a change.
 */
interface AssistantState {
  /** null until loaded for the active workspace. */
  settings: AssistantSettings | null;
  /** Which workspace `settings` belongs to. */
  workspaceId: string | null;
  env: AssistantEnvironment | null;
  detecting: boolean;
  load: (workspaceId: string) => Promise<void>;
  save: (changes: Partial<AssistantSettings>) => Promise<AssistantSettings>;
  detect: (refresh?: boolean) => Promise<AssistantEnvironment>;
}

export const useAssistantStore = create<AssistantState>((set, get) => ({
  settings: null,
  workspaceId: null,
  env: null,
  detecting: false,

  load: async (workspaceId) => {
    set({ workspaceId, settings: null });
    try {
      const settings = await assistantService.getAssistantSettings();
      // Ignore a stale answer after a quick workspace switch.
      if (get().workspaceId === workspaceId) set({ settings });
    } catch (err) {
      console.error('[assistant] could not load settings:', err);
      if (get().workspaceId === workspaceId) set({ settings: { ...assistantService.DEFAULT_ASSISTANT_SETTINGS } });
    }
  },

  save: async (changes) => {
    const settings = await assistantService.saveAssistantSettings(changes);
    set({ settings });
    return settings;
  },

  detect: async (refresh = false) => {
    set({ detecting: true });
    try {
      const env = await detectEnvironment(refresh);
      set({ env });
      return env;
    } finally {
      set({ detecting: false });
    }
  },
}));
