import { describe, expect, it } from "vitest";
import { compactCell } from "../../src/lib/result-compactor";

describe("compactCell", () => {
  it("truncates cells longer than 2048 including '... [truncated]' suffix", () => {
    const suffix = "... [truncated]";
    const long = "x".repeat(3000);
    const out = compactCell(long);
    expect(out.length).toBe(2048);
    expect(out.endsWith(suffix)).toBe(true);
    expect(out.slice(0, 2048 - suffix.length)).toBe("x".repeat(2048 - suffix.length));
  });

  it("leaves short cells unchanged", () => {
    expect(compactCell("hello")).toBe("hello");
    expect(compactCell("x".repeat(2048))).toBe("x".repeat(2048));
  });
});
