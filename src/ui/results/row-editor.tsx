import { useRef, useState } from "react";
import type { ColumnInfo } from "../../ipc/contract";
import { isValueCell } from "../../lib/result-cell";
import { ResultsAccessibility } from "./results-accessibility";
import { ResultsCopy } from "./results-copy";
import { RowEditorField } from "./row-editor-field";
import { rowOperationErrorMessage } from "./row-operation-error";
import "./query-results.css";

type FieldBaseline = {
  isNull: boolean;
  text: string;
};

export function RowEditor(props: {
  selectedCount: number;
  onSubmit: (patch: Record<string, unknown | null>) => void | Promise<void>;
  columns?: ColumnInfo[];
  values?: unknown[];
  onCancel?: () => void;
}): React.JSX.Element {
  const { selectedCount, onSubmit, onCancel } = props;
  const columns = props.columns ?? [];
  const values = props.values ?? [];

  const baselinesRef = useRef<FieldBaseline[]>(values.map(baselineFromValue));
  const [fields, setFields] = useState<Array<string | null>>(() => values.map(valueToField));
  const [nullFlags, setNullFlags] = useState<boolean[]>(() =>
    values.map((value) => baselineFromValue(value).isNull),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [info, setInfo] = useState<string | null>(null);
  const pendingRef = useRef(false);

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
    setInfo(null);
    setNullFlags((current) => current.map((flag, i) => (i === index ? isNull : flag)));
  }

  function setFieldAt(index: number, text: string): void {
    setInfo(null);
    setFields((current) => current.map((value, i) => (i === index ? text : value)));
  }

  async function submit(): Promise<void> {
    if (pendingRef.current) return;
    setError(null);
    const patch = buildPatch(columns, baselinesRef.current, fields, nullFlags);
    if (Object.keys(patch).length === 0) {
      setInfo("Nothing changed");
      return;
    }
    setInfo(null);
    pendingRef.current = true;
    setPending(true);
    try {
      await onSubmit(patch);
    } catch (reason) {
      setError(reason);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
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
        void submit();
      }}
    >
      <h2 className="query-results__dialog-title">{ResultsCopy.edit}</h2>
      {error !== null ? (
        <p
          className="query-results__dialog-error"
          role="alert"
          data-testid={ResultsAccessibility.rowOperationAlert}
        >
          {rowOperationErrorMessage(error)}
        </p>
      ) : null}
      {info !== null ? (
        <p className="query-results__dialog-body" role="status">
          {info}
        </p>
      ) : null}
      <div className="query-results__editor-fields">
        {columns.map((column, index) => (
          <RowEditorField
            key={column.name}
            column={column}
            value={fields[index] ?? ""}
            isNull={nullFlags[index] === true}
            pending={pending}
            onValueChange={(text) => setFieldAt(index, text)}
            onNullChange={(isNull) => setNullAt(index, isNull)}
          />
        ))}
      </div>
      <div className="query-results__dialog-actions">
        <button
          type="submit"
          className="query-results__btn query-results__btn--primary"
          disabled={pending}
        >
          {ResultsCopy.save}
        </button>
        {onCancel ? (
          <button
            type="button"
            className="query-results__btn"
            disabled={pending}
            onClick={onCancel}
          >
            {ResultsCopy.cancel}
          </button>
        ) : null}
      </div>
    </form>
  );
}

function baselineFromValue(value: unknown): FieldBaseline {
  if (value === null || value === undefined) {
    return { isNull: true, text: "" };
  }
  if (isValueCell(value)) {
    return { isNull: false, text: value.text };
  }
  if (typeof value === "string") {
    return { isNull: false, text: value };
  }
  return { isNull: false, text: String(value) };
}

function valueToField(value: unknown): string | null {
  const baseline = baselineFromValue(value);
  return baseline.isNull ? null : baseline.text;
}

function buildPatch(
  columns: ColumnInfo[],
  baselines: FieldBaseline[],
  fields: Array<string | null>,
  nullFlags: boolean[],
): Record<string, unknown | null> {
  const patch: Record<string, unknown | null> = {};
  for (const [index, column] of columns.entries()) {
    if (column.isPrimaryKey) continue;
    const baseline = baselines[index] ?? { isNull: true, text: "" };
    const isNull = nullFlags[index] === true;
    const text = fields[index] ?? "";
    if (isNull !== baseline.isNull) {
      patch[column.name] = isNull ? null : text;
      continue;
    }
    if (!isNull && text !== baseline.text) {
      patch[column.name] = text;
    }
  }
  return patch;
}
