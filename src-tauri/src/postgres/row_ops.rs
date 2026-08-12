//! Row update/delete operations with typed `RowOperationError` kinds.
//!
//! Preconditions are pure; SQL mutation runs against a live tokio-postgres client.

use serde::Serialize;
use serde_json::{Map, Value};
use tokio_postgres::types::ToSql;
use tokio_postgres::Client;

use super::query::json_params_to_owned;

/// Six RowOperationError kinds — camelCase on the wire (mirrors `src/ipc/contract.ts`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RowOperationErrorKind {
    NoPrimaryKey,
    NoTableSelected,
    NoRowsSelected,
    MetadataFetchFailed,
    UpdateFailed,
    DeleteFailed,
}

/// Serializable row-op error payload for Tauri invoke rejection.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RowOperationError {
    pub kind: RowOperationErrorKind,
    pub message: String,
}

impl RowOperationError {
    pub fn new(kind: RowOperationErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }
}

/// Validate update preconditions before SQL.
///
/// Check order: empty PK columns → `NoPrimaryKey`; missing table → `NoTableSelected`;
/// no row selected → `NoRowsSelected`.
pub fn validate_update_preconditions(
    table: Option<(&str, &str)>,
    primary_key: &[&str],
    rows_selected: bool,
) -> Result<(), RowOperationError> {
    if primary_key.is_empty() {
        return Err(RowOperationError::new(
            RowOperationErrorKind::NoPrimaryKey,
            "Table has no primary key; row updates require a primary key.",
        ));
    }
    if table.is_none() {
        return Err(RowOperationError::new(
            RowOperationErrorKind::NoTableSelected,
            "No table selected for row update.",
        ));
    }
    if !rows_selected {
        return Err(RowOperationError::new(
            RowOperationErrorKind::NoRowsSelected,
            "No row selected for update.",
        ));
    }
    Ok(())
}

/// Validate delete preconditions before SQL.
///
/// Check order: empty PK columns → `NoPrimaryKey`; missing table → `NoTableSelected`;
/// empty selected PK value maps → `NoRowsSelected`.
pub fn validate_delete_preconditions(
    table: Option<(&str, &str)>,
    primary_key: &[&str],
    primary_keys: &[Map<String, Value>],
) -> Result<(), RowOperationError> {
    if primary_key.is_empty() {
        return Err(RowOperationError::new(
            RowOperationErrorKind::NoPrimaryKey,
            "Table has no primary key; row deletes require a primary key.",
        ));
    }
    if table.is_none() {
        return Err(RowOperationError::new(
            RowOperationErrorKind::NoTableSelected,
            "No table selected for row delete.",
        ));
    }
    if primary_keys.is_empty() {
        return Err(RowOperationError::new(
            RowOperationErrorKind::NoRowsSelected,
            "No rows selected for delete.",
        ));
    }
    Ok(())
}

fn quote_ident(ident: &str) -> String {
    format!("\"{}\"", ident.replace('"', "\"\""))
}

fn qualified_table(schema: &str, table: &str) -> String {
    format!("{}.{}", quote_ident(schema), quote_ident(table))
}

const PK_COLUMNS_SQL: &str = "\
SELECT kcu.column_name \
FROM information_schema.table_constraints tc \
JOIN information_schema.key_column_usage kcu \
  ON tc.constraint_name = kcu.constraint_name \
 AND tc.table_schema = kcu.table_schema \
 AND tc.table_name = kcu.table_name \
WHERE tc.constraint_type = 'PRIMARY KEY' \
  AND tc.table_schema = $1 \
  AND tc.table_name = $2 \
ORDER BY kcu.ordinal_position";

/// Fetch primary-key column names for a table.
pub async fn fetch_primary_key_columns(
    client: &Client,
    schema: &str,
    table: &str,
) -> Result<Vec<String>, RowOperationError> {
    let rows = client
        .query(PK_COLUMNS_SQL, &[&schema, &table])
        .await
        .map_err(|e| {
            RowOperationError::new(
                RowOperationErrorKind::MetadataFetchFailed,
                format!("Failed to fetch primary key metadata: {e}"),
            )
        })?;
    Ok(rows.iter().map(|row| row.get::<_, String>(0)).collect())
}

fn json_value_params(
    values: impl IntoIterator<Item = Value>,
) -> Result<Vec<Box<dyn ToSql + Sync + Send>>, RowOperationError> {
    let owned: Vec<Value> = values.into_iter().collect();
    json_params_to_owned(&owned).map_err(|e| {
        RowOperationError::new(
            RowOperationErrorKind::UpdateFailed,
            e.message,
        )
    })
}

fn build_where_clause(
    pk_columns: &[String],
    primary_key: &Map<String, Value>,
    start_param: usize,
    missing_kind: RowOperationErrorKind,
) -> Result<(String, Vec<Value>), RowOperationError> {
    if pk_columns.is_empty() {
        return Err(RowOperationError::new(
            RowOperationErrorKind::NoPrimaryKey,
            "Table has no primary key; row operations require a primary key.",
        ));
    }
    let mut parts = Vec::with_capacity(pk_columns.len());
    let mut params = Vec::with_capacity(pk_columns.len());
    for (i, col) in pk_columns.iter().enumerate() {
        let Some(val) = primary_key.get(col) else {
            return Err(RowOperationError::new(
                missing_kind,
                format!("Primary key column '{col}' missing from input."),
            ));
        };
        parts.push(format!("{} = ${}", quote_ident(col), start_param + i));
        params.push(val.clone());
    }
    Ok((parts.join(" AND "), params))
}

/// UPDATE one row identified by primary key values; patch nulls become SQL NULL.
pub async fn update_row(
    client: &Client,
    schema: &str,
    table: &str,
    primary_key: &Map<String, Value>,
    patch: &Map<String, Value>,
) -> Result<(), RowOperationError> {
    let pk_columns = fetch_primary_key_columns(client, schema, table).await?;
    validate_update_preconditions(
        Some((schema, table)),
        &pk_columns.iter().map(String::as_str).collect::<Vec<_>>(),
        !primary_key.is_empty(),
    )?;

    if patch.is_empty() {
        return Ok(());
    }

    let mut set_parts = Vec::with_capacity(patch.len());
    let mut params: Vec<Value> = Vec::with_capacity(patch.len() + primary_key.len());
    for (i, (col, val)) in patch.iter().enumerate() {
        set_parts.push(format!("{} = ${}", quote_ident(col), i + 1));
        params.push(val.clone());
    }
    let (where_sql, where_params) = build_where_clause(
        &pk_columns,
        primary_key,
        params.len() + 1,
        RowOperationErrorKind::UpdateFailed,
    )?;
    params.extend(where_params);

    let sql = format!(
        "UPDATE {} SET {} WHERE {}",
        qualified_table(schema, table),
        set_parts.join(", "),
        where_sql
    );

    let owned = json_value_params(params).map_err(|mut e| {
        e.kind = RowOperationErrorKind::UpdateFailed;
        e
    })?;
    let binds: Vec<&(dyn ToSql + Sync)> = owned
        .iter()
        .map(|p| p.as_ref() as &(dyn ToSql + Sync))
        .collect();

    client.execute(&sql, &binds).await.map_err(|e| {
        RowOperationError::new(
            RowOperationErrorKind::UpdateFailed,
            format!("Failed to update row: {e}"),
        )
    })?;
    Ok(())
}

/// DELETE rows identified by primary key value maps.
pub async fn delete_rows(
    client: &Client,
    schema: &str,
    table: &str,
    primary_keys: &[Map<String, Value>],
) -> Result<(), RowOperationError> {
    let pk_columns = fetch_primary_key_columns(client, schema, table).await?;
    validate_delete_preconditions(
        Some((schema, table)),
        &pk_columns.iter().map(String::as_str).collect::<Vec<_>>(),
        primary_keys,
    )?;

    for pk in primary_keys {
        let (where_sql, where_params) = build_where_clause(
            &pk_columns,
            pk,
            1,
            RowOperationErrorKind::DeleteFailed,
        )?;
        let sql = format!(
            "DELETE FROM {} WHERE {}",
            qualified_table(schema, table),
            where_sql
        );
        let owned = json_params_to_owned(&where_params).map_err(|e| {
            RowOperationError::new(RowOperationErrorKind::DeleteFailed, e.message)
        })?;
        let binds: Vec<&(dyn ToSql + Sync)> = owned
            .iter()
            .map(|p| p.as_ref() as &(dyn ToSql + Sync))
            .collect();
        client.execute(&sql, &binds).await.map_err(|e| {
            RowOperationError::new(
                RowOperationErrorKind::DeleteFailed,
                format!("Failed to delete row: {e}"),
            )
        })?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_update_without_primary_key() {
        let err = validate_update_preconditions(
            /* table */ None,
            /* primary_key */ &[],
            /* rows_selected */ true,
        )
        .expect_err("must reject");
        assert_eq!(err.kind, RowOperationErrorKind::NoPrimaryKey);
    }

    #[test]
    fn rejects_when_no_table_selected() {
        let err = validate_update_preconditions(None, &["id"], true).expect_err("must reject");
        assert_eq!(err.kind, RowOperationErrorKind::NoTableSelected);
    }

    #[test]
    fn rejects_delete_with_no_rows_selected() {
        let empty_keys: &[Map<String, Value>] = &[];
        let err = validate_delete_preconditions(
            Some(("public", "users")),
            &["id"],
            /* primary_keys */ empty_keys,
        )
        .expect_err("must reject");
        assert_eq!(err.kind, RowOperationErrorKind::NoRowsSelected);
    }

    #[test]
    fn all_six_kinds_are_serializable_camel_case() {
        for kind in [
            RowOperationErrorKind::NoPrimaryKey,
            RowOperationErrorKind::NoTableSelected,
            RowOperationErrorKind::NoRowsSelected,
            RowOperationErrorKind::MetadataFetchFailed,
            RowOperationErrorKind::UpdateFailed,
            RowOperationErrorKind::DeleteFailed,
        ] {
            let v = serde_json::to_value(RowOperationError {
                kind,
                message: "x".into(),
            })
            .unwrap();
            assert!(v["kind"].is_string());
            assert_eq!(v["message"], "x");
        }
        assert_eq!(
            serde_json::to_value(RowOperationErrorKind::NoPrimaryKey).unwrap(),
            "noPrimaryKey"
        );
        assert_eq!(
            serde_json::to_value(RowOperationErrorKind::NoTableSelected).unwrap(),
            "noTableSelected"
        );
        assert_eq!(
            serde_json::to_value(RowOperationErrorKind::NoRowsSelected).unwrap(),
            "noRowsSelected"
        );
        assert_eq!(
            serde_json::to_value(RowOperationErrorKind::MetadataFetchFailed).unwrap(),
            "metadataFetchFailed"
        );
        assert_eq!(
            serde_json::to_value(RowOperationErrorKind::UpdateFailed).unwrap(),
            "updateFailed"
        );
        assert_eq!(
            serde_json::to_value(RowOperationErrorKind::DeleteFailed).unwrap(),
            "deleteFailed"
        );
    }
}
