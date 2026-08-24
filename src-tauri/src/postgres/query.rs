//! Query execution and result mapping for thin Postgres I/O.

use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value as JsonValue;
use tokio_postgres::error::SqlState;
use tokio_postgres::types::ToSql;
use tokio_postgres::{Client, SimpleQueryMessage};

use super::error::{map_tokio_postgres_error, IpcErrorKind, MappedIpcError};
use super::text_transport::{
    cursor_ownership_from_probe, execution_route, fallback_protocol_columns, map_cell,
    CursorTransactionOwnership, CursorTransactionProbe, ExecutionRoute, TextColumn,
    DISPLAY_CURSOR_NAME,
};
use super::{ResultCell, ResultColumn};

/// QueryResult-shaped payload (mirrors `src/ipc/contract.ts` QueryResult).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResultData {
    pub columns: Vec<String>,
    pub column_types: Vec<ResultColumn>,
    pub rows: Vec<Vec<ResultCell>>,
    pub rows_affected: Option<u64>,
    pub statement_count: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub displayed_statement_index: Option<u64>,
    pub duration_ms: u64,
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
            column_types: vec![],
            rows: vec![],
            rows_affected: Some(0),
            statement_count: 0,
            displayed_statement_index: None,
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
    let mut outcomes = Vec::with_capacity(statements.len());
    for statement in &statements {
        let statement_params = if statements.len() == 1 { params } else { &[] };
        let outcome = run_single_query(client, statement, statement_params, started).await;
        let failed = outcome.is_err();
        outcomes.push(outcome);
        if failed {
            if wrap {
                let _ = client.batch_execute("ROLLBACK").await;
            }
            break;
        }
    }
    if wrap && outcomes.iter().all(Result::is_ok) {
        client
            .batch_execute("COMMIT")
            .await
            .map_err(|e| map_tokio_postgres_error(&e))?;
    }
    finalize_multi_statement_run(
        outcomes,
        statements.len(),
        wrap,
        started.elapsed().as_millis() as u64,
    )
}

async fn run_single_query(
    client: &Client,
    sql: &str,
    params: &[JsonValue],
    started: Instant,
) -> Result<QueryResultData, MappedIpcError> {
    let prepared_columns = prepare_text_columns(client, sql).await;
    let column_count = prepared_columns
        .as_ref()
        .map(|columns| columns.len())
        .unwrap_or(0);

    if !params.is_empty() && !statement_produces_rows(column_count) {
        let owned = json_params_to_owned(params)?;
        let binds: Vec<&(dyn ToSql + Sync)> = owned
            .iter()
            .map(|p| p.as_ref() as &(dyn ToSql + Sync))
            .collect();
        let result = client
            .execute(sql, &binds)
            .await
            .map_err(|e| map_tokio_postgres_error(&e))?;
        return Ok(QueryResultData {
            columns: vec![],
            column_types: vec![],
            rows: vec![],
            rows_affected: Some(result),
            statement_count: 1,
            displayed_statement_index: None,
            duration_ms: started.elapsed().as_millis() as u64,
        });
    }

    run_text_query(client, sql, params, started, prepared_columns).await
}

async fn run_text_query(
    client: &Client,
    sql: &str,
    params: &[JsonValue],
    started: Instant,
    prepared_columns: Option<Vec<TextColumn>>,
) -> Result<QueryResultData, MappedIpcError> {
    let messages = match execution_route(sql, params.len()) {
        ExecutionRoute::SimpleQuery => client
            .simple_query(sql)
            .await
            .map_err(|error| map_tokio_postgres_error(&error))?,
        ExecutionRoute::BoundCursor {
            declare_sql,
            fetch_sql,
        } => run_postgres_bound_cursor(client, &declare_sql, &fetch_sql, params).await?,
    };
    Ok(map_text_messages(
        messages,
        prepared_columns,
        started.elapsed(),
    ))
}

async fn prepare_text_columns(client: &Client, sql: &str) -> Option<Vec<TextColumn>> {
    client.prepare(sql).await.ok().map(|statement| {
        statement
            .columns()
            .iter()
            .map(|column| {
                TextColumn::new(column.name(), column.type_().name(), column.type_().oid())
            })
            .collect()
    })
}

async fn run_postgres_bound_cursor(
    client: &Client,
    declare_sql: &str,
    fetch_sql: &str,
    params: &[JsonValue],
) -> Result<Vec<SimpleQueryMessage>, MappedIpcError> {
    let ownership = cursor_transaction_ownership(client).await?;
    let owned = json_params_to_owned(params)?;
    let binds: Vec<&(dyn ToSql + Sync)> = owned
        .iter()
        .map(|param| param.as_ref() as &(dyn ToSql + Sync))
        .collect();
    let mut operations = PostgresCursorOperations {
        client,
        declare_sql,
        fetch_sql,
        binds: &binds,
    };
    execute_bound_cursor(&mut operations, ownership)
        .await
        .map_err(|error| map_tokio_postgres_error(&error))
}

trait BoundCursorOperations {
    type Output;
    type Error;

    async fn begin(&mut self) -> Result<(), Self::Error>;
    async fn declare(&mut self) -> Result<(), Self::Error>;
    async fn fetch(&mut self) -> Result<Self::Output, Self::Error>;
    async fn close(&mut self) -> Result<(), Self::Error>;
    async fn commit(&mut self) -> Result<(), Self::Error>;
    async fn rollback(&mut self);
}

async fn execute_bound_cursor<O: BoundCursorOperations>(
    operations: &mut O,
    ownership: CursorTransactionOwnership,
) -> Result<O::Output, O::Error> {
    if ownership == CursorTransactionOwnership::PathOwned {
        operations.begin().await?;
    }
    if let Err(error) = operations.declare().await {
        return cursor_failure(operations, ownership, error).await;
    }
    let output = match operations.fetch().await {
        Ok(output) => output,
        Err(error) => return cursor_failure(operations, ownership, error).await,
    };
    if let Err(error) = operations.close().await {
        return cursor_failure(operations, ownership, error).await;
    }
    if ownership == CursorTransactionOwnership::PathOwned {
        if let Err(error) = operations.commit().await {
            return cursor_failure(operations, ownership, error).await;
        }
    }
    Ok(output)
}

async fn cursor_failure<O: BoundCursorOperations>(
    operations: &mut O,
    ownership: CursorTransactionOwnership,
    error: O::Error,
) -> Result<O::Output, O::Error> {
    if ownership == CursorTransactionOwnership::PathOwned {
        operations.rollback().await;
    }
    Err(error)
}

struct PostgresCursorOperations<'a> {
    client: &'a Client,
    declare_sql: &'a str,
    fetch_sql: &'a str,
    binds: &'a [&'a (dyn ToSql + Sync)],
}

impl BoundCursorOperations for PostgresCursorOperations<'_> {
    type Output = Vec<SimpleQueryMessage>;
    type Error = tokio_postgres::Error;

    async fn begin(&mut self) -> Result<(), Self::Error> {
        self.client.batch_execute("BEGIN").await
    }

    async fn declare(&mut self) -> Result<(), Self::Error> {
        self.client
            .execute(self.declare_sql, self.binds)
            .await
            .map(|_| ())
    }

    async fn fetch(&mut self) -> Result<Self::Output, Self::Error> {
        self.client.simple_query(self.fetch_sql).await
    }

    async fn close(&mut self) -> Result<(), Self::Error> {
        self.client
            .batch_execute(&format!("CLOSE {DISPLAY_CURSOR_NAME}"))
            .await
    }

    async fn commit(&mut self) -> Result<(), Self::Error> {
        self.client.batch_execute("COMMIT").await
    }

    async fn rollback(&mut self) {
        let _ = self.client.batch_execute("ROLLBACK").await;
    }
}

const CURSOR_OWNERSHIP_SAVEPOINT: &str = "dragondb_display_cursor_ownership";

async fn cursor_transaction_ownership(
    client: &Client,
) -> Result<CursorTransactionOwnership, MappedIpcError> {
    let savepoint = format!("SAVEPOINT {CURSOR_OWNERSHIP_SAVEPOINT}");
    match client.batch_execute(&savepoint).await {
        Ok(()) => {
            let release = format!("RELEASE SAVEPOINT {CURSOR_OWNERSHIP_SAVEPOINT}");
            client
                .batch_execute(&release)
                .await
                .map_err(|error| map_tokio_postgres_error(&error))?;
            Ok(cursor_ownership_from_probe(
                CursorTransactionProbe::SavepointCreated,
            ))
        }
        Err(error) if error.code() == Some(&SqlState::NO_ACTIVE_SQL_TRANSACTION) => Ok(
            cursor_ownership_from_probe(CursorTransactionProbe::NoActiveTransaction),
        ),
        Err(error) => Err(map_tokio_postgres_error(&error)),
    }
}

fn map_text_messages(
    messages: Vec<SimpleQueryMessage>,
    prepared_columns: Option<Vec<TextColumn>>,
    duration: Duration,
) -> QueryResultData {
    let mut columns = prepared_columns.unwrap_or_default();
    let mut rows = Vec::new();
    let mut rows_affected = Some(0);

    for message in messages {
        match message {
            SimpleQueryMessage::RowDescription(description) => {
                if columns.len() != description.len() {
                    columns = fallback_protocol_columns(description.iter().map(|col| col.name()));
                }
                rows_affected = None;
            }
            SimpleQueryMessage::Row(row) => {
                rows.push(map_simple_row(&row, &mut columns));
                rows_affected = None;
            }
            SimpleQueryMessage::CommandComplete(affected) if rows_affected.is_some() => {
                rows_affected = Some(affected);
            }
            SimpleQueryMessage::CommandComplete(_) => {}
            _ => {}
        }
    }

    let (column_names, column_types) = columns
        .into_iter()
        .map(|column| {
            let name = column.name;
            let metadata = ResultColumn {
                name: name.clone(),
                type_name: column.type_name,
                type_oid: column.type_oid,
            };
            (name, metadata)
        })
        .unzip();

    QueryResultData {
        columns: column_names,
        column_types,
        rows,
        rows_affected,
        statement_count: 1,
        displayed_statement_index: None,
        duration_ms: duration.as_millis() as u64,
    }
}

/// Combine per-statement outcomes into the IPC result shape and enrich partial failures.
pub fn finalize_multi_statement_run(
    outcomes: Vec<Result<QueryResultData, MappedIpcError>>,
    total_statements: usize,
    wrapped: bool,
    duration_ms: u64,
) -> Result<QueryResultData, MappedIpcError> {
    if outcomes.is_empty() {
        return Ok(QueryResultData {
            columns: vec![],
            column_types: vec![],
            rows: vec![],
            rows_affected: Some(0),
            statement_count: 0,
            displayed_statement_index: None,
            duration_ms,
        });
    }

    if total_statements == 1 {
        return match outcomes.into_iter().next().expect("one outcome") {
            Ok(mut result) => {
                result.statement_count = 0;
                result.displayed_statement_index = None;
                result.duration_ms = duration_ms;
                Ok(result)
            }
            Err(error) => Err(error),
        };
    }

    for (index, outcome) in outcomes.iter().enumerate() {
        if let Err(error) = outcome {
            return Err(enrich_multi_statement_error(
                error.clone(),
                index,
                total_statements,
                wrapped,
            ));
        }
    }

    let results = outcomes
        .into_iter()
        .map(|outcome| outcome.expect("checked above"))
        .collect();
    Ok(select_displayed_multi_statement_result(results, duration_ms))
}

fn enrich_multi_statement_error(
    error: MappedIpcError,
    failed_index: usize,
    total: usize,
    wrapped: bool,
) -> MappedIpcError {
    let failed_num = failed_index + 1;
    let mut message = format!(
        "Statement {failed_num} of {total} failed: {}",
        error.message
    );
    if failed_index > 0 {
        let prior = failed_index;
        if wrapped {
            message.push_str(&format!(" Statement {prior} was rolled back."));
        } else {
            message.push_str(&format!(" Statement {prior} was already committed."));
        }
    }
    MappedIpcError {
        kind: error.kind,
        message,
        position: error.position,
    }
}

fn select_displayed_multi_statement_result(
    results: Vec<QueryResultData>,
    duration_ms: u64,
) -> QueryResultData {
    let total = results.len();
    let mut last = results.last().cloned().unwrap_or(QueryResultData {
        columns: vec![],
        column_types: vec![],
        rows: vec![],
        rows_affected: Some(0),
        statement_count: total as u64,
        displayed_statement_index: Some(total as u64),
        duration_ms,
    });
    let mut saw_row_result = false;
    let mut displayed_index = total as u64;

    for (index, result) in results.iter().enumerate() {
        if !result.columns.is_empty() {
            saw_row_result = true;
            last = result.clone();
            displayed_index = (index + 1) as u64;
        } else if !saw_row_result && index + 1 == total {
            last = result.clone();
            displayed_index = (index + 1) as u64;
        }
    }

    last.statement_count = total as u64;
    last.displayed_statement_index = Some(displayed_index);
    last.duration_ms = duration_ms;
    last
}

fn map_simple_row(
    row: &tokio_postgres::SimpleQueryRow,
    columns: &mut Vec<TextColumn>,
) -> Vec<ResultCell> {
    if columns.len() != row.len() {
        *columns = fallback_protocol_columns(row.columns().iter().map(|column| column.name()));
    }
    (0..row.len())
        .map(|index| match row.try_get(index) {
            Ok(value) => map_cell(value.map(str::as_bytes), &columns[index]),
            Err(_) => ResultCell::Unreadable {
                type_name: columns[index].type_name.clone(),
            },
        })
        .collect()
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

/// True when a prepared statement's column set indicates row-producing results.
fn statement_produces_rows(column_count: usize) -> bool {
    column_count > 0
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_result_serializes_the_typescript_wire_shape() {
        let result = map_text_messages(
            vec![],
            Some(vec![TextColumn::new("account_id", "int8", 20)]),
            Duration::from_millis(7),
        );

        assert_eq!(
            serde_json::to_value(result).expect("serialize query result"),
            serde_json::json!({
                "columns": ["account_id"],
                "columnTypes": [{
                    "name": "account_id",
                    "typeName": "int8",
                    "typeOid": 20
                }],
                "rows": [],
                "rowsAffected": 0,
                "statementCount": 1,
                "durationMs": 7
            })
        );
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    enum CursorOperation {
        Begin,
        Declare,
        Fetch,
        Close,
        Commit,
        Rollback,
    }

    struct FakeCursorOperations {
        calls: Vec<CursorOperation>,
        fails_at: Option<CursorOperation>,
    }

    impl FakeCursorOperations {
        fn new(fails_at: Option<CursorOperation>) -> Self {
            Self {
                calls: Vec::new(),
                fails_at,
            }
        }

        fn record(&mut self, operation: CursorOperation) -> Result<(), CursorOperation> {
            self.calls.push(operation);
            (self.fails_at != Some(operation))
                .then_some(())
                .ok_or(operation)
        }
    }

    impl BoundCursorOperations for FakeCursorOperations {
        type Output = &'static str;
        type Error = CursorOperation;

        async fn begin(&mut self) -> Result<(), Self::Error> {
            self.record(CursorOperation::Begin)
        }

        async fn declare(&mut self) -> Result<(), Self::Error> {
            self.record(CursorOperation::Declare)
        }

        async fn fetch(&mut self) -> Result<Self::Output, Self::Error> {
            self.record(CursorOperation::Fetch).map(|()| "rows")
        }

        async fn close(&mut self) -> Result<(), Self::Error> {
            self.record(CursorOperation::Close)
        }

        async fn commit(&mut self) -> Result<(), Self::Error> {
            self.record(CursorOperation::Commit)
        }

        async fn rollback(&mut self) {
            self.calls.push(CursorOperation::Rollback);
        }
    }

    #[tokio::test]
    async fn text_transport_cursor_success_respects_transaction_owner() {
        let mut caller = FakeCursorOperations::new(None);
        let output = execute_bound_cursor(&mut caller, CursorTransactionOwnership::CallerOwned)
            .await
            .expect("caller-owned cursor");
        assert_eq!(output, "rows");
        assert_eq!(
            caller.calls,
            vec![
                CursorOperation::Declare,
                CursorOperation::Fetch,
                CursorOperation::Close,
            ]
        );

        let mut path = FakeCursorOperations::new(None);
        execute_bound_cursor(&mut path, CursorTransactionOwnership::PathOwned)
            .await
            .expect("path-owned cursor");
        assert_eq!(
            path.calls,
            vec![
                CursorOperation::Begin,
                CursorOperation::Declare,
                CursorOperation::Fetch,
                CursorOperation::Close,
                CursorOperation::Commit,
            ]
        );
    }

    #[tokio::test]
    async fn text_transport_cursor_failures_cleanup_only_path_owned_transactions() {
        for failure in [
            CursorOperation::Declare,
            CursorOperation::Fetch,
            CursorOperation::Close,
            CursorOperation::Commit,
        ] {
            let mut path = FakeCursorOperations::new(Some(failure));
            assert_eq!(
                execute_bound_cursor(&mut path, CursorTransactionOwnership::PathOwned).await,
                Err(failure)
            );
            assert_eq!(path.calls.last(), Some(&CursorOperation::Rollback));
        }

        for failure in [
            CursorOperation::Declare,
            CursorOperation::Fetch,
            CursorOperation::Close,
        ] {
            let mut caller = FakeCursorOperations::new(Some(failure));
            assert_eq!(
                execute_bound_cursor(&mut caller, CursorTransactionOwnership::CallerOwned).await,
                Err(failure)
            );
            assert!(!caller.calls.iter().any(|call| matches!(
                call,
                CursorOperation::Begin | CursorOperation::Commit | CursorOperation::Rollback
            )));
        }
    }

    #[test]
    fn multi_statement_orchestration_reports_shape_and_failures() {
        fn sample(columns: &[&str]) -> QueryResultData {
            QueryResultData {
                columns: columns.iter().map(|name| (*name).to_string()).collect(),
                column_types: vec![],
                rows: vec![],
                rows_affected: if columns.is_empty() { Some(1) } else { None },
                statement_count: 1,
                displayed_statement_index: None,
                duration_ms: 0,
            }
        }

        fn syntax_error(message: &str) -> MappedIpcError {
            MappedIpcError {
                kind: IpcErrorKind::Syntax,
                message: message.into(),
                position: None,
            }
        }

        let success = finalize_multi_statement_run(
            vec![
                Ok(sample(&["a"])),
                Ok(sample(&[])),
                Ok(sample(&["b"])),
            ],
            3,
            true,
            12,
        )
        .expect("three-statement success");
        assert_eq!(success.statement_count, 3);
        assert_eq!(success.displayed_statement_index, Some(3));
        assert_eq!(success.columns, vec!["b"]);
        assert_eq!(success.duration_ms, 12);

        let single = finalize_multi_statement_run(vec![Ok(sample(&["only"]))], 1, false, 4)
            .expect("single-statement success");
        assert_eq!(single.statement_count, 0);
        assert_eq!(single.displayed_statement_index, None);

        let wrapped_failure = finalize_multi_statement_run(
            vec![Ok(sample(&["a"])), Err(syntax_error("bad syntax"))],
            3,
            true,
            0,
        )
        .expect_err("wrapped failure");
        assert!(
            wrapped_failure.message.contains("Statement 2 of 3 failed"),
            "unexpected message: {}",
            wrapped_failure.message
        );
        assert!(
            wrapped_failure.message.contains("bad syntax"),
            "original error must be preserved: {}",
            wrapped_failure.message
        );
        assert!(
            wrapped_failure
                .message
                .contains("Statement 1 was rolled back"),
            "wrapped scripts must report rollback: {}",
            wrapped_failure.message
        );

        let unwrapped_failure = finalize_multi_statement_run(
            vec![Ok(sample(&[])), Err(syntax_error("bad syntax"))],
            3,
            false,
            0,
        )
        .expect_err("unwrapped failure");
        assert!(
            unwrapped_failure.message.contains("Statement 2 of 3 failed"),
            "unexpected message: {}",
            unwrapped_failure.message
        );
        assert!(
            unwrapped_failure
                .message
                .contains("Statement 1 was already committed"),
            "unwrapped scripts must report prior commit: {}",
            unwrapped_failure.message
        );
    }

    #[test]
    fn row_producing_statements_are_identified_by_column_set() {
        let fixtures: [(&str, &[&str], bool); 6] = [
            ("SHOW timezone", &["TimeZone"], true),
            ("EXPLAIN SELECT 1", &["QUERY PLAN"], true),
            ("VALUES (1), (2)", &["column1"], true),
            ("TABLE users", &["id", "name"], true),
            ("INSERT INTO t VALUES (1) RETURNING *", &["id"], true),
            ("UPDATE t SET x = 1", &[], false),
        ];

        for (sql, column_names, expect_row_producing) in fixtures {
            assert_eq!(
                statement_produces_rows(column_names.len()),
                expect_row_producing,
                "column-set classification for {sql:?}"
            );
        }
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
            !should_wrap_transaction(&["CREATE UNIQUE INDEX CONCURRENTLY idx ON t(c)", "SELECT 1"]),
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
            !should_wrap_transaction(&[
                "CREATE SUBSCRIPTION sub CONNECTION '' PUBLICATION pub",
                "SELECT 1"
            ]),
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
