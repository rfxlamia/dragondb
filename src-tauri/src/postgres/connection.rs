//! Postgres connect config seam + thin single-connection open.
//!
//! Session owns lifecycle / one-shot reconnect later — this module does not
//! invent continuous keep-alive or pooling.

use tokio::task::AbortHandle;
use tokio_postgres::config::SslMode;
use tokio_postgres::{Client, Config, NoTls};

use super::error::{map_tokio_postgres_error, MappedIpcError};
use super::ssl::{make_tls_connector, EffectiveTls};

/// Input parameters for building a connect config / opening a client.
#[derive(Clone)]
pub struct ConnectParams<'a> {
    pub host: &'a str,
    pub port: u16,
    pub user: &'a str,
    pub password: &'a str,
    pub database: &'a str,
    pub tls: EffectiveTls,
}

impl std::fmt::Debug for ConnectParams<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ConnectParams")
            .field("host", &self.host)
            .field("port", &self.port)
            .field("user", &self.user)
            .field("password", &"<redacted>")
            .field("database", &self.database)
            .field("tls", &self.tls)
            .finish()
    }
}

/// Pure connect config seam (unit-testable without a live database).
#[derive(Clone, PartialEq, Eq)]
pub struct ConnectConfig {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: String,
    pub database: String,
    pub tls: EffectiveTls,
}

impl std::fmt::Debug for ConnectConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ConnectConfig")
            .field("host", &self.host)
            .field("port", &self.port)
            .field("user", &self.user)
            .field("password", &"<redacted>")
            .field("database", &self.database)
            .field("tls", &self.tls)
            .finish()
    }
}

/// Build connect config from params (no network I/O).
pub fn build_connect_config(params: ConnectParams<'_>) -> Result<ConnectConfig, MappedIpcError> {
    if params.host.trim().is_empty() {
        return Err(MappedIpcError {
            kind: super::error::IpcErrorKind::Connection,
            message: "Host is required.".into(),
            position: None,
        });
    }
    Ok(ConnectConfig {
        host: params.host.to_string(),
        port: params.port,
        user: params.user.to_string(),
        password: params.password.to_string(),
        database: params.database.to_string(),
        tls: params.tls,
    })
}

fn to_tokio_config(cfg: &ConnectConfig) -> Config {
    let mut pg = Config::new();
    pg.host(&cfg.host);
    pg.port(cfg.port);
    pg.user(&cfg.user);
    pg.password(&cfg.password);
    pg.dbname(&cfg.database);
    pg.connect_timeout(std::time::Duration::from_secs(10));
    match cfg.tls {
        EffectiveTls::NoTls => {
            pg.ssl_mode(SslMode::Disable);
        }
        EffectiveTls::TlsNoVerify | EffectiveTls::TlsVerify => {
            pg.ssl_mode(SslMode::Require);
        }
    }
    pg
}

/// Open a single Postgres client. Caller (session) owns reconnect policy.
///
/// Does **not** pool or keep-alive reconnect.
pub async fn connect(params: ConnectParams<'_>) -> Result<(Client, AbortHandle), MappedIpcError> {
    let cfg = build_connect_config(params)?;
    let pg = to_tokio_config(&cfg);

    match cfg.tls {
        EffectiveTls::NoTls => {
            let (client, connection) = pg
                .connect(NoTls)
                .await
                .map_err(|e| map_tokio_postgres_error(&e))?;
            let handle = tokio::spawn(async move {
                let _ = connection.await;
            });
            Ok((client, handle.abort_handle()))
        }
        EffectiveTls::TlsNoVerify | EffectiveTls::TlsVerify => {
            let connector = make_tls_connector(cfg.tls).map_err(|e| MappedIpcError {
                kind: super::error::IpcErrorKind::Connection,
                message: format!("TLS setup failed: {e}"),
                position: None,
            })?;
            let connector = connector.expect("TLS path requires connector");
            let (client, connection) = pg
                .connect(connector)
                .await
                .map_err(|e| map_tokio_postgres_error(&e))?;
            let handle = tokio::spawn(async move {
                let _ = connection.await;
            });
            Ok((client, handle.abort_handle()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_connect_config_applies_host_port_user_db_and_ssl() {
        let cfg = build_connect_config(ConnectParams {
            host: "127.0.0.1",
            port: 5432,
            user: "postgres",
            password: "pw",
            database: "app",
            tls: EffectiveTls::NoTls,
        })
        .expect("config");
        assert_eq!(cfg.host, "127.0.0.1");
        assert_eq!(cfg.port, 5432);
        assert_eq!(cfg.user, "postgres");
        assert_eq!(cfg.database, "app");
        assert_eq!(cfg.tls, EffectiveTls::NoTls);
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn live_connect_optional() {
        let (client, _abort) = connect(ConnectParams {
            host: "127.0.0.1",
            port: 5432,
            user: "postgres",
            password: "postgres",
            database: "postgres",
            tls: EffectiveTls::NoTls,
        })
        .await
        .expect("live connect");
        let row = client.query_one("SELECT 1", &[]).await.expect("select 1");
        let one: i32 = row.get(0);
        assert_eq!(one, 1);
    }
}
