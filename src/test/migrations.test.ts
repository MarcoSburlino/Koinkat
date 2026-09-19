/**
 * Guards the harness itself: the migration list here must match the one
 * registered natively in src-tauri/src/lib.rs, and the real migrations must
 * actually apply to a real SQLite database.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestDb, MIGRATIONS } from './sqlite-harness';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('migrations', () => {
  it('applies every registered migration to a real database', () => {
    const db = createTestDb();
    const tables = db.raw
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);

    // Spot-check the tables the remediation plan's invariants depend on.
    for (const t of [
      'accounts',
      'transactions',
      'categories',
      'bank_connections',
      'linked_accounts',
      'app_state',
    ]) {
      expect(tables, `missing table ${t}`).toContain(t);
    }
    db.close();
  });

  it('registers every migration-vN.sql file that exists on disk', () => {
    const onDisk = readdirSync(join(ROOT, 'src', 'db'))
      .filter((f) => /^migration-v\d+\.sql$/.test(f))
      .map((f) => Number(f.match(/\d+/)![0]))
      .sort((a, b) => a - b);

    const registered = MIGRATIONS.map((m) => m.version).filter((v) => v >= 2);
    expect(registered).toEqual(onDisk);
  });

  it('matches the migration versions registered in lib.rs', () => {
    const libRs = readFileSync(join(ROOT, 'src-tauri', 'src', 'lib.rs'), 'utf8');
    const native = [...libRs.matchAll(/version:\s*(\d+)\s*,/g)]
      .map((m) => Number(m[1]))
      .sort((a, b) => a - b);

    expect(MIGRATIONS.map((m) => m.version)).toEqual(native);
  });

  it('leaves a usable schema: a workspace-scoped insert round-trips', async () => {
    const db = createTestDb();
    await db.execute(
      `INSERT INTO accounts (id, koinkat_account_id, name, currency, current_balance)
       VALUES (?, ?, ?, ?, ?)`,
      ['a1', 'ws1', 'Checking', 'EUR', '100.00'],
    );
    const rows = await db.select<{ id: string; current_balance: string }[]>(
      'SELECT id, current_balance FROM accounts WHERE koinkat_account_id = ?',
      ['ws1'],
    );
    expect(rows).toEqual([{ id: 'a1', current_balance: '100.00' }]);
    db.close();
  });
});
