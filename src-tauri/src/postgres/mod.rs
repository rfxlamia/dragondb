//! Thin Postgres I/O — connect, catalog list, query, error map.
//!
//! Single connection only; session owns one-shot reconnect later.
//! Dedicated database admin and isolated connection-probe APIs; no pooling.

pub mod cancel;
pub mod catalog;
pub mod connection;
pub mod connection_test;
pub mod database_admin;
pub mod error;
pub mod query;
pub mod row_ops;
pub mod ssl;
pub mod table_admin;

pub use cancel::CancelRegistry;
pub use connection::{build_connect_config, connect, ConnectConfig, ConnectParams};
pub use connection_test::{probe as test_connection, probe_config, ProbeConfig};
pub use database_admin::{
    create_database, drop_database, list_databases, maintenance_database,
    set_session_database_name,
};
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
pub use table_admin::{drop_table, generate_table_ddl, set_search_path, truncate_table};
