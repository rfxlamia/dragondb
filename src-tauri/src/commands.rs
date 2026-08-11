//! Thin Tauri command adapters over `AppSession`.
//!
//! Command names and camelCase DTOs are locked for the TS DragonIpc client (T8).
//! Errors reject as `MappedIpcError` objects (`{ kind, message, position? }`).
//! No createDatabase / deleteDatabase commands.

use serde::Serialize;
use tauri::State;
use tokio::sync::Mutex;

use crate::postgres::{
    ColumnInfoRow, MappedIpcError, QueryResultData, TableRefRow,
};
use crate::session::{
    AppSession, ConnectResult, ExecutableSql, ProfileFields, ProfileSecretsInput,
    SaveProfileInput, TableRefArg,
};
use crate::storage::ProfileRow;

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

#[cfg(test)]
mod tests {
    use crate::postgres::{IpcErrorKind, MappedIpcError};

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
        }
        let v = serde_json::to_value(ConnectResultDto {
            connection_id: "c1".into(),
            profile_id: "p1".into(),
        })
        .unwrap();
        assert_eq!(v["connectionId"], "c1");
        assert_eq!(v["profileId"], "p1");
    }
}
