import { useState } from "react";
import type { ColumnInfo } from "../../ipc/contract";
import { ResultsAccessibility } from "./results-accessibility";
import { ResultsCopy } from "./results-copy";
import { RowEditorField } from "./row-editor-field";
import "./query-results.css";

export function RowEditor(props: {
  selectedCount: number;
  onSubmit: (patch: Record<string, unknown | null>) => void;
  columns?: ColumnInfo[];
  values?: unknown[];
  onCancel?: () => void;
}): React.JSX.Element {
  const { selectedCount, onSubmit, onCancel } = props;
  const columns = props.columns ?? [];
  const values = props.values ?? [];

  const [fields, setFields] = useState<Array<string | null>>(() => values.map(valueToField));
  const [nullFlags, setNullFlags] = useState<boolean[]>(() => values.map((v) => v === null));

  if (selectedCount !== 1) {
    return (
      <div
        className="query-results__dialog"
        role="dialog"
        aria-modal="true"
        aria-label={ResultsCopy.multipleRowsSelected}
        data-testid={ResultsAccessibility.rowEditor}
      >
        <h2 className="query-results__dialog-title">{ResultsCopy.multipleRowsSelected}</h2>
        <p className="query-results__dialog-body">{ResultsCopy.selectOnlyOneRow}</p>
        {onCancel ? (
          <div className="query-results__dialog-actions">
            <button type="button" className="query-results__btn" onClick={onCancel}>
              {ResultsCopy.cancel}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  function setNullAt(index: number, isNull: boolean): void {
    setNullFlags((current) => current.map((flag, i) => (i === index ? isNull : flag)));
  }

  function setFieldAt(index: number, text: string): void {
    setFields((current) => current.map((value, i) => (i === index ? text : value)));
  }

  function submit(): void {
    const patch: Record<string, unknown | null> = {};
    for (const [index, column] of columns.entries()) {
      if (column.isPrimaryKey) continue;
      patch[column.name] = nullFlags[index] ? null : (fields[index] ?? "");
    }
    onSubmit(patch);
  }

  return (
    <form
      className="query-results__dialog"
      role="dialog"
      aria-modal="true"
      aria-label={ResultsCopy.edit}
      data-testid={ResultsAccessibility.rowEditor}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <h2 className="query-results__dialog-title">{ResultsCopy.edit}</h2>
      <div className="query-results__editor-fields">
        {columns.map((column, index) => (
          <RowEditorField
            key={column.name}
            column={column}
            value={fields[index] ?? ""}
            isNull={nullFlags[index] === true}
            onValueChange={(text) => setFieldAt(index, text)}
            onNullChange={(isNull) => setNullAt(index, isNull)}
          />
        ))}
      </div>
      <div className="query-results__dialog-actions">
        <button type="submit" className="query-results__btn query-results__btn--primary">
          {ResultsCopy.save}
        </button>
        {onCancel ? (
          <button type="button" className="query-results__btn" onClick={onCancel}>
            {ResultsCopy.cancel}
          </button>
        ) : null}
      </div>
    </form>
  );
}

function valueToField(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  return String(value);
}
