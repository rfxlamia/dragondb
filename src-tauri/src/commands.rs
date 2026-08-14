//! Thin Tauri command adapters over `AppSession`.
//!
//! Command names and camelCase DTOs are locked for the TS DragonIpc client (T8).
//! Errors reject as `MappedIpcError` objects (`{ kind, message, position? }`).
//! No createDatabase / deleteDatabase commands.

use serde::{Deserialize, Serialize};
use tauri::State;
use tokio::sync::Mutex;

use crate::postgres::{
    ColumnInfoRow, IpcErrorKind, MappedIpcError, QueryResultData, RowOperationError, TableRefRow,
};
use crate::session::{
    AppSession, ConnectResult, ExecutableSql, ProfileFields, ProfileSecretsInput,
    SaveProfileInput, SavedQueryWriteInput, TabStateWriteInput, TableRefArg,
};
use crate::storage::{FolderRow, HistoryRow, ProfileRow, SavedQueryRow, TabStateRow};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionProfileDto {
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

impl From<ProfileRow> for ConnectionProfileDto {
    fn from(row: ProfileRow) -> Self {
        Self {
            id: row.id,
            name: row.name,
            host: row.host,
            port: row.port,
            username: row.username,
            database: row.database,
            is_favorite: row.is_favorite,
            ssl_mode: row.ssl_mode,
            ssh_enabled: row.ssh_enabled,
            ssh_host: row.ssh_host,
            ssh_port: row.ssh_port,
            ssh_username: row.ssh_username,
            ssh_auth_method: row.ssh_auth_method,
            ssh_private_key_path: row.ssh_private_key_path,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedQueryDto {
    pub id: String,
    pub name: String,
    pub query_text: String,
    pub connection_id: Option<String>,
    pub database_name: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub folder_id: Option<String>,
}

impl From<SavedQueryRow> for SavedQueryDto {
    fn from(row: SavedQueryRow) -> Self {
        Self {
            id: row.id,
            name: row.name,
            query_text: row.query_text,
            connection_id: row.connection_id,
            database_name: row.database_name,
            created_at: row.created_at,
            updated_at: row.updated_at,
            folder_id: row.folder_id,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryFolderDto {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
}

impl From<FolderRow> for QueryFolderDto {
    fn from(row: FolderRow) -> Self {
        Self {
            id: row.id,
            name: row.name,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

#[tauri::command]
pub async fn list_profiles(
    state: State<'_, Mutex<AppSession>>,
) -> Result<Vec<ConnectionProfileDto>, MappedIpcError> {
    let session = state.lock().await;
    let rows = session.list_profiles()?;
    Ok(rows.into_iter().map(ConnectionProfileDto::from).collect())
}

#[tauri::command]
pub async fn get_profile(
    state: State<'_, Mutex<AppSession>>,
    id: String,
) -> Result<Option<ConnectionProfileDto>, MappedIpcError> {
    let session = state.lock().await;
    Ok(session.get_profile(&id)?.map(ConnectionProfileDto::from))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn save_profile(
    state: State<'_, Mutex<AppSession>>,
    id: Option<String>,
    profile: ProfileFields,
    secrets: ProfileSecretsInput,
) -> Result<ConnectionProfileDto, MappedIpcError> {
    let mut session = state.lock().await;
    let row = session
        .save_profile(SaveProfileInput {
            id,
            profile,
            secrets,
        })
        .await?;
    Ok(ConnectionProfileDto::from(row))
}

#[tauri::command]
pub async fn delete_profile(
    state: State<'_, Mutex<AppSession>>,
    id: String,
) -> Result<(), MappedIpcError> {
    let mut session = state.lock().await;
    session.delete_profile(&id).await
}

#[tauri::command]
pub async fn connect_profile(
    state: State<'_, Mutex<AppSession>>,
    id: String,
) -> Result<ConnectResult, MappedIpcError> {
    let mut session = state.lock().await;
    session.connect_profile(&id).await
}

#[tauri::command]
pub async fn disconnect(state: State<'_, Mutex<AppSession>>) -> Result<(), MappedIpcError> {
    let mut session = state.lock().await;
    session.disconnect().await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_tables(
    state: State<'_, Mutex<AppSession>>,
    connection_id: String,
) -> Result<Vec<TableRefRow>, MappedIpcError> {
    let mut session = state.lock().await;
    session.list_tables(&connection_id).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_columns(
    state: State<'_, Mutex<AppSession>>,
    connection_id: String,
    table: TableRefArg,
) -> Result<Vec<ColumnInfoRow>, MappedIpcError> {
    let mut session = state.lock().await;
    session.list_columns(&connection_id, &table).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn run_query(
    state: State<'_, Mutex<AppSession>>,
    connection_id: String,
    sql: ExecutableSql,
) -> Result<QueryResultData, MappedIpcError> {
    let mut session = state.lock().await;
    session.run_query(&connection_id, sql).await
}

// --- Library commands (no &Connection; AppSession thin wrappers) ------------

#[tauri::command]
pub async fn list_saved_queries(
    state: State<'_, Mutex<AppSession>>,
) -> Result<Vec<SavedQueryDto>, MappedIpcError> {
    let session = state.lock().await;
    let rows = session.list_saved_queries()?;
    Ok(rows.into_iter().map(SavedQueryDto::from).collect())
}

#[tauri::command]
pub async fn get_saved_query(
    state: State<'_, Mutex<AppSession>>,
    id: String,
) -> Result<Option<SavedQueryDto>, MappedIpcError> {
    let session = state.lock().await;
    Ok(session.get_saved_query(&id)?.map(SavedQueryDto::from))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn save_saved_query(
    state: State<'_, Mutex<AppSession>>,
    query: SavedQueryWriteInput,
) -> Result<SavedQueryDto, MappedIpcError> {
    let session = state.lock().await;
    Ok(SavedQueryDto::from(session.save_saved_query(query)?))
}

#[tauri::command]
pub async fn delete_saved_queries(
    state: State<'_, Mutex<AppSession>>,
    ids: Vec<String>,
) -> Result<(), MappedIpcError> {
    let session = state.lock().await;
    session.delete_saved_queries(&ids)
}

#[tauri::command]
pub async fn duplicate_saved_query(
    state: State<'_, Mutex<AppSession>>,
    id: String,
) -> Result<SavedQueryDto, MappedIpcError> {
    let session = state.lock().await;
    Ok(SavedQueryDto::from(session.duplicate_saved_query(&id)?))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn move_saved_query(
    state: State<'_, Mutex<AppSession>>,
    id: String,
    folder_id: Option<String>,
) -> Result<(), MappedIpcError> {
    let session = state.lock().await;
    session.move_saved_query(&id, folder_id.as_deref())
}

#[tauri::command]
pub async fn list_folders(
    state: State<'_, Mutex<AppSession>>,
) -> Result<Vec<QueryFolderDto>, MappedIpcError> {
    let session = state.lock().await;
    let rows = session.list_folders()?;
    Ok(rows.into_iter().map(QueryFolderDto::from).collect())
}

#[tauri::command]
pub async fn create_folder(
    state: State<'_, Mutex<AppSession>>,
    name: String,
) -> Result<QueryFolderDto, MappedIpcError> {
    let session = state.lock().await;
    Ok(QueryFolderDto::from(session.create_folder(&name)?))
}

#[tauri::command]
pub async fn rename_folder(
    state: State<'_, Mutex<AppSession>>,
    id: String,
    name: String,
) -> Result<(), MappedIpcError> {
    let session = state.lock().await;
    session.rename_folder(&id, &name)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn delete_folder(
    state: State<'_, Mutex<AppSession>>,
    id: String,
    delete_queries: bool,
) -> Result<(), MappedIpcError> {
    let session = state.lock().await;
    session.delete_folder(&id, delete_queries)
}

// --- History commands (no &Connection; AppSession thin wrappers) ------------

/// History IPC DTO — `profileId` is required; NULL DB rows are skipped at map time.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryDto {
    pub id: String,
    pub profile_id: String,
    pub sql: String,
    pub success: bool,
    pub error_message: Option<String>,
    pub duration_ms: i64,
    pub row_count: Option<i64>,
    pub created_at: String,
}

/// Map a storage row → DTO. Returns `None` when `profile_id` is NULL (do not coerce to `""`).
fn history_dto_from_row(row: HistoryRow) -> Option<HistoryDto> {
    let profile_id = row.profile_id?;
    Some(HistoryDto {
        id: row.id,
        profile_id,
        sql: row.sql,
        success: row.success,
        error_message: row.error_message,
        duration_ms: row.duration_ms,
        row_count: row.row_count,
        created_at: row.created_at,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_history(
    state: State<'_, Mutex<AppSession>>,
    limit: i64,
    profile_id: Option<String>,
) -> Result<Vec<HistoryDto>, MappedIpcError> {
    let session = state.lock().await;
    let rows = session.list_history(limit, profile_id.as_deref())?;
    Ok(rows.into_iter().filter_map(history_dto_from_row).collect())
}

#[tauri::command]
pub async fn delete_history(
    state: State<'_, Mutex<AppSession>>,
    id: String,
) -> Result<(), MappedIpcError> {
    let session = state.lock().await;
    session.delete_history(&id)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn clear_history(
    state: State<'_, Mutex<AppSession>>,
    profile_id: String,
) -> Result<(), MappedIpcError> {
    let session = state.lock().await;
    session.clear_history_for_profile(&profile_id)
}

// --- Tabs commands (no &Connection; AppSession thin wrappers) ---------------

/// Tab IPC DTO — TS `order` ↔ Rust `order_index`; `cachedResultsData` is UTF-8 JSON text.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabStateDto {
    pub id: String,
    pub connection_id: Option<String>,
    pub database_name: Option<String>,
    pub query_text: String,
    pub saved_query_id: Option<String>,
    pub is_active: bool,
    pub order: i64,
    pub created_at: String,
    pub last_accessed_at: String,
    pub selected_table_schema: Option<String>,
    pub selected_table_name: Option<String>,
    pub selected_schema_filter: Option<String>,
    /// Opaque JSON string (UTF-8 bytes on the wire to sqlite BLOB — not base64).
    pub cached_results_data: Option<String>,
    pub cached_column_names: Option<Vec<String>>,
}

impl From<TabStateRow> for TabStateDto {
    fn from(row: TabStateRow) -> Self {
        let cached_results_data = row.cached_results_data.and_then(|bytes| {
            String::from_utf8(bytes).ok()
        });
        let cached_column_names = row.cached_column_names.and_then(|s| {
            serde_json::from_str(&s).ok()
        });
        Self {
            id: row.id,
            connection_id: row.connection_id,
            database_name: row.database_name,
            query_text: row.query_text,
            saved_query_id: row.saved_query_id,
            is_active: row.is_active,
            order: row.order_index,
            created_at: row.created_at,
            last_accessed_at: row.last_accessed_at,
            selected_table_schema: row.selected_table_schema,
            selected_table_name: row.selected_table_name,
            selected_schema_filter: row.selected_schema_filter,
            cached_results_data,
            cached_column_names,
        }
    }
}

fn tab_write_input_from_dto(dto: TabStateDto) -> TabStateWriteInput {
    TabStateWriteInput {
        id: dto.id,
        connection_id: dto.connection_id,
        database_name: dto.database_name,
        query_text: dto.query_text,
        saved_query_id: dto.saved_query_id,
        is_active: dto.is_active,
        order: dto.order,
        created_at: Some(dto.created_at),
        last_accessed_at: Some(dto.last_accessed_at),
        selected_table_schema: dto.selected_table_schema,
        selected_table_name: dto.selected_table_name,
        selected_schema_filter: dto.selected_schema_filter,
        cached_results_data: dto.cached_results_data,
        cached_column_names: dto.cached_column_names,
    }
}

#[tauri::command]
pub async fn list_tab_states(
    state: State<'_, Mutex<AppSession>>,
) -> Result<Vec<TabStateDto>, MappedIpcError> {
    let session = state.lock().await;
    let rows = session.list_tab_states()?;
    Ok(rows.into_iter().map(TabStateDto::from).collect())
}

/// Create-or-update: inserts when id is absent; UPDATE with 0 rows → error.
#[tauri::command(rename_all = "camelCase")]
pub async fn save_tab_state(
    state: State<'_, Mutex<AppSession>>,
    input: TabStateDto,
    include_cached_results: bool,
) -> Result<(), MappedIpcError> {
    let session = state.lock().await;
    let id = input.id.clone();
    let write = tab_write_input_from_dto(input);
    let exists = session.get_tab_state(&id)?.is_some();
    if exists {
        session.save_tab_state(write, include_cached_results)
    } else {
        session.insert_tab_state(write, include_cached_results)
    }
}

#[tauri::command]
pub async fn delete_tab_state(
    state: State<'_, Mutex<AppSession>>,
    id: String,
) -> Result<(), MappedIpcError> {
    let session = state.lock().await;
    session.delete_tab_state(&id)
}

// --- Row ops + CSV save -----------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveCsvFileResult {
    pub canceled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn update_row(
    state: State<'_, Mutex<AppSession>>,
    connection_id: String,
    table: TableRefArg,
    primary_key: serde_json::Map<String, serde_json::Value>,
    patch: serde_json::Map<String, serde_json::Value>,
) -> Result<(), RowOperationError> {
    let mut session = state.lock().await;
    session
        .update_row(&connection_id, &table, &primary_key, &patch)
        .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn delete_rows(
    state: State<'_, Mutex<AppSession>>,
    connection_id: String,
    table: TableRefArg,
    primary_keys: Vec<serde_json::Map<String, serde_json::Value>>,
) -> Result<(), RowOperationError> {
    let mut session = state.lock().await;
    session
        .delete_rows(&connection_id, &table, &primary_keys)
        .await
}

/// Save CSV via native save dialog. Cancel → `{ canceled: true }` (no write, no throw).
#[tauri::command(rename_all = "camelCase")]
pub async fn save_csv_file(
    app: tauri::AppHandle,
    csv_text: String,
    default_path: Option<String>,
) -> Result<SaveCsvFileResult, MappedIpcError> {
    use tauri_plugin_dialog::DialogExt;

    let mut builder = app.dialog().file().add_filter("CSV", &["csv"]);
    if let Some(name) = default_path.as_deref() {
        builder = builder.set_file_name(name);
    }

    let Some(file_path) = builder.blocking_save_file() else {
        return Ok(SaveCsvFileResult {
            canceled: true,
            path: None,
        });
    };

    let path_buf = file_path.into_path().map_err(|e| MappedIpcError {
        kind: IpcErrorKind::Unknown,
        message: format!("Invalid save path: {e}"),
        position: None,
    })?;

    let written = tauri::async_runtime::spawn_blocking(move || {
        std::fs::write(&path_buf, csv_text.as_bytes()).map(|()| path_buf)
    })
    .await
    .map_err(|e| MappedIpcError {
        kind: IpcErrorKind::Unknown,
        message: format!("CSV write task failed: {e}"),
        position: None,
    })?
    .map_err(|e| MappedIpcError {
        kind: IpcErrorKind::Unknown,
        message: format!("Failed to write CSV file: {e}"),
        position: None,
    })?;

    Ok(SaveCsvFileResult {
        canceled: false,
        path: Some(written.to_string_lossy().into_owned()),
    })
}

#[cfg(test)]
mod tests {
    use super::{history_dto_from_row, HistoryDto, SavedQueryDto, TabStateDto};
    use crate::postgres::{IpcErrorKind, MappedIpcError};
    use crate::session::{AppSession, SavedQueryWriteInput, TabStateWriteInput};
    use crate::storage::{save_saved_query, SavedQueryWrite};
    use std::path::PathBuf;

    fn temp_session() -> (AppSession, PathBuf) {
        let dir = std::env::temp_dir().join(format!("dragondb-lib-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let session = AppSession::open(&dir).expect("open temp session");
        (session, dir)
    }

    fn sample_tab(id: &str) -> TabStateWriteInput {
        TabStateWriteInput {
            id: id.into(),
            connection_id: Some("c1".into()),
            database_name: Some("app".into()),
            query_text: "SELECT 1".into(),
            saved_query_id: None,
            is_active: true,
            order: 0,
            created_at: Some("1".into()),
            last_accessed_at: Some("1".into()),
            selected_table_schema: None,
            selected_table_name: None,
            selected_schema_filter: None,
            cached_results_data: None,
            cached_column_names: None,
        }
    }

    #[test]
    fn mapped_ipc_error_serializes_lowercase_kind_object() {
        let err = MappedIpcError {
            kind: IpcErrorKind::Auth,
            message: "Authentication failed".into(),
            position: None,
        };
        let v = serde_json::to_value(&err).unwrap();
        assert_eq!(v["kind"], "auth");
        assert_eq!(v["message"], "Authentication failed");
        assert!(v.get("position").is_none());
    }

    #[test]
    fn connect_result_dto_uses_camel_case() {
        #[derive(serde::Serialize)]
        #[serde(rename_all = "camelCase")]
        struct ConnectResultDto {
            connection_id: String,
            profile_id: String,
            database: String,
        }
        let v = serde_json::to_value(ConnectResultDto {
            connection_id: "c1".into(),
            profile_id: "p1".into(),
            database: "app".into(),
        })
        .unwrap();
        assert_eq!(v["connectionId"], "c1");
        assert_eq!(v["profileId"], "p1");
        assert_eq!(v["database"], "app");
    }

    #[test]
    fn saved_query_dto_serializes_camel_case() {
        let v = serde_json::to_value(SavedQueryDto {
            id: "q1".into(),
            name: "n".into(),
            query_text: "SELECT 1".into(),
            connection_id: None,
            database_name: None,
            created_at: "1".into(),
            updated_at: "2".into(),
            folder_id: None,
        })
        .unwrap();
        assert_eq!(v["queryText"], "SELECT 1");
        assert_eq!(v["folderId"], serde_json::Value::Null);
        assert_eq!(v["createdAt"], "1");
    }

    #[test]
    fn library_nullify_vs_cascade_via_temp_production_session() {
        let (session, _dir) = temp_session();
        let folder = session.create_folder("F").unwrap();
        let q = session
            .save_saved_query(SavedQueryWriteInput {
                id: "q1".into(),
                name: "a".into(),
                query_text: "SELECT 1".into(),
                connection_id: None,
                database_name: None,
                folder_id: Some(folder.id.clone()),
                created_at: None,
                updated_at: None,
            })
            .unwrap();
        assert_eq!(q.folder_id.as_deref(), Some(folder.id.as_str()));

        // nullify
        session.delete_folder(&folder.id, false).unwrap();
        let after = session.get_saved_query("q1").unwrap().unwrap();
        assert!(after.folder_id.is_none());

        // cascade
        let folder2 = session.create_folder("F2").unwrap();
        session
            .move_saved_query("q1", Some(folder2.id.as_str()))
            .unwrap();
        session.delete_folder(&folder2.id, true).unwrap();
        assert!(session.get_saved_query("q1").unwrap().is_none());
    }

    #[test]
    fn save_saved_query_zero_row_update_errors() {
        // Storage-level oracle: UPDATE with missing id → QueryReturnedNoRows
        // (session maps this to MappedIpcError { kind: unknown, message: "save_saved_query: no rows updated" }).
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::storage::migrate(&conn).unwrap();
        let err = save_saved_query(
            &conn,
            SavedQueryWrite {
                id: Some("no-such".into()),
                name: "x".into(),
                query_text: "SELECT 1".into(),
                connection_id: None,
                database_name: None,
                folder_id: None,
            },
        )
        .expect_err("0-row update");
        assert!(matches!(err, rusqlite::Error::QueryReturnedNoRows));

        let (session, _dir) = temp_session();
        session
            .save_saved_query(SavedQueryWriteInput {
                id: "q1".into(),
                name: "a".into(),
                query_text: "SELECT 1".into(),
                connection_id: None,
                database_name: None,
                folder_id: None,
                created_at: None,
                updated_at: None,
            })
            .unwrap();
        let updated = session
            .save_saved_query(SavedQueryWriteInput {
                id: "q1".into(),
                name: "b".into(),
                query_text: "SELECT 2".into(),
                connection_id: None,
                database_name: None,
                folder_id: None,
                created_at: None,
                updated_at: None,
            })
            .unwrap();
        assert_eq!(updated.name, "b");
        let dup = session.duplicate_saved_query("q1").unwrap();
        assert_ne!(dup.id, "q1");
        assert_eq!(session.list_saved_queries().unwrap().len(), 2);
    }

    #[test]
    fn history_dto_skips_null_profile_id_does_not_coerce_empty() {
        use crate::storage::HistoryRow;

        let skipped = history_dto_from_row(HistoryRow {
            id: "h-null".into(),
            profile_id: None,
            sql: "SELECT 1".into(),
            success: true,
            error_message: None,
            duration_ms: 1,
            row_count: Some(1),
            created_at: "1".into(),
        });
        assert!(skipped.is_none(), "NULL profile_id must be skipped, not coerced to \"\"");

        let kept = history_dto_from_row(HistoryRow {
            id: "h1".into(),
            profile_id: Some("P".into()),
            sql: "SELECT 1".into(),
            success: true,
            error_message: None,
            duration_ms: 3,
            row_count: Some(1),
            created_at: "1".into(),
        })
        .expect("Some(profile_id) maps");
        assert_eq!(kept.profile_id, "P");

        let v = serde_json::to_value(HistoryDto {
            id: "h1".into(),
            profile_id: "P".into(),
            sql: "SELECT 1".into(),
            success: true,
            error_message: None,
            duration_ms: 3,
            row_count: Some(1),
            created_at: "1".into(),
        })
        .unwrap();
        assert_eq!(v["profileId"], "P");
        assert_eq!(v["durationMs"], 3);
        assert_eq!(v["errorMessage"], serde_json::Value::Null);
    }

    #[test]
    fn clear_history_for_profile_keeps_other_profiles() {
        use crate::storage::HistoryInsert;

        let (session, app_data) = temp_session();
        let db_path = app_data.join("dragondb.sqlite");
        {
            let conn = rusqlite::Connection::open(&db_path).unwrap();
            crate::storage::insert_history(
                &conn,
                HistoryInsert {
                    profile_id: Some("P".into()),
                    sql: "SELECT p".into(),
                    success: true,
                    error_message: None,
                    duration_ms: 1,
                    row_count: Some(1),
                },
            )
            .unwrap();
            crate::storage::insert_history(
                &conn,
                HistoryInsert {
                    profile_id: Some("Q".into()),
                    sql: "SELECT q".into(),
                    success: true,
                    error_message: None,
                    duration_ms: 1,
                    row_count: Some(1),
                },
            )
            .unwrap();
            crate::storage::insert_history(
                &conn,
                HistoryInsert {
                    profile_id: None,
                    sql: "SELECT null-profile".into(),
                    success: true,
                    error_message: None,
                    duration_ms: 1,
                    row_count: Some(1),
                },
            )
            .unwrap();
        }

        session.clear_history_for_profile("P").unwrap();
        let rows = session.list_history(50, None).unwrap();
        assert!(rows.iter().all(|r| r.profile_id.as_deref() != Some("P")));
        assert!(rows.iter().any(|r| r.profile_id.as_deref() == Some("Q")));

        let dtos: Vec<_> = rows.into_iter().filter_map(history_dto_from_row).collect();
        assert!(dtos.iter().all(|d| d.profile_id != ""));
        assert!(dtos.iter().any(|d| d.profile_id == "Q"));
        assert!(!dtos.iter().any(|d| d.sql.contains("null-profile")));
    }

    #[test]
    fn save_tab_state_errors_when_update_matches_zero_rows() {
        // Real AppSession wrapper + temp Production sqlite — do NOT assert on a
        // hand-built MappedIpcError.
        let (session, _dir) = temp_session();
        let input = sample_tab("missing-id-never-inserted");
        let err = session
            .save_tab_state(input, false)
            .expect_err("unknown id UPDATE must fail");
        assert_eq!(err.kind, IpcErrorKind::Unknown);
        assert!(
            err.message.to_lowercase().contains("no rows"),
            "message={}",
            err.message
        );
    }

    #[test]
    fn cached_results_data_roundtrips_as_utf8_json_bytes() {
        let (session, _dir) = temp_session();
        let json = r#"{"columns":["c"],"rows":[["x"]]}"#;
        let bytes = json.as_bytes().to_vec();
        assert_eq!(String::from_utf8(bytes.clone()).unwrap(), json);

        let mut input = sample_tab("t-utf8");
        input.cached_results_data = Some(json.to_string());
        input.cached_column_names = Some(vec!["c".into()]);
        session
            .insert_tab_state(input, true)
            .expect("insert with cached results");

        let row = session.get_tab_state("t-utf8").unwrap().unwrap();
        assert_eq!(
            row.cached_results_data.as_deref(),
            Some(json.as_bytes()),
            "BLOB must be UTF-8 JSON bytes, not base64"
        );
        let dto = TabStateDto::from(row);
        assert_eq!(dto.cached_results_data.as_deref(), Some(json));
        assert_eq!(dto.order, 0); // order ↔ order_index
        assert_eq!(dto.cached_column_names.as_deref(), Some(&["c".to_string()][..]));
    }
}
