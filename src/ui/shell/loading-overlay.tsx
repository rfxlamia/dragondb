export type LoadingOverlayPhase =
  | "Initializing…"
  | "Restoring tabs…"
  | "Connecting to database…"
  | "Loading databases…"
  | "Loading tables…";

export function LoadingOverlay(props: { phase: LoadingOverlayPhase | string }): React.JSX.Element {
  const { phase } = props;
  return (
    <div className="loading-overlay" role="status" aria-live="polite" aria-busy="true">
      <p className="loading-overlay__phase">{phase}</p>
    </div>
  );
}
