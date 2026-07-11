import { invoke } from '@tauri-apps/api/core';
import { getDb, type DbExecutor } from '../db/database';
import type { ApiConfig, ApiConfigRow } from '../types/models';
import { toApiConfig, EMPTY_API_CONFIG } from '../types/models';
import type { BankEnvironment } from '../types/enums';
import { requireActiveKoinkatAccountId } from '../lib/active-koinkat-account';

/**
 * Where the Enable Banking private key lives.
 *
 * Preferred: the OS credential store (Windows Credential Manager, macOS
 * Keychain, Linux secret service) via the app's `secret_*` Tauri commands.
 * The DB column `private_key_pem` then holds only this sentinel, so the
 * SQLite file - and any raw-database export of it - no longer contains
 * the key.
 *
 * Fallback: if the credential store is unavailable (headless Linux, locked
 * keychain), the PEM stays in the DB column exactly as before. Saving must
 * never fail because of the keychain; `getPemStorage()` tells Settings
 * which mode is active so it can say so.
 */
const PEM_KEYCHAIN_SENTINEL = '__keychain__';

// Session cache of keychain-resolved PEMs, keyed by workspace id. The EB
// client rebuilds its JWT (and thus reloads the config) on every API
// request; without this the OS-keychain IPC would run once per request
// instead of once per workspace per app session. Invalidated on save,
// clear, and workspace deletion.
//
// Portability note: the sentinel means the key lives OUTSIDE the SQLite
// file. Copying/restoring the DB file onto another machine (raw-DB
// export) carries the sentinel but not the key - loadApiConfig then
// resolves null and the credential card asks for the .pem again.
const pemCache = new Map<string, string>();

function pemAccount(koinkatAccountId: string): string {
  return `eb-pem-${koinkatAccountId}`;
}

async function keychainSet(account: string, value: string): Promise<void> {
  await invoke('secret_set', { account, value });
}

async function keychainGet(account: string): Promise<string | null> {
  return await invoke<string | null>('secret_get', { account });
}

async function keychainDelete(account: string): Promise<void> {
  await invoke('secret_delete', { account });
}

/**
 * Load the API config for the currently active profile.
 * Returns an empty config if none exists.
 *
 * The returned `privateKeyPem` is always the REAL key (resolved from the
 * OS keychain when the row holds the sentinel) - callers never see the
 * sentinel. Legacy rows that still hold a plaintext PEM are migrated to
 * the keychain lazily on first read.
 */
export async function loadApiConfig(): Promise<ApiConfig> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const rows = await db.select<ApiConfigRow[]>(
    'SELECT * FROM api_configs WHERE koinkat_account_id = ?',
    [koinkatAccountId],
  );
  if (rows.length === 0) {
    return { ...EMPTY_API_CONFIG };
  }
  const config = toApiConfig(rows[0]);

  if (config.privateKeyPem === PEM_KEYCHAIN_SENTINEL) {
    // Key lives in the OS credential store. A missing entry (store wiped,
    // different OS user) surfaces as a null key - the credential card then
    // asks for the file again, same as a never-configured workspace.
    const cached = pemCache.get(koinkatAccountId);
    if (cached !== undefined) {
      config.privateKeyPem = cached;
    } else {
      try {
        config.privateKeyPem = await keychainGet(pemAccount(koinkatAccountId));
        if (config.privateKeyPem) {
          pemCache.set(koinkatAccountId, config.privateKeyPem);
        }
      } catch {
        config.privateKeyPem = null;
      }
    }
  } else if (config.privateKeyPem) {
    // Legacy plaintext row: move the key into the keychain and replace the
    // column with the sentinel. Best-effort - on failure the plaintext
    // stays put and we simply return it (database-storage fallback mode).
    try {
      await keychainSet(pemAccount(koinkatAccountId), config.privateKeyPem);
      await db.execute(
        `UPDATE api_configs SET private_key_pem = ?, updated_at = datetime('now')
          WHERE koinkat_account_id = ?`,
        [PEM_KEYCHAIN_SENTINEL, koinkatAccountId],
      );
      pemCache.set(koinkatAccountId, config.privateKeyPem);
    } catch {
      // Keychain unavailable - keep the plaintext column.
    }
  }
  return config;
}

/**
 * Save Enable Banking credentials for the active profile.
 * Creates the api_configs row if it doesn't exist yet.
 *
 * The private key goes to the OS credential store when possible; the DB
 * column then stores only the sentinel. If the store is unavailable the
 * key is stored in the DB column (never block saving on the keychain).
 */
export async function saveCredentials(params: {
  appId: string;
  privateKeyPem: string;
  environment: BankEnvironment;
  redirectUrl: string;
}): Promise<void> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const isSandbox = params.environment === 'sandbox' ? 1 : 0;

  // Service-level enforcement so the requirement can't drift apart across
  // the page validators: a configured workspace always has an https://
  // redirect (Enable Banking rejects anything else at auth time).
  if (!params.redirectUrl.trim().startsWith('https://')) {
    throw new Error(
      'Redirect URL must be the https:// callback URL registered on your Enable Banking application.',
    );
  }

  const db = await getDb();

  let pemColumnValue = params.privateKeyPem;
  try {
    await keychainSet(pemAccount(koinkatAccountId), params.privateKeyPem);
    pemColumnValue = PEM_KEYCHAIN_SENTINEL;
    pemCache.set(koinkatAccountId, params.privateKeyPem);
  } catch {
    // Credential store unavailable - fall back to DB storage.
    pemCache.delete(koinkatAccountId);
  }

  // Upsert for this profile
  await db.execute(
    `INSERT INTO api_configs
       (koinkat_account_id, app_id, private_key_pem, environment, redirect_url, is_configured, is_demo_mode)
     VALUES (?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT(koinkat_account_id) DO UPDATE SET
       app_id = excluded.app_id,
       private_key_pem = excluded.private_key_pem,
       environment = excluded.environment,
       redirect_url = excluded.redirect_url,
       is_configured = 1,
       is_demo_mode = excluded.is_demo_mode,
       updated_at = datetime('now')`,
    [koinkatAccountId, params.appId, pemColumnValue, params.environment, params.redirectUrl, isSandbox],
  );
}

export async function clearCredentials(exec?: DbExecutor): Promise<void> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = exec ?? (await getDb());
  pemCache.delete(koinkatAccountId);
  // Best-effort keychain cleanup; the UPDATE below is the source of truth.
  // Skipped when running inside a caller's transaction (exec set): an IPC
  // round-trip must not hold the serialize-queue transaction open. Those
  // callers invoke deletePemSecret() themselves after their commit.
  if (!exec) {
    try {
      await keychainDelete(pemAccount(koinkatAccountId));
    } catch {
      // Store unavailable - nothing to clean there anyway.
    }
  }
  await db.execute(
    `UPDATE api_configs
        SET app_id = NULL, private_key_pem = NULL,
            is_configured = 0, is_demo_mode = 0,
            updated_at = datetime('now')
      WHERE koinkat_account_id = ?`,
    [koinkatAccountId],
  );
}

/**
 * Where the active workspace's private key currently lives. Drives the
 * one-line notice on the Settings credential card and the raw-DB-export
 * warning copy.
 */
export async function getPemStorage(): Promise<'keychain' | 'database' | 'none'> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const rows = await db.select<{ private_key_pem: string | null }[]>(
    'SELECT private_key_pem FROM api_configs WHERE koinkat_account_id = ?',
    [koinkatAccountId],
  );
  const raw = rows[0]?.private_key_pem ?? null;
  if (!raw) return 'none';
  return raw === PEM_KEYCHAIN_SENTINEL ? 'keychain' : 'database';
}

/**
 * Best-effort keychain cleanup for a workspace that is being deleted.
 * Callable with an explicit id because the workspace may no longer be the
 * active one (or may already be gone from the DB) when teardown runs.
 */
export async function deletePemSecret(koinkatAccountId: string): Promise<void> {
  pemCache.delete(koinkatAccountId);
  try {
    await keychainDelete(pemAccount(koinkatAccountId));
  } catch {
    // Store unavailable - nothing stored there.
  }
}

/** Test-only: clears the session PEM cache between test cases. */
export function __resetPemCacheForTests(): void {
  pemCache.clear();
}
