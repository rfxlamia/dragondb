// Note: vitest does not typecheck by itself — red/green for types uses
// `bun run typecheck` (step 2/4). Runtime asserts below catch missing symbols.
import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  ConnectionId,
  ConnectionProfileDto,
  ConnectResult,
  DeleteRowsInput,
  DragonIpc,
  HistoryDto,
  HistoryListOptions,
  ProfileId,
  ProfileSecretsInput,
  QueryFolderDto,
  RowOperationError,
  RowOperationErrorKind,
  SaveCsvFileResult,
  // SP-3 — these imports FAIL until contract exports them
  SavedQueryDto,
  SaveProfileInput,
  SshAuthMethod,
  SslMode,
  // SP-4b last slice — FAIL until contract exports them
  TableRef,
  TabStateDto,
  TestConnectionInput,
  UpdateRowInput,
} from "../../src/ipc/contract";
import * as contract from "../../src/ipc/contract";

describe("DragonIpc contract delta (SP-2)", () => {
  it("exports SSL / SSH union literals used by DTOs", () => {
    expectTypeOf<SslMode>().toEqualTypeOf<
      "disable" | "allow" | "prefer" | "require" | "verify-ca" | "verify-full"
    >();
    expectTypeOf<SshAuthMethod>().toEqualTypeOf<"password" | "privateKey">();
    const sslModes: SslMode[] = [
      "disable",
      "allow",
      "prefer",
      "require",
      "verify-ca",
      "verify-full",
    ];
    const sshAuth: SshAuthMethod[] = ["password", "privateKey"];
    expect(sslModes).toHaveLength(6);
    expect(sshAuth).toHaveLength(2);
    const id: ProfileId = "00000000-0000-4000-8000-000000000001";
    expect(typeof id).toBe("string");
  });

  it("ConnectionProfileDto never includes secret fields", () => {
    const profile: ConnectionProfileDto = {
      id: "p1",
      name: "local",
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
    expect(profile).not.toHaveProperty("password");
    expect(profile).not.toHaveProperty("sshPassword");
    expect(profile).not.toHaveProperty("sshPassphrase");
    expect(profile).not.toHaveProperty("sshPrivateKey");
  });

  it("SaveProfileInput carries optional id + secrets separately from profile", () => {
    const secrets: ProfileSecretsInput = {
      password: "secret",
      sshPrivateKey: "-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----",
    };
    const createInput: SaveProfileInput = {
      profile: {
        name: null,
        host: "db.example",
        port: 5432,
        username: "u",
        database: "d",
        isFavorite: false,
        sslMode: "require",
        sshEnabled: true,
        sshHost: "bastion",
        sshPort: 22,
        sshUsername: "ubuntu",
        sshAuthMethod: "privateKey",
        sshPrivateKeyPath: "/tmp/id_ed25519",
      },
      secrets,
    };
    const updateInput: SaveProfileInput = {
      id: "00000000-0000-4000-8000-000000000001",
      profile: createInput.profile,
      secrets,
    };
    expect(createInput.secrets.password).toBe("secret");
    expect(createInput.profile).not.toHaveProperty("password");
    expect(updateInput.id).toBe("00000000-0000-4000-8000-000000000001");
    expectTypeOf<SaveProfileInput>().toHaveProperty("id");
    expectTypeOf<SaveProfileInput>().toHaveProperty("profile");
    expectTypeOf<SaveProfileInput>().toHaveProperty("secrets");
  });
});

describe("DragonIpc contract delta (SP-3 library/tab/history/row/csv)", () => {
  it("exports SavedQueryDto / QueryFolderDto Swift checklist fields", () => {
    const query: SavedQueryDto = {
      id: "q1",
      name: "orders",
      queryText: "SELECT 1",
      connectionId: "c1",
      databaseName: "app",
      createdAt: "1",
      updatedAt: "2",
      folderId: "f1",
    };
    const unfoldered: SavedQueryDto = {
      ...query,
      connectionId: null,
      databaseName: null,
      folderId: null,
    };
    const folder: QueryFolderDto = {
      id: "f1",
      name: "Analytics",
      createdAt: "1",
      updatedAt: "2",
    };
    expect(query.folderId).toBe("f1");
    expect(unfoldered.folderId).toBeNull();
    expect(folder.name).toBe("Analytics");
    expectTypeOf<SavedQueryDto>().toHaveProperty("queryText");
    expectTypeOf<SavedQueryDto>().toHaveProperty("folderId");
    expectTypeOf<QueryFolderDto>().toHaveProperty("createdAt");
  });

  it("exports TabStateDto with full checklist fields", () => {
    const tab: TabStateDto = {
      id: "t1",
      connectionId: "c1",
      databaseName: "app",
      queryText: "SELECT 1",
      savedQueryId: null,
      isActive: true,
      order: 0,
      createdAt: "1",
      lastAccessedAt: "2",
      selectedTableSchema: "public",
      selectedTableName: "users",
      selectedSchemaFilter: null,
      cachedResultsData: null,
      cachedColumnNames: null,
      visualDocumentJson: null,
    };
    expect(tab.order).toBe(0);
    expect(tab.cachedResultsData).toBeNull();
    expectTypeOf<TabStateDto>().toHaveProperty("lastAccessedAt");
    expectTypeOf<TabStateDto>().toHaveProperty("cachedColumnNames");
    expectTypeOf<TabStateDto>().toHaveProperty("selectedSchemaFilter");
  });

  it("exports HistoryListOptions + HistoryDto camelCase SP-2 superset fields", () => {
    const optsAll: HistoryListOptions = { limit: 50 };
    const optsFiltered: HistoryListOptions = { profileId: "p1", limit: 10 };
    const row: HistoryDto = {
      id: "h1",
      profileId: "p1",
      sql: "SELECT 1",
      success: true,
      errorMessage: null,
      durationMs: 12,
      rowCount: 1,
      createdAt: "100",
    };
    expect(optsAll.limit).toBe(50);
    expect(optsFiltered.profileId).toBe("p1");
    expect(row.errorMessage).toBeNull();
    expect(row.rowCount).toBe(1);
    // Locked TS names (do NOT rename to Swift-only queryText/isSuccess/executionTime)
    expectTypeOf<HistoryDto>().toHaveProperty("profileId");
    expectTypeOf<HistoryDto>().toHaveProperty("sql");
    expectTypeOf<HistoryDto>().toHaveProperty("success");
    expectTypeOf<HistoryDto>().toHaveProperty("errorMessage");
    expectTypeOf<HistoryDto>().toHaveProperty("durationMs");
    expectTypeOf<HistoryDto>().toHaveProperty("rowCount");
    expectTypeOf<HistoryDto>().toHaveProperty("createdAt");
  });

  it("exports RowOperationErrorKind + UpdateRowInput/DeleteRowsInput + SaveCsvFileResult", () => {
    expectTypeOf<RowOperationErrorKind>().toEqualTypeOf<
      | "noPrimaryKey"
      | "noTableSelected"
      | "noRowsSelected"
      | "metadataFetchFailed"
      | "updateFailed"
      | "deleteFailed"
    >();
    const kinds: RowOperationErrorKind[] = [
      "noPrimaryKey",
      "noTableSelected",
      "noRowsSelected",
      "metadataFetchFailed",
      "updateFailed",
      "deleteFailed",
    ];
    expect(kinds).toHaveLength(6);

    const table: TableRef = { schema: "public", name: "users", tableType: "regular" };
    const update: UpdateRowInput = {
      connectionId: "c1",
      table,
      primaryKey: { id: 1 },
      patch: { name: "Ada", note: null },
    };
    const del: DeleteRowsInput = {
      connectionId: "c1",
      table,
      primaryKeys: [{ id: 1 }, { id: 2 }],
    };
    expect(update.patch.note).toBeNull();
    expect(del.primaryKeys).toHaveLength(2);

    const err: RowOperationError = { kind: "noPrimaryKey", message: "table has no PK" };
    expect(err.kind).toBe("noPrimaryKey");

    const saved: SaveCsvFileResult = { canceled: false, path: "/tmp/out.csv" };
    const canceled: SaveCsvFileResult = { canceled: true };
    expect(saved.path).toBe("/tmp/out.csv");
    expect(canceled.canceled).toBe(true);
  });

  it("DragonIpc type requires locked library/tab/history/csv/row-ops methods", () => {
    const stub: DragonIpc = {
      // SP-2
      listProfiles: async () => [],
      getProfile: async () => null,
      saveProfile: async () => {
        throw new Error("unimplemented");
      },
      deleteProfile: async () => {},
      connectProfile: async () =>
        ({ connectionId: "c", profileId: "p", database: "app" }) satisfies ConnectResult,
      disconnect: async () => {},
      listTables: async () => [],
      listColumns: async () => [],
      runQuery: async () => ({
        columns: [],
        rows: [],
        rowsAffected: null,
        durationMs: 0,
      }),
      // SP-3 library (locked names — NOT listFolders/createFolder)
      listSavedQueries: async () => [],
      getSavedQuery: async () => null,
      saveSavedQuery: async () => {
        throw new Error("unimplemented");
      },
      deleteSavedQueries: async () => {},
      duplicateSavedQuery: async () => {
        throw new Error("unimplemented");
      },
      moveSavedQuery: async () => {},
      listQueryFolders: async () => [],
      createQueryFolder: async () => {
        throw new Error("unimplemented");
      },
      renameQueryFolder: async () => {},
      deleteFolder: async (_id: string, _deleteQueries: boolean) => {},
      // SP-3 tabs
      listTabStates: async () => [],
      saveTabState: async (_input: TabStateDto, _opts?: { includeCachedResults?: boolean }) => {},
      deleteTabState: async () => {},
      // SP-3 history — opts.profileId optional; maps to Rust list_history(..., Option<&str>) in T2
      listHistory: async (_opts: HistoryListOptions) => [],
      deleteHistory: async () => {},
      clearHistory: async (_profileId: ProfileId) => {},
      // SP-3 CSV
      saveCsvFile: async (_csvText: string, _defaultPath?: string) =>
        ({ canceled: true }) satisfies SaveCsvFileResult,
      saveTextFile: async (
        _text: string,
        _defaultPath?: string,
        _filter?: { name: string; extensions: string[] },
      ) => ({ canceled: true }) satisfies SaveCsvFileResult,
      // SP-3 row ops — reject with RowOperationError (NOT IpcError kind expansion)
      updateRow: async (_input: UpdateRowInput) => {},
      deleteRows: async (_input: DeleteRowsInput) => {},
      // SP-4b last slice — catalog / database / cancel / DDL / global history clear
      testConnection: async (_input: TestConnectionInput) => {},
      cancelQuery: async (_connectionId: ConnectionId, _runId: number) => {},
      listDatabases: async (_connectionId: ConnectionId) => [],
      switchDatabase: async (_connectionId: ConnectionId, _name: string) => {},
      createDatabase: async (_name: string) => {},
      deleteDatabase: async (_name: string) => {},
      truncateTable: async (_connectionId: ConnectionId, _table: TableRef) => {},
      dropTable: async (_connectionId: ConnectionId, _table: TableRef) => {},
      generateTableDdl: async (_connectionId: ConnectionId, _table: TableRef) => "",
      setSearchPath: async (_connectionId: ConnectionId, _schema: string | null) => {},
      clearAllHistory: async () => {},
    };
    expectTypeOf(stub).toMatchTypeOf<DragonIpc>();
    expect(Object.keys(stub).sort()).toEqual(
      [
        "cancelQuery",
        "clearAllHistory",
        "clearHistory",
        "connectProfile",
        "createDatabase",
        "createQueryFolder",
        "deleteDatabase",
        "deleteFolder",
        "deleteHistory",
        "deleteProfile",
        "deleteRows",
        "deleteSavedQueries",
        "deleteTabState",
        "disconnect",
        "dropTable",
        "duplicateSavedQuery",
        "generateTableDdl",
        "getProfile",
        "getSavedQuery",
        "listColumns",
        "listDatabases",
        "listHistory",
        "listProfiles",
        "listQueryFolders",
        "listSavedQueries",
        "listTabStates",
        "listTables",
        "moveSavedQuery",
        "renameQueryFolder",
        "runQuery",
        "saveCsvFile",
        "saveTextFile",
        "saveProfile",
        "saveSavedQuery",
        "saveTabState",
        "setSearchPath",
        "switchDatabase",
        "testConnection",
        "truncateTable",
        "updateRow",
      ].sort(),
    );
    // deleteFolder boolean is required (arity / type surface)
    expectTypeOf<DragonIpc["deleteFolder"]>().parameters.toEqualTypeOf<
      [id: string, deleteQueries: boolean]
    >();
    expectTypeOf<DragonIpc["listHistory"]>().parameters.toEqualTypeOf<[opts: HistoryListOptions]>();
    expectTypeOf<DragonIpc["updateRow"]>().returns.toEqualTypeOf<Promise<void>>();
    expectTypeOf<DragonIpc["deleteRows"]>().returns.toEqualTypeOf<Promise<void>>();
    expect(contract).toBeTruthy();
  });
});

describe("DragonIpc contract delta (SP-4b last slice)", () => {
  it("TableRef requires tableType regular | foreign", () => {
    const regular: TableRef = { schema: "public", name: "orders", tableType: "regular" };
    const foreign: TableRef = { schema: "public", name: "remote_orders", tableType: "foreign" };
    expect(regular.tableType).toBe("regular");
    expect(foreign.tableType).toBe("foreign");
    expectTypeOf<TableRef>().toHaveProperty("tableType");
    expectTypeOf<TableRef["tableType"]>().toEqualTypeOf<"regular" | "foreign">();
  });

  it("TabStateDto includes visualDocumentJson null without stuffing IR into queryText", () => {
    const tab: TabStateDto = {
      id: "t1",
      connectionId: "c1",
      databaseName: "app",
      queryText: "SELECT 1",
      savedQueryId: null,
      isActive: true,
      order: 0,
      createdAt: "1",
      lastAccessedAt: "2",
      selectedTableSchema: "public",
      selectedTableName: "users",
      selectedSchemaFilter: null,
      cachedResultsData: null,
      cachedColumnNames: null,
      visualDocumentJson: null,
    };
    expect(tab.visualDocumentJson).toBeNull();
    expect(tab.queryText).toBe("SELECT 1");
    expectTypeOf<TabStateDto>().toHaveProperty("visualDocumentJson");
  });

  it("ConnectionProfileDto still has no password fields", () => {
    const profile: ConnectionProfileDto = {
      id: "p1",
      name: "local",
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
    expect(profile).not.toHaveProperty("password");
    expect(profile).not.toHaveProperty("sshPrivateKey");
  });

  it("DragonIpc type requires last-slice catalog and database methods", () => {
    expectTypeOf<DragonIpc>().toHaveProperty("testConnection");
    expectTypeOf<DragonIpc>().toHaveProperty("cancelQuery");
    expectTypeOf<DragonIpc>().toHaveProperty("listDatabases");
    expectTypeOf<DragonIpc>().toHaveProperty("switchDatabase");
    expectTypeOf<DragonIpc>().toHaveProperty("createDatabase");
    expectTypeOf<DragonIpc>().toHaveProperty("deleteDatabase");
    expectTypeOf<DragonIpc>().toHaveProperty("truncateTable");
    expectTypeOf<DragonIpc>().toHaveProperty("dropTable");
    expectTypeOf<DragonIpc>().toHaveProperty("generateTableDdl");
    expectTypeOf<DragonIpc>().toHaveProperty("setSearchPath");
    expectTypeOf<DragonIpc>().toHaveProperty("clearAllHistory");
    expect(contract).toBeTruthy();
  });
});
