import { describe, expect, it } from "vitest";
import {
  isNullCell,
  isTruncatedCell,
  isUnreadableCell,
  isValueCell,
  resultCellToExportValue,
} from "../../src/lib/result-cell";

describe("result cell state helpers", () => {
  const value = { state: "value" as const, text: "exact text" };
  const unreadable = { state: "unreadable" as const, typeName: "bytea" };
  const truncated = { state: "truncated" as const, text: "partial value" };

  it("identifies all four contract states without conflating null and unreadable", () => {
    const cells = [value, null, unreadable, truncated];

    expect(cells.map(isValueCell)).toEqual([true, false, false, false]);
    expect(cells.map(isNullCell)).toEqual([false, true, false, false]);
    expect(cells.map(isUnreadableCell)).toEqual([false, false, true, false]);
    expect(cells.map(isTruncatedCell)).toEqual([false, false, false, true]);
  });

  it("rejects malformed and unrelated unknown values", () => {
    expect(isValueCell({ state: "value" })).toBe(false);
    expect(isUnreadableCell({ state: "unreadable", typeName: 23 })).toBe(false);
    expect(isTruncatedCell({ state: "truncated", text: null })).toBe(false);
    expect(isNullCell(undefined)).toBe(false);
    expect(isValueCell("exact text")).toBe(false);
  });

  it("converts each state to its documented export representation", () => {
    expect(resultCellToExportValue(value)).toBe("exact text");
    expect(resultCellToExportValue(null)).toBeNull();
    expect(resultCellToExportValue(unreadable)).toBe("[unreadable]");
    expect(resultCellToExportValue(truncated)).toBe("partial value... [truncated]");
  });
});
