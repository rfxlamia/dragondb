import { TablesAccessibility } from "./tables-accessibility";
import { TablesCopy } from "./tables-copy";

export function TableDdlSheet(props: {
  open: boolean;
  ddl: string;
  error?: string | null;
  onClose: () => void;
}): React.JSX.Element | null {
  const { open, ddl, error = null, onClose } = props;
  if (!open) return null;

  async function handleCopy(): Promise<void> {
    if (ddl.length === 0) return;
    try {
      await navigator.clipboard.writeText(ddl);
    } catch {
      /* Keep the sheet open if the clipboard is unavailable. */
    }
  }

  return (
    <div
      className="table-sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby="table-ddl-title"
      data-testid={TablesAccessibility.ddlSheet}
    >
      <h2 id="table-ddl-title" className="table-sheet__title">
        {TablesCopy.ddlTitle}
      </h2>
      <pre className="table-sheet__text" data-testid={TablesAccessibility.ddlText}>
        {ddl}
      </pre>
      {error ? <p className="table-sheet__error">{error}</p> : null}
      <div className="table-sheet__actions">
        <button
          type="button"
          className="table-sheet__secondary"
          disabled={ddl.length === 0}
          onClick={() => void handleCopy()}
        >
          {TablesCopy.copy}
        </button>
        <button type="button" className="table-sheet__primary" onClick={onClose}>
          {TablesCopy.done}
        </button>
      </div>
    </div>
  );
}
