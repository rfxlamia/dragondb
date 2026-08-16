//! Dedicated table administration SQL and Postgres execution.

use tokio_postgres::Client;

use super::{map_tokio_postgres_error, MappedIpcError};

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

pub fn drop_table_sql(schema: &str, table: &str) -> String {
    format!(
        "DROP TABLE {}.{}",
        quote_identifier(schema),
        quote_identifier(table)
    )
}

pub fn generate_table_ddl_sql(schema: &str, table: &str) -> String {
    let schema_literal = schema.replace('\'', "''");
    let table_literal = table.replace('\'', "''");
    format!(
        "SELECT 'CREATE TABLE {}.{} (' || string_agg(format('%I %s%s', column_name, data_type, CASE WHEN is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END), ', ' ORDER BY ordinal_position) || ')' FROM information_schema.columns WHERE table_schema = '{}' AND table_name = '{}'",
        quote_identifier(schema), quote_identifier(table), schema_literal, table_literal
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

pub async fn drop_table(client: &Client, schema: &str, table: &str) -> Result<(), MappedIpcError> {
    client
        .batch_execute(&drop_table_sql(schema, table))
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
    Ok(row.get(0))
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
            drop_table_sql("public", "temp"),
            r#"DROP TABLE "public"."temp""#
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
    }
}
