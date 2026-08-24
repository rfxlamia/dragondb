//! PostgreSQL text-protocol result mapping.

use super::{ResultCell, ResultColumn};

/// One mebibyte keeps ordinary values intact while preventing a single cell
/// from sending a tens-of-megabytes rendered payload through IPC and SQLite.
pub const MAX_CELL_BYTES: usize = 1024 * 1024;

pub const DISPLAY_CURSOR_NAME: &str = "dragondb_display_cursor";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CursorTransactionOwnership {
    CallerOwned,
    PathOwned,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CursorTransactionProbe {
    SavepointCreated,
    NoActiveTransaction,
}

pub fn cursor_ownership_from_probe(probe: CursorTransactionProbe) -> CursorTransactionOwnership {
    match probe {
        CursorTransactionProbe::SavepointCreated => CursorTransactionOwnership::CallerOwned,
        CursorTransactionProbe::NoActiveTransaction => CursorTransactionOwnership::PathOwned,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExecutionRoute {
    SimpleQuery,
    BoundCursor {
        declare_sql: String,
        fetch_sql: String,
    },
}

/// Choose text-protocol execution without ever placing parameter values in SQL.
pub fn execution_route(sql: &str, parameter_count: usize) -> ExecutionRoute {
    if parameter_count == 0 {
        ExecutionRoute::SimpleQuery
    } else {
        ExecutionRoute::BoundCursor {
            declare_sql: format!("DECLARE {DISPLAY_CURSOR_NAME} CURSOR FOR {sql}"),
            fetch_sql: format!("FETCH ALL FROM {DISPLAY_CURSOR_NAME}"),
        }
    }
}

/// Build R4.4 fallback metadata from protocol row-description names.
pub fn fallback_protocol_columns<'a>(names: impl IntoIterator<Item = &'a str>) -> Vec<TextColumn> {
    names
        .into_iter()
        .map(|name| TextColumn::new(name, "unknown", 0))
        .collect()
}

/// Column information acquired from the prepared statement or row description.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextColumn {
    pub name: String,
    pub type_name: String,
    pub type_oid: u32,
}

impl TextColumn {
    pub fn new(name: impl Into<String>, type_name: impl Into<String>, type_oid: u32) -> Self {
        Self {
            name: name.into(),
            type_name: type_name.into(),
            type_oid,
        }
    }
}

/// Map one text-protocol row and its index-aligned metadata into the IPC shape.
pub fn map_text_row(
    values: &[Option<&[u8]>],
    columns: &[TextColumn],
) -> (Vec<ResultCell>, Vec<ResultColumn>) {
    assert_eq!(
        values.len(),
        columns.len(),
        "text values and column metadata must be index-aligned"
    );

    let cells = values
        .iter()
        .zip(columns)
        .map(|(value, column)| map_cell(*value, column))
        .collect();
    let result_columns = columns
        .iter()
        .map(|column| ResultColumn {
            name: column.name.clone(),
            type_name: column.type_name.clone(),
            type_oid: column.type_oid,
        })
        .collect();

    (cells, result_columns)
}

pub(crate) fn map_cell(value: Option<&[u8]>, column: &TextColumn) -> ResultCell {
    let Some(bytes) = value else {
        return ResultCell::Null;
    };
    let Ok(text) = std::str::from_utf8(bytes) else {
        return ResultCell::Unreadable {
            type_name: column.type_name.clone(),
        };
    };

    if bytes.len() > MAX_CELL_BYTES {
        let mut end = MAX_CELL_BYTES;
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        return ResultCell::Truncated {
            text: text[..end].to_string(),
        };
    }

    let text = if column.type_oid == 16 {
        match text {
            "t" => "true",
            "f" => "false",
            value => value,
        }
    } else {
        text
    };
    ResultCell::Value {
        text: text.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_rows_map_to_four_states_with_aligned_metadata() {
        let oversized = "x".repeat(MAX_CELL_BYTES + 1);
        let columns = vec![
            TextColumn::new("padded", "bpchar", 1042),
            TextColumn::new("missing", "text", 25),
            TextColumn::new("binary", "custom", 99_999),
            TextColumn::new("large", "text", 25),
            TextColumn::new("enabled", "bool", 16),
            TextColumn::new("disabled", "bool", 16),
        ];
        let values = vec![
            Some(b"ab    ".as_slice()),
            None,
            Some(b"\xff".as_slice()),
            Some(oversized.as_bytes()),
            Some(b"t".as_slice()),
            Some(b"f".as_slice()),
        ];

        let (cells, mapped_columns) = map_text_row(&values, &columns);

        assert_eq!(cells[0], value("ab    "));
        assert_eq!(cells[1], ResultCell::Null);
        assert_eq!(
            cells[2],
            ResultCell::Unreadable {
                type_name: "custom".into()
            }
        );
        assert_eq!(cells[3], truncated("x".repeat(MAX_CELL_BYTES)));
        assert_eq!(cells[4], value("true"));
        assert_eq!(cells[5], value("false"));
        for (actual, expected) in mapped_columns.iter().zip(&columns) {
            assert_eq!(actual.name, expected.name);
            assert_eq!(actual.type_name, expected.type_name);
            assert_eq!(actual.type_oid, expected.type_oid);
        }
    }

    #[test]
    fn execution_routing_keeps_parameter_values_out_of_sql() {
        let sql = "SELECT $1::text";
        let secret_parameter = "do-not-inline-me";

        assert_eq!(execution_route("SELECT 1", 0), ExecutionRoute::SimpleQuery);
        let route = execution_route(sql, 1);
        let ExecutionRoute::BoundCursor {
            declare_sql,
            fetch_sql,
        } = route
        else {
            panic!("parameterized statements must use the bound cursor path");
        };
        assert!(declare_sql.contains(sql));
        assert!(!declare_sql.contains(secret_parameter));
        assert_eq!(fetch_sql, "FETCH ALL FROM dragondb_display_cursor");
    }

    #[test]
    fn prepare_failure_uses_unknown_protocol_columns() {
        let columns = fallback_protocol_columns(["first", "second"]);

        assert_eq!(
            columns,
            vec![
                TextColumn::new("first", "unknown", 0),
                TextColumn::new("second", "unknown", 0),
            ]
        );
    }

    fn value(text: &str) -> ResultCell {
        ResultCell::Value { text: text.into() }
    }

    fn truncated(text: String) -> ResultCell {
        ResultCell::Truncated { text }
    }
}
