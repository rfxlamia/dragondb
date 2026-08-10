import { describe, expect, it } from "vitest";
import { QueryDocument } from "../../../src/core";
import { VisualQueryCopy } from "../../../src/ui/visual-query/copy";

describe("VisualQueryCopy", () => {
  it("clause helpers match spec examples", () => {
    expect(VisualQueryCopy.helperForClause("select").toLowerCase()).toContain("column");
    expect(VisualQueryCopy.helperForClause("from").toLowerCase()).toContain("table");
    expect(VisualQueryCopy.helperForClause("where").toLowerCase()).toContain("condition");
    expect(VisualQueryCopy.helperForClause("orderBy").toLowerCase()).toContain("sort");
    expect(VisualQueryCopy.helperForClause("limit").toLowerCase()).toContain("row");
  });

  it("statement menu marks update and delete coming soon", () => {
    const items = VisualQueryCopy.statementMenuItems();
    const select = items.find((item) => item.kind === "select");
    const create = items.find((item) => item.kind === "createTable");
    const update = items.find((item) => item.kind === "update");
    const deleteItem = items.find((item) => item.kind === "delete");

    expect(select?.isRunnable).toBe(true);
    expect(create?.isRunnable).toBe(true);
    expect(update?.isRunnable).toBe(false);
    expect(deleteItem?.isRunnable).toBe(false);
    expect(update?.badge?.toLowerCase()).toContain("coming soon");
    expect(deleteItem?.badge?.toLowerCase()).toContain("coming soon");
  });

  it("lifecycle chrome copy exists", () => {
    expect(VisualQueryCopy.startOverTitle.length).toBeGreaterThan(0);
    expect(VisualQueryCopy.deleteClauseTitle.length).toBeGreaterThan(0);
    expect(VisualQueryCopy.columnPopoverNeedsFromMessage.toLowerCase()).toContain("from");
    expect(VisualQueryCopy.viewGeneratedSQLTitle.length).toBeGreaterThan(0);
    expect(VisualQueryCopy.copySQLTitle.length).toBeGreaterThan(0);
  });

  it("trailing plus options are progressive and exclude join", () => {
    const document = new QueryDocument();
    document.chooseStatement("select");

    const afterSelect = VisualQueryCopy.nextClauseOptions(document);
    expect(afterSelect).toEqual(["from", "where", "orderBy", "limit"]);
    expect(afterSelect).not.toContain("join");

    document.addClause("from");
    const afterFrom = VisualQueryCopy.nextClauseOptions(document);
    expect(afterFrom).toEqual(["where", "orderBy", "limit"]);
    expect(afterFrom).not.toContain("from");
    expect(afterFrom).not.toContain("join");
  });

  it("generated SQL preview is read-only copy model", () => {
    const preview = VisualQueryCopy.generatedSQLPreviewModel('SELECT * FROM "orders"');
    expect(preview.isEditable).toBe(false);
    expect(preview.allowsCopy).toBe(true);
    expect(preview.sql).toBe('SELECT * FROM "orders"');
  });

  it("includes extra canvas copy keys from spec", () => {
    expect(VisualQueryCopy.emptyCanvasTitle).toBe("Build a query visually");
    expect(VisualQueryCopy.noMatchesTitle).toBe("No matches");
    expect(VisualQueryCopy.columnsLoadError).toContain("Could not load columns");
  });
});
