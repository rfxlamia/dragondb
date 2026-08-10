import { describe, expect, it } from "vitest";
import type {
  ClauseKind,
  CreateColumn,
  OrderBy,
  WhereCondition,
} from "../../src/core/query-clause";
import { QueryDocument } from "../../src/core/query-document";

describe("QueryDocument", () => {
  it("adds only the chosen clauses, in order", () => {
    const doc = new QueryDocument();
    expect(doc.chooseStatement("select")).toBe(true);
    expect(doc.clauseKinds).toEqual(["select"]);
    expect(doc.addClause("from")).toBe(true);
    expect(doc.clauseKinds).toEqual(["select", "from"]);
    // Progressive add: SELECT alone must not invent FROM/WHERE/ORDER BY/LIMIT
    expect(doc.clauseKinds).not.toContain("where");
    expect(doc.clauseKinds).not.toContain("orderBy");
    expect(doc.clauseKinds).not.toContain("limit");
  });

  it("does not materialize a full chain from SELECT alone", () => {
    const doc = new QueryDocument();
    expect(doc.chooseStatement("select")).toBe(true);
    expect(doc.clauseKinds).toEqual(["select"]);
    expect(doc.availableNextClauses()).toEqual(["from", "where", "orderBy", "limit"]);
  });

  it("rejects a duplicate WHERE", () => {
    const doc = new QueryDocument();
    expect(doc.chooseStatement("select")).toBe(true);
    expect(doc.addClause("from")).toBe(true);
    expect(doc.addClause("where")).toBe(true);
    expect(doc.addClause("where")).toBe(false);
    expect(doc.clauseKinds.filter((k) => k === "where")).toHaveLength(1);
  });

  it("rejects a second chooseStatement", () => {
    const doc = new QueryDocument();
    expect(doc.chooseStatement("select")).toBe(true);
    expect(doc.chooseStatement("createTable")).toBe(false);
    expect(doc.statementKind).toBe("select");
  });

  it("rejects the JOIN clause", () => {
    const doc = new QueryDocument();
    expect(doc.chooseStatement("select")).toBe(true);
    expect(doc.addClause("join")).toBe(false);
    expect(doc.clauseKinds).not.toContain("join");
    expect(doc.availableNextClauses()).not.toContain("join");
  });

  it("clears everything on startOver", () => {
    const doc = new QueryDocument();
    expect(doc.chooseStatement("select")).toBe(true);
    expect(doc.addClause("from")).toBe(true);
    doc.startOver();
    expect(doc.statementKind).toBeNull();
    expect(doc.clauseKinds).toEqual([]);
  });

  it("offers a removed clause again", () => {
    const doc = new QueryDocument();
    doc.chooseStatement("select");
    doc.addClause("from");
    doc.addClause("where");
    doc.removeClause("where");
    expect(doc.availableNextClauses()).toContain("where");
  });

  it("treats an empty column list as all columns", () => {
    const doc = new QueryDocument();
    doc.setSelectColumns([]);
    expect(doc.selectProjection).toEqual({ kind: "allColumns" });
    doc.setSelectColumns(["a", "b"]);
    expect(doc.selectProjection).toEqual({ kind: "columns", columns: ["a", "b"] });
  });

  it("records a WHERE condition and an ORDER BY", () => {
    const doc = new QueryDocument();
    doc.setWhereCondition("status", "equals", "paid");
    expect(doc.whereCondition).toEqual({ column: "status", op: "equals", value: "paid" });
    doc.setOrderBy("created_at", "desc");
    expect(doc.orderBy).toEqual({ column: "created_at", direction: "desc" });
  });

  // Swift returned an independent copy from every private(set) property.
  // These casts strip the Readonly types on purpose, to prove the runtime
  // copies hold even when a caller defeats the compile-time guard.
  it("hands out copies, so a caller cannot mutate state through a getter", () => {
    const doc = new QueryDocument();
    doc.chooseStatement("select");
    doc.addClause("from");
    doc.setSelectColumns(["email"]);
    doc.setWhereCondition("status", "equals", "paid");
    doc.setOrderBy("created_at", "desc");
    doc.setCreateColumns([{ name: "body", type: "text" }]);

    (doc.clauseKinds as ClauseKind[]).push("limit");
    expect(doc.clauseKinds).toEqual(["select", "from"]);

    const projection = doc.selectProjection as { kind: "columns"; columns: string[] };
    projection.columns.push("leaked");
    expect(doc.selectProjection).toEqual({ kind: "columns", columns: ["email"] });

    (doc.whereCondition as WhereCondition).column = "leaked";
    expect(doc.whereCondition?.column).toBe("status");

    (doc.orderBy as OrderBy).column = "leaked";
    expect(doc.orderBy?.column).toBe("created_at");

    const createCols = doc.createColumns as CreateColumn[];
    if (createCols[0]) createCols[0].name = "leaked";
    expect(doc.createColumns[0]?.name).toBe("body");
  });

  it("distinguishes empty, malformed, and valid LIMIT input", () => {
    const doc = new QueryDocument();
    doc.setLimitText("");
    expect(doc.limitInput).toEqual({ kind: "empty" });
    doc.setLimitText("abc");
    expect(doc.limitInput).toEqual({ kind: "invalid", text: "abc" });
    doc.setLimitText("25");
    expect(doc.limitInput).toEqual({ kind: "value", value: 25 });
  });

  it("rejects trailing-garbage numbers that parseInt would accept", () => {
    const doc = new QueryDocument();
    doc.setLimitText("25abc");
    expect(doc.limitInput).toEqual({ kind: "invalid", text: "25abc" });
    doc.setLimitText("1.5");
    expect(doc.limitInput).toEqual({ kind: "invalid", text: "1.5" });
  });

  it("trims LIMIT input before parsing", () => {
    const doc = new QueryDocument();
    doc.setLimitText("  25  ");
    expect(doc.limitInput).toEqual({ kind: "value", value: 25 });
    doc.setLimitText("   ");
    expect(doc.limitInput).toEqual({ kind: "empty" });
  });

  it("accepts a negative LIMIT as a value, leaving the range check to validation", () => {
    const doc = new QueryDocument();
    doc.setLimitText("-1");
    expect(doc.limitInput).toEqual({ kind: "value", value: -1 });
  });

  it("rejects integers JavaScript cannot represent exactly", () => {
    const doc = new QueryDocument();

    // Int64 holds this; Number rounds it to ...992.
    doc.setLimitText("9007199254740993");
    expect(doc.limitInput).toEqual({ kind: "invalid", text: "9007199254740993" });

    // Swift's Int(_:) returns nil here. Number gives 1e+39, which would reach
    // the generator and emit `LIMIT 1e+39`.
    const huge = "1".padEnd(40, "0");
    doc.setLimitText(huge);
    expect(doc.limitInput).toEqual({ kind: "invalid", text: huge });

    // The boundary itself still parses.
    doc.setLimitText("9007199254740991");
    expect(doc.limitInput).toEqual({ kind: "value", value: 9007199254740991 });
  });

  it("stores CREATE TABLE name and columns", () => {
    const doc = new QueryDocument();
    doc.setCreateTableName("notes");
    doc.setCreateColumns([{ name: "body", type: "text" }]);
    expect(doc.createTableName).toBe("notes");
    expect(doc.createColumns).toEqual([{ name: "body", type: "text" }]);
  });
});
