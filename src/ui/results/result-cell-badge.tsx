import type { ResultCell, ResultColumn } from "../../ipc/contract";
import type { QueryResultsDateFormat } from "../../lib/date-format-setting";
import { isNullCell, isTruncatedCell, isUnreadableCell } from "../../lib/result-cell";
import { TRUNCATION_SUFFIX } from "../../lib/result-compactor";
import { formatResultCell } from "./format-result-cell";
import { resultCellGridDisplayText } from "./result-cell-grid-display-text";
import { ResultsCopy } from "./results-copy";

export function ResultCellBadge(props: {
  cell: ResultCell | undefined;
  columnMetadata: ResultColumn | undefined;
  dateFormat: QueryResultsDateFormat;
}): React.JSX.Element {
  const { cell, columnMetadata, dateFormat } = props;

  if (isUnreadableCell(cell)) {
    return (
      <span
        role="img"
        className="query-results__cell-badge query-results__cell-badge--error"
        aria-label={ResultsCopy.unreadableAccessibleName(cell.typeName)}
      >
        {resultCellGridDisplayText(cell, columnMetadata, dateFormat)}
      </span>
    );
  }

  if (isTruncatedCell(cell)) {
    return (
      <>
        {cell.text}
        <span className="query-results__cell-badge query-results__cell-badge--warning">
          {TRUNCATION_SUFFIX}
        </span>
      </>
    );
  }

  if (isNullCell(cell) || cell === undefined) {
    return <span className="query-results__cell-null">{ResultsCopy.nullToken}</span>;
  }

  return <>{formatResultCell(cell, columnMetadata, dateFormat)}</>;
}
