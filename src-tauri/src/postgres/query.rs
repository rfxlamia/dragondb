//! Query execution and result mapping for thin Postgres I/O.

use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value as JsonValue;
use tokio_postgres::types::{ToSql, Type};
use tokio_postgres::Client;

use super::error::{map_tokio_postgres_error, IpcErrorKind, MappedIpcError};

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

/// Attach durationMs; SELECT row count semantics use `rows.len()` (not rowsAffected).
pub fn map_query_rows(row_set: MappedRowSet, duration: Duration) -> QueryResultData {
    QueryResultData {
        columns: row_set.columns,
        rows: row_set.rows,
        rows_affected: None,
        duration_ms: duration.as_millis() as u64,
    }
}

/// Run a SQL statement with bound parameters; SELECT returns rows, others set rowsAffected.
pub async fn run_query(
    client: &Client,
    sql: &str,
    params: &[JsonValue],
) -> Result<QueryResultData, MappedIpcError> {
    let started = Instant::now();
    let owned = json_params_to_owned(params)?;
    let binds: Vec<&(dyn ToSql + Sync)> = owned
        .iter()
        .map(|p| p.as_ref() as &(dyn ToSql + Sync))
        .collect();

    if looks_like_select(sql) {
        // Prepare first so empty result sets still expose column metadata.
        let statement = client
            .prepare(sql)
            .await
            .map_err(|e| map_tokio_postgres_error(&e))?;
        let columns: Vec<String> = statement
            .columns()
            .iter()
            .map(|c| c.name().to_string())
            .collect();
        let rows = client
            .query(&statement, &binds)
            .await
            .map_err(|e| map_tokio_postgres_error(&e))?;
        let duration = started.elapsed();
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
            .execute(sql, &binds)
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

/// Convert JSON IPC params into owned `ToSql` values for tokio-postgres.
pub fn json_params_to_owned(
    params: &[JsonValue],
) -> Result<Vec<Box<dyn ToSql + Sync + Send>>, MappedIpcError> {
    params.iter().map(json_to_sql).collect()
}

fn json_to_sql(value: &JsonValue) -> Result<Box<dyn ToSql + Sync + Send>, MappedIpcError> {
    match value {
        JsonValue::Null => Ok(Box::new(Option::<String>::None)),
        JsonValue::Bool(b) => Ok(Box::new(*b)),
        JsonValue::Number(n) => {
            if let Some(i) = n.as_i64() {
                Ok(Box::new(i))
            } else if let Some(f) = n.as_f64() {
                Ok(Box::new(f))
            } else {
                Err(MappedIpcError {
                    kind: IpcErrorKind::Unknown,
                    message: "Unsupported numeric query parameter.".into(),
                    position: None,
                })
            }
        }
        JsonValue::String(s) => Ok(Box::new(s.clone())),
        JsonValue::Array(_) | JsonValue::Object(_) => Err(MappedIpcError {
            kind: IpcErrorKind::Unknown,
            message: "Unsupported JSON query parameter type.".into(),
            position: None,
        }),
    }
}

/// True when SQL is a row-returning query (SELECT / WITH …), after leading comments.
fn looks_like_select(sql: &str) -> bool {
    let stripped = strip_leading_sql_noise(sql);
    keyword_at(&stripped, "select") || keyword_at(&stripped, "with")
}

fn strip_leading_sql_noise(sql: &str) -> String {
    let mut s = sql.trim_start();
    loop {
        if s.starts_with("--") {
            match s.find('\n') {
                Some(pos) => {
                    s = s[pos + 1..].trim_start();
                    continue;
                }
                None => return String::new(),
            }
        }
        if s.starts_with("/*") {
            match s.find("*/") {
                Some(pos) => {
                    s = s[pos + 2..].trim_start();
                    continue;
                }
                None => return String::new(),
            }
        }
        break;
    }
    s.to_string()
}

fn keyword_at(s: &str, keyword: &str) -> bool {
    let len = keyword.len();
    if s.len() < len || !s[..len].eq_ignore_ascii_case(keyword) {
        return false;
    }
    match s.as_bytes().get(len) {
        None => true,
        Some(b) => b.is_ascii_whitespace() || *b == b'(',
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
        // FromSql accepts are type-exact — decode native widths then widen.
        Type::INT2 => row
            .try_get::<_, Option<i16>>(idx)
            .ok()
            .flatten()
            .map(|v| Value::Int(i64::from(v)))
            .unwrap_or(Value::Null),
        Type::INT4 => row
            .try_get::<_, Option<i32>>(idx)
            .ok()
            .flatten()
            .map(|v| Value::Int(i64::from(v)))
            .unwrap_or(Value::Null),
        Type::INT8 => row
            .try_get::<_, Option<i64>>(idx)
            .ok()
            .flatten()
            .map(Value::Int)
            .unwrap_or(Value::Null),
        Type::FLOAT4 => row
            .try_get::<_, Option<f32>>(idx)
            .ok()
            .flatten()
            .map(|v| Value::Float(f64::from(v)))
            .unwrap_or(Value::Null),
        Type::FLOAT8 => row
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
    fn empty_select_row_set_keeps_column_names() {
        let mapped = map_query_rows(
            MappedRowSet {
                columns: vec!["id".into(), "name".into()],
                rows: vec![],
            },
            Duration::from_millis(1),
        );
        assert_eq!(mapped.columns, vec!["id", "name"]);
        assert!(mapped.rows.is_empty());
    }

    #[test]
    fn looks_like_select_handles_comments_and_with() {
        assert!(looks_like_select("SELECT 1"));
        assert!(looks_like_select("  select id from t"));
        assert!(looks_like_select("-- comment\nSELECT 1"));
        assert!(looks_like_select("/* block */\nSELECT 1"));
        assert!(looks_like_select("WITH cte AS (SELECT 1) SELECT * FROM cte"));
        assert!(!looks_like_select("INSERT INTO t VALUES (1)"));
        assert!(!looks_like_select("UPDATE t SET x = 1"));
        assert!(!looks_like_select("SELECTIVE_NAME"));
    }

    #[test]
    fn json_params_to_owned_accepts_string_bool_number_null() {
        let owned = json_params_to_owned(&[
            JsonValue::String("alice".into()),
            JsonValue::Bool(true),
            JsonValue::from(42),
            JsonValue::Null,
        ])
        .expect("owned params");
        assert_eq!(owned.len(), 4);
    }

    #[test]
    fn json_params_to_owned_rejects_object_and_array() {
        assert!(json_params_to_owned(&[JsonValue::Array(vec![])]).is_err());
        assert!(json_params_to_owned(&[JsonValue::Object(Default::default())]).is_err());
    }
}
