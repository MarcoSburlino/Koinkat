import { getDb, withTransaction } from '../db/database';
import type { User, UserRow } from '../types/models';
import { toUser } from '../types/models';
import { deleteKoinkatAccount } from './koinkat-account-service';

// ── List / Read ─────────────────────────────────────────────────────────

export async function listUsers(): Promise<User[]> {
  const db = await getDb();
  const rows = await db.select<UserRow[]>(
    'SELECT * FROM users ORDER BY created_at ASC',
  );
  return rows.map(toUser);
}

export async function getUserById(id: string): Promise<User | null> {
  const db = await getDb();
  const rows = await db.select<UserRow[]>(
    'SELECT * FROM users WHERE id = ?',
    [id],
  );
  return rows.length > 0 ? toUser(rows[0]) : null;
}

// ── Orphaned workspaces ─────────────────────────────────────────────────
//
// `koinkat_accounts.user_id` has no foreign key (schema-v2 is hash-locked
// and cannot gain one), so a lost `users` row leaves every workspace it owned
// intact but unreachable: no user to log in as, and nothing to click. With
// zero users the app used to offer first-run registration on top of that
// data, which only adds a new, empty user. These let bootstrap notice
// instead, and put the missing owners back.
//
// Device-level queries (the whole file, no active workspace exists yet), so
// deliberately not scoped by koinkat_account_id.

const ORPHANED_WORKSPACES =
  'FROM koinkat_accounts WHERE user_id NOT IN (SELECT id FROM users)';

/** Workspaces whose owner is missing from `users`. */
export async function countOrphanedWorkspaces(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>(`SELECT COUNT(*) AS n ${ORPHANED_WORKSPACES}`);
  return Number(rows[0]?.n ?? 0);
}

/**
 * Re-create a user row for every missing owner, under the SAME id, so each
 * workspace is reachable again exactly as it was. The name is a placeholder
 * the user can change; nothing else is touched. Returns how many users were
 * recreated.
 */
export async function recoverOrphanedWorkspaceOwners(): Promise<number> {
  const db = await getDb();
  const res = await db.execute(
    `INSERT INTO users (id, name, email)
     SELECT DISTINCT user_id, 'Recovered user', '' ${ORPHANED_WORKSPACES}`,
  );
  return res.rowsAffected;
}

// ── Create ──────────────────────────────────────────────────────────────

export async function createUser(params: {
  name: string;
  email: string;
}): Promise<User> {
  const name = params.name.trim();
  if (!name) throw new Error('Name is required');

  const db = await getDb();
  const id = crypto.randomUUID();

  await db.execute(
    `INSERT INTO users (id, name, email) VALUES (?, ?, ?)`,
    [id, name, params.email.trim()],
  );

  const user = await getUserById(id);
  if (!user) throw new Error('Failed to create user');
  return user;
}

// ── Update ──────────────────────────────────────────────────────────────

export async function updateUser(
  id: string,
  changes: Partial<{ name: string; email: string }>,
): Promise<User | null> {
  const db = await getDb();

  // Fragments are hardcoded literals only - never interpolate user input into a clause string; bind values via '?'.
  const setClauses: string[] = [];
  const values: unknown[] = [];

  if (changes.name !== undefined) {
    const name = changes.name.trim();
    if (!name) throw new Error('Name is required');
    setClauses.push('name = ?');
    values.push(name);
  }
  if (changes.email !== undefined) {
    setClauses.push('email = ?');
    values.push(changes.email.trim());
  }

  if (setClauses.length === 0) return getUserById(id);

  setClauses.push("updated_at = datetime('now')");
  values.push(id);

  await db.execute(
    `UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`,
    values,
  );

  return getUserById(id);
}

// ── Delete ──────────────────────────────────────────────────────────────

/**
 * Delete a user and ALL of their data: every koinkat account they own,
 * and all accounts, transactions, tags, budgets, bank connections, and
 * API configs that live under those koinkat accounts.
 */
export async function deleteUser(id: string): Promise<void> {
  const db = await getDb();

  const accountIds = await db.select<{ id: string }[]>(
    'SELECT id FROM koinkat_accounts WHERE user_id = ?',
    [id],
  );

  // ONE transaction for every workspace plus the user row. Previously each
  // workspace deletion committed independently - a failure on workspace #3
  // permanently destroyed #1 and #2 while leaving the user half-deleted.
  await withTransaction(async (tx) => {
    for (const { id: kaid } of accountIds) {
      await deleteKoinkatAccount(kaid, tx);
    }
    await tx.execute('DELETE FROM users WHERE id = ?', [id]);
  });
}
