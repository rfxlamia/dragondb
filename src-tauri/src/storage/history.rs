//! Query history insert/list/delete helpers (internal; not exposed via IPC in Phase A).

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
///
/// When `profile_id` is `Some`, only that profile's rows are returned; `None` ⇒ global.
pub fn list_history(
    conn: &Connection,
    limit: i64,
    profile_id: Option<&str>,
) -> SqliteResult<Vec<HistoryRow>> {
    let map_row = |row: &rusqlite::Row<'_>| {
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
    };

    if let Some(pid) = profile_id {
        let mut stmt = conn.prepare(
            r#"
            SELECT id, profile_id, sql, success, error_message, duration_ms, row_count, created_at
            FROM query_history
            WHERE profile_id = ?1
            ORDER BY created_at DESC, id DESC
            LIMIT ?2
            "#,
        )?;
        let rows = stmt
            .query_map(params![pid, limit], map_row)?
            .collect::<SqliteResult<Vec<_>>>()?;
        Ok(rows)
    } else {
        let mut stmt = conn.prepare(
            r#"
            SELECT id, profile_id, sql, success, error_message, duration_ms, row_count, created_at
            FROM query_history
            ORDER BY created_at DESC, id DESC
            LIMIT ?1
            "#,
        )?;
        let rows = stmt
            .query_map(params![limit], map_row)?
            .collect::<SqliteResult<Vec<_>>>()?;
        Ok(rows)
    }
}

/// Delete a single history row by id.
pub fn delete_history(conn: &Connection, id: &str) -> SqliteResult<()> {
    conn.execute("DELETE FROM query_history WHERE id = ?1", params![id])?;
    Ok(())
}

/// Clear all history rows for a profile (never a global wipe).
pub fn clear_history_for_profile(conn: &Connection, profile_id: &str) -> SqliteResult<()> {
    conn.execute(
        "DELETE FROM query_history WHERE profile_id = ?1",
        params![profile_id],
    )?;
    Ok(())
}

/// Epoch milliseconds (UTC) as a decimal string for `created_at` ordering.
///
/// Millisecond resolution keeps `ORDER BY created_at DESC` stable for rows
/// written in the same second. Digit width grows monotonically with time, so
/// lexicographic comparison on the TEXT column matches numeric order.
fn chrono_like_utc_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("{millis}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::schema::migrate;
    use rusqlite::Connection;

    fn seed(conn: &Connection, profile_id: &str, sql: &str) -> String {
        insert_history(
            conn,
            HistoryInsert {
                profile_id: Some(profile_id.into()),
                sql: sql.into(),
                success: true,
                error_message: None,
                duration_ms: 1,
                row_count: Some(1),
            },
        )
        .unwrap()
    }

    #[test]
    fn list_history_global_and_profile_filter_newest_first() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        let _h_p = seed(&conn, "P", "SELECT p");
        std::thread::sleep(std::time::Duration::from_millis(2));
        let h_q = seed(&conn, "Q", "SELECT q");
        std::thread::sleep(std::time::Duration::from_millis(2));
        let h_p2 = seed(&conn, "P", "SELECT p2");

        // Cross-note vs T1: omitted profileId ⇒ global; Some(profileId) ⇒ filter.
        // Signature lock: list_history(conn, limit, profile_id: Option<&str>)
        let global = list_history(&conn, 10, None).unwrap();
        assert_eq!(global.len(), 3);
        assert_eq!(global[0].id, h_p2);
        assert_eq!(global[1].id, h_q);

        let only_p = list_history(&conn, 10, Some("P")).unwrap();
        assert_eq!(only_p.len(), 2);
        assert!(only_p.iter().all(|r| r.profile_id.as_deref() == Some("P")));
        assert_eq!(only_p[0].sql, "SELECT p2");

        let limited = list_history(&conn, 1, None).unwrap();
        assert_eq!(limited.len(), 1);
        assert_eq!(limited[0].id, h_p2);
    }

    #[test]
    fn delete_history_and_clear_history_for_profile() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        let h1 = seed(&conn, "P", "SELECT 1");
        let h2 = seed(&conn, "P", "SELECT 2");
        let h3 = seed(&conn, "Q", "SELECT 3");

        delete_history(&conn, &h1).unwrap();
        let remaining = list_history(&conn, 10, None).unwrap();
        assert!(!remaining.iter().any(|r| r.id == h1));
        assert_eq!(remaining.len(), 2);

        clear_history_for_profile(&conn, "P").unwrap();
        let after = list_history(&conn, 10, None).unwrap();
        assert_eq!(after.len(), 1);
        assert_eq!(after[0].id, h3);
        assert!(!after.iter().any(|r| r.id == h2));
    }

    #[test]
    fn insert_history_persists_success_and_failure_rows() {
        // Update existing SP-2 call sites to list_history(&conn, 10, None)
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
        let rows = list_history(&conn, 10, None).unwrap();
        assert_eq!(rows.len(), 2);
        assert!(rows.iter().any(|r| r.success && r.sql == "SELECT 1"));
        assert!(rows.iter().any(|r| !r.success && r.error_message.is_some()));
    }
}
