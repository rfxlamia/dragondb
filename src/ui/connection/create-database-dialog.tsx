import { useEffect, useRef } from "react";
import { useEscapeDismiss } from "../use-escape-dismiss";
import { ConnectionAccessibility } from "./connection-accessibility";
import { ConnectionCopy } from "./connection-copy";
import { useCreateDatabaseFlow } from "./use-create-database-flow";
import "./connection-panel.css";

export function CreateDatabaseDialog(props: {
  open: boolean;
  busy?: boolean;
  error?: string | null;
  onCreate: (name: string) => void | Promise<void>;
  onConnect?: (name: string) => void | Promise<void>;
  onCancel: () => void;
}): React.JSX.Element | null {
  const { open, busy = false, error = null, onCreate, onConnect, onCancel } = props;
  const nameRef = useRef<HTMLInputElement>(null);
  const flow = useCreateDatabaseFlow({ open, busy, error, onCreate, onConnect });

  useEffect(() => {
    if (!open) return;
    nameRef.current?.focus();
  }, [open]);

  useEscapeDismiss(() => {
    if (!flow.pending) onCancel();
  }, open);

  if (!open) return null;

  return (
    <div
      className="connection-panel__confirm"
      role="dialog"
      aria-label={ConnectionCopy.createDatabase}
    >
      <form className="connection-panel__create-form" onSubmit={flow.handleSubmit}>
        <label className="connection-form__field">
          <span>{ConnectionCopy.databaseName}</span>
          <input
            ref={nameRef}
            type="text"
            name="databaseName"
            value={flow.name}
            data-testid={ConnectionAccessibility.createDatabaseName}
            readOnly={flow.created}
            autoComplete="off"
            onChange={(event) => flow.changeName(event.target.value)}
          />
        </label>
        {flow.created ? (
          <p
            className="connection-panel__created"
            data-testid={ConnectionAccessibility.createDatabaseCreated}
          >
            {ConnectionCopy.databaseCreated}
          </p>
        ) : null}
        {flow.shownError ? (
          <p
            className="connection-panel__status"
            role="alert"
            data-testid={ConnectionAccessibility.createDatabaseError}
          >
            {flow.shownError}
          </p>
        ) : null}
        <div className="connection-panel__confirm-actions">
          {flow.created ? (
            <button
              type="button"
              className="connection-panel__primary"
              disabled={flow.pending}
              onClick={flow.handleConnect}
            >
              {ConnectionCopy.connect}
            </button>
          ) : (
            <button
              type="submit"
              className="connection-panel__primary"
              disabled={flow.pending || flow.blank}
            >
              {ConnectionCopy.create}
            </button>
          )}
          <button type="button" onClick={onCancel} disabled={flow.pending}>
            {ConnectionCopy.cancel}
          </button>
        </div>
      </form>
    </div>
  );
}
