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

pub fn maintenance_database(target: &str) -> &str {
    if target.eq_ignore_ascii_case("postgres") {
        "template1"
    } else {
        "postgres"
    }
}

pub fn set_session_database_name(name: &str) -> &str {
    name
}

pub fn list_databases_sql() -> &'static str {
    // datallowconn is a cluster-wide flag, so it still returns databases this
    // role cannot open, and it leaves template1 in the list — both would show up
    // as selectable and deletable catalog entries.
    "SELECT datname FROM pg_database \
     WHERE datallowconn AND NOT datistemplate \
       AND has_database_privilege(datname, 'CONNECT') \
     ORDER BY datname"
}

pub async fn list_databases(client: &Client) -> Result<Vec<String>, MappedIpcError> {
    let rows = client
        .query(list_databases_sql(), &[])
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
        create_database_sql, drop_database_sql, list_databases_sql, maintenance_database,
        set_session_database_name,
    };

    #[test]
    fn list_databases_sql_excludes_templates_and_unconnectable_databases() {
        let sql = list_databases_sql();
        assert!(
            sql.contains("datistemplate"),
            "template databases must not be offered as pickable catalog entries: {sql}"
        );
        assert!(
            sql.contains("has_database_privilege"),
            "datallowconn is cluster-wide; the picker must also require CONNECT: {sql}"
        );
        assert!(sql.contains("datallowconn"), "{sql}");
        assert!(sql.contains("ORDER BY datname"), "{sql}");
    }

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
        // When dropping "postgres" itself, maintenance must be a DIFFERENT database
        assert_ne!(
            maintenance_database("postgres"),
            "postgres",
            "Cannot use 'postgres' as maintenance DB when dropping 'postgres' — \
             the active connection would prevent DROP DATABASE"
        );
    }

    #[test]
    fn switch_helper_returns_database_name_without_profile_rewrite() {
        assert_eq!(set_session_database_name("shop"), "shop");
    }
}
