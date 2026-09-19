//! Real SQLite transactions that own one connection for their whole life.
//!
//! Why this is Rust. `tauri-plugin-sql` runs every command as its own
//! `pool.acquire()`. A `BEGIN IMMEDIATE` issued from JavaScript therefore
//! has no guaranteed relationship to the `COMMIT` that follows it: sqlx may
//! serve the later statement from a different pooled connection, and it
//! closes pooled connections on release once they pass `max_lifetime`
//! (30 min) or `idle_timeout` (10 min). A recycle landing mid-transaction
//! silently drops the open transaction and the COMMIT then fails with
//! "cannot commit - no transaction is active", leaving a partial write.
//!
//! Connection ownership is host plumbing the webview cannot do for itself,
//! which is the same justification as the keychain commands in secrets.rs.
//! Business logic stays in TypeScript: these commands move statements and
//! rows, and know nothing about money.
//!
//! Design notes:
//!   - We borrow the pool the SQL plugin already opened (`DbInstances`)
//!     rather than opening a second one. Two pools on one SQLite file is
//!     the exact configuration that caused the "database is locked" bug
//!     documented in lib.rs - see the note about `plugins.sql.preload`.
//!   - A checked-out `PoolConnection` is not in the idle queue, so the
//!     lifetime/idle reaper cannot take it while a transaction holds it.
//!   - Each transaction gets its own async mutex, so two transactions never
//!     serialize on a single registry lock.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};

use serde_json::{Map as JsonMap, Value as JsonValue};
use sqlx::pool::PoolConnection;
use sqlx::{Column, Row, Sqlite, TypeInfo, ValueRef};
use tauri::async_runtime::Mutex as AsyncMutex;
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool};

/// How long a statement waits for a competing writer before giving up.
/// Set per-connection, on the connection the transaction owns - the PRAGMA
/// is connection-scoped, so setting it through the pool (as the JS side
/// used to) only ever configured whichever connection served that one call.
const BUSY_TIMEOUT_MS: i64 = 5_000;

type OwnedConn = Arc<AsyncMutex<PoolConnection<Sqlite>>>;

/// Open transactions, keyed by the token handed back to JavaScript.
#[derive(Default)]
pub struct TxRegistry {
    open: StdMutex<HashMap<String, OwnedConn>>,
    next: AtomicU64,
}

impl TxRegistry {
    fn mint(&self) -> String {
        format!("tx-{}", self.next.fetch_add(1, Ordering::Relaxed))
    }

    fn get(&self, token: &str) -> Result<OwnedConn, String> {
        self.open
            .lock()
            .map_err(|_| "transaction registry poisoned".to_string())?
            .get(token)
            .cloned()
            .ok_or_else(|| format!("No open transaction for token {token}"))
    }

    fn take(&self, token: &str) -> Result<OwnedConn, String> {
        self.open
            .lock()
            .map_err(|_| "transaction registry poisoned".to_string())?
            .remove(token)
            .ok_or_else(|| format!("No open transaction for token {token}"))
    }

    fn insert(&self, token: String, conn: OwnedConn) -> Result<(), String> {
        self.open
            .lock()
            .map_err(|_| "transaction registry poisoned".to_string())?
            .insert(token, conn);
        Ok(())
    }

    fn drain(&self) -> Vec<(String, OwnedConn)> {
        match self.open.lock() {
            Ok(mut g) => g.drain().collect(),
            Err(_) => Vec::new(),
        }
    }
}

/// Bind a JSON argument from the webview onto a query.
///
/// Koinkat stores money as TEXT, ids as TEXT, flags as INTEGER, dates as
/// TEXT - so NULL / INTEGER / REAL / TEXT is the whole domain. Anything
/// structured would be a caller bug; it is stringified rather than silently
/// dropped so the failure is visible in the row.
fn bind_arg<'q>(
    q: sqlx::query::Query<'q, Sqlite, sqlx::sqlite::SqliteArguments<'q>>,
    v: JsonValue,
) -> sqlx::query::Query<'q, Sqlite, sqlx::sqlite::SqliteArguments<'q>> {
    match v {
        JsonValue::Null => q.bind(None::<String>),
        JsonValue::Bool(b) => q.bind(if b { 1_i64 } else { 0_i64 }),
        JsonValue::Number(n) => {
            if let Some(i) = n.as_i64() {
                q.bind(i)
            } else {
                q.bind(n.as_f64().unwrap_or(0.0))
            }
        }
        JsonValue::String(s) => q.bind(s),
        other => q.bind(other.to_string()),
    }
}

/// Convert one result row to a JSON object keyed by column name.
fn row_to_json(row: &sqlx::sqlite::SqliteRow) -> Result<JsonMap<String, JsonValue>, String> {
    let mut out = JsonMap::new();
    for (i, col) in row.columns().iter().enumerate() {
        let raw = row.try_get_raw(i).map_err(|e| e.to_string())?;
        let value = if raw.is_null() {
            JsonValue::Null
        } else {
            // SQLite is dynamically typed, so this reports the STORAGE CLASS
            // of the value actually present, not the declared column type.
            match raw.type_info().name() {
                "TEXT" => row
                    .try_get::<String, _>(i)
                    .map(JsonValue::from)
                    .map_err(|e| e.to_string())?,
                "INTEGER" => row
                    .try_get::<i64, _>(i)
                    .map(JsonValue::from)
                    .map_err(|e| e.to_string())?,
                "REAL" => row
                    .try_get::<f64, _>(i)
                    .map(JsonValue::from)
                    .map_err(|e| e.to_string())?,
                // Koinkat stores no BLOBs. Fall back through the scalar
                // types rather than failing the whole read.
                _ => row
                    .try_get::<String, _>(i)
                    .map(JsonValue::from)
                    .or_else(|_| row.try_get::<i64, _>(i).map(JsonValue::from))
                    .or_else(|_| row.try_get::<f64, _>(i).map(JsonValue::from))
                    .unwrap_or(JsonValue::Null),
            }
        };
        out.insert(col.name().to_string(), value);
    }
    Ok(out)
}

/// Check out a connection and open a transaction on it. Returns the token
/// every later call in this transaction must present.
#[tauri::command]
pub async fn tx_begin(
    db: String,
    instances: State<'_, DbInstances>,
    registry: State<'_, TxRegistry>,
) -> Result<String, String> {
    // Clone the pool (an Arc) and release the plugin's lock immediately -
    // holding it for the length of a transaction would block every other
    // database call in the app.
    let pool = {
        let guard = instances.0.read().await;
        let instance = guard
            .get(&db)
            .ok_or_else(|| format!("Database {db} is not loaded"))?;
        match instance {
            DbPool::Sqlite(pool) => pool.clone(),
            #[allow(unreachable_patterns)]
            _ => return Err("Only SQLite is supported".into()),
        }
    };

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    sqlx::query(&format!("PRAGMA busy_timeout = {BUSY_TIMEOUT_MS}"))
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    // IMMEDIATE takes the write lock up front, so two concurrent writers
    // resolve here (one waits out busy_timeout) instead of deadlocking at
    // COMMIT the way a deferred transaction would.
    sqlx::query("BEGIN IMMEDIATE")
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    let token = registry.mint();
    registry.insert(token.clone(), Arc::new(AsyncMutex::new(conn)))?;
    Ok(token)
}

/// Run a write statement inside the transaction identified by `token`.
#[tauri::command]
pub async fn tx_execute(
    token: String,
    query: String,
    values: Vec<JsonValue>,
    registry: State<'_, TxRegistry>,
) -> Result<(u64, i64), String> {
    let conn = registry.get(&token)?;
    let mut guard = conn.lock().await;

    let mut q = sqlx::query(&query);
    for v in values {
        q = bind_arg(q, v);
    }
    let res = q.execute(&mut **guard).await.map_err(|e| e.to_string())?;
    Ok((res.rows_affected(), res.last_insert_rowid()))
}

/// Run a read inside the transaction identified by `token`, so the caller
/// sees its own uncommitted writes and a consistent snapshot.
#[tauri::command]
pub async fn tx_select(
    token: String,
    query: String,
    values: Vec<JsonValue>,
    registry: State<'_, TxRegistry>,
) -> Result<Vec<JsonMap<String, JsonValue>>, String> {
    let conn = registry.get(&token)?;
    let mut guard = conn.lock().await;

    let mut q = sqlx::query(&query);
    for v in values {
        q = bind_arg(q, v);
    }
    let rows = q.fetch_all(&mut **guard).await.map_err(|e| e.to_string())?;
    rows.iter().map(row_to_json).collect()
}

/// Commit and release the connection back to the pool.
#[tauri::command]
pub async fn tx_commit(token: String, registry: State<'_, TxRegistry>) -> Result<(), String> {
    // Removed first: even if COMMIT fails, the token must not stay usable.
    let conn = registry.take(&token)?;
    let mut guard = conn.lock().await;
    sqlx::query("COMMIT")
        .execute(&mut **guard)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Roll back and release the connection back to the pool.
#[tauri::command]
pub async fn tx_rollback(token: String, registry: State<'_, TxRegistry>) -> Result<(), String> {
    let conn = registry.take(&token)?;
    let mut guard = conn.lock().await;
    sqlx::query("ROLLBACK")
        .execute(&mut **guard)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Roll back every still-open transaction. Returns how many were cleared.
///
/// Called on app exit, and from the JS side once during database
/// initialisation - a webview reload emits no event the Rust side can tell
/// apart from ordinary webview activity, so a transaction abandoned by a
/// reload is cleared on the next startup instead.
#[tauri::command]
pub async fn tx_rollback_all(registry: State<'_, TxRegistry>) -> Result<usize, String> {
    Ok(rollback_all(&registry).await)
}

pub async fn rollback_all(registry: &TxRegistry) -> usize {
    let abandoned = registry.drain();
    let count = abandoned.len();
    for (token, conn) in abandoned {
        let mut guard = conn.lock().await;
        if let Err(e) = sqlx::query("ROLLBACK").execute(&mut **guard).await {
            log::warn!("[db_tx] rollback of abandoned {token} failed: {e}");
        }
    }
    count
}
