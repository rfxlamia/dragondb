import { describe, expect, it } from "vitest";
import { ResultsAccessibility } from "../../../src/ui/results/results-accessibility";

const EXPECTED = [
  "queryResults.pane",
  "queryResults.grid",
  "queryResults.loading",
  "queryResults.error",
  "queryResults.empty",
  "queryResults.splitSeparator",
  "queryResults.filter",
  "queryResults.toolbar",
  "queryResults.jsonViewer",
  "queryResults.rowEditor",
  "queryResults.pagination",
] as const;

describe("ResultsAccessibility", () => {
  it("exports pane/grid/loading/error/empty/splitSeparator as queryResults.*", () => {
    expect(ResultsAccessibility.pane).toBe("queryResults.pane");
    expect(ResultsAccessibility.grid).toBe("queryResults.grid");
    expect(ResultsAccessibility.loading).toBe("queryResults.loading");
    expect(ResultsAccessibility.error).toBe("queryResults.error");
    expect(ResultsAccessibility.empty).toBe("queryResults.empty");
    expect(ResultsAccessibility.splitSeparator).toBe("queryResults.splitSeparator");
    for (const id of EXPECTED) {
      expect(ResultsAccessibility.allIdentifiers).toContain(id);
    }
  });

  it("allIdentifiers are unique and start with queryResults.", () => {
    const ids = ResultsAccessibility.allIdentifiers;
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(EXPECTED.length);
    for (const id of ids) {
      expect(id.startsWith("queryResults.")).toBe(true);
    }
  });
});
