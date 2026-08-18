import { useContext, useMemo, useState } from "react";
import { toCsv } from "../../lib/csv-exporter";
import type { QueryResultsDateFormat } from "../../lib/date-format-setting";
import { determineEditability } from "../../lib/query-editability";
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
import { ResultsAccessibility } from "./results-accessibility";
import { deleteRowsPrompt, ResultsCopy } from "./results-copy";
import { RowEditor } from "./row-editor";
import "./query-results.css";

export function QueryResultsPane(props: {
  status: TabRunStatus;
  compact: TabResultGrid | null | undefined;
  raw?: TabResultGrid | null;
  dateFormat?: QueryResultsDateFormat;
  query?: string;
  sourceTable?: { schema?: string; name: string };
  primaryKeyColumns?: string[];
  browse?: boolean;
  hasNextPage?: boolean;
  hasPrevPage?: boolean;
  onNextPage?: () => void;
  onPrevPage?: () => void;
  onUpdateRow?: (
    patch: Record<string, unknown | null>,
    primaryKey: Record<string, unknown>,
  ) => void | Promise<void>;
  onDeleteRows?: (primaryKeys: Record<string, unknown>[]) => void | Promise<void>;
  onSaveCsv?: (csv: string) => void | Promise<void>;
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
  return (
    <div className="query-results" data-testid={ResultsAccessibility.pane}>
      {renderPaneBody(props, dateFormat)}
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
    case "ok":
      return <ResultGrid {...props} dateFormat={dateFormat} />;
  }
}

function ResultGrid(
  props: Parameters<typeof QueryResultsPane>[0] & { dateFormat: QueryResultsDateFormat },
): React.JSX.Element {
  const compact = props.compact;
  const columns = compact?.columns ?? [];
  const rows = compact?.rows ?? [];
  const rawGrid = props.raw;
  const dateFormat = props.dateFormat;
  const pkColumns = props.primaryKeyColumns ?? [];

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

  const visible = useMemo(
    () => visibleRows(rows, columns, filter, sort, dateFormat),
    [rows, columns, filter, sort, dateFormat],
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
    return selected.map((index) => primaryKeyOf(cols, source[index] ?? [], pkColumns));
  }

  function openJson(): void {
    if (selected.length === 0) return;
    setJsonOpen(true);
  }

  function downloadSelectedCsv(): void {
    const csv = toCsv(rawGrid?.columns ?? columns, selectedRawRows().map(rowToCsvFields));
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
      if (!canEdit || selected.length === 0) return;
      event.preventDefault();
      setDeleteOpen(true);
    }
  }

  async function confirmDelete(): Promise<void> {
    await props.onDeleteRows?.(selectedPrimaryKeys());
    setDeleteOpen(false);
    setSelected([]);
  }

  async function submitEdit(patch: Record<string, unknown | null>): Promise<void> {
    const keys = selectedPrimaryKeys();
    const pk = keys[0];
    if (pk === undefined) return;
    await props.onUpdateRow?.(patch, pk);
    setEditorOpen(false);
  }

  const editorValues =
    selected[0] !== undefined ? (rawGrid?.rows[selected[0]] ?? rows[selected[0]]) : undefined;

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
            disabled={!canEdit || selected.length === 0}
            title={canEdit ? ResultsCopy.edit : editTitle}
            onClick={() => setEditorOpen(true)}
          >
            <PencilIcon />
          </button>
          <button
            type="button"
            className="ui-icon-btn ui-icon-btn--danger"
            aria-label={ResultsCopy.delete}
            disabled={!canEdit || selected.length === 0}
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
          <tbody>{bodyRows(columns, visible, selected, dateFormat, selectRow, onRowKeyDown)}</tbody>
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
          rows={selectedRawRows()}
          onClose={() => setJsonOpen(false)}
          onSaveCsv={props.onSaveCsv}
        />
      ) : null}
      {editorOpen ? (
        <RowEditor
          selectedCount={selected.length}
          columns={rawGrid?.columns ?? columns}
          values={Array.isArray(editorValues) ? editorValues : []}
          pkColumns={pkColumns}
          onSubmit={(patch) => void submitEdit(patch)}
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

type VisibleRow = { origin: number; cells: unknown[] };

function visibleRows(
  rows: unknown[][],
  columns: string[],
  filter: string,
  sort: { column: number; dir: "asc" | "desc" } | null,
  dateFormat: QueryResultsDateFormat,
): VisibleRow[] {
  const needle = filter.trim().toLowerCase();
  const listed: VisibleRow[] = [];
  for (const [origin, row] of rows.entries()) {
    const cells = Array.isArray(row) ? row : [];
    if (needle !== "" && !rowMatches(cells, columns, needle, dateFormat)) continue;
    listed.push({ origin, cells });
  }
  if (sort === null) return listed;
  const { column, dir } = sort;
  return listed.slice().sort((a, b) => compareCells(a.cells[column], b.cells[column], dir));
}

function rowMatches(
  cells: unknown[],
  columns: string[],
  needle: string,
  dateFormat: QueryResultsDateFormat,
): boolean {
  for (const [index] of columns.entries()) {
    if (formatResultCell(cells[index], dateFormat).toLowerCase().includes(needle)) return true;
  }
  return false;
}

function compareCells(a: unknown, b: unknown, dir: "asc" | "desc"): number {
  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  const cmp = compareNonNull(a, b);
  return dir === "asc" ? cmp : -cmp;
}

function compareNonNull(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
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
          {formatResultCell(row.cells[cellIndex], dateFormat)}
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

function primaryKeyOf(
  columns: string[],
  row: unknown[],
  pkColumns: string[],
): Record<string, unknown> {
  const pk: Record<string, unknown> = {};
  for (const name of pkColumns) {
    const index = columns.indexOf(name);
    pk[name] = index === -1 ? null : (row[index] ?? null);
  }
  return pk;
}

function rowToCsvFields(row: unknown[]): Array<string | null> {
  return row.map((cell) => {
    if (cell === null || cell === undefined) return null;
    if (typeof cell === "string") return cell;
    return String(cell);
  });
}
