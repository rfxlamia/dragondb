import type { QueryResultsDateFormat } from "../../lib/date-format-setting";
import { formatQueryDate } from "../../lib/format-query-date";
import { ResultsCopy } from "./results-copy";

/** Format a compact-grid cell for display. SQL null is the NULL token; false/0/"" stay themselves. */
export function formatResultCell(
  value: unknown,
  dateFormat: QueryResultsDateFormat = "iso8601",
): string {
  if (value === null || value === undefined) {
    return ResultsCopy.nullToken;
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    return String(value);
  }
  const text = typeof value === "string" ? value : String(value);
  return formatQueryDate(text, dateFormat);
}
