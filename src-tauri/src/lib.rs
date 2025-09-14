// Minimal Tauri v2 mobile entrypoint for Android.
// Desktop still uses src-tauri/src/main.rs (bin target). Android loads this lib target.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn main() {
    tauri::Builder::default()
        .setup(|_app| {
            // You can register commands/plugins here if needed for mobile.
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
