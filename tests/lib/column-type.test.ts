import { describe, expect, it } from "vitest";
import { categorizeColumnType } from "../../src/lib/column-type";

describe("categorizeColumnType", () => {
  it.each([
    [1082, "date"],
    [1114, "timestamp"],
    [1184, "timestamptz"],
  ] as const)("categorizes date-formatting OID %i as %s", (oid, category) => {
    expect(categorizeColumnType(oid)).toEqual({ category, exactPrecision: false });
  });

  it.each([1083, 1266, 1186])("keeps non-date temporal OID %i as text", (oid) => {
    expect(categorizeColumnType(oid)).toEqual({ category: "text", exactPrecision: false });
  });

  it.each([21, 23, 700, 701])("categorizes numeric-comparison OID %i", (oid) => {
    expect(categorizeColumnType(oid)).toEqual({ category: "number", exactPrecision: false });
  });

  it.each([20, 1700])("marks precision-sensitive numeric OID %i", (oid) => {
    expect(categorizeColumnType(oid)).toEqual({ category: "number", exactPrecision: true });
  });

  it("categorizes bool separately", () => {
    expect(categorizeColumnType(16)).toEqual({ category: "boolean", exactPrecision: false });
  });

  it.each([25, 999_999])("falls back to text for text and unknown OID %i", (oid) => {
    expect(categorizeColumnType(oid)).toEqual({ category: "text", exactPrecision: false });
  });
});
