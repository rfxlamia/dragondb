// Run locally: `cargo test --manifest-path src-tauri/Cargo.toml --test postgres_type_matrix -- --ignored --nocapture`
//
// Requires a live PostgreSQL reachable via DRAGONDB_TEST_PG_URL, for example:
//   export DRAGONDB_TEST_PG_URL='postgres://user@localhost/postgres'

use dragondb_lib::postgres::{
    connect, run_query, ConnectParams, EffectiveTls, QueryResultData, ResultCell,
};
use serde_json::Value as JsonValue;
use std::env;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio_postgres::Client;

const SESSION_TIMEZONE: &str = "Asia/Bangkok";
const SESSION_DATE_STYLE: &str = "ISO, MDY";

fn pg_test_url() -> Option<String> {
    env::var("DRAGONDB_TEST_PG_URL")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn skip_if_no_pg_url() -> bool {
    if pg_test_url().is_some() {
        return false;
    }
    eprintln!("DRAGONDB_TEST_PG_URL unset — skipping postgres type matrix integration suite");
    true
}

#[derive(Debug, Clone)]
struct ParsedPgUrl {
    host: String,
    port: u16,
    user: String,
    password: String,
    database: String,
}

fn parse_pg_url(raw: &str) -> ParsedPgUrl {
    let without_scheme = raw
        .strip_prefix("postgres://")
        .or_else(|| raw.strip_prefix("postgresql://"))
        .unwrap_or_else(|| {
            panic!("DRAGONDB_TEST_PG_URL must use postgres:// or postgresql://");
        });

    let (auth, location) = match without_scheme.split_once('@') {
        Some(pair) => pair,
        None => ("", without_scheme),
    };

    let (user, password) = if auth.is_empty() {
        ("postgres".to_string(), String::new())
    } else if let Some((user, password)) = auth.split_once(':') {
        (user.to_string(), password.to_string())
    } else {
        (auth.to_string(), String::new())
    };

    let (host_port, database) = location.split_once('/').unwrap_or((location, "postgres"));
    let database = database
        .split(['?', '#'])
        .next()
        .filter(|name| !name.is_empty())
        .unwrap_or("postgres")
        .to_string();

    let (host, port) = if let Some((host, port)) = host_port.rsplit_once(':') {
        if host.starts_with('[') {
            (host_port.to_string(), 5432)
        } else {
            (
                host.to_string(),
                port.parse::<u16>()
                    .unwrap_or_else(|_| panic!("invalid port in DRAGONDB_TEST_PG_URL")),
            )
        }
    } else {
        (host_port.to_string(), 5432)
    };

    ParsedPgUrl {
        host,
        port,
        user,
        password,
        database,
    }
}

static FIXTURE_COUNTER: AtomicU64 = AtomicU64::new(0);

fn fixture_suffix() -> String {
    let counter = FIXTURE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock before unix epoch")
        .as_nanos();
    format!("{nanos}_{counter}")
}

struct TypeMatrixFixture {
    mood_type: String,
    posint_domain: String,
    pair_type: String,
    table_name: String,
}

impl TypeMatrixFixture {
    fn new() -> Self {
        let suffix = fixture_suffix();
        Self {
            mood_type: format!("dragondb_t4_mood_{suffix}"),
            posint_domain: format!("dragondb_t4_posint_{suffix}"),
            pair_type: format!("dragondb_t4_pair_{suffix}"),
            table_name: format!("dragondb_t4_fixture_{suffix}"),
        }
    }

    async fn setup(&self, client: &Client) {
        pin_session_settings(client).await;
        client
            .batch_execute(&format!(
                "CREATE TYPE {} AS ENUM ('RELEASE', 'DRAFT');\
                 CREATE DOMAIN {} AS integer CHECK (VALUE > 0);\
                 CREATE TYPE {} AS (i integer, s text);\
                 CREATE TABLE {} (id serial PRIMARY KEY, name text NOT NULL);\
                 INSERT INTO {} (name) VALUES ('ada'), ('bob');",
                self.mood_type,
                self.posint_domain,
                self.pair_type,
                self.table_name,
                self.table_name,
            ))
            .await
            .expect("create type matrix fixtures");
    }

    async fn teardown(&self, client: &Client) {
        let _ = client
            .batch_execute(&format!(
                "DROP TABLE IF EXISTS {};\
                 DROP TYPE IF EXISTS {};\
                 DROP DOMAIN IF EXISTS {};\
                 DROP TYPE IF EXISTS {};",
                self.table_name, self.pair_type, self.posint_domain, self.mood_type,
            ))
            .await;
    }

    fn matrix_sql(&self) -> String {
        format!(
            "SELECT \
                9223372036854775807::int8 AS int8_max, \
                (-9223372036854775808)::int8 AS int8_min, \
                12345678901234567890.1234567890123456789::numeric AS high_precision_numeric, \
                'ab'::char(6) AS padded_char, \
                DATE '2026-08-03' AS sample_date, \
                TIME '04:05:06' AS sample_time, \
                TIME WITH TIME ZONE '04:05:06+07' AS sample_timetz, \
                TIMESTAMP '2026-08-03 12:34:56' AS sample_timestamp, \
                TIMESTAMPTZ '2026-08-03 12:34:56+07' AS sample_timestamptz, \
                INTERVAL '1 year 2 mons 3 days 04:05:06' AS sample_interval, \
                'NaN'::float8 AS sample_nan, \
                'Infinity'::float8 AS sample_pos_inf, \
                '-Infinity'::float8 AS sample_neg_inf, \
                '550e8400-e29b-41d4-a716-446655440000'::uuid AS sample_uuid, \
                '{{\"a\":1,\"b\":[true,null]}}'::json AS sample_json, \
                '{{\"a\":1,\"b\":[true,null]}}'::jsonb AS sample_jsonb, \
                E'\\\\x00ff10'::bytea AS sample_bytea, \
                '192.168.1.1/24'::inet AS sample_inet, \
                int4range(1, 10, '[)') AS sample_int4range, \
                ARRAY['a',NULL,'c']::text[] AS array_with_null, \
                ARRAY['a','NULL','c']::text[] AS array_with_null_literal, \
                'RELEASE'::{mood} AS sample_enum, \
                5::{posint} AS sample_domain, \
                ROW(1,'hi')::{pair} AS sample_composite, \
                NULL::text AS sql_null",
            mood = self.mood_type,
            posint = self.posint_domain,
            pair = self.pair_type,
        )
    }
}

async fn pin_session_settings(client: &Client) {
    client
        .batch_execute(&format!(
            "SET TimeZone = '{SESSION_TIMEZONE}'; SET DateStyle = '{SESSION_DATE_STYLE}';"
        ))
        .await
        .expect("pin TimeZone and DateStyle for deterministic renderings");
}

async fn connect_from_env() -> (Client, tokio::task::AbortHandle) {
    let url = pg_test_url().expect("caller checked DRAGONDB_TEST_PG_URL");
    let parsed = parse_pg_url(&url);
    connect(ConnectParams {
        host: &parsed.host,
        port: parsed.port,
        user: &parsed.user,
        password: &parsed.password,
        database: &parsed.database,
        tls: EffectiveTls::NoTls,
    })
    .await
    .expect("connect to DRAGONDB_TEST_PG_URL")
}

fn column_index(result: &QueryResultData, name: &str) -> usize {
    result
        .columns
        .iter()
        .position(|column| column == name)
        .unwrap_or_else(|| panic!("missing column {name:?}"))
}

fn assert_cell_value(cell: &ResultCell, expected: &str) {
    match cell {
        ResultCell::Value { text } => assert_eq!(text.as_str(), expected),
        other => panic!("expected Value({expected:?}), got {other:?}"),
    }
}

fn assert_cell_null(cell: &ResultCell) {
    assert_eq!(*cell, ResultCell::Null);
}

fn assert_cell_value_not_unreadable(cell: &ResultCell) {
    assert!(
        !matches!(cell, ResultCell::Unreadable { .. }),
        "cell must not be unreadable: {cell:?}"
    );
}

#[derive(Clone, Copy)]
enum MatrixExpectation {
    Text(&'static str),
    Null,
}

const TYPE_MATRIX: &[(&str, MatrixExpectation)] = &[
    ("int8_max", MatrixExpectation::Text("9223372036854775807")),
    ("int8_min", MatrixExpectation::Text("-9223372036854775808")),
    (
        "high_precision_numeric",
        MatrixExpectation::Text("12345678901234567890.1234567890123456789"),
    ),
    ("padded_char", MatrixExpectation::Text("ab    ")),
    ("sample_date", MatrixExpectation::Text("2026-08-03")),
    ("sample_time", MatrixExpectation::Text("04:05:06")),
    ("sample_timetz", MatrixExpectation::Text("04:05:06+07")),
    (
        "sample_timestamp",
        MatrixExpectation::Text("2026-08-03 12:34:56"),
    ),
    (
        "sample_timestamptz",
        MatrixExpectation::Text("2026-08-03 12:34:56+07"),
    ),
    (
        "sample_interval",
        MatrixExpectation::Text("1 year 2 mons 3 days 04:05:06"),
    ),
    ("sample_nan", MatrixExpectation::Text("NaN")),
    ("sample_pos_inf", MatrixExpectation::Text("Infinity")),
    ("sample_neg_inf", MatrixExpectation::Text("-Infinity")),
    (
        "sample_uuid",
        MatrixExpectation::Text("550e8400-e29b-41d4-a716-446655440000"),
    ),
    (
        "sample_json",
        MatrixExpectation::Text(r#"{"a":1,"b":[true,null]}"#),
    ),
    (
        "sample_jsonb",
        MatrixExpectation::Text(r#"{"a": 1, "b": [true, null]}"#),
    ),
    ("sample_bytea", MatrixExpectation::Text(r"\x00ff10")),
    ("sample_inet", MatrixExpectation::Text("192.168.1.1/24")),
    ("sample_int4range", MatrixExpectation::Text("[1,10)")),
    ("array_with_null", MatrixExpectation::Text("{a,NULL,c}")),
    (
        "array_with_null_literal",
        MatrixExpectation::Text(r#"{a,"NULL",c}"#),
    ),
    ("sample_enum", MatrixExpectation::Text("RELEASE")),
    ("sample_domain", MatrixExpectation::Text("5")),
    ("sample_composite", MatrixExpectation::Text("(1,hi)")),
    ("sql_null", MatrixExpectation::Null),
];

fn assert_type_matrix_row(result: &QueryResultData) {
    assert_eq!(result.rows.len(), 1, "matrix query must return one row");
    let row = &result.rows[0];

    for (column, expectation) in TYPE_MATRIX {
        let index = column_index(result, column);
        let cell = &row[index];
        assert_cell_value_not_unreadable(cell);
        match expectation {
            MatrixExpectation::Text(expected) => assert_cell_value(cell, expected),
            MatrixExpectation::Null => assert_cell_null(cell),
        }
    }

    for column in ["sample_enum", "sample_domain", "sample_composite"] {
        let index = column_index(result, column);
        assert_cell_value_not_unreadable(&row[index]);
        assert!(
            matches!(row[index], ResultCell::Value { .. }),
            "{column} must render as a value"
        );
    }
}

#[tokio::test]
#[ignore = "requires live PostgreSQL — set DRAGONDB_TEST_PG_URL and run with --ignored"]
async fn type_matrix_round_trip_fidelity() {
    if skip_if_no_pg_url() {
        return;
    }

    let (client, _connection_task) = connect_from_env().await;

    let fixture = TypeMatrixFixture::new();
    fixture.setup(&client).await;

    let result = run_query(&client, &fixture.matrix_sql(), &[])
        .await
        .expect("select type matrix through transport");

    assert_type_matrix_row(&result);

    fixture.teardown(&client).await;
}

fn assert_no_result_grid(result: &QueryResultData) {
    assert!(
        result.columns.is_empty(),
        "expected no columns, got {:?}",
        result.columns
    );
    assert!(
        result.rows.is_empty(),
        "expected no rows, got {}",
        result.rows.len()
    );
}

fn assert_has_rows(result: &QueryResultData, min_rows: usize) {
    assert!(
        !result.columns.is_empty(),
        "expected a non-empty column set, got none"
    );
    assert!(
        result.rows.len() >= min_rows,
        "expected at least {min_rows} rows, got {}",
        result.rows.len()
    );
}

fn first_cell(result: &QueryResultData) -> &ResultCell {
    result
        .rows
        .first()
        .and_then(|row| row.first())
        .unwrap_or_else(|| panic!("expected at least one cell in {:?}", result.rows))
}

async fn assert_show_timezone_through_transport(client: &Client) {
    let show = run_query(client, "SHOW timezone", &[])
        .await
        .expect("SHOW timezone through transport");
    assert_has_rows(&show, 1);
}

async fn assert_explain_select_through_transport(client: &Client) {
    let explain = run_query(client, "EXPLAIN SELECT 1", &[])
        .await
        .expect("EXPLAIN SELECT 1 through transport");
    assert_has_rows(&explain, 1);
    assert!(
        explain
            .columns
            .iter()
            .any(|name| name.contains("QUERY PLAN")),
        "expected QUERY PLAN column, got {:?}",
        explain.columns
    );
}

async fn assert_explain_json_format_through_transport(client: &Client) {
    let explain_json = run_query(client, "EXPLAIN (FORMAT JSON) SELECT 1", &[])
        .await
        .expect("EXPLAIN (FORMAT JSON) SELECT 1 through transport");
    assert_has_rows(&explain_json, 1);
    let json_plan_cell = first_cell(&explain_json);
    assert_cell_value_not_unreadable(json_plan_cell);
    match json_plan_cell {
        ResultCell::Value { text } => {
            assert!(
                text.trim_start().starts_with('[') || text.contains("Plan"),
                "expected JSON plan text, got {text:?}"
            );
        }
        other => panic!("expected JSON plan value, got {other:?}"),
    }
}

async fn assert_values_through_transport(client: &Client) {
    let values = run_query(client, "VALUES (1), (2)", &[])
        .await
        .expect("VALUES (1), (2) through transport");
    assert_eq!(values.rows.len(), 2);
}

async fn assert_table_through_transport(client: &Client, table_name: &str) {
    let table = run_query(client, &format!("TABLE {}", table_name), &[])
        .await
        .expect("TABLE fixture through transport");
    assert_has_rows(&table, 2);
}

async fn assert_insert_returning_through_transport(client: &Client, table_name: &str) {
    let insert = run_query(
        client,
        &format!(
            "INSERT INTO {} (name) VALUES ('cursor-test') RETURNING *",
            table_name
        ),
        &[],
    )
    .await
    .expect("INSERT ... RETURNING * through transport");
    assert_has_rows(&insert, 1);
    let id_index = column_index(&insert, "id");
    assert_cell_value_not_unreadable(&insert.rows[0][id_index]);
    assert!(
        matches!(insert.rows[0][id_index], ResultCell::Value { .. }),
        "generated id must be a rendered value"
    );
}

async fn assert_update_without_returning_through_transport(client: &Client, table_name: &str) {
    let update = run_query(
        client,
        &format!(
            "UPDATE {} SET name = 'updated' WHERE name = 'cursor-test'",
            table_name
        ),
        &[],
    )
    .await
    .expect("UPDATE without RETURNING through transport");
    assert_no_result_grid(&update);
    assert_eq!(update.rows_affected, Some(1));
}

async fn assert_set_without_rows_through_transport(client: &Client) {
    let set = run_query(client, "SET search_path TO public", &[])
        .await
        .expect("SET search_path TO public through transport");
    assert_no_result_grid(&set);
    assert_eq!(set.rows_affected, Some(0));
}

async fn assert_char6_cursor_path_parity(client: &Client) {
    let unparameterized = run_query(client, "SELECT 'ab'::char(6) AS padded", &[])
        .await
        .expect("unparameterized char(6) through transport");
    let parameterized = run_query(
        client,
        "SELECT $1::char(6) AS padded",
        &[JsonValue::String("ab".into())],
    )
    .await
    .expect("parameterized char(6) through cursor path");
    assert_eq!(unparameterized.rows, parameterized.rows);
    assert_cell_value(&unparameterized.rows[0][0], "ab    ");
}

#[tokio::test]
#[ignore = "requires live PostgreSQL — set DRAGONDB_TEST_PG_URL and run with --ignored"]
async fn framing_and_cursor_path_fidelity() {
    if skip_if_no_pg_url() {
        return;
    }

    let (client, _connection_task) = connect_from_env().await;
    let fixture = TypeMatrixFixture::new();
    fixture.setup(&client).await;

    assert_show_timezone_through_transport(&client).await;
    assert_explain_select_through_transport(&client).await;
    assert_explain_json_format_through_transport(&client).await;
    assert_values_through_transport(&client).await;
    assert_table_through_transport(&client, &fixture.table_name).await;
    assert_insert_returning_through_transport(&client, &fixture.table_name).await;
    assert_update_without_returning_through_transport(&client, &fixture.table_name).await;
    assert_set_without_rows_through_transport(&client).await;
    assert_char6_cursor_path_parity(&client).await;

    fixture.teardown(&client).await;
}
