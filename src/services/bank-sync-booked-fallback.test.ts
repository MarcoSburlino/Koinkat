import { describe, it, expect, vi, beforeEach } from 'vitest';

// Same stubbing rationale as bank-sync-rejection.test.ts: cut the native/IO
// edges so the module loads in a vanilla Node + vitest env. The dispatcher
// module is PARTIALLY mocked - getTransactions becomes a vi.fn we script per
// test, while everything else (crucially the EBApiError class, so instanceof
// checks inside the code under test see the same class we construct here)
// stays real.
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));
vi.mock('../db/database', () => ({
  getDb: vi.fn(),
  withTransaction: vi.fn(),
}));
vi.mock('../lib/active-koinkat-account', () => ({
  requireActiveKoinkatAccountId: vi.fn(() => 'ws-1'),
  getActiveKoinkatAccountId: vi.fn(() => 'ws-1'),
}));
vi.mock('./enable-banking-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./enable-banking-service')>();
  return { ...actual, getTransactions: vi.fn() };
});

// Imports must come AFTER the vi.mock calls.
import { fetchBookedResilient } from './bank-sync-service';
import * as ebService from './enable-banking-service';
import { EBApiError, EBRateLimitError } from './enable-banking-service';

const getTransactions = vi.mocked(ebService.getTransactions);

const ASPSP_REJECTION = new EBApiError(
  400,
  '{"code":400,"message":"Error interacting with ASPSP","detail":"Unknown error","error":"ASPSP_ERROR"}',
);

function txn(status: string, ref: string) {
  // Only `status` matters to the fallback's PDNG filter; the rest of the
  // shape is opaque to fetchBookedResilient and passed through untouched.
  return { status, entryReference: ref } as unknown as Awaited<
    ReturnType<typeof ebService.getTransactions>
  >['transactions'][number];
}

beforeEach(() => {
  getTransactions.mockReset();
});

describe('fetchBookedResilient', () => {
  it('falls back to an unfiltered fetch when the ASPSP rejects the BOOK filter', async () => {
    // First (filtered) call rejects - the exact production incident: the
    // pending path recovered, then the booked fetch died on the same error.
    getTransactions
      .mockRejectedValueOnce(ASPSP_REJECTION)
      .mockResolvedValueOnce({
        transactions: [txn('BOOK', 'a'), txn('PDNG', 'b'), txn('BOOK', 'c')],
        continuationKey: undefined,
      });

    const page = await fetchBookedResilient('uid-1', '2026-01-01', '2026-06-10');

    expect(page.rateLimited).toBe(false);
    // Pending entries returned inline by the unfiltered form are dropped -
    // they belong to the pending path.
    expect(page.transactions.map((t) => t.entryReference)).toEqual(['a', 'c']);
    // Second call must be the UNFILTERED form.
    expect(getTransactions).toHaveBeenCalledTimes(2);
    expect(getTransactions.mock.calls[1][1]).not.toHaveProperty(
      'transactionStatus',
      expect.anything(),
    );
    expect(getTransactions.mock.calls[1][1]?.transactionStatus).toBeUndefined();
  });

  it('paginates the unfiltered fallback (booked windows can span months)', async () => {
    getTransactions
      .mockRejectedValueOnce(ASPSP_REJECTION)
      .mockResolvedValueOnce({
        transactions: [txn('BOOK', 'p1')],
        continuationKey: 'next',
      })
      .mockResolvedValueOnce({
        transactions: [txn('BOOK', 'p2')],
        continuationKey: undefined,
      });

    const page = await fetchBookedResilient('uid-1', '2026-01-01', '2026-06-10');
    expect(page.transactions.map((t) => t.entryReference)).toEqual(['p1', 'p2']);
    expect(getTransactions).toHaveBeenCalledTimes(3);
  });

  it('skips the doomed filtered attempt when the pending fetch already saw the rejection', async () => {
    getTransactions.mockResolvedValueOnce({
      transactions: [txn('BOOK', 'a')],
      continuationKey: undefined,
    });

    const page = await fetchBookedResilient('uid-1', '2026-01-01', '2026-06-10', {
      statusFilterRejected: true,
    });

    // Exactly ONE call, and it must be unfiltered - the filtered form would
    // waste one request of the ~4/account/day PSD2 budget on a known 400.
    expect(getTransactions).toHaveBeenCalledTimes(1);
    expect(getTransactions.mock.calls[0][1]?.transactionStatus).toBeUndefined();
    expect(page.transactions).toHaveLength(1);
  });

  it('flags the set incomplete when the rate limit hits during the fallback', async () => {
    getTransactions
      .mockRejectedValueOnce(ASPSP_REJECTION)
      .mockRejectedValueOnce(new EBRateLimitError('daily budget spent'));

    const page = await fetchBookedResilient('uid-1', '2026-01-01', '2026-06-10');
    expect(page.rateLimited).toBe(true);
    expect(page.transactions).toEqual([]);
  });

  it('hard-fails on auth/session/server errors (no fallback that would mask them)', async () => {
    getTransactions.mockRejectedValueOnce(
      new EBApiError(401, '{"error":"UNAUTHORIZED"}'),
    );
    await expect(
      fetchBookedResilient('uid-1', '2026-01-01', '2026-06-10'),
    ).rejects.toBeInstanceOf(EBApiError);
    expect(getTransactions).toHaveBeenCalledTimes(1);
  });
});
