function row(id: string): string {
  return `history.row.${id}`;
}

function copy(id: string): string {
  return `history.copy.${id}`;
}

function sql(id: string): string {
  return `history.sql.${id}`;
}

/** Stable accessibility identifiers for the query history sheet. */
export const HistoryAccessibility = {
  sheet: "history.sheet",
  export: "history.export",
  done: "history.done",
  loadError: "history.loadError",
  row,
  copy,
  sql,
} as const;
