import type { TableRef } from "../ipc/contract";

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

/** Schema-qualified identifier for browse SELECT, matching table-list quoting. */
export function quotedBrowseTableSql(table: TableRef): string {
  const name = quoteIdentifier(table.name);
  return table.schema ? `${quoteIdentifier(table.schema)}.${name}` : name;
}

/**
 * LIMIT/OFFSET without ORDER BY has no defined row order in PostgreSQL, so
 * paging through a browse could show the same row twice or skip one whenever
 * the plan changed or another session wrote to the table.
 *
 * The primary key is the stable ordering when the table has one. Without a
 * primary key, a heap table can still be ordered by `ctid`; a foreign table
 * has no `ctid`, and ordering by it would fail the query outright, so those
 * keep the unordered scan rather than breaking browse.
 */
export function browsePageSql(args: {
  table: TableRef;
  page: number;
  pageSize: number;
  primaryKeyColumns: string[];
}): string {
  const { table, page, pageSize, primaryKeyColumns } = args;
  const orderBy = browseOrderByClause(table, primaryKeyColumns);
  // One row past the page is fetched to decide `hasNext`.
  return `SELECT * FROM ${quotedBrowseTableSql(table)}${orderBy} LIMIT ${pageSize + 1} OFFSET ${page * pageSize}`;
}

function browseOrderByClause(table: TableRef, primaryKeyColumns: string[]): string {
  if (primaryKeyColumns.length > 0) {
    return ` ORDER BY ${primaryKeyColumns.map(quoteIdentifier).join(", ")}`;
  }
  return table.tableType === "foreign" ? "" : " ORDER BY ctid";
}
