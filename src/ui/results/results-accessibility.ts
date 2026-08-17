/** Stable accessibility identifiers for the query results pane. */
export const ResultsAccessibility = {
  pane: "queryResults.pane",
  grid: "queryResults.grid",
  loading: "queryResults.loading",
  error: "queryResults.error",
  empty: "queryResults.empty",
  cancelled: "queryResults.cancelled",
  splitSeparator: "queryResults.splitSeparator",
  filter: "queryResults.filter",
  toolbar: "queryResults.toolbar",
  jsonViewer: "queryResults.jsonViewer",
  rowEditor: "queryResults.rowEditor",
  pagination: "queryResults.pagination",
  get allIdentifiers() {
    return [
      ResultsAccessibility.pane,
      ResultsAccessibility.grid,
      ResultsAccessibility.loading,
      ResultsAccessibility.error,
      ResultsAccessibility.empty,
      ResultsAccessibility.cancelled,
      ResultsAccessibility.splitSeparator,
      ResultsAccessibility.filter,
      ResultsAccessibility.toolbar,
      ResultsAccessibility.jsonViewer,
      ResultsAccessibility.rowEditor,
      ResultsAccessibility.pagination,
    ];
  },
} as const;
