import { describe, expect, it } from "vitest";
import { QueryDocument } from "../../../src/core";
import {
  createTabDocuments,
  hydrateQueryDocument,
  serializeQueryDocument,
} from "../../../src/ui/visual-query/tab-documents";

describe("createTabDocuments", () => {
  it("returns a stable QueryDocument per id and resetAll replaces with empty documents", () => {
    const docs = createTabDocuments();
    const first = docs.getOrCreate("a");
    expect(first).toBeInstanceOf(QueryDocument);
    expect(docs.getOrCreate("a")).toBe(first);
    first.chooseStatement("select");
    expect(first.statementKind).toBe("select");
    docs.resetAll(["a", "b"]);
    const afterA = docs.getOrCreate("a");
    const afterB = docs.getOrCreate("b");
    expect(afterA).not.toBe(first);
    expect(afterA.statementKind).toBeNull();
    expect(afterB.statementKind).toBeNull();
    docs.delete("a");
    expect(docs.getOrCreate("a")).not.toBe(afterA);
  });

  it("get returns undefined for a missing id and the same instance after getOrCreate", () => {
    const docs = createTabDocuments();
    expect(docs.get("missing")).toBeUndefined();
    const created = docs.getOrCreate("a");
    expect(docs.get("a")).toBe(created);
  });

  it("hydrates persisted visual JSON into the requested tab slot", () => {
    const source = new QueryDocument();
    source.chooseStatement("select");
    source.addClause("from");
    source.selectFromTable("orders", "public");
    const docs = createTabDocuments();

    const restored = docs.hydrate("restored", serializeQueryDocument(source));

    expect(restored.statementKind).toBe("select");
    expect(restored.fromTable).toEqual({ schema: "public", name: "orders" });
    expect(docs.get("restored")).toBe(restored);
  });

  it("serializes visual cards to JSON and hydrates without using queryText", () => {
    const doc = new QueryDocument();
    doc.chooseStatement("select");
    doc.addClause("from");
    doc.selectFromTable("orders", "public");
    const json = serializeQueryDocument(doc);
    expect(json).not.toMatch(/^SELECT /);
    const restored = hydrateQueryDocument(json);
    expect(restored.fromTable).toEqual({ schema: "public", name: "orders" });
    expect(restored.statementKind).toBe("select");
  });
});
