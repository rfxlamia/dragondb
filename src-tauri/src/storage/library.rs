//! Saved query + folder CRUD helpers (internal; IPC in Phase B).

use rusqlite::{params, Connection, OptionalExtension, Result as SqliteResult};
use uuid::Uuid;

/// Folder row (Swift QueryFolder parity).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FolderRow {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
}

/// Saved query row (Swift SavedQuery parity).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SavedQueryRow {
    pub id: String,
    pub name: String,
    pub query_text: String,
    pub connection_id: Option<String>,
    pub database_name: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub folder_id: Option<String>,
}

/// Write input for create/update saved query.
#[derive(Debug, Clone)]
pub struct SavedQueryWrite {
    pub id: Option<String>,
    pub name: String,
    pub query_text: String,
    pub connection_id: Option<String>,
    pub database_name: Option<String>,
    pub folder_id: Option<String>,
}

fn utc_now_millis() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("{millis}")
}

fn map_folder_row(row: &rusqlite::Row<'_>) -> SqliteResult<FolderRow> {
    Ok(FolderRow {
        id: row.get(0)?,
        name: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
        created_at: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
        updated_at: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
    })
}

fn map_saved_query_row(row: &rusqlite::Row<'_>) -> SqliteResult<SavedQueryRow> {
    Ok(SavedQueryRow {
        id: row.get(0)?,
        name: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
        query_text: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
        connection_id: row.get(3)?,
        database_name: row.get(4)?,
        created_at: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
        updated_at: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
        folder_id: row.get(7)?,
    })
}

const FOLDER_SELECT: &str = "id, name, created_at, updated_at";
const SAVED_QUERY_SELECT: &str =
    "id, name, query_text, connection_id, database_name, created_at, updated_at, folder_id";

/// Create a query folder; returns new id.
pub fn create_folder(conn: &Connection, name: &str) -> SqliteResult<String> {
    let id = Uuid::new_v4().to_string();
    let now = utc_now_millis();
    conn.execute(
        r#"
        INSERT INTO query_folders (id, name, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4)
        "#,
        params![id, name, now, now],
    )?;
    Ok(id)
}

/// List all folders (name, then id).
pub fn list_folders(conn: &Connection) -> SqliteResult<Vec<FolderRow>> {
    let sql = format!("SELECT {FOLDER_SELECT} FROM query_folders ORDER BY name, id");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map([], map_folder_row)?
        .collect::<SqliteResult<Vec<_>>>()?;
    Ok(rows)
}

/// Rename a folder and bump `updated_at`.
pub fn rename_folder(conn: &Connection, id: &str, name: &str) -> SqliteResult<()> {
    let now = utc_now_millis();
    let n = conn.execute(
        "UPDATE query_folders SET name = ?1, updated_at = ?2 WHERE id = ?3",
        params![name, now, id],
    )?;
    if n == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }
    Ok(())
}

/// Delete a folder. `delete_queries=false` nullifies `folder_id`; `true` cascades.
pub fn delete_folder(conn: &Connection, id: &str, delete_queries: bool) -> SqliteResult<()> {
    let tx = conn.unchecked_transaction()?;
    if delete_queries {
        tx.execute(
            "DELETE FROM saved_queries WHERE folder_id = ?1",
            params![id],
        )?;
    } else {
        tx.execute(
            "UPDATE saved_queries SET folder_id = NULL WHERE folder_id = ?1",
            params![id],
        )?;
    }
    tx.execute("DELETE FROM query_folders WHERE id = ?1", params![id])?;
    tx.commit()?;
    Ok(())
}

/// Insert or update a saved query; bumps `updated_at` on update. Returns id.
///
/// When `write.id` is `Some`, this is UPDATE-only: **0 matching rows** yields
/// `Error::QueryReturnedNoRows` so the IPC layer can map a clear error.
/// When `write.id` is `None`, inserts a new row (generated uuid).
/// For IPC create with a client-generated id, use [`insert_saved_query_with_id`].
pub fn save_saved_query(conn: &Connection, write: SavedQueryWrite) -> SqliteResult<String> {
    let now = utc_now_millis();
    if let Some(ref id) = write.id {
        let n = conn.execute(
            r#"
            UPDATE saved_queries SET
                name = ?1,
                query_text = ?2,
                connection_id = ?3,
                database_name = ?4,
                folder_id = ?5,
                updated_at = ?6
            WHERE id = ?7
            "#,
            params![
                write.name,
                write.query_text,
                write.connection_id,
                write.database_name,
                write.folder_id,
                now,
                id,
            ],
        )?;
        if n == 0 {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }
        Ok(id.clone())
    } else {
        let id = Uuid::new_v4().to_string();
        conn.execute(
            r#"
            INSERT INTO saved_queries (
                id, name, query_text, connection_id, database_name,
                created_at, updated_at, folder_id
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            "#,
            params![
                id,
                write.name,
                write.query_text,
                write.connection_id,
                write.database_name,
                now,
                now,
                write.folder_id,
            ],
        )?;
        Ok(id)
    }
}

/// Insert a saved query with an explicit id (IPC create with client-generated uuid).
pub fn insert_saved_query_with_id(
    conn: &Connection,
    id: &str,
    write: SavedQueryWrite,
) -> SqliteResult<()> {
    let now = utc_now_millis();
    conn.execute(
        r#"
        INSERT INTO saved_queries (
            id, name, query_text, connection_id, database_name,
            created_at, updated_at, folder_id
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        "#,
        params![
            id,
            write.name,
            write.query_text,
            write.connection_id,
            write.database_name,
            now,
            now,
            write.folder_id,
        ],
    )?;
    Ok(())
}

/// Fetch one saved query by id.
pub fn get_saved_query(conn: &Connection, id: &str) -> SqliteResult<Option<SavedQueryRow>> {
    let sql = format!("SELECT {SAVED_QUERY_SELECT} FROM saved_queries WHERE id = ?1");
    conn.query_row(&sql, params![id], map_saved_query_row)
        .optional()
}

/// List all saved queries (name, then id).
pub fn list_saved_queries(conn: &Connection) -> SqliteResult<Vec<SavedQueryRow>> {
    let sql = format!("SELECT {SAVED_QUERY_SELECT} FROM saved_queries ORDER BY name, id");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map([], map_saved_query_row)?
        .collect::<SqliteResult<Vec<_>>>()?;
    Ok(rows)
}

/// Duplicate a saved query (new id; copy fields; fresh timestamps).
pub fn duplicate_saved_query(conn: &Connection, id: &str) -> SqliteResult<String> {
    let src = get_saved_query(conn, id)?.ok_or_else(|| rusqlite::Error::QueryReturnedNoRows)?;
    save_saved_query(
        conn,
        SavedQueryWrite {
            id: None,
            name: src.name,
            query_text: src.query_text,
            connection_id: src.connection_id,
            database_name: src.database_name,
            folder_id: src.folder_id,
        },
    )
}

/// Move a saved query to a folder, or unfolder when `folder_id` is `None`.
pub fn move_saved_query(conn: &Connection, id: &str, folder_id: Option<&str>) -> SqliteResult<()> {
    let now = utc_now_millis();
    let n = conn.execute(
        "UPDATE saved_queries SET folder_id = ?1, updated_at = ?2 WHERE id = ?3",
        params![folder_id, now, id],
    )?;
    if n == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }
    Ok(())
}

/// Delete multiple saved queries by id.
pub fn delete_saved_queries(conn: &Connection, ids: &[&str]) -> SqliteResult<()> {
    if ids.is_empty() {
        return Ok(());
    }
    let tx = conn.unchecked_transaction()?;
    for id in ids {
        tx.execute("DELETE FROM saved_queries WHERE id = ?1", params![id])?;
    }
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::schema::migrate;
    use rusqlite::Connection;
    use std::thread;
    use std::time::Duration;

    fn open() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        conn
    }

    #[test]
    fn folder_and_query_crud_move_duplicate_and_updated_at() {
        let conn = open();
        let folder_id = create_folder(&conn, "Analytics").unwrap();
        let folders = list_folders(&conn).unwrap();
        assert_eq!(folders.len(), 1);
        assert_eq!(folders[0].name, "Analytics");

        rename_folder(&conn, &folder_id, "Reports").unwrap();
        assert_eq!(list_folders(&conn).unwrap()[0].name, "Reports");

        let qid = save_saved_query(
            &conn,
            SavedQueryWrite {
                id: None,
                name: "q1".into(),
                query_text: "SELECT 1".into(),
                connection_id: Some("c1".into()),
                database_name: Some("app".into()),
                folder_id: Some(folder_id.clone()),
            },
        )
        .unwrap();
        let got = get_saved_query(&conn, &qid).unwrap().expect("row");
        assert_eq!(got.name, "q1");
        assert_eq!(got.folder_id.as_deref(), Some(folder_id.as_str()));
        let before = got.updated_at.clone();

        thread::sleep(Duration::from_millis(2));
        save_saved_query(
            &conn,
            SavedQueryWrite {
                id: Some(qid.clone()),
                name: "q1-renamed".into(),
                query_text: "SELECT 2".into(),
                connection_id: Some("c1".into()),
                database_name: Some("app".into()),
                folder_id: Some(folder_id.clone()),
            },
        )
        .unwrap();
        let updated = get_saved_query(&conn, &qid).unwrap().unwrap();
        assert_eq!(updated.name, "q1-renamed");
        assert_ne!(updated.updated_at, before);

        let dup_id = duplicate_saved_query(&conn, &qid).unwrap();
        assert_ne!(dup_id, qid);
        assert_eq!(list_saved_queries(&conn).unwrap().len(), 2);

        move_saved_query(&conn, &qid, None).unwrap(); // unfolder
        assert!(get_saved_query(&conn, &qid)
            .unwrap()
            .unwrap()
            .folder_id
            .is_none());
        move_saved_query(&conn, &qid, Some(&folder_id)).unwrap();
        assert_eq!(
            get_saved_query(&conn, &qid)
                .unwrap()
                .unwrap()
                .folder_id
                .as_deref(),
            Some(folder_id.as_str())
        );
    }

    #[test]
    fn delete_folder_nullify_vs_cascade() {
        let conn = open();
        let folder_id = create_folder(&conn, "F").unwrap();
        let q1 = save_saved_query(
            &conn,
            SavedQueryWrite {
                id: None,
                name: "a".into(),
                query_text: "SELECT 1".into(),
                connection_id: None,
                database_name: None,
                folder_id: Some(folder_id.clone()),
            },
        )
        .unwrap();
        let q2 = save_saved_query(
            &conn,
            SavedQueryWrite {
                id: None,
                name: "b".into(),
                query_text: "SELECT 2".into(),
                connection_id: None,
                database_name: None,
                folder_id: Some(folder_id.clone()),
            },
        )
        .unwrap();

        // nullify
        delete_folder(&conn, &folder_id, false).unwrap();
        assert!(list_folders(&conn).unwrap().is_empty());
        assert!(get_saved_query(&conn, &q1)
            .unwrap()
            .unwrap()
            .folder_id
            .is_none());
        assert!(get_saved_query(&conn, &q2)
            .unwrap()
            .unwrap()
            .folder_id
            .is_none());

        let folder2 = create_folder(&conn, "F2").unwrap();
        move_saved_query(&conn, &q1, Some(&folder2)).unwrap();
        move_saved_query(&conn, &q2, Some(&folder2)).unwrap();
        delete_folder(&conn, &folder2, true).unwrap(); // cascade
        assert!(get_saved_query(&conn, &q1).unwrap().is_none());
        assert!(get_saved_query(&conn, &q2).unwrap().is_none());
    }

    #[test]
    fn delete_saved_queries_removes_rows() {
        let conn = open();
        let q1 = save_saved_query(
            &conn,
            SavedQueryWrite {
                id: None,
                name: "a".into(),
                query_text: "SELECT 1".into(),
                connection_id: None,
                database_name: None,
                folder_id: None,
            },
        )
        .unwrap();
        let q2 = save_saved_query(
            &conn,
            SavedQueryWrite {
                id: None,
                name: "b".into(),
                query_text: "SELECT 2".into(),
                connection_id: None,
                database_name: None,
                folder_id: None,
            },
        )
        .unwrap();
        delete_saved_queries(&conn, &[&q1, &q2]).unwrap();
        assert!(list_saved_queries(&conn).unwrap().is_empty());
    }

    #[test]
    fn save_update_zero_rows_errors() {
        let conn = open();
        let err = save_saved_query(
            &conn,
            SavedQueryWrite {
                id: Some("missing".into()),
                name: "x".into(),
                query_text: "SELECT 1".into(),
                connection_id: None,
                database_name: None,
                folder_id: None,
            },
        )
        .expect_err("0-row update");
        assert!(matches!(err, rusqlite::Error::QueryReturnedNoRows));
    }

    #[test]
    fn rename_folder_and_move_saved_query_zero_rows_error() {
        let conn = open();
        let err = rename_folder(&conn, "missing", "x").expect_err("0-row rename");
        assert!(matches!(err, rusqlite::Error::QueryReturnedNoRows));
        let err = move_saved_query(&conn, "missing", None).expect_err("0-row move");
        assert!(matches!(err, rusqlite::Error::QueryReturnedNoRows));
    }
}
