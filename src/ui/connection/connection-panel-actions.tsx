import type { ProfileId } from "../../ipc/contract";
import { ConnectionAccessibility } from "./connection-accessibility";
import { ConnectionCopy } from "./connection-copy";

export function ConnectionPanelActions(props: {
  busy: boolean;
  canConnect: boolean;
  sessionClaimed: boolean;
  selectedId: ProfileId | null;
  hideConnect?: boolean;
  onSave: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
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
    onDisconnect,
    onRequestDelete,
    onCancel,
  } = props;
  return (
    <div className="connection-panel__actions">
      <button type="button" onClick={onSave} disabled={busy}>
        {ConnectionCopy.save}
      </button>

      {sessionClaimed ? (
        <button type="button" onClick={onDisconnect} disabled={busy}>
          {ConnectionCopy.disconnect}
        </button>
      ) : hideConnect ? null : (
        <button
          type="button"
          className="connection-panel__primary"
          onClick={onConnect}
          disabled={!canConnect}
        >
          {ConnectionCopy.connect}
        </button>
      )}

      {selectedId !== null ? (
        <button type="button" onClick={onRequestDelete} disabled={busy}>
          {ConnectionCopy.delete}
        </button>
      ) : null}

      <button
        type="button"
        data-testid={ConnectionAccessibility.formCancel}
        onClick={onCancel}
        disabled={busy}
      >
        {ConnectionCopy.cancel}
      </button>
    </div>
  );
}
