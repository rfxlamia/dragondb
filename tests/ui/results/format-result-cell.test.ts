/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import type { ResultColumn } from "../../../src/ipc/contract";
import { formatResultCell } from "../../../src/ui/results/format-result-cell";
import { ResultsCopy } from "../../../src/ui/results/results-copy";
import { valueCell } from "../../lib/result-fixture";

describe("formatResultCell", () => {
  it("SQL null is NULL token; false/0/empty string are not", () => {
    expect(formatResultCell(null, undefined)).toBe(ResultsCopy.nullToken);
    expect(formatResultCell(undefined, undefined)).toBe(ResultsCopy.nullToken);
    expect(formatResultCell(false, undefined)).toBe("false");
    expect(formatResultCell(0, undefined)).toBe("0");
    expect(formatResultCell("", undefined)).toBe("");
    expect(formatResultCell("hi", undefined)).toBe("hi");
  });

  it("formats by column type, not by sniffing cell text", () => {
    const varchar: ResultColumn = { name: "code", typeName: "varchar", typeOid: 1043 };
    const date: ResultColumn = { name: "occurred_on", typeName: "date", typeOid: 1082 };
    const interval: ResultColumn = { name: "elapsed", typeName: "interval", typeOid: 1186 };
    const bool: ResultColumn = { name: "active", typeName: "bool", typeOid: 16 };

    expect(formatResultCell(valueCell("2024-01-15"), varchar, "us")).toBe("2024-01-15");
    expect(formatResultCell(valueCell("2024-01-15"), date, "us")).toBe("1/15/2024");
    expect(formatResultCell(valueCell("2 days 3 hours"), interval, "us")).toBe("2 days 3 hours");
    expect(formatResultCell(valueCell("true"), bool, "us")).toBe("true");
    expect(formatResultCell(valueCell("false"), bool, "us")).toBe("false");
    expect(formatResultCell(null, date, "us")).toBe(ResultsCopy.nullToken);
  });
});
