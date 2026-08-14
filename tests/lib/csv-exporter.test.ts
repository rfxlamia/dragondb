import { describe, expect, it } from "vitest";
import { toCsv } from "../../src/lib/csv-exporter";

describe("toCsv", () => {
  // Swift CSVExporter: quote only when comma/newline/quote present; empty/nil → bare empty field (NOT "").
  it("escapes per Swift/RFC4180 (empty → bare field, not quoted empty string)", () => {
    const csv = toCsv(
      ["name", "note", "empty"],
      [
        ["Ada", "hello, world", ""],
        ['say "hi"', "plain", null],
      ],
    );
    const lines = csv.trimEnd().split("\n");
    expect(lines[0]).toBe("name,note,empty");
    expect(lines[1]).toBe('Ada,"hello, world",');
    expect(lines[2]).toBe('"say ""hi""",plain,');
  });
});
