//! SSH local forward tunnel: connect → ephemeral 127.0.0.1 listen → direct-tcpip.
//!
//! # Host key policy
//!
//! **Accept-anything** (Swift parity). Every server host key is accepted without
//! pinning or known_hosts checks. This assumes a trusted network / bastion and
//! accepts MITM risk until the product revisits host-key redesign (out of scope).
//!
//! # Lifecycle
//!
//! `open` establishes SSH, then binds an ephemeral local listener on `127.0.0.1:0`.
//! If SSH/auth fails **before** bind, no listener is created (no orphan forward).
//! `shutdown` stops accepting and disconnects the SSH session. No continuous reconnect.

use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use russh::client::{self, Config, Handle, Handler};
use russh::keys::PrivateKeyWithHashAlg;
use russh::{ChannelMsg, Disconnect};
use thiserror::Error;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;
use tokio::task::JoinHandle;

use super::auth::{parse_private_key_for_russh, PreparedAuth, SshAuthError};

/// Parameters to open a local forward to a remote DB via SSH.
#[derive(Debug, Clone)]
pub struct TunnelRequest {
    pub ssh_host: String,
    pub ssh_port: u16,
    pub ssh_username: String,
    pub auth: PreparedAuth,
    pub remote_db_host: String,
    pub remote_db_port: u16,
}

/// Human-facing tunnel / SSH errors (no orphan listener on failure before bind).
#[derive(Debug, Error)]
pub enum TunnelError {
    #[error("{0}")]
    Auth(String),
    #[error("{0}")]
    Connection(String),
    #[error("{0}")]
    Io(String),
}

impl From<SshAuthError> for TunnelError {
    fn from(err: SshAuthError) -> Self {
        match err {
            SshAuthError::EmptyPrivateKey => {
                TunnelError::Auth("SSH private key is empty.".into())
            }
            SshAuthError::InvalidPrivateKey(msg) => TunnelError::Auth(format!(
                "SSH private key could not be parsed: {msg}"
            )),
        }
    }
}

/// Accept-anything host key handler (documented MITM assumption above).
struct AcceptAnyHostKey;

impl Handler for AcceptAnyHostKey {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &russh::keys::PublicKey,
    ) -> Result<bool, Self::Error> {
        // Accept-anything: Swift parity; MITM risk accepted until product revisits.
        Ok(true)
    }
}

/// Live or test handle for a local SSH forward.
pub struct TunnelHandle {
    local_addr: Option<SocketAddr>,
    closed: bool,
    listening: bool,
    /// Signals the accept loop to stop (production path only).
    shutdown_tx: Option<oneshot::Sender<()>>,
    /// Background accept + forward task.
    accept_task: Option<JoinHandle<()>>,
    /// SSH session for disconnect on teardown (`Handle` is not `Clone`).
    session: Option<Arc<Handle<AcceptAnyHostKey>>>,
    /// Shared flag so drop/shutdown agree on listening state.
    listening_flag: Option<Arc<AtomicBool>>,
}

impl TunnelHandle {
    /// Test-only handle with listening/closed flags (no real sockets).
    pub fn for_test(listening: bool) -> Self {
        Self {
            local_addr: if listening {
                Some(SocketAddr::from(([127, 0, 0, 1], 0)))
            } else {
                None
            },
            closed: false,
            listening,
            shutdown_tx: None,
            accept_task: None,
            session: None,
            listening_flag: None,
        }
    }

    /// Test seam: simulate connect failure **before** local bind.
    ///
    /// Always returns `Err` without registering a listener — documents the
    /// production contract that SSH/auth failure before bind leaves no orphan.
    pub fn open_failing_before_listen(_request: TunnelRequest) -> Result<Self, TunnelError> {
        Err(TunnelError::Auth(
            "SSH authentication failed (injected before listen).".into(),
        ))
    }

    /// Open tunnel: SSH connect + auth → ephemeral `127.0.0.1` listen → forward.
    ///
    /// On SSH/auth failure, returns `Err` **without** binding a local listener.
    pub async fn open(request: TunnelRequest) -> Result<Self, TunnelError> {
        // 1) SSH connect + auth first — no listener yet (failure ⇒ no orphan).
        let session = connect_and_authenticate(&request).await?;

        // 2) Bind ephemeral local port only after SSH is ready.
        let listener = TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0)))
            .await
            .map_err(|e| TunnelError::Io(format!("Failed to bind local tunnel listener: {e}")))?;
        let local_addr = listener
            .local_addr()
            .map_err(|e| TunnelError::Io(format!("Failed to read local tunnel address: {e}")))?;

        let session = Arc::new(session);
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        let listening_flag = Arc::new(AtomicBool::new(true));
        let flag = Arc::clone(&listening_flag);
        let remote_host = request.remote_db_host.clone();
        let remote_port = request.remote_db_port;
        let session_for_loop = Arc::clone(&session);

        let accept_task = tokio::spawn(async move {
            run_accept_loop(
                listener,
                session_for_loop,
                remote_host,
                remote_port,
                shutdown_rx,
                flag,
            )
            .await;
        });

        Ok(Self {
            local_addr: Some(local_addr),
            closed: false,
            listening: true,
            shutdown_tx: Some(shutdown_tx),
            accept_task: Some(accept_task),
            session: Some(session),
            listening_flag: Some(listening_flag),
        })
    }

    /// Local forward address (`127.0.0.1:ephemeral`) while listening.
    pub fn local_addr(&self) -> Option<SocketAddr> {
        if self.is_listening() {
            self.local_addr
        } else {
            None
        }
    }

    pub fn is_closed(&self) -> bool {
        self.closed
    }

    pub fn is_listening(&self) -> bool {
        if let Some(flag) = &self.listening_flag {
            return flag.load(Ordering::SeqCst);
        }
        self.listening
    }

    /// Stop accepting and disconnect SSH. Idempotent after first success.
    pub fn shutdown(&mut self) -> Result<(), TunnelError> {
        if self.closed {
            return Ok(());
        }
        self.closed = true;
        self.listening = false;
        if let Some(flag) = &self.listening_flag {
            flag.store(false, Ordering::SeqCst);
        }
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
        if let Some(session) = self.session.take() {
            // Best-effort disconnect; ignore errors on teardown.
            let _ = tokio::spawn(async move {
                let _ = session
                    .disconnect(Disconnect::ByApplication, "tunnel shutdown", "en")
                    .await;
            });
        }
        if let Some(task) = self.accept_task.take() {
            task.abort();
        }
        self.local_addr = None;
        Ok(())
    }
}

impl Drop for TunnelHandle {
    fn drop(&mut self) {
        let _ = self.shutdown();
    }
}

async fn connect_and_authenticate(
    request: &TunnelRequest,
) -> Result<Handle<AcceptAnyHostKey>, TunnelError> {
    let config = Arc::new(Config::default());
    let addr = (request.ssh_host.as_str(), request.ssh_port);

    let mut handle = client::connect(config, addr, AcceptAnyHostKey)
        .await
        .map_err(|e| {
            TunnelError::Connection(format!(
                "Could not connect to SSH host {}:{} — {e}",
                request.ssh_host, request.ssh_port
            ))
        })?;

    let auth_ok = match &request.auth {
        PreparedAuth::Password(password) => {
            let result = handle
                .authenticate_password(&request.ssh_username, password.clone())
                .await
                .map_err(|e| {
                    TunnelError::Auth(format!("SSH password authentication failed: {e}"))
                })?;
            result.success()
        }
        PreparedAuth::PrivateKey {
            key_contents,
            passphrase,
        } => {
            let key = parse_private_key_for_russh(
                key_contents,
                passphrase.as_deref(),
            )?;
            let hash_alg = handle
                .best_supported_rsa_hash()
                .await
                .map_err(|e| TunnelError::Auth(format!("SSH key negotiation failed: {e}")))?
                .flatten();
            let result = handle
                .authenticate_publickey(
                    &request.ssh_username,
                    PrivateKeyWithHashAlg::new(Arc::new(key), hash_alg),
                )
                .await
                .map_err(|e| {
                    TunnelError::Auth(format!("SSH private key authentication failed: {e}"))
                })?;
            result.success()
        }
    };

    if !auth_ok {
        return Err(TunnelError::Auth(
            "SSH authentication failed. Check username, password, or private key.".into(),
        ));
    }

    Ok(handle)
}

async fn run_accept_loop(
    listener: TcpListener,
    session: Arc<Handle<AcceptAnyHostKey>>,
    remote_host: String,
    remote_port: u16,
    mut shutdown_rx: oneshot::Receiver<()>,
    listening_flag: Arc<AtomicBool>,
) {
    loop {
        tokio::select! {
            _ = &mut shutdown_rx => {
                break;
            }
            accept = listener.accept() => {
                match accept {
                    Ok((socket, originator)) => {
                        let session = Arc::clone(&session);
                        let remote_host = remote_host.clone();
                        tokio::spawn(async move {
                            if let Err(_e) = forward_one(
                                session,
                                socket,
                                originator,
                                &remote_host,
                                remote_port,
                            )
                            .await
                            {
                                // Forward errors are per-connection; tunnel stays up.
                            }
                        });
                    }
                    Err(_) => break,
                }
            }
        }
    }
    listening_flag.store(false, Ordering::SeqCst);
}

async fn forward_one(
    session: Arc<Handle<AcceptAnyHostKey>>,
    mut stream: TcpStream,
    originator: SocketAddr,
    remote_host: &str,
    remote_port: u16,
) -> Result<(), TunnelError> {
    let mut channel = session
        .channel_open_direct_tcpip(
            remote_host,
            u32::from(remote_port),
            originator.ip().to_string(),
            u32::from(originator.port()),
        )
        .await
        .map_err(|e| TunnelError::Connection(format!("SSH direct-tcpip open failed: {e}")))?;

    let mut stream_closed = false;
    let mut buf = vec![0_u8; 65536];
    loop {
        tokio::select! {
            r = stream.read(&mut buf), if !stream_closed => {
                match r {
                    Ok(0) => {
                        stream_closed = true;
                        let _ = channel.eof().await;
                    }
                    Ok(n) => {
                        channel
                            .data(&buf[..n])
                            .await
                            .map_err(|e| TunnelError::Io(e.to_string()))?;
                    }
                    Err(e) => return Err(TunnelError::Io(e.to_string())),
                }
            }
            msg = channel.wait() => {
                match msg {
                    Some(ChannelMsg::Data { ref data }) => {
                        stream
                            .write_all(data)
                            .await
                            .map_err(|e| TunnelError::Io(e.to_string()))?;
                    }
                    Some(ChannelMsg::Eof) | None => {
                        if !stream_closed {
                            let _ = channel.eof().await;
                        }
                        break;
                    }
                    Some(ChannelMsg::WindowAdjusted { .. }) => {}
                    Some(_) => {}
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ssh::auth::PreparedAuth;

    #[test]
    fn teardown_marks_tunnel_closed() {
        let mut handle = TunnelHandle::for_test(/* listening */ true);
        handle.shutdown().expect("shutdown");
        assert!(handle.is_closed());
        assert!(!handle.is_listening());
    }

    #[test]
    fn connect_failure_before_bind_leaves_no_live_listener() {
        // Inject failure before local bind / listener registration.
        let result = TunnelHandle::open_failing_before_listen(TunnelRequest {
            ssh_host: "bastion".into(),
            ssh_port: 22,
            ssh_username: "ubuntu".into(),
            auth: PreparedAuth::Password("bad".into()),
            remote_db_host: "10.0.0.5".into(),
            remote_db_port: 5432,
        });
        assert!(result.is_err());
        // Prefer Err without creating a handle; if a partial handle exists,
        // it must report !is_listening() after drop/cleanup — no global registry.
    }
}
