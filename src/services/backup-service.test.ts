import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Native edges ────────────────────────────────────────────────────
//
// An in-memory filesystem stands in for tauri-plugin-fs, and the database
// module is reduced to the three calls the service makes. What is under test
// is the service's own rules: naming, rotation, the once-a-day check, and a
// restore that never deletes and puts everything back when it fails.

const { fs, dbCalls, failures, dbState } = vi.hoisted(() => ({
  fs: new Map<string, string>(), // path -> contents; directories are ''
  dbCalls: [] as string[],
  failures: {
    copy: false,
    renameTo: null as string | null,
    rollbackRename: false,
    snapshot: false,
  },
  dbState: { users: 1 },
}));

const CONFIG = '/cfg/com.koinkat.app';
const BACKUPS = `${CONFIG}/backups`;
const DB = `${CONFIG}/koinkat.db`;

vi.mock('@tauri-apps/api/path', () => ({
  appConfigDir: vi.fn(async () => CONFIG),
  join: vi.fn(async (...parts: string[]) => parts.join('/')),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn(async (p: string) => fs.has(p)),
  mkdir: vi.fn(async (p: string) => {
    fs.set(p, '');
  }),
  readDir: vi.fn(async (dir: string) =>
    [...fs.keys()]
      .filter((p) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/'))
      .map((p) => ({ name: p.slice(dir.length + 1), isFile: true, isDirectory: false })),
  ),
  remove: vi.fn(async (p: string) => {
    fs.delete(p);
  }),
  rename: vi.fn(async (from: string, to: string) => {
    if (failures.renameTo !== null && to.endsWith(failures.renameTo)) {
      throw new Error('sharing violation');
    }
    if (failures.rollbackRename && !to.includes('replaced')) throw new Error('still locked');
    if (!fs.has(from)) throw new Error(`no such file ${from}`);
    fs.set(to, fs.get(from)!);
    fs.delete(from);
  }),
  copyFile: vi.fn(async (from: string, to: string) => {
    if (failures.copy) {
      fs.set(to, 'PARTIAL');
      throw new Error('disk full');
    }
    fs.set(to, fs.get(from)!);
  }),
}));

vi.mock('../db/database', () => ({
  getDb: vi.fn(async () => ({
    select: async () => [{ n: dbState.users }],
  })),
  currentSchemaVersion: vi.fn(async () => 14),
  exportDatabaseSnapshot: vi.fn(async (dest: string) => {
    dbCalls.push(`snapshot ${dest}`);
    fs.set(dest, failures.snapshot ? 'HALF WRITTEN' : 'SNAPSHOT');
    if (failures.snapshot) throw new Error('disk full');
  }),
  closeDb: vi.fn(async () => {
    dbCalls.push('close');
  }),
}));

import {
  BACKUPS_TO_KEEP,
  backupFileName,
  parseBackupFileName,
  backupsToPrune,
  hasBackupOnDay,
  restorableBackups,
  listBackups,
  createBackup,
  ensureDailyBackup,
  refreshTodaysBackup,
  restoreBackup,
  type BackupFile,
} from './backup-service';

function at(y: number, mo: number, d: number, h = 12, mi = 0, s = 0) {
  return new Date(y, mo - 1, d, h, mi, s);
}

function seedBackup(takenAt: Date, version = 14, reason: BackupFile['reason'] = 'daily') {
  const name = backupFileName(takenAt, version, reason);
  fs.set(BACKUPS, '');
  fs.set(`${BACKUPS}/${name}`, `BACKUP ${name}`);
  return name;
}

beforeEach(() => {
  fs.clear();
  dbCalls.length = 0;
  failures.copy = false;
  failures.renameTo = null;
  failures.rollbackRename = false;
  failures.snapshot = false;
  dbState.users = 1;
});

describe('backup file names', () => {
  it('round-trips time, schema version and reason', () => {
    const t = at(2026, 9, 26, 14, 3, 5);
    const name = backupFileName(t, 14, 'before-delete');
    expect(name).toBe('koinkat-backup-2026-09-26_14-03-05-m14-before-delete.db');
    const parsed = parseBackupFileName(name)!;
    expect(parsed.takenAt.getTime()).toBe(t.getTime());
    expect(parsed.schemaVersion).toBe(14);
    expect(parsed.reason).toBe('before-delete');
  });

  it('ignores anything else in the folder', () => {
    expect(parseBackupFileName('koinkat.db')).toBeNull();
    expect(parseBackupFileName('notes.txt')).toBeNull();
    expect(parseBackupFileName('koinkat-backup-2026-09-26_14-03-05-m14-daily.db-wal')).toBeNull();
  });
});

describe('rotation and selection rules', () => {
  const list = (days: number[]): BackupFile[] =>
    days.map((d) => {
      const name = backupFileName(at(2026, 9, d), 14, 'daily');
      return { ...parseBackupFileName(name)!, path: `${BACKUPS}/${name}` };
    });

  it('prunes only what is beyond the newest ten', () => {
    const twelve = list([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const pruned = backupsToPrune(twelve).map((b) => b.takenAt.getDate());
    expect(pruned).toEqual([2, 1]); // the two oldest
    expect(backupsToPrune(list([1, 2, 3]))).toEqual([]);
    expect(BACKUPS_TO_KEEP).toBe(10);
  });

  it('knows whether today is already covered', () => {
    const l = list([25, 26]);
    expect(hasBackupOnDay(l, at(2026, 9, 26, 23, 59))).toBe(true);
    expect(hasBackupOnDay(l, at(2026, 9, 27, 0, 1))).toBe(false);
  });

  it('never offers a backup written by a newer schema', () => {
    const mixed = [
      { ...list([20])[0], schemaVersion: 12 },
      { ...list([21])[0], schemaVersion: 15 },
      { ...list([22])[0], schemaVersion: 14 },
    ];
    expect(restorableBackups(mixed, 14).map((b) => b.schemaVersion)).toEqual([14, 12]);
  });
});

describe('createBackup / ensureDailyBackup', () => {
  it('refuses to back up a database with no users', async () => {
    dbState.users = 0;
    await expect(createBackup('manual', at(2026, 9, 26))).rejects.toThrow(/no users/);
    expect(dbCalls).toEqual([]);
  });

  it('never lets an interrupted snapshot pass for a backup', async () => {
    const good = seedBackup(at(2026, 9, 25));
    failures.snapshot = true;
    await expect(createBackup('manual', at(2026, 9, 26, 9))).rejects.toThrow(/disk full/);

    // The half-written file only ever had the .partial name...
    const names = (await listBackups()).map((b) => b.name);
    expect(names).toEqual([good]);
    // ...and the next successful backup clears it away.
    failures.snapshot = false;
    await createBackup('manual', at(2026, 9, 26, 10));
    expect([...fs.keys()].some((p) => p.endsWith('.partial'))).toBe(false);
  });

  it('keeps only the newest daily backup of each day', async () => {
    seedBackup(at(2026, 9, 26, 8), 14, 'daily');
    seedBackup(at(2026, 9, 26, 8, 30), 14, 'before-delete');
    await refreshTodaysBackup(at(2026, 9, 26, 12));

    const left = (await listBackups()).map((b) => `${b.takenAt.getHours()}:${b.reason}`);
    // The 08:00 daily is superseded by the 12:00 one; the before-delete
    // snapshot is never superseded.
    expect(left).toEqual(['12:daily', '8:before-delete']);
  });

  it('snapshots into the backups folder and prunes beyond ten', async () => {
    for (let d = 1; d <= BACKUPS_TO_KEEP; d += 1) seedBackup(at(2026, 9, d));
    const made = await createBackup('manual', at(2026, 9, 26, 9));

    expect(made.path).toBe(`${BACKUPS}/koinkat-backup-2026-09-26_09-00-00-m14-manual.db`);
    // Written under a .partial name, renamed only once complete.
    expect(dbCalls).toEqual([`snapshot ${made.path}.partial`]);
    expect(fs.get(made.path)).toBe('SNAPSHOT');
    expect(fs.has(`${made.path}.partial`)).toBe(false);
    const left = await listBackups();
    expect(left).toHaveLength(BACKUPS_TO_KEEP);
    expect(left[0].name).toBe(made.name);
    // The oldest one went; nothing else was touched.
    expect(left.some((b) => b.takenAt.getDate() === 1)).toBe(false);
  });

  it('takes at most one daily backup per calendar day', async () => {
    const first = await ensureDailyBackup(at(2026, 9, 26, 8));
    const second = await ensureDailyBackup(at(2026, 9, 26, 20));
    const nextDay = await ensureDailyBackup(at(2026, 9, 27, 8));

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(nextDay).not.toBeNull();
    expect(dbCalls.filter((c) => c.startsWith('snapshot'))).toHaveLength(2);
  });

  it('serializes concurrent callers: one daily backup, no deadlock', async () => {
    const [a, b] = await Promise.all([
      ensureDailyBackup(at(2026, 9, 26, 8)),
      ensureDailyBackup(at(2026, 9, 26, 8)),
    ]);
    expect(a).not.toBeNull();
    expect(b).toBeNull(); // the second saw the first one's backup
    expect(dbCalls.filter((c) => c.startsWith('snapshot'))).toHaveLength(1);
  });

  it('prunes same-day dailies in the rules too', () => {
    const mk = (h: number, reason: BackupFile['reason']) => {
      const name = backupFileName(at(2026, 9, 26, h), 14, reason);
      return { ...parseBackupFileName(name)!, path: name };
    };
    const pruned = backupsToPrune([mk(8, 'daily'), mk(9, 'manual'), mk(12, 'daily')]);
    expect(pruned.map((b) => b.takenAt.getHours())).toEqual([8]);
  });
});

describe('restoreBackup', () => {
  it('refuses to replace a database that has users', async () => {
    fs.set(DB, 'LIVE DB');
    seedBackup(at(2026, 9, 25, 7));
    const backup = (await listBackups())[0];
    dbState.users = 2;

    await expect(restoreBackup(backup, at(2026, 9, 26, 10))).rejects.toThrow(/Nothing was changed/);
    expect(dbCalls).toEqual([]); // not even closed
    expect(fs.get(DB)).toBe('LIVE DB');
  });

  function seedDatabase(withSidecars: boolean) {
    dbState.users = 0;
    fs.set(DB, 'EMPTY DB');
    if (withSidecars) {
      fs.set(`${DB}-wal`, 'EMPTY WAL');
      fs.set(`${DB}-shm`, 'EMPTY SHM');
    }
  }

  async function theBackup() {
    dbState.users = 0;
    seedBackup(at(2026, 9, 25, 7));
    return (await listBackups())[0];
  }

  it('closes the database, sets the current one aside, then copies the backup in', async () => {
    seedDatabase(true);
    const backup = await theBackup();

    const res = await restoreBackup(backup, at(2026, 9, 26, 10));

    const aside = `${CONFIG}/koinkat-replaced-2026-09-26_10-00-00.db`;
    expect(dbCalls[0]).toBe('close');
    expect(res.setAsideAs).toBe(aside);
    expect(fs.get(DB)).toBe(`BACKUP ${backup.name}`);
    // The replaced database and BOTH sidecars travel together - a stale WAL
    // left beside the restored file would be replayed into it.
    expect(fs.get(aside)).toBe('EMPTY DB');
    expect(fs.get(`${aside}-wal`)).toBe('EMPTY WAL');
    expect(fs.get(`${aside}-shm`)).toBe('EMPTY SHM');
    expect(fs.has(`${DB}-wal`)).toBe(false);
    // The backup itself is copied, never moved.
    expect(fs.get(backup.path)).toBe(`BACKUP ${backup.name}`);
  });

  it('works when there is no database file at all', async () => {
    const backup = await theBackup();
    const res = await restoreBackup(backup, at(2026, 9, 26, 10));
    expect(res.setAsideAs).toBeNull();
    expect(fs.get(DB)).toBe(`BACKUP ${backup.name}`);
  });

  it('puts everything back when the copy fails', async () => {
    seedDatabase(true);
    const backup = await theBackup();
    failures.copy = true;

    await expect(restoreBackup(backup, at(2026, 9, 26, 10))).rejects.toThrow(
      /left exactly as it was/,
    );
    expect(fs.get(DB)).toBe('EMPTY DB'); // the partial copy was replaced back
    expect(fs.get(`${DB}-wal`)).toBe('EMPTY WAL');
    expect(fs.get(`${DB}-shm`)).toBe('EMPTY SHM');
    expect(fs.get(backup.path)).toBe(`BACKUP ${backup.name}`);
    expect([...fs.keys()].some((p) => p.includes('replaced'))).toBe(false);
  });

  it('stops before copying when a file cannot be moved aside', async () => {
    seedDatabase(true);
    const backup = await theBackup();
    failures.renameTo = '.db-shm';

    await expect(restoreBackup(backup, at(2026, 9, 26, 10))).rejects.toThrow(/left exactly/);
    expect(fs.get(DB)).toBe('EMPTY DB');
    expect(fs.get(`${DB}-wal`)).toBe('EMPTY WAL');
  });

  it('names what it could not put back', async () => {
    seedDatabase(false);
    const backup = await theBackup();
    failures.copy = true;
    failures.rollbackRename = true;

    await expect(restoreBackup(backup, at(2026, 9, 26, 10))).rejects.toThrow(
      /could not be moved back: .*koinkat-replaced-2026-09-26_10-00-00\.db/,
    );
  });
});
