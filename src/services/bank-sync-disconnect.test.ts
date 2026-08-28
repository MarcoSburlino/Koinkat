import { describe, it, expect, vi, beforeEach } from 'vitest';

// Same stubbing approach as bank-sync-rejection.test.ts: bank-sync-service
// transitively imports Tauri's SQL + HTTP plugins, so the native/IO edges are
// stubbed to let the module import under plain Node. Here we additionally mock
// the Enable Banking dispatcher, because `disconnectBank`'s whole contract is
// what it reports when `deleteSession` fails.
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));

// vi.mock factories are hoisted above ordinary const declarations, so the
// shared spies have to be created inside vi.hoisted to exist by the time the
// factories run.
const { selectMock, executeMock, deleteSessionMock } = vi.hoisted(() => ({
  selectMock: vi.fn(),
  executeMock: vi.fn(),
  deleteSessionMock: vi.fn(),
}));

vi.mock('../db/database', () => ({
  getDb: vi.fn(async () => ({ select: selectMock, execute: executeMock })),
  // The real helper hands a transaction object to the callback; the callback
  // only ever calls select/execute, so the same stub pair serves both.
  withTransaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) =>
    fn({ select: selectMock, execute: executeMock }),
  ),
}));
vi.mock('../lib/active-koinkat-account', () => ({
  requireActiveKoinkatAccountId: vi.fn(() => 'ws-1'),
  getActiveKoinkatAccountId: vi.fn(() => 'ws-1'),
}));

vi.mock('./enable-banking-service', async (importOriginal) => {
  // Keep the real error classes so `instanceof` still works elsewhere in the
  // module; override only the network call under test.
  const actual = await importOriginal<typeof import('./enable-banking-service')>();
  return { ...actual, deleteSession: deleteSessionMock };
});

// Imports must come AFTER the vi.mock calls.
import { disconnectBank } from './bank-sync-service';

const CONNECTION = {
  id: 'conn-1',
  koinkat_account_id: 'ws-1',
  session_id: 'sess-1',
  is_demo: 0,
  aspsp_name: 'Test Bank',
};

/**
 * `disconnectBank` reads the connection row first, then (inside the
 * transaction) the linked accounts. Return the connection for the first
 * select and an empty linked-account list for every later one.
 */
function primeSelects() {
  selectMock.mockReset();
  selectMock.mockResolvedValueOnce([CONNECTION]).mockResolvedValue([]);
}

beforeEach(() => {
  executeMock.mockReset().mockResolvedValue(undefined);
  deleteSessionMock.mockReset();
  primeSelects();
});

describe('disconnectBank revocation reporting', () => {
  it('reports success when the Enable Banking session is revoked', async () => {
    deleteSessionMock.mockResolvedValue(undefined);

    const result = await disconnectBank('conn-1');

    expect(deleteSessionMock).toHaveBeenCalledWith('sess-1');
    expect(result.sessionRevoked).toBe(true);
    expect(result.revocationError).toBeUndefined();
  });

  it('reports failure - but still unlinks locally - when EB cannot be reached', async () => {
    deleteSessionMock.mockRejectedValue(new Error('Network request failed'));

    const result = await disconnectBank('conn-1');

    // The user asked to disconnect, so the local teardown must still happen.
    // This is the regression under test: the old code swallowed the error and
    // reported nothing, leaving a possibly-live consent at the bank unmentioned.
    expect(result.sessionRevoked).toBe(false);
    expect(result.revocationError).toBe('Network request failed');

    const deletedConnection = executeMock.mock.calls.some(
      ([sql]) => typeof sql === 'string' && sql.includes('DELETE FROM bank_connections'),
    );
    const deletedLinks = executeMock.mock.calls.some(
      ([sql]) => typeof sql === 'string' && sql.includes('DELETE FROM linked_accounts'),
    );
    expect(deletedConnection).toBe(true);
    expect(deletedLinks).toBe(true);
  });

  it('carries a non-Error rejection through as text', async () => {
    deleteSessionMock.mockRejectedValue('EB exploded');

    const result = await disconnectBank('conn-1');

    expect(result.sessionRevoked).toBe(false);
    expect(result.revocationError).toBe('EB exploded');
  });

  it('does not call Enable Banking for a demo connection', async () => {
    selectMock.mockReset();
    selectMock
      .mockResolvedValueOnce([{ ...CONNECTION, is_demo: 1 }])
      .mockResolvedValue([]);

    const result = await disconnectBank('conn-1');

    expect(deleteSessionMock).not.toHaveBeenCalled();
    expect(result.sessionRevoked).toBe(true);
  });

  it('treats a connection with no session id as nothing to revoke', async () => {
    selectMock.mockReset();
    selectMock
      .mockResolvedValueOnce([{ ...CONNECTION, session_id: null }])
      .mockResolvedValue([]);

    const result = await disconnectBank('conn-1');

    expect(deleteSessionMock).not.toHaveBeenCalled();
    expect(result.sessionRevoked).toBe(true);
  });
});
