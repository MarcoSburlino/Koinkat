import { getDb } from '../db/database';

/**
 * Device-local key/value state: which user is logged in, and which workspace
 * they are inside. Backed by the `app_state` table added in migration v12.
 *
 * DELIBERATELY NOT WORKSPACE-SCOPED. Every other service in this directory
 * opens with `requireActiveKoinkatAccountId()`, but this is the table that
 * DETERMINES the active workspace - scoping it on the workspace would be
 * circular. Do not add that call here.
 *
 * Why these pointers moved out of localStorage: the WebView2 profile under
 * AppData\Local is disposable and origin-partitioned, so losing it made a
 * fully-populated database look like a fresh install. See migration-v12.sql.
 */

export const ACTIVE_USER_KEY = 'active_user_id';
export const ACTIVE_KOINKAT_ACCOUNT_KEY = 'active_koinkat_account_id';

export async function getAppState(key: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ value: string | null }[]>(
    'SELECT value FROM app_state WHERE key = ?',
    [key],
  );
  return rows.length > 0 ? (rows[0].value ?? null) : null;
}

export async function setAppState(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO app_state (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`,
    [key, value],
  );
}

export async function clearAppState(key: string): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM app_state WHERE key = ?', [key]);
}
