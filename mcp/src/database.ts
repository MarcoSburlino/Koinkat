import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { isAbsolute } from 'node:path';
import { statSync } from 'node:fs';

export type Row = Record<string, string | number | null>;

// Only these application tables may be read. No caller supplies SQL through MCP.
const REQUIRED: Record<string, string[]> = {
  koinkat_accounts: ['id', 'name', 'preferred_currency'],
  accounts: ['id', 'koinkat_account_id', 'name', 'currency', 'current_balance', 'is_manual'],
  transactions: ['id', 'koinkat_account_id', 'amount', 'currency', 'amount_in_account_ccy',
    'date', 'type', 'status', 'net_spent_in_account_ccy', 'transfer_pair_id', 'recurring_series_id',
    'category_id', 'account_id', 'note', 'budget_event_id', 'is_budgeted', 'relation_kind',
    'related_transaction_id', 'split_status', 'merchant_normalized', 'needs_review', 'updated_at'],
  categories: ['id', 'koinkat_account_id', 'name', 'type', 'parent_id'],
  recurring_budgets: ['id', 'koinkat_account_id', 'year', 'limit_amount', 'currency'],
  budget_periods: ['id', 'koinkat_account_id', 'recurring_budget_id', 'period_start', 'period_end', 'limit_amount', 'currency'],
  budget_events: ['id', 'koinkat_account_id', 'name', 'limit_amount', 'currency', 'start_date', 'end_date', 'sum_to_budget', 'sum_to_month', 'is_expired'],
  recurring_series: ['id', 'koinkat_account_id', 'display_name', 'status', 'cadence', 'expected_amount', 'currency', 'next_expected_date'],
  exchange_rates: ['rate_date', 'rates_json'],
  linked_accounts: ['koinkat_account_id', 'last_synced_at'],
  split_external_reimbursements: ['id', 'koinkat_account_id', 'parent_transaction_id', 'amount', 'currency', 'amount_in_parent_ccy', 'date', 'source', 'note'],
};

export class ReadDatabase {
  readonly #db: DatabaseSync;
  readonly workspaceId: string;

  constructor(path: string, workspaceId: string) {
    if (!isAbsolute(path) || !statSync(path).isFile()) throw new Error('An absolute path to an existing SQLite file is required');
    if (!workspaceId || workspaceId.length > 200) throw new Error('An explicit workspace ID is required');
    this.workspaceId = workspaceId;
    this.#db = new DatabaseSync(path, { readOnly: true, allowExtension: false });
    try {
      this.#db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=3000');
      const ledger = this.#db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='_sqlx_migrations'").get();
      if (ledger) {
        const latest = this.#db.prepare('SELECT MAX(version) AS version FROM _sqlx_migrations WHERE success = 1').get();
        if (Number(latest?.version) > 16) throw new Error('Unsupported Koinkat schema: this build supports migrations through v16');
      }
      for (const [table, required] of Object.entries(REQUIRED)) {
        const object = this.#db.prepare('SELECT type FROM sqlite_schema WHERE name = ?').get(table);
        if (object?.type !== 'table') throw new Error(`Unsupported database: missing table ${table}`);
        const columns = new Set(this.#db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name));
        if (required.some(c => !columns.has(c))) throw new Error(`Unsupported Koinkat schema for ${table}; expected v16-compatible columns`);
      }
      if (!this.#db.prepare('SELECT id FROM koinkat_accounts WHERE id = ?').get(workspaceId)) {
        throw new Error('Authorized workspace not found');
      }
    } catch (error) { this.#db.close(); throw error; }
  }

  select(sql: string, params: SQLInputValue[] = []): Row[] {
    // Defense against accidentally introducing a credential query during development.
    if (!/^SELECT\s/i.test(sql.trim()) || /\b(api_configs|bank_connections|sqlite_schema|sqlite_master|assistant_settings|assistant_conversations|assistant_messages)\b/i.test(sql)) {
      throw new Error('Query is outside the read interface');
    }
    return this.#db.prepare(sql).all(...params) as Row[];
  }

  snapshot<T>(fn: () => T): T {
    this.#db.exec('BEGIN');
    try { const result = fn(); this.#db.exec('COMMIT'); return result; }
    catch (error) { this.#db.exec('ROLLBACK'); throw error; }
  }

  close() { this.#db.close(); }
}
