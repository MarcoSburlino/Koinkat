//! The transaction commands in `src/db_tx.rs`, driven through Tauri's own
//! IPC dispatch (the mock runtime) with exactly the argument names and value
//! shapes that `withTransaction` in `src/db/database.ts` sends. Every write in
//! the app goes through these commands. They shipped in 0.1.4 having compiled
//! but never completed a round trip; a renamed argument or a changed return
//! shape now fails CI instead of every write in the app.
//!
//! An integration test rather than a unit test so that build.rs can give the
//! test executable the Common Controls manifest Windows needs to load the
//! Tauri runtime at all - see `windows_test_manifest` there.

use std::sync::atomic::{AtomicU64, Ordering};

use koinkat_lib::db_tx::TxRegistry;
use serde_json::{json, Value as JsonValue};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::path::PathBuf;
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, MockRuntime};
use tauri::webview::InvokeRequest;
use tauri::{App, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_sql::{DbInstances, DbPool};

/// The key the SQL plugin registers the pool under - the same string the
/// webview passes to `Database.load` and to `tx_begin`.
const DB: &str = "sqlite:koinkat.db";

struct Harness {
    _app: App<MockRuntime>,
    webview: WebviewWindow<MockRuntime>,
    pool: SqlitePool,
    path: PathBuf,
}

impl Harness {
    /// A file-backed WAL database (an in-memory one is private to each
    /// pooled connection, which would hide exactly the cross-connection
    /// behavior under test), registered the way the SQL plugin does it.
    fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "koinkat-db-tx-{}-{}.db",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let pool = tauri::async_runtime::block_on(async {
            let pool = SqlitePoolOptions::new()
                .max_connections(4)
                .connect_with(
                    SqliteConnectOptions::new()
                        .filename(&path)
                        .create_if_missing(true)
                        .journal_mode(SqliteJournalMode::Wal),
                )
                .await
                .expect("open test database");
            sqlx::query(
                "CREATE TABLE t (id TEXT PRIMARY KEY, amount TEXT NOT NULL, \
                 flag INTEGER, ratio REAL, note TEXT)",
            )
            .execute(&pool)
            .await
            .expect("create test table");
            pool
        });

        let instances = DbInstances::default();
        instances
            .0
            .try_write()
            .expect("fresh lock")
            .insert(DB.to_string(), DbPool::Sqlite(pool.clone()));

        let app = mock_builder()
            .manage(instances)
            .manage(TxRegistry::default())
            .invoke_handler(tauri::generate_handler![
                koinkat_lib::db_tx::tx_begin,
                koinkat_lib::db_tx::tx_execute,
                koinkat_lib::db_tx::tx_select,
                koinkat_lib::db_tx::tx_commit,
                koinkat_lib::db_tx::tx_rollback,
                koinkat_lib::db_tx::tx_rollback_all
            ])
            .build(mock_context(noop_assets()))
            .expect("build mock app");
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("build mock webview");

        Harness {
            _app: app,
            webview,
            pool,
            path,
        }
    }

    fn invoke(&self, cmd: &str, args: JsonValue) -> Result<JsonValue, JsonValue> {
        invoke_on(&self.webview, cmd, args)
    }

    fn begin(&self) -> String {
        self.invoke("tx_begin", json!({ "db": DB }))
            .expect("tx_begin")
            .as_str()
            .expect("token is a string")
            .to_string()
    }

    /// Rows visible to a connection OUTSIDE any open transaction.
    fn committed_rows(&self) -> i64 {
        tauri::async_runtime::block_on(async {
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM t")
                .fetch_one(&self.pool)
                .await
                .expect("count rows")
        })
    }
}

impl Drop for Harness {
    fn drop(&mut self) {
        tauri::async_runtime::block_on(self.pool.close());
        for suffix in ["", "-wal", "-shm"] {
            let mut p = self.path.clone().into_os_string();
            p.push(suffix);
            let _ = std::fs::remove_file(p);
        }
    }
}

fn invoke_on(
    webview: &WebviewWindow<MockRuntime>,
    cmd: &str,
    args: JsonValue,
) -> Result<JsonValue, JsonValue> {
    let url = if cfg!(windows) {
        "http://tauri.localhost"
    } else {
        "tauri://localhost"
    };
    get_ipc_response(
        webview,
        InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: url.parse().expect("valid url"),
            body: InvokeBody::Json(args),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.to_string(),
        },
    )
    .map(|body| body.deserialize::<JsonValue>().expect("json response"))
}

const INSERT: &str = "INSERT INTO t (id, amount, flag, ratio, note) VALUES (?, ?, ?, ?, ?)";

#[test]
fn commit_round_trip_with_the_webview_argument_shapes() {
    let h = Harness::new();
    let token = h.begin();

    // tx_execute answers [rowsAffected, lastInsertId], which the webview
    // destructures positionally.
    let res = h
        .invoke(
            "tx_execute",
            json!({ "token": token, "query": INSERT,
                    "values": ["a", "10.00", true, 1.5, null] }),
        )
        .expect("tx_execute");
    assert_eq!(res[0], json!(1), "rowsAffected");
    assert!(res[1].is_i64(), "lastInsertId is an integer: {res}");

    // Reads inside the transaction see its own uncommitted write - what
    // makes a read-then-write balance update safe. Money comes back as
    // the TEXT it was stored as, never as a float.
    let rows = h
        .invoke(
            "tx_select",
            json!({ "token": token,
                    "query": "SELECT id, amount, flag, ratio, note FROM t",
                    "values": [] }),
        )
        .expect("tx_select");
    assert_eq!(
        rows,
        json!([{ "id": "a", "amount": "10.00", "flag": 1, "ratio": 1.5, "note": null }])
    );

    // Nobody outside the transaction sees it until it commits.
    assert_eq!(h.committed_rows(), 0);
    assert_eq!(h.invoke("tx_commit", json!({ "token": token })), Ok(JsonValue::Null));
    assert_eq!(h.committed_rows(), 1);

    // A finished transaction's token is dead.
    let err = h
        .invoke("tx_commit", json!({ "token": token }))
        .expect_err("token reused after commit");
    assert!(err.to_string().contains("No open transaction"), "{err}");
}

#[test]
fn rollback_discards_every_write() {
    let h = Harness::new();
    let token = h.begin();
    for id in ["a", "b"] {
        h.invoke(
            "tx_execute",
            json!({ "token": token, "query": INSERT,
                    "values": [id, "1.00", 0, 0.0, "x"] }),
        )
        .expect("tx_execute");
    }

    assert_eq!(h.invoke("tx_rollback", json!({ "token": token })), Ok(JsonValue::Null));
    assert_eq!(h.committed_rows(), 0);
    assert!(h.invoke("tx_rollback", json!({ "token": token })).is_err());
}

#[test]
fn a_failed_statement_can_still_be_rolled_back() {
    // withTransaction's error path: the body throws on a bad statement,
    // then the webview calls tx_rollback with the same token. The write
    // that preceded the failure must not survive.
    let h = Harness::new();
    let token = h.begin();
    h.invoke(
        "tx_execute",
        json!({ "token": token, "query": INSERT, "values": ["a", "1.00", 0, 0.0, null] }),
    )
    .expect("first insert");
    let err = h
        .invoke(
            "tx_execute",
            json!({ "token": token, "query": INSERT, "values": ["a", "2.00", 0, 0.0, null] }),
        )
        .expect_err("duplicate primary key");
    assert!(err.to_string().contains("UNIQUE"), "{err}");

    assert_eq!(h.invoke("tx_rollback", json!({ "token": token })), Ok(JsonValue::Null));
    assert_eq!(h.committed_rows(), 0);
}

#[test]
fn a_second_writer_waits_for_the_first_to_commit() {
    // The lost-update fix in one test: two writers never interleave. The
    // second BEGIN IMMEDIATE blocks until the first commits, then reads
    // the committed row instead of a stale snapshot.
    let h = Harness::new();
    let first = h.begin();
    h.invoke(
        "tx_execute",
        json!({ "token": first, "query": INSERT, "values": ["a", "90.00", 0, 0.0, null] }),
    )
    .expect("first write");

    let webview = h.webview.clone();
    let committer = std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(300));
        invoke_on(&webview, "tx_commit", json!({ "token": first }))
    });

    let second = h.begin(); // waits out the first transaction
    assert_eq!(committer.join().expect("committer thread"), Ok(JsonValue::Null));
    let rows = h
        .invoke(
            "tx_select",
            json!({ "token": second, "query": "SELECT amount FROM t WHERE id = ?",
                    "values": ["a"] }),
        )
        .expect("tx_select");
    assert_eq!(rows, json!([{ "amount": "90.00" }]));
    assert_eq!(h.invoke("tx_commit", json!({ "token": second })), Ok(JsonValue::Null));
}

#[test]
fn rollback_all_clears_a_transaction_abandoned_by_a_reload() {
    let h = Harness::new();
    let token = h.begin();
    h.invoke(
        "tx_execute",
        json!({ "token": token, "query": INSERT, "values": ["a", "1.00", 0, 0.0, null] }),
    )
    .expect("tx_execute");

    assert_eq!(h.invoke("tx_rollback_all", json!({})), Ok(json!(1)));
    assert_eq!(h.committed_rows(), 0);
    assert!(h.invoke("tx_commit", json!({ "token": token })).is_err());
    // The write lock is released: a new transaction can start at once.
    let next = h.begin();
    assert_eq!(h.invoke("tx_rollback", json!({ "token": next })), Ok(JsonValue::Null));
}

#[test]
fn an_unknown_database_is_rejected() {
    let h = Harness::new();
    let err = h
        .invoke("tx_begin", json!({ "db": "sqlite:other.db" }))
        .expect_err("unknown database");
    assert!(err.to_string().contains("is not loaded"), "{err}");
}
