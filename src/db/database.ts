import Database from '@tauri-apps/plugin-sql';
import { invoke } from '@tauri-apps/api/core';

let db: Database | null = null;
let pending: Promise<Database> | null = null;


/**
 * Single global JS-side queue that every `db.execute` / `db.select`
 * call passes through. The user of `getDb()` doesn't see this - the
 * `loaded` Database returned has its methods transparently wrapped
 * below.
 *
 * **Why it exists.** `tauri-plugin-sql` v2.4.0 wraps an `sqlx::SqlitePool`
 * (default `max_connections=10`) and there's no JS-exposed config knob
 * to force size=1. sqlx releases the connection back to the pool after
 * every `execute`/`select`, so consecutive `db.execute` calls can land
 * on DIFFERENT connections. That breaks multi-statement transactions:
 *
 *   1. `db.execute('BEGIN IMMEDIATE')` runs on conn A; A acquires the
 *      RESERVED lock on the DB file; A returns to the pool.
 *   2. `db.execute('DELETE FROM …')` may be served by conn B (e.g. if
 *      a background bank-sync write is in flight on A). B has no
 *      `busy_timeout` (default 0) and immediately returns
 *      `(code: 5) database is locked` instead of waiting.
 *
 * By making every DB call go through `opQueue`, we ensure only ONE
 * sqlx acquire is in flight at a time. sqlx's idle pool is LIFO, so
 * sequential acquires return the same connection - the one we ran
 * `PRAGMA busy_timeout=5000` and `PRAGMA journal_mode=WAL` on right
 * after load.
 *
 * NOTE: this queue no longer has anything to do with transaction safety.
 * `withTransaction` owns a real connection in Rust (see db_tx.rs) and does
 * NOT pass through here, so a transaction can no longer be torn apart by
 * pool churn, and holding the queue for the length of a transaction - which
 * used to be required, and which deadlocked any body that called `getDb()`
 * - is gone. What remains is ordering for ordinary one-off calls.
 *
 * Cost: every DB call is sequential. For a single-user local-first
 * SQLite app the queries are sub-millisecond; the queue is not a
 * perceptible bottleneck. SQLite never benefits from parallel writers
 * anyway (one writer at a time on the file).
 */
let opQueue: Promise<unknown> = Promise.resolve();

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  // Chain regardless of prior failure so one rejected call doesn't
  // block every subsequent call forever.
  const result = opQueue.then(fn, fn);
  opQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/**
 * Tauri plugin commands reject with plain STRINGS (the Rust error is
 * serialized via `to_string`), so the `err instanceof Error` checks all
 * over the app would fall back to generic messages and hide the real SQL
 * error. Normalize every rejection into a proper `Error` here, at the one
 * point all DB calls flow through.
 */
function toDbError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (typeof err === 'string') return new Error(err);
  try {
    return new Error(JSON.stringify(err));
  } catch {
    return new Error(String(err));
  }
}

const DB_URL = 'sqlite:koinkat.db';

/** How many times to re-attempt a `Database.load` that failed on a lock. */
const LOAD_ATTEMPTS = 5;

/**
 * Is this failure worth retrying? The cold-boot window right after a Windows
 * restart is the case that matters: SQLite may still be recovering a WAL left
 * behind by the previous process (which a restart kills without ever firing
 * the plugin's `RunEvent::Exit` pool close), and an antivirus scan can hold
 * the file for a moment longer. Both surface as transient lock/busy errors.
 */
function isTransientLockError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('database is locked') ||
    msg.includes('database is busy') ||
    msg.includes('unable to open database') ||
    msg.includes('(code: 5)') || // SQLITE_BUSY
    msg.includes('(code: 261)') // SQLITE_BUSY_SNAPSHOT
  );
}

/**
 * `Database.load` with bounded backoff on lock/busy failures only. Anything
 * else (a corrupt file, a failed migration) fails fast - retrying those just
 * delays an error the user needs to see.
 */
async function loadWithRetry(): Promise<Database> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < LOAD_ATTEMPTS; attempt += 1) {
    try {
      return await Database.load(DB_URL);
    } catch (err) {
      lastErr = err;
      if (!isTransientLockError(err) || attempt === LOAD_ATTEMPTS - 1) break;
      const delayMs = 200 * 2 ** attempt; // 200, 400, 800, 1600
      console.warn(
        `[db] load attempt ${attempt + 1}/${LOAD_ATTEMPTS} failed, retrying in ${delayMs}ms:`,
        err,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw toDbError(lastErr);
}

/**
 * Force any WAL content back into the main `koinkat.db` file.
 *
 * Kept for callers that genuinely want a checkpoint. It is NOT sufficient
 * on its own to produce a backup - see `exportDatabaseSnapshot`.
 */
export async function checkpointWal(): Promise<void> {
  const loaded = await getDb();
  await loaded.execute('PRAGMA wal_checkpoint(TRUNCATE)');
}

/**
 * Write a transactionally consistent snapshot of the database to `destPath`.
 *
 * Why not checkpoint-then-copy. The export used to run
 * `PRAGMA wal_checkpoint(TRUNCATE)` and then read `koinkat.db` as bytes.
 * Those are two separate operations against a live database: a bank sync
 * committing between them lands in a fresh WAL that the copy never sees, so
 * the "backup" could be a torn mixture of before and after. Checkpointing
 * also cannot stop a writer from appending immediately afterwards.
 *
 * `VACUUM INTO` is SQLite's own snapshot facility. It runs in a single
 * implicit transaction and writes a complete, self-contained, already
 * checkpointed database - no -wal or -shm sidecars to keep alongside it.
 *
 * It also writes through SQLite's file I/O inside the Rust process rather
 * than the Tauri fs plugin, so a destination outside the plugin's scope
 * (`$DOWNLOAD`, `$DESKTOP`, `$DOCUMENT`) still works. The user picked the
 * path in a native save dialog, which is the authorization.
 *
 * SQLite refuses to overwrite, so an existing file at `destPath` must be
 * removed first; callers get a clear error rather than a silent no-op.
 */
export async function exportDatabaseSnapshot(destPath: string): Promise<void> {
  const loaded = await getDb();
  try {
    await loaded.execute('VACUUM INTO ?', [destPath]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/already exists/i.test(msg)) {
      throw new Error(
        `A file already exists at ${destPath}. Choose a new filename, or delete that file first.`,
      );
    }
    throw toDbError(err);
  }
}

/**
 * The highest migration applied to the open database - which, once
 * `Database.load` has run, is the newest migration this build knows. Backups
 * record it in their filename so a restore never offers a file written by a
 * NEWER Koinkat than the one running (this build could not open it).
 */
export async function currentSchemaVersion(): Promise<number> {
  const loaded = await getDb();
  const rows = await loaded.select<{ v: number | null }[]>(
    'SELECT MAX(version) AS v FROM _sqlx_migrations WHERE success = 1',
  );
  return Number(rows[0]?.v ?? 0);
}

/**
 * Close the database so its files can be moved (backup restore). Afterwards
 * the process must NOT open the database again: `tauri-plugin-sql` runs
 * migrations only on the first `Database.load` of a process (it removes them
 * from its registry as it applies them), so a restored file loaded now would
 * skip its migrations. The restore flow ends by asking for a restart instead.
 *
 * Abandoned native transactions are rolled back first, because the pool's
 * close waits for every checked-out connection to come home.
 */
export async function closeDb(): Promise<void> {
  const loaded = db;
  db = null;
  pending = null;
  if (!loaded) return;
  try {
    await invoke<number>('tx_rollback_all');
  } catch (err) {
    console.warn('[db] rollback before close failed:', err);
  }
  // Name the database explicitly: with no argument the plugin closes every
  // pool it holds.
  await loaded.close(DB_URL).catch((err) => {
    throw toDbError(err);
  });
}

/**
 * Open (or return the cached) database handle. The returned `Database`
 * has its `execute` and `select` methods transparently wrapped in the
 * single-queue serializer documented on `opQueue` above.
 *
 * Post-load PRAGMAs (run through the queue, so they apply to the same
 * connection every subsequent call will use):
 *   - `busy_timeout = 5000` - backstop: if the LIFO assumption ever
 *     broke and a different connection got picked, it'd at least wait
 *     up to 5 s instead of failing instantly.
 *   - `journal_mode = WAL` - readers don't block writers and vice
 *     versa. Side effect: `koinkat.db-wal` + `koinkat.db-shm` sidecar
 *     files appear next to the DB.
 *
 * `tauri-plugin-sql` v2.4.0 does NOT accept `?_pragma=…` URL params
 * (it rejects them at parse time with `unknown query parameter`), so
 * the URL stays bare.
 */
export async function getDb(): Promise<Database> {
  if (db) return db;
  if (!pending) {
    pending = loadWithRetry().then(async (loaded) => {
      // Wrap before running PRAGMAs so the PRAGMAs themselves queue
      // and pin the connection that subsequent calls will land on.
      const origExecute = loaded.execute.bind(loaded);
      const origSelect = loaded.select.bind(loaded);
      // Normalize rejections at the source so every path (queued calls,
      // the raw `tx` executor inside withTransaction, executeAtomicBatch)
      // throws a real Error carrying the plugin's message.
      const wrappedExecute = ((sql: string, args?: unknown[]) =>
        origExecute(sql, args).catch((err) => {
          throw toDbError(err);
        })) as typeof loaded.execute;
      const wrappedSelect = (<T>(sql: string, args?: unknown[]) =>
        origSelect<T>(sql, args).catch((err) => {
          throw toDbError(err);
        })) as typeof loaded.select;
      loaded.execute = ((sql: string, args?: unknown[]) =>
        serialize(() => wrappedExecute(sql, args))) as typeof loaded.execute;
      loaded.select = (<T>(sql: string, args?: unknown[]) =>
        serialize(() => wrappedSelect<T>(sql, args))) as typeof loaded.select;

      try {
        await loaded.execute('PRAGMA busy_timeout = 5000');
        await loaded.execute('PRAGMA journal_mode = WAL');
      } catch (err) {
        console.warn('[db] PRAGMA setup failed:', err);
      }

      // A webview reload mid-transaction leaves a connection checked out in
      // Rust still holding SQLite's write lock. Rust cannot tell a reload
      // apart from ordinary webview activity, so the cleanup happens here,
      // once, on the next initialisation.
      try {
        const cleared = await invoke<number>('tx_rollback_all');
        if (cleared > 0) {
          console.warn(`[db] rolled back ${cleared} transaction(s) abandoned by a previous page load`);
        }
      } catch (err) {
        console.warn('[db] abandoned-transaction sweep failed:', err);
      }
      db = loaded;
      return loaded;
    });
    // A rejected `pending` must NOT stay cached. It used to: one transient
    // failure at boot then replayed itself for every later getDb() call, so
    // nothing in the session could recover and the UI had no way back. Null
    // it out so the next call - e.g. the Retry button on the boot-error
    // screen - genuinely re-opens the file.
    pending = pending.catch((err) => {
      pending = null;
      throw toDbError(err);
    });
  }
  return pending;
}

/**
 * A DB executor. Both the wrapped `Database` handle and the `tx` handed to
 * `withTransaction` satisfy it, so internal helpers can accept either: the
 * handle when called on their own, or `tx` when called inside a transaction.
 */
export interface DbExecutor {
  execute(
    sql: string,
    args?: unknown[],
  ): Promise<{ rowsAffected: number; lastInsertId?: number }>;
  select<T>(sql: string, args?: unknown[]): Promise<T>;
}

/** One statement of an `executeAtomicBatch` group. */
export interface BatchStatement {
  sql: string;
  params?: unknown[];
}

/**
 * Run `fn` inside a real SQLite transaction that owns ONE connection from
 * `BEGIN IMMEDIATE` through `COMMIT`.
 *
 * The transaction lives in Rust (`src-tauri/src/db_tx.rs`). Every statement
 * issued against the `tx` executor below is routed to the connection that
 * transaction checked out, so:
 *
 *   - a read inside the body sees the body's own uncommitted writes, which
 *     is what makes read-then-write balance updates safe;
 *   - sqlx cannot recycle the connection mid-transaction (a checked-out
 *     connection is not in the idle queue), so a COMMIT can no longer fail
 *     with "cannot commit - no transaction is active" after a partial write;
 *   - concurrent callers each get their own connection and their own
 *     transaction. The second `BEGIN IMMEDIATE` waits on `busy_timeout`
 *     rather than interleaving, so two simultaneous mutations serialize in
 *     SQLite instead of racing in JavaScript.
 *
 * IMPORTANT: the body must use the passed `tx` for every DB call, and pass
 * it to any helper that touches the DB. A plain `getDb()` call inside the
 * body runs OUTSIDE the transaction - it will not see uncommitted rows and
 * its writes will not roll back with it.
 */
export async function withTransaction<T>(
  fn: (tx: DbExecutor) => Promise<T>,
): Promise<T> {
  await getDb(); // ensure the plugin has loaded the database and migrated it
  const token = await beginNativeTx();

  const tx: DbExecutor = {
    async execute(sql: string, args: unknown[] = []) {
      const [rowsAffected, lastInsertId] = await invoke<[number, number]>(
        'tx_execute',
        { token, query: sql, values: args },
      ).catch((err) => {
        throw toDbError(err);
      });
      return { rowsAffected, lastInsertId };
    },
    async select<R>(sql: string, args: unknown[] = []) {
      return invoke<R>('tx_select', {
        token,
        query: sql,
        values: args,
      }).catch((err) => {
        throw toDbError(err);
      });
    },
  };

  try {
    const result = await fn(tx);
    await invoke('tx_commit', { token }).catch((err) => {
      throw toDbError(err);
    });
    return result;
  } catch (err) {
    try {
      await invoke('tx_rollback', { token });
    } catch {
      // A secondary failure during rollback is not actionable - the
      // connection is dropped either way. Surface the original error.
    }
    throw err;
  }
}

/** Open a native transaction, normalising the plugin's string rejections. */
async function beginNativeTx(): Promise<string> {
  try {
    return await invoke<string>('tx_begin', { db: DB_URL });
  } catch (err) {
    throw toDbError(err);
  }
}

/**
 * Run a group of write statements as one atomic transaction.
 *
 * This is now a thin wrapper over `withTransaction`. It previously
 * concatenated everything into a single `BEGIN; …; COMMIT` string to dodge
 * the pool-recycling hazard, which forced two awkward restrictions: no `;`
 * anywhere in a statement, and write-only (SELECT rows were discarded).
 * With a real transaction neither workaround is needed, but the validation
 * below is kept - a placeholder/param mismatch is a caller bug worth
 * catching early, and callers still rely on the summed `rowsAffected`.
 */
export async function executeAtomicBatch(
  statements: BatchStatement[],
): Promise<{ rowsAffected: number }> {
  if (statements.length === 0) return { rowsAffected: 0 };

  for (const stmt of statements) {
    const placeholders = (stmt.sql.match(/\?/g) ?? []).length;
    const paramCount = stmt.params?.length ?? 0;
    if (placeholders !== paramCount) {
      throw new Error(
        `executeAtomicBatch: ${placeholders} placeholders but ${paramCount} params: ${stmt.sql.slice(0, 80)}`,
      );
    }
  }

  return withTransaction(async (tx) => {
    let rowsAffected = 0;
    for (const stmt of statements) {
      const res = await tx.execute(stmt.sql, stmt.params ?? []);
      rowsAffected += res.rowsAffected;
    }
    return { rowsAffected };
  });
}
