import Database from '@tauri-apps/plugin-sql';

let db: Database | null = null;
let pending: Promise<Database> | null = null;

// Unwrapped (non-queued) DB methods, captured at load time. Used only by
// `withTransaction` so a transaction's own statements bypass `opQueue` and
// run on a single connection.
let rawExecute: Database['execute'] | null = null;
let rawSelect: Database['select'] | null = null;

/**
 * Single global JS-side queue that every `db.execute` / `db.select`
 * call passes through. The user of `getDb()` doesn't see this - the
 * `loaded` Database returned has its methods transparently wrapped
 * below.
 *
 * **Why it exists.** `tauri-plugin-sql` v2.3.2 wraps an `sqlx::SqlitePool`
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
 * `tauri-plugin-sql` v2.3.2 does NOT accept `?_pragma=…` URL params
 * (it rejects them at parse time with `unknown query parameter`), so
 * the URL stays bare.
 */
export async function getDb(): Promise<Database> {
  if (db) return db;
  if (!pending) {
    pending = Database.load('sqlite:koinkat.db').then(async (loaded) => {
      // Wrap before running PRAGMAs so the PRAGMAs themselves queue
      // and pin the connection that subsequent calls will land on.
      const origExecute = loaded.execute.bind(loaded);
      const origSelect = loaded.select.bind(loaded);
      rawExecute = origExecute;
      rawSelect = origSelect;
      loaded.execute = ((sql: string, args?: unknown[]) =>
        serialize(() => origExecute(sql, args))) as typeof loaded.execute;
      loaded.select = (<T>(sql: string, args?: unknown[]) =>
        serialize(() => origSelect<T>(sql, args))) as typeof loaded.select;

      try {
        await loaded.execute('PRAGMA busy_timeout = 5000');
        await loaded.execute('PRAGMA journal_mode = WAL');
      } catch (err) {
        console.warn('[db] PRAGMA setup failed:', err);
      }
      db = loaded;
      return loaded;
    });
  }
  return pending;
}

/**
 * A DB executor whose calls run directly (bypassing the serialize queue).
 * Both `Database` and the raw `tx` handed to `withTransaction` satisfy this,
 * so internal helpers can accept either: the wrapped handle when called on
 * their own, or `tx` when called inside a transaction.
 */
export interface DbExecutor {
  execute(
    sql: string,
    args?: unknown[],
  ): Promise<{ rowsAffected: number; lastInsertId?: number }>;
  select<T>(sql: string, args?: unknown[]): Promise<T>;
}

/**
 * Run `fn` inside a single `BEGIN IMMEDIATE … COMMIT` transaction that holds
 * the global op-queue for its entire duration.
 *
 * Why this exists: the per-statement `serialize` queue keeps individual calls
 * ordered but does NOT keep a multi-statement transaction atomic - other DB
 * calls could interleave between a transaction's statements, and sqlx could
 * then serve a later statement from a different pooled connection (one
 * without `busy_timeout`), surfacing `(code: 5) database is locked`.
 *
 * By wrapping the whole BEGIN…COMMIT in ONE `serialize` task and giving the
 * body a RAW executor (`tx`) that bypasses the queue, the transaction is the
 * only DB acquirer while it runs: every statement lands on the same
 * connection and all other callers queue behind it.
 *
 * IMPORTANT: the body must use the passed `tx` for every DB call (and pass it
 * to any helper that touches the DB). A wrapped `getDb()` call inside the body
 * would deadlock behind this held task.
 */
export async function withTransaction<T>(
  fn: (tx: DbExecutor) => Promise<T>,
): Promise<T> {
  await getDb(); // ensures rawExecute / rawSelect are assigned
  const exec = rawExecute;
  const sel = rawSelect;
  if (!exec || !sel) throw new Error('Database not initialised');
  const tx: DbExecutor = { execute: exec, select: sel };
  return serialize(async () => {
    // Clear a transaction abandoned by a previous crash/deadlock on this
    // connection (errors harmlessly when none is active). Without this, one
    // orphaned BEGIN poisons the connection and every later BEGIN IMMEDIATE
    // fails with "cannot start a transaction within a transaction". Safe
    // because `serialize` guarantees no other transaction is mid-flight here.
    try {
      await exec('ROLLBACK');
    } catch {
      // No active transaction - nothing to clear.
    }
    await exec('BEGIN IMMEDIATE');
    try {
      const result = await fn(tx);
      await exec('COMMIT');
      return result;
    } catch (err) {
      try {
        await exec('ROLLBACK');
      } catch {
        // Secondary failure during rollback isn't actionable - keep the
        // original error as the thing surfaced to the caller.
      }
      throw err;
    }
  });
}
