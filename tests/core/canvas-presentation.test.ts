import { describe, expect, it } from "vitest";
import { CanvasPresentation } from "../../src/core/canvas-presentation";
import { QueryDocument } from "../../src/core/query-document";

describe("CanvasPresentation", () => {
  it("mirrors the document clause list exactly as cards are added", () => {
    const doc = new QueryDocument();
    expect(new CanvasPresentation(doc).visibleClauseKinds).toEqual([]);

    doc.chooseStatement("select");
    let presentation = new CanvasPresentation(doc);
    expect(presentation.visibleClauseKinds).toEqual(["select"]);
    expect(presentation.trailingOptions).toEqual(["from", "where", "orderBy", "limit"]);

    doc.addClause("from");
    presentation = new CanvasPresentation(doc);
    expect(presentation.visibleClauseKinds).toEqual(["select", "from"]);
    expect(presentation.visibleClauseKinds).not.toContain("where");
  });

  it("offers a deleted clause again and resets fully on startOver", () => {
    const doc = new QueryDocument();
    doc.chooseStatement("select");
    doc.addClause("from");
    doc.addClause("where");
    doc.removeClause("where");
    expect(new CanvasPresentation(doc).trailingOptions).toContain("where");

    doc.startOver();
    const empty = new CanvasPresentation(doc);
    expect(empty.showsInitialAddButton).toBe(true);
    expect(empty.visibleClauseKinds).toEqual([]);
  });

  it("trims a status message and treats a blank one as absent", () => {
    const doc = new QueryDocument();
    expect(new CanvasPresentation(doc).visibleStatusMessage).toBeNull();
    expect(new CanvasPresentation(doc, "   ").visibleStatusMessage).toBeNull();
    expect(new CanvasPresentation(doc, "  Query finished.  ").visibleStatusMessage).toBe(
      "Query finished.",
    );
  });

  it("shows a root card for non-SELECT statements only", () => {
    for (const kind of ["createTable", "update", "delete"] as const) {
      const doc = new QueryDocument();
      doc.chooseStatement(kind);
      expect(new CanvasPresentation(doc).showsStatementRootCard).toBe(true);
    }

    const select = new QueryDocument();
    select.chooseStatement("select");
    expect(new CanvasPresentation(select).showsStatementRootCard).toBe(false);
    expect(new CanvasPresentation(new QueryDocument()).showsStatementRootCard).toBe(false);
  });

  it("hides the trailing add button once every SELECT clause is present", () => {
    const doc = new QueryDocument();
    doc.chooseStatement("select");
    expect(new CanvasPresentation(doc).showsTrailingAddButton).toBe(true);

    for (const kind of ["from", "where", "orderBy", "limit"] as const) {
      doc.addClause(kind);
    }
    expect(new CanvasPresentation(doc).showsTrailingAddButton).toBe(false);

    const empty = new CanvasPresentation(new QueryDocument());
    expect(empty.showsTrailingAddButton).toBe(false);
  });
});
