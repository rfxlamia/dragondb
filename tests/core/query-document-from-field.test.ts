import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { TableReference } from "../../src/core/query-clause";
import { QueryDocument } from "../../src/core/query-document";

describe("QueryDocument FROM field", () => {
  it("treats a cleared field as no table chosen, without discarding picks", () => {
    const doc = new QueryDocument();
    doc.chooseStatement("select");
    doc.addClause("from");
    doc.selectFromTable("users", "public");
    doc.setSelectColumns(["email"]);
    expect(doc.fromTable).not.toBeNull();

    doc.setFromTableText("");

    expect(doc.fromTable).toBeNull();
    expect(doc.selectProjection).toEqual({ kind: "columns", columns: ["email"] });
  });

  it("keeps picks when the same table is retyped after clearing", () => {
    const doc = new QueryDocument();
    doc.chooseStatement("select");
    doc.addClause("from");
    doc.selectFromTable("users", "public");
    doc.setSelectColumns(["email"]);

    doc.setFromTableText("");
    doc.commitFromTable("public.users");

    expect(doc.fromTable).toEqual({ schema: "public", name: "users" });
    expect(doc.selectProjection).toEqual({ kind: "columns", columns: ["email"] });
  });

  it("resets picks when a different table is committed after typing", () => {
    const doc = new QueryDocument();
    doc.chooseStatement("select");
    doc.addClause("from");
    doc.selectFromTable("users", "public");
    doc.setSelectColumns(["email"]);

    doc.setFromTableText("public.order");
    doc.setFromTableText("public.orders");
    doc.commitFromTable("public.orders");

    expect(doc.selectProjection).toEqual({ kind: "allColumns" });
  });

  it("keeps picks through an unfinished edit", () => {
    const doc = new QueryDocument();
    doc.chooseStatement("select");
    doc.addClause("from");
    doc.addClause("where");
    doc.addClause("orderBy");

    doc.selectFromTable("users", "public");
    doc.setSelectColumns(["email"]);
    doc.setWhereCondition("name", "equals", "Budi");
    doc.setOrderBy("created_at", "desc");

    doc.setFromTableText("public.user");

    expect(doc.selectProjection).toEqual({ kind: "columns", columns: ["email"] });
    expect(doc.whereCondition?.column).toBe("name");
    expect(doc.orderBy?.column).toBe("created_at");
  });

  it("keeps the projection when the field is edited without changing the table", () => {
    const doc = new QueryDocument();
    doc.chooseStatement("select");
    doc.addClause("from");
    doc.selectFromTable("users", "public");
    doc.setSelectColumns(["email"]);

    doc.setFromTableText("public.users");

    expect(doc.selectProjection).toEqual({ kind: "columns", columns: ["email"] });
  });

  it("resets picks when a different table is committed", () => {
    const doc = new QueryDocument();
    doc.chooseStatement("select");
    doc.addClause("from");
    doc.commitFromTable("orders");
    doc.setSelectColumns(["status", "amount"]);
    doc.addClause("where");
    doc.setWhereCondition("status", "equals", "paid");
    doc.addClause("orderBy");
    doc.setOrderBy("amount", "desc");

    doc.commitFromTable("customers");

    expect(doc.selectProjection).toEqual({ kind: "allColumns" });
    expect(doc.whereCondition?.column).toBe("");
    expect(doc.orderBy?.column).toBe("");
    expect(doc.fromTable).toEqual({ schema: null, name: "customers" });
  });

  it("resets the projection when a different table is picked from the popover", () => {
    const doc = new QueryDocument();
    doc.chooseStatement("select");
    doc.addClause("from");
    doc.selectFromTable("orders", "public");
    doc.setSelectColumns(["status"]);

    doc.selectFromTable("customers", "public");

    expect(doc.selectProjection).toEqual({ kind: "allColumns" });
    expect(doc.fromTable).toEqual({ schema: "public", name: "customers" });
  });

  it("clears projection and dependent columns when FROM is removed", () => {
    const doc = new QueryDocument();
    doc.chooseStatement("select");
    doc.addClause("from");
    doc.selectFromTable("orders", "sales");
    doc.setSelectColumns(["status"]);
    doc.addClause("where");
    doc.setWhereCondition("status", "equals", "paid");
    doc.addClause("orderBy");
    doc.setOrderBy("status", "asc");

    doc.removeClause("from");

    expect(doc.fromTable).toBeNull();
    expect(doc.selectProjection).toEqual({ kind: "allColumns" });
    expect(doc.whereCondition?.column).toBe("");
    expect(doc.orderBy?.column).toBe("");
  });

  it("parses schema.table, bare names, and preserves picker schemas", () => {
    const doc = new QueryDocument();
    doc.chooseStatement("select");
    doc.addClause("from");

    doc.selectFromTable("events", "audit");
    expect(doc.fromTable).toEqual({ schema: "audit", name: "events" });

    doc.setFromTableText("reporting.monthly_events");
    expect(doc.fromTable).toEqual({ schema: "reporting", name: "monthly_events" });

    doc.setFromTableText("custom_table");
    expect(doc.fromTable).toEqual({ schema: null, name: "custom_table" });
  });

  it("treats a name with two dots as a bare table name", () => {
    const doc = new QueryDocument();
    doc.chooseStatement("select");
    doc.addClause("from");
    doc.setFromTableText("a.b.c");
    expect(doc.fromTable).toEqual({ schema: null, name: "a.b.c" });
  });

  it("hands out a copy of fromTable", () => {
    const doc = new QueryDocument();
    doc.chooseStatement("select");
    doc.addClause("from");
    doc.selectFromTable("users", "public");

    (doc.fromTable as TableReference).name = "leaked";

    expect(doc.fromTable).toEqual({ schema: "public", name: "users" });
  });

  // #committedFromTable is private; pin the shallow-copy assignment so a future
  // "simplify" cannot restore reference aliasing (Swift copied the struct).
  it("commits a shallow copy of fromTable, not a shared reference", () => {
    const source = readFileSync(join(process.cwd(), "src", "core", "query-document.ts"), "utf8");
    expect(source).toContain(
      "this.#committedFromTable = this.#fromTable === null ? null : { ...this.#fromTable }",
    );
    expect(source).not.toMatch(/#committedFromTable = this\.#fromTable\s*;/);
  });
});
