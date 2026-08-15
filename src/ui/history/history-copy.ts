/** English chrome copy for the query history sheet. */
export function formatRelativeDate(iso: string, nowMs: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const diffMs = nowMs - then;
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
  const years = Math.round(days / 365);
  const n = Math.max(1, Math.abs(years));
  return n === 1 ? "1 year ago" : `${n} years ago`;
}

export const HistoryCopy = {
  empty: "No Query History",
  emptyHint: "Executed queries will appear here.",
  export: "Export",
  exportJson: "Export JSON",
  exportCsv: "Export CSV",
  exportSql: "Export SQL",
  done: "Done",
  copy: "Copy",
  success: "Success",
  failed: "Failed",
  databaseNa: "N/A",
  formatRelativeDate,
} as const;
