import { useEffect, useState } from "react";
import type { ColumnInfo, DragonIpc, TableRef } from "../../ipc/contract";
import { TABLES_LOAD_FAILED } from "../../stores/schema-store";
import { SearchIcon } from "../icons";
import { TableList } from "../tables/table-list";
import { TablesAccessibility } from "../tables/tables-accessibility";
import { TablesCopy } from "../tables/tables-copy";
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
  onBlockingChange?: (blocking: boolean) => void;
  schemas?: string[];
  selectedSchema?: string | null;
  onSelectSchema?: (schema: string | null) => void;
  schemaError?: string | null;
  onDismissSchemaError?: () => void;
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
    onBlockingChange,
    schemas,
    selectedSchema,
    onSelectSchema,
    schemaError,
    onDismissSchemaError,
  } = props;

  const [filter, setFilter] = useState("");

  const showTableList =
    !tablesLoading && tablesErrorMessage !== TABLES_LOAD_FAILED && tables.length > 0;

  useEffect(() => {
    if (!showTableList) {
      onBlockingChange?.(false);
    }
  }, [showTableList, onBlockingChange]);

  let body: React.ReactNode;
  if (tablesLoading) {
    body = <p className="connection-panel__hint">{ConnectionCopy.tablesLoading}</p>;
  } else if (tablesErrorMessage === TABLES_LOAD_FAILED) {
    body = (
      <p className="connection-panel__status" role="alert">
        {ConnectionCopy.tablesLoadError}
      </p>
    );
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
        onBlockingChange={onBlockingChange}
        filter={filter}
        onFilterChange={setFilter}
      />
    );
  }

  return (
    <div className="connection-tables" data-testid={ConnectionAccessibility.tablesRegion}>
      {!tablesLoading ? (
        <div className="ui-search connection-tables__search">
          <span className="ui-search__icon">
            <SearchIcon />
          </span>
          <input
            type="search"
            className="ui-search__input"
            aria-label={TablesCopy.searchTables}
            placeholder={TablesCopy.searchTables}
            data-testid={TablesAccessibility.search}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </div>
      ) : null}
      {schemas !== undefined && schemas.length > 1 && onSelectSchema ? (
        <label className="connection-tables__schema">
          <span className="ui-visually-hidden">{TablesCopy.filterBySchema}</span>
          <select
            className="ui-quiet-select"
            data-testid={TablesAccessibility.schemaPicker}
            value={selectedSchema ?? ""}
            onChange={(event) =>
              onSelectSchema(event.target.value === "" ? null : event.target.value)
            }
          >
            <option value="">{TablesCopy.allSchemas}</option>
            {schemas.map((schema) => (
              <option key={schema} value={schema}>
                {schema}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {schemaError ? (
        <div className="connection-tables__schema-error" role="alert">
          <p>{schemaError}</p>
          <button type="button" onClick={onDismissSchemaError}>
            {TablesCopy.done}
          </button>
        </div>
      ) : null}
      {body}
    </div>
  );
}
