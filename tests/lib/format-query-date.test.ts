import { describe, expect, it } from "vitest";
import { formatQueryDate } from "../../src/lib/format-query-date";

describe("formatQueryDate", () => {
  it("formats US dates and refuses strings longer than 64 chars", () => {
    expect(formatQueryDate("2026-08-15T12:00:00Z", "us")).toMatch(/8\/15\/2026/);
    const long = `2026-08-15T12:00:00Z${"x".repeat(50)}`;
    expect(long.length).toBeGreaterThan(64);
    expect(formatQueryDate(long, "us")).toBe(long);
  });
});
