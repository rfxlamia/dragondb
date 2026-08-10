import type {
  ClauseKind,
  CreateColumn,
  LimitInput,
  OrderBy,
  OrderDirection,
  SelectProjection,
  StatementKind,
  TableReference,
  WhereCondition,
  WhereOperator,
} from "./query-clause";

const SELECT_CLAUSE_OPTIONS: ClauseKind[] = ["from", "where", "orderBy", "limit"];

/** In-memory visual query document with progressive-add clause mutations. */
export class QueryDocument {
  #statementKind: StatementKind | null = null;
  #clauseKinds: ClauseKind[] = [];
  #selectProjection: SelectProjection = { kind: "allColumns" };
  #fromTable: TableReference | null = null;
  #whereCondition: WhereCondition | null = null;
  #orderBy: OrderBy | null = null;
  #limitInput: LimitInput = { kind: "empty" };
  #createTableName = "";
  #createColumns: CreateColumn[] = [];

  get statementKind(): StatementKind | null {
    return this.#statementKind;
  }

  get clauseKinds(): readonly ClauseKind[] {
    return [...this.#clauseKinds];
  }

  get selectProjection(): Readonly<SelectProjection> {
    const p = this.#selectProjection;
    return p.kind === "allColumns"
      ? { kind: "allColumns" }
      : { kind: "columns", columns: [...p.columns] };
  }

  get fromTable(): Readonly<TableReference> | null {
    return this.#fromTable === null ? null : { ...this.#fromTable };
  }

  get whereCondition(): Readonly<WhereCondition> | null {
    return this.#whereCondition === null ? null : { ...this.#whereCondition };
  }

  get orderBy(): Readonly<OrderBy> | null {
    return this.#orderBy === null ? null : { ...this.#orderBy };
  }

  get limitInput(): Readonly<LimitInput> {
    return { ...this.#limitInput };
  }

  get createTableName(): string {
    return this.#createTableName;
  }

  get createColumns(): readonly Readonly<CreateColumn>[] {
    return this.#createColumns.map((c) => ({ ...c }));
  }

  chooseStatement(kind: StatementKind): boolean {
    if (this.#statementKind !== null) return false;
    this.#statementKind = kind;
    if (kind === "select") {
      this.#clauseKinds = ["select"];
      this.#selectProjection = { kind: "allColumns" };
    } else {
      this.#clauseKinds = [];
    }
    return true;
  }

  addClause(kind: ClauseKind): boolean {
    if (this.#statementKind !== "select") return false;
    if (kind === "join" || kind === "select") return false;
    if (this.#clauseKinds.includes(kind)) return false;
    if (!SELECT_CLAUSE_OPTIONS.includes(kind)) return false;

    this.#clauseKinds.push(kind);
    if (kind === "where" && this.#whereCondition === null) {
      this.#whereCondition = { column: "", op: "equals", value: null };
    }
    if (kind === "orderBy" && this.#orderBy === null) {
      this.#orderBy = { column: "", direction: "asc" };
    }
    return true;
  }

  removeClause(kind: ClauseKind): void {
    const index = this.#clauseKinds.indexOf(kind);
    if (index === -1) return;
    this.#clauseKinds.splice(index, 1);

    switch (kind) {
      case "select":
        this.startOver();
        break;
      case "from":
        this.#fromTable = null;
        this.#committedFromTable = null;
        this.#resetProjectionAndDependentColumns();
        break;
      case "where":
        this.#whereCondition = null;
        break;
      case "orderBy":
        this.#orderBy = null;
        break;
      case "limit":
        this.#limitInput = { kind: "empty" };
        break;
      case "join":
        break;
    }
  }

  startOver(): void {
    this.#statementKind = null;
    this.#clauseKinds = [];
    this.#selectProjection = { kind: "allColumns" };
    this.#fromTable = null;
    if (this.#committedFromTable !== null) {
      this.#committedFromTable = null;
    }
    this.#whereCondition = null;
    this.#orderBy = null;
    this.#limitInput = { kind: "empty" };
    this.#createTableName = "";
    this.#createColumns = [];
  }

  availableNextClauses(): ClauseKind[] {
    if (this.#statementKind !== "select") return [];
    return SELECT_CLAUSE_OPTIONS.filter((k) => !this.#clauseKinds.includes(k));
  }

  setSelectColumns(columns: string[]): void {
    this.#selectProjection =
      columns.length === 0 ? { kind: "allColumns" } : { kind: "columns", columns: [...columns] };
  }

  setWhereCondition(column: string, op: WhereOperator, value: string | null): void {
    this.#whereCondition = { column, op, value };
  }

  setOrderBy(column: string, direction: OrderDirection): void {
    this.#orderBy = { column, direction };
  }

  setLimitText(text: string): void {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      this.#limitInput = { kind: "empty" };
      return;
    }
    // Two ways this diverges from Swift's Int(_:) if written naively:
    //   1. Number.parseInt would accept "25abc" and "1.5"; Int(_:) rejects both.
    //      Hence the exact-match regex rather than a parse.
    //   2. Number cannot represent every integer Int64 can. "9007199254740993"
    //      silently becomes ...992, and a 40-digit string becomes 1e+39, which
    //      would reach the generator and emit `LIMIT 1e+39` — not valid SQL.
    //      isSafeInteger rejects both as malformed input instead.
    const value = Number(trimmed);
    if (/^[+-]?\d+$/.test(trimmed) && Number.isSafeInteger(value)) {
      this.#limitInput = { kind: "value", value };
    } else {
      this.#limitInput = { kind: "invalid", text: trimmed };
    }
  }

  setCreateTableName(name: string): void {
    this.#createTableName = name;
  }

  setCreateColumns(columns: CreateColumn[]): void {
    this.#createColumns = columns.map((c) => ({ ...c }));
  }

  /**
   * Typed input. Tracks the field character by character without discarding the
   * user's column picks — an unfinished edit is not a table change.
   */
  setFromTableText(raw: string): void {
    this.#fromTable = QueryDocument.#parseTableReference(raw);
  }

  /**
   * Submitted input (Return in the FROM field). A change of table since the last
   * commit resets the projection and dependent column references.
   */
  commitFromTable(raw: string): void {
    this.#fromTable = QueryDocument.#parseTableReference(raw);
    this.#commitCurrentFromTable();
  }

  /** Popover selection. Choosing a table is itself a commit. */
  selectFromTable(name: string, schema: string | null): void {
    this.#fromTable = { schema, name };
    this.#commitCurrentFromTable();
  }

  /** Written only by the FROM commit methods added in Task 6. */
  #committedFromTable: TableReference | null = null;

  /**
   * Parses `schema.table` when both halves are present; otherwise treats the
   * whole string as a bare table name. An empty field means no table at all.
   */
  static #parseTableReference(raw: string): TableReference | null {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;

    const dot = trimmed.indexOf(".");
    if (dot !== -1) {
      const schema = trimmed.slice(0, dot);
      const name = trimmed.slice(dot + 1);
      if (schema.length > 0 && name.length > 0 && !name.includes(".")) {
        return { schema, name };
      }
    }
    return { schema: null, name: trimmed };
  }

  #commitCurrentFromTable(): void {
    if (!QueryDocument.#sameTable(this.#committedFromTable, this.#fromTable)) {
      this.#resetProjectionAndDependentColumns();
    }
    this.#committedFromTable = this.#fromTable;
  }

  static #sameTable(a: TableReference | null, b: TableReference | null): boolean {
    if (a === null || b === null) return a === b;
    return a.schema === b.schema && a.name === b.name;
  }

  #resetProjectionAndDependentColumns(): void {
    this.#selectProjection = { kind: "allColumns" };
    if (this.#whereCondition !== null) this.#whereCondition.column = "";
    if (this.#orderBy !== null) this.#orderBy.column = "";
  }
}
