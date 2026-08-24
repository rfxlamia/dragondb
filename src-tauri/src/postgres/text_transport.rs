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

impl CursorTransactionOwnership {
    pub(crate) fn begin_command(self) -> Option<&'static str> {
        (self == Self::PathOwned).then_some("BEGIN")
    }

    pub(crate) fn commit_command(self) -> Option<&'static str> {
        (self == Self::PathOwned).then_some("COMMIT")
    }

    pub(crate) fn rollback_command(self) -> Option<&'static str> {
        (self == Self::PathOwned).then_some("ROLLBACK")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CursorFailure {
    Declare,
    Fetch,
    Close,
    Commit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CursorStep {
    Begin,
    Declare,
    Fetch,
    Close,
    Commit,
    Rollback,
}

pub fn cursor_success_steps(ownership: CursorTransactionOwnership) -> Vec<CursorStep> {
    let mut steps = Vec::new();
    if ownership.begin_command().is_some() {
        steps.push(CursorStep::Begin);
    }
    steps.extend([CursorStep::Declare, CursorStep::Fetch, CursorStep::Close]);
    if ownership.commit_command().is_some() {
        steps.push(CursorStep::Commit);
    }
    steps
}

pub fn cursor_failure_steps(
    ownership: CursorTransactionOwnership,
    failure: CursorFailure,
) -> Vec<CursorStep> {
    let mut steps = Vec::new();
    if ownership.begin_command().is_some() {
        steps.push(CursorStep::Begin);
    }
    steps.push(CursorStep::Declare);
    if failure != CursorFailure::Declare {
        steps.push(CursorStep::Fetch);
    }
    if matches!(failure, CursorFailure::Close | CursorFailure::Commit) {
        steps.push(CursorStep::Close);
    }
    if failure == CursorFailure::Commit && ownership.commit_command().is_some() {
        steps.push(CursorStep::Commit);
    }
    if ownership.rollback_command().is_some() {
        steps.push(CursorStep::Rollback);
    }
    steps
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

        assert_eq!(
            cells,
            vec![
                ResultCell::Value {
                    text: "ab    ".into()
                },
                ResultCell::Null,
                ResultCell::Unreadable {
                    type_name: "custom".into()
                },
                ResultCell::Truncated {
                    text: "x".repeat(MAX_CELL_BYTES)
                },
                ResultCell::Value {
                    text: "true".into()
                },
                ResultCell::Value {
                    text: "false".into()
                },
            ]
        );
        assert_eq!(cells[3].text_len(), Some(MAX_CELL_BYTES));
        assert_eq!(
            mapped_columns,
            vec![
                ResultColumn {
                    name: "padded".into(),
                    type_name: "bpchar".into(),
                    type_oid: 1042,
                },
                ResultColumn {
                    name: "missing".into(),
                    type_name: "text".into(),
                    type_oid: 25,
                },
                ResultColumn {
                    name: "binary".into(),
                    type_name: "custom".into(),
                    type_oid: 99_999,
                },
                ResultColumn {
                    name: "large".into(),
                    type_name: "text".into(),
                    type_oid: 25,
                },
                ResultColumn {
                    name: "enabled".into(),
                    type_name: "bool".into(),
                    type_oid: 16,
                },
                ResultColumn {
                    name: "disabled".into(),
                    type_name: "bool".into(),
                    type_oid: 16,
                },
            ]
        );
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

    #[test]
    fn cursor_transaction_plan_preserves_ownership() {
        assert_eq!(
            cursor_ownership_from_probe(CursorTransactionProbe::NoActiveTransaction),
            CursorTransactionOwnership::PathOwned,
            "autocommit requires a transaction owned by the cursor path"
        );
        assert_eq!(
            cursor_ownership_from_probe(CursorTransactionProbe::SavepointCreated),
            CursorTransactionOwnership::CallerOwned,
            "an existing manual transaction stays caller-owned"
        );
        assert_eq!(
            cursor_success_steps(CursorTransactionOwnership::PathOwned),
            vec![
                CursorStep::Begin,
                CursorStep::Declare,
                CursorStep::Fetch,
                CursorStep::Close,
                CursorStep::Commit,
            ]
        );
        assert_eq!(
            cursor_success_steps(CursorTransactionOwnership::CallerOwned),
            vec![CursorStep::Declare, CursorStep::Fetch, CursorStep::Close]
        );
    }

    #[test]
    fn cursor_failure_cleanup_only_rolls_back_path_owned_transactions() {
        for failure in [
            CursorFailure::Declare,
            CursorFailure::Fetch,
            CursorFailure::Close,
            CursorFailure::Commit,
        ] {
            let path_owned = cursor_failure_steps(CursorTransactionOwnership::PathOwned, failure);
            assert_eq!(path_owned.last(), Some(&CursorStep::Rollback));

            let caller_owned =
                cursor_failure_steps(CursorTransactionOwnership::CallerOwned, failure);
            assert!(!caller_owned.contains(&CursorStep::Begin));
            assert!(!caller_owned.contains(&CursorStep::Commit));
            assert!(!caller_owned.contains(&CursorStep::Rollback));
        }
    }

    trait CellTextLen {
        fn text_len(&self) -> Option<usize>;
    }

    impl CellTextLen for ResultCell {
        fn text_len(&self) -> Option<usize> {
            match self {
                ResultCell::Value { text } | ResultCell::Truncated { text } => Some(text.len()),
                ResultCell::Null | ResultCell::Unreadable { .. } => None,
            }
        }
    }
}
