/** Persist query-results date format radios (Swift QueryResultsDateFormat raw values). */
export const DATE_FORMAT_STORAGE_KEY = "dragondb.queryResultsDateFormat";

export const DATE_FORMAT_VALUES = [
  "iso8601",
  "iso8601DateOnly",
  "us",
  "european",
  "relative",
] as const;

export type QueryResultsDateFormat = (typeof DATE_FORMAT_VALUES)[number];

const DATE_FORMAT_SET: ReadonlySet<string> = new Set(DATE_FORMAT_VALUES);

function isDateFormat(value: string | null): value is QueryResultsDateFormat {
  return value !== null && DATE_FORMAT_SET.has(value);
}

export function loadDateFormat(): QueryResultsDateFormat {
  const stored = localStorage.getItem(DATE_FORMAT_STORAGE_KEY);
  return isDateFormat(stored) ? stored : "iso8601";
}

export function saveDateFormat(value: QueryResultsDateFormat): void {
  localStorage.setItem(DATE_FORMAT_STORAGE_KEY, value);
}
