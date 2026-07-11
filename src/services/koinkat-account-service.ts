import { getDb, withTransaction, type DbExecutor } from '../db/database';
import { deletePemSecret } from './api-config-service';
import {
  seedDefaultCategories,
  seedMccMappings,
  seedStarterRules,
} from '../db/seed';
import type { KoinkatAccount, KoinkatAccountRow } from '../types/models';
import { toKoinkatAccount } from '../types/models';
import type { ConnectionType, Theme, DecimalSeparator } from '../types/enums';

// ── Seeding ──────────────────────────────────────────────────────────────

/**
 * Ensure a koinkat account has its system categories + MCC mappings
 * seeded. Idempotent - existing seeded accounts are skipped.
 *
 * Called from:
 *   1. `createKoinkatAccount` for brand-new workspaces
 *   2. `loadActiveKoinkatAccount` (via the store) for pre-existing
 *      workspaces that were created before migration v4 and therefore
 *      never got their seeds.
 *
 * Without this, a pre-v4 workspace would have an empty `categories`
 * table and the CategoryPicker would show nothing, and the bank-sync
 * categorization engine would flag every imported transaction as
 * uncategorized.
 */
export async function ensureKoinkatAccountSeeded(
  koinkatAccountId: string,
): Promise<void> {
  await seedDefaultCategories(koinkatAccountId);
  await seedMccMappings(koinkatAccountId);
  // Starter rules seed MUST come after categories - it resolves macro
  // names to ids via the categories table.
  await seedStarterRules(koinkatAccountId);
}

// ── List / Read ─────────────────────────────────────────────────────────

export async function listKoinkatAccounts(userId: string): Promise<KoinkatAccount[]> {
  const db = await getDb();
  const rows = await db.select<KoinkatAccountRow[]>(
    'SELECT * FROM koinkat_accounts WHERE user_id = ? ORDER BY created_at ASC',
    [userId],
  );
  return rows.map(toKoinkatAccount);
}

export async function getKoinkatAccountById(
  id: string,
): Promise<KoinkatAccount | null> {
  const db = await getDb();
  const rows = await db.select<KoinkatAccountRow[]>(
    'SELECT * FROM koinkat_accounts WHERE id = ?',
    [id],
  );
  return rows.length > 0 ? toKoinkatAccount(rows[0]) : null;
}

// ── Create ──────────────────────────────────────────────────────────────

export async function createKoinkatAccount(params: {
  userId: string;
  name: string;
  connectionType: ConnectionType;
  preferredCurrency: string;
  decimalSeparator: DecimalSeparator;
  theme: Theme;
}): Promise<KoinkatAccount> {
  const name = params.name.trim();
  if (!name) throw new Error('Koinkat account name is required');

  const db = await getDb();
  const id = crypto.randomUUID();

  await db.execute(
    `INSERT INTO koinkat_accounts
       (id, user_id, name, connection_type, preferred_currency, decimal_separator, theme)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      params.userId,
      name,
      params.connectionType,
      params.preferredCurrency,
      params.decimalSeparator,
      params.theme,
    ],
  );

  // Every koinkat account gets the default set of system categories
  // (18 expense + 6 income macros) + the MCC → macro mapping. Users
  // create their own subcategories under these at any time.
  await ensureKoinkatAccountSeeded(id);

  // Sandbox and linked accounts get an empty api_configs row so the
  // credential form can upsert into it.
  if (params.connectionType !== 'manual') {
    await db.execute(
      `INSERT OR IGNORE INTO api_configs (koinkat_account_id, environment)
       VALUES (?, ?)`,
      [id, params.connectionType === 'sandbox' ? 'sandbox' : 'production'],
    );
  }

  const account = await getKoinkatAccountById(id);
  if (!account) throw new Error('Failed to create koinkat account');
  return account;
}

// ── Update ──────────────────────────────────────────────────────────────

export async function updateKoinkatAccount(
  id: string,
  changes: Partial<{
    name: string;
    preferredCurrency: string;
    decimalSeparator: DecimalSeparator;
    theme: Theme;
  }>,
): Promise<KoinkatAccount | null> {
  const db = await getDb();

  // Fragments are hardcoded literals only - never interpolate user input into a clause string; bind values via '?'.
  const setClauses: string[] = [];
  const values: unknown[] = [];

  if (changes.name !== undefined) {
    const name = changes.name.trim();
    if (!name) throw new Error('Koinkat account name is required');
    setClauses.push('name = ?');
    values.push(name);
  }
  if (changes.preferredCurrency !== undefined) {
    setClauses.push('preferred_currency = ?');
    values.push(changes.preferredCurrency);
  }
  if (changes.decimalSeparator !== undefined) {
    setClauses.push('decimal_separator = ?');
    values.push(changes.decimalSeparator);
  }
  if (changes.theme !== undefined) {
    setClauses.push('theme = ?');
    values.push(changes.theme);
  }

  if (setClauses.length === 0) return getKoinkatAccountById(id);

  setClauses.push("updated_at = datetime('now')");
  values.push(id);

  await db.execute(
    `UPDATE koinkat_accounts SET ${setClauses.join(', ')} WHERE id = ?`,
    values,
  );

  return getKoinkatAccountById(id);
}

// ── Delete ──────────────────────────────────────────────────────────────

/**
 * Delete a koinkat account and all of its data: accounts, transactions,
 * tags, budgets, bank connections, linked accounts, api config. Done in
 * an order that respects intra-workspace FK references, inside a single
 * transaction so a mid-failure rolls back instead of leaving a half-empty
 * workspace.
 */
export async function deleteKoinkatAccount(
  id: string,
  exec?: DbExecutor,
): Promise<void> {
  // Order matters: dependents first, parents last.
  const steps: Array<readonly [string, string, unknown[]]> = [
    [
      'rule_applications',
      'DELETE FROM rule_applications WHERE transaction_id IN (SELECT id FROM transactions WHERE koinkat_account_id = ?)',
      [id],
    ],
    [
      'split_external_reimbursements',
      'DELETE FROM split_external_reimbursements WHERE koinkat_account_id = ?',
      [id],
    ],
    ['transactions', 'DELETE FROM transactions WHERE koinkat_account_id = ?', [id]],
    // v11 recurring tables. After `transactions` so the
    // `transactions.recurring_series_id ON DELETE SET NULL` FK has no rows
    // left to touch.
    ['recurring_series', 'DELETE FROM recurring_series WHERE koinkat_account_id = ?', [id]],
    ['recurring_dismissals', 'DELETE FROM recurring_dismissals WHERE koinkat_account_id = ?', [id]],
    ['linked_accounts', 'DELETE FROM linked_accounts WHERE koinkat_account_id = ?', [id]],
    ['bank_connections', 'DELETE FROM bank_connections WHERE koinkat_account_id = ?', [id]],
    [
      'budget_periods',
      'DELETE FROM budget_periods WHERE recurring_budget_id IN (SELECT id FROM recurring_budgets WHERE koinkat_account_id = ?)',
      [id],
    ],
    ['recurring_budgets', 'DELETE FROM recurring_budgets WHERE koinkat_account_id = ?', [id]],
    ['budget_events', 'DELETE FROM budget_events WHERE koinkat_account_id = ?', [id]],
    ['categorization_rules', 'DELETE FROM categorization_rules WHERE koinkat_account_id = ?', [id]],
    ['mcc_mappings', 'DELETE FROM mcc_mappings WHERE koinkat_account_id = ?', [id]],
    ['categories', 'DELETE FROM categories WHERE koinkat_account_id = ?', [id]],
    ['accounts', 'DELETE FROM accounts WHERE koinkat_account_id = ?', [id]],
    ['api_configs', 'DELETE FROM api_configs WHERE koinkat_account_id = ?', [id]],
    ['koinkat_accounts', 'DELETE FROM koinkat_accounts WHERE id = ?', [id]],
  ];

  const runSteps = async (tx: DbExecutor) => {
    for (const [table, sql, args] of steps) {
      try {
        await tx.execute(sql, args);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to delete from ${table}: ${msg}`);
      }
    }
  };

  // When a caller (deleteUser) already holds a transaction, run inside it -
  // nesting withTransaction would deadlock the serialize queue.
  if (exec) {
    await runSteps(exec);
  } else {
    await withTransaction(runSteps);
  }

  // The workspace's Enable Banking key may live in the OS credential store
  // (not the DB), so the row deletes above don't remove it. Best-effort and
  // AFTER the transaction: an IPC call must not sit inside the serialize
  // queue, and a keychain failure must not resurrect the workspace.
  await deletePemSecret(id);
}
