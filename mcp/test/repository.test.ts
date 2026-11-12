import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from './fixtures.js';
import { ReadDatabase } from '../src/database.js';

test('summaries apply split net, signed over-repayments, pending/repayment/transfer exclusions and currency conversion', t => {
  const f = fixture(); t.after(() => f.close());
  const result = f.repository.summarizeTransactions({});
  assert.equal(result.income, '1000.00');
  assert.equal(result.expenses, '134.10');
  assert.equal(result.net, '865.90');
  assert.equal(result.includedCount, 11);
  assert.equal(result.excludedCount, 6);
  assert.equal(result.convertedCount, 10);
  assert.deepEqual(result.unconvertibleCurrencies, ['JPY']);
  assert.equal(result.complete, false);
  const split = f.repository.summarizeTransactions({ merchant: 'SUPERMARKET', accountId: 'eur', type: 'expense' });
  assert.equal(split.expenses, '80.10');
  assert.equal(split.complete, true);
});

test('search and grouped summaries paginate deterministically without truncating aggregate totals', t => {
  const f = fixture(); t.after(() => f.close());
  const first = f.repository.searchTransactions({ limit: 1 });
  const second = f.repository.searchTransactions({ limit: 1, offset: 1 });
  assert.equal(first.totalMatching, 17);
  assert.equal(first.hasMore, true);
  assert.notEqual(first.transactions[0]!.id, second.transactions[0]!.id);
  const grouped = f.repository.summarizeTransactions({ groupBy: 'merchant', limit: 1 });
  assert.equal(grouped.expenses, '134.10');
  assert.equal(grouped.groups.length, 1);
  assert.ok(grouped.totalGroups > 1);
  assert.equal(grouped.hasMore, true);
  assert.equal(f.repository.searchTransactions({ needsReview: true }).totalMatching, 1);
  assert.equal(f.repository.searchTransactions({ recurring: true }).totalMatching, 1);
  assert.equal(f.repository.searchTransactions({ transactionCurrency: 'VND' }).transactions[0]!.id, 'weak-currency');
  assert.equal(f.repository.searchTransactions({ status: 'pending' }).transactions[0]!.id, 'pending');
  assert.equal(f.repository.summarizeTransactions({ status: 'pending' }).expenses, '0.00');
  assert.equal(f.repository.searchTransactions({ merchant: "' OR 1=1 --" }).totalMatching, 0);
  assert.equal(f.repository.searchTransactions({ merchant: '%' }).totalMatching, 0);
});

test('amount comparisons use decimal math, date filters and category/week grouping work', t => {
  const f = fixture(); t.after(() => f.close());
  const rows = f.repository.searchTransactions({ minAmount: '10.10', maxAmount: '10.10' });
  assert.equal(rows.totalMatching, 1);
  assert.equal(rows.transactions[0]!.id, 'groceries');
  assert.equal(f.repository.summarizeTransactions({ startDate: '2026-09-01', endDate: '2026-09-30', groupBy: 'month' }).expenses, '20.00');
  assert.equal(f.repository.summarizeTransactions({ groupBy: 'week' }).groups.find(g => g.key === '2026-11-02')?.expenses, '114.10');
  assert.ok(f.repository.summarizeTransactions({ groupBy: 'category' }).groups.some(g => g.key === 'groceries'));
  assert.throws(() => f.repository.searchTransactions({ startDate: '2026-11-10', endDate: '2026-11-01' }), /startDate/);
  assert.throws(() => f.repository.searchTransactions({ startDate: '2026-02-30' }));
  assert.throws(() => f.repository.searchTransactions({ minAmount: '100', maxAmount: '1' }), /range/);
});

test('all reads are scoped to the startup workspace and return no credentials or bank session fields', t => {
  const f = fixture(); t.after(() => f.close());
  const responses = [f.repository.getContext(), f.repository.listAccounts(), f.repository.listCategories(),
    f.repository.searchTransactions({}), f.repository.summarizeTransactions({}), f.repository.getTransaction('split'),
    f.repository.getBudgets(2026), f.repository.listRecurringExpenses('active', 50, 0),
    f.repository.listSplitExpenses('all', 50, 0)];
  const json = JSON.stringify(responses);
  assert.doesNotMatch(json, /CANARY|PRIVATE_OTHER|private_key|session_id|authorization_id|iban/i);
  assert.throws(() => f.repository.getTransaction('other-transaction'), /authorized workspace/);
  assert.equal(f.repository.searchTransactions({ accountId: 'other-account' }).totalMatching, 0);
  assert.throws(() => new ReadDatabase(f.path, 'missing'), /workspace/);
  assert.throws(() => f.database.select('SELECT private_key_pem FROM api_configs'), /outside/);
  assert.throws(() => f.database.select('DELETE FROM transactions'), /outside/);
});

test('balances retain native amounts and disclose missing conversions; detail includes related existing records', t => {
  const f = fixture(); t.after(() => f.close());
  const accounts = f.repository.listAccounts(1);
  assert.equal(accounts.total, '1112.00');
  assert.equal(accounts.totalAccounts, 4);
  assert.equal(accounts.accounts.length, 1);
  assert.equal(accounts.complete, false);
  assert.deepEqual(accounts.unconvertibleCurrencies, ['JPY']);
  const split = f.repository.getTransaction('split');
  assert.equal(split.relatedTransactions[0]!.id, 'repayment');
  assert.equal(split.externalReimbursements[0]!.id, 'external');
  assert.equal(f.repository.getTransaction('transfer-out').relatedTransactions[0]!.id, 'transfer-in');
  assert.equal(f.repository.getTransaction('groceries').relatedTransactions[0]!.id, 'fee');
  const open = f.repository.listSplitExpenses('open', 50, 0);
  assert.equal(open.splits[0]!.netCost, '40.00');
  assert.equal(open.splits[0]!.reimbursed, '60.00');
});

test('budgets respect event inclusion, non-budgeted event spend, historical rates and signed split net', t => {
  const f = fixture(); t.after(() => f.close());
  const result = f.repository.getBudgets(2026);
  assert.equal(result.periods[0]!.spent, '104.10');
  assert.equal(result.periods[0]!.effectiveLimit, '550.00');
  assert.equal(result.periods[0]!.remaining, '445.90');
  assert.equal(result.periods[0]!.complete, true);
  assert.equal(result.events.find(e => e.id === 'trip')!.spent, '30.00');
  assert.equal(result.events.find(e => e.id === 'summed-event')!.spent, '20.00');
  assert.deepEqual(result.usedRateDates, ['2026-11-01']);
  assert.deepEqual(result.datesUsingFallbackRates, ['2026-11-03']);
  assert.equal(f.repository.getBudgets(2027).periods.length, 0);
});

test('schema fixtures have valid integrity and foreign keys, reads leave the file byte-for-byte unchanged', t => {
  const f = fixture(); t.after(() => f.close());
  assert.equal(f.db.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok');
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
  const before = readFileSync(f.path);
  f.database.snapshot(() => {
    f.repository.getContext(); f.repository.searchTransactions({}); f.repository.summarizeTransactions({}); f.repository.getBudgets(2026);
  });
  assert.deepEqual(readFileSync(f.path), before);
  assert.throws(() => new ReadDatabase(join(f.directory, 'missing.db'), 'demo'));
  assert.throws(() => new ReadDatabase('relative.db', 'demo'), /absolute/);
});

test('missing rates never prevent same-currency reporting; invalid cache is rejected', t => {
  const f = fixture(); t.after(() => f.close());
  f.db.exec('DELETE FROM exchange_rates');
  assert.equal(f.repository.summarizeTransactions({ accountId: 'eur' }).expenses, '94.10');
  assert.equal(f.repository.summarizeTransactions({}).complete, false);
  f.db.prepare('INSERT INTO exchange_rates (rate_date, rates_json) VALUES (?, ?)').run('2026-11-09', 'null');
  assert.throws(() => f.repository.summarizeTransactions({}), /exchange-rate/);
});

test('assistant chats are never readable through the repository', t => {
  const f = fixture(); t.after(() => f.close());
  f.db.exec(`INSERT INTO assistant_conversations (id, koinkat_account_id, title, engine) VALUES ('c1', 'demo', 'PRIVATE_CHAT', 'local')`);
  const read = new ReadDatabase(f.path, 'demo');
  t.after(() => read.close());
  for (const table of ['assistant_settings', 'assistant_conversations', 'assistant_messages']) {
    assert.throws(() => read.select(`SELECT * FROM ${table}`), /outside the read interface/);
  }
});

test('unsupported future schemas and non-table replacements are rejected without migrations', t => {
  const f = fixture(); t.after(() => f.close());
  f.db.exec('INSERT INTO _sqlx_migrations VALUES (17, 1)');
  assert.throws(() => new ReadDatabase(f.path, 'demo'), /through v16/);
  f.db.exec('DELETE FROM _sqlx_migrations WHERE version=17');
  f.db.exec('ALTER TABLE exchange_rates RENAME TO saved_rates; CREATE VIEW exchange_rates AS SELECT rate_date, rates_json FROM saved_rates');
  assert.throws(() => new ReadDatabase(f.path, 'demo'), /missing table exchange_rates/);
});

test('each read snapshot remains consistent if another connection commits a change', t => {
  const f = fixture(); t.after(() => f.close());
  f.db.exec('PRAGMA journal_mode=WAL');
  f.database.snapshot(() => {
    const before = f.repository.getTransaction('groceries').transaction.note;
    f.db.prepare('UPDATE transactions SET note=? WHERE id=?').run('Synthetic concurrent change', 'groceries');
    assert.equal(f.repository.getTransaction('groceries').transaction.note, before);
  });
  assert.equal(f.repository.getTransaction('groceries').transaction.note, 'Synthetic concurrent change');
});
