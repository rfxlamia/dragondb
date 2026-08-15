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
