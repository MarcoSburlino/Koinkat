/**
 * Item H: the backup must be a consistent snapshot, not a torn copy.
 *
 * The export used to run `PRAGMA wal_checkpoint(TRUNCATE)` and then read
 * `koinkat.db` as bytes. Those are two operations against a live database,
 * so a write landing between them could leave the "backup" a mixture of
 * before and after - and the newest commits are exactly the ones most
 * likely to still be sitting in the WAL.
 *
 * `VACUUM INTO` is SQLite's own snapshot facility: one implicit
 * transaction, producing a complete, already-checkpointed database with no
 * -wal/-shm sidecars. These tests exercise it against real files.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDb, type Harness } from './sqlite-harness';

const WS = 'ws-1';

let dir: string;
let db: Harness;

async function seedAccount() {
  await db.execute(
    `INSERT INTO accounts (id, koinkat_account_id, name, currency, current_balance, is_manual)
     VALUES ('a1', ?, 'Checking', 'EUR', '100.00', 1)`,
    [WS],
  );
}

async function addTxn(id: string, amount: string) {
  await db.execute(
    `INSERT INTO transactions
       (id, koinkat_account_id, account_id, type, amount, currency,
        exchange_rate, amount_in_account_ccy, date, status)
     VALUES (?, ?, 'a1', 'expense', ?, 'EUR', '1.000000000000', ?, '2026-03-10', 'booked')`,
    [id, WS, amount, amount],
  );
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'koinkat-backup-'));
  db = createTestDb({ file: join(dir, 'koinkat.db') });
  // The app runs in WAL mode, which is what made checkpoint-then-copy risky.
  db.raw.exec('PRAGMA journal_mode = WAL');
  await seedAccount();
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('database snapshot', () => {
  it('opens cleanly and passes an integrity check', async () => {
    await addTxn('t1', '10.00');
    const out = join(dir, 'backup.db');

    await db.execute('VACUUM INTO ?', [out]);

    const restored = new DatabaseSync(out);
    const [integrity] = restored.prepare('PRAGMA integrity_check').all() as {
      integrity_check: string;
    }[];
    expect(integrity.integrity_check).toBe('ok');
    const fk = restored.prepare('PRAGMA foreign_key_check').all();
    expect(fk).toEqual([]);
    restored.close();
  });

  it('contains the committed transactions and balances', async () => {
    await addTxn('t1', '10.00');
    await addTxn('t2', '25.00');
    const out = join(dir, 'backup.db');

    await db.execute('VACUUM INTO ?', [out]);

    const restored = new DatabaseSync(out);
    const rows = restored
      .prepare('SELECT id, amount FROM transactions ORDER BY id')
      .all() as { id: string; amount: string }[];
    expect(rows.map((r) => r.id)).toEqual(['t1', 't2']);
    const [acct] = restored
      .prepare('SELECT current_balance FROM accounts WHERE id = ?')
      .all('a1') as { current_balance: string }[];
    expect(acct.current_balance).toBe('100.00');
    restored.close();
  });

  it('captures commits still sitting in the WAL', async () => {
    // No checkpoint before the snapshot. Under the old copy-the-main-file
    // approach these rows could be missing entirely.
    await addTxn('t1', '10.00');
    await addTxn('t2', '25.00');
    const out = join(dir, 'backup.db');

    await db.execute('VACUUM INTO ?', [out]);

    const restored = new DatabaseSync(out);
    const [count] = restored.prepare('SELECT COUNT(*) AS c FROM transactions').all() as {
      c: number;
    }[];
    expect(count.c).toBe(2);
    restored.close();
  });

  it('excludes a transaction that was rolled back', async () => {
    await addTxn('t1', '10.00');
    await db
      .transaction(async (tx) => {
        await tx.execute(
          `INSERT INTO transactions
             (id, koinkat_account_id, account_id, type, amount, currency,
              exchange_rate, amount_in_account_ccy, date, status)
           VALUES ('rolled-back', ?, 'a1', 'expense', '99.00', 'EUR', '1.000000000000', '99.00', '2026-03-10', 'booked')`,
          [WS],
        );
        throw new Error('simulated failure');
      })
      .catch(() => undefined);

    const out = join(dir, 'backup.db');
    await db.execute('VACUUM INTO ?', [out]);

    const restored = new DatabaseSync(out);
    const rows = restored.prepare('SELECT id FROM transactions').all() as { id: string }[];
    expect(rows.map((r) => r.id)).toEqual(['t1']);
    restored.close();
  });

  it('is self-contained - no -wal or -shm sidecar is needed', async () => {
    await addTxn('t1', '10.00');
    const out = join(dir, 'backup.db');

    await db.execute('VACUUM INTO ?', [out]);

    // The source database is in WAL mode and has its own sidecars; the
    // snapshot must not need any.
    expect(existsSync(`${out}-wal`)).toBe(false);
    expect(existsSync(`${out}-shm`)).toBe(false);

    const restored = new DatabaseSync(out);
    const [count] = restored.prepare('SELECT COUNT(*) AS c FROM transactions').all() as {
      c: number;
    }[];
    expect(count.c).toBe(1);
    restored.close();
  });

  it('refuses to overwrite an existing file rather than corrupting it', async () => {
    await addTxn('t1', '10.00');
    const out = join(dir, 'backup.db');
    await db.execute('VACUUM INTO ?', [out]);

    await expect(db.execute('VACUUM INTO ?', [out])).rejects.toThrow();
  });
});
