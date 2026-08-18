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
  groupAddress: "Address",
  groupAuth: "Authentication",
  groupOptions: "Options",
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
  formTitleNew: "New connection",
  formTitleEdit: "Edit connection",
  switchPrompt: "Switch connection? The current session will disconnect first.",
  deletePrompt: "Delete this profile? This cannot be undone.",
  unnamedProfile: "Unnamed",
  connectHint: "Save the profile before connecting.",
  noConnections: "No connections",
  tablesLoading: "Loading tables...",
  noTablesFound: "No tables found",
  tablesLoadError: "Could not load tables. You can still type a name.",
  connectionStringMode: "Connection String",
  copyConnectionString: "Copy",
  test: "Test",
  testSuccess: "Connection successful",
  testing: "Testing…",
  testingSSH: "Testing SSH…",
  showPassword: "Show password",
  notNow: "Not now",
  connectNow: "Connect now",
  connectionCreated: "Connection created",
  connectNowPrompt: "Connect to this server now?",
  connected: "Connected",
  catalog: "Catalog",
  selectDbPulse: "⚠️ Select DB",
  createDatabase: "Create database",
  deleteDatabase: "Drop database",
  databaseName: "Database name",
  create: "Create",
  databaseCreated: "Database created",
  deleteDatabaseError: "Could not delete the database. The previous selection is unchanged.",
  createDatabaseError: "Could not create the database. The previous selection is unchanged.",
  collapseConnection: "Hide sidebar",
  showConnection: "Show sidebar",
  connectionError: "Connection Error",
  noDatabases: "No databases",
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
