import type { ResultColumn } from "../../ipc/contract";
import { categorizeColumnType } from "../../lib/column-type";
import type { QueryResultsDateFormat } from "../../lib/date-format-setting";
import { formatQueryDate } from "../../lib/format-query-date";
import {
  isNullCell,
  isTruncatedCell,
  isUnreadableCell,
  isValueCell,
  UNREADABLE_EXPORT_SENTINEL,
} from "../../lib/result-cell";
import { TRUNCATION_SUFFIX } from "../../lib/result-compactor";
import { ResultsCopy } from "./results-copy";

function usesDateFormatting(columnMetadata: ResultColumn | undefined): boolean {
  if (columnMetadata === undefined) return false;
  const { category } = categorizeColumnType(columnMetadata.typeOid);
  return category === "date" || category === "timestamp" || category === "timestamptz";
}

function formatValueText(
  text: string,
  columnMetadata: ResultColumn | undefined,
  dateFormat: QueryResultsDateFormat,
): string {
  if (!usesDateFormatting(columnMetadata)) return text;
  return formatQueryDate(text, dateFormat);
}

/** Format a compact-grid cell for display. SQL null is the NULL token; false/0/"" stay themselves. */
export function formatResultCell(
  value: unknown,
  columnMetadata: ResultColumn | undefined,
  dateFormat: QueryResultsDateFormat = "iso8601",
): string {
  if (isNullCell(value) || value === undefined) {
    return ResultsCopy.nullToken;
  }
  if (isUnreadableCell(value)) {
    return UNREADABLE_EXPORT_SENTINEL;
  }
  if (isTruncatedCell(value)) {
    return value.text + TRUNCATION_SUFFIX;
  }
  if (isValueCell(value)) {
    return formatValueText(value.text, columnMetadata, dateFormat);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    return String(value);
  }
  const text = typeof value === "string" ? value : String(value);
  return formatValueText(text, columnMetadata, dateFormat);
}
