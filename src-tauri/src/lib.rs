use tauri::Manager;
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_sql::{Migration, MigrationKind};

// Public only so tests/db_tx_ipc.rs can register the commands on a mock app.
// Nothing outside this crate uses it: the crate is the app shell, never a
// library (publish = false).
pub mod db_tx;
mod secrets;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Migration v2 concatenates: (a) drop-v1-tables script, (b) schema-v2
    // CREATE statements. Existing v1 rows are wiped - the v1→v2 split is
    // not data-preserving.
    const MIGRATION_V2_SQL: &str = concat!(
        include_str!("../../src/db/migration-v2.sql"),
        "\n",
        include_str!("../../src/db/schema-v2.sql"),
    );

    let migrations = vec![
        Migration {
            version: 1,
            description: "Initial profile-aware schema",
            sql: include_str!("../../src/db/schema.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "User + koinkat account split",
            sql: MIGRATION_V2_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "Transfer-pair detection columns",
            sql: include_str!("../../src/db/migration-v3.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "Replace tags with categories + rule engine",
            sql: include_str!("../../src/db/migration-v4.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "Dated budget events + sum-to-budget linkage",
            sql: include_str!("../../src/db/migration-v5.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "Split expense reconciliation columns",
            sql: include_str!("../../src/db/migration-v6.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "Bank-link user-chosen sync start date",
            sql: include_str!("../../src/db/migration-v7.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "External (untracked) split reimbursements",
            sql: include_str!("../../src/db/migration-v8.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "Manual-only flag for budget events",
            sql: include_str!("../../src/db/migration-v9.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "Pending-transaction lifecycle columns",
            sql: include_str!("../../src/db/migration-v10.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "Recurring expense series",
            sql: include_str!("../../src/db/migration-v11.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 12,
            description: "Device-local app state (active user / workspace)",
            sql: include_str!("../../src/db/migration-v12.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 13,
            description: "Durable import fingerprint for bank transactions",
            sql: include_str!("../../src/db/migration-v13.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 14,
            description: "Stable bank-account identity across sessions",
            sql: include_str!("../../src/db/migration-v14.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 15,
            description: "Transfer detection between own accounts",
            sql: include_str!("../../src/db/migration-v15.sql"),
            kind: MigrationKind::Up,
        },
    ];

    let mut builder = tauri::Builder::default();

    // On desktop, single-instance must be registered BEFORE deep-link so
    // that on Windows/Linux (where deep links arrive as a new process's
    // CLI args) the existing instance is focused and receives the URL.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = app
                .get_webview_window("main")
                .map(|w| w.set_focus());
        }));
    }

    builder
        .plugin(tauri_plugin_deep_link::init())
        // NOTE: `plugins.sql.preload` is deliberately ABSENT from
        // tauri.conf.json. With it set, the plugin's `setup` opened one
        // connection pool on koinkat.db, and the webview's `Database.load`
        // then opened a SECOND pool on the same file moments later
        // (commands::load -> DbPool::connect). Two pools contending over one
        // SQLite file while it recovers a WAL left behind by an unclean
        // shutdown produced a transient "database is locked" on the very
        // first query after a Windows restart - which the frontend used to
        // render as the first-run "create a user" screen.
        //
        // Dropping preload is safe: commands::load runs any migrations still
        // registered for that URL, so the migrations below still apply on the
        // webview's own load. Do not re-add preload.
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:koinkat.db", migrations)
                .build(),
        )
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        // App-defined commands, kept to two deliberate groups:
        //   - OS-keychain storage for the Enable Banking private key
        //     (see secrets.rs).
        //   - Connection-owning SQLite transactions (see db_tx.rs). Both
        //     are host plumbing the webview cannot do for itself; neither
        //     contains business logic.
        .manage(db_tx::TxRegistry::default())
        .invoke_handler(tauri::generate_handler![
            secrets::secret_set,
            secrets::secret_get,
            secrets::secret_delete,
            db_tx::tx_begin,
            db_tx::tx_execute,
            db_tx::tx_select,
            db_tx::tx_commit,
            db_tx::tx_rollback,
            db_tx::tx_rollback_all
        ])
        .setup(|app| {
            // Register the koinkat:// URL scheme on Windows and Linux.
            // macOS handles scheme registration via Info.plist (generated by Tauri).
            #[cfg(any(windows, target_os = "linux"))]
            app.deep_link().register_all()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            // Exiting with a transaction open would strand a checked-out
            // connection holding SQLite's write lock.
            //
            // Only Exit is handled here. A webview RELOAD emits no event we
            // can distinguish (RunEvent::WebviewEvent is drag-drop, and
            // rolling back on it would abort live transactions), so reload
            // recovery is handled from the JS side instead: the database
            // module calls `tx_rollback_all` once during initialisation,
            // which clears anything a previous page load abandoned.
            if matches!(event, tauri::RunEvent::Exit) {
                let registry = app.state::<db_tx::TxRegistry>();
                tauri::async_runtime::block_on(db_tx::rollback_all(&registry));
            }
        });
}
