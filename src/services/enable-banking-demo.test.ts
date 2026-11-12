import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/build-profile', () => ({ IS_DEMO_APP: true }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));
vi.mock('./api-config-service', () => ({ loadApiConfig: vi.fn() }));
vi.mock('../lib/active-koinkat-account', () => ({ captureWorkspace: vi.fn() }));
vi.mock('jose', () => ({
  importPKCS8: vi.fn(async () => ({})),
  SignJWT: class {
    setProtectedHeader() { return this; }
    setIssuer() { return this; }
    setAudience() { return this; }
    setIssuedAt() { return this; }
    setExpirationTime() { return this; }
    async sign() { return 'synthetic-test-jwt'; }
  },
}));

import { fetch } from '@tauri-apps/plugin-http';
import { loadApiConfig } from './api-config-service';
import { captureWorkspace } from '../lib/active-koinkat-account';
import { markCredentialsChanged } from '../lib/credential-revision';
import {
  listBanks, startAuthorization, createSession, getBalances,
  getTransactions, getSessionStatus, deleteSession, verifyCredentials,
} from './enable-banking-service-real';

const http = vi.mocked(fetch);
const load = vi.mocked(loadApiConfig);
const assertUnchanged = vi.fn();
const metadata = (environment: unknown = 'SANDBOX') => ({
  environment, kid: 'test-app', active: true,
});
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

beforeEach(() => {
  vi.resetAllMocks();
  markCredentialsChanged();
  vi.mocked(captureWorkspace).mockReturnValue({ id: 'demo-workspace', assertUnchanged });
  load.mockResolvedValue({
    appId: 'test-app', privateKeyPem: 'synthetic-key', environment: 'sandbox',
    redirectUrl: 'https://example.test/?app=demo', isConfigured: true, isDemoMode: true,
  });
});

describe('Demo provider environment enforcement', () => {
  const operations = [
    ['bank list', () => listBanks('DK')],
    ['authorization', () => startAuthorization({ bankName: 'Mock ASPSP', bankCountry: 'DK', redirectUrl: 'https://example.test/' })],
    ['session creation', () => createSession('auth', 'code')],
    ['balances', () => getBalances('account')],
    ['transactions', () => getTransactions('account')],
    ['session status', () => getSessionStatus('session')],
    ['session deletion', () => deleteSession('session')],
  ] as const;

  it.each(operations)('blocks %s with production credentials even if locally labelled sandbox', async (_label, operation) => {
    http.mockResolvedValue(response(metadata('PRODUCTION')));
    await expect(operation()).rejects.toThrow(/Sandbox application/);
    expect(http).toHaveBeenCalledTimes(1);
    expect(http.mock.calls[0][0]).toBe('https://api.enablebanking.com/application');
  });

  it.each([{}, null, metadata(null), metadata('sandbox'), { ...metadata(), active: false },
    { ...metadata(), kid: 'other-app' }])('fails closed on invalid metadata %j', async (data) => {
    http.mockResolvedValue(response(data));
    await expect(listBanks('DK')).rejects.toThrow(/Sandbox application/);
    expect(http).toHaveBeenCalledTimes(1);
  });

  it('does not call bank endpoints when metadata verification fails', async () => {
    http.mockResolvedValue(response({ error: 'FORBIDDEN' }, 403));
    expect(await verifyCredentials()).toContain('rejected');
    expect(http).toHaveBeenCalledTimes(1);
  });

  it('allows verified sandbox requests and caches verification across pages', async () => {
    http.mockResolvedValueOnce(response(metadata()))
      .mockResolvedValueOnce(response({ aspsps: [{ name: 'Mock ASPSP', country: 'DK' }] }))
      .mockResolvedValueOnce(response({ aspsps: [] }));
    expect(await listBanks('DK')).toHaveLength(1);
    expect(await listBanks('IT')).toEqual([]);
    expect(http.mock.calls.map(([url]) => new URL(String(url)).pathname))
      .toEqual(['/application', '/aspsps', '/aspsps']);
  });

  it('re-verifies after saving even the same credentials', async () => {
    http.mockResolvedValueOnce(response(metadata())).mockResolvedValueOnce(response({ aspsps: [] }));
    await listBanks('DK');
    markCredentialsChanged();
    http.mockResolvedValueOnce(response(metadata('PRODUCTION')));
    await expect(listBanks('DK')).rejects.toThrow(/Sandbox application/);
    expect(http).toHaveBeenCalledTimes(3);
  });

  it('does not cache a failed verification', async () => {
    http.mockResolvedValueOnce(response(metadata('PRODUCTION')));
    await expect(listBanks('DK')).rejects.toThrow();
    http.mockResolvedValueOnce(response(metadata())).mockResolvedValueOnce(response({ aspsps: [] }));
    await expect(listBanks('DK')).resolves.toEqual([]);
  });

  it('cancels before bank access if credentials change during metadata verification', async () => {
    http.mockImplementationOnce(async () => {
      markCredentialsChanged();
      return response(metadata());
    });
    await expect(listBanks('DK')).rejects.toThrow(/credentials changed/);
    expect(http).toHaveBeenCalledTimes(1);
  });

  it('cancels before bank access if workspace changes during verification', async () => {
    http.mockImplementationOnce(async () => {
      assertUnchanged.mockImplementation(() => { throw new Error('Workspace changed'); });
      return response(metadata());
    });
    await expect(listBanks('DK')).rejects.toThrow(/Workspace changed/);
    expect(http).toHaveBeenCalledTimes(1);
  });

  it('re-verifies when the active workspace changes', async () => {
    http.mockResolvedValueOnce(response(metadata())).mockResolvedValueOnce(response({ aspsps: [] }));
    await listBanks('DK');
    vi.mocked(captureWorkspace).mockReturnValue({ id: 'second-demo', assertUnchanged });
    http.mockResolvedValueOnce(response(metadata('PRODUCTION')));
    await expect(listBanks('DK')).rejects.toThrow(/Sandbox application/);
  });

  it('rejects a locally production-labelled config without making any HTTP request', async () => {
    load.mockResolvedValue({ ...await load(), environment: 'production' });
    await expect(listBanks('DK')).rejects.toThrow(/only.*sandbox/);
    expect(http).not.toHaveBeenCalled();
  });
});
