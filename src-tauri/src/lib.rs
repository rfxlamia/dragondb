pub mod commands;
pub mod postgres;
pub mod secrets;
pub mod session;
pub mod ssh;
pub mod storage;

use tauri::Emitter;
use tauri::Manager;
use tokio::sync::Mutex;

use crate::postgres::CancelRegistry;
use crate::session::AppSession;

#[cfg(desktop)]
fn install_native_menu(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};

    let handle = app.handle();
    let new_tab = MenuItemBuilder::with_id("new-tab", "New Tab")
        .accelerator("CmdOrCtrl+T")
        .build(handle)?;
    let close_tab = MenuItemBuilder::with_id("close-tab", "Close Tab")
        .accelerator("CmdOrCtrl+W")
        .build(handle)?;
    // CmdOrCtrl+Return is the plan/docs name for Accel+Enter. muda 0.19.3
    // (tauri 2.11.5) parse_code accepts ENTER and rejects RETURN, so bind Enter.
    let run_query = MenuItemBuilder::with_id("run-query", "Run Query")
        .accelerator("CmdOrCtrl+Enter")
        .build(handle)?;
    let help = MenuItemBuilder::with_id("help", "DragonDB Help").build(handle)?;
    let shortcuts = MenuItemBuilder::with_id("shortcuts", "Keyboard Shortcuts").build(handle)?;
    let settings = MenuItemBuilder::with_id("settings", "Settings…").build(handle)?;

    let file_menu = SubmenuBuilder::new(handle, "File")
        .item(&new_tab)
        .item(&close_tab)
        .separator()
        .item(&run_query)
        .build()?;
    // WKWebView routes Cmd/Ctrl+C/V/X/A/Z through native Edit first-responder
    // items. Custom MenuItem accelerators do not deliver paste to the webview.
    let edit_menu = SubmenuBuilder::new(handle, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .separator()
        .select_all()
        .build()?;
    let help_menu = SubmenuBuilder::new(handle, "Help")
        .item(&help)
        .item(&shortcuts)
        .separator()
        .item(&settings)
        .build()?;

    let mut builder = MenuBuilder::new(handle);
    #[cfg(target_os = "macos")]
    {
        let app_menu = SubmenuBuilder::new(handle, "DragonDB")
            .about(None)
            .separator()
            .quit()
            .build()?;
        builder = builder.item(&app_menu);
    }
    let menu = builder
        .item(&file_menu)
        .item(&edit_menu)
        .item(&help_menu)
        .build()?;
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        let id = event.id().as_ref();
        match id {
            "help" | "shortcuts" | "settings" | "new-tab" | "close-tab" | "run-query" => {
                let _ = app.emit("dragondb://menu", id);
            }
            _ => {}
        }
    });
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data = app
                .path()
                .app_data_dir()
                .expect("resolve app data directory");
            std::fs::create_dir_all(&app_data).ok();
            let cancel_registry = CancelRegistry::default();
            let session = AppSession::open_with_cancel_registry(&app_data, cancel_registry.clone())
                .expect("open app session");
            app.manage(Mutex::new(session));
            app.manage(cancel_registry);
            #[cfg(desktop)]
            install_native_menu(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_profiles,
            commands::get_profile,
            commands::save_profile,
            commands::delete_profile,
            commands::connect_profile,
            commands::disconnect,
            commands::test_connection,
            commands::cancel_query,
            commands::list_databases,
            commands::switch_database,
            commands::create_database,
            commands::delete_database,
            commands::list_tables,
            commands::list_columns,
            commands::run_query,
            commands::truncate_table,
            commands::drop_table,
            commands::generate_table_ddl,
            commands::set_search_path,
            commands::list_saved_queries,
            commands::get_saved_query,
            commands::save_saved_query,
            commands::delete_saved_queries,
            commands::duplicate_saved_query,
            commands::move_saved_query,
            commands::list_folders,
            commands::create_folder,
            commands::rename_folder,
            commands::delete_folder,
            commands::list_history,
            commands::delete_history,
            commands::clear_history,
            commands::clear_all_history,
            commands::list_tab_states,
            commands::save_tab_state,
            commands::delete_tab_state,
            commands::update_row,
            commands::delete_rows,
            commands::save_csv_file,
            commands::save_text_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
