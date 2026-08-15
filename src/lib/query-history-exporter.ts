import type { HistoryDto } from "../ipc/contract";
import { toCsv } from "./csv-exporter";

export function exportHistoryJson(rows: HistoryDto[]): string {
  return JSON.stringify(
    rows.map((row) => ({
      queryText: row.sql,
      executionDate: row.createdAt,
      executionTime: row.durationMs / 1000,
      isSuccess: row.success,
      databaseName: null,
      connectionId: row.profileId,
    })),
  );
}

export function exportHistoryCsv(rows: HistoryDto[]): string {
  return toCsv(
    ["Date", "Database", "Success", "ExecutionTimeMs", "Query"],
    rows.map((row) => [
      row.createdAt,
      "",
      row.success ? "Yes" : "No",
      String(row.durationMs),
      row.sql,
    ]),
  );
}

export function exportHistorySql(rows: HistoryDto[]): string {
  return rows.map(formatSqlBlock).join("\n\n");
}

function formatSqlBlock(row: HistoryDto): string {
  const status = row.success ? "Success" : "Failed";
  const header = `-- [${row.createdAt}] ${status} Database: N/A`;
  return `${header}\n${ensureSemicolon(row.sql)}`;
}

function ensureSemicolon(sql: string): string {
  const trimmed = sql.trimEnd();
  return trimmed.endsWith(";") ? trimmed : `${trimmed};`;
}
