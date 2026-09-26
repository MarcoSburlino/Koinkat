import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { User } from '../types/models';

// ── Module mocks ────────────────────────────────────────────────────
//
// The store talks to the database through user-service and to `app_state`
// through the pointer modules. Replace both with an in-memory user list so
// the test is about the store's own decision: when does deleting a user
// count as a deliberate reset of the device?

const { db, order } = vi.hoisted(() => ({
  db: { users: [] as User[], failDelete: false },
  order: [] as string[],
}));

vi.mock('../services/backup-service', () => ({
  backupBeforeDelete: vi.fn(async () => {
    order.push('backup');
  }),
}));

vi.mock('../services/user-service', () => ({
  listUsers: vi.fn(async () => [...db.users]),
  getUserById: vi.fn(async (id: string) => db.users.find((u) => u.id === id) ?? null),
  deleteUser: vi.fn(async (id: string) => {
    order.push('delete');
    if (db.failDelete) return; // the row survives, as if the delete never landed
    db.users = db.users.filter((u) => u.id !== id);
  }),
}));

vi.mock('../lib/active-user', () => ({
  hydrateActiveUserId: vi.fn(async () => null),
  setActiveUserId: vi.fn(async () => {}),
  clearActiveUserId: vi.fn(async () => {}),
}));

vi.mock('../lib/active-koinkat-account', () => ({
  clearActiveKoinkatAccountId: vi.fn(async () => {}),
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

const PROVISIONED = 'koinkat_device_provisioned';

function user(id: string): User {
  return { id, name: id, email: '', createdAt: '', updatedAt: '' };
}

/** A device that has been set up, with these users in the database. */
async function setUp(...ids: string[]) {
  db.users = ids.map(user);
  const storage = installLocalStorage({ [PROVISIONED]: '1' });
  const { useUserStore } = await import('./user-store');
  await useUserStore.getState().loadUsers();
  return { storage, store: useUserStore };
}

beforeEach(() => {
  db.users = [];
  db.failDelete = false;
  order.length = 0;
  vi.resetModules();
});

describe('user-store deleteUser and the provisioned breadcrumb', () => {
  it('disarms the tripwire when the last user is deleted', async () => {
    // Before this, the breadcrumb outlived the reset and the next launch
    // locked on "no users on a device set up before" with only Retry.
    const { storage, store } = await setUp('u1');

    await store.getState().deleteUser('u1');

    expect(store.getState().users).toEqual([]);
    expect(storage.has(PROVISIONED)).toBe(false);
  });

  it('takes a safety backup before the delete, not after', async () => {
    const { store } = await setUp('u1', 'u2');
    await store.getState().deleteUser('u1');
    expect(order).toEqual(['backup', 'delete']);
  });

  it('keeps the tripwire armed while other users remain', async () => {
    const { storage, store } = await setUp('u1', 'u2');

    await store.getState().deleteUser('u1');

    expect(store.getState().users.map((u) => u.id)).toEqual(['u2']);
    expect(storage.get(PROVISIONED)).toBe('1');
  });

  it('keeps the tripwire armed when the delete did not land', async () => {
    const { storage, store } = await setUp('u1');
    db.failDelete = true;

    await store.getState().deleteUser('u1');

    expect(store.getState().users.map((u) => u.id)).toEqual(['u1']);
    expect(storage.get(PROVISIONED)).toBe('1');
  });

  it('keeps the tripwire armed when the list it deleted from was stale', async () => {
    // The store believed u1 was the only user, but the database also holds
    // u2. The post-delete read disagrees with "that was the last one", so
    // this is not a reset.
    const { storage, store } = await setUp('u1');
    db.users.push(user('u2'));

    await store.getState().deleteUser('u1');

    expect(store.getState().users.map((u) => u.id)).toEqual(['u2']);
    expect(storage.get(PROVISIONED)).toBe('1');
  });
});
