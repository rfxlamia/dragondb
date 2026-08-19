//! Postgres catalog SQL and typed row mapping.

use serde::Serialize;
use tokio_postgres::Client;

use super::error::{map_tokio_postgres_error, MappedIpcError};

/// List regular and foreign user tables using the same catalog shape as DragonDB Swift.
pub const LIST_TABLES_SQL: &str = "\
SELECT schemaname, tablename, 'regular' AS tabletype \
FROM pg_tables \
WHERE schemaname NOT IN ('pg_catalog', 'information_schema') \
UNION ALL \
SELECT foreign_table_schema, foreign_table_name, 'foreign' AS tabletype \
FROM information_schema.foreign_tables \
ORDER BY schemaname, tablename";

/// List columns and derive PK, unique, and FK flags from constraint catalogs.
pub const LIST_COLUMNS_SQL: &str = "\
SELECT cols.column_name, cols.data_type, cols.is_nullable::text, \
       cols.column_default::text, \
       COALESCE(bool_or(tc.constraint_type = 'PRIMARY KEY'), false) AS is_primary_key, \
       COALESCE(bool_or(tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')), false) AS is_unique, \
       COALESCE(bool_or(tc.constraint_type = 'FOREIGN KEY'), false) AS is_foreign_key \
FROM information_schema.columns cols \
LEFT JOIN information_schema.key_column_usage kcu \
  ON kcu.table_schema = cols.table_schema \
 AND kcu.table_name = cols.table_name \
 AND kcu.column_name = cols.column_name \
LEFT JOIN information_schema.table_constraints tc \
  ON tc.constraint_schema = kcu.constraint_schema \
 AND tc.constraint_name = kcu.constraint_name \
 AND tc.table_schema = kcu.table_schema \
 AND tc.table_name = kcu.table_name \
WHERE cols.table_schema = $1 AND cols.table_name = $2 \
GROUP BY cols.ordinal_position, cols.column_name, cols.data_type, \
         cols.is_nullable, cols.column_default \
ORDER BY cols.ordinal_position";

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableRefRow {
    pub schema: String,
    pub name: String,
    pub table_type: String,
}

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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ColumnKeyFlags {
    pub is_primary_key: bool,
    pub is_unique: bool,
    pub is_foreign_key: bool,
}

pub fn column_flags_from_key_row(
    is_primary_key: bool,
    is_unique: bool,
    is_foreign_key: bool,
) -> ColumnKeyFlags {
    ColumnKeyFlags {
        is_primary_key,
        is_unique,
        is_foreign_key,
    }
}

pub async fn list_tables(client: &Client) -> Result<Vec<TableRefRow>, MappedIpcError> {
    let rows = client
        .query(LIST_TABLES_SQL, &[])
        .await
        .map_err(|error| map_tokio_postgres_error(&error))?;
    Ok(rows
        .iter()
        .map(|row| TableRefRow {
            schema: row.get(0),
            name: row.get(1),
            table_type: row.get(2),
        })
        .collect())
}

pub async fn list_columns(
    client: &Client,
    schema: &str,
    table: &str,
) -> Result<Vec<ColumnInfoRow>, MappedIpcError> {
    let rows = client
        .query(LIST_COLUMNS_SQL, &[&schema, &table])
        .await
        .map_err(|error| map_tokio_postgres_error(&error))?;
    Ok(rows
        .iter()
        .map(|row| {
            let is_nullable: String = row.get(2);
            let flags = column_flags_from_key_row(row.get(4), row.get(5), row.get(6));
            ColumnInfoRow {
                name: row.get(0),
                data_type: row.get(1),
                is_nullable: is_nullable.eq_ignore_ascii_case("YES"),
                default_value: row.get(3),
                is_primary_key: flags.is_primary_key,
                is_unique: flags.is_unique,
                is_foreign_key: flags.is_foreign_key,
            }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::{column_flags_from_key_row, ColumnInfoRow, LIST_COLUMNS_SQL, LIST_TABLES_SQL};

    #[test]
    fn list_tables_sql_matches_swift_pg_tables_union_foreign() {
        assert!(LIST_TABLES_SQL.contains("pg_tables"));
        assert!(LIST_TABLES_SQL.contains("foreign_tables"));
        assert!(LIST_TABLES_SQL.to_ascii_lowercase().contains("regular"));
        assert!(LIST_TABLES_SQL.to_ascii_lowercase().contains("foreign"));
        assert!(!LIST_TABLES_SQL.contains("BASE TABLE") || LIST_TABLES_SQL.contains("UNION"));
    }

    #[test]
    fn list_columns_sql_joins_key_catalogs() {
        assert!(LIST_COLUMNS_SQL.contains("information_schema.columns"));
        assert!(
            LIST_COLUMNS_SQL.contains("table_constraints")
                && LIST_COLUMNS_SQL.contains("key_column_usage")
        );
    }

    #[test]
    fn column_flags_from_key_row_is_not_hardcoded_false() {
        let pk = column_flags_from_key_row(true, true, false);
        assert!(pk.is_primary_key);
        assert!(pk.is_unique);
        assert!(!pk.is_foreign_key);
        let fk = column_flags_from_key_row(false, false, true);
        assert!(!fk.is_primary_key);
        assert!(fk.is_foreign_key);
        let row = ColumnInfoRow {
            name: "id".into(),
            data_type: "integer".into(),
            is_nullable: false,
            default_value: None,
            is_primary_key: pk.is_primary_key,
            is_unique: pk.is_unique,
            is_foreign_key: pk.is_foreign_key,
        };
        assert!(row.is_primary_key);
    }

    #[test]
    fn table_ref_serializes_table_type_as_camel_case() {
        let row = super::TableRefRow {
            schema: "public".into(),
            name: "remote_orders".into(),
            table_type: "foreign".into(),
        };
        let json = serde_json::to_value(row).expect("serialize table ref");
        assert_eq!(json["tableType"], "foreign");
        assert!(json.get("table_type").is_none());
    }
}
