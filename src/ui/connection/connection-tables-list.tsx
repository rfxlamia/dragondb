import type { ColumnInfo, DragonIpc, TableRef } from "../../ipc/contract";
import { TABLES_LOAD_FAILED } from "../../stores/schema-store";
import { TableList } from "../tables/table-list";
import { TablesCopy } from "../tables/tables-copy";
import { ConnectionAccessibility } from "./connection-accessibility";
import { ConnectionCopy } from "./connection-copy";

function noop(): void {}

export function ConnectionTablesList(props: {
  tables: TableRef[];
  tablesLoading: boolean;
  tablesErrorMessage: string | null;
  hasNextPage?: boolean;
  onNextPage?: () => void;
  onBrowse?: (table: TableRef) => void;
  columnsByTable?: Record<string, ColumnInfo[]>;
  executing?: boolean;
  onDrop?: (table: TableRef) => void;
  onTruncate?: (table: TableRef) => void;
  onGenerateDdl?: (table: TableRef) => unknown;
  onRunQuery?: (sql: string) => void;
  onRefresh?: (table: TableRef) => void;
  onFetchAll?: (table: TableRef) => Promise<{ columns: string[]; rows: unknown[][] }>;
  saveCsvFile?: DragonIpc["saveCsvFile"];
  saveTextFile?: DragonIpc["saveTextFile"];
}): React.JSX.Element {
  const {
    tables,
    tablesLoading,
    tablesErrorMessage,
    hasNextPage = false,
    onNextPage,
    onBrowse,
    columnsByTable = {},
    executing = false,
    onDrop,
    onTruncate,
    onGenerateDdl,
    onRunQuery,
    onRefresh,
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
      <>
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
          onFetchAll={onFetchAll}
          saveCsvFile={saveCsvFile}
          saveTextFile={saveTextFile}
        />
        {hasNextPage ? (
          <button type="button" className="table-list__next" onClick={onNextPage}>
            {TablesCopy.nextPage}
          </button>
        ) : null}
      </>
    );
  }

  return (
    <div className="connection-tables" data-testid={ConnectionAccessibility.tablesRegion}>
      {body}
    </div>
  );
}
