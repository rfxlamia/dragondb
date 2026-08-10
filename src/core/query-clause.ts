/** Domain types for the visual query builder block document */

export type StatementKind = "select" | "createTable" | "update" | "delete";

export type ClauseKind = "select" | "from" | "where" | "orderBy" | "limit" | "join";

export type WhereOperator =
  | "equals"
  | "notEquals"
  | "greaterThan"
  | "lessThan"
  | "contains"
  | "isEmpty";

export type OrderDirection = "asc" | "desc";

export type CreateColumnType = "text" | "number" | "date" | "boolean";

export interface CreateColumn {
  name: string;
  type: CreateColumnType;
}

export interface TableReference {
  schema: string | null;
  name: string;
}

export interface WhereCondition {
  column: string;
  op: WhereOperator;
  value: string | null;
}

export interface OrderBy {
  column: string;
  direction: OrderDirection;
}

export type SelectProjection = { kind: "allColumns" } | { kind: "columns"; columns: string[] };

export type LimitInput =
  | { kind: "empty" }
  | { kind: "value"; value: number }
  | { kind: "invalid"; text: string };
