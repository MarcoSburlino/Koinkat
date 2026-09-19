/**
 * Item C regression at the service level: a cross-currency transaction must
 * persist a nonzero, precise exchange rate and a correctly converted amount.
 *
 * The audit's reproduction: with USD = 1 and VND = 25000, converting
 * 1,000,000 VND to USD produced 0.00 instead of 40.00, because the cross
 * rate (1/25000 = 0.00004) was quantized to 4 dp - i.e. to zero - before
 * the multiply. The stored rate was written as '0.0000' too, and the DB's
 * `CHECK (exchange_rate > 0)` did not reject it (TEXT vs INTEGER comparison).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestDb, type Harness } from '../test/sqlite-harness';

const WS = 'ws-1';
const RATES = { usd: '1', vnd: '25000', eur: '0.9215' };

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
  getRatesForDate: vi.fn(async () => RATES),
  getLatestCachedRates: vi.fn(async () => RATES),
}));

vi.mock('./budget-service', () => ({
  applyAutoCaptureForTransaction: vi.fn(async () => undefined),
}));

async function makeAccount(id: string, currency: string, balance = '0.00') {
  await db.execute(
    `INSERT INTO accounts (id, koinkat_account_id, name, currency, current_balance, is_manual)
     VALUES (?, ?, ?, ?, ?, 1)`,
    [id, WS, `Acct ${id}`, currency, balance],
  );
}

beforeEach(async () => {
  db = createTestDb();
  vi.clearAllMocks();
});

afterEach(() => db.close());

describe('cross-currency precision on the write path', () => {
  it('converts 1,000,000 VND into a USD account as 40.00, not 0.00', async () => {
    const { createTransaction } = await import('./transaction-service');
    await makeAccount('usd-1', 'USD', '0.00');

    const txn = await createTransaction({
      type: 'expense',
      accountId: 'usd-1',
      amount: '1000000',
      currency: 'VND',
      date: '2026-03-10',
    });

    expect(txn.amountInAccountCcy).toBe('40.00');
  });

  it('persists a nonzero exchange rate for that transaction', async () => {
    const { createTransaction } = await import('./transaction-service');
    await makeAccount('usd-1', 'USD', '0.00');

    await createTransaction({
      type: 'expense',
      accountId: 'usd-1',
      amount: '1000000',
      currency: 'VND',
      date: '2026-03-10',
    });

    const [row] = await db.select<{ exchange_rate: string }[]>(
      'SELECT exchange_rate FROM transactions WHERE koinkat_account_id = ?',
      [WS],
    );
    expect(Number(row.exchange_rate)).toBeGreaterThan(0);
    expect(row.exchange_rate).toBe('0.000040000000');
    // Never exponential - it is going into a TEXT column.
    expect(row.exchange_rate).not.toMatch(/e/i);
  });

  it('moves the account balance by the converted amount', async () => {
    const { createTransaction } = await import('./transaction-service');
    await makeAccount('usd-1', 'USD', '100.00');

    await createTransaction({
      type: 'expense',
      accountId: 'usd-1',
      amount: '1000000',
      currency: 'VND',
      date: '2026-03-10',
    });

    const [acct] = await db.select<{ current_balance: string }[]>(
      'SELECT current_balance FROM accounts WHERE id = ?',
      ['usd-1'],
    );
    expect(acct.current_balance).toBe('60.00');
  });

  it('leaves same-currency transactions at rate 1', async () => {
    const { createTransaction } = await import('./transaction-service');
    await makeAccount('usd-1', 'USD', '100.00');

    await createTransaction({
      type: 'expense',
      accountId: 'usd-1',
      amount: '25.00',
      currency: 'USD',
      date: '2026-03-10',
    });

    const [row] = await db.select<{ exchange_rate: string; amount_in_account_ccy: string }[]>(
      'SELECT exchange_rate, amount_in_account_ccy FROM transactions WHERE koinkat_account_id = ?',
      [WS],
    );
    expect(Number(row.exchange_rate)).toBe(1);
    expect(row.amount_in_account_ccy).toBe('25.00');
  });

  it('stores the real rate for an ordinary pair, not a 4 dp truncation', async () => {
    const { createTransaction } = await import('./transaction-service');
    await makeAccount('eur-1', 'EUR', '0.00');

    await createTransaction({
      type: 'expense',
      accountId: 'eur-1',
      amount: '100.00',
      currency: 'USD',
      date: '2026-03-10',
    });

    const [row] = await db.select<{ exchange_rate: string; amount_in_account_ccy: string }[]>(
      'SELECT exchange_rate, amount_in_account_ccy FROM transactions WHERE koinkat_account_id = ?',
      [WS],
    );
    // 0.9215 / 1 = 0.9215 exactly here, but it must be stored at full
    // precision rather than re-derived from the rounded 92.15.
    expect(row.amount_in_account_ccy).toBe('92.15');
    expect(Number(row.exchange_rate)).toBeCloseTo(0.9215, 10);
  });
});
