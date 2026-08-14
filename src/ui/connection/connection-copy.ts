import type { IpcError } from "../../ipc/contract";
import { unknownErrorMessage } from "../../lib/unknown-error-message";

/** Human-facing copy for the rough connection panel (creative-brief tone). */
export const ConnectionCopy = {
  panelTitle: "Connection",
  save: "Save",
  connect: "Connect",
  disconnect: "Disconnect",
  delete: "Delete",
  confirmDelete: "Confirm delete",
  confirmSwitch: "Confirm switch",
  cancel: "Cancel",
  name: "Name",
  host: "Host",
  port: "Port",
  username: "Username",
  database: "Database",
  password: "Password",
  ssl: "SSL",
  ssh: "SSH",
  sshHost: "SSH host",
  sshPort: "SSH port",
  sshUsername: "SSH username",
  sshAuthMethod: "SSH auth",
  sshPassword: "SSH password",
  sshPassphrase: "SSH passphrase",
  privateKey: "Private key",
  sshAuthPassword: "Password",
  sshAuthPrivateKey: "Private key",
  profilesHeading: "Saved profiles",
  newProfile: "New profile",
  switchPrompt: "Switch connection? The current session will disconnect first.",
  deletePrompt: "Delete this profile? This cannot be undone.",
  unnamedProfile: "Unnamed",
  connectHint: "Save the profile before connecting.",
} as const;

const CONNECTION_ERROR_FALLBACK =
  "Something went wrong. Check the connection details and try again.";

export function humanIpcErrorMessage(error: unknown): string {
  return unknownErrorMessage(error, CONNECTION_ERROR_FALLBACK);
}

export function isIpcError(error: unknown): error is IpcError {
  return (
    !!error &&
    typeof error === "object" &&
    "kind" in error &&
    "message" in error &&
    typeof (error as IpcError).message === "string"
  );
}
