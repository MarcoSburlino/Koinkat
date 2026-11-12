import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, type Harness } from '../test/sqlite-harness';

let db: Harness;
vi.mock('../lib/build-profile', () => ({ IS_DEMO_APP: true }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../db/database', () => ({
  getDb: vi.fn(async () => db),
  withTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => db.transaction(fn as never)),
}));
vi.mock('../lib/active-koinkat-account', () => ({
  requireActiveKoinkatAccountId: () => 'demo-workspace',
}));

import { invoke } from '@tauri-apps/api/core';
import { createKoinkatAccount } from './koinkat-account-service';
import { saveCredentials } from './api-config-service';

beforeEach(() => { db = createTestDb(); vi.clearAllMocks(); });
afterEach(() => db.close());

describe('Demo workspace writes', () => {
  it('rejects production workspace creation before writing any rows', async () => {
    await expect(createKoinkatAccount({
      userId: 'fictional-user', name: 'Demo', connectionType: 'linked',
      preferredCurrency: 'DKK', decimalSeparator: ',', theme: 'dark',
    })).rejects.toThrow(/Sandbox workspace/);
    expect(await db.select('SELECT * FROM koinkat_accounts')).toEqual([]);
    expect(await db.select('SELECT * FROM api_configs')).toEqual([]);
  });

  it('rejects production credential saves before touching keychain or database', async () => {
    await expect(saveCredentials({
      appId: 'synthetic-id', privateKeyPem: 'synthetic-key',
      environment: 'production', redirectUrl: 'https://example.test/',
    })).rejects.toThrow(/only.*sandbox/);
    expect(invoke).not.toHaveBeenCalled();
    expect(await db.select('SELECT * FROM api_configs')).toEqual([]);
  });

  it('creates sandbox workspaces with sandbox API configuration', async () => {
    const workspace = await createKoinkatAccount({
      userId: 'fictional-user', name: 'Demo', connectionType: 'sandbox',
      preferredCurrency: 'DKK', decimalSeparator: ',', theme: 'dark',
    });
    const rows = await db.select<{ environment: string }[]>(
      'SELECT environment FROM api_configs WHERE koinkat_account_id = ?', [workspace.id],
    );
    expect(workspace.connectionType).toBe('sandbox');
    expect(rows).toEqual([{ environment: 'sandbox' }]);
  });
});
