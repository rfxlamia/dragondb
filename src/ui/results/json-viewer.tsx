import { useEffect, useState } from "react";
import { toCsv } from "../../lib/csv-exporter";
import { compactCell } from "../../lib/result-compactor";
import { ResultsAccessibility } from "./results-accessibility";
import { ResultsCopy } from "./results-copy";
import "./query-results.css";

const COPY_JSON_MS = 1750;

export function JsonViewer(props: {
  columns: string[];
  rows: unknown[][];
  onClose?: () => void;
  onSaveCsv?: (csv: string) => void | Promise<void>;
}): React.JSX.Element {
  const { columns, rows, onClose, onSaveCsv } = props;
  const [copied, setCopied] = useState(false);
  const pretty = prettyJsonFromRaw(columns, rows);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPY_JSON_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copyJson(): Promise<void> {
    try {
      await navigator.clipboard.writeText(pretty);
    } catch {
      // Clipboard may be unavailable in tests / locked webviews.
    }
    setCopied(true);
  }

  function downloadCsv(): void {
    const csv = toCsv(columns, rows.map(rowToCsvFields));
    void onSaveCsv?.(csv);
  }

  return (
    <div
      className="query-results__dialog"
      role="dialog"
      aria-modal="true"
      aria-label={ResultsCopy.viewJson}
      data-testid={ResultsAccessibility.jsonViewer}
    >
      <h2 className="query-results__dialog-title">{ResultsCopy.viewJson}</h2>
      <pre className="query-results__json">{pretty}</pre>
      <div className="query-results__dialog-actions">
        <button type="button" className="query-results__btn" onClick={() => void copyJson()}>
          {copied ? ResultsCopy.copied : ResultsCopy.copyJson}
        </button>
        <button type="button" className="query-results__btn" onClick={downloadCsv}>
          {ResultsCopy.downloadCsv}
        </button>
        {onClose ? (
          <button type="button" className="query-results__btn" onClick={onClose}>
            {ResultsCopy.cancel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function prettyJsonFromRaw(columns: string[], rows: unknown[][]): string {
  const objects = rows.map((row) => {
    const record: Record<string, unknown> = {};
    for (const [index, column] of columns.entries()) {
      record[column] = jsonCell(row[index]);
    }
    return record;
  });
  return JSON.stringify(objects, null, 2);
}

/** compactCell is called only to discard truncation — displayed JSON stays raw. */
function jsonCell(value: unknown): unknown {
  if (typeof value === "string") {
    compactCell(value);
    return value;
  }
  return value ?? null;
}

function rowToCsvFields(row: unknown[]): Array<string | null> {
  return row.map((cell) => {
    if (cell === null || cell === undefined) return null;
    if (typeof cell === "string") return cell;
    return String(cell);
  });
}
