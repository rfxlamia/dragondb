import { useMemo, useState } from "react";
import { ResultsAccessibility } from "./results-accessibility";
import { ResultsCopy } from "./results-copy";
import "./query-results.css";

export function RowEditor(props: {
  selectedCount: number;
  onSubmit: (patch: Record<string, unknown | null>) => void;
  columns?: string[];
  values?: unknown[];
  pkColumns?: string[];
  onCancel?: () => void;
}): React.JSX.Element {
  const { selectedCount, onSubmit, onCancel } = props;
  const columns = props.columns ?? [];
  const values = props.values ?? [];
  const pkColumns = props.pkColumns ?? [];
  const pkSet = useMemo(() => new Set(pkColumns), [pkColumns]);

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
      if (pkSet.has(column)) continue;
      patch[column] = nullFlags[index] ? null : (fields[index] ?? "");
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
        {columns.map((column, index) => {
          const isPk = pkSet.has(column);
          const isNull = nullFlags[index] === true;
          return (
            <div key={column} className="query-results__editor-field">
              <span>{column}</span>
              <input
                type="text"
                value={isNull ? "" : (fields[index] ?? "")}
                disabled={isPk || isNull}
                readOnly={isPk}
                onChange={(event) => setFieldAt(index, event.target.value)}
              />
              {isPk ? null : (
                <label className="query-results__editor-null">
                  <input
                    type="checkbox"
                    checked={isNull}
                    onChange={(event) => setNullAt(index, event.target.checked)}
                  />
                  {ResultsCopy.setNull}
                </label>
              )}
            </div>
          );
        })}
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
