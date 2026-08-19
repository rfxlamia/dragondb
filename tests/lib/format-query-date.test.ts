import { describe, expect, it } from "vitest";
import { formatQueryDate } from "../../src/lib/format-query-date";

describe("formatQueryDate", () => {
  it("formats US dates and refuses strings longer than 64 chars", () => {
    expect(formatQueryDate("2026-08-15T12:00:00Z", "us")).toMatch(/8\/15\/2026/);
    const long = `2026-08-15T12:00:00Z${"x".repeat(50)}`;
    expect(long.length).toBeGreaterThan(64);
    expect(formatQueryDate(long, "us")).toBe(long);
  });

  it("formats timezone-free postgres timestamps on the original calendar day", () => {
    expect(formatQueryDate("2026-01-01 00:30:00", "iso8601DateOnly")).toBe("2026-01-01");
    expect(formatQueryDate("2026-01-01 00:30:00", "us")).toBe("1/1/2026");
    expect(formatQueryDate("2026-01-01 00:30:00", "european")).toBe("1/1/2026");
  });
});
