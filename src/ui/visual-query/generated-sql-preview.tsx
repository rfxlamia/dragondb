import { useState } from "react";
import { VisualQueryAccessibility } from "./accessibility";
import { VisualQueryCopy } from "./copy";
import "./visual-query.css";

export function GeneratedSQLPreview(props: { sql: string }): React.JSX.Element {
  const { sql } = props;
  const [copiedSql, setCopiedSql] = useState<string | null>(null);
  const copied = copiedSql === sql;

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(sql);
      setCopiedSql(sql);
    } catch {
      // keep Copy label when clipboard write fails — no toast in SP-4a
    }
  }

  return (
    <div className="vq-sql-preview">
      <div className="vq-sql-preview__header">
        <button
          type="button"
          className="vq-sql-preview__copy"
          data-testid={
            copied ? VisualQueryAccessibility.generatedSQLDone : VisualQueryAccessibility.copySQL
          }
          onClick={() => void handleCopy()}
        >
          {copied ? VisualQueryCopy.copySQLDoneTitle : VisualQueryCopy.copySQLTitle}
        </button>
      </div>
      <pre className="vq-sql-preview__text" data-testid={VisualQueryAccessibility.generatedSQLText}>
        {sql}
      </pre>
    </div>
  );
}
