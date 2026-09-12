// Active user is "who is logged in".
//
// The user is the top of the hierarchy:
//   User -> KoinkatAccount -> Account -> Transaction
// Services that need workspace scoping use `active-koinkat-account.ts`
// instead - requireActiveKoinkatAccountId() is the one that gates domain
// queries. This file only answers "is someone logged in?"
//
// SOURCE OF TRUTH is the `app_state` table (migration v12), mirrored into
// localStorage. It used to be localStorage ALONE, which was the bug: the
// WebView2 profile under AppData\Local is disposable (Storage Sense, Disk
// Cleanup, a WebView2 reset) and origin-partitioned, so a dev build never saw
// what a production build wrote. Losing it made a fully-populated database
// look like a brand-new install.
//
// The getters stay SYNCHRONOUS because call sites all over the app depend on
// that. The one database read happens in hydrate(), which bootstrap() awaits
// before anything else runs.

import {
  ACTIVE_USER_KEY,
  getAppState,
  setAppState,
  clearAppState,
} from '../services/app-state-service';
import { markDeviceProvisioned } from './device-provisioned';

const MIRROR_KEY = 'koinkat_active_user_id';

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
 * Resolve the active user id from the database, adopting a pre-v12
 * localStorage value when the table has nothing yet. Awaited once by
 * bootstrap() before any call site reads the pointer.
 */
export async function hydrateActiveUserId(): Promise<string | null> {
  let id = await getAppState(ACTIVE_USER_KEY);
  if (!id) {
    // Pre-v12 install: the only copy lives in localStorage. Adopt it so
    // upgrading does not silently log the user out.
    const legacy = readMirror();
    if (legacy) {
      id = legacy;
      await setAppState(ACTIVE_USER_KEY, legacy);
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

export function getActiveUserId(): string | null {
  // Before hydration (or if it never ran) fall back to the mirror rather than
  // reporting "nobody is logged in". A wrong null here is exactly what used to
  // send a fully set-up device to the first-run screen.
  if (!hydrated) return readMirror();
  return cached;
}

export async function setActiveUserId(id: string): Promise<void> {
  cached = id;
  hydrated = true;
  writeMirror(id);
  markDeviceProvisioned();
  await setAppState(ACTIVE_USER_KEY, id);
}

export async function clearActiveUserId(): Promise<void> {
  cached = null;
  hydrated = true;
  clearMirror();
  await clearAppState(ACTIVE_USER_KEY);
}

/**
 * Require an active user. Throws if nobody is logged in.
 */
export function requireActiveUserId(): string {
  const id = getActiveUserId();
  if (!id) {
    throw new Error('No active user. Someone must log in or register first.');
  }
  return id;
}
