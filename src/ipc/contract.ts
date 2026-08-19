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
  /** Profile database name at connect time — for tab inheritance. */
  database: string;
}

export interface TableRef {
  schema?: string;
  name: string;
  /** Catalog kind — `listTables` unions foreign tables like Swift. */
  tableType: "regular" | "foreign";
}

/**
 * Test-connection probe input — host/port/user/database/SSL/SSH fields only.
 * Temporary probe: never mutates the live session, never persists secrets.
 */
export interface TestConnectionInput {
  host: string;
  port: number;
  username: string;
  database: string;
  sslMode: SslMode;
  sshEnabled: boolean;
  /** Tunnel fields — only meaningful when sshEnabled. */
  sshHost?: string | null;
  sshPort?: number | null;
  sshUsername?: string | null;
  sshAuthMethod?: SshAuthMethod | null;
  /** Transient only; never persisted in ConnectionProfile. */
  password?: string | null;
  sshPassword?: string | null;
  sshPrivateKey?: string | null;
  sshPassphrase?: string | null;
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

// --- SP-3 library / tabs / history / row-ops / CSV DTOs ---

/** Saved query — Swift SavedQuery field checklist. */
export interface SavedQueryDto {
  id: string;
  name: string;
  queryText: string;
  connectionId: ConnectionId | null;
  databaseName: string | null;
  createdAt: string;
  updatedAt: string;
  folderId: string | null;
}

/** Query folder — Swift QueryFolder field checklist. */
export interface QueryFolderDto {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Tab persist DTO — full Swift TabState field set including results blob.
 * Two persist modes via saveTabState opts.includeCachedResults.
 */
export interface TabStateDto {
  id: string;
  connectionId: ConnectionId | null;
  databaseName: string | null;
  queryText: string;
  savedQueryId: string | null;
  isActive: boolean;
  order: number;
  createdAt: string;
  lastAccessedAt: string;
  selectedTableSchema: string | null;
  selectedTableName: string | null;
  selectedSchemaFilter: string | null;
  cachedResultsData: string | null;
  cachedColumnNames: string[] | null;
  /** Visual-canvas IR JSON — dedicated field; NEVER stuffed into queryText. */
  visualDocumentJson: string | null;
}

/**
 * History list options — newest-first; omit profileId for global list.
 * clearHistory(profileId) is always per-profile (never global wipe).
 */
export interface HistoryListOptions {
  profileId?: ProfileId;
  limit: number;
}

/**
 * History row — camelCase SP-2 / Tauri names (locked; do NOT rename to Swift-only).
 *
 * Swift QueryHistory mapping:
 * - profileId ↔ connectionId
 * - sql ↔ queryText
 * - success ↔ isSuccess
 * - durationMs ↔ executionTime
 * - createdAt ↔ executionDate
 * - errorMessage / rowCount — SP-2 extras (keep)
 */
export interface HistoryDto {
  id: string;
  profileId: ProfileId;
  sql: string;
  success: boolean;
  errorMessage: string | null;
  durationMs: number;
  rowCount: number | null;
  createdAt: string;
}

/** Mirror Swift RowOperationError kinds — exactly six. */
export type RowOperationErrorKind =
  | "noPrimaryKey"
  | "noTableSelected"
  | "noRowsSelected"
  | "metadataFetchFailed"
  | "updateFailed"
  | "deleteFailed";

export interface RowOperationError {
  kind: RowOperationErrorKind;
  message: string;
}

export interface UpdateRowInput {
  connectionId: ConnectionId;
  table: TableRef;
  primaryKey: Record<string, unknown>;
  /** Patch values; null means SQL NULL (Swift `.null` edit). */
  patch: Record<string, unknown | null>;
}

export interface DeleteRowsInput {
  connectionId: ConnectionId;
  table: TableRef;
  primaryKeys: Record<string, unknown>[];
}

export interface SaveCsvFileResult {
  canceled: boolean;
  path?: string;
}

export type SaveTextFileResult = SaveCsvFileResult;

export type SaveTextFileFilter = {
  name: string;
  extensions: string[];
};

/**
 * DragonIpc — SP-2 profile/connect/query + SP-3 library/tabs/history/csv/row-ops.
 *
 * Library deletes are **batch-only**: `deleteSavedQueries(ids)` — no singular
 * `deleteSavedQuery` on the contract (intentional).
 *
 * Phase B Tauri command name map (document only; Phase A stubs do not invoke):
 * - listQueryFolders ↔ list_folders
 * - createQueryFolder ↔ create_folder
 * - renameQueryFolder ↔ rename_folder
 * - deleteFolder ↔ delete_folder
 * - deleteSavedQueries ↔ delete_saved_queries
 */
export interface DragonIpc {
  // SP-2
  listProfiles(): Promise<ConnectionProfileDto[]>;
  getProfile(id: ProfileId): Promise<ConnectionProfileDto | null>;
  saveProfile(input: SaveProfileInput): Promise<ConnectionProfileDto>;
  deleteProfile(id: ProfileId): Promise<void>;
  connectProfile(id: ProfileId): Promise<ConnectResult>;
  disconnect(): Promise<void>;
  listTables(c: ConnectionId): Promise<TableRef[]>;
  listColumns(c: ConnectionId, table: TableRef): Promise<ColumnInfo[]>;
  runQuery(c: ConnectionId, sql: ExecutableSQL, runId: number): Promise<QueryResult>;

  // SP-3 library (locked names — NOT listFolders/createFolder)
  listSavedQueries(): Promise<SavedQueryDto[]>;
  getSavedQuery(id: string): Promise<SavedQueryDto | null>;
  saveSavedQuery(query: SavedQueryDto): Promise<SavedQueryDto>;
  /** Batch-only delete (no singular deleteSavedQuery). */
  deleteSavedQueries(ids: string[]): Promise<void>;
  duplicateSavedQuery(id: string): Promise<SavedQueryDto>;
  moveSavedQuery(id: string, folderId: string | null): Promise<void>;
  listQueryFolders(): Promise<QueryFolderDto[]>;
  createQueryFolder(name: string): Promise<QueryFolderDto>;
  renameQueryFolder(id: string, name: string): Promise<void>;
  /** false = nullify folder on queries; true = cascade delete queries. */
  deleteFolder(id: string, deleteQueries: boolean): Promise<void>;

  // SP-3 tabs
  listTabStates(): Promise<TabStateDto[]>;
  saveTabState(input: TabStateDto, opts?: { includeCachedResults?: boolean }): Promise<void>;
  deleteTabState(id: string): Promise<void>;

  // SP-3 history
  listHistory(opts: HistoryListOptions): Promise<HistoryDto[]>;
  deleteHistory(id: string): Promise<void>;
  clearHistory(profileId: ProfileId): Promise<void>;

  // SP-3 CSV save-file
  saveCsvFile(csvText: string, defaultPath?: string): Promise<SaveCsvFileResult>;

  // SP-4b generic text save (history JSON/CSV/SQL). Keep saveCsvFile unchanged.
  saveTextFile(
    text: string,
    defaultPath?: string,
    filter?: SaveTextFileFilter,
  ): Promise<SaveTextFileResult>;

  // SP-3 row ops — reject with RowOperationError (not IpcError kind expansion)
  updateRow(input: UpdateRowInput): Promise<void>;
  deleteRows(input: DeleteRowsInput): Promise<void>;

  // SP-4b last slice — dedicated catalog / database / DDL / cancel / global
  // history commands (Option B; NOT runQuery for app-generated mutations).
  // Tauri snake_case map (hand-written in tauri-client): test_connection,
  // cancel_query, list_databases, switch_database, create_database,
  // delete_database, truncate_table, drop_table, generate_table_ddl,
  // set_search_path, clear_all_history.
  /** Temporary SSH+DB probe — no session mutation; maps to Test banner states. */
  testConnection(input: TestConnectionInput): Promise<void>;
  /** Interrupt the in-flight or queued run identified by `runId`. */
  cancelQuery(connectionId: ConnectionId, runId: number): Promise<void>;
  /** Picker list; switch does NOT rewrite profile.database. */
  listDatabases(connectionId: ConnectionId): Promise<string[]>;
  switchDatabase(connectionId: ConnectionId, name: string): Promise<void>;
  /** CREATE DATABASE via maintenance connection; create-only — explicit `switchDatabase` owns selection. */
  createDatabase(name: string): Promise<void>;
  deleteDatabase(name: string): Promise<void>;
  /** Quoted-identifier mutations + DDL sheet source (Rust-side quoting). */
  truncateTable(connectionId: ConnectionId, table: TableRef): Promise<void>;
  dropTable(connectionId: ConnectionId, table: TableRef): Promise<void>;
  generateTableDdl(connectionId: ConnectionId, table: TableRef): Promise<string>;
  /** Named schema → `TO schema, public`; null (All Schemas) → `TO public`. */
  setSearchPath(connectionId: ConnectionId, schema: string | null): Promise<void>;
  /** Wipe ALL profiles' history rows (clearHistory stays per-profile). */
  clearAllHistory(): Promise<void>;
}
