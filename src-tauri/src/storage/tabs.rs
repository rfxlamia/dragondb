//! Tab state persistence helpers (internal; IPC in Phase B).
//!
//! Two sync modes (Swift TabService parity):
//! - metadata/text: `include_cached_results=false` — leave blob untouched
//! - results: `update_tab_cached_results` or upsert with `include_cached_results=true`

use rusqlite::{params, Connection, OptionalExtension, Result as SqliteResult};
use uuid::Uuid;

/// Persisted tab row (Swift TabState field set).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TabStateRow {
    pub id: String,
    pub connection_id: Option<String>,
    pub database_name: Option<String>,
    pub query_text: String,
    pub saved_query_id: Option<String>,
    pub is_active: bool,
    pub order_index: i64,
    pub created_at: String,
    pub last_accessed_at: String,
    pub selected_table_schema: Option<String>,
    pub selected_table_name: Option<String>,
    pub selected_schema_filter: Option<String>,
    pub cached_results_data: Option<Vec<u8>>,
    pub cached_column_names: Option<String>,
}

/// Write input for upsert_tab_state.
#[derive(Debug, Clone)]
pub struct TabStateWrite {
    pub id: Option<String>,
    pub connection_id: Option<String>,
    pub database_name: Option<String>,
    pub query_text: String,
    pub saved_query_id: Option<String>,
    pub is_active: bool,
    pub order_index: i64,
    /// Client-provided created_at; insert uses this or server now.
    pub created_at: Option<String>,
    /// Client-provided last_accessed_at; upsert uses this or server now.
    pub last_accessed_at: Option<String>,
    pub selected_table_schema: Option<String>,
    pub selected_table_name: Option<String>,
    pub selected_schema_filter: Option<String>,
    pub include_cached_results: bool,
    pub cached_results_data: Option<Vec<u8>>,
    pub cached_column_names: Option<String>,
}

fn utc_now_millis() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("{millis}")
}

fn map_tab_row(row: &rusqlite::Row<'_>) -> SqliteResult<TabStateRow> {
    Ok(TabStateRow {
        id: row.get(0)?,
        connection_id: row.get(1)?,
        database_name: row.get(2)?,
        query_text: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
        saved_query_id: row.get(4)?,
        is_active: row.get::<_, Option<i64>>(5)?.unwrap_or(0) != 0,
        order_index: row.get::<_, Option<i64>>(6)?.unwrap_or(0),
        created_at: row.get::<_, Option<String>>(7)?.unwrap_or_default(),
        last_accessed_at: row.get::<_, Option<String>>(8)?.unwrap_or_default(),
        selected_table_schema: row.get(9)?,
        selected_table_name: row.get(10)?,
        selected_schema_filter: row.get(11)?,
        cached_results_data: row.get(12)?,
        cached_column_names: row.get(13)?,
    })
}

const TAB_SELECT: &str = "id, connection_id, database_name, query_text, saved_query_id, \
    is_active, order_index, created_at, last_accessed_at, selected_table_schema, \
    selected_table_name, selected_schema_filter, cached_results_data, cached_column_names";

/// Insert or update tab metadata. When `include_cached_results` is false, blob columns
/// are left unchanged on update.
///
/// When `write.id` is `Some`, this is UPDATE-only: **0 matching rows** yields
/// `Error::QueryReturnedNoRows` so the IPC layer can map a clear error.
/// When `write.id` is `None`, inserts a new row (generated uuid).
/// For IPC create with a client-generated id, use [`insert_tab_state_with_id`].
pub fn upsert_tab_state(conn: &Connection, write: TabStateWrite) -> SqliteResult<String> {
    let now = utc_now_millis();
    let last_accessed = write
        .last_accessed_at
        .clone()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| now.clone());
    if let Some(ref id) = write.id {
        let n = if write.include_cached_results {
            conn.execute(
                r#"
                UPDATE tab_states SET
                    connection_id = ?1,
                    database_name = ?2,
                    query_text = ?3,
                    saved_query_id = ?4,
                    is_active = ?5,
                    order_index = ?6,
                    last_accessed_at = ?7,
                    selected_table_schema = ?8,
                    selected_table_name = ?9,
                    selected_schema_filter = ?10,
                    cached_results_data = ?11,
                    cached_column_names = ?12
                WHERE id = ?13
                "#,
                params![
                    write.connection_id,
                    write.database_name,
                    write.query_text,
                    write.saved_query_id,
                    write.is_active as i64,
                    write.order_index,
                    last_accessed,
                    write.selected_table_schema,
                    write.selected_table_name,
                    write.selected_schema_filter,
                    write.cached_results_data,
                    write.cached_column_names,
                    id,
                ],
            )?
        } else {
            conn.execute(
                r#"
                UPDATE tab_states SET
                    connection_id = ?1,
                    database_name = ?2,
                    query_text = ?3,
                    saved_query_id = ?4,
                    is_active = ?5,
                    order_index = ?6,
                    last_accessed_at = ?7,
                    selected_table_schema = ?8,
                    selected_table_name = ?9,
                    selected_schema_filter = ?10
                WHERE id = ?11
                "#,
                params![
                    write.connection_id,
                    write.database_name,
                    write.query_text,
                    write.saved_query_id,
                    write.is_active as i64,
                    write.order_index,
                    last_accessed,
                    write.selected_table_schema,
                    write.selected_table_name,
                    write.selected_schema_filter,
                    id,
                ],
            )?
        };
        if n == 0 {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }
        Ok(id.clone())
    } else {
        let id = Uuid::new_v4().to_string();
        let (blob, cols) = if write.include_cached_results {
            (write.cached_results_data, write.cached_column_names)
        } else {
            (None, None)
        };
        let created = write
            .created_at
            .clone()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| now.clone());
        conn.execute(
            r#"
            INSERT INTO tab_states (
                id, connection_id, database_name, query_text, saved_query_id,
                is_active, order_index, created_at, last_accessed_at,
                selected_table_schema, selected_table_name, selected_schema_filter,
                cached_results_data, cached_column_names
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
            "#,
            params![
                id,
                write.connection_id,
                write.database_name,
                write.query_text,
                write.saved_query_id,
                write.is_active as i64,
                write.order_index,
                created,
                last_accessed,
                write.selected_table_schema,
                write.selected_table_name,
                write.selected_schema_filter,
                blob,
                cols,
            ],
        )?;
        Ok(id)
    }
}

/// Insert a new tab with a client-provided id (IPC create path).
pub fn insert_tab_state_with_id(
    conn: &Connection,
    id: &str,
    write: TabStateWrite,
) -> SqliteResult<()> {
    let now = utc_now_millis();
    let (blob, cols) = if write.include_cached_results {
        (write.cached_results_data, write.cached_column_names)
    } else {
        (None, None)
    };
    let created = write
        .created_at
        .clone()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| now.clone());
    let last_accessed = write
        .last_accessed_at
        .clone()
        .filter(|s| !s.is_empty())
        .unwrap_or(now);
    conn.execute(
        r#"
        INSERT INTO tab_states (
            id, connection_id, database_name, query_text, saved_query_id,
            is_active, order_index, created_at, last_accessed_at,
            selected_table_schema, selected_table_name, selected_schema_filter,
            cached_results_data, cached_column_names
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
        "#,
        params![
            id,
            write.connection_id,
            write.database_name,
            write.query_text,
            write.saved_query_id,
            write.is_active as i64,
            write.order_index,
            created,
            last_accessed,
            write.selected_table_schema,
            write.selected_table_name,
            write.selected_schema_filter,
            blob,
            cols,
        ],
    )?;
    Ok(())
}

/// Write cached results blob + column names JSON (results sync path).
pub fn update_tab_cached_results(
    conn: &Connection,
    id: &str,
    cached_results_data: Option<Vec<u8>>,
    cached_column_names: Option<String>,
) -> SqliteResult<()> {
    conn.execute(
        r#"
        UPDATE tab_states SET
            cached_results_data = ?1,
            cached_column_names = ?2
        WHERE id = ?3
        "#,
        params![cached_results_data, cached_column_names, id],
    )?;
    Ok(())
}

/// Fetch one tab by id.
pub fn get_tab_state(conn: &Connection, id: &str) -> SqliteResult<Option<TabStateRow>> {
    let sql = format!("SELECT {TAB_SELECT} FROM tab_states WHERE id = ?1");
    conn.query_row(&sql, params![id], map_tab_row).optional()
}

/// List all tab states ordered by `order_index`, then id.
pub fn list_tab_states(conn: &Connection) -> SqliteResult<Vec<TabStateRow>> {
    let sql = format!("SELECT {TAB_SELECT} FROM tab_states ORDER BY order_index, id");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map([], map_tab_row)?
        .collect::<SqliteResult<Vec<_>>>()?;
    Ok(rows)
}

/// Delete a tab by id.
pub fn delete_tab_state(conn: &Connection, id: &str) -> SqliteResult<()> {
    conn.execute("DELETE FROM tab_states WHERE id = ?1", params![id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::schema::migrate;
    use rusqlite::Connection;

    fn open() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        conn
    }

    #[test]
    fn tab_metadata_and_results_blob_round_trip() {
        let conn = open();
        let id = upsert_tab_state(
            &conn,
            TabStateWrite {
                id: None,
                connection_id: Some("c1".into()),
                database_name: Some("app".into()),
                query_text: "SELECT 1".into(),
                saved_query_id: None,
                is_active: true,
                order_index: 0,
                created_at: Some("10".into()),
                last_accessed_at: Some("20".into()),
                selected_table_schema: Some("public".into()),
                selected_table_name: Some("users".into()),
                selected_schema_filter: None,
                include_cached_results: false,
                cached_results_data: None,
                cached_column_names: None,
            },
        )
        .unwrap();

        update_tab_cached_results(
            &conn,
            &id,
            Some(b"RAWBLOB".to_vec()),
            Some(r#"["id","name"]"#.into()),
        )
        .unwrap();

        let with_blob = get_tab_state(&conn, &id).unwrap().unwrap();
        assert_eq!(
            with_blob.cached_results_data.as_deref(),
            Some(&b"RAWBLOB"[..])
        );
        assert_eq!(
            with_blob.cached_column_names.as_deref(),
            Some(r#"["id","name"]"#)
        );

        // metadata-only sync must NOT rewrite blob (include_cached_results=false)
        upsert_tab_state(
            &conn,
            TabStateWrite {
                id: Some(id.clone()),
                connection_id: Some("c1".into()),
                database_name: Some("app".into()),
                query_text: "SELECT 2".into(),
                saved_query_id: None,
                is_active: false,
                order_index: 1,
                created_at: None,
                last_accessed_at: Some("30".into()),
                selected_table_schema: Some("public".into()),
                selected_table_name: Some("users".into()),
                selected_schema_filter: Some("public".into()),
                include_cached_results: false,
                cached_results_data: None,
                cached_column_names: None,
            },
        )
        .unwrap();
        let after_meta = get_tab_state(&conn, &id).unwrap().unwrap();
        assert_eq!(after_meta.query_text, "SELECT 2");
        assert_eq!(after_meta.order_index, 1);
        assert!(!after_meta.is_active);
        assert_eq!(
            after_meta.cached_results_data.as_deref(),
            Some(&b"RAWBLOB"[..])
        );
        // Client timestamps round-trip (created preserved from insert; last_accessed from update)
        assert_eq!(after_meta.created_at, "10");
        assert_eq!(after_meta.last_accessed_at, "30");

        delete_tab_state(&conn, &id).unwrap();
        assert!(get_tab_state(&conn, &id).unwrap().is_none());
        assert!(list_tab_states(&conn).unwrap().is_empty());
    }
}
