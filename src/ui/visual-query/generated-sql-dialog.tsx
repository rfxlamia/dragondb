import { VisualQueryAccessibility } from "./accessibility";
import { VisualQueryCopy } from "./copy";
import "./visual-query.css";

export function GeneratedSQLDialog(props: {
  sql: string;
  onDismiss: () => void;
}): React.JSX.Element {
  const { sql, onDismiss } = props;
  const allowsCopy = sql !== VisualQueryCopy.sqlPreviewEmpty && sql.length > 0;

  async function handleCopy(): Promise<void> {
    if (!allowsCopy) return;
    try {
      await navigator.clipboard.writeText(sql);
    } catch {
      // Keep the Copy label and leave the dialog open.
    }
  }

  return (
    <div className="vq-sql-dialog" role="dialog" aria-labelledby="vq-sql-dialog-title">
      <h2 id="vq-sql-dialog-title" className="vq-sql-dialog__title">
        {VisualQueryCopy.viewGeneratedSQLTitle}
      </h2>
      <pre className="vq-sql-dialog__text" data-testid={VisualQueryAccessibility.generatedSQLText}>
        {sql}
      </pre>
      <div className="vq-sql-dialog__actions">
        <button
          type="button"
          className="vq-sql-dialog__copy"
          data-testid={VisualQueryAccessibility.copySQL}
          disabled={!allowsCopy}
          onClick={() => void handleCopy()}
        >
          {VisualQueryCopy.copySQLTitle}
        </button>
        <button
          type="button"
          className="vq-sql-dialog__done"
          data-testid={VisualQueryAccessibility.generatedSQLDone}
          onClick={onDismiss}
        >
          {VisualQueryCopy.generatedSQLDoneTitle}
        </button>
      </div>
    </div>
  );
}
