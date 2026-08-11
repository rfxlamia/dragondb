//! Query history insert/list helpers (internal; not exposed via IPC in SP-2).

use rusqlite::{params, Connection, Result as SqliteResult};
use uuid::Uuid;

/// Input for inserting a query history row.
#[derive(Debug, Clone)]
pub struct HistoryInsert {
    pub profile_id: Option<String>,
    pub sql: String,
    pub success: bool,
    pub error_message: Option<String>,
    pub duration_ms: i64,
    pub row_count: Option<i64>,
}

/// Persisted query history row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HistoryRow {
    pub id: String,
    pub profile_id: Option<String>,
    pub sql: String,
    pub success: bool,
    pub error_message: Option<String>,
    pub duration_ms: i64,
    pub row_count: Option<i64>,
    pub created_at: String,
}

/// Insert a history entry (success or failure).
pub fn insert_history(conn: &Connection, entry: HistoryInsert) -> SqliteResult<String> {
    let id = Uuid::new_v4().to_string();
    let created_at = chrono_like_utc_now();
    conn.execute(
        r#"
        INSERT INTO query_history (
            id, profile_id, sql, success, error_message, duration_ms, row_count, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        "#,
        params![
            id,
            entry.profile_id,
            entry.sql,
            entry.success as i64,
            entry.error_message,
            entry.duration_ms,
            entry.row_count,
            created_at,
        ],
    )?;
    Ok(id)
}

/// List recent history rows (newest first), capped by `limit`.
pub fn list_history(conn: &Connection, limit: i64) -> SqliteResult<Vec<HistoryRow>> {
    let mut stmt = conn.prepare(
        r#"
        SELECT id, profile_id, sql, success, error_message, duration_ms, row_count, created_at
        FROM query_history
        ORDER BY created_at DESC, id DESC
        LIMIT ?1
        "#,
    )?;
    let rows = stmt
        .query_map(params![limit], |row| {
            Ok(HistoryRow {
                id: row.get(0)?,
                profile_id: row.get(1)?,
                sql: row.get(2)?,
                success: row.get::<_, i64>(3)? != 0,
                error_message: row.get(4)?,
                duration_ms: row.get(5)?,
                row_count: row.get(6)?,
                created_at: row.get(7)?,
            })
        })?
        .collect::<SqliteResult<Vec<_>>>()?;
    Ok(rows)
}

/// RFC3339-ish UTC timestamp without pulling in chrono (sufficient for ordering).
fn chrono_like_utc_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::schema::migrate;
    use rusqlite::Connection;

    #[test]
    fn insert_history_persists_success_and_failure_rows() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        insert_history(
            &conn,
            HistoryInsert {
                profile_id: Some("p1".into()),
                sql: "SELECT 1".into(),
                success: true,
                error_message: None,
                duration_ms: 12,
                row_count: Some(1),
            },
        )
        .unwrap();
        insert_history(
            &conn,
            HistoryInsert {
                profile_id: Some("p1".into()),
                sql: "SELECT bad".into(),
                success: false,
                error_message: Some("relation does not exist".into()),
                duration_ms: 3,
                row_count: None,
            },
        )
        .unwrap();
        let rows = list_history(&conn, 10).unwrap();
        assert_eq!(rows.len(), 2);
        assert!(rows.iter().any(|r| r.success && r.sql == "SELECT 1"));
        assert!(rows.iter().any(|r| !r.success && r.error_message.is_some()));
    }
}
