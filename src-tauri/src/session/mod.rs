//! App session orchestration: connect / disconnect / one-shot reconnect / profile CRUD.
//!
//! Single live connection. Explicit disconnect clears session so list/run cannot
//! silent-reconnect. Fakes stay session-local — do not trait-ify postgres/ssh.

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex as StdMutex;
use std::time::Instant;

use rusqlite::Connection as SqliteConnection;
use serde::{Deserialize, Serialize};
use tokio::task::AbortHandle;
use tokio_postgres::{CancelToken, Client};
use uuid::Uuid;

use crate::postgres::{
    collapse_ssl_mode, connect as pg_connect, create_database as pg_create_database,
    delete_rows as pg_delete_rows, drop_database as pg_drop_database, drop_table as pg_drop_table,
    generate_table_ddl as pg_generate_table_ddl, list_columns as pg_list_columns,
    list_databases as pg_list_databases, list_tables as pg_list_tables, maintenance_database,
    run_query as pg_run_query, set_search_path as pg_set_search_path,
    truncate_table as pg_truncate_table, update_row as pg_update_row, CancelRegistry,
    ColumnInfoRow, ConnectParams, IpcErrorKind, MappedIpcError, QueryResultData, RowOperationError,
    RowOperationErrorKind, TableRefRow,
};
use crate::secrets::{KeyringStore, KeyringStoreError, ProfileSecrets};
use crate::ssh::{
    build_auth_method, PreparedAuth, SshAuthInput, TunnelError, TunnelHandle, TunnelRequest,
};
use crate::storage::{
    clear_all_history as storage_clear_all_history,
    clear_history_for_profile as storage_clear_history_for_profile,
    create_folder as storage_create_folder, delete_folder as storage_delete_folder,
    delete_history as storage_delete_history, delete_profile as storage_delete_profile,
    delete_saved_queries as storage_delete_saved_queries,
    delete_tab_state as storage_delete_tab_state,
    duplicate_saved_query as storage_duplicate_saved_query, get_profile as storage_get_profile,
    get_saved_query as storage_get_saved_query, get_tab_state as storage_get_tab_state,
    insert_history, insert_saved_query_with_id as storage_insert_saved_query_with_id,
    insert_tab_state_with_id as storage_insert_tab_state_with_id,
    list_folders as storage_list_folders, list_history as storage_list_history,
    list_profiles as storage_list_profiles, list_saved_queries as storage_list_saved_queries,
    list_tab_states as storage_list_tab_states, move_saved_query as storage_move_saved_query,
    open_db, rename_folder as storage_rename_folder, save_saved_query as storage_save_saved_query,
    upsert_profile, upsert_tab_state as storage_upsert_tab_state, FolderRow, HistoryInsert,
    HistoryRow, ProfileRow, SavedQueryRow, SavedQueryWrite, TabStateRow, TabStateWrite,
};

/// Executable SQL payload (mirrors TS `ExecutableSQL`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutableSql {
    pub text: String,
    #[serde(default)]
    pub params: Vec<serde_json::Value>,
}

/// Secrets accepted on save (never written to sqlite).
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSecretsInput {
    pub password: Option<String>,
    pub ssh_password: Option<String>,
    pub ssh_passphrase: Option<String>,
    pub ssh_private_key: Option<String>,
}

impl std::fmt::Debug for ProfileSecretsInput {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ProfileSecretsInput")
            .field("password", &self.password.as_ref().map(|_| "<redacted>"))
            .field(
                "ssh_password",
                &self.ssh_password.as_ref().map(|_| "<redacted>"),
            )
            .field(
                "ssh_passphrase",
                &self.ssh_passphrase.as_ref().map(|_| "<redacted>"),
            )
            .field(
                "ssh_private_key",
                &self.ssh_private_key.as_ref().map(|_| "<redacted>"),
            )
            .finish()
    }
}

/// Profile fields without id (create/update body).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileFields {
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

/// Save profile input (create when `id` is None).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveProfileInput {
    pub id: Option<String>,
    pub profile: ProfileFields,
    pub secrets: ProfileSecretsInput,
}

/// Connect result: opaque connectionId ≠ profileId.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectResult {
    pub connection_id: String,
    pub profile_id: String,
    /// Profile database name at connect time (tab inheritance).
    pub database: String,
}

/// Table ref for list_columns.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableRefArg {
    pub name: String,
    #[serde(default)]
    pub schema: Option<String>,
    #[serde(default)]
    pub table_type: Option<String>,
}

struct ActiveSession {
    connection_id: String,
    profile_id: String,
    profile: ProfileRow,
    /// Cached for reconnect (never logged).
    secrets: ProfileSecrets,
    client: Option<Client>,
    cancel_token: Option<CancelToken>,
    tunnel: Option<TunnelHandle>,
    ssh_enabled: bool,
    /// Usable live handle (DB client and/or fake live flag). Cleared during oneshot teardown.
    live: bool,
}

/// Production or session-local fake backend.
enum Backend {
    Production {
        db: StdMutex<SqliteConnection>,
        keyring: KeyringStore,
    },
    Fake(FakeDeps),
}

/// Orchestrates single-connection session + profile/history side effects.
pub struct AppSession {
    backend: Backend,
    active: Option<ActiveSession>,
    cancel_registry: CancelRegistry,
}

impl AppSession {
    /// Open production session under `app_data_dir`.
    pub fn open(app_data_dir: &Path) -> Result<Self, MappedIpcError> {
        Self::open_with_cancel_registry(app_data_dir, CancelRegistry::default())
    }

    pub fn open_with_cancel_registry(
        app_data_dir: &Path,
        cancel_registry: CancelRegistry,
    ) -> Result<Self, MappedIpcError> {
        let db_path = crate::storage::default_db_path(app_data_dir);
        let db = open_db(&db_path).map_err(|e| MappedIpcError {
            kind: IpcErrorKind::Unknown,
            message: format!("Failed to open app database: {e}"),
            position: None,
        })?;
        Ok(Self {
            backend: Backend::Production {
                db: StdMutex::new(db),
                keyring: KeyringStore::new("dragondb"),
            },
            active: None,
            cancel_registry,
        })
    }

    /// Test constructor with session-local fakes.
    pub fn with_fakes(deps: FakeDeps) -> Self {
        let active = deps.seed_active();
        Self {
            backend: Backend::Fake(deps),
            active,
            cancel_registry: CancelRegistry::default(),
        }
    }

    pub fn active_connection_id(&self) -> Option<&str> {
        self.active.as_ref().map(|a| a.connection_id.as_str())
    }

    pub fn active_profile_id(&self) -> Option<&str> {
        self.active.as_ref().map(|a| a.profile_id.as_str())
    }

    pub fn fake_postgres(&self) -> &FakePostgres {
        match &self.backend {
            Backend::Fake(d) => &d.postgres,
            Backend::Production { .. } => panic!("fake_postgres only in fake mode"),
        }
    }

    pub fn fake_ssh(&self) -> &FakeSsh {
        match &self.backend {
            Backend::Fake(d) => &d.ssh,
            Backend::Production { .. } => panic!("fake_ssh only in fake mode"),
        }
    }

    pub fn fake_storage(&self) -> &FakeStorage {
        match &self.backend {
            Backend::Fake(d) => &d.storage,
            Backend::Production { .. } => panic!("fake_storage only in fake mode"),
        }
    }

    pub fn fake_keyring(&self) -> &FakeKeyring {
        match &self.backend {
            Backend::Fake(d) => &d.keyring,
            Backend::Production { .. } => panic!("fake_keyring only in fake mode"),
        }
    }

    /// Test seam: simulate production state after failed oneshot (`client=None` / `live=false`).
    #[cfg(test)]
    pub fn strip_live_handle_for_test(&mut self) {
        if let Some(active) = self.active.as_mut() {
            active.client = None;
            active.live = false;
        }
    }

    #[cfg(test)]
    pub fn active_cached_host_for_test(&self) -> Option<String> {
        self.active.as_ref().map(|a| a.profile.host.clone())
    }

    #[cfg(test)]
    pub fn active_cached_password_for_test(&self) -> Option<String> {
        self.active
            .as_ref()
            .and_then(|a| a.secrets.password.clone())
    }

    pub fn list_profiles(&self) -> Result<Vec<ProfileRow>, MappedIpcError> {
        match &self.backend {
            Backend::Production { db, .. } => {
                let db = db.lock().map_err(|_| MappedIpcError {
                    kind: IpcErrorKind::Unknown,
                    message: "Storage lock poisoned.".into(),
                    position: None,
                })?;
                storage_list_profiles(&db).map_err(sqlite_err)
            }
            Backend::Fake(d) => Ok(d.storage.list_profiles()),
        }
    }

    pub fn get_profile(&self, id: &str) -> Result<Option<ProfileRow>, MappedIpcError> {
        match &self.backend {
            Backend::Production { db, .. } => {
                let db = db.lock().map_err(|_| MappedIpcError {
                    kind: IpcErrorKind::Unknown,
                    message: "Storage lock poisoned.".into(),
                    position: None,
                })?;
                storage_get_profile(&db, id).map_err(sqlite_err)
            }
            Backend::Fake(d) => Ok(d.storage.get_profile(id)),
        }
    }

    pub async fn save_profile(
        &mut self,
        input: SaveProfileInput,
    ) -> Result<ProfileRow, MappedIpcError> {
        let is_create = input.id.is_none();
        let id = input
            .id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let row = profile_from_fields(&id, &input.profile);
        let secrets = secrets_from_input(&input.secrets);

        match &mut self.backend {
            Backend::Production { db, keyring } => {
                let prior = if !is_create {
                    let guard = db.lock().map_err(|_| MappedIpcError {
                        kind: IpcErrorKind::Unknown,
                        message: "Storage lock poisoned.".into(),
                        position: None,
                    })?;
                    storage_get_profile(&guard, &id).map_err(sqlite_err)?
                } else {
                    None
                };
                let prior_secrets = if !is_create {
                    match keyring.get_secrets(&id) {
                        Ok(s) => Some(s),
                        Err(KeyringStoreError::NotFound { .. }) => None,
                        Err(e) => return Err(keyring_err(e)),
                    }
                } else {
                    None
                };
                {
                    let guard = db.lock().map_err(|_| MappedIpcError {
                        kind: IpcErrorKind::Unknown,
                        message: "Storage lock poisoned.".into(),
                        position: None,
                    })?;
                    upsert_profile(&guard, &row).map_err(sqlite_err)?;
                }
                match keyring.set_secrets(&id, &secrets) {
                    Ok(()) => {}
                    Err(e) => {
                        if is_create {
                            if let Ok(guard) = db.lock() {
                                let _ = storage_delete_profile(&guard, &id);
                            }
                            let _ = keyring.delete_all_for_profile(&id);
                        } else {
                            if let Some(prior) = prior {
                                if let Ok(guard) = db.lock() {
                                    let _ = upsert_profile(&guard, &prior);
                                }
                            }
                            let _ = keyring.delete_all_for_profile(&id);
                            if let Some(prior_secrets) = prior_secrets {
                                let _ = keyring.set_secrets(&id, &prior_secrets);
                            }
                        }
                        return Err(keyring_err(e));
                    }
                }
            }
            Backend::Fake(d) => {
                let prior = if !is_create {
                    d.storage.get_profile(&id)
                } else {
                    None
                };
                let prior_secrets = if !is_create {
                    d.keyring.get_secrets(&id).ok()
                } else {
                    None
                };
                d.storage.upsert(&row);
                match d.keyring.set_secrets(&id, &secrets) {
                    Ok(()) => {}
                    Err(e) => {
                        if is_create {
                            d.storage.delete(&id);
                            d.keyring.delete_all(&id);
                        } else {
                            if let Some(prior) = prior {
                                d.storage.upsert(&prior);
                            }
                            d.keyring.delete_all(&id);
                            if let Some(prior_secrets) = prior_secrets {
                                // Clear fail flag so restore write can succeed.
                                d.keyring.fail_after_password = false;
                                d.keyring.fail_set = false;
                                let _ = d.keyring.set_secrets(&id, &prior_secrets);
                            }
                        }
                        return Err(e);
                    }
                }
            }
        }

        self.sync_active_after_profile_save(&row);
        Ok(row)
    }

    /// Keep oneshot reconnect cache aligned with the last successful save of the live profile.
    fn sync_active_after_profile_save(&mut self, row: &ProfileRow) {
        let is_active = self.active.as_ref().is_some_and(|a| a.profile_id == row.id);
        if !is_active {
            return;
        }
        let loaded = match &self.backend {
            Backend::Production { keyring, .. } => keyring.get_secrets(&row.id).ok(),
            Backend::Fake(d) => d.keyring.get_secrets(&row.id).ok(),
        };
        if let Some(active) = self.active.as_mut() {
            active.profile = row.clone();
            active.ssh_enabled = row.ssh_enabled;
            if let Some(secrets) = loaded {
                active.secrets = secrets;
            }
        }
    }

    pub async fn delete_profile(&mut self, id: &str) -> Result<(), MappedIpcError> {
        if self.active.as_ref().map(|a| a.profile_id.as_str()) == Some(id) {
            self.disconnect().await?;
        }
        match &mut self.backend {
            Backend::Production { db, keyring } => {
                // Delete keyring first so a keyring failure cannot orphan secrets
                // after the sqlite row is already gone.
                keyring.delete_all_for_profile(id).map_err(keyring_err)?;
                {
                    let guard = db.lock().map_err(|_| MappedIpcError {
                        kind: IpcErrorKind::Unknown,
                        message: "Storage lock poisoned.".into(),
                        position: None,
                    })?;
                    storage_delete_profile(&guard, id).map_err(sqlite_err)?;
                }
                Ok(())
            }
            Backend::Fake(d) => {
                d.keyring.delete_all(id);
                d.storage.delete(id);
                Ok(())
            }
        }
    }

    pub async fn connect_profile(&mut self, id: &str) -> Result<ConnectResult, MappedIpcError> {
        // Tear down any prior session first (single connection).
        if self.active.is_some() {
            self.disconnect().await?;
        }

        let profile = self.get_profile(id)?.ok_or_else(|| MappedIpcError {
            kind: IpcErrorKind::Connection,
            message: format!("Profile not found: {id}"),
            position: None,
        })?;
        let database = profile.database.clone();

        let secrets = self.load_secrets(id)?;
        let connection_id = Uuid::new_v4().to_string();

        match &mut self.backend {
            Backend::Production { .. } => {
                let ssh_enabled = profile.ssh_enabled;
                let (client, tunnel, abort) = establish_live(&profile, &secrets).await?;
                self.active = Some(ActiveSession {
                    connection_id: connection_id.clone(),
                    profile_id: id.to_string(),
                    profile,
                    secrets,
                    cancel_token: Some(client.cancel_token()),
                    client: Some(client),
                    tunnel,
                    ssh_enabled,
                    live: true,
                });
                let active = self.active.as_ref().expect("active session just installed");
                self.cancel_registry.register(
                    active.connection_id.clone(),
                    active.cancel_token.clone().expect("production token"),
                    collapse_ssl_mode(&active.profile.ssl_mode),
                    Some(abort),
                );
            }
            Backend::Fake(d) => {
                let ssh_enabled = profile.ssh_enabled;
                if ssh_enabled {
                    d.ssh.open()?;
                }
                d.postgres.connect()?;
                self.active = Some(ActiveSession {
                    connection_id: connection_id.clone(),
                    profile_id: id.to_string(),
                    profile,
                    secrets,
                    client: None,
                    cancel_token: None,
                    tunnel: None,
                    ssh_enabled,
                    live: true,
                });
            }
        }

        Ok(ConnectResult {
            connection_id,
            profile_id: id.to_string(),
            database,
        })
    }

    pub async fn disconnect(&mut self) -> Result<(), MappedIpcError> {
        self.cancel_registry.clear();
        if let Some(mut active) = self.active.take() {
            if let Some(mut tunnel) = active.tunnel.take() {
                let _ = tunnel.shutdown();
            }
            // Drop client by clearing Option.
            active.client = None;
        }
        Ok(())
    }

    /// List connectable databases through the active live client.
    pub async fn list_databases(&self, connection_id: &str) -> Result<Vec<String>, MappedIpcError> {
        self.require_live(connection_id)?;
        match &self.backend {
            Backend::Fake(_) => Ok(vec!["postgres".into(), "shop".into()]),
            Backend::Production { .. } => {
                let client = self
                    .active
                    .as_ref()
                    .and_then(|active| active.client.as_ref())
                    .ok_or_else(not_connected)?;
                pg_list_databases(client).await
            }
        }
    }

    /// Reconnect the live session to a database without persisting the picker choice.
    pub async fn switch_database(
        &mut self,
        connection_id: &str,
        name: &str,
    ) -> Result<(), MappedIpcError> {
        self.require_live(connection_id)?;
        let active = self.active.as_ref().ok_or_else(not_connected)?;
        let mut profile = active.profile.clone();
        profile.database = name.to_string();
        let secrets = active.secrets.clone();

        match &mut self.backend {
            Backend::Production { .. } => {
                let (client, tunnel, abort) = establish_live(&profile, &secrets).await?;
                let active = self.active.as_mut().ok_or_else(not_connected)?;
                if let Some(mut prior_tunnel) = active.tunnel.take() {
                    let _ = prior_tunnel.shutdown();
                }
                active.client = Some(client);
                active.cancel_token =
                    Some(active.client.as_ref().expect("client set").cancel_token());
                active.tunnel = tunnel;
                active.profile = profile;
                active.live = true;
                self.cancel_registry.register(
                    active.connection_id.clone(),
                    active.cancel_token.clone().expect("production token"),
                    collapse_ssl_mode(&active.profile.ssl_mode),
                    Some(abort),
                );
            }
            Backend::Fake(_) => {
                self.active.as_mut().ok_or_else(not_connected)?.profile = profile;
            }
        }
        Ok(())
    }

    /// Create a database through a temporary maintenance connection without selecting it.
    pub async fn create_database(&mut self, name: &str) -> Result<(), MappedIpcError> {
        let connection_id = self
            .active
            .as_ref()
            .map(|active| active.connection_id.clone())
            .ok_or_else(not_connected)?;
        self.require_live(&connection_id)?;
        if matches!(self.backend, Backend::Fake(_)) {
            return Ok(());
        }
        self.run_database_admin(name, true).await
    }

    /// Drop a database through a temporary maintenance connection.
    /// If the live session is connected to that database, move it to the
    /// maintenance database first so PostgreSQL will accept DROP DATABASE.
    pub async fn delete_database(&mut self, name: &str) -> Result<(), MappedIpcError> {
        if matches!(self.backend, Backend::Fake(_)) {
            if self
                .active
                .as_ref()
                .is_some_and(|active| active.profile.database == name)
            {
                let connection_id = self
                    .active
                    .as_ref()
                    .map(|active| active.connection_id.clone())
                    .ok_or_else(not_connected)?;
                let maintenance = maintenance_database(name).to_string();
                self.switch_database(&connection_id, &maintenance).await?;
            }
            return Ok(());
        }
        let live_name = self
            .active
            .as_ref()
            .map(|active| active.profile.database.clone());
        let prior = live_name.clone();
        if live_name.as_deref() == Some(name) {
            let connection_id = self
                .active
                .as_ref()
                .map(|active| active.connection_id.clone())
                .ok_or_else(not_connected)?;
            let maintenance = maintenance_database(name).to_string();
            self.switch_database(&connection_id, &maintenance).await?;
        }
        let result = self.run_database_admin(name, false).await;
        if result.is_err() {
            if let (Some(prior_name), Some(connection_id)) = (
                prior.filter(|current| current == name),
                self.active
                    .as_ref()
                    .map(|active| active.connection_id.clone()),
            ) {
                let _ = self.switch_database(&connection_id, &prior_name).await;
            }
        }
        result
    }

    async fn run_database_admin(&self, name: &str, create: bool) -> Result<(), MappedIpcError> {
        let active = self.active.as_ref().ok_or_else(not_connected)?;
        let mut profile = active.profile.clone();
        profile.database = maintenance_database(name).to_string();
        let (client, mut tunnel, _abort) = establish_live(&profile, &active.secrets).await?;
        let result = if create {
            pg_create_database(&client, name).await
        } else {
            pg_drop_database(&client, name).await
        };
        drop(client);
        if let Some(tunnel) = tunnel.as_mut() {
            let _ = tunnel.shutdown();
        }
        result
    }

    pub async fn list_tables(
        &mut self,
        connection_id: &str,
    ) -> Result<Vec<TableRefRow>, MappedIpcError> {
        self.require_live(connection_id)?;
        let is_fake = matches!(self.backend, Backend::Fake(_));
        let first = self.list_tables_once(is_fake).await;
        match first {
            Ok(rows) => Ok(rows),
            Err(e) if self.should_oneshot_reconnect(&e) => {
                self.oneshot_reconnect().await?;
                self.list_tables_once(is_fake).await
            }
            Err(e) => Err(e),
        }
    }

    async fn list_tables_once(
        &mut self,
        is_fake: bool,
    ) -> Result<Vec<TableRefRow>, MappedIpcError> {
        if !self.has_live_handle() {
            return Err(not_connected());
        }
        if is_fake {
            self.fake_query_probe(false)?;
            return Ok(vec![TableRefRow {
                schema: "public".into(),
                name: "users".into(),
                table_type: "regular".into(),
            }]);
        }
        let client = self
            .active
            .as_ref()
            .and_then(|a| a.client.as_ref())
            .ok_or_else(not_connected)?;
        pg_list_tables(client).await
    }

    pub async fn list_columns(
        &mut self,
        connection_id: &str,
        table: &TableRefArg,
    ) -> Result<Vec<ColumnInfoRow>, MappedIpcError> {
        self.require_live(connection_id)?;
        let schema = table.schema.as_deref().unwrap_or("public");
        let table_name = table.name.clone();
        let is_fake = matches!(self.backend, Backend::Fake(_));
        let first = self.list_columns_once(is_fake, schema, &table_name).await;
        match first {
            Ok(rows) => Ok(rows),
            Err(e) if self.should_oneshot_reconnect(&e) => {
                self.oneshot_reconnect().await?;
                self.list_columns_once(is_fake, schema, &table_name).await
            }
            Err(e) => Err(e),
        }
    }

    async fn list_columns_once(
        &mut self,
        is_fake: bool,
        schema: &str,
        table_name: &str,
    ) -> Result<Vec<ColumnInfoRow>, MappedIpcError> {
        if !self.has_live_handle() {
            return Err(not_connected());
        }
        if is_fake {
            self.fake_query_probe(false)?;
            return Ok(sample_columns());
        }
        let client = self
            .active
            .as_ref()
            .and_then(|a| a.client.as_ref())
            .ok_or_else(not_connected)?;
        pg_list_columns(client, schema, table_name).await
    }

    pub async fn truncate_table(
        &mut self,
        connection_id: &str,
        table: &TableRefArg,
    ) -> Result<(), MappedIpcError> {
        self.require_live(connection_id)?;
        if matches!(self.backend, Backend::Fake(_)) {
            return Ok(());
        }
        let client = self
            .active
            .as_ref()
            .and_then(|a| a.client.as_ref())
            .ok_or_else(not_connected)?;
        if table.table_type.as_deref() == Some("foreign") {
            return Err(MappedIpcError {
                kind: IpcErrorKind::Unknown,
                message: "TRUNCATE is not supported for foreign tables.".into(),
                position: None,
            });
        }
        pg_truncate_table(
            client,
            table.schema.as_deref().unwrap_or("public"),
            &table.name,
        )
        .await
    }

    pub async fn drop_table(
        &mut self,
        connection_id: &str,
        table: &TableRefArg,
    ) -> Result<(), MappedIpcError> {
        self.require_live(connection_id)?;
        if matches!(self.backend, Backend::Fake(_)) {
            return Ok(());
        }
        let client = self
            .active
            .as_ref()
            .and_then(|a| a.client.as_ref())
            .ok_or_else(not_connected)?;
        pg_drop_table(
            client,
            table.schema.as_deref().unwrap_or("public"),
            &table.name,
            table.table_type.as_deref(),
        )
        .await
    }

    pub async fn generate_table_ddl(
        &mut self,
        connection_id: &str,
        table: &TableRefArg,
    ) -> Result<String, MappedIpcError> {
        self.require_live(connection_id)?;
        if matches!(self.backend, Backend::Fake(_)) {
            return Ok(String::new());
        }
        let client = self
            .active
            .as_ref()
            .and_then(|a| a.client.as_ref())
            .ok_or_else(not_connected)?;
        pg_generate_table_ddl(
            client,
            table.schema.as_deref().unwrap_or("public"),
            &table.name,
        )
        .await
    }

    pub async fn set_search_path(
        &mut self,
        connection_id: &str,
        schema: Option<&str>,
    ) -> Result<(), MappedIpcError> {
        self.require_live(connection_id)?;
        if matches!(self.backend, Backend::Fake(_)) {
            return Ok(());
        }
        let client = self
            .active
            .as_ref()
            .and_then(|a| a.client.as_ref())
            .ok_or_else(not_connected)?;
        pg_set_search_path(client, schema).await
    }

    pub async fn run_query(
        &mut self,
        connection_id: &str,
        sql: ExecutableSql,
    ) -> Result<QueryResultData, MappedIpcError> {
        // Not connected / mismatch → no history, no silent reconnect.
        if let Err(e) = self.require_live(connection_id) {
            return Err(e);
        }

        let profile_id = self
            .active
            .as_ref()
            .map(|a| a.profile_id.clone())
            .ok_or_else(not_connected)?;

        let started = Instant::now();
        let result = self
            .execute_query_with_oneshot_reconnect(&sql.text, &sql.params)
            .await;
        let duration_ms = started.elapsed().as_millis() as i64;

        // History only after an execute attempt while Connected.
        match &result {
            Ok(qr) => {
                self.insert_history_row(HistoryInsert {
                    profile_id: Some(profile_id),
                    sql: sql.text.clone(),
                    success: true,
                    error_message: None,
                    duration_ms,
                    row_count: Some(qr.rows.len() as i64),
                });
            }
            Err(e) => {
                // Attempt happened (require_live passed); record failure outcome.
                self.insert_history_row(HistoryInsert {
                    profile_id: Some(profile_id),
                    sql: sql.text.clone(),
                    success: false,
                    error_message: Some(e.message.clone()),
                    duration_ms,
                    row_count: None,
                });
            }
        }

        result
    }

    async fn execute_query_with_oneshot_reconnect(
        &mut self,
        sql: &str,
        params: &[serde_json::Value],
    ) -> Result<QueryResultData, MappedIpcError> {
        let first = self.query_once(sql, params).await;
        match first {
            Ok(r) => Ok(r),
            Err(e) if self.should_oneshot_reconnect(&e) => {
                self.oneshot_reconnect().await?;
                self.query_once(sql, params).await
            }
            Err(e) => Err(e),
        }
    }

    async fn query_once(
        &mut self,
        sql: &str,
        params: &[serde_json::Value],
    ) -> Result<QueryResultData, MappedIpcError> {
        if !self.has_live_handle() {
            return Err(not_connected());
        }
        let is_fake = matches!(self.backend, Backend::Fake(_));
        if is_fake {
            let force_db_err = match &self.backend {
                Backend::Fake(d) => {
                    d.postgres.record_query(sql, params);
                    d.postgres.force_query_fail
                }
                Backend::Production { .. } => false,
            };
            self.fake_query_probe(force_db_err)?;
            return Ok(sample_query_result());
        }
        let client = self
            .active
            .as_ref()
            .and_then(|a| a.client.as_ref())
            .ok_or_else(not_connected)?;
        pg_run_query(client, sql, params).await
    }

    /// UPDATE one row — returns `RowOperationError` (not `MappedIpcError`).
    pub async fn update_row(
        &mut self,
        connection_id: &str,
        table: &TableRefArg,
        primary_key: &serde_json::Map<String, serde_json::Value>,
        patch: &serde_json::Map<String, serde_json::Value>,
    ) -> Result<(), RowOperationError> {
        self.require_live_row_op(connection_id, RowOperationErrorKind::UpdateFailed)?;
        if table.name.trim().is_empty() {
            return Err(RowOperationError::new(
                RowOperationErrorKind::NoTableSelected,
                "No table selected for row update.",
            ));
        }
        let schema = table.schema.as_deref().unwrap_or("public");
        let table_name = table.name.as_str();

        if matches!(self.backend, Backend::Fake(_)) {
            let pk_cols: Vec<&str> = primary_key.keys().map(|s| s.as_str()).collect();
            crate::postgres::validate_update_preconditions(
                Some((schema, table_name)),
                &pk_cols,
                !primary_key.is_empty(),
            )?;
            self.fake_query_probe(false).map_err(|e| {
                RowOperationError::new(RowOperationErrorKind::UpdateFailed, e.message)
            })?;
            return Ok(());
        }

        let client = self
            .active
            .as_ref()
            .and_then(|a| a.client.as_ref())
            .ok_or_else(|| {
                RowOperationError::new(
                    RowOperationErrorKind::UpdateFailed,
                    "Not connected to a database.",
                )
            })?;
        pg_update_row(client, schema, table_name, primary_key, patch).await
    }

    /// DELETE rows — returns `RowOperationError` (not `MappedIpcError`).
    pub async fn delete_rows(
        &mut self,
        connection_id: &str,
        table: &TableRefArg,
        primary_keys: &[serde_json::Map<String, serde_json::Value>],
    ) -> Result<(), RowOperationError> {
        self.require_live_row_op(connection_id, RowOperationErrorKind::DeleteFailed)?;
        if table.name.trim().is_empty() {
            return Err(RowOperationError::new(
                RowOperationErrorKind::NoTableSelected,
                "No table selected for row delete.",
            ));
        }
        let schema = table.schema.as_deref().unwrap_or("public");
        let table_name = table.name.as_str();

        if matches!(self.backend, Backend::Fake(_)) {
            let pk_cols: Vec<&str> = primary_keys
                .first()
                .map(|m| m.keys().map(|s| s.as_str()).collect())
                .unwrap_or_default();
            crate::postgres::validate_delete_preconditions(
                Some((schema, table_name)),
                &pk_cols,
                primary_keys,
            )?;
            self.fake_query_probe(false).map_err(|e| {
                RowOperationError::new(RowOperationErrorKind::DeleteFailed, e.message)
            })?;
            return Ok(());
        }

        let client = self
            .active
            .as_ref()
            .and_then(|a| a.client.as_ref())
            .ok_or_else(|| {
                RowOperationError::new(
                    RowOperationErrorKind::DeleteFailed,
                    "Not connected to a database.",
                )
            })?;
        pg_delete_rows(client, schema, table_name, primary_keys).await
    }

    fn require_live_row_op(
        &self,
        connection_id: &str,
        fail_kind: RowOperationErrorKind,
    ) -> Result<(), RowOperationError> {
        self.require_live(connection_id)
            .map_err(|e| RowOperationError::new(fail_kind, e.message))?;
        if !self.has_live_handle() {
            return Err(RowOperationError::new(
                fail_kind,
                "Not connected to a database.",
            ));
        }
        Ok(())
    }

    fn has_live_handle(&self) -> bool {
        match &self.backend {
            Backend::Fake(_) => self.active.as_ref().is_some_and(|a| a.live),
            Backend::Production { .. } => self
                .active
                .as_ref()
                .is_some_and(|a| a.client.is_some() && a.live),
        }
    }

    fn fake_query_probe(&self, force_db_err: bool) -> Result<(), MappedIpcError> {
        match &self.backend {
            Backend::Fake(d) => d.postgres.query_attempt(force_db_err),
            Backend::Production { .. } => Ok(()),
        }
    }

    fn should_oneshot_reconnect(&self, error: &MappedIpcError) -> bool {
        is_connection_kind(error) && !self.cancel_registry.teardown_requested()
    }

    async fn oneshot_reconnect(&mut self) -> Result<(), MappedIpcError> {
        let Some(active) = self.active.as_mut() else {
            return Err(not_connected());
        };
        // Tear down existing tunnel/client.
        if let Some(mut tunnel) = active.tunnel.take() {
            let _ = tunnel.shutdown();
        }
        active.client = None;
        active.cancel_token = None;
        active.live = false;
        self.cancel_registry.clear();

        let profile = active.profile.clone();
        let secrets = active.secrets.clone();
        let ssh_enabled = active.ssh_enabled;

        match &mut self.backend {
            Backend::Production { .. } => {
                let (client, tunnel, abort) = establish_live(&profile, &secrets).await?;
                if let Some(a) = self.active.as_mut() {
                    a.client = Some(client);
                    a.cancel_token = Some(a.client.as_ref().expect("client set").cancel_token());
                    a.tunnel = tunnel;
                    a.live = true;
                    self.cancel_registry.register(
                        a.connection_id.clone(),
                        a.cancel_token.clone().expect("production token"),
                        collapse_ssl_mode(&a.profile.ssl_mode),
                        Some(abort),
                    );
                }
                Ok(())
            }
            Backend::Fake(d) => {
                if ssh_enabled {
                    d.ssh.open()?;
                }
                d.postgres.connect()?;
                // Clear dead-socket flag after successful rebuild.
                d.postgres.clear_dead_socket();
                if let Some(a) = self.active.as_mut() {
                    a.live = true;
                }
                Ok(())
            }
        }
    }

    fn require_live(&self, connection_id: &str) -> Result<(), MappedIpcError> {
        match &self.active {
            Some(a) if a.connection_id == connection_id => Ok(()),
            Some(_) => Err(MappedIpcError {
                kind: IpcErrorKind::Connection,
                message: "Connection id does not match the active session.".into(),
                position: None,
            }),
            None => Err(not_connected()),
        }
    }

    fn load_secrets(&self, profile_id: &str) -> Result<ProfileSecrets, MappedIpcError> {
        match &self.backend {
            Backend::Production { keyring, .. } => match keyring.get_secrets(profile_id) {
                Ok(s) => Ok(s),
                // Passwordless / empty keyring is a valid connect path (empty password).
                Err(KeyringStoreError::NotFound { .. }) => Ok(ProfileSecrets::default()),
                Err(e) => Err(keyring_err(e)),
            },
            Backend::Fake(d) => match d.keyring.get_secrets(profile_id) {
                Ok(s) => Ok(s),
                Err(_) => Ok(ProfileSecrets::default()),
            },
        }
    }

    fn insert_history_row(&mut self, entry: HistoryInsert) {
        match &mut self.backend {
            Backend::Production { db, .. } => {
                if let Ok(guard) = db.lock() {
                    let _ = insert_history(&guard, entry);
                }
            }
            Backend::Fake(d) => {
                d.storage.insert_history(entry);
            }
        }
    }

    /// Run a closure against the Production sqlite connection.
    ///
    /// Library IPC is Production-only — FakeStorage is not extended for library
    /// ops (Phase A helper unit tests remain the SQL oracle). Prefer
    /// `AppSession::open` with a temp app-data dir for command/session tests.
    fn with_production_db<T>(
        &self,
        f: impl FnOnce(&SqliteConnection) -> Result<T, MappedIpcError>,
    ) -> Result<T, MappedIpcError> {
        match &self.backend {
            Backend::Production { db, .. } => {
                let guard = db.lock().map_err(|_| MappedIpcError {
                    kind: IpcErrorKind::Unknown,
                    message: "Storage lock poisoned.".into(),
                    position: None,
                })?;
                f(&guard)
            }
            Backend::Fake(_) => Err(MappedIpcError {
                kind: IpcErrorKind::Unknown,
                message:
                    "Library IPC requires production storage (temp AppSession::open in tests)."
                        .into(),
                position: None,
            }),
        }
    }

    // --- Library (SavedQuery / QueryFolder) thin wrappers --------------------

    pub fn list_saved_queries(&self) -> Result<Vec<SavedQueryRow>, MappedIpcError> {
        self.with_production_db(|db| storage_list_saved_queries(db).map_err(sqlite_err))
    }

    pub fn get_saved_query(&self, id: &str) -> Result<Option<SavedQueryRow>, MappedIpcError> {
        self.with_production_db(|db| storage_get_saved_query(db, id).map_err(sqlite_err))
    }

    /// Create (id absent in DB) or update (id present). UPDATE matching 0 rows → error.
    pub fn save_saved_query(
        &self,
        query: SavedQueryWriteInput,
    ) -> Result<SavedQueryRow, MappedIpcError> {
        self.with_production_db(|db| {
            let exists = storage_get_saved_query(db, &query.id)
                .map_err(sqlite_err)?
                .is_some();
            let write = SavedQueryWrite {
                id: if exists { Some(query.id.clone()) } else { None },
                name: query.name.clone(),
                query_text: query.query_text.clone(),
                connection_id: query.connection_id.clone(),
                database_name: query.database_name.clone(),
                folder_id: query.folder_id.clone(),
            };
            if exists {
                match storage_save_saved_query(db, write) {
                    Ok(_) => {}
                    Err(rusqlite::Error::QueryReturnedNoRows) => {
                        return Err(MappedIpcError {
                            kind: IpcErrorKind::Unknown,
                            message: "save_saved_query: no rows updated".into(),
                            position: None,
                        });
                    }
                    Err(e) => return Err(sqlite_err(e)),
                }
            } else {
                storage_insert_saved_query_with_id(db, &query.id, write).map_err(sqlite_err)?;
            }
            storage_get_saved_query(db, &query.id)
                .map_err(sqlite_err)?
                .ok_or_else(|| MappedIpcError {
                    kind: IpcErrorKind::Unknown,
                    message: "save_saved_query: row missing after write".into(),
                    position: None,
                })
        })
    }

    pub fn delete_saved_queries(&self, ids: &[String]) -> Result<(), MappedIpcError> {
        self.with_production_db(|db| {
            let refs: Vec<&str> = ids.iter().map(|s| s.as_str()).collect();
            storage_delete_saved_queries(db, &refs).map_err(sqlite_err)
        })
    }

    pub fn duplicate_saved_query(&self, id: &str) -> Result<SavedQueryRow, MappedIpcError> {
        self.with_production_db(|db| {
            let new_id = match storage_duplicate_saved_query(db, id) {
                Ok(id) => id,
                Err(rusqlite::Error::QueryReturnedNoRows) => {
                    return Err(MappedIpcError {
                        kind: IpcErrorKind::Unknown,
                        message: "Saved query not found".into(),
                        position: None,
                    });
                }
                Err(e) => return Err(sqlite_err(e)),
            };
            storage_get_saved_query(db, &new_id)
                .map_err(sqlite_err)?
                .ok_or_else(|| MappedIpcError {
                    kind: IpcErrorKind::Unknown,
                    message: "duplicate_saved_query: row missing after insert".into(),
                    position: None,
                })
        })
    }

    pub fn move_saved_query(
        &self,
        id: &str,
        folder_id: Option<&str>,
    ) -> Result<(), MappedIpcError> {
        self.with_production_db(|db| {
            storage_move_saved_query(db, id, folder_id).map_err(sqlite_err)
        })
    }

    pub fn list_folders(&self) -> Result<Vec<FolderRow>, MappedIpcError> {
        self.with_production_db(|db| storage_list_folders(db).map_err(sqlite_err))
    }

    pub fn create_folder(&self, name: &str) -> Result<FolderRow, MappedIpcError> {
        self.with_production_db(|db| {
            let id = storage_create_folder(db, name).map_err(sqlite_err)?;
            storage_list_folders(db)
                .map_err(sqlite_err)?
                .into_iter()
                .find(|f| f.id == id)
                .ok_or_else(|| MappedIpcError {
                    kind: IpcErrorKind::Unknown,
                    message: "create_folder: row missing after insert".into(),
                    position: None,
                })
        })
    }

    pub fn rename_folder(&self, id: &str, name: &str) -> Result<(), MappedIpcError> {
        self.with_production_db(|db| storage_rename_folder(db, id, name).map_err(sqlite_err))
    }

    /// `delete_queries=false` nullifies `folder_id` on queries; `true` cascades deletes.
    pub fn delete_folder(&self, id: &str, delete_queries: bool) -> Result<(), MappedIpcError> {
        self.with_production_db(|db| {
            storage_delete_folder(db, id, delete_queries).map_err(sqlite_err)
        })
    }

    // --- History thin wrappers ----------------------------------------------

    /// Newest-first. `profile_id: None` ⇒ global list; `Some` ⇒ that profile only.
    pub fn list_history(
        &self,
        limit: i64,
        profile_id: Option<&str>,
    ) -> Result<Vec<HistoryRow>, MappedIpcError> {
        self.with_production_db(|db| {
            storage_list_history(db, limit, profile_id).map_err(sqlite_err)
        })
    }

    pub fn delete_history(&self, id: &str) -> Result<(), MappedIpcError> {
        self.with_production_db(|db| storage_delete_history(db, id).map_err(sqlite_err))
    }

    /// Clears history for one profile only (never a global wipe).
    pub fn clear_history_for_profile(&self, profile_id: &str) -> Result<(), MappedIpcError> {
        self.with_production_db(|db| {
            storage_clear_history_for_profile(db, profile_id).map_err(sqlite_err)
        })
    }

    pub fn clear_all_history(&self) -> Result<(), MappedIpcError> {
        self.with_production_db(|db| storage_clear_all_history(db).map_err(sqlite_err))
    }

    // --- Tabs thin wrappers -------------------------------------------------

    pub fn list_tab_states(&self) -> Result<Vec<TabStateRow>, MappedIpcError> {
        self.with_production_db(|db| storage_list_tab_states(db).map_err(sqlite_err))
    }

    pub fn get_tab_state(&self, id: &str) -> Result<Option<TabStateRow>, MappedIpcError> {
        self.with_production_db(|db| storage_get_tab_state(db, id).map_err(sqlite_err))
    }

    /// UPDATE-only save. Unknown id (0 matching rows) → `MappedIpcError` with `/no rows/i`.
    ///
    /// `cached_results_data` is UTF-8 bytes of the opaque JSON string (not base64).
    /// TS `order` ↔ storage `order_index`.
    ///
    /// New tabs: use [`Self::insert_tab_state`] (client id) before update saves.
    pub fn save_tab_state(
        &self,
        input: TabStateWriteInput,
        include_cached_results: bool,
    ) -> Result<(), MappedIpcError> {
        self.with_production_db(|db| {
            let write =
                tab_write_from_input(&input, include_cached_results, /* for_update */ true)?;
            match storage_upsert_tab_state(db, write) {
                Ok(_) => Ok(()),
                Err(rusqlite::Error::QueryReturnedNoRows) => Err(MappedIpcError {
                    kind: IpcErrorKind::Unknown,
                    message: "save_tab_state: no rows updated".into(),
                    position: None,
                }),
                Err(e) => Err(sqlite_err(e)),
            }
        })
    }

    pub fn delete_tab_state(&self, id: &str) -> Result<(), MappedIpcError> {
        self.with_production_db(|db| storage_delete_tab_state(db, id).map_err(sqlite_err))
    }

    /// Insert a new tab with a client-provided id (create path).
    pub fn insert_tab_state(
        &self,
        input: TabStateWriteInput,
        include_cached_results: bool,
    ) -> Result<(), MappedIpcError> {
        self.with_production_db(|db| {
            let write =
                tab_write_from_input(&input, include_cached_results, /* for_update */ false)?;
            storage_insert_tab_state_with_id(db, &input.id, write).map_err(sqlite_err)
        })
    }
}

fn tab_write_from_input(
    input: &TabStateWriteInput,
    include_cached_results: bool,
    for_update: bool,
) -> Result<TabStateWrite, MappedIpcError> {
    let cached_bytes = input
        .cached_results_data
        .as_ref()
        .map(|s| s.as_bytes().to_vec());
    let cached_cols = match &input.cached_column_names {
        Some(cols) => Some(serde_json::to_string(cols).map_err(|e| MappedIpcError {
            kind: IpcErrorKind::Unknown,
            message: format!("cached_column_names serialize: {e}"),
            position: None,
        })?),
        None => None,
    };
    Ok(TabStateWrite {
        id: if for_update {
            Some(input.id.clone())
        } else {
            None
        },
        connection_id: input.connection_id.clone(),
        database_name: input.database_name.clone(),
        query_text: input.query_text.clone(),
        saved_query_id: input.saved_query_id.clone(),
        is_active: input.is_active,
        order_index: input.order,
        created_at: input.created_at.clone(),
        last_accessed_at: input.last_accessed_at.clone(),
        selected_table_schema: input.selected_table_schema.clone(),
        selected_table_name: input.selected_table_name.clone(),
        selected_schema_filter: input.selected_schema_filter.clone(),
        include_cached_results,
        cached_results_data: cached_bytes,
        cached_column_names: cached_cols,
        visual_document_json: input.visual_document_json.clone(),
    })
}

/// IPC write body for save_tab_state (mirrors TS TabStateDto; `order` ↔ `order_index`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabStateWriteInput {
    pub id: String,
    pub connection_id: Option<String>,
    pub database_name: Option<String>,
    pub query_text: String,
    pub saved_query_id: Option<String>,
    pub is_active: bool,
    /// TS `order` ↔ Rust storage `order_index`.
    pub order: i64,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub last_accessed_at: Option<String>,
    pub selected_table_schema: Option<String>,
    pub selected_table_name: Option<String>,
    pub selected_schema_filter: Option<String>,
    /// Opaque JSON string; stored as UTF-8 bytes (not base64).
    pub cached_results_data: Option<String>,
    pub cached_column_names: Option<Vec<String>>,
    pub visual_document_json: Option<String>,
}

/// IPC write body for save_saved_query (mirrors TS SavedQueryDto fields used on write).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedQueryWriteInput {
    pub id: String,
    pub name: String,
    pub query_text: String,
    pub connection_id: Option<String>,
    pub database_name: Option<String>,
    pub folder_id: Option<String>,
    /// Accepted from TS DTO; ignored on write (storage owns timestamps).
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
}

async fn establish_live(
    profile: &ProfileRow,
    secrets: &ProfileSecrets,
) -> Result<(Client, Option<TunnelHandle>, AbortHandle), MappedIpcError> {
    let password = secrets.password.as_deref().unwrap_or("");
    let tls = collapse_ssl_mode(&profile.ssl_mode);

    if profile.ssh_enabled {
        let ssh_host = profile
            .ssh_host
            .as_deref()
            .filter(|s| !s.is_empty())
            .ok_or_else(|| MappedIpcError {
                kind: IpcErrorKind::Connection,
                message: "SSH host is required when SSH is enabled.".into(),
                position: None,
            })?;
        let ssh_port = profile.ssh_port.unwrap_or(22) as u16;
        let ssh_username = profile
            .ssh_username
            .as_deref()
            .filter(|s| !s.is_empty())
            .ok_or_else(|| MappedIpcError {
                kind: IpcErrorKind::Auth,
                message: "SSH username is required when SSH is enabled.".into(),
                position: None,
            })?;

        let auth_input = match profile.ssh_auth_method.as_deref() {
            Some("privateKey") => SshAuthInput::PrivateKey {
                key_contents: secrets
                    .ssh_private_key
                    .clone()
                    .ok_or_else(|| MappedIpcError {
                        kind: IpcErrorKind::Auth,
                        message: "SSH private key is missing from keyring.".into(),
                        position: None,
                    })?,
                passphrase: secrets.ssh_passphrase.clone(),
            },
            _ => SshAuthInput::Password {
                password: secrets.ssh_password.clone().ok_or_else(|| MappedIpcError {
                    kind: IpcErrorKind::Auth,
                    message: "SSH password is missing from keyring.".into(),
                    position: None,
                })?,
            },
        };
        let prepared: PreparedAuth = build_auth_method(auth_input).map_err(|e| MappedIpcError {
            kind: IpcErrorKind::Auth,
            message: e.to_string(),
            position: None,
        })?;

        let mut tunnel = TunnelHandle::open(TunnelRequest {
            ssh_host: ssh_host.to_string(),
            ssh_port,
            ssh_username: ssh_username.to_string(),
            auth: prepared,
            remote_db_host: profile.host.clone(),
            remote_db_port: profile.port as u16,
        })
        .await
        .map_err(map_tunnel_error)?;

        let local = tunnel.local_addr().ok_or_else(|| MappedIpcError {
            kind: IpcErrorKind::Connection,
            message: "SSH tunnel has no local listen address.".into(),
            position: None,
        })?;

        match pg_connect(ConnectParams {
            host: "127.0.0.1",
            port: local.port(),
            user: &profile.username,
            password,
            database: &profile.database,
            tls,
        })
        .await
        {
            Ok((client, abort)) => Ok((client, Some(tunnel), abort)),
            Err(e) => {
                let _ = tunnel.shutdown();
                Err(e)
            }
        }
    } else {
        let (client, abort) = pg_connect(ConnectParams {
            host: &profile.host,
            port: profile.port as u16,
            user: &profile.username,
            password,
            database: &profile.database,
            tls,
        })
        .await?;
        Ok((client, None, abort))
    }
}

fn profile_from_fields(id: &str, f: &ProfileFields) -> ProfileRow {
    ProfileRow {
        id: id.to_string(),
        name: f.name.clone(),
        host: f.host.clone(),
        port: f.port,
        username: f.username.clone(),
        database: f.database.clone(),
        is_favorite: f.is_favorite,
        ssl_mode: f.ssl_mode.clone(),
        ssh_enabled: f.ssh_enabled,
        ssh_host: f.ssh_host.clone(),
        ssh_port: f.ssh_port,
        ssh_username: f.ssh_username.clone(),
        ssh_auth_method: f.ssh_auth_method.clone(),
        ssh_private_key_path: f.ssh_private_key_path.clone(),
    }
}

fn secrets_from_input(s: &ProfileSecretsInput) -> ProfileSecrets {
    ProfileSecrets {
        password: nonempty_secret(s.password.as_ref()),
        ssh_password: nonempty_secret(s.ssh_password.as_ref()),
        ssh_passphrase: nonempty_secret(s.ssh_passphrase.as_ref()),
        ssh_private_key: nonempty_secret(s.ssh_private_key.as_ref()),
    }
}

/// Empty string means omit (do not update keyring slot), matching edit-form UX.
fn nonempty_secret(value: Option<&String>) -> Option<String> {
    value.filter(|v| !v.is_empty()).cloned()
}

fn not_connected() -> MappedIpcError {
    MappedIpcError {
        kind: IpcErrorKind::Connection,
        message: "Not connected.".into(),
        position: None,
    }
}

fn map_tunnel_error(err: TunnelError) -> MappedIpcError {
    match err {
        TunnelError::Auth(message) => MappedIpcError {
            kind: IpcErrorKind::Auth,
            message,
            position: None,
        },
        TunnelError::Connection(message) | TunnelError::Io(message) => MappedIpcError {
            kind: IpcErrorKind::Connection,
            message,
            position: None,
        },
    }
}

fn is_connection_kind(err: &MappedIpcError) -> bool {
    err.kind == IpcErrorKind::Connection
}

fn sqlite_err(e: rusqlite::Error) -> MappedIpcError {
    MappedIpcError {
        kind: IpcErrorKind::Unknown,
        message: format!("Storage error: {e}"),
        position: None,
    }
}

fn keyring_err(e: KeyringStoreError) -> MappedIpcError {
    MappedIpcError {
        kind: IpcErrorKind::Unknown,
        message: format!("Keyring error: {e}"),
        position: None,
    }
}

// --- Session-local fakes (tests + FakeDeps constructors) -------------------

/// Injectable fake dependency bundle — stays inside `session` only.
pub struct FakeDeps {
    postgres: FakePostgres,
    ssh: FakeSsh,
    storage: FakeStorage,
    keyring: FakeKeyring,
    seed: FakeSeed,
}

enum FakeSeed {
    Disconnected,
    ConnectedDirect {
        connection_id: String,
        profile_id: String,
    },
    ConnectedSsh {
        connection_id: String,
        profile_id: String,
    },
    WithSavedProfile,
}

impl FakeDeps {
    pub fn disconnected() -> Self {
        Self {
            postgres: FakePostgres::default(),
            ssh: FakeSsh::default(),
            storage: FakeStorage::default(),
            keyring: FakeKeyring::default(),
            seed: FakeSeed::Disconnected,
        }
    }

    pub fn connected_direct() -> Self {
        let profile_id = "profile-direct".to_string();
        let connection_id = "conn-direct".to_string();
        let storage = FakeStorage::default();
        storage.upsert(&sample_row(&profile_id, false));
        let keyring = FakeKeyring::default();
        keyring
            .set_secrets(
                &profile_id,
                &ProfileSecrets {
                    password: Some("pw".into()),
                    ..Default::default()
                },
            )
            .ok();
        Self {
            postgres: FakePostgres::default(),
            ssh: FakeSsh::default(),
            storage,
            keyring,
            seed: FakeSeed::ConnectedDirect {
                connection_id,
                profile_id,
            },
        }
    }

    pub fn connected_direct_with_dead_socket() -> Self {
        let mut deps = Self::connected_direct();
        deps.postgres.dead_socket = true;
        deps
    }

    pub fn connected_ssh_with_dead_socket() -> Self {
        let profile_id = "profile-ssh".to_string();
        let connection_id = "conn-ssh".to_string();
        let storage = FakeStorage::default();
        storage.upsert(&sample_row(&profile_id, true));
        let keyring = FakeKeyring::default();
        keyring
            .set_secrets(
                &profile_id,
                &ProfileSecrets {
                    password: Some("pw".into()),
                    ssh_password: Some("ssh-pw".into()),
                    ..Default::default()
                },
            )
            .ok();
        let mut postgres = FakePostgres::default();
        postgres.dead_socket = true;
        Self {
            postgres,
            ssh: FakeSsh::default(),
            storage,
            keyring,
            seed: FakeSeed::ConnectedSsh {
                connection_id,
                profile_id,
            },
        }
    }

    pub fn connected_query_fails() -> Self {
        let mut deps = Self::connected_direct();
        deps.postgres.force_query_fail = true;
        deps
    }

    pub fn keyring_set_fails() -> Self {
        let mut deps = Self::disconnected();
        deps.keyring.fail_set = true;
        deps
    }

    pub fn keyring_partial_set_fails(profile_id: &str) -> Self {
        let mut deps = Self::with_saved_profile(profile_id);
        deps.keyring.fail_after_password = true;
        deps
    }

    pub fn with_saved_profile(profile_id: &str) -> Self {
        let storage = FakeStorage::default();
        storage.upsert(&sample_row(profile_id, false));
        let keyring = FakeKeyring::default();
        keyring
            .set_secrets(
                profile_id,
                &ProfileSecrets {
                    password: Some("pw".into()),
                    ..Default::default()
                },
            )
            .ok();
        Self {
            postgres: FakePostgres::default(),
            ssh: FakeSsh::default(),
            storage,
            keyring,
            seed: FakeSeed::WithSavedProfile,
        }
    }

    fn seed_active(&self) -> Option<ActiveSession> {
        match &self.seed {
            FakeSeed::Disconnected | FakeSeed::WithSavedProfile => None,
            FakeSeed::ConnectedDirect {
                connection_id,
                profile_id,
            }
            | FakeSeed::ConnectedSsh {
                connection_id,
                profile_id,
            } => {
                let ssh_enabled = matches!(self.seed, FakeSeed::ConnectedSsh { .. });
                let profile = self
                    .storage
                    .get_profile(profile_id)
                    .unwrap_or_else(|| sample_row(profile_id, ssh_enabled));
                let secrets = self.keyring.get_secrets(profile_id).unwrap_or_default();
                Some(ActiveSession {
                    connection_id: connection_id.clone(),
                    profile_id: profile_id.clone(),
                    profile,
                    secrets,
                    client: None,
                    cancel_token: None,
                    tunnel: None,
                    ssh_enabled,
                    live: true,
                })
            }
        }
    }
}

fn sample_row(id: &str, ssh_enabled: bool) -> ProfileRow {
    ProfileRow {
        id: id.to_string(),
        name: Some("dev".into()),
        host: "127.0.0.1".into(),
        port: 5432,
        username: "postgres".into(),
        database: "app".into(),
        is_favorite: false,
        ssl_mode: "prefer".into(),
        ssh_enabled,
        ssh_host: if ssh_enabled {
            Some("bastion".into())
        } else {
            None
        },
        ssh_port: if ssh_enabled { Some(22) } else { None },
        ssh_username: if ssh_enabled {
            Some("ubuntu".into())
        } else {
            None
        },
        ssh_auth_method: if ssh_enabled {
            Some("password".into())
        } else {
            None
        },
        ssh_private_key_path: None,
    }
}

#[cfg(test)]
fn sample_profile_fields() -> ProfileFields {
    ProfileFields {
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

#[derive(Default)]
pub struct FakePostgres {
    connect_calls: AtomicU32,
    query_attempts: AtomicU32,
    dead_socket: bool,
    force_query_fail: bool,
    /// Fail the next N `connect` calls (oneshot rebuild), then succeed.
    fail_connect_remaining: AtomicU32,
    /// After reconnect clears dead_socket, subsequent queries succeed.
    dead_cleared: StdMutex<bool>,
    last_sql: StdMutex<Option<String>>,
    last_params: StdMutex<Vec<serde_json::Value>>,
}

impl FakePostgres {
    pub fn connect_calls(&self) -> u32 {
        self.connect_calls.load(Ordering::SeqCst)
    }

    pub fn query_attempts(&self) -> u32 {
        self.query_attempts.load(Ordering::SeqCst)
    }

    pub fn last_sql(&self) -> Option<String> {
        self.last_sql.lock().ok().and_then(|g| g.clone())
    }

    pub fn last_params(&self) -> Vec<serde_json::Value> {
        self.last_params
            .lock()
            .map(|g| g.clone())
            .unwrap_or_default()
    }

    fn record_query(&self, sql: &str, params: &[serde_json::Value]) {
        if let Ok(mut g) = self.last_sql.lock() {
            *g = Some(sql.to_string());
        }
        if let Ok(mut g) = self.last_params.lock() {
            *g = params.to_vec();
        }
    }

    fn connect(&self) -> Result<(), MappedIpcError> {
        self.connect_calls.fetch_add(1, Ordering::SeqCst);
        let prev = self.fail_connect_remaining.load(Ordering::SeqCst);
        if prev > 0 {
            self.fail_connect_remaining
                .store(prev - 1, Ordering::SeqCst);
            return Err(MappedIpcError {
                kind: IpcErrorKind::Connection,
                message: "Connection error: injected connect failure.".into(),
                position: None,
            });
        }
        Ok(())
    }

    fn clear_dead_socket(&self) {
        if let Ok(mut g) = self.dead_cleared.lock() {
            *g = true;
        }
    }

    fn query_attempt(&self, force_db_err: bool) -> Result<(), MappedIpcError> {
        self.query_attempts.fetch_add(1, Ordering::SeqCst);
        if force_db_err {
            return Err(MappedIpcError {
                kind: IpcErrorKind::Syntax,
                message: "SQL syntax error: SELECT bad".into(),
                position: None,
            });
        }
        let cleared = self.dead_cleared.lock().map(|g| *g).unwrap_or(false);
        if self.dead_socket && !cleared {
            return Err(MappedIpcError {
                kind: IpcErrorKind::Connection,
                message: "Connection error: server closed the connection.".into(),
                position: None,
            });
        }
        Ok(())
    }
}

#[derive(Default)]
pub struct FakeSsh {
    open_calls: AtomicU32,
}

impl FakeSsh {
    pub fn open_calls(&self) -> u32 {
        self.open_calls.load(Ordering::SeqCst)
    }

    fn open(&self) -> Result<(), MappedIpcError> {
        self.open_calls.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}

#[derive(Default)]
pub struct FakeStorage {
    profiles: StdMutex<HashMap<String, ProfileRow>>,
    history: StdMutex<Vec<HistoryInsert>>,
}

impl FakeStorage {
    pub fn profile_count(&self) -> usize {
        self.profiles.lock().map(|g| g.len()).unwrap_or(0)
    }

    pub fn history_count(&self) -> usize {
        self.history.lock().map(|g| g.len()).unwrap_or(0)
    }

    pub fn last_history(&self) -> Option<HistoryInsert> {
        self.history.lock().ok().and_then(|g| g.last().cloned())
    }

    fn list_profiles(&self) -> Vec<ProfileRow> {
        self.profiles
            .lock()
            .map(|g| g.values().cloned().collect())
            .unwrap_or_default()
    }

    fn get_profile(&self, id: &str) -> Option<ProfileRow> {
        self.profiles.lock().ok().and_then(|g| g.get(id).cloned())
    }

    fn upsert(&self, row: &ProfileRow) {
        if let Ok(mut g) = self.profiles.lock() {
            g.insert(row.id.clone(), row.clone());
        }
    }

    fn delete(&self, id: &str) {
        if let Ok(mut g) = self.profiles.lock() {
            g.remove(id);
        }
    }

    fn insert_history(&self, entry: HistoryInsert) {
        if let Ok(mut g) = self.history.lock() {
            g.push(entry);
        }
    }
}

#[derive(Default)]
pub struct FakeKeyring {
    store: StdMutex<HashMap<String, ProfileSecrets>>,
    fail_set: bool,
    /// Write password slot then fail — simulates partial OS keyring write.
    fail_after_password: bool,
}

impl FakeKeyring {
    pub fn secret_count_for(&self, profile_id: &str) -> usize {
        self.store
            .lock()
            .ok()
            .and_then(|g| g.get(profile_id).map(count_secret_slots))
            .unwrap_or(0)
    }

    fn set_secrets(
        &self,
        profile_id: &str,
        secrets: &ProfileSecrets,
    ) -> Result<(), MappedIpcError> {
        if self.fail_set {
            return Err(MappedIpcError {
                kind: IpcErrorKind::Unknown,
                message: "Keyring error: injected set failure.".into(),
                position: None,
            });
        }
        if self.fail_after_password {
            if let Ok(mut g) = self.store.lock() {
                let mut current = g.get(profile_id).cloned().unwrap_or_default();
                if let Some(ref password) = secrets.password {
                    if !password.is_empty() {
                        current.password = Some(password.clone());
                    }
                }
                g.insert(profile_id.to_string(), current);
            }
            return Err(MappedIpcError {
                kind: IpcErrorKind::Unknown,
                message: "Keyring error: injected partial set failure.".into(),
                position: None,
            });
        }
        if let Ok(mut g) = self.store.lock() {
            let mut current = g.get(profile_id).cloned().unwrap_or_default();
            // Merge slots like KeyringStore — omit empty strings and preserve unset slots.
            if let Some(ref password) = secrets.password {
                if !password.is_empty() {
                    current.password = Some(password.clone());
                }
            }
            if let Some(ref ssh_password) = secrets.ssh_password {
                if !ssh_password.is_empty() {
                    current.ssh_password = Some(ssh_password.clone());
                }
            }
            if let Some(ref ssh_passphrase) = secrets.ssh_passphrase {
                if !ssh_passphrase.is_empty() {
                    current.ssh_passphrase = Some(ssh_passphrase.clone());
                }
            }
            if let Some(ref ssh_private_key) = secrets.ssh_private_key {
                if !ssh_private_key.is_empty() {
                    current.ssh_private_key = Some(ssh_private_key.clone());
                }
            }
            g.insert(profile_id.to_string(), current);
        }
        Ok(())
    }

    fn get_secrets(&self, profile_id: &str) -> Result<ProfileSecrets, MappedIpcError> {
        self.store
            .lock()
            .ok()
            .and_then(|g| g.get(profile_id).cloned())
            .ok_or_else(|| MappedIpcError {
                kind: IpcErrorKind::Auth,
                message: format!("No secrets found for profile {profile_id}"),
                position: None,
            })
    }

    fn delete_all(&self, profile_id: &str) {
        if let Ok(mut g) = self.store.lock() {
            g.remove(profile_id);
        }
    }
}

fn count_secret_slots(s: &ProfileSecrets) -> usize {
    let mut n = 0;
    if s.password.is_some() {
        n += 1;
    }
    if s.ssh_password.is_some() {
        n += 1;
    }
    if s.ssh_passphrase.is_some() {
        n += 1;
    }
    if s.ssh_private_key.is_some() {
        n += 1;
    }
    n
}

fn sample_columns() -> Vec<ColumnInfoRow> {
    vec![ColumnInfoRow {
        name: "id".into(),
        data_type: "integer".into(),
        is_nullable: false,
        default_value: None,
        is_primary_key: true,
        is_unique: true,
        is_foreign_key: false,
    }]
}

fn sample_query_result() -> QueryResultData {
    QueryResultData {
        columns: vec!["?column?".into()],
        rows: vec![vec![crate::postgres::Value::Int(1)]],
        rows_affected: None,
        duration_ms: 1,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn disconnect_clears_session_and_rejects_list_without_silent_reconnect() {
        let mut session = AppSession::with_fakes(FakeDeps::connected_direct());
        session.disconnect().await.expect("disconnect");
        let err = session
            .list_tables("stale-id")
            .await
            .expect_err("must fail after disconnect");
        assert_eq!(err.kind, IpcErrorKind::Connection);
        assert_eq!(session.fake_postgres().connect_calls(), 0); // no silent reconnect
    }

    #[tokio::test]
    async fn wrong_connection_id_rejects_without_reconnect() {
        let mut session = AppSession::with_fakes(FakeDeps::connected_direct());
        let live = session
            .active_connection_id()
            .expect("connected")
            .to_string();
        let err = session
            .list_tables("not-the-live-id")
            .await
            .expect_err("mismatch");
        assert_eq!(err.kind, IpcErrorKind::Connection);
        assert_ne!(live, "not-the-live-id");
        assert_eq!(session.fake_postgres().connect_calls(), 0);
    }

    #[test]
    fn map_tunnel_error_maps_auth_to_auth_kind() {
        let err = map_tunnel_error(TunnelError::Auth(
            "SSH password authentication failed".into(),
        ));
        assert_eq!(err.kind, IpcErrorKind::Auth);
        assert!(err.message.to_lowercase().contains("authentication"));
    }

    #[test]
    fn map_tunnel_error_maps_connection_and_io_to_connection_kind() {
        let conn = map_tunnel_error(TunnelError::Connection("SSH handshake failed".into()));
        assert_eq!(conn.kind, IpcErrorKind::Connection);
        let io = map_tunnel_error(TunnelError::Io(
            "Failed to bind local tunnel listener".into(),
        ));
        assert_eq!(io.kind, IpcErrorKind::Connection);
    }

    #[tokio::test]
    async fn dead_ssh_socket_rebuilds_tunnel_and_db_once_then_retries_query_once() {
        let mut session = AppSession::with_fakes(FakeDeps::connected_ssh_with_dead_socket());
        let cid = session.active_connection_id().unwrap().to_string();
        let _ = session
            .run_query(
                &cid,
                ExecutableSql {
                    text: "SELECT 1".into(),
                    params: vec![],
                },
            )
            .await;
        assert_eq!(session.fake_ssh().open_calls(), 1); // one rebuild
        assert_eq!(session.fake_postgres().connect_calls(), 1);
        assert_eq!(session.fake_postgres().query_attempts(), 2); // original + one retry
    }

    #[tokio::test]
    async fn dead_direct_db_reconnects_db_only_without_inventing_tunnel() {
        let mut session = AppSession::with_fakes(FakeDeps::connected_direct_with_dead_socket());
        let cid = session.active_connection_id().unwrap().to_string();
        let _ = session
            .run_query(
                &cid,
                ExecutableSql {
                    text: "SELECT 1".into(),
                    params: vec![],
                },
            )
            .await;
        assert_eq!(session.fake_ssh().open_calls(), 0);
        assert_eq!(session.fake_postgres().connect_calls(), 1);
        assert_eq!(session.fake_postgres().query_attempts(), 2);
    }

    #[tokio::test]
    async fn missing_live_handle_while_connected_triggers_oneshot_on_run_query() {
        let mut session = AppSession::with_fakes(FakeDeps::connected_direct());
        session.strip_live_handle_for_test();
        let cid = session
            .active_connection_id()
            .expect("still connected")
            .to_string();
        session
            .run_query(
                &cid,
                ExecutableSql {
                    text: "SELECT 1".into(),
                    params: vec![],
                },
            )
            .await
            .expect("oneshot rebuild while Connected");
        assert_eq!(
            session.fake_postgres().connect_calls(),
            1,
            "missing live handle must attempt oneshot rebuild, not bare not_connected"
        );
    }

    #[tokio::test]
    async fn after_failed_oneshot_subsequent_run_retries_rebuild() {
        let mut deps = FakeDeps::connected_direct_with_dead_socket();
        deps.postgres.fail_connect_remaining = AtomicU32::new(1);
        let mut session = AppSession::with_fakes(deps);
        let cid = session.active_connection_id().unwrap().to_string();
        let err = session
            .run_query(
                &cid,
                ExecutableSql {
                    text: "SELECT 1".into(),
                    params: vec![],
                },
            )
            .await
            .expect_err("first oneshot connect fails");
        assert_eq!(err.kind, IpcErrorKind::Connection);
        assert!(
            session.active_connection_id().is_some(),
            "failed oneshot must keep Connected claim"
        );
        assert_eq!(session.fake_postgres().connect_calls(), 1);

        session
            .run_query(
                &cid,
                ExecutableSql {
                    text: "SELECT 1".into(),
                    params: vec![],
                },
            )
            .await
            .expect("second call retries oneshot");
        assert_eq!(session.fake_postgres().connect_calls(), 2);
    }

    #[tokio::test]
    async fn save_profile_rolls_back_sqlite_when_keyring_fails() {
        let mut session = AppSession::with_fakes(FakeDeps::keyring_set_fails());
        let err = session
            .save_profile(SaveProfileInput {
                id: None,
                profile: sample_profile_fields(),
                secrets: ProfileSecretsInput {
                    password: Some("pw".into()),
                    ..Default::default()
                },
            })
            .await
            .expect_err("keyring fail");
        assert!(matches!(
            err.kind,
            IpcErrorKind::Unknown | IpcErrorKind::Auth
        ));
        assert_eq!(session.fake_storage().profile_count(), 0);
    }

    #[tokio::test]
    async fn save_profile_update_rolls_back_keyring_after_partial_write_failure() {
        let profile_id = "p-update";
        let mut session = AppSession::with_fakes(FakeDeps::keyring_partial_set_fails(profile_id));

        let err = session
            .save_profile(SaveProfileInput {
                id: Some(profile_id.to_string()),
                profile: sample_profile_fields(),
                secrets: ProfileSecretsInput {
                    password: Some("new-pw".into()),
                    ssh_password: Some("ssh-new".into()),
                    ..Default::default()
                },
            })
            .await
            .expect_err("partial keyring fail");
        assert_eq!(err.kind, IpcErrorKind::Unknown);

        let restored = session
            .fake_keyring()
            .get_secrets(profile_id)
            .expect("prior secrets restored");
        assert_eq!(
            restored.password.as_deref(),
            Some("pw"),
            "partial write must not leave new password"
        );
        assert!(restored.ssh_password.is_none());
    }

    #[tokio::test]
    async fn run_query_forwards_placeholder_params_to_executor() {
        let mut session = AppSession::with_fakes(FakeDeps::connected_direct());
        let cid = session.active_connection_id().unwrap().to_string();
        session
            .run_query(
                &cid,
                ExecutableSql {
                    text: "SELECT * FROM t WHERE \"col\" = $1".into(),
                    params: vec![serde_json::json!("alice")],
                },
            )
            .await
            .expect("run with params");
        assert_eq!(
            session.fake_postgres().last_sql().as_deref(),
            Some("SELECT * FROM t WHERE \"col\" = $1")
        );
        assert_eq!(
            session.fake_postgres().last_params(),
            vec![serde_json::json!("alice")]
        );
    }

    #[tokio::test]
    async fn save_profile_while_connected_refreshes_active_cache() {
        let mut session = AppSession::with_fakes(FakeDeps::connected_direct());
        let profile_id = session.active_profile_id().unwrap().to_string();
        assert_eq!(
            session.active_cached_password_for_test().as_deref(),
            Some("pw")
        );

        let mut fields = sample_profile_fields();
        fields.host = "db.example".into();
        session
            .save_profile(SaveProfileInput {
                id: Some(profile_id),
                profile: fields,
                secrets: ProfileSecretsInput {
                    password: Some("new-pw".into()),
                    ..Default::default()
                },
            })
            .await
            .expect("save while connected");

        assert_eq!(
            session.active_cached_host_for_test().as_deref(),
            Some("db.example")
        );
        assert_eq!(
            session.active_cached_password_for_test().as_deref(),
            Some("new-pw")
        );
    }

    #[tokio::test]
    async fn save_profile_empty_secret_strings_do_not_wipe_keyring() {
        let profile_id = "p-keep-secret";
        let mut session = AppSession::with_fakes(FakeDeps::with_saved_profile(profile_id));
        session
            .save_profile(SaveProfileInput {
                id: Some(profile_id.to_string()),
                profile: sample_profile_fields(),
                secrets: ProfileSecretsInput {
                    password: Some(String::new()),
                    ssh_password: Some(String::new()),
                    ..Default::default()
                },
            })
            .await
            .expect("save with cleared fields");
        let kept = session
            .fake_keyring()
            .get_secrets(profile_id)
            .expect("prior password kept");
        assert_eq!(kept.password.as_deref(), Some("pw"));
    }

    #[tokio::test]
    async fn run_query_inserts_history_on_success_and_db_error_but_not_when_disconnected() {
        let mut ok_session = AppSession::with_fakes(FakeDeps::connected_direct());
        let cid = ok_session.active_connection_id().unwrap().to_string();
        ok_session
            .run_query(
                &cid,
                ExecutableSql {
                    text: "SELECT 1".into(),
                    params: vec![],
                },
            )
            .await
            .expect("ok");
        assert_eq!(ok_session.fake_storage().history_count(), 1);
        assert!(ok_session.fake_storage().last_history().unwrap().success);

        let mut fail_session = AppSession::with_fakes(FakeDeps::connected_query_fails());
        let cid = fail_session.active_connection_id().unwrap().to_string();
        let _ = fail_session
            .run_query(
                &cid,
                ExecutableSql {
                    text: "SELECT bad".into(),
                    params: vec![],
                },
            )
            .await;
        assert_eq!(fail_session.fake_storage().history_count(), 1);
        assert!(!fail_session.fake_storage().last_history().unwrap().success);

        let mut disconnected = AppSession::with_fakes(FakeDeps::disconnected());
        let _ = disconnected
            .run_query(
                "none",
                ExecutableSql {
                    text: "SELECT 1".into(),
                    params: vec![],
                },
            )
            .await;
        assert_eq!(disconnected.fake_storage().history_count(), 0);
    }

    // T12 finer history characterization (existing FakeDeps only; may PASS first run).
    #[tokio::test]
    async fn run_query_success_writes_history_with_sql_duration_and_row_count() {
        let mut session = AppSession::with_fakes(FakeDeps::connected_direct());
        let cid = session.active_connection_id().unwrap().to_string();
        session
            .run_query(
                &cid,
                ExecutableSql {
                    text: "SELECT id FROM users".into(),
                    params: vec![],
                },
            )
            .await
            .expect("ok");
        let row = session.fake_storage().last_history().expect("history row");
        assert!(row.success);
        assert_eq!(row.sql, "SELECT id FROM users");
        assert!(row.duration_ms >= 0);
        // sample_query_result returns 1 row
        assert_eq!(row.row_count, Some(1));
    }

    #[tokio::test]
    async fn run_query_db_error_after_attempt_writes_failed_history_row() {
        let mut session = AppSession::with_fakes(FakeDeps::connected_query_fails());
        let cid = session.active_connection_id().unwrap().to_string();
        let _ = session
            .run_query(
                &cid,
                ExecutableSql {
                    text: "SELECT * FROM secrets".into(),
                    params: vec![],
                },
            )
            .await;
        let row = session
            .fake_storage()
            .last_history()
            .expect("failed history");
        assert!(!row.success);
        assert!(row
            .error_message
            .as_deref()
            .unwrap_or("")
            .to_lowercase()
            .contains("syntax"));
        assert_eq!(row.sql, "SELECT * FROM secrets");
    }

    #[tokio::test]
    async fn disconnected_run_query_does_not_insert_history() {
        let mut session = AppSession::with_fakes(FakeDeps::disconnected());
        let _ = session
            .run_query(
                "none",
                ExecutableSql {
                    text: "SELECT 1".into(),
                    params: vec![],
                },
            )
            .await;
        assert_eq!(session.fake_storage().history_count(), 0);
    }

    #[tokio::test]
    async fn connect_profile_returns_opaque_connection_id_distinct_from_profile_id() {
        let mut session = AppSession::with_fakes(FakeDeps::with_saved_profile("p-uuid"));
        let result = session.connect_profile("p-uuid").await.expect("connect");
        assert_eq!(result.profile_id, "p-uuid");
        assert!(!result.connection_id.is_empty());
        assert_ne!(result.connection_id, result.profile_id);
    }

    #[tokio::test]
    async fn delete_active_profile_disconnects_then_removes_row_and_secrets() {
        let mut session = AppSession::with_fakes(FakeDeps::connected_direct());
        let profile_id = session.active_profile_id().unwrap().to_string();
        session.delete_profile(&profile_id).await.expect("delete");
        assert!(session.active_connection_id().is_none());
        assert_eq!(session.fake_storage().profile_count(), 0);
        assert_eq!(session.fake_keyring().secret_count_for(&profile_id), 0);
        let err = session.list_tables("any").await.expect_err("cleared");
        assert_eq!(err.kind, IpcErrorKind::Connection);
    }

    #[tokio::test]
    async fn create_database_does_not_select_until_explicit_switch() {
        let mut session = AppSession::with_fakes(FakeDeps::connected_direct());
        let connection_id = session.active_connection_id().unwrap().to_string();
        let original = session.active.as_ref().unwrap().profile.database.clone();

        session
            .create_database("shop")
            .await
            .expect("create database");
        assert_eq!(session.active.as_ref().unwrap().profile.database, original);

        session
            .switch_database(&connection_id, "shop")
            .await
            .expect("explicit switch");
        assert_eq!(session.active.as_ref().unwrap().profile.database, "shop");
    }

    #[tokio::test]
    async fn delete_database_moves_the_live_session_off_the_dropped_database() {
        let mut session = AppSession::with_fakes(FakeDeps::connected_direct());
        let original = session.active.as_ref().unwrap().profile.database.clone();
        assert_eq!(original, "app");

        session
            .delete_database("app")
            .await
            .expect("delete database");
        assert_eq!(
            session.active.as_ref().unwrap().profile.database,
            "postgres"
        );
    }
}
