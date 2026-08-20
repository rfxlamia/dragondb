/** Stable accessibility identifiers for the table browser. */
export const TablesAccessibility = {
  list: "tables.list",
  ddlSheet: "tables.ddlSheet",
  ddlText: "tables.ddlText",
  exportSheet: "tables.exportSheet",
  menu: "tables.menu",
  search: "tables.search",
  schemaToggle: (schema: string) => `tables.schemaToggle.${schema}`,
  schemaPicker: "tables.schemaPicker",
} as const;
