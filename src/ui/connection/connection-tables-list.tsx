import type { TableRef } from "../../ipc/contract";
import { tableDisplayName } from "../../lib/table-display-name";
import { ConnectionAccessibility } from "./connection-accessibility";
import { ConnectionCopy } from "./connection-copy";

export function ConnectionTablesList(props: {
  tables: TableRef[];
  tablesLoading: boolean;
  tablesErrorMessage: string | null;
  /** Accepted so callers can pass a query runner; must never be invoked from a name click. */
  onRunQuery?: unknown;
}): React.JSX.Element {
  const { tables, tablesLoading, tablesErrorMessage } = props;

  let body: React.ReactNode;
  if (tablesLoading) {
    body = <p className="connection-panel__hint">{ConnectionCopy.tablesLoading}</p>;
  } else if (tablesErrorMessage === "tables_load_failed") {
    body = <p className="connection-panel__status">{ConnectionCopy.tablesLoadError}</p>;
  } else if (tables.length === 0) {
    body = <p className="connection-panel__hint">{ConnectionCopy.noTablesFound}</p>;
  } else {
    body = (
      <ul className="connection-tables-list">
        {tables.map((table) => {
          const label = tableDisplayName(table);
          return (
            <li key={`${table.schema ?? ""}.${table.name}`}>
              <button type="button">{label}</button>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="connection-tables" data-testid={ConnectionAccessibility.tablesRegion}>
      {body}
    </div>
  );
}
