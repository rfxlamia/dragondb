import type { ResultCell, TruncatedCell, UnreadableCell, ValueCell } from "../ipc/contract";
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
