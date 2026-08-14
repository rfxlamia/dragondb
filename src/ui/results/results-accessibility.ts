/** Stable accessibility identifiers for the query results pane. */
export const ResultsAccessibility = {
  pane: "queryResults.pane",
  grid: "queryResults.grid",
  loading: "queryResults.loading",
  error: "queryResults.error",
  empty: "queryResults.empty",
  splitSeparator: "queryResults.splitSeparator",
  get allIdentifiers() {
    return [
      ResultsAccessibility.pane,
      ResultsAccessibility.grid,
      ResultsAccessibility.loading,
      ResultsAccessibility.error,
      ResultsAccessibility.empty,
      ResultsAccessibility.splitSeparator,
    ];
  },
} as const;
