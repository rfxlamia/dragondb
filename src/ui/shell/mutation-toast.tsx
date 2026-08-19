import { useEffect, useRef, useState } from "react";
import { detectQueryType, type SqlQueryType } from "../../lib/query-type-detector";

/** Toast-local table reference — schema-agnostic pass-through to onViewTable. */
export type MutationToastTable = { schema?: string; name: string };

export type MutationToastProps = {
  /** Executed SQL text — used to derive the headline and hide View Table for DROP TABLE. */
  sql: string;
  table: MutationToastTable;
  /** Overrides the derived headline (App wires the store's precomputed SUCCESS_TITLES text here). */
  title?: string;
  onViewTable: (table: MutationToastTable) => void;
  onDismiss: () => void;
};

const DEFAULT_TITLES: Record<SqlQueryType, string> = {
  select: "Query executed",
  insert: "Insert successful",
  update: "Update successful",
  delete: "Delete successful",
  createTable: "Table created",
  dropTable: "Table dropped",
  alterTable: "Table altered",
  other: "Query executed",
};

const AUTO_DISMISS_MS = 5_000;

export function MutationToast(props: MutationToastProps): React.JSX.Element | null {
  const { sql, table, title, onViewTable, onDismiss } = props;
  const [visible, setVisible] = useState(true);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setVisible(false);
      onDismissRef.current();
    }, AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, []);

  if (!visible) return null;

  const queryType = detectQueryType(sql);
  const isDropTable = queryType === "dropTable";
  const headline = title ?? DEFAULT_TITLES[queryType];

  function handleViewTable(): void {
    onViewTable(table);
    setVisible(false);
    onDismiss();
  }

  function handleDismiss(): void {
    setVisible(false);
    onDismiss();
  }

  return (
    <div className="mutation-toast" role="status" aria-live="polite">
      <div className="mutation-toast__body">
        <p className="mutation-toast__title">{headline}</p>
        {table.name ? <p className="mutation-toast__table">{table.name}</p> : null}
      </div>
      <div className="mutation-toast__actions">
        {isDropTable ? null : (
          <button type="button" className="mutation-toast__view-table" onClick={handleViewTable}>
            View Table
          </button>
        )}
        <button
          type="button"
          className="mutation-toast__dismiss"
          aria-label="Dismiss"
          onClick={handleDismiss}
        >
          ×
        </button>
      </div>
    </div>
  );
}
