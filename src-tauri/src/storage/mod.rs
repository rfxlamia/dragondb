//! Local rusqlite storage: schema, profile CRUD, and query history helpers.
//!
//! Secrets are never stored here — only OS keyring (see `crate::secrets`).

pub mod history;
pub mod profiles;
pub mod schema;

use rusqlite::{Connection, Result as SqliteResult};
use std::path::{Path, PathBuf};

pub use history::{insert_history, list_history, HistoryInsert, HistoryRow};
pub use profiles::{
    delete_profile, get_profile, list_profiles, upsert_profile, ProfileRow,
};
pub use schema::migrate;

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
