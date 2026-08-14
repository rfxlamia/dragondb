//! Row update/delete operations with typed `RowOperationError` kinds.
//!
//! Preconditions are pure; SQL mutation runs against a live tokio-postgres client.

use std::collections::HashMap;

use serde::Serialize;
use serde_json::{Map, Value};
use tokio_postgres::types::ToSql;
use tokio_postgres::Client;

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
/// Cheap input checks (empty PK map / empty table) should run before the
/// metadata round-trip. Production callers pass `Some((schema, table))`;
/// empty table names are rejected in `session/mod.rs` as `NoTableSelected`.
///
/// Check order inside this helper: empty PK columns → `NoPrimaryKey`; missing
/// table → `NoTableSelected`; no row selected → `NoRowsSelected`.
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

struct IdentType {
    name: String,
    udt_name: String,
}

const PK_COLUMNS_SQL: &str = "\
SELECT kcu.column_name, cols.udt_name \
FROM information_schema.table_constraints tc \
JOIN information_schema.key_column_usage kcu \
  ON tc.constraint_name = kcu.constraint_name \
 AND tc.table_schema = kcu.table_schema \
 AND tc.table_name = kcu.table_name \
JOIN information_schema.columns cols \
  ON cols.table_schema = kcu.table_schema \
 AND cols.table_name = kcu.table_name \
 AND cols.column_name = kcu.column_name \
WHERE tc.constraint_type = 'PRIMARY KEY' \
  AND tc.table_schema = $1 \
  AND tc.table_name = $2 \
ORDER BY kcu.ordinal_position";

const COLUMN_TYPES_SQL: &str = "\
SELECT column_name, udt_name \
FROM information_schema.columns \
WHERE table_schema = $1 AND table_name = $2";

fn metadata_err(e: impl std::fmt::Display) -> RowOperationError {
    RowOperationError::new(
        RowOperationErrorKind::MetadataFetchFailed,
        format!("Failed to fetch primary key metadata: {e}"),
    )
}

async fn fetch_pk_idents(
    client: &Client,
    schema: &str,
    table: &str,
) -> Result<Vec<IdentType>, RowOperationError> {
    let rows = client
        .query(PK_COLUMNS_SQL, &[&schema, &table])
        .await
        .map_err(metadata_err)?;
    let mut out = Vec::with_capacity(rows.len());
    for row in &rows {
        let name = row.try_get::<_, String>(0).map_err(metadata_err)?;
        let udt_name = row.try_get::<_, String>(1).map_err(metadata_err)?;
        out.push(IdentType { name, udt_name });
    }
    Ok(out)
}

/// Fetch primary-key column names for a table.
pub async fn fetch_primary_key_columns(
    client: &Client,
    schema: &str,
    table: &str,
) -> Result<Vec<String>, RowOperationError> {
    Ok(fetch_pk_idents(client, schema, table)
        .await?
        .into_iter()
        .map(|c| c.name)
        .collect())
}

async fn fetch_column_types(
    client: &Client,
    schema: &str,
    table: &str,
) -> Result<HashMap<String, String>, RowOperationError> {
    let rows = client
        .query(COLUMN_TYPES_SQL, &[&schema, &table])
        .await
        .map_err(metadata_err)?;
    let mut map = HashMap::with_capacity(rows.len());
    for row in &rows {
        let name = row.try_get::<_, String>(0).map_err(metadata_err)?;
        let udt_name = row.try_get::<_, String>(1).map_err(metadata_err)?;
        map.insert(name, udt_name);
    }
    Ok(map)
}

fn json_to_text_sql(
    value: &Value,
    fail_kind: RowOperationErrorKind,
) -> Result<Box<dyn ToSql + Sync + Send>, RowOperationError> {
    match value {
        Value::Null => Ok(Box::new(Option::<String>::None)),
        Value::Bool(b) => Ok(Box::new(b.to_string())),
        Value::Number(n) => Ok(Box::new(n.to_string())),
        Value::String(s) => Ok(Box::new(s.clone())),
        Value::Array(_) | Value::Object(_) => Err(RowOperationError::new(
            fail_kind,
            "Unsupported JSON value for row operation parameter.",
        )),
    }
}

fn json_values_as_text(
    values: &[Value],
    fail_kind: RowOperationErrorKind,
) -> Result<Vec<Box<dyn ToSql + Sync + Send>>, RowOperationError> {
    values.iter().map(|v| json_to_text_sql(v, fail_kind)).collect()
}

fn typed_eq(column: &str, udt_name: &str, param: usize) -> String {
    format!(
        "{} = ${}::{}",
        quote_ident(column),
        param,
        quote_ident(udt_name)
    )
}

fn build_where_clause(
    pk_columns: &[IdentType],
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
        let Some(val) = primary_key.get(&col.name) else {
            return Err(RowOperationError::new(
                missing_kind,
                format!("Primary key column '{}' missing from input.", col.name),
            ));
        };
        parts.push(typed_eq(&col.name, &col.udt_name, start_param + i));
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
    if primary_key.is_empty() {
        return Err(RowOperationError::new(
            RowOperationErrorKind::NoRowsSelected,
            "No row selected for update.",
        ));
    }
    if patch.is_empty() {
        return Ok(());
    }

    let pk_columns = fetch_pk_idents(client, schema, table).await?;
    validate_update_preconditions(
        Some((schema, table)),
        &pk_columns.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(),
        true,
    )?;

    let column_types = fetch_column_types(client, schema, table).await?;
    let mut set_parts = Vec::with_capacity(patch.len());
    let mut params: Vec<Value> = Vec::with_capacity(patch.len() + primary_key.len());
    for (col, val) in patch.iter() {
        let Some(udt) = column_types.get(col) else {
            return Err(RowOperationError::new(
                RowOperationErrorKind::UpdateFailed,
                format!("Unknown column '{col}' in patch."),
            ));
        };
        set_parts.push(typed_eq(col, udt, params.len() + 1));
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

    let owned = json_values_as_text(&params, RowOperationErrorKind::UpdateFailed)?;
    let binds: Vec<&(dyn ToSql + Sync)> = owned
        .iter()
        .map(|p| p.as_ref() as &(dyn ToSql + Sync))
        .collect();

    let affected = client.execute(&sql, &binds).await.map_err(|e| {
        RowOperationError::new(
            RowOperationErrorKind::UpdateFailed,
            format!("Failed to update row: {e}"),
        )
    })?;
    if affected == 0 {
        return Err(RowOperationError::new(
            RowOperationErrorKind::UpdateFailed,
            "No matching row to update.",
        ));
    }
    Ok(())
}

/// DELETE rows identified by primary key value maps.
pub async fn delete_rows(
    client: &Client,
    schema: &str,
    table: &str,
    primary_keys: &[Map<String, Value>],
) -> Result<(), RowOperationError> {
    if primary_keys.is_empty() {
        return Err(RowOperationError::new(
            RowOperationErrorKind::NoRowsSelected,
            "No rows selected for delete.",
        ));
    }

    let pk_columns = fetch_pk_idents(client, schema, table).await?;
    validate_delete_preconditions(
        Some((schema, table)),
        &pk_columns.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(),
        primary_keys,
    )?;

    let mut or_parts = Vec::with_capacity(primary_keys.len());
    let mut params = Vec::new();
    for pk in primary_keys {
        let (where_sql, where_params) = build_where_clause(
            &pk_columns,
            pk,
            params.len() + 1,
            RowOperationErrorKind::DeleteFailed,
        )?;
        or_parts.push(format!("({where_sql})"));
        params.extend(where_params);
    }

    let sql = format!(
        "DELETE FROM {} WHERE {}",
        qualified_table(schema, table),
        or_parts.join(" OR ")
    );
    let owned = json_values_as_text(&params, RowOperationErrorKind::DeleteFailed)?;
    let binds: Vec<&(dyn ToSql + Sync)> = owned
        .iter()
        .map(|p| p.as_ref() as &(dyn ToSql + Sync))
        .collect();
    let affected = client.execute(&sql, &binds).await.map_err(|e| {
        RowOperationError::new(
            RowOperationErrorKind::DeleteFailed,
            format!("Failed to delete row: {e}"),
        )
    })?;
    let expected = primary_keys.len() as u64;
    if affected != expected {
        return Err(RowOperationError::new(
            RowOperationErrorKind::DeleteFailed,
            format!("Delete matched {affected} of {expected} selected rows."),
        ));
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

    #[test]
    fn where_clause_casts_pk_to_udt_name() {
        let pk_columns = [IdentType {
            name: "id".into(),
            udt_name: "int4".into(),
        }];
        let mut primary_key = Map::new();
        primary_key.insert("id".into(), Value::from(1));
        let (sql, params) = build_where_clause(
            &pk_columns,
            &primary_key,
            2,
            RowOperationErrorKind::UpdateFailed,
        )
        .unwrap();
        assert_eq!(sql, "\"id\" = $2::\"int4\"");
        assert_eq!(params.len(), 1);
    }
}
