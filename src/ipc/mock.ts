import type { ExecutableSQL } from "../core";
import type {
  ColumnInfo,
  ConnectionId,
  ConnectionProfileDto,
  ConnectResult,
  DragonIpc,
  ProfileId,
  QueryResult,
  SaveProfileInput,
  TableRef,
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
  { schema: "public", name: "users" },
  { schema: "analytics", name: "events" },
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
      return { connectionId, profileId: id };
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
  };
}
