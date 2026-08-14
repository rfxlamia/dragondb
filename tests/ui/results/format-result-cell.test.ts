/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { formatResultCell } from "../../../src/ui/results/format-result-cell";
import { ResultsCopy } from "../../../src/ui/results/results-copy";

describe("formatResultCell", () => {
  it("SQL null is NULL token; false/0/empty string are not", () => {
    expect(formatResultCell(null)).toBe(ResultsCopy.nullToken);
    expect(formatResultCell(undefined)).toBe(ResultsCopy.nullToken);
    expect(formatResultCell(false)).toBe("false");
    expect(formatResultCell(0)).toBe("0");
    expect(formatResultCell("")).toBe("");
    expect(formatResultCell("hi")).toBe("hi");
  });
});
