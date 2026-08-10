import type { QueryDocument } from "./query-document";

export interface RunEligibility {
  isRunnable: boolean;
  helpMessage: string | null;
}

const runnable: RunEligibility = { isRunnable: true, helpMessage: null };

function blocked(message: string): RunEligibility {
  return { isRunnable: false, helpMessage: message };
}

/** Pure run-eligibility checks for visual query documents. */
export function canRun(doc: QueryDocument, isConnected: boolean): RunEligibility {
  if (!isConnected) return blocked("Connect a database first");

  switch (doc.statementKind) {
    case null:
      return blocked("Add a statement to start building a query");
    case "update":
    case "delete":
      return blocked("Coming soon");
    case "createTable":
      return validateCreate(doc);
    case "select":
      return validateSelect(doc);
  }
}

function validateSelect(doc: QueryDocument): RunEligibility {
  const table = doc.fromTable;
  if (!doc.clauseKinds.includes("from") || table === null || table.name.trim().length === 0) {
    return blocked("Choose a table in FROM");
  }
  if (table.schema !== null && table.schema.trim().length === 0) {
    return blocked("Choose a table in FROM");
  }

  const projection = doc.selectProjection;
  if (projection.kind === "columns") {
    const named = projection.columns.filter((c) => c.trim().length > 0);
    if (named.length === 0) {
      return blocked("Choose at least one column, or use All columns");
    }
  }

  if (doc.clauseKinds.includes("where")) {
    const condition = doc.whereCondition;
    if (condition === null || condition.column.trim().length === 0) {
      return blocked("Choose a column for the WHERE condition");
    }
    if (condition.op !== "isEmpty") {
      if ((condition.value ?? "").trim().length === 0) {
        return blocked("Enter a value for the WHERE condition");
      }
    }
  }

  if (doc.clauseKinds.includes("orderBy")) {
    const order = doc.orderBy;
    if (order === null || order.column.trim().length === 0) {
      return blocked("Choose a column to sort by");
    }
  }

  if (doc.clauseKinds.includes("limit")) {
    const limit = doc.limitInput;
    if (limit.kind === "invalid") {
      return blocked("Enter a positive whole number for LIMIT");
    }
    if (limit.kind === "value" && limit.value < 1) {
      return blocked("Enter a positive whole number for LIMIT");
    }
  }

  return runnable;
}

function validateCreate(doc: QueryDocument): RunEligibility {
  if (doc.createTableName.trim().length === 0) {
    return blocked("Enter a table name");
  }
  const columns = doc.createColumns;
  if (columns.length === 0 || columns.some((c) => c.name.trim().length === 0)) {
    return blocked("Add at least one column with a name");
  }
  return runnable;
}
