import type {
  ResultCell,
  ResultColumn,
  TruncatedCell,
  UnreadableCell,
  ValueCell,
} from "../ipc/contract";
import { categorizeColumnType } from "./column-type";
import { TRUNCATION_SUFFIX } from "./result-compactor";

export const UNREADABLE_EXPORT_SENTINEL = "[unreadable]";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isNullCell(cell: unknown): cell is null {
  return cell === null;
}

export function isValueCell(cell: unknown): cell is ValueCell {
  return isRecord(cell) && cell.state === "value" && typeof cell.text === "string";
}

export function isUnreadableCell(cell: unknown): cell is UnreadableCell {
  return isRecord(cell) && cell.state === "unreadable" && typeof cell.typeName === "string";
}

export function isTruncatedCell(cell: unknown): cell is TruncatedCell {
  return isRecord(cell) && cell.state === "truncated" && typeof cell.text === "string";
}

export function resultCellToExportValue(cell: ResultCell): string | null {
  if (isNullCell(cell)) return null;
  if (isUnreadableCell(cell)) return UNREADABLE_EXPORT_SENTINEL;
  if (isTruncatedCell(cell)) return cell.text + TRUNCATION_SUFFIX;
  return cell.text;
}

/** JSON export value with natural types where lossless; int8 and numeric stay strings. */
export function resultCellToJsonExportValue(
  cell: ResultCell,
  columnMetadata?: ResultColumn,
): unknown {
  if (isNullCell(cell)) return null;
  if (isUnreadableCell(cell)) return UNREADABLE_EXPORT_SENTINEL;
  if (isTruncatedCell(cell)) return cell.text + TRUNCATION_SUFFIX;
  if (!isValueCell(cell)) return null;

  const text = cell.text;
  if (columnMetadata === undefined) return text;

  const { category, exactPrecision } = categorizeColumnType(columnMetadata.typeOid);
  if (exactPrecision) return text;
  if (category === "boolean") return text === "true";
  if (category === "number") {
    const num = Number(text);
    return Number.isFinite(num) ? num : text;
  }
  return text;
}

export function resultRowToCsvFields(row: ResultCell[]): Array<string | null> {
  return row.map(resultCellToExportValue);
}
