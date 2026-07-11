import { getDb, withTransaction } from '../db/database';
import { qCent, dec } from '../domain/money';
import { DEFAULT_COLOR } from '../domain/colors';
import { isSupportedCurrency } from '../domain/currencies';
import { requireActiveKoinkatAccountId } from '../lib/active-koinkat-account';
import { purgeAccountTransactions } from './transaction-service';
import type { Account, AccountRow } from '../types/models';
import { toAccount } from '../types/models';

export async function createAccount(params: {
  name: string;
  currency: string;
  color?: string;
  startingBalance?: string;
}): Promise<Account> {
  const name = params.name.trim();
  if (!name) throw new Error('Account name is required');

  const currency = params.currency.toUpperCase();
  if (currency.length !== 3 || !isSupportedCurrency(currency)) {
    throw new Error('Currency must be a valid 3-letter ISO 4217 code');
  }

  const color = params.color ?? DEFAULT_COLOR;
  const balance = params.startingBalance
    ? qCent(dec(params.startingBalance)).toFixed(2)
    : '0.00';

  const koinkatAccountId = requireActiveKoinkatAccountId();
  const id = crypto.randomUUID();
  const db = await getDb();

  await db.execute(
    `INSERT INTO accounts (id, koinkat_account_id, name, currency, color, current_balance, is_manual)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
    [id, koinkatAccountId, name, currency, color, balance],
  );

  const rows = await db.select<AccountRow[]>(
    'SELECT * FROM accounts WHERE id = ? AND koinkat_account_id = ?',
    [id, koinkatAccountId],
  );
  return toAccount(rows[0]);
}

export async function listAccounts(): Promise<Account[]> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const rows = await db.select<AccountRow[]>(
    'SELECT * FROM accounts WHERE koinkat_account_id = ? ORDER BY is_pinned DESC, created_at DESC',
    [koinkatAccountId],
  );
  return rows.map(toAccount);
}

export async function getAccountById(id: string): Promise<Account | null> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const rows = await db.select<AccountRow[]>(
    'SELECT * FROM accounts WHERE id = ? AND koinkat_account_id = ?',
    [id, koinkatAccountId],
  );
  return rows.length > 0 ? toAccount(rows[0]) : null;
}

export async function updateAccount(
  id: string,
  changes: { name?: string; color?: string },
): Promise<Account | null> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();

  // Fragments are hardcoded literals only - never interpolate user input into a clause string; bind values via '?'.
  const setClauses: string[] = [];
  const values: unknown[] = [];

  if (changes.name !== undefined) {
    const name = changes.name.trim();
    if (!name) throw new Error('Account name is required');
    setClauses.push('name = ?');
    values.push(name);
  }
  if (changes.color !== undefined) {
    setClauses.push('color = ?');
    values.push(changes.color);
  }

  if (setClauses.length === 0) return getAccountById(id);

  setClauses.push("updated_at = datetime('now')");
  values.push(id, koinkatAccountId);

  await db.execute(
    `UPDATE accounts SET ${setClauses.join(', ')} WHERE id = ? AND koinkat_account_id = ?`,
    values,
  );

  return getAccountById(id);
}

export async function deleteAccount(id: string): Promise<boolean> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const existing = await getAccountById(id);
  if (!existing) return false;

  // The FK `ON DELETE CASCADE` on transactions would drop every row touching
  // this account WITHOUT running balance math - transfers would leave the
  // counter-account's balance permanently desynced, and repayment children
  // on other accounts would vanish without recomputing their parents' nets.
  // Purge the transactions with proper reversal first, then delete the row.
  return withTransaction(async (tx) => {
    await purgeAccountTransactions(id, tx);
    const result = await tx.execute(
      'DELETE FROM accounts WHERE id = ? AND koinkat_account_id = ?',
      [id, koinkatAccountId],
    );
    return result.rowsAffected > 0;
  });
}

export async function pinAccount(id: string): Promise<void> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  // Atomic clear-then-set: a failure between the two would leave the
  // workspace with no pinned account at all.
  await withTransaction(async (tx) => {
    await tx.execute(
      "UPDATE accounts SET is_pinned = 0, updated_at = datetime('now') WHERE koinkat_account_id = ? AND is_pinned = 1",
      [koinkatAccountId],
    );
    await tx.execute(
      "UPDATE accounts SET is_pinned = 1, updated_at = datetime('now') WHERE id = ? AND koinkat_account_id = ?",
      [id, koinkatAccountId],
    );
  });
}

export async function unpinAccount(id: string): Promise<void> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  await db.execute(
    "UPDATE accounts SET is_pinned = 0, updated_at = datetime('now') WHERE id = ? AND koinkat_account_id = ?",
    [id, koinkatAccountId],
  );
}
