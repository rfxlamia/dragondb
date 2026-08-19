import { describe, expect, it } from "vitest";
import { createSavedQueryResultCache } from "../../../src/ui/library/saved-query-result-cache";

describe("createSavedQueryResultCache", () => {
  it("writes compact+ok status, reads it back, ignores non-ok writes, and clear drops all", () => {
    const cache = createSavedQueryResultCache();
    const compact = { columns: ["id"], rows: [[1], [2]] };
    const okStatus = { kind: "ok" as const, rowCount: 2, durationMs: 5 };
    cache.write("q1", compact, okStatus);
    expect(cache.read("q1")).toEqual({ compact, status: okStatus });
    cache.write("q1", { columns: ["id"], rows: [] }, { kind: "error", message: "boom" });
    expect(cache.read("q1")).toEqual({ compact, status: okStatus });
    cache.clear();
    expect(cache.read("q1")).toBeNull();
  });
});
