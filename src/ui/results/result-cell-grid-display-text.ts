import type { ResultColumn } from "../../ipc/contract";
import type { QueryResultsDateFormat } from "../../lib/date-format-setting";
import { isUnreadableCell } from "../../lib/result-cell";
import { formatResultCell } from "./format-result-cell";
import { ResultsCopy } from "./results-copy";

/** Text shown in the results grid for a cell (badges and client-side filter). */
export function resultCellGridDisplayText(
  cell: unknown,
  columnMetadata: ResultColumn | undefined,
  dateFormat: QueryResultsDateFormat = "iso8601",
): string {
  if (isUnreadableCell(cell)) {
    return ResultsCopy.unreadableBadge;
  }
  return formatResultCell(cell, columnMetadata, dateFormat);
}
