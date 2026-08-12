//! Local rusqlite storage: schema, profile CRUD, library, tabs, and query history helpers.
//!
//! Secrets are never stored here — only OS keyring (see `crate::secrets`).

pub mod history;
pub mod library;
pub mod profiles;
pub mod schema;
pub mod tabs;

use rusqlite::{Connection, Result as SqliteResult};
use std::path::{Path, PathBuf};

pub use history::{
    clear_history_for_profile, delete_history, insert_history, list_history, HistoryInsert,
    HistoryRow,
};
pub use library::{
    create_folder, delete_folder, delete_saved_queries, duplicate_saved_query, get_saved_query,
    list_folders, list_saved_queries, move_saved_query, rename_folder, save_saved_query, FolderRow,
    SavedQueryRow, SavedQueryWrite,
};
pub use profiles::{
    delete_profile, get_profile, list_profiles, upsert_profile, ProfileRow,
};
pub use schema::migrate;
pub use tabs::{
    delete_tab_state, get_tab_state, list_tab_states, update_tab_cached_results, upsert_tab_state,
    TabStateRow, TabStateWrite,
};

/// Open (or create) the app DB at `path`, then run migrations.
///
/// `path` is injectable so tests can use temp dirs; production passes app-data path.
pub fn open_db(path: &Path) -> SqliteResult<Connection> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let conn = Connection::open(path)?;
    migrate(&conn)?;
    Ok(conn)
}

/// Default relative DB filename under an injectable app-data directory.
pub fn default_db_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("dragondb.sqlite")
}
