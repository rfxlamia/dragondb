import { useEffect, useState } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import type { DragonIpc, HistoryDto } from "../../ipc/contract";
import {
  exportHistoryCsv,
  exportHistoryJson,
  exportHistorySql,
} from "../../lib/query-history-exporter";
import type { HistoryState } from "../../stores/history-store";
import { VisualQueryCopy } from "../visual-query/copy";
import { HistoryAccessibility } from "./history-accessibility";
import { formatRelativeDate, HistoryCopy } from "./history-copy";
import "./history.css";

const SQL_PREVIEW_LINES = 5;

export type QueryHistorySheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  historyStore: StoreApi<HistoryState>;
  saveTextFile: DragonIpc["saveTextFile"];
};

export function QueryHistorySheet(props: QueryHistorySheetProps): React.JSX.Element | null {
  const { open, onOpenChange, historyStore, saveTextFile } = props;
  const entries = useStore(historyStore, (s) => s.entries);
  const loadError = useStore(historyStore, (s) => s.loadError);
  const [ready, setReady] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setReady(false);
      setExportError(null);
      return;
    }
    let cancelled = false;
    void historyStore
      .getState()
      .refresh()
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, historyStore]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        onOpenChange(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  if (!open) return null;

  const hasRows = entries.length > 0;
  const showEmpty = ready && loadError === null && !hasRows;

  async function exportAs(
    text: string,
    defaultPath: string,
    filter: { name: string; extensions: string[] },
  ): Promise<void> {
    try {
      await saveTextFile(text, defaultPath, filter);
      setExportError(null);
    } catch (err) {
      const message =
        err instanceof Error && err.message.length > 0 ? err.message : HistoryCopy.exportFailed;
      setExportError(message);
    }
  }

  return (
    <div
      className="history-sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby="history-sheet-title"
      data-testid={HistoryAccessibility.sheet}
    >
      <div className="history-sheet__header">
        <h2 id="history-sheet-title" className="history-sheet__title">
          {VisualQueryCopy.historyTitle}
        </h2>
        <div className="history-sheet__exports" data-testid={HistoryAccessibility.export}>
          <button
            type="button"
            className="history-sheet__export-format"
            disabled={!hasRows}
            onClick={() => {
              void exportAs(exportHistoryJson(entries), "query-history.json", {
                name: "JSON",
                extensions: ["json"],
              });
            }}
          >
            {HistoryCopy.exportJson}
          </button>
          <button
            type="button"
            className="history-sheet__export-format"
            disabled={!hasRows}
            onClick={() => {
              void exportAs(exportHistoryCsv(entries), "query-history.csv", {
                name: "CSV",
                extensions: ["csv"],
              });
            }}
          >
            {HistoryCopy.exportCsv}
          </button>
          <button
            type="button"
            className="history-sheet__export-format"
            disabled={!hasRows}
            onClick={() => {
              void exportAs(exportHistorySql(entries), "query-history.sql", {
                name: "SQL",
                extensions: ["sql"],
              });
            }}
          >
            {HistoryCopy.exportSql}
          </button>
        </div>
      </div>

      <div className="history-sheet__body">
        {loadError !== null ? (
          <div className="history-sheet__error" data-testid={HistoryAccessibility.loadError}>
            {loadError}
          </div>
        ) : null}
        {exportError !== null ? <div className="history-sheet__error">{exportError}</div> : null}
        {showEmpty ? (
          <div className="history-sheet__empty">
            <div className="history-sheet__empty-title">{HistoryCopy.empty}</div>
            <div className="history-sheet__empty-hint">{HistoryCopy.emptyHint}</div>
          </div>
        ) : null}
        {hasRows ? (
          <ol className="history-sheet__list">
            {entries.map((entry) => (
              <HistoryRow key={entry.id} entry={entry} />
            ))}
          </ol>
        ) : null}
      </div>

      <div className="history-sheet__actions">
        <button
          type="button"
          className="history-sheet__done"
          data-testid={HistoryAccessibility.done}
          onClick={() => onOpenChange(false)}
        >
          {HistoryCopy.done}
        </button>
      </div>
    </div>
  );
}

function HistoryRow(props: { entry: HistoryDto }): React.JSX.Element {
  const { entry } = props;
  const preview = entry.sql.split("\n").slice(0, SQL_PREVIEW_LINES).join("\n");

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(entry.sql);
    } catch {
      // Keep the sheet open; Copy is best-effort.
    }
  }

  return (
    <li className="history-sheet__row" data-testid={HistoryAccessibility.row(entry.id)}>
      <div className="history-sheet__row-meta">
        <span className="history-sheet__status">
          {entry.success ? HistoryCopy.success : HistoryCopy.failed}
        </span>
        <span className="history-sheet__duration">{entry.durationMs} ms</span>
        <span className="history-sheet__when">{formatRelativeDate(entry.createdAt)}</span>
        <span className="history-sheet__database">{HistoryCopy.databaseNa}</span>
      </div>
      <pre className="history-sheet__sql" data-testid={HistoryAccessibility.sql(entry.id)}>
        {preview}
      </pre>
      <button
        type="button"
        className="history-sheet__copy"
        data-testid={HistoryAccessibility.copy(entry.id)}
        onClick={() => void handleCopy()}
      >
        {HistoryCopy.copy}
      </button>
    </li>
  );
}
