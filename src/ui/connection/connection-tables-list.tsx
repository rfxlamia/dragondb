import type { ColumnInfo, DragonIpc, TableRef } from "../../ipc/contract";
import { TABLES_LOAD_FAILED } from "../../stores/schema-store";
import { TableList } from "../tables/table-list";
import { ConnectionAccessibility } from "./connection-accessibility";
import { ConnectionCopy } from "./connection-copy";

function noop(): void {}

export function ConnectionTablesList(props: {
  tables: TableRef[];
  tablesLoading: boolean;
  tablesErrorMessage: string | null;
  onBrowse?: (table: TableRef) => void;
  columnsByTable?: Record<string, ColumnInfo[]>;
  executing?: boolean;
  onDrop?: (table: TableRef) => void | Promise<void>;
  onTruncate?: (table: TableRef) => void | Promise<void>;
  onGenerateDdl?: (table: TableRef) => unknown;
  onRunQuery?: (sql: string) => void;
  onRefresh?: (table: TableRef) => void;
  onExpand?: (table: TableRef) => void;
  onFetchAll?: (table: TableRef) => Promise<{ columns: string[]; rows: unknown[][] }>;
  saveCsvFile?: DragonIpc["saveCsvFile"];
  saveTextFile?: DragonIpc["saveTextFile"];
}): React.JSX.Element {
  const {
    tables,
    tablesLoading,
    tablesErrorMessage,
    onBrowse,
    columnsByTable = {},
    executing = false,
    onDrop,
    onTruncate,
    onGenerateDdl,
    onRunQuery,
    onRefresh,
    onExpand,
    onFetchAll,
    saveCsvFile,
    saveTextFile,
  } = props;

  let body: React.ReactNode;
  if (tablesLoading) {
    body = <p className="connection-panel__hint">{ConnectionCopy.tablesLoading}</p>;
  } else if (tablesErrorMessage === TABLES_LOAD_FAILED) {
    body = <p className="connection-panel__status">{ConnectionCopy.tablesLoadError}</p>;
  } else if (tables.length === 0) {
    body = <p className="connection-panel__hint">{ConnectionCopy.noTablesFound}</p>;
  } else {
    body = (
      <TableList
        tables={tables}
        columnsByTable={columnsByTable}
        executing={executing}
        onBrowse={onBrowse ?? noop}
        onDrop={onDrop ?? noop}
        onTruncate={onTruncate ?? noop}
        onGenerateDdl={onGenerateDdl ?? noop}
        onRunQuery={onRunQuery}
        onRefresh={onRefresh}
        onExpand={onExpand}
        onFetchAll={onFetchAll}
        saveCsvFile={saveCsvFile}
        saveTextFile={saveTextFile}
      />
    );
  }

  return (
    <div className="connection-tables" data-testid={ConnectionAccessibility.tablesRegion}>
      {body}
    </div>
  );
}
