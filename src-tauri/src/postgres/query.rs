//! Catalog SQL + query result mapping for thin Postgres I/O.

use std::time::{Duration, Instant};

use serde::Serialize;
use tokio_postgres::types::Type;
use tokio_postgres::Client;

use super::error::{map_tokio_postgres_error, MappedIpcError};

/// Locked Swift-parity catalog query for listing user tables.
pub const LIST_TABLES_SQL: &str = "SELECT table_schema, table_name FROM information_schema.tables WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY table_schema, table_name";

/// Locked Swift-parity catalog query for listing columns of one table.
pub const LIST_COLUMNS_SQL: &str = "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position";

/// Cell value used by the pure row mapper / QueryResult shaping.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(untagged)]
pub enum Value {
    Null,
    Bool(bool),
    Int(i64),
    Float(f64),
    Text(String),
}

/// Intermediate row set before attaching duration / rowsAffected.
#[derive(Debug, Clone, PartialEq)]
pub struct MappedRowSet {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Value>>,
}

/// QueryResult-shaped payload (mirrors `src/ipc/contract.ts` QueryResult).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResultData {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Value>>,
    pub rows_affected: Option<u64>,
    pub duration_ms: u64,
}

/// TableRef-shaped row from `list_tables`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TableRefRow {
    pub schema: String,
    pub name: String,
}

/// ColumnInfo-shaped row from `list_columns` (PK/unique/FK enrichment deferred).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInfoRow {
    pub name: String,
    pub data_type: String,
    pub is_nullable: bool,
    pub default_value: Option<String>,
    pub is_primary_key: bool,
    pub is_unique: bool,
    pub is_foreign_key: bool,
}

/// Attach durationMs; SELECT row count semantics use `rows.len()` (not rowsAffected).
pub fn map_query_rows(row_set: MappedRowSet, duration: Duration) -> QueryResultData {
    QueryResultData {
        columns: row_set.columns,
        rows: row_set.rows,
        rows_affected: None,
        duration_ms: duration.as_millis() as u64,
    }
}

/// List user BASE TABLEs via locked catalog SQL.
pub async fn list_tables(client: &Client) -> Result<Vec<TableRefRow>, MappedIpcError> {
    let rows = client
        .query(LIST_TABLES_SQL, &[])
        .await
        .map_err(|e| map_tokio_postgres_error(&e))?;
    Ok(rows
        .iter()
        .map(|row| TableRefRow {
            schema: row.get(0),
            name: row.get(1),
        })
        .collect())
}

/// List columns for one table via locked catalog SQL.
pub async fn list_columns(
    client: &Client,
    schema: &str,
    table: &str,
) -> Result<Vec<ColumnInfoRow>, MappedIpcError> {
    let rows = client
        .query(LIST_COLUMNS_SQL, &[&schema, &table])
        .await
        .map_err(|e| map_tokio_postgres_error(&e))?;
    Ok(rows
        .iter()
        .map(|row| {
            let is_nullable: String = row.get(2);
            let default_value: Option<String> = row.get(3);
            ColumnInfoRow {
                name: row.get(0),
                data_type: row.get(1),
                is_nullable: is_nullable.eq_ignore_ascii_case("YES"),
                default_value,
                is_primary_key: false,
                is_unique: false,
                is_foreign_key: false,
            }
        })
        .collect())
}

/// Run a simple SQL statement; SELECT returns rows, others set rowsAffected.
pub async fn run_query(client: &Client, sql: &str) -> Result<QueryResultData, MappedIpcError> {
    let started = Instant::now();
    let trimmed = sql.trim_start();
    let is_select = trimmed.len() >= 6 && trimmed[..6].eq_ignore_ascii_case("select");

    if is_select {
        let rows = client
            .query(sql, &[])
            .await
            .map_err(|e| map_tokio_postgres_error(&e))?;
        let duration = started.elapsed();
        if rows.is_empty() {
            return Ok(map_query_rows(
                MappedRowSet {
                    columns: vec![],
                    rows: vec![],
                },
                duration,
            ));
        }
        let columns: Vec<String> = rows[0]
            .columns()
            .iter()
            .map(|c| c.name().to_string())
            .collect();
        let mapped_rows: Vec<Vec<Value>> = rows
            .iter()
            .map(|row| {
                (0..row.len())
                    .map(|i| cell_value(row, i))
                    .collect()
            })
            .collect();
        Ok(map_query_rows(
            MappedRowSet {
                columns,
                rows: mapped_rows,
            },
            duration,
        ))
    } else {
        let result = client
            .execute(sql, &[])
            .await
            .map_err(|e| map_tokio_postgres_error(&e))?;
        Ok(QueryResultData {
            columns: vec![],
            rows: vec![],
            rows_affected: Some(result),
            duration_ms: started.elapsed().as_millis() as u64,
        })
    }
}

fn cell_value(row: &tokio_postgres::Row, idx: usize) -> Value {
    let col = &row.columns()[idx];
    match *col.type_() {
        Type::BOOL => row
            .try_get::<_, Option<bool>>(idx)
            .ok()
            .flatten()
            .map(Value::Bool)
            .unwrap_or(Value::Null),
        Type::INT2 | Type::INT4 | Type::INT8 => row
            .try_get::<_, Option<i64>>(idx)
            .ok()
            .flatten()
            .map(Value::Int)
            .unwrap_or(Value::Null),
        Type::FLOAT4 | Type::FLOAT8 => row
            .try_get::<_, Option<f64>>(idx)
            .ok()
            .flatten()
            .map(Value::Float)
            .unwrap_or(Value::Null),
        Type::TEXT | Type::VARCHAR | Type::NAME | Type::BPCHAR => row
            .try_get::<_, Option<String>>(idx)
            .ok()
            .flatten()
            .map(Value::Text)
            .unwrap_or(Value::Null),
        _ => row
            .try_get::<_, Option<String>>(idx)
            .ok()
            .flatten()
            .map(Value::Text)
            .unwrap_or(Value::Null),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_result_mapper_uses_rows_len_for_select_count_semantics() {
        let mapped = map_query_rows(
            MappedRowSet {
                columns: vec!["id".into(), "name".into()],
                rows: vec![vec![Value::Int(1), Value::Text("a".into())]],
            },
            Duration::from_millis(42),
        );
        assert_eq!(mapped.columns, vec!["id", "name"]);
        assert_eq!(mapped.rows.len(), 1);
        assert_eq!(mapped.duration_ms, 42);
        // UI status N = rows.len(), not rows_affected
        assert_eq!(mapped.rows.len() as i64, 1);
    }

    #[test]
    fn query_result_mapper_zero_rows_is_explicit_empty() {
        let mapped = map_query_rows(
            MappedRowSet {
                columns: vec!["id".into()],
                rows: vec![],
            },
            Duration::from_millis(5),
        );
        assert_eq!(mapped.rows.len(), 0);
        assert_eq!(mapped.duration_ms, 5);
    }

    #[test]
    fn list_tables_sql_is_locked_catalog_query() {
        assert!(LIST_TABLES_SQL.contains("information_schema.tables"));
        assert!(LIST_TABLES_SQL.contains("table_schema"));
        assert!(LIST_TABLES_SQL.contains("table_name"));
        assert!(LIST_TABLES_SQL.contains("BASE TABLE"));
        assert!(LIST_TABLES_SQL.contains("pg_catalog"));
        assert!(LIST_TABLES_SQL.contains("information_schema"));
    }

    #[test]
    fn list_columns_sql_is_locked_catalog_query() {
        assert!(LIST_COLUMNS_SQL.contains("information_schema.columns"));
        assert!(LIST_COLUMNS_SQL.contains("table_schema"));
        assert!(LIST_COLUMNS_SQL.contains("table_name"));
        assert!(LIST_COLUMNS_SQL.contains("column_name"));
        assert!(LIST_COLUMNS_SQL.contains("data_type"));
    }
}
