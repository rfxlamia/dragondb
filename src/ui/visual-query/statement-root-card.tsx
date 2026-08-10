import { useEffect, useState } from "react";
import type {
  CreateColumn,
  CreateColumnType,
  QueryDocument,
  StatementKind,
} from "../../core";
import { VisualQueryAccessibility } from "./accessibility";
import { VisualQueryCopy } from "./copy";
import "./visual-query.css";

const CREATE_TYPES: CreateColumnType[] = ["text", "number", "date", "boolean"];

export function StatementRootCard(props: {
  kind: StatementKind;
  document: QueryDocument;
  onStartOver: () => void;
  onSetCreateTableName: (name: string) => void;
  onSetCreateColumns: (columns: CreateColumn[]) => void;
}): React.JSX.Element {
  const { kind, document, onStartOver, onSetCreateTableName, onSetCreateColumns } = props;
  const isComingSoon = kind === "update" || kind === "delete";
  const [tableName, setTableName] = useState(document.createTableName);
  const documentColumns = document.createColumns;
  const displayColumns: CreateColumn[] =
    documentColumns.length > 0
      ? documentColumns.map((column) => ({ ...column }))
      : [{ name: "", type: "text" }];

  useEffect(() => {
    setTableName(document.createTableName);
  }, [document.createTableName]);

  useEffect(() => {
    if (kind === "createTable" && document.createColumns.length === 0) {
      onSetCreateColumns([{ name: "", type: "text" }]);
    }
  }, [kind, document.createColumns.length, onSetCreateColumns]);

  function copyDocumentColumns(): CreateColumn[] {
    return document.createColumns.map((column) => ({ ...column }));
  }

  function mutateColumns(mutator: (next: CreateColumn[]) => void): void {
    const next = copyDocumentColumns();
    if (next.length === 0) {
      next.push({ name: "", type: "text" });
    }
    mutator(next);
    onSetCreateColumns(next);
  }

  function addColumn(): void {
    const next = copyDocumentColumns();
    if (next.length === 0) {
      onSetCreateColumns([{ name: "", type: "text" }]);
      return;
    }
    onSetCreateColumns([...next, { name: "", type: "text" }]);
  }

  return (
    <div className="vq-clause-card vq-statement-root-card">
      <div className="vq-clause-card__header">
        <div className="vq-clause-card__titles">
          <div className="vq-clause-card__title-row">
            <div className="vq-clause-card__title">{VisualQueryCopy.statementTitle(kind)}</div>
            {isComingSoon ? (
              <span className="vq-statement-menu__item-badge">Coming soon</span>
            ) : null}
          </div>
          <div className="vq-clause-card__helper">{VisualQueryCopy.statementHelper(kind)}</div>
        </div>
        <button
          type="button"
          className="vq-clause-card__delete"
          title={VisualQueryCopy.startOverTitle}
          onClick={onStartOver}
          data-testid={VisualQueryAccessibility.deleteStatementRoot(kind)}
        >
          ×
        </button>
      </div>

      {kind === "createTable" ? (
        <div className="vq-clause-card__fields">
          <input
            type="text"
            className="vq-clause-card__input"
            placeholder="Table name"
            value={tableName}
            onChange={(event) => {
              setTableName(event.target.value);
              onSetCreateTableName(event.target.value);
            }}
            data-testid={VisualQueryAccessibility.createTableNameField}
          />

          <div
            className="vq-clause-card__fields"
            data-testid={VisualQueryAccessibility.createColumnsList}
          >
            {displayColumns.map((column, index) => (
              <div key={index} className="vq-clause-card__field-row">
                <input
                  type="text"
                  className="vq-clause-card__input"
                  placeholder="Column name"
                  value={column.name}
                  onChange={(event) => {
                    mutateColumns((next) => {
                      next[index].name = event.target.value;
                    });
                  }}
                  data-testid={VisualQueryAccessibility.createColumnNameField(index)}
                />
                <select
                  className="vq-clause-card__select vq-clause-card__select--type"
                  value={column.type}
                  onChange={(event) => {
                    mutateColumns((next) => {
                      next[index].type = event.target.value as CreateColumnType;
                    });
                  }}
                  data-testid={VisualQueryAccessibility.createColumnTypePicker(index)}
                >
                  {CREATE_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {VisualQueryCopy.createColumnTypeTitle(type)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="vq-clause-card__picker"
                  disabled={displayColumns.length <= 1}
                  onClick={() => {
                    mutateColumns((next) => {
                      next.splice(index, 1);
                    });
                  }}
                  data-testid={VisualQueryAccessibility.removeCreateColumn(index)}
                >
                  −
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            className="vq-clause-card__picker"
            onClick={addColumn}
            data-testid={VisualQueryAccessibility.addCreateColumn}
          >
            Add column
          </button>
        </div>
      ) : null}
    </div>
  );
}
