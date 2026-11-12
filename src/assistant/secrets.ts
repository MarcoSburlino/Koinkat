import { invoke } from '@tauri-apps/api/core';

/**
 * API key for a local OpenAI-compatible endpoint (only some need one).
 * Lives in the OS credential store via the existing secret_* commands,
 * never in the database or a backup.
 */
const secretAccount = (workspaceId: string) => `assistant-local-${workspaceId}`;

export async function getLocalApiKey(workspaceId: string): Promise<string | null> {
  try {
    return await invoke<string | null>('secret_get', { account: secretAccount(workspaceId) });
  } catch {
    return null;
  }
}

export async function setLocalApiKey(workspaceId: string, key: string | null): Promise<void> {
  if (key && key.trim()) {
    await invoke('secret_set', { account: secretAccount(workspaceId), value: key.trim() });
  } else {
    await invoke('secret_delete', { account: secretAccount(workspaceId) });
  }
}

/** Best-effort cleanup when a workspace is deleted. */
export async function deleteLocalApiKey(workspaceId: string): Promise<void> {
  try {
    await invoke('secret_delete', { account: secretAccount(workspaceId) });
  } catch {
    // No keychain in tests / nothing stored: nothing to clean.
  }
}
