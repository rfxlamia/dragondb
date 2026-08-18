import { describe, expect, it, vi } from "vitest";
import type { DragonIpc, IpcError } from "../../src/ipc/contract";
import { composeAppStores } from "../../src/stores/compose-app-stores";

function baseTabDto(id: string) {
  return {
    id,
    connectionId: "c1",
    databaseName: "app",
    queryText: "",
    savedQueryId: null,
    isActive: id === "T",
    order: 0,
    createdAt: "1",
    lastAccessedAt: "1",
    selectedTableSchema: null,
    selectedTableName: null,
    selectedSchemaFilter: null,
    cachedResultsData: null,
    cachedColumnNames: null,
    visualDocumentJson: null,
  };
}

describe("composeAppStores", () => {
  it("connect success loads schema tables for connectionId", async () => {
    const listTables = vi.fn(async () => [{ name: "users", schema: "public" }]);
    const ipc = {
      connectProfile: vi.fn(async () => ({ connectionId: "c1", profileId: "P", database: "app" })),
      disconnect: vi.fn(async () => undefined),
      listTables,
      listColumns: vi.fn(async () => []),
      saveTabState: vi.fn(async () => undefined),
      deleteTabState: vi.fn(async () => undefined),
      listTabStates: vi.fn(async () => []),
    } as unknown as DragonIpc;
    const stores = composeAppStores(ipc);
    await stores.session.getState().connect("P");
    expect(listTables).toHaveBeenCalledTimes(1);
    expect(listTables).toHaveBeenCalledWith("c1");
    expect(stores.session.getState()).toMatchObject({
      isConnected: true,
      connectionId: "c1",
      profileId: "P",
    });
    expect(stores.schema.getState().tables).toEqual([{ name: "users", schema: "public" }]);
  });

  it("disconnect clears schema and in-memory tab results", async () => {
    const ipc = {
      connectProfile: vi.fn(async () => ({ connectionId: "c1", profileId: "P", database: "app" })),
      disconnect: vi.fn(async () => undefined),
      listTables: vi.fn(async () => [{ name: "users", schema: "public" }]),
      listColumns: vi.fn(async () => []),
      saveTabState: vi.fn(async () => undefined),
      deleteTabState: vi.fn(async () => undefined),
      listTabStates: vi.fn(async () => []),
    } as unknown as DragonIpc;
    const stores = composeAppStores(ipc);
    await stores.session.getState().connect("P");
    stores.tabs.setState({
      tabs: [
        {
          ...baseTabDto("T"),
          raw: { columns: ["c"], rows: [[1]] },
          compact: { columns: ["c"], rows: [[1]] },
          status: { kind: "ok", rowCount: 1, durationMs: 1 },
        },
      ],
      activeTabId: "T",
    });
    await stores.session.getState().disconnect();
    expect(stores.session.getState().isConnected).toBe(false);
    expect(stores.schema.getState().tables).toEqual([]);
    expect(stores.schema.getState().columnNames).toEqual([]);
    const tab = stores.tabs.getState().tabs.find((t) => t.id === "T");
    expect(tab?.raw).toBeNull();
    expect(tab?.compact).toBeNull();
    expect(tab?.status).toEqual({ kind: "idle" });
  });

  it("switchFailAfterTeardown clears schema and tab results while leaving disconnected", async () => {
    const err: IpcError = { kind: "auth", message: "B failed" };
    const connectProfile = vi
      .fn()
      .mockResolvedValueOnce({ connectionId: "c-a", profileId: "A", database: "app" })
      .mockRejectedValueOnce(err);
    const ipc = {
      connectProfile,
      disconnect: vi.fn(async () => undefined),
      listTables: vi.fn(async () => [{ name: "a", schema: "public" }]),
      listColumns: vi.fn(async () => []),
      saveTabState: vi.fn(async () => undefined),
      deleteTabState: vi.fn(async () => undefined),
      listTabStates: vi.fn(async () => []),
    } as unknown as DragonIpc;
    const stores = composeAppStores(ipc);
    await stores.session.getState().connect("A");
    stores.tabs.setState({
      tabs: [
        {
          ...baseTabDto("T"),
          raw: { columns: ["c"], rows: [["keep-cards-not-results"]] },
          compact: { columns: ["c"], rows: [["x"]] },
          status: { kind: "ok", rowCount: 1, durationMs: 1 },
        },
      ],
      activeTabId: "T",
    });
    await expect(stores.session.getState().switchFailAfterTeardown("B")).rejects.toEqual(err);
    expect(stores.session.getState()).toMatchObject({
      isConnected: false,
      connectionId: null,
    });
    expect(stores.schema.getState().tables).toEqual([]);
    expect(stores.tabs.getState().tabs[0]?.status).toEqual({ kind: "idle" });
    expect(stores.tabs.getState().tabs[0]?.raw).toBeNull();
  });

  it("shouldRemountCanvasOnConnect is true only after disconnect to a different profile", () => {
    const ipc = {
      connectProfile: vi.fn(),
      disconnect: vi.fn(),
      listTables: vi.fn(),
      listColumns: vi.fn(),
      saveTabState: vi.fn(),
      deleteTabState: vi.fn(),
      listTabStates: vi.fn(async () => []),
    } as unknown as DragonIpc;
    const stores = composeAppStores(ipc);

    // No prior disconnect snapshot → do not remount
    expect(stores.shouldRemountCanvasOnConnect("A")).toBe(false);

    stores.noteCanvasDisconnect("A");
    expect(stores.shouldRemountCanvasOnConnect("B")).toBe(true);
    expect(stores.shouldRemountCanvasOnConnect("A")).toBe(false);

    stores.acknowledgeConnect("A");
    expect(stores.shouldRemountCanvasOnConnect("B")).toBe(false);

    stores.noteCanvasDisconnect("A");
    stores.acknowledgeConnect("B");
    // Snapshot consumed; further checks false until next disconnect
    expect(stores.shouldRemountCanvasOnConnect("C")).toBe(false);
  });

  it("bumpCanvasEpoch increments and notify subscribers", () => {
    const ipc = {
      connectProfile: vi.fn(),
      disconnect: vi.fn(),
      listTables: vi.fn(),
      listColumns: vi.fn(),
      saveTabState: vi.fn(),
      deleteTabState: vi.fn(),
      listTabStates: vi.fn(async () => []),
    } as unknown as DragonIpc;
    const stores = composeAppStores(ipc);
    const spy = vi.fn();
    const unsub = stores.subscribeCanvasEpoch(spy);
    const before = stores.getCanvasEpoch();
    const next = stores.bumpCanvasEpoch();
    expect(next).toBe(before + 1);
    expect(stores.getCanvasEpoch()).toBe(next);
    expect(spy).toHaveBeenCalled();
    unsub();
  });

  it("new tabs persist profileId on connectionId, not the live session token", async () => {
    const ipc = {
      connectProfile: vi.fn(async (id: string) => ({
        connectionId: "live-session-token",
        profileId: id,
        database: "app",
      })),
      disconnect: vi.fn(async () => undefined),
      listTables: vi.fn(async () => []),
      listColumns: vi.fn(async () => []),
      saveTabState: vi.fn(async () => undefined),
      deleteTabState: vi.fn(async () => undefined),
      listTabStates: vi.fn(async () => []),
    } as unknown as DragonIpc;
    const stores = composeAppStores(ipc);
    await stores.session.getState().connect("P");
    const tab = stores.tabs.getState().createTab();
    expect(tab.connectionId).toBe("P");
    expect(tab.connectionId).not.toBe("live-session-token");
  });

  it("exposes library and history stores and library.refresh hits saved-query IPC", async () => {
    const listSavedQueries = vi.fn(async () => []);
    const listQueryFolders = vi.fn(async () => []);
    const ipc = {
      connectProfile: vi.fn(),
      disconnect: vi.fn(),
      listTables: vi.fn(),
      listColumns: vi.fn(),
      saveTabState: vi.fn(),
      deleteTabState: vi.fn(),
      listTabStates: vi.fn(async () => []),
      listSavedQueries,
      listQueryFolders,
      listHistory: vi.fn(async () => []),
    } as unknown as DragonIpc;
    const stores = composeAppStores(ipc);
    expect(stores.library).toBeDefined();
    expect(stores.history).toBeDefined();
    await stores.library.getState().refresh();
    expect(listSavedQueries).toHaveBeenCalledOnce();
    expect(listQueryFolders).toHaveBeenCalledOnce();
  });

  it("composes an isolated browse store for each app store graph", () => {
    const ipc = {
      connectProfile: vi.fn(async () => ({ connectionId: "c1", profileId: "P", database: "shop" })),
      disconnect: vi.fn(async () => undefined),
      listTables: vi.fn(async () => []),
      listColumns: vi.fn(async () => []),
      saveTabState: vi.fn(async () => undefined),
      deleteTabState: vi.fn(async () => undefined),
      listTabStates: vi.fn(async () => []),
    } as unknown as DragonIpc;
    const left = composeAppStores(ipc);
    const right = composeAppStores(ipc);
    left.browse.getState().startBrowse({
      tabId: "t1",
      connectionId: "c1",
      database: "shop",
      table: { schema: "public", name: "orders", tableType: "regular" },
    });
    expect(left.browse.getState().identity?.database).toBe("shop");
    expect(right.browse.getState().identity).toBeNull();
  });

  it("resets browse only after switchDatabase commits", async () => {
    let rejectSwitch = true;
    const ipc = {
      connectProfile: vi.fn(async () => ({ connectionId: "c1", profileId: "P", database: "shop" })),
      switchDatabase: vi.fn(async () => {
        if (rejectSwitch) throw new Error("switch failed");
      }),
      listTables: vi.fn(async () => []),
      listColumns: vi.fn(async () => []),
      saveTabState: vi.fn(async () => undefined),
      deleteTabState: vi.fn(async () => undefined),
      listTabStates: vi.fn(async () => []),
    } as unknown as DragonIpc;
    const stores = composeAppStores(ipc);
    await stores.session.getState().connect("P");
    stores.browse.getState().startBrowse({
      tabId: "t1",
      connectionId: "c1",
      database: "shop",
      table: { schema: "public", name: "orders", tableType: "regular" },
    });

    await expect(stores.session.getState().switchDatabase("analytics")).rejects.toThrow();
    expect(stores.browse.getState().identity?.database).toBe("shop");

    rejectSwitch = false;
    await stores.session.getState().switchDatabase("analytics");
    expect(stores.browse.getState().identity).toBeNull();
  });

  it("clears browse identity on disconnect and leaves it cleared after a failed reconnect", async () => {
    const ipc = {
      connectProfile: vi.fn(async () => ({ connectionId: "c1", profileId: "P", database: "shop" })),
      disconnect: vi.fn(async () => undefined),
      listTables: vi.fn(async () => []),
      listColumns: vi.fn(async () => []),
      saveTabState: vi.fn(async () => undefined),
      deleteTabState: vi.fn(async () => undefined),
      listTabStates: vi.fn(async () => []),
    } as unknown as DragonIpc;
    const stores = composeAppStores(ipc);
    await stores.session.getState().connect("P");
    stores.browse.getState().startBrowse({
      tabId: "t1",
      connectionId: "c1",
      database: "shop",
      table: { schema: "public", name: "orders", tableType: "regular" },
    });
    await stores.session.getState().disconnect();
    expect(stores.browse.getState().identity).toBeNull();

    vi.mocked(ipc.connectProfile).mockRejectedValueOnce(new Error("offline"));
    await expect(stores.session.getState().connect("P")).rejects.toThrow("offline");
    expect(stores.browse.getState().identity).toBeNull();
  });
});
