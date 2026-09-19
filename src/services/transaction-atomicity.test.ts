/**
 * Item A regression: balance-dependent reads must happen inside the
 * transaction that writes the result.
 *
 * The audit's reproduction: two concurrent expenses of 10 against a balance
 * of 100 left 90 instead of 80. `createTransaction` read the account before
 * opening its transaction and then wrote an ABSOLUTE balance derived from
 * that stale read, so the second write silently discarded the first.
 *
 * The FX await between the read and the write is what widened the window in
 * practice, so the fixture below keeps a rate lookup on the path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestDb, type Harness } from '../test/sqlite-harness';

const WS = 'ws-1';
const RATES = { usd: '1', eur: '0.9215' };

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
  // Yield to the microtask queue so concurrent callers genuinely interleave
  // here, the way a real network-backed rate lookup does.
  getRatesForDate: vi.fn(async () => {
    await new Promise((r) => setTimeout(r, 0));
    return RATES;
  }),
  getLatestCachedRates: vi.fn(async () => RATES),
}));

vi.mock('./budget-service', () => ({
  applyAutoCaptureForTransaction: vi.fn(async () => undefined),
}));

async function makeAccount(id: string, currency: string, balance: string) {
  await db.execute(
    `INSERT INTO accounts (id, koinkat_account_id, name, currency, current_balance, is_manual)
     VALUES (?, ?, ?, ?, ?, 1)`,
    [id, WS, `Acct ${id}`, currency, balance],
  );
}

const balanceOf = async (id: string) => {
  const [a] = await db.select<{ current_balance: string }[]>(
    'SELECT current_balance FROM accounts WHERE id = ?',
    [id],
  );
  return a.current_balance;
};

beforeEach(async () => {
  db = createTestDb();
  vi.clearAllMocks();
});

afterEach(() => db.close());

describe('concurrent mutations do not lose updates', () => {
  it('two simultaneous expenses of 10 from 100 leave 80', async () => {
    const { createTransaction } = await import('./transaction-service');
    await makeAccount('a1', 'USD', '100.00');

    await Promise.all([
      createTransaction({
        type: 'expense',
        accountId: 'a1',
        amount: '10.00',
        currency: 'USD',
        date: '2026-03-10',
      }),
      createTransaction({
        type: 'expense',
        accountId: 'a1',
        amount: '10.00',
        currency: 'USD',
        date: '2026-03-10',
      }),
    ]);

    expect(await balanceOf('a1')).toBe('80.00');
  });

  it('creates both records, not just one', async () => {
    const { createTransaction } = await import('./transaction-service');
    await makeAccount('a1', 'USD', '100.00');

    await Promise.all([
      createTransaction({ type: 'expense', accountId: 'a1', amount: '10.00', currency: 'USD', date: '2026-03-10' }),
      createTransaction({ type: 'expense', accountId: 'a1', amount: '10.00', currency: 'USD', date: '2026-03-10' }),
    ]);

    const rows = await db.select<{ c: number }[]>(
      'SELECT COUNT(*) AS c FROM transactions WHERE koinkat_account_id = ?',
      [WS],
    );
    expect(rows[0].c).toBe(2);
  });

  it('holds under a larger burst (five expenses of 10 from 100 leave 50)', async () => {
    const { createTransaction } = await import('./transaction-service');
    await makeAccount('a1', 'USD', '100.00');

    await Promise.all(
      Array.from({ length: 5 }, () =>
        createTransaction({ type: 'expense', accountId: 'a1', amount: '10.00', currency: 'USD', date: '2026-03-10' }),
      ),
    );

    expect(await balanceOf('a1')).toBe('50.00');
  });

  it('nets mixed concurrent income and expense correctly', async () => {
    const { createTransaction } = await import('./transaction-service');
    await makeAccount('a1', 'USD', '100.00');

    await Promise.all([
      createTransaction({ type: 'expense', accountId: 'a1', amount: '30.00', currency: 'USD', date: '2026-03-10' }),
      createTransaction({ type: 'income', accountId: 'a1', amount: '50.00', currency: 'USD', date: '2026-03-10' }),
    ]);

    expect(await balanceOf('a1')).toBe('120.00');
  });

  it('keeps concurrent transfers consistent on both accounts', async () => {
    const { createTransfer } = await import('./transaction-service');
    await makeAccount('src', 'USD', '100.00');
    await makeAccount('dst', 'USD', '0.00');

    await Promise.all([
      createTransfer({ sourceAccountId: 'src', destAccountId: 'dst', amount: '10.00', currency: 'USD', date: '2026-03-10' }),
      createTransfer({ sourceAccountId: 'src', destAccountId: 'dst', amount: '10.00', currency: 'USD', date: '2026-03-10' }),
    ]);

    expect(await balanceOf('src')).toBe('80.00');
    expect(await balanceOf('dst')).toBe('20.00');
  });
});

describe('failure inside a transaction commits nothing', () => {
  it('rolls the balance back when the insert fails', async () => {
    const { createTransaction } = await import('./transaction-service');
    await makeAccount('a1', 'USD', '100.00');

    // A category id that violates the FK forces a failure AFTER the balance
    // update has already been issued inside the transaction.
    await expect(
      createTransaction({
        type: 'expense',
        accountId: 'a1',
        amount: '10.00',
        currency: 'USD',
        date: '2026-03-10',
        categoryId: 'does-not-exist',
      }),
    ).rejects.toThrow();

    expect(await balanceOf('a1')).toBe('100.00');
    const rows = await db.select<{ c: number }[]>(
      'SELECT COUNT(*) AS c FROM transactions WHERE koinkat_account_id = ?',
      [WS],
    );
    expect(rows[0].c).toBe(0);
  });
});
