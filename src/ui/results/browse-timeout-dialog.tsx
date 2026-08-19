import { createContext } from "react";
import { type BrowseLifecycle, isBrowseTimeoutPhase } from "../../stores/browse-session-store";
import { useEscapeDismiss } from "../use-escape-dismiss";
import { ResultsAccessibility } from "./results-accessibility";
import { ResultsCopy } from "./results-copy";

export type BrowseTimeoutActions = {
  lifecycle: BrowseLifecycle;
  onTryAgain: () => void;
  onReconnect: () => void;
  onCancel: () => void;
};

export const BrowseTimeoutContext = createContext<BrowseTimeoutActions | null>(null);

export function BrowseTimeoutDialog(props: BrowseTimeoutActions): React.JSX.Element | null {
  const { lifecycle, onTryAgain, onReconnect, onCancel } = props;
  const visible = isBrowseTimeoutPhase(lifecycle);
  const busy =
    lifecycle.phase === "cancelling" ||
    (lifecycle.phase === "reconnectRequired" && lifecycle.busy === true);
  const reconnectRequired = lifecycle.phase === "reconnectRequired";
  const retryReady = lifecycle.phase === "retryReady";
  const error =
    lifecycle.phase === "idle" || lifecycle.phase === "ready" ? null : (lifecycle.error ?? null);

  useEscapeDismiss(() => {
    if (!busy) onCancel();
  }, visible);

  if (!visible) return null;

  return (
    <div
      className="query-results__dialog"
      role="alertdialog"
      aria-modal="true"
      aria-busy={busy || undefined}
      aria-labelledby="query-results-timeout-title"
      aria-describedby="query-results-timeout-body"
      data-testid={ResultsAccessibility.timeoutDialog}
    >
      <h2 id="query-results-timeout-title" className="query-results__dialog-title">
        {ResultsCopy.browseTimeoutTitle}
      </h2>
      <p id="query-results-timeout-body" className="query-results__dialog-body">
        {ResultsCopy.browseTimeoutBody}
      </p>
      {error ? (
        <p
          className="query-results__dialog-error"
          role="alert"
          data-testid={ResultsAccessibility.timeoutAlert}
        >
          {error}
        </p>
      ) : null}
      <div className="query-results__dialog-actions">
        <button
          type="button"
          className="query-results__btn query-results__btn--primary"
          disabled={!retryReady || busy}
          onClick={onTryAgain}
        >
          {ResultsCopy.tryAgain}
        </button>
        {reconnectRequired ? (
          <button
            type="button"
            className="query-results__btn query-results__btn--primary"
            disabled={busy}
            onClick={onReconnect}
          >
            {ResultsCopy.reconnect}
          </button>
        ) : null}
        <button type="button" className="query-results__btn" disabled={busy} onClick={onCancel}>
          {ResultsCopy.cancel}
        </button>
      </div>
    </div>
  );
}
