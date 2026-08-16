import type { QueryResultsDateFormat } from "./date-format-setting";

/** Swift QueryResultsDateFormat parse cap — longer strings are left unchanged. */
export const DATE_PARSE_MAX_CHARS = 64;

const ISO_DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/;

/**
 * Format a compact-grid cell with the Settings date pattern.
 * Parse guards live here so callers (formatResultCell) do not duplicate them.
 */
export function formatQueryDate(value: string, format: QueryResultsDateFormat): string {
  const date = parseQueryDate(value);
  if (date === null) return value;
  switch (format) {
    case "iso8601":
      return value;
    case "iso8601DateOnly":
      return utcYmd(date);
    case "us":
      return `${date.getUTCMonth() + 1}/${date.getUTCDate()}/${date.getUTCFullYear()}`;
    case "european":
      return `${date.getUTCDate()}/${date.getUTCMonth() + 1}/${date.getUTCFullYear()}`;
    case "relative":
      return relativeFrom(date.getTime());
  }
}

function parseQueryDate(value: string): Date | null {
  if (value.length === 0 || value.length > DATE_PARSE_MAX_CHARS) return null;
  if (!ISO_DATE_PREFIX.test(value)) return null;
  const normalized = value.includes(" ") ? value.replace(" ", "T") : value;
  const ms = Date.parse(normalized);
  if (Number.isNaN(ms)) return null;
  return new Date(ms);
}

function utcYmd(date: Date): string {
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

function relativeFrom(thenMs: number, nowMs: number = Date.now()): string {
  const diffMs = nowMs - thenMs;
  const minutes = Math.round(diffMs / 60_000);
  if (Math.abs(minutes) < 1) return "just now";
  if (Math.abs(minutes) < 60) {
    const n = Math.abs(minutes);
    return n === 1 ? "1 minute ago" : `${n} minutes ago`;
  }
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) {
    const n = Math.abs(hours);
    return n === 1 ? "1 hour ago" : `${n} hours ago`;
  }
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) {
    const n = Math.abs(days);
    return n === 1 ? "1 day ago" : `${n} days ago`;
  }
  const months = Math.round(days / 30);
  if (Math.abs(months) < 12) {
    const n = Math.abs(months);
    return n === 1 ? "1 month ago" : `${n} months ago`;
  }
  const years = Math.max(1, Math.abs(Math.round(days / 365)));
  return years === 1 ? "1 year ago" : `${years} years ago`;
}
