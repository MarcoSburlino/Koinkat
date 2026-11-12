/**
 * Per-day spending for the Budgets pace chart.
 *
 * The chart's running total must end EXACTLY at the period total the
 * rest of the page shows, so these tests compare the two on a real
 * SQLite database built from the real migrations, covering every rule
 * the period total applies: non-budgeted rows excluded, transfers and
 * repayments excluded, pending rows excluded, split parents counted at
 * their (possibly negative) net, and event rows folded into the month
 * whatever their own date.
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
  // 1 EUR = 1.25 USD, so 12.50 USD converts to 10.00 EUR.
  getLatestCachedRates: vi.fn(async () => ({ eur: '1', usd: '1.25' })),
  getRatesForDate: vi.fn(async () => ({ eur: '1', usd: '1.25' })),
}));

import {
  createRecurringBudget,
  createBudgetEvent,
  listPeriodsForBudget,
  ensurePeriodsForYear,
  calculatePeriodSpending,
  calculatePeriodDailySpending,
} from './budget-service';

async function seedAccounts() {
  await db.execute(
    `INSERT INTO accounts (id, koinkat_account_id, name, currency, current_balance)
     VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)`,
    ['eur', WS, 'Checking', 'EUR', '1000.00', 'usd', WS, 'Travel', 'USD', '500.00'],
  );
}

async function expense(
  id: string,
  account: 'eur' | 'usd',
  amount: string,
  date: string,
  extra: {
    isBudgeted?: 0 | 1;
    net?: string;
    eventId?: string;
    status?: 'booked' | 'pending';
    transferPair?: string;
  } = {},
) {
  await db.execute(
    `INSERT INTO transactions
       (id, koinkat_account_id, account_id, type, amount, currency,
        exchange_rate, amount_in_account_ccy, net_spent_in_account_ccy,
        date, status, is_budgeted, budget_event_id, transfer_pair_id)
     VALUES (?, ?, ?, 'expense', ?, ?, '1', ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      WS,
      account,
      amount,
      account === 'eur' ? 'EUR' : 'USD',
      amount,
      extra.net ?? null,
      date,
      extra.status ?? 'booked',
      extra.isBudgeted ?? 1,
      extra.eventId ?? null,
      extra.transferPair ?? null,
    ],
  );
}

async function marchPeriodId(): Promise<string> {
  const budget = await createRecurringBudget({
    year: 2026,
    startMonth: 1,
    endMonth: 12,
    rhythm: 'monthly',
    limitAmount: '1000.00',
    currency: 'EUR',
  });
  await ensurePeriodsForYear(budget.id);
  const periods = await listPeriodsForBudget(budget.id);
  const march = periods.find((p) => p.periodStart.startsWith('2026-03'));
  if (!march) throw new Error('no March period');
  return march.id;
}

beforeEach(async () => {
  db = createTestDb();
  await seedAccounts();
  vi.clearAllMocks();
});

afterEach(() => db.close());

describe('calculatePeriodDailySpending', () => {
  it('returns one point per calendar day with a running total', async () => {
    const periodId = await marchPeriodId();
    await expense('a', 'eur', '10.00', '2026-03-02');
    await expense('b', 'eur', '5.50', '2026-03-02');
    await expense('c', 'eur', '20.00', '2026-03-15');

    const daily = await calculatePeriodDailySpending(periodId);

    expect(daily.days).toHaveLength(31);
    expect(daily.days[0]).toEqual({ date: '2026-03-01', spent: '0.00', cumulative: '0.00' });
    expect(daily.days[1]).toEqual({ date: '2026-03-02', spent: '15.50', cumulative: '15.50' });
    expect(daily.days[14]).toEqual({ date: '2026-03-15', spent: '20.00', cumulative: '35.50' });
    expect(daily.days[30].cumulative).toBe('35.50');
    expect(daily.currency).toBe('EUR');
  });

  it('ends exactly at the period total under every inclusion rule', async () => {
    const periodId = await marchPeriodId();
    const event = await createBudgetEvent({
      name: 'Trip',
      limitAmount: '300.00',
      currency: 'EUR',
      sumToBudget: true,
      sumToMonth: '2026-03-01',
    });

    await expense('plain', 'eur', '40.00', '2026-03-03');
    await expense('usd', 'usd', '12.50', '2026-03-04'); // -> 10.00 EUR
    await expense('off-budget', 'eur', '99.00', '2026-03-05', { isBudgeted: 0 });
    await expense('pending', 'eur', '77.00', '2026-03-06', { status: 'pending' });
    await expense('transfer', 'eur', '55.00', '2026-03-07', { transferPair: 'p1' });
    // Over-reimbursed split: gross 100, net -20. The sign must survive.
    await expense('split', 'eur', '100.00', '2026-03-10', { net: '-20.00' });
    // Event rows fold into March whatever their own date.
    await expense('ev-early', 'eur', '30.00', '2026-02-27', { eventId: event.id });
    await expense('ev-late', 'eur', '15.00', '2026-04-02', { eventId: event.id });

    const total = await calculatePeriodSpending(periodId);
    const daily = await calculatePeriodDailySpending(periodId);

    // 40 + 10 - 20 + 30 + 15 = 75
    expect(total.total).toBe('75.00');
    expect(daily.total).toBe(total.total);
    expect(daily.days[daily.days.length - 1].cumulative).toBe(total.total);

    const day = (d: string) => daily.days.find((p) => p.date === d)!;
    expect(day('2026-03-01').spent).toBe('30.00'); // early event row, clamped
    expect(day('2026-03-04').spent).toBe('10.00'); // converted from USD
    expect(day('2026-03-05').spent).toBe('0.00'); // off-budget excluded
    expect(day('2026-03-06').spent).toBe('0.00'); // pending excluded
    expect(day('2026-03-07').spent).toBe('0.00'); // transfer excluded
    expect(day('2026-03-10').spent).toBe('-20.00'); // net, sign kept
    expect(day('2026-03-31').spent).toBe('15.00'); // late event row, clamped
  });

  it('only reads the active workspace', async () => {
    const periodId = await marchPeriodId();
    await db.execute(
      `INSERT INTO accounts (id, koinkat_account_id, name, currency, current_balance)
       VALUES ('other-acct', 'ws-2', 'Other', 'EUR', '0.00')`,
    );
    await db.execute(
      `INSERT INTO transactions
         (id, koinkat_account_id, account_id, type, amount, currency,
          exchange_rate, amount_in_account_ccy, date, status)
       VALUES ('x', 'ws-2', 'other-acct', 'expense', '500.00', 'EUR', '1', '500.00', '2026-03-02', 'booked')`,
    );
    await expense('mine', 'eur', '8.00', '2026-03-02');

    const daily = await calculatePeriodDailySpending(periodId);
    expect(daily.total).toBe('8.00');
  });
});
