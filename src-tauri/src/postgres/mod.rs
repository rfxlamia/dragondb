//! Thin Postgres I/O — connect, catalog list, query, error map.
//!
//! Single connection only; session owns one-shot reconnect later.
//! No createDatabase / deleteDatabase APIs. No pooling / keep-alive loops.

pub mod connection;
pub mod catalog;
pub mod error;
pub mod query;
pub mod row_ops;
pub mod ssl;

pub use connection::{build_connect_config, connect, ConnectConfig, ConnectParams};
pub use error::{map_postgres_error, map_tokio_postgres_error, DriverFailure, IpcErrorKind, MappedIpcError};
pub use catalog::{
    list_columns, list_tables, ColumnInfoRow, TableRefRow, LIST_COLUMNS_SQL, LIST_TABLES_SQL,
};
pub use query::{json_params_to_owned, map_query_rows, run_query, MappedRowSet, QueryResultData, Value};
pub use row_ops::{
    delete_rows, fetch_primary_key_columns, update_row, validate_delete_preconditions,
    validate_update_preconditions, RowOperationError, RowOperationErrorKind,
};
pub use ssl::{collapse_ssl_mode, make_tls_connector, EffectiveTls};
