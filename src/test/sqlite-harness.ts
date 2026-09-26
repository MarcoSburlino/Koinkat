/**
 * Integration test harness: a real SQLite database running the real
 * migrations, exposed through the same `DbExecutor` shape the services use.
 *
 * Why this exists: every DB-touching suite used to replace `db/database`
 * with a hand-rolled SQL-string-matching fake. Those fakes assert the shape
 * of a statement, never its effect, so nothing in the suite could catch a
 * lost update, a torn transaction, or a migration regression - which is
 * exactly the class of defect the remediation plan targets.
 *
 * Backed by `node:sqlite` (bundled with Node, no native build step). The
 * --experimental-sqlite flag is applied per-Node-version by the probe in
 * vite.config.ts.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DbExecutor } from '../db/database';

const DB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'db');

const read = (file: string) => readFileSync(join(DB_DIR, file), 'utf8');

/**
 * The migration list from `src-tauri/src/lib.rs`, in registration order.
 * Kept in sync by `migrations-match-native.test.ts`, which fails if a
 * migration file exists on disk but is missing here.
 *
 * v2 is special: it concatenates the drop-v1 script with the schema-v2
 * CREATEs, exactly as `MIGRATION_V2_SQL` does natively (lib.rs:12-16).
 */
export const MIGRATIONS: ReadonlyArray<{ version: number; sql: () => string }> = [
  { version: 1, sql: () => read('schema.sql') },
  { version: 2, sql: () => `${read('migration-v2.sql')}\n${read('schema-v2.sql')}` },
  { version: 3, sql: () => read('migration-v3.sql') },
  { version: 4, sql: () => read('migration-v4.sql') },
  { version: 5, sql: () => read('migration-v5.sql') },
  { version: 6, sql: () => read('migration-v6.sql') },
  { version: 7, sql: () => read('migration-v7.sql') },
  { version: 8, sql: () => read('migration-v8.sql') },
  { version: 9, sql: () => read('migration-v9.sql') },
  { version: 10, sql: () => read('migration-v10.sql') },
  { version: 11, sql: () => read('migration-v11.sql') },
  { version: 12, sql: () => read('migration-v12.sql') },
  { version: 13, sql: () => read('migration-v13.sql') },
  { version: 14, sql: () => read('migration-v14.sql') },
  { version: 15, sql: () => read('migration-v15.sql') },
];

/**
 * node:sqlite accepts only null / number / bigint / string / Uint8Array.
 * The services pass `unknown[]`, and `undefined` (an omitted optional) plus
 * `boolean` both reach bind sites in practice. Normalise rather than letting
 * the driver throw a type error that reads like a test-harness bug.
 */
function bindable(args: unknown[]): unknown[] {
  return args.map((a) => {
    if (a === undefined || a === null) return null;
    if (typeof a === 'boolean') return a ? 1 : 0;
    if (typeof a === 'object' && a !== null && 'toFixed' in a) {
      // A Big.js value that escaped a .toFixed() call. Reaching SQLite with
      // one is a bug in the caller, not something to silently coerce.
      throw new Error(
        `Refusing to bind a Big instance directly (${String(a)}). ` +
          'Money must be serialised explicitly before it reaches SQL.',
      );
    }
    return a;
  });
}

export interface Harness extends DbExecutor {
  /** The underlying handle, for assertions that need raw access. */
  raw: DatabaseSync;
  /** Run `fn` inside a real BEGIN IMMEDIATE / COMMIT, like `withTransaction`. */
  transaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T>;
  close(): void;
}

/**
 * Create a database and apply migrations up to `throughVersion`.
 *
 * Pass a lower `throughVersion` to build an older database (a v12 upgrade
 * test starts at 12, then applies v13 and asserts the data survived).
 */
export function createTestDb(opts: { throughVersion?: number; file?: string } = {}): Harness {
  const through = opts.throughVersion ?? MIGRATIONS[MIGRATIONS.length - 1].version;
  const raw = new DatabaseSync(opts.file ?? ':memory:');

  // Match the runtime PRAGMAs. Foreign keys are OFF by default in SQLite and
  // the app relies on ON DELETE CASCADE, so a test without this would let
  // orphan rows through that the real app would have refused.
  raw.exec('PRAGMA foreign_keys = ON');

  for (const m of MIGRATIONS) {
    if (m.version > through) break;
    try {
      raw.exec(m.sql());
    } catch (err) {
      throw new Error(`Migration v${m.version} failed: ${(err as Error).message}`);
    }
  }

  const executor: DbExecutor = {
    async execute(sql: string, args: unknown[] = []) {
      const r = raw.prepare(sql).run(...(bindable(args) as never[]));
      return {
        rowsAffected: Number(r.changes),
        lastInsertId: Number(r.lastInsertRowid),
      };
    },
    async select<T>(sql: string, args: unknown[] = []) {
      return raw.prepare(sql).all(...(bindable(args) as never[])) as T;
    },
  };

  // SQLite allows one writer at a time. In the app, a second concurrent
  // BEGIN IMMEDIATE lands on its own pooled connection and waits out
  // busy_timeout until the first commits. node:sqlite gives us a single
  // connection, so that waiting is modelled here as a queue. The observable
  // behaviour is the same one the fix depends on: a transaction body starts
  // only after the previous transaction has committed, so a balance read
  // inside the body sees the previous write.
  let writeQueue: Promise<unknown> = Promise.resolve();

  return {
    ...executor,
    raw,
    transaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T> {
      const run = async (): Promise<T> => {
        raw.exec('BEGIN IMMEDIATE');
        try {
          const result = await fn(executor);
          raw.exec('COMMIT');
          return result;
        } catch (err) {
          try {
            raw.exec('ROLLBACK');
          } catch {
            // Nothing actionable - surface the original failure.
          }
          throw err;
        }
      };
      const result = writeQueue.then(run, run);
      writeQueue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
    close() {
      // Idempotent: a test may close early to prove a file stands alone,
      // and afterEach still calls this.
      try {
        raw.close();
      } catch {
        // Already closed.
      }
    },
  };
}
