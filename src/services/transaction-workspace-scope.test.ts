/**
 * NOTE: every operation here is deliberately CROSS-currency (EUR into a USD
 * account). Since item D, a same-currency operation skips the rate lookup
 * entirely, so there would be no await to pause on.
 *
 * Item B regression: an operation must not retarget itself when the user
 * switches workspace while it is awaiting.
 *
 * The audit's reproduction: `createTransaction` read the workspace once via
 * `requireAccount`, awaited FX (which can be a network call lasting
 * seconds), then read the mutable global AGAIN to decide which workspace to
 * insert into. Switching workspace during that window produced a
 * transaction in workspace B referencing an account in workspace A.
 *
 * The chosen rule: finish in the original workspace, or cancel before
 * mutating. Never retarget.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestDb, type Harness } from '../test/sqlite-harness';

const WS_A = 'ws-a';
const WS_B = 'ws-b';
const RATES = { usd: '1', eur: '0.9215' };

let db: Harness;
/** The "active workspace", switchable mid-operation like the real global. */
let active = WS_A;
/** Resolves the pending FX fetch, so a test can switch during the await. */
let releaseFx: (() => void) | null = null;

vi.mock('../db/database', () => ({
  getDb: vi.fn(async () => db),
  withTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => db.transaction(fn as never)),
}));

vi.mock('../lib/active-koinkat-account', async () => {
  const actual = await vi.importActual<typeof import('../lib/active-koinkat-account')>(
    '../lib/active-koinkat-account',
  );
  return {
    ...actual,
    requireActiveKoinkatAccountId: () => active,
    getActiveKoinkatAccountId: () => active,
    // The real captureWorkspace, but reading our switchable global.
    captureWorkspace: () => {
      const id = active;
      return {
        id,
        assertUnchanged() {
          if (active !== id) throw new actual.WorkspaceChangedError(id, active);
        },
      };
    },
  };
});

vi.mock('./exchange-rate-service', () => ({
  getRatesForDate: vi.fn(async () => {
    // Park here until the test lets go, simulating a slow rate fetch.
    await new Promise<void>((resolve) => {
      releaseFx = resolve;
    });
    return RATES;
  }),
  getLatestCachedRates: vi.fn(async () => RATES),
}));

vi.mock('./budget-service', () => ({
  applyAutoCaptureForTransaction: vi.fn(async () => undefined),
}));

async function makeAccount(id: string, ws: string, balance: string) {
  await db.execute(
    `INSERT INTO accounts (id, koinkat_account_id, name, currency, current_balance, is_manual)
     VALUES (?, ?, ?, 'USD', ?, 1)`,
    [id, ws, `Acct ${id}`, balance],
  );
}

/** Wait until the mocked FX fetch has actually parked. */
async function untilFxPending() {
  for (let i = 0; i < 50 && !releaseFx; i += 1) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

beforeEach(async () => {
  db = createTestDb();
  active = WS_A;
  releaseFx = null;
  vi.clearAllMocks();
});

afterEach(() => db.close());

describe('workspace switch during an awaited operation', () => {
  it('cancels instead of writing into the newly selected workspace', async () => {
    const { createTransaction } = await import('./transaction-service');
    await makeAccount('a1', WS_A, '100.00');

    const pending = createTransaction({
      type: 'expense',
      accountId: 'a1',
      amount: '10.00',
      currency: 'EUR',
      date: '2026-03-10',
    });

    await untilFxPending();
    active = WS_B; // the user switches workspace mid-flight
    releaseFx!();

    await expect(pending).rejects.toThrow(/Workspace changed/);
  });

  it('writes nothing at all when it cancels', async () => {
    const { createTransaction } = await import('./transaction-service');
    await makeAccount('a1', WS_A, '100.00');

    const pending = createTransaction({
      type: 'expense',
      accountId: 'a1',
      amount: '10.00',
      currency: 'EUR',
      date: '2026-03-10',
    });

    await untilFxPending();
    active = WS_B;
    releaseFx!();
    await pending.catch(() => undefined);

    const rows = await db.select<{ c: number }[]>('SELECT COUNT(*) AS c FROM transactions', []);
    expect(rows[0].c).toBe(0);

    const [acct] = await db.select<{ current_balance: string }[]>(
      'SELECT current_balance FROM accounts WHERE id = ?',
      ['a1'],
    );
    expect(acct.current_balance).toBe('100.00');
  });

  it('completes normally when the workspace does not change', async () => {
    const { createTransaction } = await import('./transaction-service');
    await makeAccount('a1', WS_A, '100.00');

    const pending = createTransaction({
      type: 'expense',
      accountId: 'a1',
      amount: '10.00',
      currency: 'EUR',
      date: '2026-03-10',
    });

    await untilFxPending();
    releaseFx!();
    await pending;

    const rows = await db.select<{ koinkat_account_id: string }[]>(
      'SELECT koinkat_account_id FROM transactions',
      [],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].koinkat_account_id).toBe(WS_A);
  });

  it('cancels a transfer the same way', async () => {
    const { createTransfer } = await import('./transaction-service');
    await makeAccount('src', WS_A, '100.00');
    await makeAccount('dst', WS_A, '0.00');

    const pending = createTransfer({
      sourceAccountId: 'src',
      destAccountId: 'dst',
      amount: '10.00',
      currency: 'EUR',
      date: '2026-03-10',
    });

    await untilFxPending();
    active = WS_B;
    releaseFx!();

    await expect(pending).rejects.toThrow(/Workspace changed/);

    const [src] = await db.select<{ current_balance: string }[]>(
      'SELECT current_balance FROM accounts WHERE id = ?',
      ['src'],
    );
    expect(src.current_balance).toBe('100.00');
  });
});
