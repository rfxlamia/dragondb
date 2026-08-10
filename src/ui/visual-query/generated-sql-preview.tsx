import { VisualQueryAccessibility } from "./accessibility";
import { VisualQueryCopy } from "./copy";
import "./visual-query.css";

export function GeneratedSQLPreview(props: { sql: string }): React.JSX.Element {
  const { sql } = props;

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(sql);
    } catch {
      // ignore — no toast in SP-4a
    }
  }

  return (
    <div className="vq-sql-preview">
      <div className="vq-sql-preview__header">
        <button
          type="button"
          className="vq-sql-preview__copy"
          data-testid={VisualQueryAccessibility.copySQL}
          onClick={() => void handleCopy()}
        >
          {VisualQueryCopy.copySQLTitle}
        </button>
      </div>
      <pre className="vq-sql-preview__text" data-testid={VisualQueryAccessibility.generatedSQLText}>
        {sql}
      </pre>
    </div>
  );
}
