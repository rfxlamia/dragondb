import type { ExecutableSQL } from "../core";
import type {
  ColumnInfo,
  ConnectionId,
  ConnectionProfileDto,
  ConnectResult,
  DeleteRowsInput,
  DragonIpc,
  HistoryDto,
  HistoryListOptions,
  IpcError,
  ProfileId,
  QueryFolderDto,
  QueryResult,
  RowOperationError,
  SaveCsvFileResult,
  SavedQueryDto,
  SaveProfileInput,
  SaveTextFileFilter,
  SaveTextFileResult,
  TableRef,
  TabStateDto,
  TestConnectionInput,
  UpdateRowInput,
} from "./contract";

export const FIXTURE_CONNECTION_ID: ConnectionId = "fixture";

export type MockMode = "happy" | "emptyTables" | "emptyColumns" | "columnsError";

/** Shared profile field builder for mock + UI tests (no id). */
export function fixtureProfileFields(): Omit<ConnectionProfileDto, "id"> {
  return {
    name: null,
    host: "127.0.0.1",
    port: 5432,
    username: "postgres",
    database: "app",
    isFavorite: false,
    sslMode: "prefer",
    sshEnabled: false,
    sshHost: null,
    sshPort: null,
    sshUsername: null,
    sshAuthMethod: null,
    sshPrivateKeyPath: null,
  };
}

const USERS_COLUMNS: ColumnInfo[] = [
  {
    name: "id",
    dataType: "integer",
    isNullable: false,
    defaultValue: null,
    isPrimaryKey: true,
    isUnique: true,
    isForeignKey: false,
  },
  {
    name: "name",
    dataType: "text",
    isNullable: false,
    defaultValue: null,
    isPrimaryKey: false,
    isUnique: false,
    isForeignKey: false,
  },
  {
    name: "email",
    dataType: "text",
    isNullable: true,
    defaultValue: null,
    isPrimaryKey: false,
    isUnique: true,
    isForeignKey: false,
  },
  {
    name: "created_at",
    dataType: "timestamp",
    isNullable: false,
    defaultValue: "now()",
    isPrimaryKey: false,
    isUnique: false,
    isForeignKey: false,
  },
];

const EVENTS_COLUMNS: ColumnInfo[] = [
  {
    name: "event_id",
    dataType: "uuid",
    isNullable: false,
    defaultValue: null,
    isPrimaryKey: true,
    isUnique: true,
    isForeignKey: false,
  },
];

const HAPPY_TABLES: TableRef[] = [
  { schema: "public", name: "users", tableType: "regular" },
  { schema: "analytics", name: "events", tableType: "regular" },
];

const HAPPY_COLUMNS: Record<string, ColumnInfo[]> = {
  "public:users": USERS_COLUMNS,
  "analytics:events": EVENTS_COLUMNS,
};

function tableKey(table: TableRef): string {
  const schema = table.schema ?? "public";
  return `${schema}:${table.name}`;
}

function emptyQueryResult(): QueryResult {
  return {
    columns: [],
    rows: [],
    rowsAffected: null,
    durationMs: 0,
  };
}

function notImplemented(method: string): IpcError {
  return { kind: "unknown", message: `SP-4b mock: ${method} not implemented` };
}

function newProfileId(): ProfileId {
  return crypto.randomUUID();
}

function toProfileDto(
  id: ProfileId,
  fields: Omit<ConnectionProfileDto, "id"> | ConnectionProfileDto,
): ConnectionProfileDto {
  return {
    id,
    name: fields.name,
    host: fields.host,
    port: fields.port,
    username: fields.username,
    database: fields.database,
    isFavorite: fields.isFavorite,
    sslMode: fields.sslMode,
    sshEnabled: fields.sshEnabled,
    sshHost: fields.sshHost,
    sshPort: fields.sshPort,
    sshUsername: fields.sshUsername,
    sshAuthMethod: fields.sshAuthMethod,
    sshPrivateKeyPath: fields.sshPrivateKeyPath,
  };
}

export function createMockDragonIpc(mode: MockMode = "happy"): DragonIpc {
  const profiles = new Map<ProfileId, ConnectionProfileDto>();
  let connectedProfileId: ProfileId | null = null;
  let connectionId: ConnectionId | null = null;
  let connectionSeq = 0;
  let databases: string[] = ["app"];

  return {
    async listProfiles(): Promise<ConnectionProfileDto[]> {
      return Array.from(profiles.values());
    },

    async getProfile(id: ProfileId): Promise<ConnectionProfileDto | null> {
      return profiles.get(id) ?? null;
    },

    async saveProfile(input: SaveProfileInput): Promise<ConnectionProfileDto> {
      // Secrets are accepted for API shape only; mock does not persist them.
      void input.secrets;
      const id = input.id ?? newProfileId();
      const dto = toProfileDto(id, input.profile);
      profiles.set(id, dto);
      return dto;
    },

    async deleteProfile(id: ProfileId): Promise<void> {
      profiles.delete(id);
      if (connectedProfileId === id) {
        connectedProfileId = null;
        connectionId = null;
      }
    },

    async connectProfile(id: ProfileId): Promise<ConnectResult> {
      if (!profiles.has(id)) {
        throw { kind: "connection", message: "Profile not found" };
      }
      connectionSeq += 1;
      connectedProfileId = id;
      connectionId = `mock-conn-${connectionSeq}`;
      return { connectionId, profileId: id, database: profiles.get(id)!.database };
    },

    async disconnect(): Promise<void> {
      connectedProfileId = null;
      connectionId = null;
    },

    async listTables(_c: ConnectionId): Promise<TableRef[]> {
      if (mode === "emptyTables") return [];
      return HAPPY_TABLES;
    },

    async listColumns(_c: ConnectionId, table: TableRef): Promise<ColumnInfo[]> {
      if (mode === "columnsError") {
        throw new Error("columns failed");
      }
      if (mode === "emptyColumns") return [];
      return HAPPY_COLUMNS[tableKey(table)] ?? [];
    },

    async runQuery(_c: ConnectionId, _sql: ExecutableSQL): Promise<QueryResult> {
      return emptyQueryResult();
    },

    // SP-3 library — empty / echo placeholders (Phase B wires persistence)
    async listSavedQueries(): Promise<SavedQueryDto[]> {
      return [];
    },
    async getSavedQuery(_id: string): Promise<SavedQueryDto | null> {
      return null;
    },
    async saveSavedQuery(query: SavedQueryDto): Promise<SavedQueryDto> {
      return query;
    },
    async deleteSavedQueries(_ids: string[]): Promise<void> {},
    async duplicateSavedQuery(_id: string): Promise<SavedQueryDto> {
      const err: IpcError = {
        kind: "unknown",
        message: "Saved query not found",
      };
      throw err;
    },
    async moveSavedQuery(_id: string, _folderId: string | null): Promise<void> {},
    async listQueryFolders(): Promise<QueryFolderDto[]> {
      return [];
    },
    async createQueryFolder(name: string): Promise<QueryFolderDto> {
      const now = String(Date.now());
      return { id: crypto.randomUUID(), name, createdAt: now, updatedAt: now };
    },
    async renameQueryFolder(_id: string, _name: string): Promise<void> {},
    async deleteFolder(_id: string, _deleteQueries: boolean): Promise<void> {},

    // SP-3 tabs
    async listTabStates(): Promise<TabStateDto[]> {
      return [];
    },
    async saveTabState(
      _input: TabStateDto,
      _opts?: { includeCachedResults?: boolean },
    ): Promise<void> {},
    async deleteTabState(_id: string): Promise<void> {},

    // SP-3 history — empty placeholders (real persistence via Tauri; store tests inject mocks)
    async listHistory(_opts: HistoryListOptions): Promise<HistoryDto[]> {
      return [];
    },
    async deleteHistory(_id: string): Promise<void> {},
    async clearHistory(_profileId: ProfileId): Promise<void> {},

    // SP-3 CSV
    async saveCsvFile(_csvText: string, _defaultPath?: string): Promise<SaveCsvFileResult> {
      return { canceled: true };
    },
    async saveTextFile(
      _text: string,
      _defaultPath?: string,
      _filter?: SaveTextFileFilter,
    ): Promise<SaveTextFileResult> {
      return { canceled: true };
    },

    // SP-3 row ops — reject with RowOperationError
    async updateRow(_input: UpdateRowInput): Promise<void> {
      const err: RowOperationError = {
        kind: "updateFailed",
        message: "SP-3 mock: updateRow not implemented",
      };
      throw err;
    },
    async deleteRows(_input: DeleteRowsInput): Promise<void> {
      const err: RowOperationError = {
        kind: "deleteFailed",
        message: "SP-3 mock: deleteRows not implemented",
      };
      throw err;
    },

    // SP-4b last slice — picker + test probe happy stubs (restore/overlay/title wiring).
    async listDatabases(_c: ConnectionId): Promise<string[]> {
      const connected = connectedProfileId ? profiles.get(connectedProfileId) : undefined;
      const current = connected?.database ?? "app";
      if (!databases.includes(current)) databases.push(current);
      return [...databases];
    },
    async testConnection(_input: TestConnectionInput): Promise<void> {},
    async cancelQuery(_c: ConnectionId): Promise<void> {
      throw notImplemented("cancelQuery");
    },
    async switchDatabase(_c: ConnectionId, name: string): Promise<void> {
      if (!databases.includes(name)) databases.push(name);
    },
    async createDatabase(name: string): Promise<void> {
      if (!databases.includes(name)) databases.push(name);
    },
    async deleteDatabase(name: string): Promise<void> {
      databases = databases.filter((item) => item !== name);
    },
    async truncateTable(_table: TableRef): Promise<void> {
      throw notImplemented("truncateTable");
    },
    async dropTable(_table: TableRef): Promise<void> {
      throw notImplemented("dropTable");
    },
    async generateTableDdl(_table: TableRef): Promise<string> {
      throw notImplemented("generateTableDdl");
    },
    async setSearchPath(_schema: string | null): Promise<void> {
      throw notImplemented("setSearchPath");
    },
    async clearAllHistory(): Promise<void> {
      throw notImplemented("clearAllHistory");
    },
  };
}
