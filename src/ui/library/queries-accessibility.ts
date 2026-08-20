/** Stable accessibility identifiers for the Queries column. */
export const QueriesAccessibility = {
  column: "queries.column",
  newQuery: "queries.newQuery",
  filter: "queries.filter",
  refresh: "queries.refresh",
  deselect: "queries.deselect",
  refreshOverlay: "queries.refreshOverlay",
  folder: (id: string) => `queries.folder.${id}`,
  cacheDot: (id: string) => `queries.cache.${id}`,
  executing: (id: string) => `queries.executing.${id}`,
} as const;
