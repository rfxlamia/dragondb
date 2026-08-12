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

    invoke.mockResolvedValueOnce({ connectionId: "c-uuid", profileId: "p1" });
    await expect(ipc.connectProfile("p1")).resolves.toEqual({
      connectionId: "c-uuid",
      profileId: "p1",
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

  it("SP-3 stubs: list methods return empty without invoke; mutators throw Phase B", async () => {
    const ipc = createTauriDragonIpc();
    const before = invoke.mock.calls.length;

    expect(await ipc.listSavedQueries()).toEqual([]);
    expect(await ipc.getSavedQuery("q1")).toBeNull();
    expect(await ipc.listQueryFolders()).toEqual([]);
    expect(await ipc.listTabStates()).toEqual([]);
    expect(await ipc.listHistory({ limit: 10 })).toEqual([]);
    expect(await ipc.saveCsvFile("a,b\n1,2")).toEqual({ canceled: true });

    expect(invoke.mock.calls.length).toBe(before);

    await expect(ipc.saveSavedQuery({
      id: "q1",
      name: "n",
      queryText: "SELECT 1",
      connectionId: null,
      databaseName: null,
      createdAt: "1",
      updatedAt: "1",
      folderId: null,
    })).rejects.toThrow(/SP-3 Phase B: saveSavedQuery/);

    await expect(ipc.deleteSavedQueries(["q1"])).rejects.toThrow(/SP-3 Phase B: deleteSavedQueries/);
    await expect(ipc.duplicateSavedQuery("q1")).rejects.toThrow(/SP-3 Phase B: duplicateSavedQuery/);
    await expect(ipc.moveSavedQuery("q1", null)).rejects.toThrow(/SP-3 Phase B: moveSavedQuery/);
    await expect(ipc.createQueryFolder("f")).rejects.toThrow(/SP-3 Phase B: createQueryFolder/);
    await expect(ipc.renameQueryFolder("f1", "x")).rejects.toThrow(/SP-3 Phase B: renameQueryFolder/);
    await expect(ipc.deleteFolder("f1", false)).rejects.toThrow(/SP-3 Phase B: deleteFolder/);
    await expect(
      ipc.saveTabState({
        id: "t1",
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
    ).rejects.toThrow(/SP-3 Phase B: saveTabState/);
    await expect(ipc.deleteTabState("t1")).rejects.toThrow(/SP-3 Phase B: deleteTabState/);
    await expect(ipc.deleteHistory("h1")).rejects.toThrow(/SP-3 Phase B: deleteHistory/);
    await expect(ipc.clearHistory("p1")).rejects.toThrow(/SP-3 Phase B: clearHistory/);
    await expect(
      ipc.updateRow({
        connectionId: "c1",
        table: { name: "users" },
        primaryKey: { id: 1 },
        patch: { name: "Ada" },
      }),
    ).rejects.toThrow(/SP-3 Phase B: updateRow/);
    await expect(
      ipc.deleteRows({
        connectionId: "c1",
        table: { name: "users" },
        primaryKeys: [{ id: 1 }],
      }),
    ).rejects.toThrow(/SP-3 Phase B: deleteRows/);

    expect(invoke.mock.calls.length).toBe(before);
  });
});
