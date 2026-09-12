import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks ────────────────────────────────────────────────────
//
// The pointer modules talk to the `app_state` table through
// app-state-service, which needs Tauri's plugin-sql. Swap it for an
// in-memory map so these run in plain Node.

const { appState } = vi.hoisted(() => ({ appState: new Map<string, string>() }));

vi.mock('../services/app-state-service', () => ({
  ACTIVE_USER_KEY: 'active_user_id',
  ACTIVE_KOINKAT_ACCOUNT_KEY: 'active_koinkat_account_id',
  getAppState: vi.fn(async (k: string) => appState.get(k) ?? null),
  setAppState: vi.fn(async (k: string, v: string) => {
    appState.set(k, v);
  }),
  clearAppState: vi.fn(async (k: string) => {
    appState.delete(k);
  }),
}));

/** Node has no DOM, so stand up a minimal localStorage. */
function installLocalStorage(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed));
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
  return store;
}

const USER_MIRROR = 'koinkat_active_user_id';
const WS_MIRROR = 'koinkat_active_koinkat_account_id';
const PROVISIONED = 'koinkat_device_provisioned';

beforeEach(() => {
  appState.clear();
  vi.resetModules();
});

describe('active-user pointer', () => {
  it('adopts a pre-v12 localStorage pointer when app_state is empty', async () => {
    // This is the upgrade path for every existing install: the pointer only
    // exists in localStorage. If hydrate did not adopt it, shipping migration
    // v12 would itself log every user out.
    const store = installLocalStorage({ [USER_MIRROR]: 'user-1' });
    const { hydrateActiveUserId, getActiveUserId } = await import('./active-user');

    expect(await hydrateActiveUserId()).toBe('user-1');
    expect(getActiveUserId()).toBe('user-1');
    // ...and it is promoted into the database so it survives a profile wipe.
    expect(appState.get('active_user_id')).toBe('user-1');
    expect(store.get(PROVISIONED)).toBe('1');
  });

  it('prefers app_state over a stale localStorage mirror', async () => {
    appState.set('active_user_id', 'from-db');
    installLocalStorage({ [USER_MIRROR]: 'stale' });
    const { hydrateActiveUserId } = await import('./active-user');

    expect(await hydrateActiveUserId()).toBe('from-db');
  });

  it('survives a WebView2 profile wipe (app_state only)', async () => {
    // The scenario that motivated the whole change: AppData\Local is gone,
    // the database is not.
    appState.set('active_user_id', 'user-1');
    const store = installLocalStorage();
    const { hydrateActiveUserId, getActiveUserId } = await import('./active-user');

    expect(await hydrateActiveUserId()).toBe('user-1');
    expect(getActiveUserId()).toBe('user-1');
    expect(store.get(USER_MIRROR)).toBe('user-1'); // mirror rebuilt
  });

  it('returns null on a genuinely fresh device', async () => {
    installLocalStorage();
    const { hydrateActiveUserId, getActiveUserId } = await import('./active-user');

    expect(await hydrateActiveUserId()).toBeNull();
    expect(getActiveUserId()).toBeNull();
  });

  it('falls back to the mirror when read before hydration', async () => {
    installLocalStorage({ [USER_MIRROR]: 'user-1' });
    const { getActiveUserId } = await import('./active-user');

    // A spurious null here is what used to send a set-up device to the
    // first-run screen, so the un-hydrated read must not report "logged out".
    expect(getActiveUserId()).toBe('user-1');
  });

  it('writes both stores on set and clears both on clear', async () => {
    const store = installLocalStorage();
    const { setActiveUserId, clearActiveUserId, getActiveUserId } =
      await import('./active-user');

    await setActiveUserId('user-9');
    expect(appState.get('active_user_id')).toBe('user-9');
    expect(store.get(USER_MIRROR)).toBe('user-9');

    await clearActiveUserId();
    expect(appState.has('active_user_id')).toBe(false);
    expect(store.has(USER_MIRROR)).toBe(false);
    expect(getActiveUserId()).toBeNull();
    // The provisioned breadcrumb deliberately OUTLIVES logout.
    expect(store.get(PROVISIONED)).toBe('1');
  });
});

describe('active-koinkat-account pointer', () => {
  it('adopts a pre-v12 localStorage pointer', async () => {
    installLocalStorage({ [WS_MIRROR]: 'ws-1' });
    const { hydrateActiveKoinkatAccountId, requireActiveKoinkatAccountId } =
      await import('./active-koinkat-account');

    expect(await hydrateActiveKoinkatAccountId()).toBe('ws-1');
    expect(requireActiveKoinkatAccountId()).toBe('ws-1');
    expect(appState.get('active_koinkat_account_id')).toBe('ws-1');
  });

  it('throws from require() when no workspace is active', async () => {
    installLocalStorage();
    const { hydrateActiveKoinkatAccountId, requireActiveKoinkatAccountId } =
      await import('./active-koinkat-account');

    await hydrateActiveKoinkatAccountId();
    expect(() => requireActiveKoinkatAccountId()).toThrow(
      /No active koinkat account/,
    );
  });
});

describe('device-provisioned tripwire', () => {
  it('is false on a genuinely fresh device', async () => {
    installLocalStorage();
    const { isDeviceProvisioned } = await import('./device-provisioned');
    expect(isDeviceProvisioned()).toBe(false);
  });

  it('is true once marked', async () => {
    installLocalStorage();
    const { isDeviceProvisioned, markDeviceProvisioned } =
      await import('./device-provisioned');

    markDeviceProvisioned();
    expect(isDeviceProvisioned()).toBe(true);
  });

  it('treats a pre-v12 pointer as evidence of prior setup', async () => {
    // Protects existing users on their FIRST boot after upgrading, before
    // anything has had a chance to write the new breadcrumb key.
    installLocalStorage({ [WS_MIRROR]: 'ws-1' });
    const { isDeviceProvisioned } = await import('./device-provisioned');
    expect(isDeviceProvisioned()).toBe(true);
  });

  it('reports false rather than throwing when storage is unavailable', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('storage disabled');
      },
      setItem: () => {
        throw new Error('storage disabled');
      },
      removeItem: () => {},
      clear: () => {},
    });
    const { isDeviceProvisioned, markDeviceProvisioned } =
      await import('./device-provisioned');

    expect(() => markDeviceProvisioned()).not.toThrow();
    expect(isDeviceProvisioned()).toBe(false);
  });
});
