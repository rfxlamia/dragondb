import type { ExecutableSQL } from "../core";
import type { ColumnInfo, ConnectionId, DragonIpc, QueryResult, TableRef } from "./contract";

export const FIXTURE_CONNECTION_ID: ConnectionId = "fixture";

export type MockMode = "happy" | "emptyTables" | "emptyColumns" | "columnsError";

const USERS_COLUMNS: ColumnInfo[] = [
  {
    name: "id",
    dataType: "integer",
    isNullable: false,
    defaultValue: null,
    isPrimaryKey: true,
    isUnique: true,
    isForeignKey: false,
  },
  {
    name: "name",
    dataType: "text",
    isNullable: false,
    defaultValue: null,
    isPrimaryKey: false,
    isUnique: false,
    isForeignKey: false,
  },
  {
    name: "email",
    dataType: "text",
    isNullable: true,
    defaultValue: null,
    isPrimaryKey: false,
    isUnique: true,
    isForeignKey: false,
  },
  {
    name: "created_at",
    dataType: "timestamp",
    isNullable: false,
    defaultValue: "now()",
    isPrimaryKey: false,
    isUnique: false,
    isForeignKey: false,
  },
];

const EVENTS_COLUMNS: ColumnInfo[] = [
  {
    name: "event_id",
    dataType: "uuid",
    isNullable: false,
    defaultValue: null,
    isPrimaryKey: true,
    isUnique: true,
    isForeignKey: false,
  },
];

const HAPPY_TABLES: TableRef[] = [
  { schema: "public", name: "users" },
  { schema: "analytics", name: "events" },
];

const HAPPY_COLUMNS: Record<string, ColumnInfo[]> = {
  "public:users": USERS_COLUMNS,
  "analytics:events": EVENTS_COLUMNS,
};

function tableKey(table: TableRef): string {
  const schema = table.schema ?? "public";
  return `${schema}:${table.name}`;
}

function emptyQueryResult(): QueryResult {
  return {
    columns: [],
    rows: [],
    rowsAffected: null,
    durationMs: 0,
  };
}

export function createMockDragonIpc(mode: MockMode = "happy"): DragonIpc {
  return {
    async listTables(_c: ConnectionId): Promise<TableRef[]> {
      if (mode === "emptyTables") return [];
      return HAPPY_TABLES;
    },

    async listColumns(_c: ConnectionId, table: TableRef): Promise<ColumnInfo[]> {
      if (mode === "columnsError") {
        throw new Error("columns failed");
      }
      if (mode === "emptyColumns") return [];
      return HAPPY_COLUMNS[tableKey(table)] ?? [];
    },

    async runQuery(_c: ConnectionId, _sql: ExecutableSQL): Promise<QueryResult> {
      return emptyQueryResult();
    },
  };
}
