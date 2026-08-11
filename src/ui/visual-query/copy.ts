import type {
  ClauseKind,
  CreateColumnType,
  OrderDirection,
  QueryDocument,
  StatementKind,
  WhereOperator,
} from "../../core";

export interface StatementMenuItem {
  kind: StatementKind;
  title: string;
  helper: string;
  isRunnable: boolean;
  badge: string | null;
}

export interface GeneratedSQLPreviewModel {
  sql: string;
  isEditable: boolean;
  allowsCopy: boolean;
}

export interface ClauseMenuItem {
  kind: ClauseKind;
  title: string;
  helper: string;
}

function helperForClause(kind: ClauseKind): string {
  switch (kind) {
    case "select":
      return "Choose which columns to return";
    case "from":
      return "Which table should we read from?";
    case "where":
      return "Keep only rows that match a condition";
    case "orderBy":
      return "Sort the rows";
    case "limit":
      return "Cap how many rows come back";
    case "join":
      return "Join tables (coming soon)";
  }
}

function statementHelper(kind: StatementKind): string {
  switch (kind) {
    case "select":
      return "Read rows from a table";
    case "createTable":
      return "Create a new table in this database.";
    case "update":
      return "Change existing rows — not runnable in v1";
    case "delete":
      return "Remove rows — not runnable in v1";
  }
}

function statementTitle(kind: StatementKind): string {
  switch (kind) {
    case "select":
      return "SELECT";
    case "createTable":
      return "CREATE TABLE";
    case "update":
      return "UPDATE";
    case "delete":
      return "DELETE";
  }
}

function clauseTitle(kind: ClauseKind): string {
  switch (kind) {
    case "select":
      return "SELECT";
    case "from":
      return "FROM";
    case "where":
      return "WHERE";
    case "orderBy":
      return "ORDER BY";
    case "limit":
      return "LIMIT";
    case "join":
      return "JOIN";
  }
}

function statementMenuItems(): StatementMenuItem[] {
  return [
    {
      kind: "select",
      title: statementTitle("select"),
      helper: statementHelper("select"),
      isRunnable: true,
      badge: null,
    },
    {
      kind: "createTable",
      title: "CREATE",
      helper: "Create a new table",
      isRunnable: true,
      badge: null,
    },
    {
      kind: "update",
      title: statementTitle("update"),
      helper: statementHelper("update"),
      isRunnable: false,
      badge: "Coming soon",
    },
    {
      kind: "delete",
      title: statementTitle("delete"),
      helper: statementHelper("delete"),
      isRunnable: false,
      badge: "Coming soon",
    },
  ];
}

function nextClauseOptions(document: QueryDocument): ClauseKind[] {
  return document.availableNextClauses();
}

function clauseMenuItems(document: QueryDocument): ClauseMenuItem[] {
  return nextClauseOptions(document).map((kind) => ({
    kind,
    title: clauseTitle(kind),
    helper: helperForClause(kind),
  }));
}

function whereOperatorTitle(op: WhereOperator): string {
  switch (op) {
    case "equals":
      return "equals";
    case "notEquals":
      return "does not equal";
    case "greaterThan":
      return "greater than";
    case "lessThan":
      return "less than";
    case "contains":
      return "contains";
    case "isEmpty":
      return "is empty";
  }
}

function orderDirectionTitle(direction: OrderDirection): string {
  switch (direction) {
    case "asc":
      return "ASC";
    case "desc":
      return "DESC";
  }
}

function createColumnTypeTitle(type: CreateColumnType): string {
  switch (type) {
    case "text":
      return "text";
    case "number":
      return "number";
    case "date":
      return "date";
    case "boolean":
      return "true/false";
  }
}

function generatedSQLPreviewModel(sql: string): GeneratedSQLPreviewModel {
  return { sql, isEditable: false, allowsCopy: true };
}

/** English helpers and chrome copy for the visual query canvas. */
export const VisualQueryCopy = {
  helper: helperForClause,
  helperForClause,
  statementHelper,
  statementTitle,
  clauseTitle,
  statementMenuItems,
  nextClauseOptions,
  clauseMenuItems,
  startOverTitle: "Start over",
  deleteClauseTitle: "Delete",
  columnPopoverNeedsFromMessage: "Choose a table in FROM first.",
  viewGeneratedSQLTitle: "View generated SQL",
  copySQLTitle: "Copy",
  copySQLDoneTitle: "Done",
  allColumnsTitle: "All columns",
  addBlockTitle: "Add block",
  runQueryTitle: "Run query",
  runSelectOnlyMessage: "Only SELECT queries can run for now.",
  runSuccessStatus(rowCount: number, durationMs: number): string {
    return `OK / ${rowCount} rows / ${durationMs} ms`;
  },
  confirmCreateTitle: "Create this table?",
  confirmCreateContinueTitle: "Continue",
  confirmCreateCancelTitle: "Cancel",
  emptyCanvasTitle: "Build a query visually",
  emptyCanvasBody: "Add a block to start. Each + adds one clause — never a full chain at once.",
  noMatchesTitle: "No matches",
  sqlPreviewEmpty: "—",
  columnsLoadError: "Could not load columns. You can still type a name.",
  tablesLoadError: "Could not load tables. You can still type a name.",
  whereOperatorTitle,
  orderDirectionTitle,
  createColumnTypeTitle,
  generatedSQLPreviewModel,
} as const;
