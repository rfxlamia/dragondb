use serde::{Serialize, Serializer};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResultCell {
    Value { text: String },
    Null,
    Unreadable { type_name: String },
    Truncated { text: String },
}

#[derive(Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
enum TaggedResultCell<'a> {
    Value {
        text: &'a str,
    },
    Unreadable {
        #[serde(rename = "typeName")]
        type_name: &'a str,
    },
    Truncated {
        text: &'a str,
    },
}

impl Serialize for ResultCell {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match self {
            Self::Value { text } => TaggedResultCell::Value { text }.serialize(serializer),
            Self::Null => serializer.serialize_none(),
            Self::Unreadable { type_name } => {
                TaggedResultCell::Unreadable { type_name }.serialize(serializer)
            }
            Self::Truncated { text } => TaggedResultCell::Truncated { text }.serialize(serializer),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultColumn {
    pub name: String,
    pub type_name: String,
    pub type_oid: u32,
}

#[cfg(test)]
mod tests {
    use super::ResultCell;
    use serde_json::{json, to_value};
    use std::collections::HashSet;

    #[test]
    fn result_cell_states_serialize_distinguishably() {
        let serialized = [
            to_value(ResultCell::Value {
                text: "exact value".to_string(),
            })
            .expect("serialize value cell"),
            to_value(ResultCell::Null).expect("serialize null cell"),
            to_value(ResultCell::Unreadable {
                type_name: "bytea".to_string(),
            })
            .expect("serialize unreadable cell"),
            to_value(ResultCell::Truncated {
                text: "partial".to_string(),
            })
            .expect("serialize truncated cell"),
        ];

        assert_eq!(
            serialized[0],
            json!({ "state": "value", "text": "exact value" })
        );
        assert_eq!(serialized[1], serde_json::Value::Null);
        assert_ne!(serialized[2], serialized[1]);
        assert_ne!(serialized[3], serialized[0]);
        assert_ne!(serialized[3], serialized[2]);

        let distinct = serialized.iter().collect::<HashSet<_>>();
        assert_eq!(distinct.len(), serialized.len());
    }
}
