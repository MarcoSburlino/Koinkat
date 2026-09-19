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

/**
 * Error thrown when an operation's workspace changed while it was awaiting.
 * Distinct from a generic Error so callers (and the UI) can tell a
 * deliberate cancellation apart from a real failure.
 */
export class WorkspaceChangedError extends Error {
  constructor(
    readonly capturedId: string,
    readonly currentId: string | null,
  ) {
    super(
      'Workspace changed while the operation was in progress, so it was cancelled before writing anything.',
    );
    this.name = 'WorkspaceChangedError';
  }
}

/** A workspace id captured at the start of one operation. */
export interface WorkspaceContext {
  /** The workspace this operation belongs to, for the whole operation. */
  readonly id: string;
  /**
   * Throw if the active workspace has changed since capture.
   *
   * Call this immediately before a mutation. Operations await things that
   * take real time - an FX fetch can run for seconds - and the user can
   * switch workspace during that window. Re-reading the global at write
   * time would silently retarget the write into the NEW workspace while
   * the rows it was computed from belong to the old one. The rule is:
   * finish in the original workspace, or cancel before mutating. Never
   * retarget.
   */
  assertUnchanged(): void;
}

/**
 * Capture the active workspace for the duration of one operation.
 *
 * Use this at the entry point of any service function that awaits before it
 * writes, and pass `ctx.id` down to helpers and SQL predicates instead of
 * calling `requireActiveKoinkatAccountId()` again further in.
 */
export function captureWorkspace(): WorkspaceContext {
  const id = requireActiveKoinkatAccountId();
  return {
    id,
    assertUnchanged() {
      const now = getActiveKoinkatAccountId();
      if (now !== id) throw new WorkspaceChangedError(id, now);
    },
  };
}
