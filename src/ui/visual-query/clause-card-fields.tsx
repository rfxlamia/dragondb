import type {
  ClauseKind,
  OrderDirection,
  QueryDocument,
  WhereOperator,
} from "../../core";
import { formatTableDisplayName } from "../../ipc/table-ref";
import { VisualQueryAccessibility } from "./accessibility";
import { VisualQueryCopy } from "./copy";
import "./visual-query.css";

const WHERE_OPERATORS: WhereOperator[] = [
  "equals",
  "notEquals",
  "greaterThan",
  "lessThan",
  "contains",
  "isEmpty",
];

const ORDER_DIRECTIONS: OrderDirection[] = ["asc", "desc"];

function parseSelectColumns(text: string): string[] {
  return text.split(",").map((part) => part.trim());
}

function selectedColumnsText(document: QueryDocument): string {
  const projection = document.selectProjection;
  if (projection.kind === "columns") {
    return projection.columns.join(", ");
  }
  return "";
}

function limitText(document: QueryDocument): string {
  const input = document.limitInput;
  switch (input.kind) {
    case "empty":
      return "";
    case "value":
      return String(input.value);
    case "invalid":
      return input.text;
  }
}

export type ClauseCardFieldsProps = {
  kind: ClauseKind;
  document: QueryDocument;
  onSetSelectColumns: (columns: string[]) => void;
  onSetFromTableText: (raw: string) => void;
  onCommitFromTable: (raw: string) => void;
  onSetWhereCondition: (column: string, op: WhereOperator, value: string | null) => void;
  onSetOrderBy: (column: string, direction: OrderDirection) => void;
  onSetLimitText: (text: string) => void;
  onOpenSchemaPopover: (mode: "tables" | "columns") => void;
};

function SchemaColumnField(props: {
  text: string;
  placeholder: string;
  fieldTestId: string;
  pickerTestId: string;
  onChange: (value: string) => void;
  onOpenPicker: () => void;
}): React.JSX.Element {
  const { text, placeholder, fieldTestId, pickerTestId, onChange, onOpenPicker } = props;

  return (
    <div className="vq-clause-card__field-row">
      <input
        className="vq-clause-card__input"
        type="text"
        placeholder={placeholder}
        value={text}
        onChange={(event) => onChange(event.target.value)}
        data-testid={fieldTestId}
      />
      <button
        type="button"
        className="vq-clause-card__picker"
        title="Choose a column"
        onClick={onOpenPicker}
        data-testid={pickerTestId}
      >
        ▾
      </button>
    </div>
  );
}

export function ClauseCardFields(props: ClauseCardFieldsProps): React.JSX.Element | null {
  const {
    kind,
    document,
    onSetSelectColumns,
    onSetFromTableText,
    onCommitFromTable,
    onSetWhereCondition,
    onSetOrderBy,
    onSetLimitText,
    onOpenSchemaPopover,
  } = props;

  switch (kind) {
    case "select": {
      const allColumns = document.selectProjection.kind === "allColumns";
      return (
        <div className="vq-clause-card__fields">
          <label className="vq-clause-card__checkbox">
            <input
              type="checkbox"
              checked={allColumns}
              onChange={(event) => {
                if (event.target.checked) {
                  onSetSelectColumns([]);
                } else if (document.selectProjection.kind === "columns") {
                  const columns = document.selectProjection.columns;
                  onSetSelectColumns(columns.length > 0 ? columns : [""]);
                } else {
                  onSetSelectColumns([""]);
                }
              }}
              data-testid={VisualQueryAccessibility.allColumnsToggle}
            />
            {VisualQueryCopy.allColumnsTitle}
          </label>

          {!allColumns ? (
            <SchemaColumnField
              text={selectedColumnsText(document)}
              placeholder="column, column"
              fieldTestId={VisualQueryAccessibility.selectColumnsField}
              pickerTestId={VisualQueryAccessibility.selectColumnsPicker}
              onChange={(value) => onSetSelectColumns(parseSelectColumns(value))}
              onOpenPicker={() => onOpenSchemaPopover("columns")}
            />
          ) : null}
        </div>
      );
    }

    case "from": {
      const fromDisplayName = document.fromTable ? formatTableDisplayName(document.fromTable) : "";
      return (
        <div className="vq-clause-card__fields">
          <div className="vq-clause-card__field-row">
            <input
              className="vq-clause-card__input"
              type="text"
              placeholder="table"
              value={fromDisplayName}
              onChange={(event) => onSetFromTableText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  onCommitFromTable(fromDisplayName);
                }
              }}
              data-testid={VisualQueryAccessibility.fromTableField}
            />
            <button
              type="button"
              className="vq-clause-card__picker"
              title="Choose a table"
              onClick={() => onOpenSchemaPopover("tables")}
              data-testid={VisualQueryAccessibility.fromTablePicker}
            >
              ▾
            </button>
          </div>
        </div>
      );
    }

    case "where": {
      const condition = document.whereCondition ?? {
        column: "",
        op: "equals" as const,
        value: null,
      };
      return (
        <div className="vq-clause-card__fields">
          <SchemaColumnField
            text={condition.column}
            placeholder="column"
            fieldTestId={VisualQueryAccessibility.whereColumnField}
            pickerTestId={VisualQueryAccessibility.whereColumnPicker}
            onChange={(column) => onSetWhereCondition(column, condition.op, condition.value)}
            onOpenPicker={() => onOpenSchemaPopover("columns")}
          />

          <select
            className="vq-clause-card__select"
            value={condition.op}
            onChange={(event) =>
              onSetWhereCondition(
                condition.column,
                event.target.value as WhereOperator,
                condition.value,
              )
            }
            data-testid={VisualQueryAccessibility.whereOperatorField}
          >
            {WHERE_OPERATORS.map((op) => (
              <option key={op} value={op}>
                {VisualQueryCopy.whereOperatorTitle(op)}
              </option>
            ))}
          </select>

          {condition.op !== "isEmpty" ? (
            <input
              className="vq-clause-card__input"
              type="text"
              placeholder="value"
              value={condition.value ?? ""}
              onChange={(event) =>
                onSetWhereCondition(condition.column, condition.op, event.target.value)
              }
              data-testid={VisualQueryAccessibility.whereValueField}
            />
          ) : null}
        </div>
      );
    }

    case "orderBy": {
      const order = document.orderBy ?? { column: "", direction: "asc" as const };
      return (
        <div className="vq-clause-card__fields vq-clause-card__fields--row">
          <SchemaColumnField
            text={order.column}
            placeholder="column"
            fieldTestId={VisualQueryAccessibility.orderByColumnField}
            pickerTestId={VisualQueryAccessibility.orderByColumnPicker}
            onChange={(column) => onSetOrderBy(column, order.direction)}
            onOpenPicker={() => onOpenSchemaPopover("columns")}
          />

          <select
            className="vq-clause-card__select vq-clause-card__select--direction"
            value={order.direction}
            onChange={(event) =>
              onSetOrderBy(order.column, event.target.value as OrderDirection)
            }
            data-testid={VisualQueryAccessibility.orderByDirectionField}
          >
            {ORDER_DIRECTIONS.map((direction) => (
              <option key={direction} value={direction}>
                {VisualQueryCopy.orderDirectionTitle(direction)}
              </option>
            ))}
          </select>
        </div>
      );
    }

    case "limit":
      return (
        <div className="vq-clause-card__fields">
          <input
            className="vq-clause-card__input vq-clause-card__input--limit"
            type="text"
            placeholder="rows"
            value={limitText(document)}
            onChange={(event) => onSetLimitText(event.target.value)}
            data-testid={VisualQueryAccessibility.limitField}
          />
        </div>
      );

    case "join":
      return null;
  }
}
