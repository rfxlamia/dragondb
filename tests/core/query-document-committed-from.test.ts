import { describe, expect, it } from "vitest";
import { QueryDocument } from "../../src/core";

describe("QueryDocument.committedFromTable", () => {
  it("starts null and stays null while typing without commit", () => {
    const doc = new QueryDocument();
    doc.chooseStatement("select");
    doc.addClause("from");

    expect(doc.committedFromTable).toBeNull();

    doc.setFromTableText("users");
    expect(doc.fromTable).toEqual({ schema: null, name: "users" });
    expect(doc.committedFromTable).toBeNull();
  });

  it("is set after commitFromTable", () => {
    const doc = new QueryDocument();
    doc.chooseStatement("select");
    doc.addClause("from");

    doc.setFromTableText("analytics.events");
    doc.commitFromTable("analytics.events");
    expect(doc.committedFromTable).toEqual({ schema: "analytics", name: "events" });
  });

  it("is set after selectFromTable", () => {
    const doc = new QueryDocument();
    doc.chooseStatement("select");
    doc.addClause("from");

    doc.selectFromTable("users", "public");
    expect(doc.committedFromTable).toEqual({ schema: "public", name: "users" });
  });

  it("returns null after startOver", () => {
    const doc = new QueryDocument();
    doc.chooseStatement("select");
    doc.addClause("from");
    doc.selectFromTable("users", null);

    doc.startOver();
    expect(doc.committedFromTable).toBeNull();
  });
});
