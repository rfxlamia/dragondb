import type { ColumnInfo } from "../../ipc/contract";
import { ResultsCopy } from "./results-copy";

export type RowEditorInputType = "date" | "time" | "datetime-local" | "text";

/** Native controls only for timezone-free temporal types; everything else stays text. */
export function inputTypeForColumn(dataType: string): RowEditorInputType {
  switch (dataType.toLowerCase()) {
    case "date":
      return "date";
    case "time without time zone":
      return "time";
    case "timestamp without time zone":
      return "datetime-local";
    default:
      return "text";
  }
}

export function RowEditorField(props: {
  column: ColumnInfo;
  value: string;
  isNull: boolean;
  pending?: boolean;
  onValueChange: (value: string) => void;
  onNullChange: (isNull: boolean) => void;
}): React.JSX.Element {
  const { column, value, isNull, pending = false, onValueChange, onNullChange } = props;
  const inputType = inputTypeForColumn(column.dataType);
  const isPk = column.isPrimaryKey;
  const fieldId = `row-editor-field-${column.name}`;
  const nullId = `row-editor-null-${column.name}`;
  const showNullToggle = !isPk && column.isNullable;

  return (
    <div className="query-results__editor-field">
      <label htmlFor={fieldId}>{column.name}</label>
      {isPk ? <span className="query-results__editor-pk">{ResultsCopy.primaryKey}</span> : null}
      <input
        id={fieldId}
        type={inputType}
        value={isNull ? "" : value}
        disabled={isPk || isNull || pending}
        readOnly={isPk}
        onChange={(event) => onValueChange(event.target.value)}
      />
      {showNullToggle ? (
        <div className="query-results__editor-null">
          <input
            id={nullId}
            type="checkbox"
            checked={isNull}
            disabled={pending}
            onChange={(event) => onNullChange(event.target.checked)}
          />
          <label htmlFor={nullId}>{ResultsCopy.setNullFor(column.name)}</label>
        </div>
      ) : null}
    </div>
  );
}
