import { useContext, useMemo, useState } from "react";
import type { ColumnInfo, ResultCell, ResultColumn } from "../../ipc/contract";
import { toCsv } from "../../lib/csv-exporter";
import type { QueryResultsDateFormat } from "../../lib/date-format-setting";
import { determineEditability } from "../../lib/query-editability";
import { isValueCell, resultRowToCsvFields } from "../../lib/result-cell";
import type { BrowseLifecycle } from "../../stores/browse-session-store";
import type { TabResultGrid, TabRunStatus } from "../../stores/tabs-store";
import {
  BracesIcon,
  DownloadIcon,
  PencilIcon,
  SearchIcon,
  SortAscIcon,
  SortDescIcon,
  TrashIcon,
} from "../icons";
import { SqlHatchCopy } from "../sql-editor/sql-hatch-copy";
import { BrowseTimeoutContext, BrowseTimeoutDialog } from "./browse-timeout-dialog";
import { formatResultCell } from "./format-result-cell";
import { JsonViewer } from "./json-viewer";
import { compareResultCells, resultCellSortText } from "./result-comparator";
import { ResultsAccessibility } from "./results-accessibility";
import { deleteRowsPrompt, ResultsCopy } from "./results-copy";
import { RowEditor } from "./row-editor";
import "./query-results.css";

export type RowReloadRecovery = {
  kind: "reloadFailed";
  message: string;
};

export function QueryResultsPane(props: {
  status: TabRunStatus;
  compact: TabResultGrid | null | undefined;
  raw?: TabResultGrid | null;
  dateFormat?: QueryResultsDateFormat;
  query?: string;
  sourceTable?: { schema?: string; name: string };
  columnMetadata?: ColumnInfo[];
  browse?: boolean;
  hasNextPage?: boolean;
  hasPrevPage?: boolean;
  onNextPage?: () => void;
  onPrevPage?: () => void;
  onUpdateRow?: (
    patch: Record<string, unknown | null>,
    primaryKey: Record<string, unknown>,
  ) => undefined | Promise<{ kind: "ok" } | RowReloadRecovery | undefined>;
  onDeleteRows?: (
    primaryKeys: Record<string, unknown>[],
  ) => undefined | Promise<{ kind: "ok" } | RowReloadRecovery | undefined>;
  onSaveCsv?: (csv: string) => void | Promise<void>;
  onRetryRowReload?: () => void | Promise<void>;
  browseLifecycle?: BrowseLifecycle;
  onBrowseTryAgain?: () => void;
  onBrowseReconnect?: () => void;
  onBrowseCancel?: () => void;
}): React.JSX.Element {
  const dateFormat = props.dateFormat ?? "iso8601";
  const timeoutContext = useContext(BrowseTimeoutContext);
  const browseLifecycle = props.browseLifecycle ?? timeoutContext?.lifecycle;
  const onBrowseTryAgain = props.onBrowseTryAgain ?? timeoutContext?.onTryAgain;
  const onBrowseReconnect = props.onBrowseReconnect ?? timeoutContext?.onReconnect;
  const onBrowseCancel = props.onBrowseCancel ?? timeoutContext?.onCancel;
  const [reloadRecovery, setReloadRecovery] = useState<RowReloadRecovery | null>(null);

  async function retryReload(): Promise<void> {
    try {
      await props.onRetryRowReload?.();
      setReloadRecovery(null);
    } catch {
      /* keep the reload-only alert; never repeat the mutation */
    }
  }

  return (
    <div className="query-results" data-testid={ResultsAccessibility.pane}>
      {renderPaneBody(props, dateFormat, setReloadRecovery)}
      {reloadRecovery ? (
        <div className="query-results__reload-recovery">
          <p
            className="query-results__dialog-error"
            role="alert"
            data-testid={ResultsAccessibility.rowOperationAlert}
          >
            {reloadRecovery.message}
          </p>
          <button
            type="button"
            className="query-results__btn query-results__btn--primary"
            data-testid={ResultsAccessibility.reloadRows}
            onClick={() => void retryReload()}
          >
            {ResultsCopy.reloadRows}
          </button>
        </div>
      ) : null}
      {browseLifecycle !== undefined &&
      onBrowseTryAgain !== undefined &&
      onBrowseReconnect !== undefined &&
      onBrowseCancel !== undefined ? (
        <BrowseTimeoutDialog
          lifecycle={browseLifecycle}
          onTryAgain={onBrowseTryAgain}
          onReconnect={onBrowseReconnect}
          onCancel={onBrowseCancel}
        />
      ) : null}
    </div>
  );
}

function renderPaneBody(
  props: Parameters<typeof QueryResultsPane>[0],
  dateFormat: QueryResultsDateFormat,
  onReloadFailed: (recovery: RowReloadRecovery) => void,
): React.JSX.Element {
  switch (props.status.kind) {
    case "idle":
      return (
        <p className="query-results__empty" data-testid={ResultsAccessibility.empty}>
          {ResultsCopy.runQueryEmpty}
        </p>
      );
    case "running":
      return (
        <p className="query-results__loading" data-testid={ResultsAccessibility.loading}>
          {ResultsCopy.loadingResults}
        </p>
      );
    case "error":
      return (
        <div className="query-results__error" data-testid={ResultsAccessibility.error}>
          <h2 className="query-results__error-title">{ResultsCopy.queryFailedTitle}</h2>
          <p className="query-results__error-message">{props.status.message}</p>
        </div>
      );
    case "cancelled":
      return (
        <p className="query-results__cancelled" data-testid={ResultsAccessibility.cancelled}>
          {SqlHatchCopy.queryCancelled}
        </p>
      );
    case "ok": {
      const hasResultColumns =
        (props.compact?.columns.length ?? props.raw?.columns.length ?? 0) > 0;
      const statementStatus = statementStatusCopy(props.status);
      if (!hasResultColumns) {
        return (
          <p className="query-results__empty">
            <span>{noColumnSuccessCopy(props.status.rowsAffected)}</span>
            {statementStatus === null ? null : (
              <>
                {"\u00a0"}
                <span className="ui-section-label">{statementStatus}</span>
              </>
            )}
          </p>
        );
      }
      return (
        <ResultGrid
          {...props}
          dateFormat={dateFormat}
          onReloadFailed={onReloadFailed}
          statementStatus={statementStatus}
        />
      );
    }
  }
}

function noColumnSuccessCopy(rowsAffected: number | null | undefined): string {
  if (rowsAffected === undefined || rowsAffected === null) return "Query finished.";
  const unit = rowsAffected === 1 ? "row" : "rows";
  return `Query finished. ${rowsAffected} ${unit} affected.`;
}

function statementStatusCopy(status: TabRunStatus): string | null {
  if (
    status.kind !== "ok" ||
    status.statementCount === undefined ||
    status.statementCount <= 1 ||
    status.statementIndex === undefined
  ) {
    return null;
  }
  return `Statement ${status.statementIndex} of ${status.statementCount}`;
}

function ResultGrid(
  props: Parameters<typeof QueryResultsPane>[0] & {
    dateFormat: QueryResultsDateFormat;
    onReloadFailed: (recovery: RowReloadRecovery) => void;
    statementStatus: string | null;
  },
): React.JSX.Element {
  const compact = props.compact;
  const columns = compact?.columns ?? [];
  const rows = compact?.rows ?? [];
  const rawGrid = props.raw;
  const dateFormat = props.dateFormat;
  const columnMetadata = props.columnMetadata ?? [];
  const pkColumns = columnMetadata
    .filter((column) => column.isPrimaryKey)
    .map((column) => column.name);

  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<{ column: number; dir: "asc" | "desc" } | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const browseContext = props.sourceTable;
  const hasPrimaryKeys = pkColumns.length > 0;
  const editability = determineEditability(
    props.query ?? "",
    browseContext ? { sourceTable: browseContext } : {},
  );
  let canEdit = false;
  let editTitle: string | undefined;
  if (browseContext === undefined) {
    editTitle = editability.isEditable ? "Can't Edit Query Results" : editability.reason?.title;
  } else if (!hasPrimaryKeys) {
    editTitle = "Can't Edit Query Results";
  } else if (editability.isEditable) {
    canEdit = true;
  } else {
    editTitle = editability.reason?.title;
  }

  const columnTypes = compact?.columnTypes ?? [];
  const visible = useMemo(
    () => visibleRows(rows, columns, columnTypes, filter, sort, dateFormat),
    [rows, columns, columnTypes, filter, sort, dateFormat],
  );

  function toggleSort(columnIndex: number): void {
    setSort((current) => {
      if (current === null || current.column !== columnIndex) {
        return { column: columnIndex, dir: "asc" };
      }
      return { column: columnIndex, dir: current.dir === "asc" ? "desc" : "asc" };
    });
  }

  function selectRow(originIndex: number, additive: boolean): void {
    setSelected((current) => {
      if (additive) {
        return current.includes(originIndex)
          ? current.filter((i) => i !== originIndex)
          : [...current, originIndex];
      }
      return [originIndex];
    });
  }

  function selectedRawRows(): unknown[][] {
    const source = rawGrid?.rows ?? [];
    return selected.map((index) => {
      const row = source[index];
      return Array.isArray(row) ? row : [];
    });
  }

  function selectedPrimaryKeys(): Record<string, unknown>[] {
    const source = rawGrid?.rows ?? rows;
    const cols = rawGrid?.columns ?? columns;
    const keys = selected.map((index) => primaryKeyOf(cols, source[index] ?? [], pkColumns));
    return keys.some((key) => key === null) ? [] : (keys as Record<string, unknown>[]);
  }

  const selectedPrimaryKeysAreSafe =
    selected.length > 0 && selectedPrimaryKeys().length === selected.length;

  function openJson(): void {
    if (selected.length === 0) return;
    setJsonOpen(true);
  }

  function downloadSelectedCsv(): void {
    const csv = toCsv(
      rawGrid?.columns ?? columns,
      selectedRawRows().map((row) => resultRowToCsvFields(row as ResultCell[])),
    );
    void props.onSaveCsv?.(csv);
  }

  function onRowKeyDown(event: React.KeyboardEvent<HTMLTableRowElement>, origin: number): void {
    if (event.key === "Enter") {
      selectRow(origin, event.metaKey || event.ctrlKey);
      return;
    }
    if (event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      selectRow(origin, false);
      setJsonOpen(true);
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      if (!canEdit || !selectedPrimaryKeysAreSafe) return;
      event.preventDefault();
      setDeleteOpen(true);
    }
  }

  async function confirmDelete(): Promise<void> {
    const primaryKeys = selectedPrimaryKeys();
    if (primaryKeys.length !== selected.length) {
      setDeleteOpen(false);
      return;
    }
    const outcome = await props.onDeleteRows?.(primaryKeys);
    setDeleteOpen(false);
    setSelected([]);
    if (outcome !== undefined && outcome.kind === "reloadFailed") {
      props.onReloadFailed(outcome);
    }
  }

  async function submitEdit(patch: Record<string, unknown | null>): Promise<void> {
    const keys = selectedPrimaryKeys();
    const pk = keys[0];
    if (pk === undefined) return;
    const outcome = await props.onUpdateRow?.(patch, pk);
    setEditorOpen(false);
    if (outcome !== undefined && outcome.kind === "reloadFailed") {
      props.onReloadFailed(outcome);
    }
  }

  const editorValues =
    selected[0] !== undefined ? (rawGrid?.rows[selected[0]] ?? rows[selected[0]]) : undefined;
  const editorColumns = metadataForResultColumns(rawGrid?.columns ?? columns, columnMetadata);

  return (
    <div className="query-results__grid-wrap" data-testid={ResultsAccessibility.grid}>
      <div className="query-results__chrome">
        <div className="ui-search query-results__search">
          <span className="ui-search__icon">
            <SearchIcon />
          </span>
          <input
            type="search"
            className="ui-search__input query-results__filter"
            placeholder={ResultsCopy.filterPlaceholder}
            aria-label={ResultsCopy.filterPlaceholder}
            data-testid={ResultsAccessibility.filter}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </div>
        {props.statementStatus === null ? null : (
          <p className="ui-section-label">{props.statementStatus}</p>
        )}
        {/* Row actions are icon-only: their labels only ever apply to a
            selection, so four text buttons stated four times what the grid
            already implies. aria-label keeps the copy constants intact. */}
        <div className="query-results__toolbar" data-testid={ResultsAccessibility.toolbar}>
          <button
            type="button"
            className="ui-icon-btn"
            aria-label={ResultsCopy.viewJson}
            title={ResultsCopy.viewJson}
            disabled={selected.length === 0 || !rawGrid}
            onClick={openJson}
          >
            <BracesIcon />
          </button>
          <button
            type="button"
            className="ui-icon-btn"
            aria-label={ResultsCopy.downloadCsv}
            title={ResultsCopy.downloadCsv}
            disabled={selected.length === 0 || !rawGrid}
            onClick={downloadSelectedCsv}
          >
            <DownloadIcon />
          </button>
          <button
            type="button"
            className="ui-icon-btn"
            aria-label={ResultsCopy.edit}
            disabled={!canEdit || !selectedPrimaryKeysAreSafe}
            title={canEdit ? ResultsCopy.edit : editTitle}
            onClick={() => setEditorOpen(true)}
          >
            <PencilIcon />
          </button>
          <button
            type="button"
            className="ui-icon-btn ui-icon-btn--danger"
            aria-label={ResultsCopy.delete}
            disabled={!canEdit || !selectedPrimaryKeysAreSafe}
            title={canEdit ? ResultsCopy.delete : editTitle}
            onClick={() => setDeleteOpen(true)}
          >
            <TrashIcon />
          </button>
        </div>
      </div>
      <div className="query-results__table-scroll">
        <table className="query-results__table">
          <thead>
            <tr>{headerCells(columns, sort, toggleSort)}</tr>
          </thead>
          <tbody>
            {bodyRows(columns, columnTypes, visible, selected, dateFormat, selectRow, onRowKeyDown)}
          </tbody>
        </table>
      </div>
      {rows.length === 0 ? (
        <p className="query-results__no-rows">{ResultsCopy.noRowsFound}</p>
      ) : null}
      {props.browse ? (
        <div className="query-results__pagination" data-testid={ResultsAccessibility.pagination}>
          <button
            type="button"
            className="query-results__btn"
            disabled={!props.hasPrevPage}
            onClick={props.onPrevPage}
          >
            {ResultsCopy.prevPage}
          </button>
          <button
            type="button"
            className="query-results__btn"
            disabled={!props.hasNextPage}
            onClick={props.onNextPage}
          >
            {ResultsCopy.nextPage}
          </button>
        </div>
      ) : null}
      {jsonOpen ? (
        <JsonViewer
          columns={rawGrid?.columns ?? columns}
          columnTypes={rawGrid?.columnTypes ?? columnTypes}
          rows={selectedRawRows()}
          onClose={() => setJsonOpen(false)}
          onSaveCsv={props.onSaveCsv}
        />
      ) : null}
      {editorOpen ? (
        <RowEditor
          selectedCount={selected.length}
          columns={editorColumns}
          values={Array.isArray(editorValues) ? editorValues : []}
          onSubmit={submitEdit}
          onCancel={() => setEditorOpen(false)}
        />
      ) : null}
      {deleteOpen ? (
        <div
          className="query-results__dialog"
          role="dialog"
          aria-modal="true"
          aria-label={deleteRowsPrompt(selected.length)}
        >
          <p className="query-results__dialog-body">{deleteRowsPrompt(selected.length)}</p>
          <div className="query-results__dialog-actions">
            <button
              type="button"
              className="query-results__btn query-results__btn--danger"
              onClick={() => void confirmDelete()}
            >
              {ResultsCopy.delete}
            </button>
            <button
              type="button"
              className="query-results__btn"
              onClick={() => setDeleteOpen(false)}
            >
              {ResultsCopy.cancel}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

type VisibleRow = { origin: number; cells: ResultCell[] };

function visibleRows(
  rows: ResultCell[][],
  columns: string[],
  columnTypes: ResultColumn[],
  filter: string,
  sort: { column: number; dir: "asc" | "desc" } | null,
  dateFormat: QueryResultsDateFormat,
): VisibleRow[] {
  const needle = filter.trim().toLowerCase();
  const listed: VisibleRow[] = [];
  for (const [origin, row] of rows.entries()) {
    const cells = Array.isArray(row) ? row : [];
    if (needle !== "" && !rowMatches(cells, columns, columnTypes, needle, dateFormat)) continue;
    listed.push({ origin, cells });
  }
  if (sort === null) return listed;
  const { column, dir } = sort;
  return listed
    .slice()
    .sort((a, b) => compareCells(a.cells[column], b.cells[column], columnTypes[column], dir));
}

function rowMatches(
  cells: ResultCell[],
  columns: string[],
  columnTypes: ResultColumn[],
  needle: string,
  dateFormat: QueryResultsDateFormat,
): boolean {
  for (const [index] of columns.entries()) {
    const cell = cells[index];
    const columnMetadata = columnTypes[index];
    const displayed = formatResultCell(cell, columnMetadata, dateFormat).toLowerCase();
    const raw = resultCellSortText(cell).toLowerCase();
    if (displayed.includes(needle) || raw.includes(needle)) {
      return true;
    }
  }
  return false;
}

function compareCells(
  a: unknown,
  b: unknown,
  columnMetadata: ResultColumn | undefined,
  dir: "asc" | "desc",
): number {
  const cmp = compareResultCells(a, b, columnMetadata);
  return dir === "asc" ? cmp : -cmp;
}

function headerCells(
  columns: string[],
  sort: { column: number; dir: "asc" | "desc" } | null,
  onSort: (columnIndex: number) => void,
): React.JSX.Element[] {
  const cells: React.JSX.Element[] = [];
  for (const [columnIndex, column] of columns.entries()) {
    const ariaSort =
      sort?.column === columnIndex ? (sort.dir === "asc" ? "ascending" : "descending") : "none";
    cells.push(
      <th
        key={`col-${columnIndex}`}
        scope="col"
        aria-sort={ariaSort}
        onClick={() => onSort(columnIndex)}
      >
        {column}
        {ariaSort === "none" ? null : (
          <span className="query-results__sort-glyph">
            {ariaSort === "ascending" ? <SortAscIcon /> : <SortDescIcon />}
          </span>
        )}
      </th>,
    );
  }
  return cells;
}

function bodyRows(
  columns: string[],
  columnTypes: ResultColumn[],
  visible: VisibleRow[],
  selected: number[],
  dateFormat: QueryResultsDateFormat,
  onSelect: (origin: number, additive: boolean) => void,
  onRowKeyDown: (event: React.KeyboardEvent<HTMLTableRowElement>, origin: number) => void,
): React.JSX.Element[] {
  const elements: React.JSX.Element[] = [];
  for (const row of visible) {
    const cells: React.JSX.Element[] = [];
    for (const [cellIndex, column] of columns.entries()) {
      cells.push(
        <td key={`${column}-${cellIndex}`}>
          {renderResultCellText(row.cells[cellIndex], columnTypes[cellIndex], dateFormat)}
        </td>,
      );
    }
    const isSelected = selected.includes(row.origin);
    elements.push(
      <tr
        key={`row-${row.origin}`}
        tabIndex={0}
        aria-selected={isSelected}
        className={isSelected ? "query-results__row--selected" : undefined}
        onClick={(event) => onSelect(row.origin, event.metaKey || event.ctrlKey)}
        onKeyDown={(event) => onRowKeyDown(event, row.origin)}
      >
        {cells}
      </tr>,
    );
  }
  return elements;
}

function renderResultCellText(
  cell: ResultCell | undefined,
  columnMetadata: ResultColumn | undefined,
  dateFormat: QueryResultsDateFormat,
): string {
  return formatResultCell(cell, columnMetadata, dateFormat);
}

function metadataForResultColumns(resultColumns: string[], metadata: ColumnInfo[]): ColumnInfo[] {
  const byName = new Map(metadata.map((column) => [column.name, column]));
  return resultColumns.map(
    (name) =>
      byName.get(name) ?? {
        name,
        dataType: "text",
        isNullable: false,
        defaultValue: null,
        isPrimaryKey: false,
        isUnique: false,
        isForeignKey: false,
      },
  );
}

function primaryKeyOf(
  columns: string[],
  row: unknown[],
  pkColumns: string[],
): Record<string, unknown> | null {
  const pk: Record<string, unknown> = {};
  for (const name of pkColumns) {
    const index = columns.indexOf(name);
    const cell = index === -1 ? null : (row[index] ?? null);
    if (!isValueCell(cell)) return null;
    pk[name] = cell.text;
  }
  return pk;
}
