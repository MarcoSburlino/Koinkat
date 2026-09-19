/**
 * Item G regression: an over-reimbursed split nets negative, and every
 * aggregation must carry that sign through.
 *
 * Scenario throughout: a 100.00 expense reimbursed 120.00, so
 * `net_spent_in_account_ccy` is -20.00. Reporting used to `.abs()` that
 * into +20.00 spending - a 40.00 swing in the wrong direction.
 *
 * Runs against a real SQLite database with the real migrations, so the
 * COALESCE(net, gross) fragment in tx-sql.ts is genuinely exercised.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestDb, type Harness } from '../test/sqlite-harness';

const WS = 'ws-1';

let db: Harness;

vi.mock('../db/database', () => ({
  getDb: vi.fn(async () => db),
  withTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
}));

vi.mock('../lib/active-koinkat-account', () => ({
  requireActiveKoinkatAccountId: vi.fn(() => WS),
  getActiveKoinkatAccountId: vi.fn(() => WS),
  captureWorkspace: vi.fn(() => ({ id: WS, assertUnchanged: () => {} })),
}));

vi.mock('./exchange-rate-service', () => ({
  // Single-currency fixtures: rates are present but never need to convert.
  getLatestCachedRates: vi.fn(async () => ({ eur: '1', usd: '1' })),
  getRatesForDate: vi.fn(async () => ({ eur: '1', usd: '1' })),
}));

async function seed() {
  await db.execute(
    `INSERT INTO accounts (id, koinkat_account_id, name, currency, current_balance)
     VALUES (?, ?, ?, ?, ?)`,
    ['acct-1', WS, 'Checking', 'EUR', '1000.00'],
  );
  await db.execute(
    `INSERT INTO categories (id, koinkat_account_id, name, type)
     VALUES (?, ?, ?, ?)`,
    ['cat-1', WS, 'Travel', 'expense'],
  );
}

/** A split parent: gross 100, reimbursed 120, net -20. */
async function insertOverReimbursedSplit() {
  await db.execute(
    `INSERT INTO transactions
       (id, koinkat_account_id, account_id, type, amount, currency,
        exchange_rate, amount_in_account_ccy, net_spent_in_account_ccy,
        category_id, date, status)
     VALUES (?, ?, ?, 'expense', ?, 'EUR', '1', ?, ?, ?, ?, 'booked')`,
    ['tx-split', WS, 'acct-1', '100.00', '100.00', '-20.00', 'cat-1', '2026-03-10'],
  );
}

/** A plain expense with no split, contributing its gross. */
async function insertPlainExpense(id: string, amount: string, date: string) {
  await db.execute(
    `INSERT INTO transactions
       (id, koinkat_account_id, account_id, type, amount, currency,
        exchange_rate, amount_in_account_ccy, category_id, date, status)
     VALUES (?, ?, ?, 'expense', ?, 'EUR', '1', ?, ?, ?, 'booked')`,
    [id, WS, 'acct-1', amount, amount, 'cat-1', date],
  );
}

beforeEach(async () => {
  db = createTestDb();
  await seed();
  vi.clearAllMocks();
});

afterEach(() => db.close());

describe('split net sign in reporting', () => {
  it('reports an over-reimbursed split as negative spending, not positive', async () => {
    const { categoryBreakdown } = await import('./reporting-service');
    await insertOverReimbursedSplit();

    const res = await categoryBreakdown({ year: 2026, preferredCurrency: 'EUR' });

    expect(res.total).toBe('-20.00');
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].amount).toBe('-20.00');
  });

  it('nets the split against a normal expense instead of inflating it', async () => {
    const { categoryBreakdown } = await import('./reporting-service');
    await insertOverReimbursedSplit();
    await insertPlainExpense('tx-plain', '50.00', '2026-03-11');

    const res = await categoryBreakdown({ year: 2026, preferredCurrency: 'EUR' });

    // 50 + (-20) = 30. The abs() bug produced 50 + 20 = 70.
    expect(res.total).toBe('30.00');
  });

  it('carries the sign into monthly cashflow', async () => {
    const { monthlyCashflow } = await import('./reporting-service');
    await insertOverReimbursedSplit();

    const res = await monthlyCashflow({ year: 2026, targetCurrency: 'EUR' });
    const march = res.rows.find((r) => r.month === 3)!;

    expect(march.expense).toBe('-20.00');
  });

  it('leaves an ordinary expense untouched', async () => {
    const { categoryBreakdown } = await import('./reporting-service');
    await insertPlainExpense('tx-plain', '75.00', '2026-03-11');

    const res = await categoryBreakdown({ year: 2026, preferredCurrency: 'EUR' });
    expect(res.total).toBe('75.00');
  });

  it('treats a fully reimbursed split as exactly zero', async () => {
    const { categoryBreakdown } = await import('./reporting-service');
    await db.execute(
      `INSERT INTO transactions
         (id, koinkat_account_id, account_id, type, amount, currency,
          exchange_rate, amount_in_account_ccy, net_spent_in_account_ccy,
          category_id, date, status)
       VALUES (?, ?, ?, 'expense', ?, 'EUR', '1', ?, ?, ?, ?, 'booked')`,
      ['tx-zero', WS, 'acct-1', '100.00', '100.00', '0.00', 'cat-1', '2026-03-10'],
    );

    const res = await categoryBreakdown({ year: 2026, preferredCurrency: 'EUR' });
    expect(res.total).toBe('0.00');
  });
});
