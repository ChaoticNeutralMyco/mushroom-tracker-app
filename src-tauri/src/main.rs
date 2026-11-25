// src-tauri/src/main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::atomic::{AtomicBool, Ordering};
use tauri_plugin_updater::UpdaterExt;

static INSTALLING: AtomicBool = AtomicBool::new(false);
struct InstallGuard;
impl Drop for InstallGuard {
    fn drop(&mut self) { INSTALLING.store(false, Ordering::Release); }
}

#[tauri::command]
async fn myco_check_update(app: tauri::AppHandle) -> Result<Option<serde_json::Value>, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let result = updater.check().await.map_err(|e| e.to_string())?;
    Ok(result.map(|update| serde_json::json!({
        "version": update.version,
        "notes": update.body.unwrap_or_default()
    })))
}

#[tauri::command]
async fn myco_install_update(app: tauri::AppHandle, expected_version: String) -> Result<(), String> {
    if INSTALLING.swap(true, Ordering::AcqRel) { return Err("An update is already in progress.".into()); }
    let _guard = InstallGuard;
    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?.ok_or("No newer update is available.")?;
    if update.version != expected_version { return Err("Release changed. Check for updates again.".into()); }
    // Tauri verifies the configured public-key signature before installation.
    update.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "windows"))]
    app.restart();
    #[cfg(target_os = "windows")]
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![myco_check_update, myco_install_update])
        .run(tauri::generate_context!())
        .expect("error while running Mushroom Tracker Tauri application");
}
