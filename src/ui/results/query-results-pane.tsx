import type { TabResultGrid, TabRunStatus } from "../../stores/tabs-store";
import { formatResultCell } from "./format-result-cell";
import { ResultsAccessibility } from "./results-accessibility";
import { ResultsCopy } from "./results-copy";
import "./query-results.css";

export function QueryResultsPane(props: {
  status: TabRunStatus;
  compact: TabResultGrid | null | undefined;
}): React.JSX.Element {
  return (
    <div className="query-results" data-testid={ResultsAccessibility.pane}>
      {renderPaneBody(props.status, props.compact)}
    </div>
  );
}

function renderPaneBody(
  status: TabRunStatus,
  compact: TabResultGrid | null | undefined,
): React.JSX.Element {
  switch (status.kind) {
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
          <p className="query-results__error-message">{status.message}</p>
        </div>
      );
    case "ok":
      return <ResultGrid compact={compact} />;
  }
}

function ResultGrid(props: { compact: TabResultGrid | null | undefined }): React.JSX.Element {
  const columns = props.compact?.columns ?? [];
  const rows = props.compact?.rows ?? [];

  return (
    <div className="query-results__grid-wrap" data-testid={ResultsAccessibility.grid}>
      <table className="query-results__table">
        <thead>
          <tr>{headerCells(columns)}</tr>
        </thead>
        <tbody>{bodyRows(columns, rows)}</tbody>
      </table>
      {rows.length === 0 ? (
        <p className="query-results__no-rows">{ResultsCopy.noRowsFound}</p>
      ) : null}
    </div>
  );
}

function headerCells(columns: string[]): React.JSX.Element[] {
  const cells: React.JSX.Element[] = [];
  for (const [columnIndex, column] of columns.entries()) {
    cells.push(
      <th key={`col-${columnIndex}`} scope="col">
        {column}
      </th>,
    );
  }
  return cells;
}

function bodyRows(columns: string[], rows: unknown[][]): React.JSX.Element[] {
  const elements: React.JSX.Element[] = [];
  for (const [rowIndex, row] of rows.entries()) {
    const cells: React.JSX.Element[] = [];
    for (const [cellIndex, cell] of row.entries()) {
      const column = columns[cellIndex] ?? `col-${cellIndex}`;
      cells.push(<td key={`${column}-${cellIndex}`}>{formatResultCell(cell)}</td>);
    }
    elements.push(<tr key={`row-${rowIndex}`}>{cells}</tr>);
  }
  return elements;
}
