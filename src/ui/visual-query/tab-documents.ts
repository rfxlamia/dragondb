import {
  type ClauseKind,
  type CreateColumn,
  type LimitInput,
  type OrderBy,
  QueryDocument,
  type SelectProjection,
  type StatementKind,
  type TableReference,
  type WhereCondition,
} from "../../core";

export type TabDocuments = {
  get: (id: string) => QueryDocument | undefined;
  getOrCreate: (id: string) => QueryDocument;
  resetAll: (ids: string[]) => void;
  delete: (id: string) => void;
};

type SerializedQueryDocument = {
  statementKind: StatementKind | null;
  clauseKinds: ClauseKind[];
  fromTable: TableReference | null;
  selectProjection: SelectProjection;
  whereCondition: WhereCondition | null;
  orderBy: OrderBy | null;
  limitInput: LimitInput;
  createTableName: string;
  createColumns: CreateColumn[];
};

/** Persist visual IR as JSON. Never encode as SQL / queryText. */
export function serializeQueryDocument(doc: QueryDocument): string {
  const payload: SerializedQueryDocument = {
    statementKind: doc.statementKind,
    clauseKinds: [...doc.clauseKinds],
    fromTable: doc.fromTable === null ? null : { ...doc.fromTable },
    selectProjection:
      doc.selectProjection.kind === "allColumns"
        ? { kind: "allColumns" }
        : { kind: "columns", columns: [...doc.selectProjection.columns] },
    whereCondition: doc.whereCondition === null ? null : { ...doc.whereCondition },
    orderBy: doc.orderBy === null ? null : { ...doc.orderBy },
    limitInput: { ...doc.limitInput },
    createTableName: doc.createTableName,
    createColumns: doc.createColumns.map((column) => ({ ...column })),
  };
  return JSON.stringify(payload);
}

/** Restore a QueryDocument via public APIs only (no queryText / generateSQL). */
export function hydrateQueryDocument(json: string): QueryDocument {
  const doc = new QueryDocument();
  let parsed: SerializedQueryDocument;
  try {
    parsed = JSON.parse(json) as SerializedQueryDocument;
  } catch {
    return doc;
  }
  if (parsed === null || typeof parsed !== "object") return doc;

  if (parsed.statementKind) {
    doc.chooseStatement(parsed.statementKind);
  }
  if (Array.isArray(parsed.clauseKinds)) {
    for (const kind of parsed.clauseKinds) {
      if (kind === "select") continue;
      doc.addClause(kind);
    }
  }
  if (parsed.fromTable && typeof parsed.fromTable.name === "string") {
    doc.selectFromTable(parsed.fromTable.name, parsed.fromTable.schema ?? null);
  }
  if (parsed.selectProjection?.kind === "columns") {
    doc.setSelectColumns(parsed.selectProjection.columns);
  }
  if (parsed.whereCondition) {
    doc.setWhereCondition(
      parsed.whereCondition.column,
      parsed.whereCondition.op,
      parsed.whereCondition.value,
    );
  }
  if (parsed.orderBy) {
    doc.setOrderBy(parsed.orderBy.column, parsed.orderBy.direction);
  }
  if (parsed.limitInput?.kind === "value") {
    doc.setLimitText(String(parsed.limitInput.value));
  } else if (parsed.limitInput?.kind === "invalid") {
    doc.setLimitText(parsed.limitInput.text);
  }
  if (typeof parsed.createTableName === "string" && parsed.createTableName.length > 0) {
    doc.setCreateTableName(parsed.createTableName);
  }
  if (Array.isArray(parsed.createColumns) && parsed.createColumns.length > 0) {
    doc.setCreateColumns(parsed.createColumns);
  }
  return doc;
}

/** In-session QueryDocument map keyed by tab id. Not persisted. */
export function createTabDocuments(): TabDocuments {
  const documents = new Map<string, QueryDocument>();

  function get(id: string): QueryDocument | undefined {
    return documents.get(id);
  }

  function getOrCreate(id: string): QueryDocument {
    const existing = get(id);
    if (existing !== undefined) return existing;
    const created = new QueryDocument();
    documents.set(id, created);
    return created;
  }

  function resetAll(ids: string[]): void {
    documents.clear();
    for (const id of ids) {
      documents.set(id, new QueryDocument());
    }
  }

  function deleteEntry(id: string): void {
    documents.delete(id);
  }

  return {
    get,
    getOrCreate,
    resetAll,
    delete: deleteEntry,
  };
}
