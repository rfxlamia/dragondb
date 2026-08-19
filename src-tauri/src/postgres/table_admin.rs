//! Dedicated table administration SQL and Postgres execution.

use tokio_postgres::Client;

use super::{map_tokio_postgres_error, IpcErrorKind, MappedIpcError};

fn quote_identifier(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

pub fn truncate_table_sql(schema: &str, table: &str) -> String {
    format!(
        "TRUNCATE TABLE {}.{}",
        quote_identifier(schema),
        quote_identifier(table)
    )
}

pub fn drop_table_sql(schema: &str, table: &str, table_type: Option<&str>) -> String {
    let command = if table_type == Some("foreign") {
        "DROP FOREIGN TABLE"
    } else {
        "DROP TABLE"
    };
    format!(
        "{} {}.{}",
        command,
        quote_identifier(schema),
        quote_identifier(table)
    )
}

pub fn generate_table_ddl_sql(schema: &str, table: &str) -> String {
    let schema_literal = schema.replace('\'', "''");
    let table_literal = table.replace('\'', "''");
    format!(
        "SELECT \
(EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '{schema}' AND table_name = '{table}') \
OR EXISTS (SELECT 1 FROM information_schema.foreign_tables WHERE foreign_table_schema = '{schema}' AND foreign_table_name = '{table}')) AS found, \
'CREATE TABLE {quoted} (' || string_agg(format('%I %s%s', column_name, data_type, CASE WHEN is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END), ', ' ORDER BY ordinal_position) || ')' \
FROM information_schema.columns WHERE table_schema = '{schema}' AND table_name = '{table}'",
        schema = schema_literal,
        table = table_literal,
        quoted = format!("{}.{}", quote_identifier(schema), quote_identifier(table)),
    )
}

pub fn set_search_path_sql(schema: Option<&str>) -> String {
    match schema {
        Some(schema) => format!("SET search_path TO {}, public", quote_identifier(schema)),
        None => "SET search_path TO public".into(),
    }
}

pub async fn truncate_table(
    client: &Client,
    schema: &str,
    table: &str,
) -> Result<(), MappedIpcError> {
    client
        .batch_execute(&truncate_table_sql(schema, table))
        .await
        .map_err(|e| map_tokio_postgres_error(&e))
}

pub async fn drop_table(
    client: &Client,
    schema: &str,
    table: &str,
    table_type: Option<&str>,
) -> Result<(), MappedIpcError> {
    client
        .batch_execute(&drop_table_sql(schema, table, table_type))
        .await
        .map_err(|e| map_tokio_postgres_error(&e))
}

pub async fn generate_table_ddl(
    client: &Client,
    schema: &str,
    table: &str,
) -> Result<String, MappedIpcError> {
    let row = client
        .query_one(&generate_table_ddl_sql(schema, table), &[])
        .await
        .map_err(|e| map_tokio_postgres_error(&e))?;
    let found: bool = row.try_get(0).map_err(|e| map_tokio_postgres_error(&e))?;
    let ddl: Option<String> = row.try_get(1).map_err(|e| map_tokio_postgres_error(&e))?;
    if !found {
        return Err(MappedIpcError {
            kind: IpcErrorKind::Unknown,
            message: "Table not found.".into(),
            position: None,
        });
    }
    Ok(ddl.unwrap_or_else(|| {
        format!(
            "CREATE TABLE {}.{} ()",
            quote_identifier(schema),
            quote_identifier(table)
        )
    }))
}

pub async fn set_search_path(client: &Client, schema: Option<&str>) -> Result<(), MappedIpcError> {
    client
        .batch_execute(&set_search_path_sql(schema))
        .await
        .map_err(|e| map_tokio_postgres_error(&e))
}

#[cfg(test)]
mod tests {
    use super::{drop_table_sql, generate_table_ddl_sql, set_search_path_sql, truncate_table_sql};

    #[test]
    fn truncate_and_drop_sql_quote_schema_and_table() {
        assert_eq!(
            truncate_table_sql("public", "temp"),
            r#"TRUNCATE TABLE "public"."temp""#
        );
        assert_eq!(
            drop_table_sql("public", "temp", None),
            r#"DROP TABLE "public"."temp""#
        );
        assert_eq!(
            drop_table_sql("public", "remote_orders", Some("foreign")),
            r#"DROP FOREIGN TABLE "public"."remote_orders""#
        );
        assert!(!truncate_table_sql("public", "temp").contains("public.temp"));
    }

    #[test]
    fn set_search_path_named_vs_all_schemas() {
        assert_eq!(
            set_search_path_sql(Some("audit")),
            r#"SET search_path TO "audit", public"#
        );
        assert_eq!(set_search_path_sql(None), "SET search_path TO public");
    }

    #[test]
    fn generate_table_ddl_sql_targets_quoted_table() {
        let sql = generate_table_ddl_sql("public", "orders");
        assert!(sql.contains("\"public\""));
        assert!(sql.contains("\"orders\""));
        assert!(sql.contains("EXISTS"));
        assert!(sql.contains("found"));
    }
}
