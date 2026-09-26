/**
 * Workspaces whose owner is missing from `users`.
 *
 * `koinkat_accounts.user_id` has no foreign key, so losing a users row leaves
 * the workspaces intact but unreachable. With zero users the app would offer
 * first-run registration, which only adds a new empty user and hides the
 * data. These run against the real migrations to prove the detection and the
 * recovery on the schema that ships.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestDb, type Harness } from '../test/sqlite-harness';

let db: Harness;

vi.mock('../db/database', () => ({
  getDb: vi.fn(async () => db),
  withTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => db.transaction(fn as never)),
}));

import {
  countOrphanedWorkspaces,
  recoverOrphanedWorkspaceOwners,
  deleteUser,
  listUsers,
} from './user-service';

async function seedUser(id: string, name = id) {
  await db.execute('INSERT INTO users (id, name, email) VALUES (?, ?, ?)', [id, name, '']);
}

async function seedWorkspace(id: string, userId: string) {
  await db.execute(
    `INSERT INTO koinkat_accounts (id, user_id, name, connection_type) VALUES (?, ?, ?, 'manual')`,
    [id, userId, `Workspace ${id}`],
  );
}

beforeEach(() => {
  db = createTestDb();
});

describe('orphaned workspaces', () => {
  it('finds none in a healthy database', async () => {
    await seedUser('u1');
    await seedWorkspace('ws-1', 'u1');
    expect(await countOrphanedWorkspaces()).toBe(0);
  });

  it('finds workspaces whose user row is gone', async () => {
    await seedUser('u1');
    await seedWorkspace('ws-1', 'u1');
    await seedWorkspace('ws-2', 'u1');
    // The failure mode: the users row disappears, nothing else does.
    await db.execute('DELETE FROM users WHERE id = ?', ['u1']);

    expect(await listUsers()).toEqual([]);
    expect(await countOrphanedWorkspaces()).toBe(2);
  });

  it('recovers the owner under its original id, once, touching nothing else', async () => {
    await seedUser('u1');
    await seedWorkspace('ws-1', 'u1');
    await seedWorkspace('ws-2', 'u1');
    await db.execute('DELETE FROM users WHERE id = ?', ['u1']);

    expect(await recoverOrphanedWorkspaceOwners()).toBe(1);

    const users = await listUsers();
    expect(users.map((u) => [u.id, u.name])).toEqual([['u1', 'Recovered user']]);
    expect(await countOrphanedWorkspaces()).toBe(0);
    const ws = await db.select<{ id: string; user_id: string }[]>(
      'SELECT id, user_id FROM koinkat_accounts ORDER BY id',
    );
    expect(ws).toEqual([
      { id: 'ws-1', user_id: 'u1' },
      { id: 'ws-2', user_id: 'u1' },
    ]);
  });

  it('recovers several missing owners, leaving present ones alone', async () => {
    await seedUser('keep', 'Alice');
    await seedWorkspace('ws-a', 'keep');
    await seedWorkspace('ws-b', 'gone-1');
    await seedWorkspace('ws-c', 'gone-2');

    expect(await recoverOrphanedWorkspaceOwners()).toBe(2);
    const names = Object.fromEntries((await listUsers()).map((u) => [u.id, u.name]));
    expect(names).toEqual({ keep: 'Alice', 'gone-1': 'Recovered user', 'gone-2': 'Recovered user' });
  });

  it('is a no-op when there is nothing to recover', async () => {
    await seedUser('u1');
    expect(await recoverOrphanedWorkspaceOwners()).toBe(0);
  });

  it('is never produced by deleting a user normally', async () => {
    await seedUser('u1');
    await seedWorkspace('ws-1', 'u1');
    await deleteUser('u1');
    expect(await countOrphanedWorkspaces()).toBe(0);
  });
});
