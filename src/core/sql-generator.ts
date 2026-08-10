import type {
  CreateColumnType,
  SelectProjection,
  TableReference,
  WhereCondition,
} from "./query-clause";
import type { QueryDocument } from "./query-document";

export interface ExecutableSQL {
  text: string;
  params: unknown[];
}

export interface GeneratedSQL {
  /** Literals inlined — what the SQL inspector shows the user. */
  display: string;
  /** Placeholders plus bound parameters — what crosses IPC. */
  exec: ExecutableSQL;
}

/** Pure Postgres SQL generation from visual query documents. */
export function generateSQL(doc: QueryDocument): GeneratedSQL | null {
  switch (doc.statementKind) {
    case null:
    case "update":
    case "delete":
      return null;
    case "createTable": {
      const text = generateCreateTable(doc);
      return { display: text, exec: { text, params: [] } };
    }
    case "select": {
      const params: unknown[] = [];
      return {
        display: generateSelect(doc, null),
        exec: { text: generateSelect(doc, params), params },
      };
    }
  }
}

/**
 * Builds a SELECT. When `params` is null, literals are inlined for display.
 * When it is an array, WHERE values are pushed onto it and replaced by $n.
 */
function generateSelect(doc: QueryDocument, params: unknown[] | null): string {
  const parts: string[] = [];
  parts.push(`SELECT ${projectionSQL(doc.selectProjection)}`);

  const from = doc.fromTable;
  if (doc.clauseKinds.includes("from") && from !== null) {
    parts.push(`FROM ${quoteTableReference(from)}`);
  }

  const where = doc.whereCondition;
  if (doc.clauseKinds.includes("where") && where !== null) {
    parts.push(`WHERE ${whereSQL(where, params)}`);
  }

  const order = doc.orderBy;
  if (doc.clauseKinds.includes("orderBy") && order !== null) {
    const direction = order.direction === "desc" ? "DESC" : "ASC";
    parts.push(`ORDER BY ${quoteIdentifier(order.column)} ${direction}`);
  }

  if (doc.clauseKinds.includes("limit")) {
    const limit = doc.limitInput;
    if (limit.kind === "value" && limit.value >= 1) {
      parts.push(`LIMIT ${limit.value}`);
    }
  }

  return parts.join(" ");
}

function projectionSQL(projection: SelectProjection): string {
  if (projection.kind === "allColumns") return "*";
  const named = projection.columns.filter((c) => c.trim().length > 0);
  if (named.length === 0) return "*";
  return named.map(quoteIdentifier).join(", ");
}

function whereSQL(condition: WhereCondition, params: unknown[] | null): string {
  const column = quoteIdentifier(condition.column);
  const value = condition.value ?? "";

  /** Inline the literal for display, or bind it and return its placeholder. */
  const bind = (raw: string): string => {
    if (params === null) return quoteLiteral(raw);
    params.push(raw);
    return `$${params.length}`;
  };

  switch (condition.op) {
    case "equals":
      return `${column} = ${bind(value)}`;
    case "notEquals":
      return `${column} <> ${bind(value)}`;
    case "greaterThan":
      return `${column} > ${bind(value)}`;
    case "lessThan":
      return `${column} < ${bind(value)}`;
    case "contains":
      return `${column} LIKE ${bind(`%${escapeLikePattern(value)}%`)} ESCAPE '\\'`;
    case "isEmpty":
      return `${column} IS NULL`;
  }
}

function generateCreateTable(doc: QueryDocument): string {
  const tableName = quoteIdentifier(doc.createTableName);
  const columns = doc.createColumns
    .map((c) => `${quoteIdentifier(c.name)} ${sqlType(c.type)}`)
    .join(", ");
  return `CREATE TABLE ${tableName} (${columns})`;
}

function sqlType(type: CreateColumnType): string {
  switch (type) {
    case "text":
      return "TEXT";
    case "number":
      return "NUMERIC";
    case "date":
      return "DATE";
    case "boolean":
      return "BOOLEAN";
  }
}

function quoteTableReference(table: TableReference): string {
  if (table.schema !== null && table.schema.length > 0) {
    return `${quoteIdentifier(table.schema)}.${quoteIdentifier(table.name)}`;
  }
  return quoteIdentifier(table.name);
}

/**
 * Quote a Postgres identifier, doubling embedded double quotes.
 * Identifiers cannot be parameterized, so this stays on the security-critical path.
 */
export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

/** Quote a Postgres string literal, doubling embedded single quotes. */
function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** Escape LIKE metacharacters (`\`, `%`, `_`) so user input stays literal. */
export function escapeLikePattern(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}
