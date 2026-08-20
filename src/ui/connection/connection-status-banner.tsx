import { ConnectionAccessibility } from "./connection-accessibility";
import { ConnectionCopy } from "./connection-copy";

export type ConnectionStatusPhase = "testing" | "testingSSH" | "success" | "error" | "idle";

export function ConnectionStatusBanner(props: {
  phase: ConnectionStatusPhase;
  isConnected: boolean;
  message?: string;
}): React.JSX.Element | null {
  const { phase, isConnected, message } = props;
  if (phase === "idle" && !isConnected) return null;

  let body: string | null = null;
  if (phase === "testing") body = ConnectionCopy.testing;
  else if (phase === "testingSSH") body = ConnectionCopy.testingSSH;
  else if (phase === "success") body = ConnectionCopy.testSuccess;
  else if (phase === "error") body = message ?? ConnectionCopy.connectionError;

  if (body === null) return null;

  return (
    <p
      className={`connection-status-banner connection-status-banner--${phase}`}
      data-testid={ConnectionAccessibility.statusBanner}
      role="status"
    >
      {body}
    </p>
  );
}
