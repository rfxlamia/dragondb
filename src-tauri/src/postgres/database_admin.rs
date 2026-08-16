//! Dedicated database administration helpers.

use tokio_postgres::Client;

use super::{map_tokio_postgres_error, MappedIpcError};

pub fn quote_identifier(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

pub fn create_database_sql(name: &str) -> String {
    format!("CREATE DATABASE {}", quote_identifier(name))
}

pub fn drop_database_sql(name: &str) -> String {
    format!("DROP DATABASE {}", quote_identifier(name))
}

pub fn maintenance_database(_current: &str) -> &str {
    "postgres"
}

pub fn set_session_database_name(name: &str) -> &str {
    name
}

pub async fn list_databases(client: &Client) -> Result<Vec<String>, MappedIpcError> {
    let rows = client
        .query(
            "SELECT datname FROM pg_database WHERE datallowconn ORDER BY datname",
            &[],
        )
        .await
        .map_err(|error| map_tokio_postgres_error(&error))?;
    Ok(rows.into_iter().map(|row| row.get(0)).collect())
}

pub async fn create_database(client: &Client, name: &str) -> Result<(), MappedIpcError> {
    client
        .batch_execute(&create_database_sql(name))
        .await
        .map_err(|error| map_tokio_postgres_error(&error))
}

pub async fn drop_database(client: &Client, name: &str) -> Result<(), MappedIpcError> {
    client
        .batch_execute(&drop_database_sql(name))
        .await
        .map_err(|error| map_tokio_postgres_error(&error))
}

#[cfg(test)]
mod tests {
    use super::{
        create_database_sql, drop_database_sql, maintenance_database, set_session_database_name,
    };

    #[test]
    fn create_database_sql_quotes_and_is_not_transactional() {
        let sql = create_database_sql("shop");
        assert_eq!(sql, r#"CREATE DATABASE "shop""#);
        assert!(!sql.to_uppercase().contains("BEGIN"));
        assert!(!sql.to_uppercase().contains("COMMIT"));
    }

    #[test]
    fn drop_database_sql_quotes_identifier() {
        assert_eq!(drop_database_sql("shop"), r#"DROP DATABASE "shop""#);
    }

    #[test]
    fn quotes_embedded_identifier_delimiters() {
        assert_eq!(
            create_database_sql("shop\"two"),
            r#"CREATE DATABASE "shop""two""#
        );
    }

    #[test]
    fn maintenance_database_is_postgres_unless_already_on_postgres() {
        assert_eq!(maintenance_database("shop"), "postgres");
        assert_eq!(maintenance_database("postgres"), "postgres");
    }

    #[test]
    fn switch_helper_returns_database_name_without_profile_rewrite() {
        assert_eq!(set_session_database_name("shop"), "shop");
    }
}
