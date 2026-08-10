import { describe, expect, it } from "vitest";
import { QueryDocument } from "../../src/core/query-document";
import { canRun } from "../../src/core/validation";

function validSelect(table = "orders"): QueryDocument {
  const doc = new QueryDocument();
  doc.chooseStatement("select");
  doc.addClause("from");
  doc.setFromTableText(table);
  return doc;
}

describe("canRun", () => {
  it("blocks a SELECT with no FROM", () => {
    const doc = new QueryDocument();
    doc.chooseStatement("select");
    const result = canRun(doc, true);
    expect(result.isRunnable).toBe(false);
    expect(result.helpMessage).toBe("Choose a table in FROM");
  });

  it("blocks when disconnected", () => {
    const result = canRun(validSelect(), false);
    expect(result.isRunnable).toBe(false);
    expect(result.helpMessage?.toLowerCase()).toContain("connect");
  });

  it("blocks an empty document", () => {
    const result = canRun(new QueryDocument(), true);
    expect(result.isRunnable).toBe(false);
    expect(result.helpMessage).toBe("Add a statement to start building a query");
  });

  it("allows a bare valid SELECT", () => {
    const result = canRun(validSelect(), true);
    expect(result.isRunnable).toBe(true);
    expect(result.helpMessage).toBeNull();
  });

  // Ports VisualQueryFromFieldTests.clearedFromBlocksRunAndPopoverAgree, which
  // could not live in the FROM-field suite because validation did not exist yet.
  // Run and the column popover must agree about a cleared FROM: Run reports
  // "no FROM", and the popover shows its helper only when fromTable is null.
  it("blocks Run on a cleared FROM, agreeing with what the popover sees", () => {
    const doc = new QueryDocument();
    doc.chooseStatement("select");
    doc.addClause("from");
    doc.selectFromTable("users", "public");
    doc.setFromTableText("");

    const result = canRun(doc, true);
    expect(result.isRunnable).toBe(false);
    expect(result.helpMessage).toBe("Choose a table in FROM");
    expect(doc.fromTable).toBeNull();
  });

  it("blocks a whitespace-only WHERE value", () => {
    const doc = validSelect();
    doc.addClause("where");
    doc.setWhereCondition("status", "equals", "   ");
    expect(canRun(doc, true).isRunnable).toBe(false);
  });

  it("allows an isEmpty WHERE with no value", () => {
    const doc = validSelect();
    doc.addClause("where");
    doc.setWhereCondition("status", "isEmpty", null);
    expect(canRun(doc, true).isRunnable).toBe(true);
  });

  it("blocks a WHERE with no column chosen", () => {
    const doc = validSelect();
    doc.addClause("where");
    expect(canRun(doc, true).helpMessage).toBe("Choose a column for the WHERE condition");
  });

  it("blocks an ORDER BY with no column chosen", () => {
    const doc = validSelect();
    doc.addClause("orderBy");
    expect(canRun(doc, true).helpMessage).toBe("Choose a column to sort by");
  });

  it("blocks a projection of only blank columns", () => {
    const doc = validSelect();
    doc.setSelectColumns(["   "]);
    expect(canRun(doc, true).helpMessage).toBe("Choose at least one column, or use All columns");
  });

  it("treats empty LIMIT as valid but rejects malformed and non-positive", () => {
    const doc = validSelect();
    doc.addClause("limit");

    doc.setLimitText("");
    expect(canRun(doc, true).isRunnable).toBe(true);
    doc.setLimitText("abc");
    expect(canRun(doc, true).isRunnable).toBe(false);
    doc.setLimitText("-1");
    expect(canRun(doc, true).isRunnable).toBe(false);
    doc.setLimitText("0");
    expect(canRun(doc, true).isRunnable).toBe(false);
    doc.setLimitText("1");
    expect(canRun(doc, true).isRunnable).toBe(true);
  });

  it("blocks UPDATE and DELETE", () => {
    for (const kind of ["update", "delete"] as const) {
      const doc = new QueryDocument();
      doc.chooseStatement(kind);
      const result = canRun(doc, true);
      expect(result.isRunnable).toBe(false);
      expect(result.helpMessage).toBe("Coming soon");
    }
  });

  it("allows a valid CREATE TABLE", () => {
    const doc = new QueryDocument();
    doc.chooseStatement("createTable");
    doc.setCreateTableName("notes");
    doc.setCreateColumns([
      { name: "body", type: "text" },
      { name: "created_at", type: "date" },
    ]);
    expect(canRun(doc, true).isRunnable).toBe(true);
  });

  it("blocks CREATE TABLE with a blank name, no columns, or a blank column", () => {
    const blankName = new QueryDocument();
    blankName.chooseStatement("createTable");
    blankName.setCreateTableName("   ");
    blankName.setCreateColumns([{ name: "body", type: "text" }]);
    expect(canRun(blankName, true).helpMessage).toBe("Enter a table name");

    const noColumns = new QueryDocument();
    noColumns.chooseStatement("createTable");
    noColumns.setCreateTableName("notes");
    noColumns.setCreateColumns([]);
    expect(canRun(noColumns, true).helpMessage).toBe("Add at least one column with a name");

    const blankColumn = new QueryDocument();
    blankColumn.chooseStatement("createTable");
    blankColumn.setCreateTableName("notes");
    blankColumn.setCreateColumns([
      { name: "body", type: "text" },
      { name: "   ", type: "date" },
    ]);
    expect(canRun(blankColumn, true).isRunnable).toBe(false);
  });
});
