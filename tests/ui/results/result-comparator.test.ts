/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import type { ResultColumn } from "../../../src/ipc/contract";
import { compareResultCells } from "../../../src/ui/results/result-comparator";
import { valueCell } from "../../lib/result-fixture";

function column(typeName: string, typeOid: number): ResultColumn {
  return { name: typeName, typeName, typeOid };
}

function sortValues(values: string[], col: ResultColumn): string[] {
  const cells = values.map((text) => valueCell(text));
  return cells
    .slice()
    .sort((a, b) => compareResultCells(a, b, col))
    .map((cell) => (cell as { text: string }).text);
}

describe("compareResultCells", () => {
  it("Numeric columns sort numerically once values are text", () => {
    const int4Col = column("int4", 23);
    const int8Col = column("int8", 20);
    const numericCol = column("numeric", 1700);
    const dateCol = column("date", 1082);
    const textCol = column("text", 25);

    expect(sortValues(["-5", "3", "-10"], int4Col)).toEqual(["-10", "-5", "3"]);

    const numberSpy = vi.spyOn(globalThis, "Number");
    expect(sortValues(["9223372036854775807", "9223372036854775806"], int8Col)).toEqual([
      "9223372036854775806",
      "9223372036854775807",
    ]);
    expect(numberSpy).not.toHaveBeenCalled();
    numberSpy.mockRestore();

    const numericSpy = vi.spyOn(globalThis, "Number");
    expect(sortValues(["1.5", "1.25", "1.10"], numericCol)).toEqual(["1.10", "1.25", "1.5"]);
    expect(numericSpy).not.toHaveBeenCalled();
    numericSpy.mockRestore();

    expect(sortValues(["2024-03-01", "2024-01-15", "2024-02-01"], dateCol)).toEqual([
      "2024-01-15",
      "2024-02-01",
      "2024-03-01",
    ]);

    expect(sortValues(["beta", "Alpha", "alpha"], textCol)).toEqual(["Alpha", "alpha", "beta"]);

    const withNulls = [valueCell("3"), null, valueCell("-10"), valueCell("-5")];
    const sortedNulls = withNulls
      .slice()
      .sort((a, b) => compareResultCells(a, b, int4Col))
      .map((cell) => (cell === null ? null : (cell as { text: string }).text));
    expect(sortedNulls).toEqual(["-10", "-5", "3", null]);

    expect(() =>
      compareResultCells({ state: "unreadable", typeName: "int8" }, valueCell("1"), int8Col),
    ).not.toThrow();
    expect(() =>
      compareResultCells({ state: "truncated", text: "922337203685477" }, valueCell("2"), int8Col),
    ).not.toThrow();
  });
});
