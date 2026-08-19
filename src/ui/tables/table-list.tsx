import { useEffect, useState } from "react";
import type { ColumnInfo, DragonIpc, TableRef } from "../../ipc/contract";
import { tableDisplayName } from "../../lib/table-display-name";
import { unknownErrorMessage } from "../../lib/unknown-error-message";
import { ChevronDownIcon, ChevronRightIcon, SearchIcon, TableIcon } from "../icons";
import { TableContextMenu } from "./table-context-menu";
import { TableDdlSheet } from "./table-ddl-sheet";
import { TableExportSheet } from "./table-export-sheet";
import { TablesAccessibility } from "./tables-accessibility";
import { TablesCopy } from "./tables-copy";
import "./tables.css";

const SCHEMA_BATCH_SIZE = 100;

export type TableListProps = {
  tables: TableRef[];
  columnsByTable: Record<string, ColumnInfo[]>;
  executing: boolean;
  onBrowse: (table: TableRef) => void;
  onDrop: (table: TableRef) => void | Promise<void>;
  onTruncate: (table: TableRef) => void | Promise<void>;
  onGenerateDdl: (table: TableRef) => unknown;
  /** Fired when a row is expanded so the parent can load columns (no IPC here). */
  onExpand?: (table: TableRef) => void;
  /** Accepted so callers can pass hatch runQuery — table admin must never call it. */
  onRunQuery?: (sql: string) => void;
  onRefresh?: (table: TableRef) => void;
  onFetchAll?: (table: TableRef) => Promise<{ columns: string[]; rows: unknown[][] }>;
  saveCsvFile?: DragonIpc["saveCsvFile"];
  saveTextFile?: DragonIpc["saveTextFile"];
  /** True while a sheet or confirm owns this list — see ConnectionPanel. */
  onBlockingChange?: (blocking: boolean) => void;
};

type PendingAdmin = { table: TableRef; kind: "drop" | "truncate" };

export function TableList(props: TableListProps): React.JSX.Element {
  const {
    tables,
    columnsByTable,
    executing,
    onBrowse,
    onDrop,
    onTruncate,
    onGenerateDdl,
    onExpand,
    onRefresh,
    onFetchAll,
    saveCsvFile,
    saveTextFile,
    onBlockingChange,
  } = props;
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [pending, setPending] = useState<PendingAdmin | null>(null);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [ddl, setDdl] = useState<string | null>(null);
  const [ddlError, setDdlError] = useState<string | null>(null);
  const [exportTable, setExportTable] = useState<TableRef | null>(null);
  const [displayedBySchema, setDisplayedBySchema] = useState<Readonly<Record<string, number>>>(
    () => ({}),
  );
  const [filter, setFilter] = useState("");
  const [collapsedSchemas, setCollapsedSchemas] = useState<ReadonlySet<string>>(() => new Set());

  const blocking = pending !== null || ddl !== null || exportTable !== null;
  useEffect(() => {
    onBlockingChange?.(blocking);
  }, [blocking, onBlockingChange]);

  const needle = filter.trim().toLowerCase();
  const matchedTables =
    needle === "" ? tables : tables.filter((table) => table.name.toLowerCase().includes(needle));
  const groups = groupTables(matchedTables);
  const firstKey = tables[0] ? catalogKey(tables[0]) : null;
  const canExport = Boolean(onFetchAll && saveCsvFile && saveTextFile);

  async function handleDdl(table: TableRef): Promise<void> {
    setDdlError(null);
    try {
      const result = await Promise.resolve(onGenerateDdl(table));
      if (typeof result === "string") setDdl(result);
    } catch (err) {
      setDdlError(
        err instanceof Error && err.message.length > 0 ? err.message : TablesCopy.ddlFailed,
      );
    }
  }

  function toggleExpanded(table: TableRef): void {
    const key = catalogKey(table);
    const willExpand = !expanded.has(key);
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    if (willExpand) onExpand?.(table);
  }

  async function confirmPending(): Promise<void> {
    if (pending === null) return;
    const current = pending;
    setPending(null);
    setAdminError(null);
    try {
      if (current.kind === "drop") await Promise.resolve(onDrop(current.table));
      else await Promise.resolve(onTruncate(current.table));
    } catch (err) {
      setAdminError(
        unknownErrorMessage(
          err,
          current.kind === "drop" ? TablesCopy.dropFailed : TablesCopy.truncateFailed,
        ),
      );
    }
  }

  function loadMoreSchema(schema: string): void {
    setDisplayedBySchema((current) => {
      const shown = current[schema] ?? SCHEMA_BATCH_SIZE;
      return { ...current, [schema]: shown + SCHEMA_BATCH_SIZE };
    });
  }

  function toggleSchema(schema: string): void {
    setCollapsedSchemas((current) => {
      const next = new Set(current);
      if (next.has(schema)) next.delete(schema);
      else next.add(schema);
      return next;
    });
  }

  return (
    <div className="table-list" data-testid={TablesAccessibility.list}>
      <div className="ui-search table-list__search">
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
      {groups.length === 0 ? (
        <p className="table-list__empty">{TablesCopy.noMatchingTables}</p>
      ) : null}
      {groups.map((group) => {
        const displayedCount = displayedBySchema[group.schema] ?? SCHEMA_BATCH_SIZE;
        const visibleTables = group.tables.slice(0, displayedCount);
        const hasMore = group.tables.length > displayedCount;
        return (
          <section key={group.schema} className="table-list__schema">
            <h3 className="table-list__schema-title">
              <button
                type="button"
                className="table-list__schema-toggle"
                data-testid={TablesAccessibility.schemaToggle(group.schema)}
                aria-expanded={!collapsedSchemas.has(group.schema)}
                onClick={() => toggleSchema(group.schema)}
              >
                {collapsedSchemas.has(group.schema) ? <ChevronRightIcon /> : <ChevronDownIcon />}
                <span className="table-list__schema-name">{group.schema}</span>
                <span className="table-list__schema-count">{group.tables.length}</span>
              </button>
            </h3>
            {collapsedSchemas.has(group.schema) ? null : (
              <>
                <ul className="table-list__rows">
                  {visibleTables.map((table) => {
                    const key = catalogKey(table);
                    const isExpanded = expanded.has(key);
                    const columns = columnsByTable[key] ?? [];
                    const expandLabel =
                      key === firstKey && !isExpanded
                        ? TablesCopy.expandColumns
                        : isExpanded
                          ? TablesCopy.collapseColumns
                          : `${table.name} columns`;
                    return (
                      <li key={key} className="table-list__row">
                        <div className="table-list__row-main ui-row-host">
                          <button
                            type="button"
                            className="table-list__expand"
                            aria-expanded={isExpanded}
                            aria-label={expandLabel}
                            onClick={() => toggleExpanded(table)}
                          >
                            {isExpanded ? (
                              <ChevronDownIcon size={13} />
                            ) : (
                              <ChevronRightIcon size={13} />
                            )}
                          </button>
                          {table.tableType === "foreign" ? (
                            <span
                              className="table-list__foreign"
                              role="img"
                              aria-label={TablesCopy.foreignTable}
                            >
                              <ForeignTableIcon />
                            </span>
                          ) : (
                            <span className="table-list__glyph">
                              <TableIcon size={14} />
                            </span>
                          )}
                          <button
                            type="button"
                            className="table-list__name"
                            onClick={() => onBrowse(table)}
                          >
                            {tableDisplayName(table)}
                          </button>
                          <TableContextMenu
                            executing={executing}
                            exportDisabled={!canExport}
                            onRefresh={() => onRefresh?.(table)}
                            onDdl={() => void handleDdl(table)}
                            onExport={() => {
                              if (canExport) setExportTable(table);
                            }}
                            onTruncate={() => setPending({ table, kind: "truncate" })}
                            onDrop={() => setPending({ table, kind: "drop" })}
                            truncateDisabled={table.tableType === "foreign"}
                          />
                        </div>
                        {isExpanded ? (
                          <ul className="table-list__columns">
                            {columns.map((column) => (
                              <li key={column.name} className="table-list__column">
                                <span className="table-list__column-name">{column.name}</span>
                                <span className="table-list__column-type">{column.dataType}</span>
                                {column.isPrimaryKey ? (
                                  <span
                                    className="table-list__key"
                                    role="img"
                                    aria-label={TablesCopy.primaryKey}
                                  >
                                    <KeyIcon />
                                  </span>
                                ) : null}
                                {column.isForeignKey ? (
                                  <span
                                    className="table-list__key"
                                    role="img"
                                    aria-label={TablesCopy.foreignKey}
                                  >
                                    <FkIcon />
                                  </span>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
                {hasMore ? (
                  <button
                    type="button"
                    className="table-list__load-more"
                    onClick={() => loadMoreSchema(group.schema)}
                  >
                    {TablesCopy.loadMore}
                  </button>
                ) : null}
              </>
            )}
          </section>
        );
      })}

      {adminError ? (
        <p className="table-list__error" role="alert">
          {adminError}
        </p>
      ) : null}

      {pending ? (
        <div
          className="table-sheet table-sheet--confirm"
          role="dialog"
          aria-modal="true"
          aria-label={pending.kind === "drop" ? TablesCopy.confirmDrop : TablesCopy.confirmTruncate}
        >
          <p>{pending.kind === "drop" ? TablesCopy.dropPrompt : TablesCopy.truncatePrompt}</p>
          <div className="table-sheet__actions">
            <button
              type="button"
              className="table-sheet__danger"
              onClick={() => void confirmPending()}
            >
              {pending.kind === "drop" ? TablesCopy.confirmDrop : TablesCopy.confirmTruncate}
            </button>
            <button
              type="button"
              className="table-sheet__secondary"
              onClick={() => setPending(null)}
            >
              {TablesCopy.cancel}
            </button>
          </div>
        </div>
      ) : null}

      <TableDdlSheet
        open={ddl !== null || ddlError !== null}
        ddl={ddl ?? ""}
        error={ddlError}
        onClose={() => {
          setDdl(null);
          setDdlError(null);
        }}
      />

      {exportTable && canExport && onFetchAll && saveCsvFile && saveTextFile ? (
        <TableExportSheet
          key={catalogKey(exportTable)}
          open
          table={exportTable}
          onClose={() => setExportTable(null)}
          onFetchAll={onFetchAll}
          saveCsvFile={saveCsvFile}
          saveTextFile={saveTextFile}
        />
      ) : null}
    </div>
  );
}

export function catalogKey(table: TableRef): string {
  return table.schema ? `${table.schema}.${table.name}` : table.name;
}

function groupTables(tables: TableRef[]): { schema: string; tables: TableRef[] }[] {
  const order: string[] = [];
  const map = new Map<string, TableRef[]>();
  for (const table of tables) {
    const schema = table.schema ?? "public";
    const existing = map.get(schema);
    if (existing === undefined) {
      order.push(schema);
      map.set(schema, [table]);
    } else {
      existing.push(table);
    }
  }
  return order.map((schema) => ({ schema, tables: map.get(schema) ?? [] }));
}

function KeyIcon(): React.JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path
        fill="currentColor"
        d="M4.2 7.8a2.6 2.6 0 1 1 2.55-2.1H11v1.4H9.6V8.4H8.2V7.1H6.75A2.6 2.6 0 0 1 4.2 7.8Zm0-1.4a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4Z"
      />
    </svg>
  );
}

function FkIcon(): React.JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path fill="currentColor" d="M2 6.5h4.2L4.8 8l.9.9L8.6 6 5.7 3.1 4.8 4l1.4 1.5H2v1Z" />
      <circle cx="9.2" cy="6" r="1.5" fill="currentColor" />
    </svg>
  );
}

function ForeignTableIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <rect
        x="1.5"
        y="3"
        width="8"
        height="8"
        rx="1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path fill="none" stroke="currentColor" strokeWidth="1.2" d="M7 1.5h5.5V7M12.2 1.8 7.5 6.5" />
    </svg>
  );
}
