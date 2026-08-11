//! SSH tunnel + key-contents auth (Swift parity lifecycle).
//!
//! Session (later) composes tunnel-then-DB. This module does not reconnect.

pub mod auth;
pub mod tunnel;

pub use auth::{
    build_auth_method, parse_private_key_for_russh, PreparedAuth, SshAuthError, SshAuthInput,
};
pub use tunnel::{TunnelError, TunnelHandle, TunnelRequest};
