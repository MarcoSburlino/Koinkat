// Active koinkat account - the workspace the user is currently inside.
// Every domain service scopes its queries on this id. "Leaving" a workspace
// from Settings clears this pointer but leaves the active user untouched,
// returning the user to the account hub where they can pick another workspace
// or create a new one.
//
// SOURCE OF TRUTH is the `app_state` table (migration v12), mirrored into
// localStorage. See the header of `active-user.ts` for why it moved out of
// localStorage alone.
//
// requireActiveKoinkatAccountId() MUST stay synchronous - roughly 150 service
// functions call it as their first statement. The one database read happens in
// hydrate(), which bootstrap() awaits before any of those run.

import {
  ACTIVE_KOINKAT_ACCOUNT_KEY,
  getAppState,
  setAppState,
  clearAppState,
} from '../services/app-state-service';
import { markDeviceProvisioned } from './device-provisioned';

const MIRROR_KEY = 'koinkat_active_koinkat_account_id';

let cached: string | null = null;
let hydrated = false;

function readMirror(): string | null {
  try {
    return localStorage.getItem(MIRROR_KEY);
  } catch {
    return null;
  }
}

function writeMirror(id: string): void {
  try {
    localStorage.setItem(MIRROR_KEY, id);
  } catch {
    /* ignore */
  }
}

function clearMirror(): void {
  try {
    localStorage.removeItem(MIRROR_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Resolve the active workspace id from the database, adopting a pre-v12
 * localStorage value when the table has nothing yet. Awaited by bootstrap()
 * before any workspace-scoped service call runs.
 */
export async function hydrateActiveKoinkatAccountId(): Promise<string | null> {
  let id = await getAppState(ACTIVE_KOINKAT_ACCOUNT_KEY);
  if (!id) {
    const legacy = readMirror();
    if (legacy) {
      id = legacy;
      await setAppState(ACTIVE_KOINKAT_ACCOUNT_KEY, legacy);
    }
  }
  cached = id;
  hydrated = true;
  if (id) {
    writeMirror(id);
    markDeviceProvisioned();
  }
  return id;
}

export function getActiveKoinkatAccountId(): string | null {
  if (!hydrated) return readMirror();
  return cached;
}

export async function setActiveKoinkatAccountId(id: string): Promise<void> {
  cached = id;
  hydrated = true;
  writeMirror(id);
  markDeviceProvisioned();
  await setAppState(ACTIVE_KOINKAT_ACCOUNT_KEY, id);
}

export async function clearActiveKoinkatAccountId(): Promise<void> {
  cached = null;
  hydrated = true;
  clearMirror();
  await clearAppState(ACTIVE_KOINKAT_ACCOUNT_KEY);
}

/**
 * Require an active koinkat account. Throws if the user has not entered a
 * workspace yet. Domain services call this to scope their SQL queries.
 */
export function requireActiveKoinkatAccountId(): string {
  const id = getActiveKoinkatAccountId();
  if (!id) {
    throw new Error(
      'No active koinkat account. Pick or create one from the account hub.',
    );
  }
  return id;
}
