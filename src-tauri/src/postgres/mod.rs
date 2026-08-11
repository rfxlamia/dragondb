//! Thin Postgres I/O — connect, catalog list, query, error map.
//!
//! Single connection only; session owns one-shot reconnect later.
//! No createDatabase / deleteDatabase APIs. No pooling / keep-alive loops.

pub mod connection;
pub mod error;
pub mod query;
pub mod ssl;

pub use connection::{build_connect_config, connect, ConnectConfig, ConnectParams};
pub use error::{map_postgres_error, map_tokio_postgres_error, DriverFailure, IpcErrorKind, MappedIpcError};
pub use query::{
    list_columns, list_tables, map_query_rows, run_query, ColumnInfoRow, MappedRowSet,
    QueryResultData, TableRefRow, Value, LIST_COLUMNS_SQL, LIST_TABLES_SQL,
};
pub use ssl::{collapse_ssl_mode, make_tls_connector, EffectiveTls};
