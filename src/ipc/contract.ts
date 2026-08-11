import type { ExecutableSQL } from "../core";

export type ConnectionId = string;

export type ProfileId = string;

export type SslMode = "disable" | "allow" | "prefer" | "require" | "verify-ca" | "verify-full";

export type SshAuthMethod = "password" | "privateKey";

/** Persisted profile fields — never includes password or key material. */
export interface ConnectionProfileDto {
  id: ProfileId;
  name: string | null;
  host: string;
  port: number;
  username: string;
  database: string;
  isFavorite: boolean;
  sslMode: SslMode;
  sshEnabled: boolean;
  sshHost: string | null;
  sshPort: number | null;
  sshUsername: string | null;
  sshAuthMethod: SshAuthMethod | null;
  /** Path hint only; private key contents live in keyring. */
  sshPrivateKeyPath: string | null;
}

/** Secrets accepted on save/connect forms — written only to keyring, never sqlite. */
export interface ProfileSecretsInput {
  password?: string | null;
  sshPassword?: string | null;
  sshPassphrase?: string | null;
  /** Full PEM/OpenSSH private key text after file pick. */
  sshPrivateKey?: string | null;
}

export interface SaveProfileInput {
  /** Omit id to create; include id to update. */
  id?: ProfileId;
  profile: Omit<ConnectionProfileDto, "id"> | ConnectionProfileDto;
  secrets: ProfileSecretsInput;
}

export interface ConnectResult {
  connectionId: ConnectionId;
  profileId: ProfileId;
}

export interface TableRef {
  schema?: string;
  name: string;
}

export interface ColumnInfo {
  name: string;
  dataType: string;
  isNullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
  isUnique: boolean;
  isForeignKey: boolean;
}

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  rowsAffected: number | null;
  durationMs: number;
}

export type IpcError =
  | { kind: "connection"; message: string }
  | { kind: "auth"; message: string }
  | { kind: "syntax"; message: string; position: number | null }
  | { kind: "permission"; message: string }
  | { kind: "unknown"; message: string };

export interface DragonIpc {
  listProfiles(): Promise<ConnectionProfileDto[]>;
  getProfile(id: ProfileId): Promise<ConnectionProfileDto | null>;
  saveProfile(input: SaveProfileInput): Promise<ConnectionProfileDto>;
  deleteProfile(id: ProfileId): Promise<void>;
  connectProfile(id: ProfileId): Promise<ConnectResult>;
  disconnect(): Promise<void>;
  listTables(c: ConnectionId): Promise<TableRef[]>;
  listColumns(c: ConnectionId, table: TableRef): Promise<ColumnInfo[]>;
  runQuery(c: ConnectionId, sql: ExecutableSQL): Promise<QueryResult>;
}
