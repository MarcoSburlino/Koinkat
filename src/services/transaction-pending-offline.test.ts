/**
 * Item D regressions.
 *
 * 1. Pending bank rows are balance-neutral. They are imported without
 *    touching `current_balance` (the bank's reported available balance is
 *    the source of truth), so reversing one must not move it either.
 *    The audit's reproduction: deleting a pending expense of 10 from a bank
 *    balance of 100 left 110.
 *
 * 2. Same-currency work needs no exchange rate. Every mutation used to call
 *    `requireRates` unconditionally, so a fresh offline user could not save
 *    a EUR expense into a EUR account.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestDb, type Harness } from '../test/sqlite-harness';

const WS = 'ws-1';

let db: Harness;
/** Set to true by the mock if anything asks for a rate. */
let ratesRequested = false;
/** When true, the FX cache is empty and the network is down. */
let fxUnavailable = false;

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
  getRatesForDate: vi.fn(async () => {
    ratesRequested = true;
    return fxUnavailable ? null : { usd: '1', eur: '0.9215' };
  }),
  getLatestCachedRates: vi.fn(async () => (fxUnavailable ? null : { usd: '1', eur: '0.9215' })),
}));

vi.mock('./budget-service', () => ({
  applyAutoCaptureForTransaction: vi.fn(async () => undefined),
}));

async function makeAccount(id: string, currency: string, balance: string) {
  await db.execute(
    `INSERT INTO accounts (id, koinkat_account_id, name, currency, current_balance, is_manual)
     VALUES (?, ?, ?, ?, ?, 0)`,
    [id, WS, `Acct ${id}`, currency, balance],
  );
}

async function insertRow(
  id: string,
  type: 'income' | 'expense',
  amount: string,
  status: 'pending' | 'booked',
) {
  await db.execute(
    `INSERT INTO transactions
       (id, koinkat_account_id, account_id, type, amount, currency,
        exchange_rate, amount_in_account_ccy, date, status)
     VALUES (?, ?, 'bank-1', ?, ?, 'EUR', '1.000000000000', ?, '2026-03-10', ?)`,
    [id, WS, type, amount, amount, status],
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
  ratesRequested = false;
  fxUnavailable = false;
  vi.clearAllMocks();
  await makeAccount('bank-1', 'EUR', '100.00');
});

afterEach(() => db.close());

describe('pending bank rows are balance-neutral', () => {
  it('deleting a pending expense leaves the bank balance at 100', async () => {
    const { deleteTransaction } = await import('./transaction-service');
    await insertRow('p1', 'expense', '10.00', 'pending');

    await deleteTransaction('p1');

    expect(await balanceOf('bank-1')).toBe('100.00');
  });

  it('deleting a pending income also leaves it at 100', async () => {
    const { deleteTransaction } = await import('./transaction-service');
    await insertRow('p2', 'income', '10.00', 'pending');

    await deleteTransaction('p2');

    expect(await balanceOf('bank-1')).toBe('100.00');
  });

  it('still reverses a BOOKED expense, which did move the balance', async () => {
    const { deleteTransaction } = await import('./transaction-service');
    await insertRow('b1', 'expense', '10.00', 'booked');

    await deleteTransaction('b1');

    // Booked semantics are unchanged: the row had debited the balance, so
    // removing it credits it back.
    expect(await balanceOf('bank-1')).toBe('110.00');
  });

  it('removes the pending row itself', async () => {
    const { deleteTransaction } = await import('./transaction-service');
    await insertRow('p3', 'expense', '10.00', 'pending');

    await deleteTransaction('p3');

    const rows = await db.select<{ c: number }[]>(
      'SELECT COUNT(*) AS c FROM transactions WHERE id = ?',
      ['p3'],
    );
    expect(rows[0].c).toBe(0);
  });
});

describe('same-currency work needs no exchange rate', () => {
  it('creates a EUR expense in a EUR account without asking for rates', async () => {
    const { createTransaction } = await import('./transaction-service');

    await createTransaction({
      type: 'expense',
      accountId: 'bank-1',
      amount: '10.00',
      currency: 'EUR',
      date: '2026-03-10',
    });

    expect(ratesRequested).toBe(false);
    expect(await balanceOf('bank-1')).toBe('90.00');
  });

  it('succeeds with the network down and an empty FX cache', async () => {
    const { createTransaction } = await import('./transaction-service');
    fxUnavailable = true;

    await expect(
      createTransaction({
        type: 'expense',
        accountId: 'bank-1',
        amount: '10.00',
        currency: 'EUR',
        date: '2026-03-10',
      }),
    ).resolves.toBeTruthy();

    expect(await balanceOf('bank-1')).toBe('90.00');
  });

  it('transfers between two EUR accounts without rates', async () => {
    const { createTransfer } = await import('./transaction-service');
    await makeAccount('eur-2', 'EUR', '0.00');
    fxUnavailable = true;

    await createTransfer({
      sourceAccountId: 'bank-1',
      destAccountId: 'eur-2',
      amount: '25.00',
      currency: 'EUR',
      date: '2026-03-10',
    });

    expect(ratesRequested).toBe(false);
    expect(await balanceOf('bank-1')).toBe('75.00');
    expect(await balanceOf('eur-2')).toBe('25.00');
  });

  it('still demands a rate for a genuinely cross-currency entry', async () => {
    const { createTransaction } = await import('./transaction-service');

    await createTransaction({
      type: 'expense',
      accountId: 'bank-1',
      amount: '10.00',
      currency: 'USD',
      date: '2026-03-10',
    });

    expect(ratesRequested).toBe(true);
  });

  it('fails atomically when a cross-currency entry has no rate', async () => {
    const { createTransaction } = await import('./transaction-service');
    fxUnavailable = true;

    await expect(
      createTransaction({
        type: 'expense',
        accountId: 'bank-1',
        amount: '10.00',
        currency: 'USD',
        date: '2026-03-10',
      }),
    ).rejects.toThrow();

    // Nothing written, balance untouched - never silently rate 1.
    expect(await balanceOf('bank-1')).toBe('100.00');
    const rows = await db.select<{ c: number }[]>(
      'SELECT COUNT(*) AS c FROM transactions',
      [],
    );
    expect(rows[0].c).toBe(0);
  });
});

describe('pending rows accept metadata edits but not structural ones', () => {
  const base = { accountId: 'bank-1', amount: '10.00', currency: 'EUR', date: '2026-03-10' };

  it('allows a note and category change', async () => {
    const { updateIncomeExpense } = await import('./transaction-service');
    await insertRow('p1', 'expense', '10.00', 'pending');

    await expect(
      updateIncomeExpense('p1', { ...base, note: 'groceries' }),
    ).resolves.toBeTruthy();

    expect(await balanceOf('bank-1')).toBe('100.00');
  });

  it('rejects an amount change', async () => {
    const { updateIncomeExpense } = await import('./transaction-service');
    await insertRow('p1', 'expense', '10.00', 'pending');

    await expect(
      updateIncomeExpense('p1', { ...base, amount: '99.00' }),
    ).rejects.toThrow(/amount/);
  });

  it('rejects an account change', async () => {
    const { updateIncomeExpense } = await import('./transaction-service');
    await makeAccount('other', 'EUR', '0.00');
    await insertRow('p1', 'expense', '10.00', 'pending');

    await expect(
      updateIncomeExpense('p1', { ...base, accountId: 'other' }),
    ).rejects.toThrow(/account/);
  });

  it('rejects a date change', async () => {
    const { updateIncomeExpense } = await import('./transaction-service');
    await insertRow('p1', 'expense', '10.00', 'pending');

    await expect(
      updateIncomeExpense('p1', { ...base, date: '2026-04-01' }),
    ).rejects.toThrow(/date/);
  });

  it('writes nothing when a structural edit is rejected', async () => {
    const { updateIncomeExpense } = await import('./transaction-service');
    await insertRow('p1', 'expense', '10.00', 'pending');

    await updateIncomeExpense('p1', { ...base, amount: '99.00' }).catch(() => undefined);

    const [row] = await db.select<{ amount: string }[]>(
      'SELECT amount FROM transactions WHERE id = ?',
      ['p1'],
    );
    expect(row.amount).toBe('10.00');
    expect(await balanceOf('bank-1')).toBe('100.00');
  });

  it('leaves booked rows fully editable', async () => {
    const { updateIncomeExpense } = await import('./transaction-service');
    await insertRow('b1', 'expense', '10.00', 'booked');

    await expect(
      updateIncomeExpense('b1', { ...base, amount: '25.00' }),
    ).resolves.toBeTruthy();

    // 100 + 10 (reversal) - 25 (new) = 85
    expect(await balanceOf('bank-1')).toBe('85.00');
  });
});
