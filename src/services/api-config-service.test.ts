import { describe, it, expect, vi, beforeEach } from 'vitest';

// Cut the native edges: the Tauri invoke IPC (keychain commands) and the
// DB layer. requireActiveKoinkatAccountId is stubbed to a fixed workspace.
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../db/database', () => ({
  getDb: vi.fn(),
  withTransaction: vi.fn(),
}));
vi.mock('../lib/active-koinkat-account', () => ({
  requireActiveKoinkatAccountId: vi.fn(() => 'ws-1'),
  getActiveKoinkatAccountId: vi.fn(() => 'ws-1'),
}));

import { invoke } from '@tauri-apps/api/core';
import { getDb } from '../db/database';
import {
  loadApiConfig,
  saveCredentials,
  clearCredentials,
  getPemStorage,
  __resetPemCacheForTests,
} from './api-config-service';

const invokeMock = vi.mocked(invoke);
const getDbMock = vi.mocked(getDb);

const SENTINEL = '__keychain__';
const ACCOUNT = 'eb-pem-ws-1';
const PEM = '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----';

function makeDb() {
  return {
    select: vi.fn(),
    execute: vi.fn().mockResolvedValue({ rowsAffected: 1 }),
  };
}

function configRow(pemColumn: string | null) {
  return {
    koinkat_account_id: 'ws-1',
    app_id: 'app-1',
    private_key_pem: pemColumn,
    environment: 'production',
    redirect_url: 'https://example.test/cb/',
    is_configured: 1,
    is_demo_mode: 0,
  };
}

let db: ReturnType<typeof makeDb>;

beforeEach(() => {
  vi.clearAllMocks();
  __resetPemCacheForTests();
  db = makeDb();
  getDbMock.mockResolvedValue(db as never);
});

describe('saveCredentials', () => {
  it('stores the key in the keychain and only the sentinel in the DB', async () => {
    invokeMock.mockResolvedValue(undefined);

    await saveCredentials({
      appId: 'app-1',
      privateKeyPem: PEM,
      environment: 'production',
      redirectUrl: 'https://example.test/cb/',
    });

    expect(invokeMock).toHaveBeenCalledWith('secret_set', {
      account: ACCOUNT,
      value: PEM,
    });
    const [, params] = db.execute.mock.calls[0];
    expect(params).toContain(SENTINEL);
    expect(params).not.toContain(PEM);
  });

  it('rejects a non-https redirect URL at the service layer', async () => {
    await expect(
      saveCredentials({
        appId: 'app-1',
        privateKeyPem: PEM,
        environment: 'production',
        redirectUrl: 'koinkat://auth-callback',
      }),
    ).rejects.toThrow(/https/);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('falls back to DB storage when the keychain is unavailable', async () => {
    invokeMock.mockRejectedValue(new Error('no secret service'));

    await saveCredentials({
      appId: 'app-1',
      privateKeyPem: PEM,
      environment: 'production',
      redirectUrl: 'https://example.test/cb/',
    });

    // Saving must never fail because of the keychain.
    const [, params] = db.execute.mock.calls[0];
    expect(params).toContain(PEM);
    expect(params).not.toContain(SENTINEL);
  });
});

describe('loadApiConfig', () => {
  it('resolves the real key from the keychain when the row holds the sentinel', async () => {
    db.select.mockResolvedValue([configRow(SENTINEL)]);
    invokeMock.mockResolvedValue(PEM);

    const config = await loadApiConfig();

    expect(invokeMock).toHaveBeenCalledWith('secret_get', { account: ACCOUNT });
    expect(config.privateKeyPem).toBe(PEM);
    // No lazy migration for an already-migrated row.
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('caches the keychain-resolved key for the session (one IPC per workspace)', async () => {
    db.select.mockResolvedValue([configRow(SENTINEL)]);
    invokeMock.mockResolvedValue(PEM);

    await loadApiConfig();
    const second = await loadApiConfig();

    // The EB client reloads the config per API request - the keychain
    // round-trip must not repeat every time.
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(second.privateKeyPem).toBe(PEM);
  });

  it('returns a null key when the keychain entry is gone', async () => {
    db.select.mockResolvedValue([configRow(SENTINEL)]);
    invokeMock.mockResolvedValue(null);

    const config = await loadApiConfig();
    expect(config.privateKeyPem).toBeNull();
  });

  it('lazily migrates a legacy plaintext row into the keychain', async () => {
    db.select.mockResolvedValue([configRow(PEM)]);
    invokeMock.mockResolvedValue(undefined);

    const config = await loadApiConfig();

    expect(invokeMock).toHaveBeenCalledWith('secret_set', {
      account: ACCOUNT,
      value: PEM,
    });
    const [sql, params] = db.execute.mock.calls[0];
    expect(String(sql)).toContain('UPDATE api_configs');
    expect(params).toEqual([SENTINEL, 'ws-1']);
    // The caller still gets the real key, not the sentinel.
    expect(config.privateKeyPem).toBe(PEM);
  });

  it('keeps the plaintext column when migration fails (keychain unavailable)', async () => {
    db.select.mockResolvedValue([configRow(PEM)]);
    invokeMock.mockRejectedValue(new Error('no secret service'));

    const config = await loadApiConfig();

    expect(db.execute).not.toHaveBeenCalled();
    expect(config.privateKeyPem).toBe(PEM);
  });
});

describe('clearCredentials', () => {
  it('deletes the keychain entry and nulls the DB columns', async () => {
    invokeMock.mockResolvedValue(undefined);

    await clearCredentials();

    expect(invokeMock).toHaveBeenCalledWith('secret_delete', { account: ACCOUNT });
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('still clears the DB when the keychain delete throws', async () => {
    invokeMock.mockRejectedValue(new Error('no secret service'));

    await clearCredentials();
    expect(db.execute).toHaveBeenCalledTimes(1);
  });
});

describe('getPemStorage', () => {
  it.each([
    [SENTINEL, 'keychain'],
    [PEM, 'database'],
    [null, 'none'],
  ] as const)('column %j -> %s', async (column, expected) => {
    db.select.mockResolvedValue([{ private_key_pem: column }]);
    expect(await getPemStorage()).toBe(expected);
  });

  it('reports none when no row exists', async () => {
    db.select.mockResolvedValue([]);
    expect(await getPemStorage()).toBe('none');
  });
});
