//! Standalone connection probe. This module owns every temporary resource and
//! never receives or mutates the live application session.

use tokio_postgres::Client;

use super::{connect, ConnectParams, EffectiveTls, IpcErrorKind, MappedIpcError};
use crate::ssh::{build_auth_method, PreparedAuth, SshAuthInput, TunnelHandle, TunnelRequest};

pub struct ProbeConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub database: String,
    pub tls: EffectiveTls,
    pub ssh_host: Option<String>,
    pub ssh_port: u16,
    pub ssh_username: Option<String>,
    pub ssh_auth_method: Option<String>,
    pub ssh_password: Option<String>,
    pub ssh_private_key: Option<String>,
    pub ssh_passphrase: Option<String>,
}

/// Connect and immediately release a temporary client.
///
/// SSH callers first open their own tunnel and pass its local endpoint here;
/// dropping the returned client before tearing down that tunnel keeps the probe
/// fully isolated from the live connection.
pub async fn probe(params: ConnectParams<'_>) -> Result<(), MappedIpcError> {
    let client: Client = connect(params).await?;
    drop(client);
    Ok(())
}

/// Run an isolated direct or SSH-tunneled probe and tear down every resource.
pub async fn probe_config(config: ProbeConfig) -> Result<(), MappedIpcError> {
    let Some(ssh_host) = config.ssh_host.as_deref() else {
        return probe(ConnectParams {
            host: &config.host,
            port: config.port,
            user: &config.username,
            password: &config.password,
            database: &config.database,
            tls: config.tls,
        })
        .await;
    };
    let ssh_username = config
        .ssh_username
        .as_deref()
        .ok_or_else(|| connection_error("SSH username is required."))?;
    let auth = match config.ssh_auth_method.as_deref() {
        Some("privateKey") => SshAuthInput::PrivateKey {
            key_contents: config
                .ssh_private_key
                .ok_or_else(|| connection_error("SSH private key is required."))?,
            passphrase: config.ssh_passphrase,
        },
        _ => SshAuthInput::Password {
            password: config
                .ssh_password
                .ok_or_else(|| connection_error("SSH password is required."))?,
        },
    };
    let prepared: PreparedAuth =
        build_auth_method(auth).map_err(|error| connection_error(&error.to_string()))?;
    let mut tunnel = TunnelHandle::open(TunnelRequest {
        ssh_host: ssh_host.to_string(),
        ssh_port: config.ssh_port,
        ssh_username: ssh_username.to_string(),
        auth: prepared,
        remote_db_host: config.host,
        remote_db_port: config.port,
    })
    .await
    .map_err(|error| connection_error(&error.to_string()))?;
    let local = tunnel
        .local_addr()
        .ok_or_else(|| connection_error("SSH tunnel has no local address."))?;
    let result = probe(ConnectParams {
        host: "127.0.0.1",
        port: local.port(),
        user: &config.username,
        password: &config.password,
        database: &config.database,
        tls: config.tls,
    })
    .await;
    let _ = tunnel.shutdown();
    result
}

fn connection_error(message: &str) -> MappedIpcError {
    MappedIpcError {
        kind: IpcErrorKind::Connection,
        message: message.into(),
        position: None,
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn probe_module_does_not_depend_on_app_session() {
        let src = include_str!("connection_test.rs");
        let production = src.split("#[cfg(test)]").next().expect("has test module");
        let forbidden = concat!("App", "Session");
        assert!(
            !production.contains(forbidden),
            "probe production code must not take or call the session type"
        );
        assert!(
            production.contains("ConnectParams"),
            "probe must take ConnectParams (own tunnel + connect + teardown)"
        );
    }
}
