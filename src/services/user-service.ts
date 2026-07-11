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
