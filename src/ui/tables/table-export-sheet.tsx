import { useState } from "react";
import type { DragonIpc, QueryResult, TableRef } from "../../ipc/contract";
import { toCsv } from "../../lib/csv-exporter";
import { resultCellToJsonExportValue, resultRowToCsvFields } from "../../lib/result-cell";
import { TablesAccessibility } from "./tables-accessibility";
import { TablesCopy } from "./tables-copy";

export type TableExportRows = Pick<QueryResult, "columns" | "columnTypes" | "rows">;

export function TableExportSheet(props: {
  open: boolean;
  table: TableRef;
  onClose: () => void;
  onFetchAll: (table: TableRef) => Promise<TableExportRows>;
  saveCsvFile: DragonIpc["saveCsvFile"];
  saveTextFile: DragonIpc["saveTextFile"];
}): React.JSX.Element | null {
  const { open, table, onClose, onFetchAll, saveCsvFile, saveTextFile } = props;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [raw, setRaw] = useState<TableExportRows | null>(null);

  if (!open) return null;

  async function ensureRaw(): Promise<TableExportRows> {
    if (raw !== null) return raw;
    const fetched = await onFetchAll(table);
    setRaw(fetched);
    return fetched;
  }

  async function exportCsv(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const data = await ensureRaw();
      const csv = toCsv(
        data.columns,
        data.rows.map((row) => resultRowToCsvFields(row)),
      );
      await saveCsvFile(csv, `${table.name}.csv`);
    } catch (err) {
      setError(
        err instanceof Error && err.message.length > 0 ? err.message : TablesCopy.exportFailed,
      );
    } finally {
      setBusy(false);
    }
  }

  async function exportJson(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const data = await ensureRaw();
      const text = exportJsonDocument(data);
      await saveTextFile(text, `${table.name}.json`, { name: "JSON", extensions: ["json"] });
    } catch (err) {
      setError(
        err instanceof Error && err.message.length > 0 ? err.message : TablesCopy.exportFailed,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="table-sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby="table-export-title"
      data-testid={TablesAccessibility.exportSheet}
    >
      <h2 id="table-export-title" className="table-sheet__title">
        {TablesCopy.exportTitle}
      </h2>
      {error ? <p className="table-sheet__error">{error}</p> : null}
      <div className="table-sheet__actions">
        <button
          type="button"
          className="table-sheet__secondary"
          disabled={busy}
          onClick={() => void exportCsv()}
        >
          {TablesCopy.exportCsv}
        </button>
        <button
          type="button"
          className="table-sheet__secondary"
          disabled={busy}
          onClick={() => void exportJson()}
        >
          {TablesCopy.exportJson}
        </button>
        <button type="button" className="table-sheet__primary" onClick={onClose} disabled={busy}>
          {TablesCopy.done}
        </button>
      </div>
    </div>
  );
}

function exportJsonDocument(data: TableExportRows): string {
  const rows = data.rows.map((row) =>
    row.map((cell, index) => resultCellToJsonExportValue(cell, data.columnTypes[index])),
  );
  return JSON.stringify({ columns: data.columns, rows }, null, 2);
}
