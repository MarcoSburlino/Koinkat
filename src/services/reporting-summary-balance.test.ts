/**
 * Summary starting and running balances, against the real schema.
 *
 * They used to be derived from income minus expense: starting balance =
 * current balance - net profit since the start of the year. A balance does
 * not move by profit. Transfers, repayments and the part of a split others
 * paid back all move it while (rightly) staying out of income and expense,
 * so with one account selected every transfer in or out of it made the
 * figures drift, and even the all-accounts view missed repayments and money
 * moved to accounts outside Koinkat.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestDb, type Harness } from '../test/sqlite-harness';
import type { Account } from '../types/models';

const WS = 'ws-1';

let db: Harness;

vi.mock('../db/database', () => ({
  getDb: vi.fn(async () => db),
  withTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => db.transaction(fn as never)),
}));

vi.mock('../lib/active-koinkat-account', () => ({
  requireActiveKoinkatAccountId: vi.fn(() => WS),
  getActiveKoinkatAccountId: vi.fn(() => WS),
  captureWorkspace: vi.fn(() => ({ id: WS, assertUnchanged: () => {} })),
}));

vi.mock('./exchange-rate-service', () => ({
  getLatestCachedRates: vi.fn(async () => ({ usd: '1', eur: '1' })),
  getRatesForDate: vi.fn(async () => ({ usd: '1', eur: '1' })),
}));

vi.mock('./budget-service', () => ({
  applyAutoCaptureForTransaction: vi.fn(async () => undefined),
}));

import { buildYearlySummary } from './reporting-service';

async function account(id: string, balance: string) {
  await db.execute(
    `INSERT INTO accounts (id, koinkat_account_id, name, currency, current_balance, is_manual)
     VALUES (?, ?, ?, 'EUR', ?, 1)`,
    [id, WS, `Account ${id}`, balance],
  );
}

async function row(
  id: string,
  opts: {
    account: string;
    type: 'income' | 'expense' | 'transfer';
    amount: string;
    date: string;
    dest?: string;
    pairId?: string;
    status?: 'booked' | 'pending';
    net?: string;
    relationKind?: 'repayment';
    relatedTo?: string;
    splitStatus?: 'open';
  },
) {
  await db.execute(
    `INSERT INTO transactions
       (id, koinkat_account_id, account_id, destination_account_id, related_transaction_id,
        type, amount, currency, exchange_rate, amount_in_account_ccy, amount_in_dest_ccy,
        date, status, transfer_pair_id, net_spent_in_account_ccy, relation_kind, split_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'EUR', '1', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      WS,
      opts.account,
      opts.dest ?? null,
      opts.relatedTo ?? null,
      opts.type,
      opts.amount,
      opts.amount,
      opts.dest ? opts.amount : null,
      opts.date,
      opts.status ?? 'booked',
      opts.pairId ?? null,
      opts.net ?? null,
      opts.relationKind ?? null,
      opts.splitStatus ?? null,
    ],
  );
}

async function accounts(): Promise<Account[]> {
  const { listAccounts } = await import('./account-service');
  return listAccounts();
}

const monthBalance = (data: Awaited<ReturnType<typeof buildYearlySummary>>, month: number) =>
  data.rows.find((r) => r.month === month)!.balance;

/**
 * `main` opened the year at 1000 and `savings` at 0. Every kind of row that
 * moves a balance without being plain income or spending is here.
 */
async function seedYear() {
  await row('salary', { account: 'main', type: 'income', amount: '2000.00', date: '2026-01-15' });
  await row('rent', { account: 'main', type: 'expense', amount: '800.00', date: '2026-02-01' });
  // A confirmed transfer pair: main -> savings.
  await row('pair-out', { account: 'main', type: 'expense', amount: '500.00', date: '2026-03-05', pairId: 'p1' });
  await row('pair-in', { account: 'savings', type: 'income', amount: '500.00', date: '2026-03-06', pairId: 'p1' });
  // A split dinner: 100 paid, 60 paid back by a friend, net 40.
  await row('dinner', {
    account: 'main', type: 'expense', amount: '100.00', date: '2026-04-10', net: '40.00', splitStatus: 'open',
  });
  await row('payback', {
    account: 'main', type: 'income', amount: '60.00', date: '2026-04-12', relationKind: 'repayment', relatedTo: 'dinner',
  });
  // A native transfer main -> savings.
  await row('move', { account: 'main', type: 'transfer', amount: '200.00', date: '2026-05-01', dest: 'savings' });
  // Pending: moves nothing yet.
  await row('pending', { account: 'main', type: 'expense', amount: '50.00', date: '2026-06-01', status: 'pending' });
  // Money sent to an account not in Koinkat (a one-row transfer).
  await row('away', { account: 'main', type: 'expense', amount: '300.00', date: '2026-07-01', pairId: 'p2' });
}

beforeEach(async () => {
  db = createTestDb();
  vi.clearAllMocks();
});

afterEach(() => db.close());

describe('Summary balances follow what actually moved each account', () => {
  beforeEach(async () => {
    // Current balances after the year's rows: 1000 + 2000 - 800 - 500 - 100
    // + 60 - 200 - 300 = 1160, and 0 + 500 + 200 = 700.
    await account('main', '1160.00');
    await account('savings', '700.00');
    await seedYear();
  });

  it('gives one account its real starting and running balance', async () => {
    const all = await accounts();
    const data = await buildYearlySummary({
      year: 2026, accountId: 'main', preferredCurrency: 'EUR', accounts: all,
    });

    // Income minus expense said 0.00 here (1160 - (2000 - 800 - 40)).
    expect(data.totals.startingBalance).toBe('1000.00');
    expect(monthBalance(data, 1)).toBe('3000.00');
    expect(monthBalance(data, 2)).toBe('2200.00');
    expect(monthBalance(data, 3)).toBe('1700.00'); // transfer out
    expect(monthBalance(data, 4)).toBe('1660.00'); // gross 100 out, 60 back
    expect(monthBalance(data, 5)).toBe('1460.00'); // native transfer out
    expect(monthBalance(data, 6)).toBe('1460.00'); // pending moves nothing
    expect(monthBalance(data, 7)).toBe('1160.00'); // sent outside Koinkat
    expect(monthBalance(data, 12)).toBe(data.totals.currentBalance);
  });

  it('leaves income, expense and profit as they were', async () => {
    const all = await accounts();
    const data = await buildYearlySummary({
      year: 2026, accountId: 'main', preferredCurrency: 'EUR', accounts: all,
    });
    const march = data.rows.find((r) => r.month === 3)!;
    const april = data.rows.find((r) => r.month === 4)!;

    expect(march.profit).toBe('0.00'); // a transfer is not spending
    expect(april.expense).toBe('40.00'); // the split's net
    expect(april.income).toBe('0.00'); // the repayment is not income
    expect(data.totals.profit).toBe('1160.00'); // 2000 - 800 - 40
  });

  it('gives the receiving account its transfers in', async () => {
    const all = await accounts();
    const data = await buildYearlySummary({
      year: 2026, accountId: 'savings', preferredCurrency: 'EUR', accounts: all,
    });

    expect(data.totals.startingBalance).toBe('0.00');
    expect(monthBalance(data, 3)).toBe('500.00');
    expect(monthBalance(data, 5)).toBe('700.00');
  });

  it('nets transfers between tracked accounts in the all-accounts view', async () => {
    const all = await accounts();
    const data = await buildYearlySummary({ year: 2026, preferredCurrency: 'EUR', accounts: all });

    expect(data.totals.startingBalance).toBe('1000.00');
    expect(monthBalance(data, 3)).toBe('2200.00'); // unchanged by main -> savings
    expect(monthBalance(data, 5)).toBe('2160.00');
    expect(monthBalance(data, 7)).toBe('1860.00'); // money left Koinkat
    expect(monthBalance(data, 12)).toBe('1860.00');
  });

  it('accounts for movements in later years', async () => {
    await row('next-year', { account: 'main', type: 'expense', amount: '100.00', date: '2027-02-01' });
    await db.execute("UPDATE accounts SET current_balance = '1060.00' WHERE id = 'main'");
    const all = await accounts();

    const y2026 = await buildYearlySummary({
      year: 2026, accountId: 'main', preferredCurrency: 'EUR', accounts: all,
    });
    const y2027 = await buildYearlySummary({
      year: 2027, accountId: 'main', preferredCurrency: 'EUR', accounts: all,
    });

    expect(y2026.totals.startingBalance).toBe('1000.00');
    expect(monthBalance(y2026, 12)).toBe('1160.00');
    expect(y2027.totals.startingBalance).toBe('1160.00');
    expect(monthBalance(y2027, 2)).toBe('1060.00');
  });
});

describe('the rule matches the balances transaction-service writes', () => {
  it('rebuilds the opening balance after real creates, a transfer and a delete', async () => {
    const txs = await import('./transaction-service');
    await account('a1', '1000.00');
    await account('a2', '0.00');

    await txs.createTransaction({ type: 'income', accountId: 'a1', amount: '500.00', currency: 'EUR', date: '2026-02-01' });
    const coffee = await txs.createTransaction({
      type: 'expense', accountId: 'a1', amount: '4.50', currency: 'EUR', date: '2026-02-03',
    });
    await txs.createTransaction({ type: 'expense', accountId: 'a1', amount: '200.00', currency: 'EUR', date: '2026-03-01' });
    await txs.createTransfer({
      sourceAccountId: 'a1', destAccountId: 'a2', amount: '150.00', currency: 'EUR', date: '2026-03-15',
    });
    await txs.deleteTransaction(coffee.id);

    const all = await accounts();
    const a1 = await buildYearlySummary({ year: 2026, accountId: 'a1', preferredCurrency: 'EUR', accounts: all });
    const a2 = await buildYearlySummary({ year: 2026, accountId: 'a2', preferredCurrency: 'EUR', accounts: all });

    expect(a1.totals.currentBalance).toBe('1150.00');
    expect(a1.totals.startingBalance).toBe('1000.00');
    expect(monthBalance(a1, 12)).toBe('1150.00');
    expect(a2.totals.startingBalance).toBe('0.00');
    expect(monthBalance(a2, 3)).toBe('150.00');
  });
});
