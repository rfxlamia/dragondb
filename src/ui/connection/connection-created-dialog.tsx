import { useEscapeDismiss } from "../use-escape-dismiss";
import { ConnectionCopy } from "./connection-copy";

export function ConnectionCreatedDialog(props: {
  open: boolean;
  onConnectNow: () => void;
  onNotNow: () => void;
}): React.JSX.Element | null {
  const { open, onConnectNow, onNotNow } = props;
  // Escape declines, matching the dialog's own least-committal button.
  useEscapeDismiss(onNotNow, open);
  if (!open) return null;
  return (
    <div
      className="connection-panel__confirm"
      role="dialog"
      aria-label={ConnectionCopy.connectionCreated}
    >
      <p>{ConnectionCopy.connectionCreated}</p>
      <p>{ConnectionCopy.connectNowPrompt}</p>
      <div className="connection-panel__confirm-actions">
        <button type="button" className="connection-panel__primary" onClick={onConnectNow}>
          {ConnectionCopy.connectNow}
        </button>
        <button type="button" onClick={onNotNow}>
          {ConnectionCopy.notNow}
        </button>
      </div>
    </div>
  );
}
