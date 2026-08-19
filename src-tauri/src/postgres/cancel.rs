//! Cancellation state is independent from the application-session mutex so a
//! cancel command remains reachable while a query awaits the server.

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};

use tokio::task::AbortHandle;
use tokio_postgres::{CancelToken, NoTls};

use super::{
    make_tls_connector, map_tokio_postgres_error, EffectiveTls, IpcErrorKind, MappedIpcError,
};

#[derive(Clone, Default)]
pub struct CancelRegistry {
    inner: Arc<RwLock<Option<CancelRegistration>>>,
    teardown: Arc<AtomicBool>,
    cancelled_runs: Arc<RwLock<HashSet<u64>>>,
    active_run_id: Arc<RwLock<Option<u64>>>,
}

struct CancelRegistration {
    connection_id: String,
    token: Option<CancelToken>,
    tls: EffectiveTls,
    connection_abort: Option<AbortHandle>,
}

impl CancelRegistry {
    pub fn register(
        &self,
        connection_id: String,
        token: CancelToken,
        tls: EffectiveTls,
        connection_abort: Option<AbortHandle>,
    ) {
        self.teardown.store(false, Ordering::SeqCst);
        self.replace(CancelRegistration {
            connection_id,
            token: Some(token),
            tls,
            connection_abort,
        });
    }

    pub fn clear(&self) {
        self.replace_none();
        self.teardown.store(false, Ordering::SeqCst);
        if let Ok(mut cancelled) = self.cancelled_runs.write() {
            cancelled.clear();
        }
        if let Ok(mut active) = self.active_run_id.write() {
            *active = None;
        }
    }

    pub fn is_run_cancelled(&self, run_id: u64) -> bool {
        if run_id == 0 {
            return false;
        }
        self.cancelled_runs
            .read()
            .ok()
            .is_some_and(|set| set.contains(&run_id))
    }

    pub fn mark_run_cancelled(&self, run_id: u64) {
        if run_id == 0 {
            return;
        }
        if let Ok(mut cancelled) = self.cancelled_runs.write() {
            cancelled.insert(run_id);
        }
    }

    pub fn set_active_run(&self, run_id: u64) {
        if run_id == 0 {
            return;
        }
        if let Ok(mut active) = self.active_run_id.write() {
            *active = Some(run_id);
        }
    }

    pub fn clear_active_run(&self, run_id: u64) {
        if run_id == 0 {
            return;
        }
        if let Ok(mut active) = self.active_run_id.write() {
            if active.as_ref() == Some(&run_id) {
                *active = None;
            }
        }
        if let Ok(mut cancelled) = self.cancelled_runs.write() {
            cancelled.remove(&run_id);
        }
    }

    /// Marks a run cancelled; issues a PostgreSQL cancel only when that run is
    /// currently executing (not merely queued on the session mutex).
    pub async fn cancel_run(
        &self,
        connection_id: &str,
        run_id: u64,
    ) -> Result<(), MappedIpcError> {
        if run_id == 0 {
            return Ok(());
        }
        self.mark_run_cancelled(run_id);
        let should_cancel_pg = {
            let guard = self.inner.read().map_err(|_| registry_error())?;
            let registration = match guard.as_ref() {
                Some(item) if item.connection_id == connection_id => item,
                Some(_) => {
                    return Err(MappedIpcError {
                        kind: IpcErrorKind::Connection,
                        message: "Connection id does not match the active session.".into(),
                        position: None,
                    });
                }
                None => return Ok(()),
            };
            let active = self
                .active_run_id
                .read()
                .map_err(|_| registry_error())?;
            active.as_ref() == Some(&run_id)
                && registration.token.is_some()
        };
        if should_cancel_pg {
            self.cancel_token(connection_id).await?;
        }
        Ok(())
    }

    /// Abort the live postgres connection driver without taking the session mutex.
    pub fn force_close(&self) {
        self.teardown.store(true, Ordering::SeqCst);
        if let Ok(mut guard) = self.inner.write() {
            if let Some(registration) = guard.as_mut() {
                if let Some(abort) = registration.connection_abort.take() {
                    abort.abort();
                }
            }
        }
    }

    pub fn teardown_requested(&self) -> bool {
        self.teardown.load(Ordering::SeqCst)
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
            connection_abort: None,
        });
    }

    #[cfg(test)]
    fn register_abort_handle(&self, abort: AbortHandle) {
        self.replace(CancelRegistration {
            connection_id: "connection-a".into(),
            token: None,
            tls: EffectiveTls::NoTls,
            connection_abort: Some(abort),
        });
    }

    #[cfg(test)]
    fn active_connection_id(&self) -> Option<String> {
        self.inner
            .read()
            .ok()
            .and_then(|guard| guard.as_ref().map(|item| item.connection_id.clone()))
    }

    #[cfg(test)]
    fn active_run_id(&self) -> Option<u64> {
        self.active_run_id.read().ok().and_then(|guard| *guard)
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

pub fn query_cancelled_error() -> MappedIpcError {
    MappedIpcError {
        kind: IpcErrorKind::Unknown,
        message: "Query cancelled".into(),
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

    #[tokio::test]
    async fn cancel_run_marks_pending_without_pg_cancel_when_run_is_not_active() {
        let registry = CancelRegistry::default();
        registry.register_without_network("connection-a");
        registry
            .cancel_run("connection-a", 7)
            .await
            .expect("pending cancel ok");
        assert!(registry.is_run_cancelled(7));
        assert_eq!(registry.active_run_id(), None);
    }

    #[test]
    fn clear_active_run_removes_cancelled_marker() {
        let registry = CancelRegistry::default();
        registry.mark_run_cancelled(9);
        registry.set_active_run(9);
        registry.clear_active_run(9);
        assert!(!registry.is_run_cancelled(9));
        assert_eq!(registry.active_run_id(), None);
    }

    #[tokio::test]
    async fn force_close_aborts_the_driver_task_and_blocks_oneshot_reconnect() {
        let registry = CancelRegistry::default();
        let handle = tokio::spawn(async {
            loop {
                tokio::time::sleep(std::time::Duration::from_secs(60)).await;
            }
        });
        registry.register_abort_handle(handle.abort_handle());
        registry.force_close();
        assert!(registry.teardown_requested());
        assert!(handle.await.unwrap_err().is_cancelled());
    }
}
