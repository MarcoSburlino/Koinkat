import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReadDatabase } from '../src/database.js';
import { FinanceRepository } from '../src/repository.js';

/** Only synthetic data. SQL files are unmodified copies of Koinkat v16's migrations. */
export function createSyntheticDatabase(path: string) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON');
  const schema = (name: string) => readFileSync(new URL(`../../src/db/${name}`, import.meta.url), 'utf8');
  db.exec(schema('schema-v2.sql'));
  for (let version = 3; version <= 16; version++) db.exec(schema(`migration-v${version}.sql`));
  db.exec(`CREATE TABLE _sqlx_migrations (version BIGINT PRIMARY KEY, success BOOLEAN);
    INSERT INTO _sqlx_migrations VALUES (16, 1)`);

  function insert(table: string, data: Record<string, SQLInputValue>) {
    const columns = Object.keys(data);
    db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...Object.values(data));
  }
  insert('users', { id: 'synthetic-user', name: 'Synthetic Example' });
  for (const id of ['demo', 'other']) insert('koinkat_accounts', { id, user_id: 'synthetic-user', name: id === 'demo' ? 'Synthetic demo' : 'Other workspace', connection_type: 'manual', preferred_currency: 'EUR' });
  for (const [id, currency, balance, workspace] of [
    ['eur', 'EUR', '1000.00', 'demo'], ['dkk', 'DKK', '800.00', 'demo'],
    ['jpy', 'JPY', '100.00', 'demo'], ['vnd', 'VND', '1000000.00', 'demo'],
    ['other-account', 'EUR', '999999.00', 'other'],
  ]) insert('accounts', { id: id!, koinkat_account_id: workspace!, name: id!, currency: currency!, current_balance: balance! });
  for (const [id, name, type, workspace, parent] of [
    ['food', 'Food', 'expense', 'demo', null], ['groceries', 'Groceries', 'expense', 'demo', 'food'],
    ['salary-category', 'Salary', 'income', 'demo', null], ['other-category', 'PRIVATE_OTHER_CATEGORY', 'expense', 'other', null],
  ] as const) insert('categories', { id, name, type, koinkat_account_id: workspace, parent_id: parent });
  insert('exchange_rates', { rate_date: '2026-11-01', rates_json: JSON.stringify({ usd: '1', eur: '0.8', dkk: '8', vnd: '25000' }) });
  insert('exchange_rates', { rate_date: '2026-11-09', rates_json: JSON.stringify({ usd: '1', eur: '0.8', dkk: '8', vnd: '25000' }) });
  insert('recurring_budgets', { id: 'budget', koinkat_account_id: 'demo', year: 2026, start_month: 1, end_month: 12, limit_amount: '500.00', currency: 'EUR' });
  insert('budget_periods', { id: 'november', koinkat_account_id: 'demo', recurring_budget_id: 'budget', period_start: '2026-11-01', period_end: '2026-11-30', limit_amount: '500.00', currency: 'EUR' });
  insert('budget_events', { id: 'trip', koinkat_account_id: 'demo', name: 'Trip', limit_amount: '200.00', currency: 'EUR' });
  insert('budget_events', { id: 'summed-event', koinkat_account_id: 'demo', name: 'Folded into November', limit_amount: '50.00', currency: 'EUR', sum_to_budget: 1, sum_to_month: '2026-11-01' });
  insert('budget_events', { id: 'other-event', koinkat_account_id: 'other', name: 'PRIVATE_OTHER_EVENT', limit_amount: '99999.00', currency: 'EUR' });
  insert('recurring_series', { id: 'subscription', koinkat_account_id: 'demo', merchant_normalized: 'STREAM', display_name: 'Streaming', cadence: 'monthly', expected_amount: '12.00', currency: 'EUR', next_expected_date: '2026-12-01', last_charge_date: '2026-11-01' });
  insert('recurring_series', { id: 'other-series', koinkat_account_id: 'other', merchant_normalized: 'PRIVATE_OTHER_SERIES', display_name: 'PRIVATE_OTHER_SERIES' });

  function transaction(id: string, amount: string, extras: Record<string, SQLInputValue> = {}) {
    insert('transactions', { id, koinkat_account_id: 'demo', account_id: 'eur', type: 'expense', amount,
      currency: 'EUR', exchange_rate: '1', amount_in_account_ccy: amount,
      date: '2026-11-03', category_id: 'groceries', merchant_normalized: 'SUPERMARKET', ...extras });
  }
  transaction('groceries', '10.10');
  transaction('split', '100.00', { split_status: 'open', net_spent_in_account_ccy: '40.00' });
  transaction('repayment', '60.00', { type: 'income', category_id: null, related_transaction_id: 'split', relation_kind: 'repayment' });
  transaction('overpaid-split', '100.00', { split_status: 'settled', net_spent_in_account_ccy: '-20.00' });
  transaction('overpaid-repayment', '120.00', { type: 'income', category_id: null, related_transaction_id: 'overpaid-split', relation_kind: 'repayment' });
  transaction('pending', '999.00', { status: 'pending', needs_review: 1 });
  transaction('transfer-out', '200.00', { transfer_pair_id: 'pair', category_id: null });
  transaction('transfer-in', '200.00', { type: 'income', account_id: 'dkk', currency: 'DKK', transfer_pair_id: 'pair', category_id: null });
  transaction('native-transfer', '25.00', { type: 'transfer', destination_account_id: 'dkk', amount_in_dest_ccy: '250.00', category_id: null });
  transaction('salary', '1000.00', { type: 'income', category_id: 'salary-category', merchant_normalized: 'EMPLOYER' });
  transaction('foreign', '80.00', { account_id: 'dkk', currency: 'DKK', merchant_normalized: 'DANISH STORE' });
  transaction('weak-currency', '1000000.00', { account_id: 'vnd', currency: 'VND', merchant_normalized: 'VIETNAM STORE' });
  transaction('missing-rate', '100.00', { account_id: 'jpy', currency: 'JPY', is_budgeted: 0 });
  transaction('fee', '2.00', { related_transaction_id: 'groceries', relation_kind: 'fee', merchant_normalized: null });
  transaction('trip-spend', '30.00', { budget_event_id: 'trip', is_budgeted: 0 });
  transaction('summed-spend', '20.00', { budget_event_id: 'summed-event', date: '2026-09-01' });
  transaction('recurring', '12.00', { recurring_series_id: 'subscription', merchant_normalized: 'STREAM' });
  transaction('other-transaction', '99999.00', { koinkat_account_id: 'other', account_id: 'other-account', category_id: 'other-category', note: 'PRIVATE_OTHER_TRANSACTION' });
  insert('split_external_reimbursements', { id: 'external', koinkat_account_id: 'demo', parent_transaction_id: 'split', amount: '1.00', currency: 'EUR', amount_in_parent_ccy: '1.00', exchange_rate: '1', date: '2026-11-03', source: 'Synthetic cash' });
  // The split net includes the external repayment: 100 - 59 bank - 1 cash = 40.
  db.prepare("UPDATE transactions SET amount='59.00', amount_in_account_ccy='59.00' WHERE id='repayment'").run();
  insert('api_configs', { koinkat_account_id: 'demo', app_id: 'CANARY_API_ID', private_key_pem: 'CANARY_SECRET_NEVER_RETURN' });
  db.exec('PRAGMA legacy_alter_table=OFF; PRAGMA defer_foreign_keys=OFF');
  return { db, transaction, insert };
}

export function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'koinkat-mcp-test-'));
  const path = join(directory, 'synthetic.db');
  const writer = createSyntheticDatabase(path);
  const database = new ReadDatabase(path, 'demo');
  const repository = new FinanceRepository(database);
  return { ...writer, path, directory, database, repository,
    close() { database.close(); writer.db.close(); rmSync(directory, { recursive: true, force: true }); } };
}
