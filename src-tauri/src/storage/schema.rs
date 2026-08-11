//! SQLite schema migration for SP-2 storage.
//!
//! Profile rows store path hints only — no password/ssh secret columns.
//! `saved_queries` / `query_folders` / `tab_states` are DDL-only stubs for SP-3/SP-4b.

use rusqlite::{Connection, Result as SqliteResult};

/// Create the five Swift-parity model tables (idempotent).
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
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

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
    fn unused_model_tables_exist_as_ddl_only() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).expect("migrate");
        // Minimal identity columns so tables exist for later SP-3/SP-4b — no CRUD helpers in SP-2.
        for table in ["saved_queries", "query_folders", "tab_states"] {
            let mut stmt = conn
                .prepare(&format!("PRAGMA table_info({table})"))
                .unwrap();
            let cols: Vec<String> = stmt
                .query_map([], |row| row.get::<_, String>(1))
                .unwrap()
                .map(|r| r.unwrap())
                .collect();
            assert!(
                cols.iter().any(|c| c == "id"),
                "{table} must at least have id"
            );
        }
    }
}
