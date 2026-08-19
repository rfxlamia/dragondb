//! SQLite schema migration for SP-2/SP-3 storage.
//!
//! Profile rows store path hints only — no password/ssh secret columns.
//! Library/tab tables migrate additively from id-only stubs to Swift-parity columns.

use rusqlite::{Connection, Result as SqliteResult};

/// Create the five Swift-parity model tables and ensure checklist columns exist.
pub fn migrate(conn: &Connection) -> SqliteResult<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS connection_profiles (
            id TEXT PRIMARY KEY NOT NULL,
            name TEXT,
            host TEXT NOT NULL,
            port INTEGER NOT NULL,
            username TEXT NOT NULL,
            database TEXT NOT NULL,
            is_favorite INTEGER NOT NULL DEFAULT 0,
            ssl_mode TEXT NOT NULL,
            ssh_enabled INTEGER NOT NULL DEFAULT 0,
            ssh_host TEXT,
            ssh_port INTEGER,
            ssh_username TEXT,
            ssh_auth_method TEXT,
            ssh_private_key_path TEXT
        );

        CREATE TABLE IF NOT EXISTS saved_queries (
            id TEXT PRIMARY KEY NOT NULL
        );

        CREATE TABLE IF NOT EXISTS query_folders (
            id TEXT PRIMARY KEY NOT NULL
        );

        CREATE TABLE IF NOT EXISTS query_history (
            id TEXT PRIMARY KEY NOT NULL,
            profile_id TEXT,
            sql TEXT NOT NULL,
            success INTEGER NOT NULL,
            error_message TEXT,
            duration_ms INTEGER NOT NULL,
            row_count INTEGER,
            created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_query_history_created_at
            ON query_history(created_at DESC);

        CREATE TABLE IF NOT EXISTS tab_states (
            id TEXT PRIMARY KEY NOT NULL
        );
        "#,
    )?;

    // Additive ensure: CREATE IF NOT EXISTS alone leaves id-only stubs on legacy DBs.
    ensure_column(conn, "query_folders", "name", "TEXT")?;
    ensure_column(conn, "query_folders", "created_at", "TEXT")?;
    ensure_column(conn, "query_folders", "updated_at", "TEXT")?;

    ensure_column(conn, "saved_queries", "name", "TEXT")?;
    ensure_column(conn, "saved_queries", "query_text", "TEXT")?;
    ensure_column(conn, "saved_queries", "connection_id", "TEXT")?;
    ensure_column(conn, "saved_queries", "database_name", "TEXT")?;
    ensure_column(conn, "saved_queries", "created_at", "TEXT")?;
    ensure_column(conn, "saved_queries", "updated_at", "TEXT")?;
    ensure_column(conn, "saved_queries", "folder_id", "TEXT")?;

    ensure_column(conn, "tab_states", "connection_id", "TEXT")?;
    ensure_column(conn, "tab_states", "database_name", "TEXT")?;
    ensure_column(conn, "tab_states", "query_text", "TEXT")?;
    ensure_column(conn, "tab_states", "saved_query_id", "TEXT")?;
    ensure_column(conn, "tab_states", "is_active", "INTEGER")?;
    ensure_column(conn, "tab_states", "order_index", "INTEGER")?;
    ensure_column(conn, "tab_states", "created_at", "TEXT")?;
    ensure_column(conn, "tab_states", "last_accessed_at", "TEXT")?;
    ensure_column(conn, "tab_states", "selected_table_schema", "TEXT")?;
    ensure_column(conn, "tab_states", "selected_table_name", "TEXT")?;
    ensure_column(conn, "tab_states", "selected_schema_filter", "TEXT")?;
    ensure_column(conn, "tab_states", "cached_results_data", "BLOB")?;
    ensure_column(conn, "tab_states", "cached_column_names", "TEXT")?;
    ensure_column(conn, "tab_states", "visual_document_json", "TEXT")?;

    Ok(())
}

/// Add a column if missing (`PRAGMA table_info` + `ALTER TABLE … ADD COLUMN`).
fn ensure_column(conn: &Connection, table: &str, name: &str, type_sql: &str) -> SqliteResult<()> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let cols: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<SqliteResult<Vec<_>>>()?;
    if cols.iter().any(|c| c == name) {
        return Ok(());
    }
    conn.execute(
        &format!("ALTER TABLE {table} ADD COLUMN {name} {type_sql}"),
        [],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tab_states_has_visual_document_json_column() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).expect("migrate");
        assert_has_columns(&conn, "tab_states", &["visual_document_json"]);
    }
    use rusqlite::Connection;

    fn column_names(conn: &Connection, table: &str) -> Vec<String> {
        let mut stmt = conn
            .prepare(&format!("PRAGMA table_info({table})"))
            .unwrap();
        stmt.query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .map(|r| r.unwrap())
            .collect()
    }

    fn assert_has_columns(conn: &Connection, table: &str, required: &[&str]) {
        let cols = column_names(conn, table);
        for name in required {
            assert!(
                cols.iter().any(|c| c == name),
                "{table} missing column: {name}; have {cols:?}"
            );
        }
    }

    #[test]
    fn migrate_creates_five_model_tables() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).expect("migrate");
        let mut stmt = conn
            .prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
            )
            .unwrap();
        let names: Vec<String> = stmt
            .query_map([], |row| row.get(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert_eq!(
            names,
            vec![
                "connection_profiles".to_string(),
                "query_folders".to_string(),
                "query_history".to_string(),
                "saved_queries".to_string(),
                "tab_states".to_string(),
            ]
        );
    }

    #[test]
    fn connection_profiles_has_dto_columns_and_no_secret_columns() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).expect("migrate");
        let mut stmt = conn
            .prepare("PRAGMA table_info(connection_profiles)")
            .unwrap();
        let cols: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        // Locked column set (snake_case; mirrors ConnectionProfileDto — no secrets)
        for required in [
            "id",
            "name",
            "host",
            "port",
            "username",
            "database",
            "is_favorite",
            "ssl_mode",
            "ssh_enabled",
            "ssh_host",
            "ssh_port",
            "ssh_username",
            "ssh_auth_method",
            "ssh_private_key_path",
        ] {
            assert!(
                cols.iter().any(|c| c == required),
                "missing column: {required}"
            );
        }
        for forbidden in [
            "password",
            "sshPassword",
            "ssh_password",
            "sshPassphrase",
            "ssh_passphrase",
            "sshPrivateKey",
            "ssh_private_key",
        ] {
            assert!(
                !cols.iter().any(|c| c == forbidden),
                "secret column present: {forbidden}"
            );
        }
    }

    #[test]
    fn library_and_tab_tables_have_swift_parity_columns() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).expect("migrate");
        assert_has_columns(
            &conn,
            "query_folders",
            &["id", "name", "created_at", "updated_at"],
        );
        assert_has_columns(
            &conn,
            "saved_queries",
            &[
                "id",
                "name",
                "query_text",
                "connection_id",
                "database_name",
                "created_at",
                "updated_at",
                "folder_id",
            ],
        );
        assert_has_columns(
            &conn,
            "tab_states",
            &[
                "id",
                "connection_id",
                "database_name",
                "query_text",
                "saved_query_id",
                "is_active",
                "order_index",
                "created_at",
                "last_accessed_at",
                "selected_table_schema",
                "selected_table_name",
                "selected_schema_filter",
                "cached_results_data",
                "cached_column_names",
            ],
        );
    }

    #[test]
    fn migrate_is_additive_on_id_only_stub_tables() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE saved_queries (id TEXT PRIMARY KEY NOT NULL);
            CREATE TABLE query_folders (id TEXT PRIMARY KEY NOT NULL);
            CREATE TABLE tab_states (id TEXT PRIMARY KEY NOT NULL);
            "#,
        )
        .unwrap();
        conn.execute("INSERT INTO saved_queries (id) VALUES ('legacy')", [])
            .unwrap();
        migrate(&conn).expect("additive migrate");
        assert_has_columns(
            &conn,
            "saved_queries",
            &["id", "name", "query_text", "folder_id"],
        );
        let id: String = conn
            .query_row("SELECT id FROM saved_queries WHERE id='legacy'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(id, "legacy");
    }
}
