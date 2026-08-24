import type { QueryResultsDateFormat } from "./date-format-setting";

/** Swift QueryResultsDateFormat parse cap — longer strings are left unchanged. */
export const DATE_PARSE_MAX_CHARS = 64;

const ISO_DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/;
const POSTGRES_OFFSET = /(?:[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?)(?:Z|[+-]\d{2}(?::\d{2})?)$/i;

type CalendarDate = { year: number; month: number; day: number };

type ParsedQueryDate = {
  instant: Date;
  calendar: CalendarDate;
};

/**
 * Format a compact-grid cell with the Settings date pattern.
 * Parse guards live here so callers (formatResultCell) do not duplicate them.
 */
export function formatQueryDate(value: string, format: QueryResultsDateFormat): string {
  const parsed = parseQueryDate(value);
  if (parsed === null) return value;
  switch (format) {
    case "iso8601":
      return value;
    case "iso8601DateOnly":
      return formatYmd(parsed.calendar);
    case "us":
      return `${parsed.calendar.month}/${parsed.calendar.day}/${parsed.calendar.year}`;
    case "european":
      return `${parsed.calendar.day}/${parsed.calendar.month}/${parsed.calendar.year}`;
    case "relative":
      return relativeFrom(parsed.instant.getTime());
  }
}

const NAIVE_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?)?$/;

function parseQueryDate(value: string): ParsedQueryDate | null {
  if (value.length === 0 || value.length > DATE_PARSE_MAX_CHARS) return null;
  if (!ISO_DATE_PREFIX.test(value)) return null;
  const normalized = value.includes(" ") ? value.replace(" ", "T") : value;
  if (!POSTGRES_OFFSET.test(normalized)) {
    const naive = NAIVE_TIMESTAMP.exec(normalized);
    if (naive === null) return null;
    const calendar = calendarFromMatch(naive);
    const instant = new Date(
      Date.UTC(
        calendar.year,
        calendar.month - 1,
        calendar.day,
        calendar.hour,
        calendar.minute,
        calendar.second,
      ),
    );
    return { instant, calendar: { year: calendar.year, month: calendar.month, day: calendar.day } };
  }
  const withOffset = NAIVE_TIMESTAMP.exec(normalized.replace(POSTGRES_OFFSET, ""));
  if (withOffset === null) return null;
  const calendar = calendarFromMatch(withOffset);
  const parseable = normalizePostgresOffset(normalized);
  const ms = Date.parse(parseable);
  if (Number.isNaN(ms)) return null;
  return {
    instant: new Date(ms),
    calendar: { year: calendar.year, month: calendar.month, day: calendar.day },
  };
}

function calendarFromMatch(match: RegExpExecArray): CalendarDate & {
  hour: number;
  minute: number;
  second: number;
} {
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4] ?? "0"),
    minute: Number(match[5] ?? "0"),
    second: Number(match[6] ?? "0"),
  };
}

/** PostgreSQL whole-hour offsets (`+07`) need `:00` for Date.parse. */
function normalizePostgresOffset(value: string): string {
  return value.replace(/([+-]\d{2})$/, "$1:00");
}

function formatYmd(calendar: CalendarDate): string {
  const month = String(calendar.month).padStart(2, "0");
  const day = String(calendar.day).padStart(2, "0");
  return `${calendar.year}-${month}-${day}`;
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
