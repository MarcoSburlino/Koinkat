// Automatic local backups of the whole database.
//
// The principle: if the user has data, the app must be able to find it - even
// when the database file itself has been emptied, replaced or damaged. So
// Koinkat keeps its own snapshots in a `backups` folder next to the database
// and offers them back whenever it opens to a database with no users.
//
// Device-level, not workspace-level: a backup is the entire file, every user
// and workspace in it, so nothing here is scoped by koinkat_account_id.
//
// Rules that keep backups trustworthy:
//   * Taken only while the database has at least one user - enforced here,
//     not left to callers - so an empty database can never push a good
//     backup out of the rotation.
//   * Written with `VACUUM INTO` (see exportDatabaseSnapshot): one consistent
//     snapshot, self-contained, no -wal/-shm sidecars. It is written under a
//     `.partial` name and renamed only once complete, so an interrupted
//     snapshot (disk full, a crash) can never pass for a backup.
//   * At most one daily backup per calendar day survives: a newer one
//     (after a bank import) replaces the day's earlier one, so ten days of
//     history are kept however often the app syncs.
//   * Each filename records the schema version, so a restore never offers a
//     file written by a newer Koinkat than the one running.
//   * A restore never deletes anything. The current database is moved aside
//     under a new name and the backup is COPIED in, so the backup survives
//     too.
//
// Why next to the database and not in the app's local-data folder: on Linux
// the fs plugin's default permissions deny all of `$APPLOCALDATA` (it is where
// the webview keeps its own data there), and a deny beats any allow.

import { appConfigDir, join } from '@tauri-apps/api/path';
import { copyFile, exists, mkdir, readDir, remove, rename } from '@tauri-apps/plugin-fs';
import { closeDb, currentSchemaVersion, exportDatabaseSnapshot, getDb } from '../db/database';

/** How many backups to keep. The oldest beyond this are deleted. */
export const BACKUPS_TO_KEEP = 10;

const BACKUPS_DIR = 'backups';
const DB_FILE = 'koinkat.db';
/** The database and the WAL-mode sidecars that must travel with it. */
const DB_SIDECARS = ['', '-wal', '-shm'] as const;

export type BackupReason = 'daily' | 'manual' | 'before-delete';

export interface BackupFile {
  name: string;
  path: string;
  takenAt: Date;
  /** Highest migration applied when the backup was taken. */
  schemaVersion: number;
  reason: BackupReason;
}

// koinkat-backup-2026-09-26_14-03-05-m14-daily.db (local time)
const NAME_RE =
  /^koinkat-backup-(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})-m(\d+)-(daily|manual|before-delete)\.db$/;

const pad = (n: number) => String(n).padStart(2, '0');

/** Local-time stamp used in backup and set-aside filenames. */
export function fileStamp(d: Date): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_` +
    `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
  );
}

export function backupFileName(takenAt: Date, schemaVersion: number, reason: BackupReason): string {
  return `koinkat-backup-${fileStamp(takenAt)}-m${schemaVersion}-${reason}.db`;
}

/** Parse a backup filename; anything else in the folder is ignored. */
export function parseBackupFileName(
  name: string,
): Omit<BackupFile, 'path'> | null {
  const m = NAME_RE.exec(name);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, v, reason] = m;
  const takenAt = new Date(+y, +mo - 1, +d, +h, +mi, +s);
  if (Number.isNaN(takenAt.getTime())) return null;
  return { name, takenAt, schemaVersion: Number(v), reason: reason as BackupReason };
}

export function newestFirst(list: BackupFile[]): BackupFile[] {
  return [...list].sort((a, b) => b.takenAt.getTime() - a.takenAt.getTime());
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/**
 * The backups to delete: every daily backup except the newest of its day,
 * then whatever is beyond the newest `keep`.
 */
export function backupsToPrune(list: BackupFile[], keep = BACKUPS_TO_KEEP): BackupFile[] {
  const seenDailyDays = new Set<string>();
  const superseded: BackupFile[] = [];
  const kept: BackupFile[] = [];
  for (const b of newestFirst(list)) {
    if (b.reason === 'daily') {
      const day = dayKey(b.takenAt);
      if (seenDailyDays.has(day)) {
        superseded.push(b);
        continue;
      }
      seenDailyDays.add(day);
    }
    kept.push(b);
  }
  return [...superseded, ...kept.slice(keep)];
}

function sameLocalDay(a: Date, b: Date): boolean {
  return dayKey(a) === dayKey(b);
}

/** Whether any backup was already taken on `day` (local calendar day). */
export function hasBackupOnDay(list: BackupFile[], day: Date): boolean {
  return list.some((b) => sameLocalDay(b.takenAt, day));
}

/** Backups this build can open: none written by a newer schema. */
export function restorableBackups(list: BackupFile[], schemaVersion: number): BackupFile[] {
  return newestFirst(list).filter((b) => b.schemaVersion <= schemaVersion);
}

export async function backupsDirectory(): Promise<string> {
  return join(await appConfigDir(), BACKUPS_DIR);
}

const PARTIAL = '.partial';

/** File names in the backups folder; empty when it does not exist yet. */
async function backupDirNames(dir: string): Promise<string[]> {
  if (!(await exists(dir))) return [];
  return (await readDir(dir)).filter((e) => e.isFile).map((e) => e.name);
}

/** Every backup on disk, newest first. Empty when none were ever taken. */
export async function listBackups(): Promise<BackupFile[]> {
  const dir = await backupsDirectory();
  const found: BackupFile[] = [];
  for (const name of await backupDirNames(dir)) {
    const parsed = parseBackupFileName(name);
    if (parsed) found.push({ ...parsed, path: await join(dir, name) });
  }
  return newestFirst(found);
}

async function countUsers(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>('SELECT COUNT(*) AS n FROM users');
  return Number(rows[0]?.n ?? 0);
}

// Every backup write goes through one queue: two snapshots racing (the
// daily one at startup and a refresh after a sync) would otherwise contend
// for the same second's filename and prune under each other.
let backupQueue: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = backupQueue.then(fn, fn);
  backupQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * The snapshot itself. Unqueued: only ever call it from inside `serialized`
 * (calling the queued `createBackup` from in there would wait on itself).
 */
async function writeBackup(reason: BackupReason, now: Date): Promise<BackupFile> {
  if ((await countUsers()) === 0) {
    throw new Error('Not backing up a database with no users.');
  }
  const dir = await backupsDirectory();
  await mkdir(dir, { recursive: true });
  const schemaVersion = await currentSchemaVersion();
  const name = backupFileName(now, schemaVersion, reason);
  const path = await join(dir, name);
  const partial = path + PARTIAL;
  // A leftover from an interrupted run; SQLite refuses to write over it.
  if (await exists(partial)) await remove(partial);
  await exportDatabaseSnapshot(partial);
  // Same-directory rename: atomic, and it replaces a backup from this very
  // second, which is an older complete snapshot of the same data.
  await rename(partial, path);
  try {
    await pruneBackups();
  } catch (err) {
    // A backup that exists is the point; failing to tidy old ones is not.
    console.warn('[backup] pruning old backups failed:', err);
  }
  return { name, path, takenAt: now, schemaVersion, reason };
}

/**
 * Snapshot the database into the backups folder, then prune. Refuses a
 * database with no users - that is the one thing a backup must never be.
 */
export function createBackup(reason: BackupReason, now = new Date()): Promise<BackupFile> {
  return serialized(() => writeBackup(reason, now));
}

/**
 * Delete superseded and surplus backups, plus `.partial` files left by an
 * interrupted snapshot (none can be in progress: writes are serialized, and
 * this runs inside one). Returns how many backups were removed.
 */
export async function pruneBackups(): Promise<number> {
  const dir = await backupsDirectory();
  for (const name of await backupDirNames(dir)) {
    if (name.endsWith(PARTIAL)) await remove(await join(dir, name));
  }
  const excess = backupsToPrune(await listBackups());
  for (const b of excess) {
    await remove(b.path);
  }
  return excess.length;
}

/**
 * Take today's backup unless one already exists for this calendar day.
 * Called once the database has proved to hold users: at startup, and on
 * entering a workspace (which also covers the session a user registers in).
 */
export function ensureDailyBackup(now = new Date()): Promise<BackupFile | null> {
  return serialized(async () => {
    if (hasBackupOnDay(await listBackups(), now)) return null;
    return writeBackup('daily', now);
  });
}

/**
 * New data just arrived (a bank import): take a fresh daily backup so today's
 * reflects it. Pruning keeps only the newest daily of the day, so this never
 * costs a day of history. Best-effort.
 */
export function refreshTodaysBackup(now = new Date()): Promise<void> {
  return createBackup('daily', now).then(
    () => undefined,
    (err) => {
      console.warn('[backup] refreshing today\'s backup failed:', err);
    },
  );
}

/**
 * A safety snapshot before a deliberate, permanent delete (a user or a
 * workspace). Best-effort: a failed backup is logged and the delete the user
 * confirmed still goes ahead.
 */
export async function backupBeforeDelete(): Promise<void> {
  try {
    await createBackup('before-delete');
  } catch (err) {
    console.warn('[backup] safety backup before delete failed:', err);
  }
}

export interface RestoreResult {
  /** What the replaced database was renamed to, or null if there was none. */
  setAsideAs: string | null;
}

/**
 * Put `backup` in place of the current database.
 *
 * Nothing is deleted: the current database (and any -wal/-shm sidecars, which
 * belong to it and would corrupt the restored file if left beside it) is
 * renamed to `koinkat-replaced-<stamp>.db*`, then the backup is copied in. If
 * any step fails, the moved files are put back.
 *
 * The database is closed first and must stay closed: the app has to be
 * restarted so the restored file goes through migrations (see closeDb). Only
 * offer this while the current database has no users - that is what makes it
 * safe to replace.
 */
export function restoreBackup(backup: BackupFile, now = new Date()): Promise<RestoreResult> {
  // Queued with the backup writes, so a restore never overlaps a snapshot.
  return serialized(() => replaceDatabaseWith(backup, now));
}

async function replaceDatabaseWith(backup: BackupFile, now: Date): Promise<RestoreResult> {
  // The callers only offer this on an empty database; enforce it here too,
  // so no future caller can replace live data (or pull a native transaction
  // out from under an in-flight write when closeDb rolls them back).
  if ((await countUsers()) > 0) {
    throw new Error(
      'A backup can only be restored while the database has no users. Nothing was changed.',
    );
  }
  const dir = await appConfigDir();
  const dbPath = await join(dir, DB_FILE);
  const asideBase = await join(dir, `koinkat-replaced-${fileStamp(now)}.db`);

  await closeDb();

  const moved: Array<[from: string, to: string]> = [];
  try {
    for (const suffix of DB_SIDECARS) {
      const from = dbPath + suffix;
      if (!(await exists(from))) continue;
      const to = asideBase + suffix;
      await rename(from, to);
      moved.push([from, to]);
    }
    await copyFile(backup.path, dbPath);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const stuck: string[] = [];
    for (const [from, to] of [...moved].reverse()) {
      try {
        await rename(to, from);
      } catch {
        stuck.push(`${to} (should be ${from})`);
      }
    }
    throw new Error(
      stuck.length === 0
        ? `Restoring the backup failed: ${reason}. Your database was left exactly as it was.`
        : `Restoring the backup failed: ${reason}. These files could not be moved back: ` +
            `${stuck.join('; ')}. Rename them by hand before reopening Koinkat.`,
    );
  }

  const main = moved.find(([from]) => from === dbPath);
  return { setAsideAs: main ? main[1] : null };
}
