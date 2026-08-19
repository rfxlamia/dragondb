//! Map Postgres driver failures to IPC error kinds + human messages.

use serde::Serialize;

/// IpcError-equivalent kinds (mirrors `src/ipc/contract.ts`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum IpcErrorKind {
    Connection,
    Auth,
    Syntax,
    Permission,
    Unknown,
}

/// Serializable error payload for Tauri invoke rejection.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct MappedIpcError {
    pub kind: IpcErrorKind,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<i32>,
}

/// Intermediate driver failure classification used by unit tests and mappers.
#[derive(Debug, Clone)]
pub enum DriverFailure {
    Auth(&'static str),
    Db {
        message: String,
        sqlstate: Option<String>,
    },
    Io(String),
}

/// Map a classified driver failure to a human `MappedIpcError`.
pub fn map_postgres_error(failure: DriverFailure) -> MappedIpcError {
    match failure {
        DriverFailure::Auth(msg) => MappedIpcError {
            kind: IpcErrorKind::Auth,
            message: humanize_auth(msg),
            position: None,
        },
        DriverFailure::Io(msg) => MappedIpcError {
            kind: IpcErrorKind::Connection,
            message: humanize_connection(&msg),
            position: None,
        },
        DriverFailure::Db { message, sqlstate } => map_db_failure(&message, sqlstate.as_deref()),
    }
}

fn map_db_failure(message: &str, sqlstate: Option<&str>) -> MappedIpcError {
    let lower = message.to_lowercase();
    let class = sqlstate.map(|s| s.get(..2).unwrap_or("")).unwrap_or("");

    if matches!(sqlstate, Some("28P01") | Some("28000"))
        || lower.contains("password authentication failed")
        || lower.contains("authentication failed")
    {
        return MappedIpcError {
            kind: IpcErrorKind::Auth,
            message: humanize_auth(message),
            position: None,
        };
    }

    // Permission before broad syntax checks (42501 is also class 42).
    if matches!(sqlstate, Some("42501"))
        || lower.contains("permission denied")
        || lower.contains("insufficient privilege")
    {
        return MappedIpcError {
            kind: IpcErrorKind::Permission,
            message: format!("Permission denied: {message}"),
            position: None,
        };
    }

    if matches!(sqlstate, Some("42601") | Some("42000")) || lower.contains("syntax error") {
        // Prefer human message; do not surface SQLSTATE alone.
        let msg = if lower.contains("syntax") {
            format!("SQL syntax error: {message}")
        } else {
            message.to_string()
        };
        return MappedIpcError {
            kind: IpcErrorKind::Syntax,
            message: msg,
            position: None,
        };
    }

    if class == "08"
        || lower.contains("connection")
        || lower.contains("could not connect")
        || lower.contains("server closed")
    {
        return MappedIpcError {
            kind: IpcErrorKind::Connection,
            message: humanize_connection(message),
            position: None,
        };
    }

    MappedIpcError {
        kind: IpcErrorKind::Unknown,
        message: message.to_string(),
        position: None,
    }
}

fn humanize_auth(raw: &str) -> String {
    if raw
        .to_lowercase()
        .contains("password authentication failed")
        || raw.to_lowercase().contains("authentication failed")
    {
        "Authentication failed — check username and password.".into()
    } else {
        format!("Authentication failed: {raw}")
    }
}

fn humanize_connection(raw: &str) -> String {
    let lower = raw.to_lowercase();
    if lower.contains("connection refused") {
        "Could not connect — connection refused.".into()
    } else if lower.contains("timed out") || lower.contains("timeout") {
        "Could not connect — connection timed out.".into()
    } else {
        format!("Connection error: {raw}")
    }
}

/// Classify a `tokio_postgres::Error` into `DriverFailure` then map.
pub fn map_tokio_postgres_error(err: &tokio_postgres::Error) -> MappedIpcError {
    if err.is_closed() {
        return map_postgres_error(DriverFailure::Io(err.to_string()));
    }

    if let Some(db) = err.as_db_error() {
        let sqlstate = Some(db.code().code().to_string());
        let message = db.message().to_string();
        // Auth SQLSTATEs often arrive as DbError.
        if matches!(db.code().code(), "28P01" | "28000") {
            return map_postgres_error(DriverFailure::Auth("password authentication failed"));
        }
        return map_postgres_error(DriverFailure::Db { message, sqlstate });
    }

    let msg = err.to_string();
    let lower = msg.to_lowercase();
    if lower.contains("password authentication") || lower.contains("authentication failed") {
        return map_postgres_error(DriverFailure::Auth("password authentication failed"));
    }
    if lower.contains("connect")
        || lower.contains("connection")
        || lower.contains("refused")
        || lower.contains("timed out")
        || lower.contains("os error")
    {
        return map_postgres_error(DriverFailure::Io(msg));
    }

    map_postgres_error(DriverFailure::Db {
        message: msg,
        sqlstate: err.code().map(|c| c.code().to_string()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_auth_failure_to_auth_kind_with_human_message() {
        let err = map_postgres_error(DriverFailure::Auth("password authentication failed"));
        assert_eq!(err.kind, IpcErrorKind::Auth);
        assert!(!err.message.is_empty());
        assert!(!err.message.contains("28P01")); // not raw SQLSTATE alone
    }

    #[test]
    fn maps_syntax_failure_to_syntax_kind() {
        let err = map_postgres_error(DriverFailure::Db {
            message: "syntax error at or near \"SELCT\"".into(),
            sqlstate: Some("42601".into()),
        });
        assert_eq!(err.kind, IpcErrorKind::Syntax);
        assert!(err.message.to_lowercase().contains("syntax") || err.message.contains("SELCT"));
    }

    #[test]
    fn maps_connection_refusal_to_connection_kind() {
        let err = map_postgres_error(DriverFailure::Io("Connection refused".into()));
        assert_eq!(err.kind, IpcErrorKind::Connection);
        assert!(!err.message.is_empty());
    }
}
