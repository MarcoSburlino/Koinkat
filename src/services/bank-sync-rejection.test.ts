import { describe, it, expect, vi } from 'vitest';

// bank-sync-service transitively imports Tauri's SQL + HTTP plugins and
// localStorage-backed helpers. Stub the native/IO edges so importing the
// module (just to reach the pure `isPendingFetchRejection` predicate) works
// in a vanilla Node + vitest env. We deliberately do NOT mock
// `./enable-banking-service` so the REAL EBApiError class is shared between
// the predicate and the instances we build here (instanceof must match).
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));
vi.mock('../db/database', () => ({
  getDb: vi.fn(),
  withTransaction: vi.fn(),
}));
vi.mock('../lib/active-koinkat-account', () => ({
  requireActiveKoinkatAccountId: vi.fn(() => 'ws-1'),
  getActiveKoinkatAccountId: vi.fn(() => 'ws-1'),
}));

// Imports must come AFTER the vi.mock calls.
import { isPendingFetchRejection } from './bank-sync-service';
import { EBApiError } from './enable-banking-service';

describe('isPendingFetchRejection', () => {
  it('treats an ASPSP_ERROR envelope as a recoverable rejection', () => {
    expect(
      isPendingFetchRejection(
        new EBApiError(400, '{"error":"ASPSP_ERROR","message":"x"}'),
      ),
    ).toBe(true);
  });

  it('treats a bare 400 / 422 as a rejection (filter not supported)', () => {
    expect(isPendingFetchRejection(new EBApiError(400, 'bad request'))).toBe(true);
    expect(isPendingFetchRejection(new EBApiError(422, 'unprocessable'))).toBe(true);
  });

  it('does NOT swallow auth / session / server failures (must hard-fail)', () => {
    expect(isPendingFetchRejection(new EBApiError(401, '{"error":"UNAUTHORIZED"}'))).toBe(false);
    expect(isPendingFetchRejection(new EBApiError(403, '{"error":"FORBIDDEN"}'))).toBe(false);
    expect(isPendingFetchRejection(new EBApiError(404, '{"error":"NOT_FOUND"}'))).toBe(false);
    expect(isPendingFetchRejection(new EBApiError(500, '{"error":"SERVER"}'))).toBe(false);
  });

  it('ignores non-EBApiError errors', () => {
    expect(isPendingFetchRejection(new Error('boom'))).toBe(false);
    expect(isPendingFetchRejection(null)).toBe(false);
    expect(isPendingFetchRejection('400')).toBe(false);
  });
});
