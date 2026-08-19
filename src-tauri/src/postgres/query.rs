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
    let statements = split_sql_statements(sql);
    if statements.is_empty() {
        return Ok(QueryResultData {
            columns: vec![],
            rows: vec![],
            rows_affected: Some(0),
            duration_ms: 0,
        });
    }
    let wrap = statements.len() > 1
        && should_wrap_transaction(&statements.iter().map(String::as_str).collect::<Vec<_>>());
    if wrap {
        client
            .batch_execute("BEGIN")
            .await
            .map_err(|e| map_tokio_postgres_error(&e))?;
    }
    let mut last = QueryResultData {
        columns: vec![],
        rows: vec![],
        rows_affected: Some(0),
        duration_ms: 0,
    };
    let mut saw_row_result = false;
    for (index, statement) in statements.iter().enumerate() {
        let statement_params = if statements.len() == 1 { params } else { &[] };
        match run_single_query(client, statement, statement_params, started).await {
            Ok(result) => {
                if !result.columns.is_empty() {
                    saw_row_result = true;
                    last = result;
                } else if !saw_row_result && index + 1 == statements.len() {
                    last = result;
                }
            }
            Err(error) => {
                if wrap {
                    let _ = client.batch_execute("ROLLBACK").await;
                }
                return Err(error);
            }
        }
    }
    if wrap {
        client
            .batch_execute("COMMIT")
            .await
            .map_err(|e| map_tokio_postgres_error(&e))?;
    }
    last.duration_ms = started.elapsed().as_millis() as u64;
    Ok(last)
}

async fn run_single_query(
    client: &Client,
    sql: &str,
    params: &[JsonValue],
    started: Instant,
) -> Result<QueryResultData, MappedIpcError> {
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
            .map(|row| (0..row.len()).map(|i| cell_value(row, i)).collect())
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

/// Mirrors `src/lib/sql-statement-splitter.ts`.
pub fn split_sql_statements(sql: &str) -> Vec<String> {
    let chars: Vec<char> = sql.chars().collect();
    let mut result = Vec::new();
    let mut current = String::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '$' {
            if let Some(end) = dollar_tag_end(&chars, i) {
                let tag: String = chars[i..=end].iter().collect();
                current.push_str(&tag);
                i = end + 1;
                while i < chars.len() {
                    if chars[i] == '$' {
                        if let Some(close) = dollar_tag_end(&chars, i) {
                            let candidate: String = chars[i..=close].iter().collect();
                            if candidate == tag {
                                current.push_str(&tag);
                                i = close + 1;
                                break;
                            }
                        }
                    }
                    current.push(chars[i]);
                    i += 1;
                }
                continue;
            }
        }
        if c == '\'' || c == '"' {
            let quote = c;
            let escape_aware = quote == '\'' && is_escape_string_quote(&chars, i);
            current.push(c);
            i += 1;
            while i < chars.len() {
                if escape_aware && chars[i] == '\\' && i + 1 < chars.len() {
                    current.push(chars[i]);
                    current.push(chars[i + 1]);
                    i += 2;
                    continue;
                }
                current.push(chars[i]);
                if chars[i] == quote {
                    if i + 1 < chars.len() && chars[i + 1] == quote {
                        current.push(quote);
                        i += 2;
                        continue;
                    }
                    i += 1;
                    break;
                }
                i += 1;
            }
            continue;
        }
        if c == '-' && chars.get(i + 1) == Some(&'-') {
            current.push_str("--");
            i += 2;
            while i < chars.len() && chars[i] != '\n' {
                current.push(chars[i]);
                i += 1;
            }
            continue;
        }
        if c == '/' && chars.get(i + 1) == Some(&'*') {
            let mut depth = 1;
            current.push_str("/*");
            i += 2;
            while i < chars.len() && depth > 0 {
                if chars[i] == '/' && chars.get(i + 1) == Some(&'*') {
                    current.push_str("/*");
                    depth += 1;
                    i += 2;
                } else if chars[i] == '*' && chars.get(i + 1) == Some(&'/') {
                    current.push_str("*/");
                    depth -= 1;
                    i += 2;
                } else {
                    current.push(chars[i]);
                    i += 1;
                }
            }
            continue;
        }
        if c == ';' {
            push_statement(&mut result, &mut current);
            i += 1;
            continue;
        }
        current.push(c);
        i += 1;
    }
    push_statement(&mut result, &mut current);
    result
}

pub fn should_wrap_transaction(statements: &[&str]) -> bool {
    !statements.iter().any(|sql| {
        let s = normalize_for_keyword_match(sql);
        // END and ABORT are spelling aliases of COMMIT and ROLLBACK. They are
        // matched on the whole first token, not as a prefix: `SELECT * FROM
        // endpoints` normalises to a string starting with "end" but is an
        // ordinary statement.
        let first_token = s.split(' ').next().unwrap_or("");
        let user_txn = ["begin", "start transaction", "commit", "rollback"]
            .iter()
            .any(|k| s.starts_with(k))
            || matches!(first_token, "end" | "abort");
        // REINDEX and VACUUM are matched on the bare verb: their object-type
        // keyword is mandatory and varies (REINDEX TABLE / INDEX / SCHEMA /
        // DATABASE / SYSTEM), and neither belongs in an implicit transaction.
        // Verified against PostgreSQL 17: bare CLUSTER is rejected in a
        // transaction block while `CLUSTER tbl USING idx` is accepted, and of
        // the DISCARD forms only DISCARD ALL is rejected. CHECKPOINT is legal
        // inside a transaction block and deliberately stays off this list —
        // listing it would drop the wrapper for the whole script.
        let illegal_in_txn = s == "cluster"
            || s == "discard all"
            || s.starts_with("vacuum")
            || s.starts_with("reindex")
            || s.starts_with("create database")
            || s.starts_with("drop database")
            || s.starts_with("create index concurrently")
            || s.starts_with("create unique index concurrently")
            || s.starts_with("drop index concurrently")
            || s.starts_with("alter system")
            || s.starts_with("create tablespace")
            || s.starts_with("drop tablespace")
            || s.starts_with("create subscription")
            || s.starts_with("drop subscription")
            || s.starts_with("refresh materialized view concurrently");
        user_txn || illegal_in_txn
    })
}

/// Lowercase a statement for keyword matching: drop leading comments, drop a
/// leading parenthesised option list (`REINDEX (VERBOSE) DATABASE …`), and
/// collapse whitespace runs so newlines between keywords still match.
fn normalize_for_keyword_match(sql: &str) -> String {
    let stripped = strip_leading_sql_noise(sql).to_ascii_lowercase();
    let mut rest = stripped.trim_start();
    if let Some(after) = strip_leading_option_list(rest) {
        rest = after.trim_start();
    }
    rest.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// `(a, b) tail` → `tail`; `None` when there is no balanced leading group.
fn strip_leading_option_list(s: &str) -> Option<&str> {
    if !s.starts_with('(') {
        return None;
    }
    let mut depth = 0usize;
    for (index, c) in s.char_indices() {
        match c {
            '(' => depth += 1,
            ')' => {
                depth -= 1;
                if depth == 0 {
                    return Some(&s[index + c.len_utf8()..]);
                }
            }
            _ => {}
        }
    }
    None
}

/// True when the quote at `index` opens a PostgreSQL escape string (`E'…'`),
/// where a backslash escapes the next character. Plain `'…'` literals do not
/// honour backslashes under the default `standard_conforming_strings = on`.
fn is_escape_string_quote(chars: &[char], index: usize) -> bool {
    if index == 0 {
        return false;
    }
    if !matches!(chars[index - 1], 'E' | 'e') {
        return false;
    }
    // A trailing E of a longer word (e.g. `VALUE'…'`) is not the escape prefix.
    match index.checked_sub(2).and_then(|prev| chars.get(prev)) {
        None => true,
        Some(c) => !(c.is_ascii_alphanumeric() || *c == '_' || *c == '$'),
    }
}

fn dollar_tag_end(chars: &[char], start: usize) -> Option<usize> {
    let mut j = start + 1;
    while j < chars.len() && (chars[j].is_ascii_alphanumeric() || chars[j] == '_') {
        j += 1;
    }
    (j < chars.len() && chars[j] == '$').then_some(j)
}

fn push_statement(result: &mut Vec<String>, current: &mut String) {
    let cleaned = strip_leading_sql_noise(current).trim().to_string();
    if !cleaned.is_empty() {
        result.push(cleaned);
    }
    current.clear();
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
        assert!(looks_like_select(
            "WITH cte AS (SELECT 1) SELECT * FROM cte"
        ));
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

    #[test]
    fn split_sql_statements_last_select_wins() {
        let parts = split_sql_statements("SELECT 1 AS a; SELECT 2 AS b");
        assert_eq!(parts, vec!["SELECT 1 AS a", "SELECT 2 AS b"]);
    }

    #[test]
    fn wrap_transaction_unless_user_already_has_begin() {
        assert!(should_wrap_transaction(&["SELECT 1", "SELECT 2"]));
        assert!(!should_wrap_transaction(&["BEGIN", "SELECT 1", "COMMIT"]));
    }

    #[test]
    fn no_wrap_for_statements_illegal_inside_transaction_block() {
        // These commands CANNOT run inside a transaction block in PostgreSQL.
        // should_wrap_transaction must return false when any of them is present.
        assert!(
            !should_wrap_transaction(&["VACUUM public.users", "VACUUM public.orders"]),
            "VACUUM cannot run inside a transaction block"
        );
        assert!(
            !should_wrap_transaction(&["CREATE DATABASE shop", "SELECT 1"]),
            "CREATE DATABASE cannot run inside a transaction block"
        );
        assert!(
            !should_wrap_transaction(&[
                "CREATE INDEX CONCURRENTLY idx_name ON users(name)",
                "SELECT 1"
            ]),
            "CREATE INDEX CONCURRENTLY cannot run inside a transaction block"
        );
        assert!(
            !should_wrap_transaction(&["DROP DATABASE old_db", "SELECT 1"]),
            "DROP DATABASE cannot run inside a transaction block"
        );
        assert!(
            !should_wrap_transaction(&["REINDEX DATABASE mydb", "SELECT 1"]),
            "REINDEX DATABASE cannot run inside a transaction block"
        );
        assert!(
            !should_wrap_transaction(&[
                "CREATE UNIQUE INDEX CONCURRENTLY idx ON t(c)",
                "SELECT 1"
            ]),
            "CREATE UNIQUE INDEX CONCURRENTLY cannot run inside a transaction block"
        );
        assert!(
            !should_wrap_transaction(&["REINDEX INDEX CONCURRENTLY idx", "SELECT 1"]),
            "REINDEX INDEX CONCURRENTLY cannot run inside a transaction block"
        );
        assert!(
            !should_wrap_transaction(&["ALTER SYSTEM SET work_mem = '64MB'", "SELECT 1"]),
            "ALTER SYSTEM cannot run inside a transaction block"
        );
        assert!(
            !should_wrap_transaction(&[
                "REFRESH MATERIALIZED VIEW CONCURRENTLY mv_stats",
                "SELECT 1"
            ]),
            "REFRESH MATERIALIZED VIEW CONCURRENTLY cannot run inside a transaction block"
        );
        assert!(
            !should_wrap_transaction(&["CREATE SUBSCRIPTION sub CONNECTION '' PUBLICATION pub", "SELECT 1"]),
            "CREATE SUBSCRIPTION cannot run inside a transaction block"
        );
    }

    #[test]
    fn no_wrap_for_discard_all_cluster_and_transaction_control_aliases() {
        // Verified against PostgreSQL 17 locally:
        //   BEGIN; DISCARD ALL; -> ERROR: DISCARD ALL cannot run inside a transaction block
        //   BEGIN; CLUSTER;     -> ERROR: CLUSTER cannot run inside a transaction block
        assert!(
            !should_wrap_transaction(&["DISCARD ALL", "SELECT 1"]),
            "DISCARD ALL cannot run inside a transaction block"
        );
        assert!(
            !should_wrap_transaction(&["CLUSTER", "SELECT 1"]),
            "argument-less CLUSTER cannot run inside a transaction block"
        );
        // END and ABORT are spelling aliases of COMMIT and ROLLBACK: a script
        // using them is already managing its own transaction.
        assert!(
            !should_wrap_transaction(&["BEGIN", "SELECT 1", "END"]),
            "END is an alias of COMMIT and marks a user-managed transaction"
        );
        assert!(
            !should_wrap_transaction(&["BEGIN", "SELECT 1", "ABORT"]),
            "ABORT is an alias of ROLLBACK and marks a user-managed transaction"
        );
    }

    #[test]
    fn wrap_is_kept_for_commands_that_are_legal_inside_a_transaction_block() {
        // Verified against PostgreSQL 17 locally: each of these commits cleanly
        // inside BEGIN/COMMIT, so suppressing the wrapper would needlessly drop
        // atomicity from the rest of the script.
        assert!(
            should_wrap_transaction(&["CHECKPOINT", "SELECT 1"]),
            "CHECKPOINT is legal inside a transaction block"
        );
        assert!(
            should_wrap_transaction(&["DISCARD PLANS", "SELECT 1"]),
            "only DISCARD ALL is prohibited; DISCARD PLANS is legal"
        );
        assert!(
            should_wrap_transaction(&["DISCARD SEQUENCES", "SELECT 1"]),
            "only DISCARD ALL is prohibited; DISCARD SEQUENCES is legal"
        );
        assert!(
            should_wrap_transaction(&["CLUSTER users USING users_pkey", "SELECT 1"]),
            "CLUSTER with a table argument is legal inside a transaction block"
        );
        // Prefix-matching traps: these are ordinary statements on user objects.
        assert!(
            should_wrap_transaction(&["SELECT * FROM endpoints", "SELECT 1"]),
            "a table named endpoints must not read as the END alias"
        );
        assert!(
            should_wrap_transaction(&["INSERT INTO aborted_jobs VALUES (1)", "SELECT 1"]),
            "a table named aborted_jobs must not read as the ABORT alias"
        );
    }

    #[test]
    fn no_wrap_for_reindex_object_type_and_option_forms() {
        // REINDEX grammar (PostgreSQL docs, sql-reindex):
        //   REINDEX [ ( option [, ...] ) ] { INDEX | TABLE | SCHEMA } [ CONCURRENTLY ] name
        //   REINDEX [ ( option [, ...] ) ] { DATABASE | SYSTEM } [ CONCURRENTLY ] [ name ]
        // The object type is mandatory, so `REINDEX CONCURRENTLY name` never
        // reaches the server — while these real forms all reject a transaction
        // block and must therefore suppress the BEGIN/COMMIT wrapper.
        assert!(
            !should_wrap_transaction(&["VACUUM (FULL, VERBOSE) public.users", "SELECT 1"]),
            "parenthesised-option VACUUM cannot run inside a transaction block"
        );
        assert!(
            !should_wrap_transaction(&["REINDEX TABLE CONCURRENTLY users", "SELECT 1"]),
            "REINDEX TABLE CONCURRENTLY cannot run inside a transaction block"
        );
        assert!(
            !should_wrap_transaction(&["REINDEX INDEX CONCURRENTLY idx_users_name", "SELECT 1"]),
            "REINDEX INDEX CONCURRENTLY cannot run inside a transaction block"
        );
        assert!(
            !should_wrap_transaction(&["REINDEX SCHEMA public", "SELECT 1"]),
            "REINDEX SCHEMA cannot run inside a transaction block"
        );
        assert!(
            !should_wrap_transaction(&["REINDEX (VERBOSE) DATABASE shop", "SELECT 1"]),
            "parenthesised-option REINDEX DATABASE cannot run inside a transaction block"
        );
        assert!(
            !should_wrap_transaction(&["CREATE INDEX\n  CONCURRENTLY idx ON t(c)", "SELECT 1"]),
            "a newline between keywords must not hide CREATE INDEX CONCURRENTLY"
        );
        // Statements that merely start with the same letters still wrap.
        assert!(should_wrap_transaction(&["SELECT 1", "UPDATE t SET c = 1"]));
    }

    #[test]
    fn split_sql_statements_keeps_escape_string_constants_whole() {
        // E'…' honours backslash escapes, so \' is an escaped quote and the
        // semicolon after it is part of the literal, not a statement boundary.
        assert_eq!(
            split_sql_statements(r#"SELECT E'a\'; b' AS x; SELECT 2"#),
            vec![r#"SELECT E'a\'; b' AS x"#, "SELECT 2"]
        );
        // A doubled backslash ends the escape, so this quote really does close.
        assert_eq!(
            split_sql_statements(r#"SELECT E'a\\'; SELECT 2"#),
            vec![r#"SELECT E'a\\'"#, "SELECT 2"]
        );
    }

    #[test]
    fn split_sql_statements_mirrors_ts_quote_and_comment_cases() {
        assert_eq!(
            split_sql_statements("SELECT 'a;b'; SELECT 2"),
            vec!["SELECT 'a;b'", "SELECT 2"]
        );
        assert_eq!(
            split_sql_statements("SELECT $$ a;b $$; SELECT 2"),
            vec!["SELECT $$ a;b $$", "SELECT 2"]
        );
        assert_eq!(
            split_sql_statements("SELECT 1; -- trailing; still comment\nSELECT 2"),
            vec!["SELECT 1", "SELECT 2"]
        );
    }
}
