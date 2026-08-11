pub mod commands;
pub mod postgres;
pub mod secrets;
pub mod session;
pub mod ssh;
pub mod storage;

use tauri::Manager;
use tokio::sync::Mutex;

use crate::session::AppSession;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_data = app
                .path()
                .app_data_dir()
                .expect("resolve app data directory");
            std::fs::create_dir_all(&app_data).ok();
            let session = AppSession::open(&app_data).expect("open app session");
            app.manage(Mutex::new(session));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_profiles,
            commands::get_profile,
            commands::save_profile,
            commands::delete_profile,
            commands::connect_profile,
            commands::disconnect,
            commands::list_tables,
            commands::list_columns,
            commands::run_query,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
