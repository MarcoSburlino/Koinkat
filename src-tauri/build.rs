fn main() {
    tauri_build::build();
    windows_test_manifest();
}

/// Give the test executables under tests/ the same Common Controls v6
/// manifest tauri-build embeds in the app.
///
/// tauri-build attaches its manifest to bin targets only. A test executable
/// that links the Tauri runtime then binds the system's comctl32 5.82, which
/// lacks `TaskDialogIndirect`, and Windows refuses to start it with
/// STATUS_ENTRYPOINT_NOT_FOUND before a single test runs
/// (tauri-apps/tauri#13419).
///
/// `rustc-link-arg-tests` reaches integration tests only, so the shipped
/// executable keeps getting its manifest from tauri-build exactly as before -
/// deliberately: a manifest that went missing from the app would crash it on
/// launch for every Windows user. `windows-test-manifest.xml` is a verbatim
/// copy of tauri-build's default.
fn windows_test_manifest() {
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_env = std::env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();
    if target_os != "windows" || target_env != "msvc" {
        return;
    }
    let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("windows-test-manifest.xml");
    println!("cargo:rerun-if-changed={}", manifest.display());
    println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
    println!("cargo:rustc-link-arg-tests=/MANIFESTINPUT:{}", manifest.display());
}
