//! Connection profile CRUD (IPC-facing fields only — no secrets in sqlite).

use rusqlite::{params, Connection, OptionalExtension, Result as SqliteResult};

/// Profile row mirrored from ConnectionProfileDto (path hints only; no secrets).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProfileRow {
    pub id: String,
    pub name: Option<String>,
    pub host: String,
    pub port: i64,
    pub username: String,
    pub database: String,
    pub is_favorite: bool,
    pub ssl_mode: String,
    pub ssh_enabled: bool,
    pub ssh_host: Option<String>,
    pub ssh_port: Option<i64>,
    pub ssh_username: Option<String>,
    pub ssh_auth_method: Option<String>,
    pub ssh_private_key_path: Option<String>,
}

fn map_profile_row(row: &rusqlite::Row<'_>) -> SqliteResult<ProfileRow> {
    Ok(ProfileRow {
        id: row.get(0)?,
        name: row.get(1)?,
        host: row.get(2)?,
        port: row.get(3)?,
        username: row.get(4)?,
        database: row.get(5)?,
        is_favorite: row.get::<_, i64>(6)? != 0,
        ssl_mode: row.get(7)?,
        ssh_enabled: row.get::<_, i64>(8)? != 0,
        ssh_host: row.get(9)?,
        ssh_port: row.get(10)?,
        ssh_username: row.get(11)?,
        ssh_auth_method: row.get(12)?,
        ssh_private_key_path: row.get(13)?,
    })
}

const PROFILE_SELECT_COLS: &str = "id, name, host, port, username, database, is_favorite, \
    ssl_mode, ssh_enabled, ssh_host, ssh_port, ssh_username, ssh_auth_method, ssh_private_key_path";

/// Insert or replace a profile row by id.
pub fn upsert_profile(conn: &Connection, profile: &ProfileRow) -> SqliteResult<()> {
    conn.execute(
        r#"
        INSERT INTO connection_profiles (
            id, name, host, port, username, database, is_favorite,
            ssl_mode, ssh_enabled, ssh_host, ssh_port, ssh_username,
            ssh_auth_method, ssh_private_key_path
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            host = excluded.host,
            port = excluded.port,
            username = excluded.username,
            database = excluded.database,
            is_favorite = excluded.is_favorite,
            ssl_mode = excluded.ssl_mode,
            ssh_enabled = excluded.ssh_enabled,
            ssh_host = excluded.ssh_host,
            ssh_port = excluded.ssh_port,
            ssh_username = excluded.ssh_username,
            ssh_auth_method = excluded.ssh_auth_method,
            ssh_private_key_path = excluded.ssh_private_key_path
        "#,
        params![
            profile.id,
            profile.name,
            profile.host,
            profile.port,
            profile.username,
            profile.database,
            profile.is_favorite as i64,
            profile.ssl_mode,
            profile.ssh_enabled as i64,
            profile.ssh_host,
            profile.ssh_port,
            profile.ssh_username,
            profile.ssh_auth_method,
            profile.ssh_private_key_path,
        ],
    )?;
    Ok(())
}

/// Fetch a single profile by id.
pub fn get_profile(conn: &Connection, id: &str) -> SqliteResult<Option<ProfileRow>> {
    let sql = format!("SELECT {PROFILE_SELECT_COLS} FROM connection_profiles WHERE id = ?1");
    conn.query_row(&sql, params![id], map_profile_row)
        .optional()
}

/// List all connection profiles.
pub fn list_profiles(conn: &Connection) -> SqliteResult<Vec<ProfileRow>> {
    let sql = format!("SELECT {PROFILE_SELECT_COLS} FROM connection_profiles ORDER BY name, id");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map([], map_profile_row)?
        .collect::<SqliteResult<Vec<_>>>()?;
    Ok(rows)
}

/// Delete a profile by id.
pub fn delete_profile(conn: &Connection, id: &str) -> SqliteResult<()> {
    conn.execute("DELETE FROM connection_profiles WHERE id = ?1", params![id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::schema::migrate;
    use rusqlite::Connection;

    fn sample_profile(id: &str) -> ProfileRow {
        ProfileRow {
            id: id.to_string(),
            name: Some("dev".into()),
            host: "127.0.0.1".into(),
            port: 5432,
            username: "postgres".into(),
            database: "app".into(),
            is_favorite: false,
            ssl_mode: "prefer".into(),
            ssh_enabled: false,
            ssh_host: None,
            ssh_port: None,
            ssh_username: None,
            ssh_auth_method: None,
            ssh_private_key_path: None,
        }
    }

    #[test]
    fn profile_crud_round_trips_without_secrets() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        let id = "11111111-1111-4111-8111-111111111111";
        upsert_profile(&conn, &sample_profile(id)).unwrap();
        let got = get_profile(&conn, id).unwrap().expect("row");
        assert_eq!(got.host, "127.0.0.1");
        assert_eq!(got.port, 5432);
        assert_eq!(list_profiles(&conn).unwrap().len(), 1);
        let mut updated = sample_profile(id);
        updated.host = "db.internal".into();
        upsert_profile(&conn, &updated).unwrap();
        assert_eq!(get_profile(&conn, id).unwrap().unwrap().host, "db.internal");
        delete_profile(&conn, id).unwrap();
        assert!(get_profile(&conn, id).unwrap().is_none());
    }
}
