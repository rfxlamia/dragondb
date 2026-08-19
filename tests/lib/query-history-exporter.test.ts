import { describe, expect, it } from "vitest";
import type { HistoryDto } from "../../src/ipc/contract";
import {
  exportHistoryCsv,
  exportHistoryJson,
  exportHistorySql,
} from "../../src/lib/query-history-exporter";

const row: HistoryDto = {
  id: "h1",
  profileId: "P",
  sql: 'SELECT "x"',
  success: true,
  errorMessage: null,
  durationMs: 1500,
  rowCount: 1,
  createdAt: "2026-08-15T14:03:09.000Z",
};
const failed: HistoryDto = {
  ...row,
  id: "h2",
  sql: "SELECT 2",
  success: false,
  durationMs: 20,
};

describe("query-history-exporter", () => {
  it("JSON uses Swift field names and maps profileId to connectionId", () => {
    const parsed = JSON.parse(exportHistoryJson([row])) as Array<Record<string, unknown>>;
    expect(parsed).toEqual([
      {
        queryText: 'SELECT "x"',
        executionDate: "2026-08-15T14:03:09.000Z",
        executionTime: 1.5,
        isSuccess: true,
        databaseName: null,
        connectionId: "P",
      },
    ]);
  });

  it("CSV starts with the Swift header, Yes/No success, and quotes fields", () => {
    const csv = exportHistoryCsv([row]);
    expect(csv.startsWith("Date,Database,Success,ExecutionTimeMs,Query")).toBe(true);
    expect(csv).toContain("Yes");
    expect(csv).toContain("1500");
    expect(csv).toContain('"SELECT ""x"""');
  });

  it("SQL export uses N/A database, Success/Failed, and appends a missing semicolon", () => {
    const sql = exportHistorySql([row, failed]);
    expect(sql).toContain("-- [2026-08-15T14:03:09.000Z] Success Database: N/A");
    expect(sql).toContain('SELECT "x";');
    expect(sql).toContain("-- [2026-08-15T14:03:09.000Z] Failed Database: N/A");
    expect(sql).toContain("SELECT 2;");
    expect(sql).toContain("\n\n");
  });
});
