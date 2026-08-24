import type { ResultColumn } from "../../ipc/contract";
import { categorizeColumnType } from "../../lib/column-type";
import {
  isNullCell,
  isTruncatedCell,
  isUnreadableCell,
  isValueCell,
  UNREADABLE_EXPORT_SENTINEL,
} from "../../lib/result-cell";
import { TRUNCATION_SUFFIX } from "../../lib/result-compactor";

function isNullish(cell: unknown): boolean {
  return isNullCell(cell) || cell === undefined;
}

function cellSortText(cell: unknown): string {
  if (isUnreadableCell(cell)) return UNREADABLE_EXPORT_SENTINEL;
  if (isTruncatedCell(cell)) return cell.text + TRUNCATION_SUFFIX;
  if (isValueCell(cell)) return cell.text;
  if (typeof cell === "boolean") return cell ? "true" : "false";
  if (typeof cell === "number") return String(cell);
  if (typeof cell === "string") return cell;
  return String(cell);
}

function compareIntegerStrings(a: string, b: string): number {
  const aTrim = a.replace(/^0+/, "") || "0";
  const bTrim = b.replace(/^0+/, "") || "0";
  if (aTrim.length !== bTrim.length) return aTrim.length < bTrim.length ? -1 : 1;
  return aTrim.localeCompare(bTrim);
}

const DECIMAL_TEXT = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

function compareDecimalText(a: string, b: string): number {
  if (!DECIMAL_TEXT.test(a) || !DECIMAL_TEXT.test(b)) {
    return a.localeCompare(b, undefined, { sensitivity: "base" });
  }
  const aNeg = a.startsWith("-");
  const bNeg = b.startsWith("-");
  if (aNeg && !bNeg) return -1;
  if (!aNeg && bNeg) return 1;

  const aAbs = stripSign(a);
  const bAbs = stripSign(b);
  const [aInt = "0", aFrac = ""] = aAbs.split(".");
  const [bInt = "0", bFrac = ""] = bAbs.split(".");

  const intCmp = compareIntegerStrings(aInt, bInt);
  if (intCmp !== 0) return aNeg ? -intCmp : intCmp;

  const maxLen = Math.max(aFrac.length, bFrac.length);
  const aPadded = aFrac.padEnd(maxLen, "0");
  const bPadded = bFrac.padEnd(maxLen, "0");
  const fracCmp = aPadded.localeCompare(bPadded);
  return aNeg ? -fracCmp : fracCmp;
}

function stripSign(value: string): string {
  if (value.startsWith("-") || value.startsWith("+")) return value.slice(1);
  return value;
}

function compareBigIntText(a: string, b: string): number {
  try {
    const aBig = BigInt(a);
    const bBig = BigInt(b);
    if (aBig < bBig) return -1;
    if (aBig > bBig) return 1;
    return 0;
  } catch {
    return a.localeCompare(b, undefined, { sensitivity: "base" });
  }
}

function compareJsSafeNumber(a: string, b: string): number {
  const aNum = Number(a);
  const bNum = Number(b);
  if (Number.isNaN(aNum) || Number.isNaN(bNum)) {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  }
  return aNum - bNum;
}

function compareExactNumber(a: string, b: string, typeOid: number | undefined): number {
  if (typeOid === 20) return compareBigIntText(a, b);
  return compareDecimalText(a, b);
}

function compareChronological(a: string, b: string): number {
  return a.localeCompare(b);
}

/** Compare two result cells using the column's PostgreSQL type metadata. Nulls sort last. */
export function compareResultCells(
  a: unknown,
  b: unknown,
  columnMetadata: ResultColumn | undefined,
): number {
  const aNull = isNullish(a);
  const bNull = isNullish(b);
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;

  const { category, exactPrecision } = categorizeColumnType(columnMetadata?.typeOid ?? 0);
  const aText = cellSortText(a);
  const bText = cellSortText(b);

  switch (category) {
    case "number":
      return exactPrecision
        ? compareExactNumber(aText, bText, columnMetadata?.typeOid)
        : compareJsSafeNumber(aText, bText);
    case "date":
    case "timestamp":
    case "timestamptz":
      return compareChronological(aText, bText);
    case "boolean":
      return aText.localeCompare(bText);
    default:
      return aText.localeCompare(bText, undefined, { sensitivity: "base" });
  }
}
