/**
 * Item F regression: re-authorizing a bank must reuse the existing local
 * account, not create a second one.
 *
 * The audit's reproduction: `external_account_uid` identifies an account
 * within ONE authorization session. Every user re-authorizes when a 90-day
 * consent lapses, which issues new uids, so the re-link lookup found
 * nothing and created a duplicate account - showing the balance twice.
 * Enable Banking does return a stable `identification_hash`, but both
 * adapters were dropping it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestDb, type Harness } from '../test/sqlite-harness';

const WS = 'ws-1';

let db: Harness;

vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));

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
  getRatesForDate: vi.fn(async () => ({ eur: '1' })),
  getLatestCachedRates: vi.fn(async () => ({ eur: '1' })),
}));

vi.mock('./api-config-service', () => ({
  loadApiConfig: vi.fn(async () => ({ environment: 'sandbox' })),
}));

vi.mock('./categorization-service', () => ({
  categorizer: { categorizeBatch: vi.fn(async () => undefined) },
}));
vi.mock('./recurring-service', () => ({
  applyRecurringMatchOnImport: vi.fn(async () => undefined),
}));
vi.mock('./budget-service', () => ({
  applyAutoCaptureForTransaction: vi.fn(async () => undefined),
}));

vi.mock('./enable-banking-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./enable-banking-service')>();
  return {
    ...actual,
    createSession: vi.fn(),
    getBalances: vi.fn(async () => []),
    getTransactions: vi.fn(async () => ({ transactions: [], continuationKey: undefined })),
  };
});

import { handleAuthCallback } from './bank-sync-service';
import * as ebService from './enable-banking-service';

const createSession = vi.mocked(ebService.createSession);

const IBAN = 'IT60X0542811101000000123456';
const HASH = 'stable-hash-aaa';

/** Queue a pending connection the way the auth flow does. */
async function pendingConnection(authId: string) {
  await db.execute(
    `INSERT INTO bank_connections
       (id, koinkat_account_id, aspsp_name, aspsp_country, authorization_id, status)
     VALUES (?, ?, 'TestBank', 'IT', ?, 'pending')`,
    [`conn-${authId}`, WS, authId],
  );
}

function session(sessionId: string, uid: string, opts: { hash?: string; iban?: string } = {}) {
  return {
    sessionId,
    accounts: [
      {
        uid,
        iban: opts.iban ?? IBAN,
        currency: 'EUR',
        name: 'Current Account',
        identificationHash: opts.hash,
      },
    ],
  };
}

const accountCount = async () => {
  const [r] = await db.select<{ c: number }[]>(
    'SELECT COUNT(*) AS c FROM accounts WHERE koinkat_account_id = ?',
    [WS],
  );
  return r.c;
};

const linkCount = async () => {
  const [r] = await db.select<{ c: number }[]>(
    'SELECT COUNT(*) AS c FROM linked_accounts WHERE koinkat_account_id = ?',
    [WS],
  );
  return r.c;
};

beforeEach(async () => {
  db = createTestDb();
  createSession.mockReset();
  vi.clearAllMocks();
});

afterEach(() => db.close());

describe('re-authorization reuses the existing local account', () => {
  it('a new session uid with the same identification hash does not duplicate', async () => {
    await pendingConnection('auth-1');
    createSession.mockResolvedValueOnce(session('sess-1', 'uid-session-1', { hash: HASH }));
    await handleAuthCallback('auth-1', 'code-1');

    expect(await accountCount()).toBe(1);

    // Consent lapses; the user re-authorizes. New session, NEW uid, same
    // underlying account - which is exactly what the provider's stable
    // hash is for.
    await pendingConnection('auth-2');
    createSession.mockResolvedValueOnce(session('sess-2', 'uid-session-2', { hash: HASH }));
    await handleAuthCallback('auth-2', 'code-2');

    expect(await accountCount()).toBe(1);
    expect(await linkCount()).toBe(1);
  });

  it('keeps the transaction history on the reused account', async () => {
    await pendingConnection('auth-1');
    createSession.mockResolvedValueOnce(session('sess-1', 'uid-session-1', { hash: HASH }));
    await handleAuthCallback('auth-1', 'code-1');

    const [acct] = await db.select<{ id: string }[]>(
      'SELECT id FROM accounts WHERE koinkat_account_id = ?',
      [WS],
    );
    await db.execute(
      `INSERT INTO transactions
         (id, koinkat_account_id, account_id, type, amount, currency,
          exchange_rate, amount_in_account_ccy, date, status)
       VALUES ('t1', ?, ?, 'expense', '10.00', 'EUR', '1.000000000000', '10.00', '2026-03-10', 'booked')`,
      [WS, acct.id],
    );

    await pendingConnection('auth-2');
    createSession.mockResolvedValueOnce(session('sess-2', 'uid-session-2', { hash: HASH }));
    await handleAuthCallback('auth-2', 'code-2');

    const rows = await db.select<{ account_id: string }[]>(
      'SELECT account_id FROM transactions WHERE koinkat_account_id = ?',
      [WS],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].account_id).toBe(acct.id);
  });

  it('adopts the new session uid on the reused link', async () => {
    await pendingConnection('auth-1');
    createSession.mockResolvedValueOnce(session('sess-1', 'uid-session-1', { hash: HASH }));
    await handleAuthCallback('auth-1', 'code-1');

    await pendingConnection('auth-2');
    createSession.mockResolvedValueOnce(session('sess-2', 'uid-session-2', { hash: HASH }));
    await handleAuthCallback('auth-2', 'code-2');

    const [link] = await db.select<{ external_account_uid: string; identification_hash: string }[]>(
      'SELECT external_account_uid, identification_hash FROM linked_accounts WHERE koinkat_account_id = ?',
      [WS],
    );
    expect(link.external_account_uid).toBe('uid-session-2');
    expect(link.identification_hash).toBe(HASH);
  });

  it('falls back to IBAN for a legacy link with no stored hash', async () => {
    // A link created before migration v14: no identification_hash.
    await pendingConnection('auth-1');
    createSession.mockResolvedValueOnce(session('sess-1', 'uid-old'));
    await handleAuthCallback('auth-1', 'code-1');

    const [link] = await db.select<{ identification_hash: string | null }[]>(
      'SELECT identification_hash FROM linked_accounts WHERE koinkat_account_id = ?',
      [WS],
    );
    expect(link.identification_hash).toBeNull();

    // Re-auth with a new uid AND now a hash. The IBAN fallback recognises it.
    await pendingConnection('auth-2');
    createSession.mockResolvedValueOnce(session('sess-2', 'uid-new', { hash: HASH }));
    await handleAuthCallback('auth-2', 'code-2');

    expect(await accountCount()).toBe(1);
  });

  it('matches an IBAN that differs only by spacing and case', async () => {
    await pendingConnection('auth-1');
    createSession.mockResolvedValueOnce(session('sess-1', 'uid-old', { iban: IBAN }));
    await handleAuthCallback('auth-1', 'code-1');

    await pendingConnection('auth-2');
    createSession.mockResolvedValueOnce(
      session('sess-2', 'uid-new', { iban: 'it60 X054 2811 1010 0000 0123 456' }),
    );
    await handleAuthCallback('auth-2', 'code-2');

    expect(await accountCount()).toBe(1);
  });
});

describe('distinct accounts stay distinct', () => {
  it('two different IBANs create two accounts', async () => {
    await pendingConnection('auth-1');
    createSession.mockResolvedValueOnce({
      sessionId: 'sess-1',
      accounts: [
        { uid: 'uid-a', iban: IBAN, currency: 'EUR', name: 'Current', identificationHash: 'hash-a' },
        {
          uid: 'uid-b',
          iban: 'DE89370400440532013000',
          currency: 'EUR',
          name: 'Savings',
          identificationHash: 'hash-b',
        },
      ],
    });
    await handleAuthCallback('auth-1', 'code-1');

    expect(await accountCount()).toBe(2);
  });

  it('does not merge the same IBAN held in two currencies', async () => {
    await pendingConnection('auth-1');
    createSession.mockResolvedValueOnce({
      sessionId: 'sess-1',
      accounts: [
        { uid: 'uid-eur', iban: IBAN, currency: 'EUR', name: 'EUR pocket' },
        { uid: 'uid-usd', iban: IBAN, currency: 'USD', name: 'USD pocket' },
      ],
    });
    await handleAuthCallback('auth-1', 'code-1');

    expect(await accountCount()).toBe(2);
  });
});
