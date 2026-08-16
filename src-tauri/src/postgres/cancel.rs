//! Cancellation state is independent from the application-session mutex so a
//! cancel command remains reachable while a query awaits the server.

use std::sync::{Arc, RwLock};

use tokio_postgres::{CancelToken, NoTls};

use super::{
    make_tls_connector, map_tokio_postgres_error, EffectiveTls, IpcErrorKind, MappedIpcError,
};

#[derive(Clone, Default)]
pub struct CancelRegistry {
    inner: Arc<RwLock<Option<CancelRegistration>>>,
}

struct CancelRegistration {
    connection_id: String,
    token: Option<CancelToken>,
    tls: EffectiveTls,
}

impl CancelRegistry {
    pub fn register(&self, connection_id: String, token: CancelToken, tls: EffectiveTls) {
        self.replace(CancelRegistration {
            connection_id,
            token: Some(token),
            tls,
        });
    }

    pub fn clear(&self) {
        self.replace_none();
    }

    pub async fn cancel_token(&self, connection_id: &str) -> Result<(), MappedIpcError> {
        let (token, tls) = {
            let guard = self.inner.read().map_err(|_| registry_error())?;
            let registration = guard.as_ref().ok_or_else(not_connected)?;
            if registration.connection_id != connection_id {
                return Err(MappedIpcError {
                    kind: IpcErrorKind::Connection,
                    message: "Connection id does not match the active session.".into(),
                    position: None,
                });
            }
            (
                registration.token.clone().ok_or_else(not_connected)?,
                registration.tls,
            )
        };

        match tls {
            EffectiveTls::NoTls => token
                .cancel_query(NoTls)
                .await
                .map_err(|error| map_tokio_postgres_error(&error)),
            EffectiveTls::TlsNoVerify | EffectiveTls::TlsVerify => {
                let connector = make_tls_connector(tls).map_err(|error| MappedIpcError {
                    kind: IpcErrorKind::Connection,
                    message: format!("TLS setup failed: {error}"),
                    position: None,
                })?;
                token
                    .cancel_query(connector.expect("TLS cancellation requires connector"))
                    .await
                    .map_err(|error| map_tokio_postgres_error(&error))
            }
        }
    }

    fn replace(&self, registration: CancelRegistration) {
        if let Ok(mut guard) = self.inner.write() {
            *guard = Some(registration);
        }
    }

    fn replace_none(&self) {
        if let Ok(mut guard) = self.inner.write() {
            *guard = None;
        }
    }

    #[cfg(test)]
    fn register_without_network(&self, connection_id: &str) {
        self.replace(CancelRegistration {
            connection_id: connection_id.into(),
            token: None,
            tls: EffectiveTls::NoTls,
        });
    }

    #[cfg(test)]
    fn active_connection_id(&self) -> Option<String> {
        self.inner
            .read()
            .ok()
            .and_then(|guard| guard.as_ref().map(|item| item.connection_id.clone()))
    }
}

fn not_connected() -> MappedIpcError {
    MappedIpcError {
        kind: IpcErrorKind::Connection,
        message: "No cancellable query for the active session.".into(),
        position: None,
    }
}

fn registry_error() -> MappedIpcError {
    MappedIpcError {
        kind: IpcErrorKind::Unknown,
        message: "Cancellation registry lock poisoned.".into(),
        position: None,
    }
}

#[cfg(test)]
mod tests {
    use super::CancelRegistry;

    #[test]
    fn registry_is_shared_and_clear_removes_active_connection() {
        let registry = CancelRegistry::default();
        let command_view = registry.clone();
        registry.register_without_network("connection-a");
        assert_eq!(
            command_view.active_connection_id().as_deref(),
            Some("connection-a")
        );
        command_view.clear();
        assert_eq!(registry.active_connection_id(), None);
    }

    #[test]
    fn registry_access_does_not_depend_on_session_mutex() {
        let registry = CancelRegistry::default();
        registry.register_without_network("connection-a");
        let command_view = registry.clone();
        let joined = std::thread::spawn(move || command_view.active_connection_id())
            .join()
            .expect("registry thread");
        assert_eq!(joined.as_deref(), Some("connection-a"));
    }
}
