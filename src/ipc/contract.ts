import type { ExecutableSQL } from "../core";

export type ConnectionId = string;

export interface TableRef {
  schema?: string;
  name: string;
}

export interface ColumnInfo {
  name: string;
  dataType: string;
  isNullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
  isUnique: boolean;
  isForeignKey: boolean;
}

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  rowsAffected: number | null;
  durationMs: number;
}

export type IpcError =
  | { kind: "connection"; message: string }
  | { kind: "auth"; message: string }
  | { kind: "syntax"; message: string; position: number | null }
  | { kind: "permission"; message: string }
  | { kind: "unknown"; message: string };

export interface DragonIpc {
  listTables(c: ConnectionId): Promise<TableRef[]>;
  listColumns(c: ConnectionId, table: TableRef): Promise<ColumnInfo[]>;
  runQuery(c: ConnectionId, sql: ExecutableSQL): Promise<QueryResult>;
}
