import { useEffect, useState } from "react";
import { useEscapeDismiss } from "../use-escape-dismiss";
import { ConnectionAccessibility } from "./connection-accessibility";
import { ConnectionCopy } from "./connection-copy";

export function CreateDatabaseDialog(props: {
  open: boolean;
  busy?: boolean;
  error?: string | null;
  onCreate: (name: string) => void | Promise<void>;
  onCancel: () => void;
}): React.JSX.Element | null {
  const { open, busy = false, error = null, onCreate, onCancel } = props;
  const [name, setName] = useState("");

  useEffect(() => {
    if (!open) setName("");
  }, [open]);

  // `busy` guards inside the callback so an in-flight create keeps its place
  // on the dismissal stack (see ConnectionConfirmDialog).
  useEscapeDismiss(() => {
    if (!busy) onCancel();
  }, open);

  if (!open) return null;
  return (
    <div
      className="connection-panel__confirm"
      role="dialog"
      aria-label={ConnectionCopy.createDatabase}
    >
      <label className="connection-form__field">
        <span>{ConnectionCopy.databaseName}</span>
        <input
          type="text"
          value={name}
          data-testid={ConnectionAccessibility.createDatabaseName}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      {error ? (
        <p className="connection-panel__status" role="alert">
          {error}
        </p>
      ) : null}
      <div className="connection-panel__confirm-actions">
        <button
          type="button"
          className="connection-panel__primary"
          disabled={busy || name.trim() === ""}
          onClick={() => void onCreate(name.trim())}
        >
          {ConnectionCopy.create}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}>
          {ConnectionCopy.cancel}
        </button>
      </div>
    </div>
  );
}
