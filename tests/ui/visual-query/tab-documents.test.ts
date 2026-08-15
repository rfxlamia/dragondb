import { describe, expect, it } from "vitest";
import { QueryDocument } from "../../../src/core";
import { createTabDocuments } from "../../../src/ui/visual-query/tab-documents";

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
});
