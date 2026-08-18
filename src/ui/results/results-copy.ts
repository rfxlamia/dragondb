/** English chrome copy for the query results pane. */
export const ResultsCopy = {
  runQueryEmpty: "Run a query to see results",
  noRowsFound: "No rows found",
  loadingResults: "Loading results...",
  queryFailedTitle: "Query Failed",
  nullToken: "NULL",
  multipleRowsSelected: "Multiple Rows Selected",
  selectOnlyOneRow: "Please select only one row to edit at a time.",
  filterPlaceholder: "Filter results",
  viewJson: "View JSON",
  copyJson: "Copy JSON",
  copied: "Copied",
  downloadCsv: "Download CSV",
  edit: "Edit",
  delete: "Delete",
  save: "Save",
  cancel: "Cancel",
  setNull: "NULL",
  primaryKey: "Primary key",
  setNullFor(columnName: string): string {
    return `Set ${columnName} to NULL`;
  },
  nextPage: "Next",
  prevPage: "Previous",
  tryAgain: "Try Again",
  reconnect: "Reconnect",
  browseTimeoutTitle: "Table load timed out",
  browseTimeoutBody:
    "This table took too long to load. Wait for the request to cancel, then try again.",
} as const;

export function deleteRowsPrompt(count: number): string {
  return `Delete ${count} row(s)?`;
}
