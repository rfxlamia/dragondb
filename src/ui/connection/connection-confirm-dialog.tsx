import { useEscapeDismiss } from "../use-escape-dismiss";
import { ConnectionCopy } from "./connection-copy";

export function ConnectionConfirmDialog(props: {
  title: string;
  prompt: string;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const { title, prompt, confirmLabel, busy, onConfirm, onCancel } = props;
  // Topmost surface wins Escape (see useEscapeDismiss): a confirm stacked on
  // the connection sheet takes the key, and the sheet keeps its own only once
  // this unmounts. `busy` is checked inside the callback, not passed as
  // `enabled` — disabling would pop this off the stack mid-flight and promote
  // the sheet underneath, so Escape would close the sheet out from under a
  // confirm whose delete is already sent.
  useEscapeDismiss(() => {
    if (!busy) onCancel();
  });
  return (
    <div className="connection-panel__confirm" role="dialog" aria-label={title}>
      <p>{prompt}</p>
      <div className="connection-panel__confirm-actions">
        <button type="button" onClick={onConfirm} disabled={busy}>
          {confirmLabel}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}>
          {ConnectionCopy.cancel}
        </button>
      </div>
    </div>
  );
}
