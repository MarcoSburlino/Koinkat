//! OS-credential-store commands for the Enable Banking private key.
//!
//! This is deliberately the ONLY business-adjacent Rust in the app (the
//! architecture rule is "lib.rs registers plugins and that's it"): storing
//! a secret in the platform keychain is host plumbing the webview cannot
//! do itself. The frontend never chooses the service name - it is fixed
//! here so a compromised webview cannot enumerate or write foreign
//! credentials via these commands.

use keyring::Entry;

fn entry(app: &tauri::AppHandle, account: &str) -> Result<Entry, String> {
    // Preserve installed users' namespace, but never let Demo read it.
    let service = if app.config().identifier == "com.koinkat.app.demo" {
        "koinkat-demo"
    } else {
        "koinkat"
    };
    Entry::new(service, account).map_err(|e| e.to_string())
}

/// Store (or overwrite) a secret under `account`.
#[tauri::command]
pub fn secret_set(app: tauri::AppHandle, account: String, value: String) -> Result<(), String> {
    entry(&app, &account)?
        .set_password(&value)
        .map_err(|e| e.to_string())
}

/// Read a secret. `Ok(None)` when no entry exists - callers treat that as
/// "not saved", not as an error.
#[tauri::command]
pub fn secret_get(app: tauri::AppHandle, account: String) -> Result<Option<String>, String> {
    match entry(&app, &account)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Delete a secret. Deleting a missing entry is a no-op, so callers can
/// call this best-effort during workspace teardown.
#[tauri::command]
pub fn secret_delete(app: tauri::AppHandle, account: String) -> Result<(), String> {
    match entry(&app, &account)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
