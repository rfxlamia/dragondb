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
use tokio_postgres::Client;
use uuid::Uuid;

use crate::postgres::{
    collapse_ssl_mode, connect as pg_connect, list_columns as pg_list_columns,
    list_tables as pg_list_tables, run_query as pg_run_query, ColumnInfoRow, ConnectParams,
    IpcErrorKind, MappedIpcError, QueryResultData, TableRefRow,
};
use crate::secrets::{KeyringStore, KeyringStoreError, ProfileSecrets};
use crate::ssh::{
    build_auth_method, PreparedAuth, SshAuthInput, TunnelHandle, TunnelRequest,
};
use crate::storage::{
    delete_profile as storage_delete_profile, get_profile as storage_get_profile,
    insert_history, list_profiles as storage_list_profiles, open_db, upsert_profile,
    HistoryInsert, ProfileRow,
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
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSecretsInput {
    pub password: Option<String>,
    pub ssh_password: Option<String>,
    pub ssh_passphrase: Option<String>,
    pub ssh_private_key: Option<String>,
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
}

/// Table ref for list_columns.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableRefArg {
    pub name: String,
    #[serde(default)]
    pub schema: Option<String>,
}

struct ActiveSession {
    connection_id: String,
    profile_id: String,
    profile: ProfileRow,
    /// Cached for reconnect (never logged).
    secrets: ProfileSecrets,
    client: Option<Client>,
    tunnel: Option<TunnelHandle>,
    ssh_enabled: bool,
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
}

impl AppSession {
    /// Open production session under `app_data_dir`.
    pub fn open(app_data_dir: &Path) -> Result<Self, MappedIpcError> {
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
        })
    }

    /// Test constructor with session-local fakes.
    pub fn with_fakes(deps: FakeDeps) -> Self {
        let active = deps.seed_active();
        Self {
            backend: Backend::Fake(deps),
            active,
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
                {
                    let guard = db.lock().map_err(|_| MappedIpcError {
                        kind: IpcErrorKind::Unknown,
                        message: "Storage lock poisoned.".into(),
                        position: None,
                    })?;
                    upsert_profile(&guard, &row).map_err(sqlite_err)?;
                }
                match keyring.set_secrets(&id, &secrets) {
                    Ok(()) => Ok(row),
                    Err(e) => {
                        if is_create {
                            if let Ok(guard) = db.lock() {
                                let _ = storage_delete_profile(&guard, &id);
                            }
                            let _ = keyring.delete_all_for_profile(&id);
                        } else if let Some(prior) = prior {
                            if let Ok(guard) = db.lock() {
                                let _ = upsert_profile(&guard, &prior);
                            }
                        }
                        Err(keyring_err(e))
                    }
                }
            }
            Backend::Fake(d) => {
                let prior = if !is_create {
                    d.storage.get_profile(&id)
                } else {
                    None
                };
                d.storage.upsert(&row);
                match d.keyring.set_secrets(&id, &secrets) {
                    Ok(()) => Ok(row),
                    Err(e) => {
                        if is_create {
                            d.storage.delete(&id);
                            d.keyring.delete_all(&id);
                        } else if let Some(prior) = prior {
                            d.storage.upsert(&prior);
                        }
                        Err(e)
                    }
                }
            }
        }
    }

    pub async fn delete_profile(&mut self, id: &str) -> Result<(), MappedIpcError> {
        if self.active.as_ref().map(|a| a.profile_id.as_str()) == Some(id) {
            self.disconnect().await?;
        }
        match &mut self.backend {
            Backend::Production { db, keyring } => {
                {
                    let guard = db.lock().map_err(|_| MappedIpcError {
                        kind: IpcErrorKind::Unknown,
                        message: "Storage lock poisoned.".into(),
                        position: None,
                    })?;
                    storage_delete_profile(&guard, id).map_err(sqlite_err)?;
                }
                keyring
                    .delete_all_for_profile(id)
                    .map_err(keyring_err)?;
                Ok(())
            }
            Backend::Fake(d) => {
                d.storage.delete(id);
                d.keyring.delete_all(id);
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

        let secrets = self.load_secrets(id)?;
        let connection_id = Uuid::new_v4().to_string();

        match &mut self.backend {
            Backend::Production { .. } => {
                let ssh_enabled = profile.ssh_enabled;
                let (client, tunnel) = establish_live(&profile, &secrets).await?;
                self.active = Some(ActiveSession {
                    connection_id: connection_id.clone(),
                    profile_id: id.to_string(),
                    profile,
                    secrets,
                    client: Some(client),
                    tunnel,
                    ssh_enabled,
                });
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
                    tunnel: None,
                    ssh_enabled,
                });
            }
        }

        Ok(ConnectResult {
            connection_id,
            profile_id: id.to_string(),
        })
    }

    pub async fn disconnect(&mut self) -> Result<(), MappedIpcError> {
        if let Some(mut active) = self.active.take() {
            if let Some(mut tunnel) = active.tunnel.take() {
                let _ = tunnel.shutdown();
            }
            // Drop client by clearing Option.
            active.client = None;
        }
        Ok(())
    }

    pub async fn list_tables(
        &mut self,
        connection_id: &str,
    ) -> Result<Vec<TableRefRow>, MappedIpcError> {
        self.require_live(connection_id)?;
        let is_fake = matches!(self.backend, Backend::Fake(_));
        if is_fake {
            let first = self.fake_query_probe(false);
            return match first {
                Ok(()) => Ok(vec![TableRefRow {
                    schema: "public".into(),
                    name: "users".into(),
                }]),
                Err(e) if is_connection_kind(&e) => {
                    self.oneshot_reconnect().await?;
                    self.fake_query_probe(false)?;
                    Ok(vec![TableRefRow {
                        schema: "public".into(),
                        name: "users".into(),
                    }])
                }
                Err(e) => Err(e),
            };
        }

        let first = {
            let client = self
                .active
                .as_ref()
                .and_then(|a| a.client.as_ref())
                .ok_or_else(not_connected)?;
            pg_list_tables(client).await
        };
        match first {
            Ok(rows) => Ok(rows),
            Err(e) if is_connection_kind(&e) => {
                self.oneshot_reconnect().await?;
                let client = self
                    .active
                    .as_ref()
                    .and_then(|a| a.client.as_ref())
                    .ok_or_else(not_connected)?;
                pg_list_tables(client).await
            }
            Err(e) => Err(e),
        }
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
        if is_fake {
            let first = self.fake_query_probe(false);
            return match first {
                Ok(()) => Ok(sample_columns()),
                Err(e) if is_connection_kind(&e) => {
                    self.oneshot_reconnect().await?;
                    self.fake_query_probe(false)?;
                    Ok(sample_columns())
                }
                Err(e) => Err(e),
            };
        }

        let first = {
            let client = self
                .active
                .as_ref()
                .and_then(|a| a.client.as_ref())
                .ok_or_else(not_connected)?;
            pg_list_columns(client, schema, &table_name).await
        };
        match first {
            Ok(rows) => Ok(rows),
            Err(e) if is_connection_kind(&e) => {
                self.oneshot_reconnect().await?;
                let client = self
                    .active
                    .as_ref()
                    .and_then(|a| a.client.as_ref())
                    .ok_or_else(not_connected)?;
                pg_list_columns(client, schema, &table_name).await
            }
            Err(e) => Err(e),
        }
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
        let result = self.execute_query_with_oneshot_reconnect(&sql.text).await;
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
    ) -> Result<QueryResultData, MappedIpcError> {
        let is_fake = matches!(self.backend, Backend::Fake(_));
        if is_fake {
            let force_db_err = match &self.backend {
                Backend::Fake(d) => d.postgres.force_query_fail,
                Backend::Production { .. } => false,
            };
            let first = self.fake_query_probe(force_db_err);
            return match first {
                Ok(()) => Ok(sample_query_result()),
                Err(e) if is_connection_kind(&e) => {
                    self.oneshot_reconnect().await?;
                    self.fake_query_probe(force_db_err)?;
                    Ok(sample_query_result())
                }
                Err(e) => Err(e),
            };
        }

        let first = {
            let client = self
                .active
                .as_ref()
                .and_then(|a| a.client.as_ref())
                .ok_or_else(not_connected)?;
            pg_run_query(client, sql).await
        };
        match first {
            Ok(r) => Ok(r),
            Err(e) if is_connection_kind(&e) => {
                self.oneshot_reconnect().await?;
                let client = self
                    .active
                    .as_ref()
                    .and_then(|a| a.client.as_ref())
                    .ok_or_else(not_connected)?;
                pg_run_query(client, sql).await
            }
            Err(e) => Err(e),
        }
    }

    fn fake_query_probe(&self, force_db_err: bool) -> Result<(), MappedIpcError> {
        match &self.backend {
            Backend::Fake(d) => d.postgres.query_attempt(force_db_err),
            Backend::Production { .. } => Ok(()),
        }
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

        let profile = active.profile.clone();
        let secrets = active.secrets.clone();
        let ssh_enabled = active.ssh_enabled;

        match &mut self.backend {
            Backend::Production { .. } => {
                let (client, tunnel) = establish_live(&profile, &secrets).await?;
                if let Some(a) = self.active.as_mut() {
                    a.client = Some(client);
                    a.tunnel = tunnel;
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
            Backend::Production { keyring, .. } => keyring.get_secrets(profile_id).map_err(keyring_err),
            Backend::Fake(d) => d.keyring.get_secrets(profile_id),
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
}

async fn establish_live(
    profile: &ProfileRow,
    secrets: &ProfileSecrets,
) -> Result<(Client, Option<TunnelHandle>), MappedIpcError> {
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
                password: secrets
                    .ssh_password
                    .clone()
                    .ok_or_else(|| MappedIpcError {
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
        .map_err(|e| MappedIpcError {
            kind: IpcErrorKind::Connection,
            message: e.to_string(),
            position: None,
        })?;

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
            Ok(client) => Ok((client, Some(tunnel))),
            Err(e) => {
                let _ = tunnel.shutdown();
                Err(e)
            }
        }
    } else {
        let client = pg_connect(ConnectParams {
            host: &profile.host,
            port: profile.port as u16,
            user: &profile.username,
            password,
            database: &profile.database,
            tls,
        })
        .await?;
        Ok((client, None))
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
        password: s.password.clone(),
        ssh_password: s.ssh_password.clone(),
        ssh_passphrase: s.ssh_passphrase.clone(),
        ssh_private_key: s.ssh_private_key.clone(),
    }
}

fn not_connected() -> MappedIpcError {
    MappedIpcError {
        kind: IpcErrorKind::Connection,
        message: "Not connected.".into(),
        position: None,
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
                let secrets = self
                    .keyring
                    .get_secrets(profile_id)
                    .unwrap_or_default();
                Some(ActiveSession {
                    connection_id: connection_id.clone(),
                    profile_id: profile_id.clone(),
                    profile,
                    secrets,
                    client: None,
                    tunnel: None,
                    ssh_enabled,
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
    /// After reconnect clears dead_socket, subsequent queries succeed.
    dead_cleared: StdMutex<bool>,
}

impl FakePostgres {
    pub fn connect_calls(&self) -> u32 {
        self.connect_calls.load(Ordering::SeqCst)
    }

    pub fn query_attempts(&self) -> u32 {
        self.query_attempts.load(Ordering::SeqCst)
    }

    fn connect(&self) -> Result<(), MappedIpcError> {
        self.connect_calls.fetch_add(1, Ordering::SeqCst);
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
        let cleared = self
            .dead_cleared
            .lock()
            .map(|g| *g)
            .unwrap_or(false);
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
        self.history
            .lock()
            .ok()
            .and_then(|g| g.last().cloned())
    }

    fn list_profiles(&self) -> Vec<ProfileRow> {
        self.profiles
            .lock()
            .map(|g| g.values().cloned().collect())
            .unwrap_or_default()
    }

    fn get_profile(&self, id: &str) -> Option<ProfileRow> {
        self.profiles
            .lock()
            .ok()
            .and_then(|g| g.get(id).cloned())
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
        if let Ok(mut g) = self.store.lock() {
            g.insert(profile_id.to_string(), secrets.clone());
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
        let live = session.active_connection_id().expect("connected").to_string();
        let err = session
            .list_tables("not-the-live-id")
            .await
            .expect_err("mismatch");
        assert_eq!(err.kind, IpcErrorKind::Connection);
        assert_ne!(live, "not-the-live-id");
        assert_eq!(session.fake_postgres().connect_calls(), 0);
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
        assert!(matches!(err.kind, IpcErrorKind::Unknown | IpcErrorKind::Auth));
        assert_eq!(session.fake_storage().profile_count(), 0);
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
        let row = session.fake_storage().last_history().expect("failed history");
        assert!(!row.success);
        assert!(
            row.error_message
                .as_deref()
                .unwrap_or("")
                .to_lowercase()
                .contains("syntax")
        );
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
}
