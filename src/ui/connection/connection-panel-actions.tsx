import type { ProfileId } from "../../ipc/contract";
import { ConnectionAccessibility } from "./connection-accessibility";
import { ConnectionCopy } from "./connection-copy";

/**
 * Footer of the connection sheet. Disconnect is deliberately absent: ending a
 * session is a sidebar action on the live connection, not an edit to the form
 * that happens to be open (see ConnectionPanel's header).
 */
export function ConnectionPanelActions(props: {
  busy: boolean;
  canConnect: boolean;
  sessionClaimed: boolean;
  selectedId: ProfileId | null;
  hideConnect?: boolean;
  onSave: () => void;
  onConnect: () => void;
  onRequestDelete: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const {
    busy,
    canConnect,
    sessionClaimed,
    selectedId,
    hideConnect = false,
    onSave,
    onConnect,
    onRequestDelete,
    onCancel,
  } = props;
  return (
    <div className="connection-panel__actions">
      {selectedId !== null ? (
        <button
          type="button"
          className="connection-panel__danger"
          onClick={onRequestDelete}
          disabled={busy}
        >
          {ConnectionCopy.delete}
        </button>
      ) : null}

      <button
        type="button"
        className="connection-panel__spacer-end"
        data-testid={ConnectionAccessibility.formCancel}
        onClick={onCancel}
        disabled={busy}
      >
        {ConnectionCopy.cancel}
      </button>

      <button type="button" onClick={onSave} disabled={busy}>
        {ConnectionCopy.save}
      </button>

      {sessionClaimed || hideConnect ? null : (
        <button
          type="button"
          className="connection-panel__primary"
          onClick={onConnect}
          disabled={!canConnect}
        >
          {ConnectionCopy.connect}
        </button>
      )}
    </div>
  );
}
