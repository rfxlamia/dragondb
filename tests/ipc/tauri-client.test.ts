import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import { createTauriDragonIpc } from "../../src/ipc/tauri-client";

describe("createTauriDragonIpc", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("maps successful profile + connect + catalog + query invokes to typed results", async () => {
    const ipc = createTauriDragonIpc();
    invoke.mockResolvedValueOnce([]); // list_profiles
    expect(await ipc.listProfiles()).toEqual([]);
    expect(invoke).toHaveBeenCalledWith("list_profiles");

    invoke.mockResolvedValueOnce({
      id: "p1",
      name: "dev",
      host: "127.0.0.1",
      port: 5432,
      username: "u",
      database: "d",
      isFavorite: false,
      sslMode: "prefer",
      sshEnabled: false,
      sshHost: null,
      sshPort: null,
      sshUsername: null,
      sshAuthMethod: null,
      sshPrivateKeyPath: null,
    });
    expect(await ipc.getProfile("p1")).toMatchObject({ id: "p1" });
    expect(invoke).toHaveBeenCalledWith("get_profile", { id: "p1" });

    invoke.mockResolvedValueOnce({
      id: "p1",
      name: "dev",
      host: "127.0.0.1",
      port: 5432,
      username: "u",
      database: "d",
      isFavorite: false,
      sslMode: "prefer",
      sshEnabled: false,
      sshHost: null,
      sshPort: null,
      sshUsername: null,
      sshAuthMethod: null,
      sshPrivateKeyPath: null,
    });
    const saved = await ipc.saveProfile({
      profile: {
        name: "dev",
        host: "127.0.0.1",
        port: 5432,
        username: "u",
        database: "d",
        isFavorite: false,
        sslMode: "prefer",
        sshEnabled: false,
        sshHost: null,
        sshPort: null,
        sshUsername: null,
        sshAuthMethod: null,
        sshPrivateKeyPath: null,
      },
      secrets: { password: "pw" },
    });
    expect(saved.id).toBe("p1");
    expect(invoke).toHaveBeenCalledWith("save_profile", expect.any(Object));

    invoke.mockResolvedValueOnce(undefined);
    await ipc.deleteProfile("p1");
    expect(invoke).toHaveBeenCalledWith("delete_profile", { id: "p1" });

    invoke.mockResolvedValueOnce({ connectionId: "c-uuid", profileId: "p1" , database: "app"});
    await expect(ipc.connectProfile("p1")).resolves.toEqual({
      connectionId: "c-uuid",
      profileId: "p1",
      database: "app",
    });
    expect(invoke).toHaveBeenCalledWith("connect_profile", { id: "p1" });

    invoke.mockResolvedValueOnce(undefined);
    await ipc.disconnect();
    expect(invoke).toHaveBeenCalledWith("disconnect");

    invoke.mockResolvedValueOnce([{ name: "users", schema: "public" }]);
    expect(await ipc.listTables("c-uuid")).toEqual([{ name: "users", schema: "public" }]);
    expect(invoke).toHaveBeenCalledWith("list_tables", { connectionId: "c-uuid" });

    invoke.mockResolvedValueOnce([
      {
        name: "id",
        dataType: "integer",
        isNullable: false,
        defaultValue: null,
        isPrimaryKey: true,
        isUnique: true,
        isForeignKey: false,
      },
    ]);
    expect(await ipc.listColumns("c-uuid", { name: "users", schema: "public" })).toHaveLength(1);
    expect(invoke).toHaveBeenCalledWith("list_columns", {
      connectionId: "c-uuid",
      table: { name: "users", schema: "public" },
    });

    invoke.mockResolvedValueOnce({
      columns: ["id"],
      rows: [[1]],
      rowsAffected: null,
      durationMs: 9,
    });
    const result = await ipc.runQuery("c-uuid", { text: "SELECT 1", params: [] });
    expect(result.rows).toEqual([[1]]);
    expect(result.durationMs).toBe(9);
    expect(invoke).toHaveBeenCalledWith("run_query", {
      connectionId: "c-uuid",
      sql: { text: "SELECT 1", params: [] },
    });
  });

  it("rejects with structured IpcError when invoke payload has kind+message", async () => {
    const ipc = createTauriDragonIpc();
    invoke.mockRejectedValueOnce({ kind: "auth", message: "Authentication failed" });
    await expect(ipc.connectProfile("p1")).rejects.toEqual({
      kind: "auth",
      message: "Authentication failed",
    });
  });

  it("preserves syntax position on reject", async () => {
    const ipc = createTauriDragonIpc();
    invoke.mockRejectedValueOnce({
      kind: "syntax",
      message: "syntax error",
      position: 12,
    });
    await expect(ipc.runQuery("c", { text: "SELEC", params: [] })).rejects.toEqual({
      kind: "syntax",
      message: "syntax error",
      position: 12,
    });
  });

  it("maps reject payload missing kind to unknown", async () => {
    const ipc = createTauriDragonIpc();
    invoke.mockRejectedValueOnce({ message: "boom" });
    await expect(ipc.listTables("c")).rejects.toEqual({
      kind: "unknown",
      message: "boom",
    });

    invoke.mockRejectedValueOnce("stringly error");
    await expect(ipc.disconnect()).rejects.toMatchObject({ kind: "unknown" });
  });

  it("does not import createMockDragonIpc", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../../src/ipc/tauri-client.ts", import.meta.url), "utf8"),
    );
    expect(src).not.toMatch(/createMockDragonIpc/);
    expect(src).not.toMatch(/FIXTURE_CONNECTION_ID/);
  });

  it("maps library methods to locked Tauri command names", async () => {
    const ipc = createTauriDragonIpc();
    const dto = {
      id: "q1",
      name: "n",
      queryText: "SELECT 1",
      connectionId: null,
      databaseName: null,
      createdAt: "1",
      updatedAt: "1",
      folderId: null,
    };

    invoke.mockResolvedValueOnce([]);
    expect(await ipc.listSavedQueries()).toEqual([]);
    expect(invoke).toHaveBeenCalledWith("list_saved_queries");

    invoke.mockResolvedValueOnce(dto);
    expect(await ipc.getSavedQuery("q1")).toEqual(dto);
    expect(invoke).toHaveBeenCalledWith("get_saved_query", { id: "q1" });

    invoke.mockResolvedValueOnce(dto);
    await ipc.saveSavedQuery(dto);
    expect(invoke).toHaveBeenCalledWith("save_saved_query", { query: dto });

    invoke.mockResolvedValueOnce(undefined);
    await ipc.deleteSavedQueries(["q1", "q2"]);
    expect(invoke).toHaveBeenCalledWith("delete_saved_queries", { ids: ["q1", "q2"] });

    invoke.mockResolvedValueOnce({ ...dto, id: "q1-copy" });
    await ipc.duplicateSavedQuery("q1");
    expect(invoke).toHaveBeenCalledWith("duplicate_saved_query", { id: "q1" });

    invoke.mockResolvedValueOnce(undefined);
    await ipc.moveSavedQuery("q1", null);
    expect(invoke).toHaveBeenCalledWith("move_saved_query", { id: "q1", folderId: null });

    invoke.mockResolvedValueOnce([]);
    await ipc.listQueryFolders();
    expect(invoke).toHaveBeenCalledWith("list_folders");

    invoke.mockResolvedValueOnce({
      id: "f1",
      name: "Analytics",
      createdAt: "1",
      updatedAt: "1",
    });
    await ipc.createQueryFolder("Analytics");
    expect(invoke).toHaveBeenCalledWith("create_folder", { name: "Analytics" });

    invoke.mockResolvedValueOnce(undefined);
    await ipc.renameQueryFolder("f1", "Reports");
    expect(invoke).toHaveBeenCalledWith("rename_folder", { id: "f1", name: "Reports" });

    invoke.mockResolvedValueOnce(undefined);
    await ipc.deleteFolder("f1", false);
    expect(invoke).toHaveBeenCalledWith("delete_folder", { id: "f1", deleteQueries: false });

    invoke.mockResolvedValueOnce(undefined);
    await ipc.deleteFolder("f1", true);
    expect(invoke).toHaveBeenCalledWith("delete_folder", { id: "f1", deleteQueries: true });
  });

  it("maps duplicateSavedQuery reject to structured IpcError (not Error throw)", async () => {
    const ipc = createTauriDragonIpc();
    invoke.mockRejectedValueOnce({ kind: "unknown", message: "not found" });
    await expect(ipc.duplicateSavedQuery("missing")).rejects.toEqual({
      kind: "unknown",
      message: "not found",
    });
  });

  it("saveSavedQuery surfaces 0-row UPDATE as IpcError", async () => {
    const ipc = createTauriDragonIpc();
    invoke.mockRejectedValueOnce({
      kind: "unknown",
      message: "save_saved_query: no rows updated",
    });
    await expect(
      ipc.saveSavedQuery({
        id: "missing",
        name: "n",
        queryText: "SELECT 1",
        connectionId: null,
        databaseName: null,
        createdAt: "1",
        updatedAt: "1",
        folderId: null,
      }),
    ).rejects.toMatchObject({ kind: "unknown", message: expect.stringMatching(/no rows/i) });
  });

  it("maps history methods to locked Tauri command names", async () => {
    const ipc = createTauriDragonIpc();
    const dto = {
      id: "h1",
      profileId: "P",
      sql: "SELECT 1",
      success: true,
      errorMessage: null,
      durationMs: 3,
      rowCount: 1,
      createdAt: "1",
    };

    invoke.mockResolvedValueOnce([dto]);
    expect(await ipc.listHistory({ profileId: "P", limit: 10 })).toEqual([dto]);
    expect(invoke).toHaveBeenCalledWith("list_history", { profileId: "P", limit: 10 });

    invoke.mockResolvedValueOnce([dto]);
    await ipc.listHistory({ limit: 5 });
    expect(invoke).toHaveBeenCalledWith("list_history", { limit: 5 });

    invoke.mockResolvedValueOnce(undefined);
    await ipc.deleteHistory("h1");
    expect(invoke).toHaveBeenCalledWith("delete_history", { id: "h1" });

    invoke.mockResolvedValueOnce(undefined);
    await ipc.clearHistory("P");
    expect(invoke).toHaveBeenCalledWith("clear_history", { profileId: "P" });
  });

  it("maps tab methods to locked Tauri command names", async () => {
    const ipc = createTauriDragonIpc();
    const tab = {
      id: "t1",
      connectionId: "c1",
      databaseName: "app",
      queryText: "SELECT 1",
      savedQueryId: null,
      isActive: true,
      order: 0,
      createdAt: "1",
      lastAccessedAt: "1",
      selectedTableSchema: null,
      selectedTableName: null,
      selectedSchemaFilter: null,
      cachedResultsData: null,
      cachedColumnNames: null,
    };

    invoke.mockResolvedValueOnce([tab]);
    expect(await ipc.listTabStates()).toEqual([tab]);
    expect(invoke).toHaveBeenCalledWith("list_tab_states");

    invoke.mockResolvedValueOnce(undefined);
    await ipc.saveTabState(tab, { includeCachedResults: false });
    expect(invoke).toHaveBeenCalledWith("save_tab_state", {
      input: tab,
      includeCachedResults: false,
    });

    invoke.mockResolvedValueOnce(undefined);
    await ipc.saveTabState(tab, { includeCachedResults: true });
    expect(invoke).toHaveBeenCalledWith("save_tab_state", {
      input: tab,
      includeCachedResults: true,
    });

    invoke.mockResolvedValueOnce(undefined);
    await ipc.deleteTabState("t1");
    expect(invoke).toHaveBeenCalledWith("delete_tab_state", { id: "t1" });
  });

  it("saveTabState rejects when UPDATE matches 0 rows", async () => {
    const ipc = createTauriDragonIpc();
    invoke.mockRejectedValueOnce({
      kind: "unknown",
      message: "save_tab_state: no rows updated",
    });
    await expect(
      ipc.saveTabState({
        id: "missing",
        connectionId: null,
        databaseName: null,
        queryText: "",
        savedQueryId: null,
        isActive: true,
        order: 0,
        createdAt: "1",
        lastAccessedAt: "1",
        selectedTableSchema: null,
        selectedTableName: null,
        selectedSchemaFilter: null,
        cachedResultsData: null,
        cachedColumnNames: null,
      }),
    ).rejects.toMatchObject({ kind: "unknown", message: expect.stringMatching(/no rows/i) });
  });

  it("maps updateRow/deleteRows/saveCsvFile to locked Tauri command names", async () => {
    const ipc = createTauriDragonIpc();

    invoke.mockResolvedValueOnce(undefined);
    await ipc.updateRow({
      connectionId: "c1",
      table: { name: "users", schema: "public" },
      primaryKey: { id: 1 },
      patch: { name: "Ada", note: null },
    });
    expect(invoke).toHaveBeenCalledWith("update_row", {
      connectionId: "c1",
      table: { name: "users", schema: "public" },
      primaryKey: { id: 1 },
      patch: { name: "Ada", note: null },
    });

    invoke.mockResolvedValueOnce(undefined);
    await ipc.deleteRows({
      connectionId: "c1",
      table: { name: "users", schema: "public" },
      primaryKeys: [{ id: 1 }, { id: 2 }],
    });
    expect(invoke).toHaveBeenCalledWith("delete_rows", {
      connectionId: "c1",
      table: { name: "users", schema: "public" },
      primaryKeys: [{ id: 1 }, { id: 2 }],
    });

    invoke.mockResolvedValueOnce({ canceled: false, path: "/tmp/out.csv" });
    expect(await ipc.saveCsvFile("a,b\n1,2", "out.csv")).toEqual({
      canceled: false,
      path: "/tmp/out.csv",
    });
    expect(invoke).toHaveBeenCalledWith("save_csv_file", {
      csvText: "a,b\n1,2",
      defaultPath: "out.csv",
    });
  });

  it("saveCsvFile cancel returns { canceled: true } without throwing", async () => {
    const ipc = createTauriDragonIpc();
    invoke.mockResolvedValueOnce({ canceled: true });
    await expect(ipc.saveCsvFile("a,b\n1,2")).resolves.toEqual({ canceled: true });
    expect(invoke).toHaveBeenCalledWith("save_csv_file", {
      csvText: "a,b\n1,2",
      defaultPath: undefined,
    });
  });

  it("updateRow rejects with RowOperationError kind noPrimaryKey (not IpcError expansion)", async () => {
    const ipc = createTauriDragonIpc();
    invoke.mockRejectedValueOnce({ kind: "noPrimaryKey", message: "table has no PK" });
    await expect(
      ipc.updateRow({
        connectionId: "c1",
        table: { name: "users" },
        primaryKey: {},
        patch: { name: "x" },
      }),
    ).rejects.toEqual({ kind: "noPrimaryKey", message: "table has no PK" });
  });

  it("tauri-client has zero phaseBStub and zero empty SP-3 stub resolves", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../../src/ipc/tauri-client.ts", import.meta.url), "utf8"),
    );
    // Guard live code only — avoid false positives on comments that mention stub names.
    const withoutBlockComments = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(withoutBlockComments).not.toMatch(/phaseBStub/);
    expect(withoutBlockComments).not.toMatch(/Promise\.resolve\(\[\]\)/);
    expect(withoutBlockComments).not.toMatch(/Promise\.resolve\(\{ canceled: true \}\)/);
  });
});
