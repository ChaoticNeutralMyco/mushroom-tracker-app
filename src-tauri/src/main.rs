// src-tauri/src/main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")] // no console window on release builds

fn main() {
  tauri::Builder::default()
    // Add commands you want to call from the frontend here:
    // .invoke_handler(tauri::generate_handler![your_command])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
