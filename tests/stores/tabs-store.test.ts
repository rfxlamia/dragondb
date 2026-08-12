import { describe, expect, it, vi } from "vitest";
import type { DragonIpc, TabStateDto } from "../../src/ipc/contract";
import { compactCell } from "../../src/lib/result-compactor";
import { createTabsStore } from "../../src/stores/tabs-store";

function baseTab(overrides: Partial<TabStateDto> = {}): TabStateDto {
  return {
    id: "t1",
    connectionId: "c1",
    databaseName: "app",
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
    ...overrides,
  };
}

describe("tabs-store", () => {
  it("createTab inherits connection/databaseName, empty queryText, order = max+1", () => {
    const ipc = {
      saveTabState: vi.fn(async () => undefined),
      deleteTabState: vi.fn(async () => undefined),
      listTabStates: vi.fn(async () => []),
    } as unknown as DragonIpc;
    const store = createTabsStore(ipc, {
      getConnectionId: () => "c1",
      getDatabaseName: () => "app",
    });
    store.setState({
      tabs: [baseTab({ id: "existing", order: 2, isActive: true, lastAccessedAt: "10" })],
      activeTabId: "existing",
    });
    const created = store.getState().createTab();
    expect(created.connectionId).toBe("c1");
    expect(created.databaseName).toBe("app");
    expect(created.queryText).toBe("");
    expect(created.order).toBe(3);
    expect(store.getState().activeTabId).toBe(created.id);
  });

  it("closeTab among N activates MRU by lastAccessedAt", () => {
    const ipc = {
      saveTabState: vi.fn(async () => undefined),
      deleteTabState: vi.fn(async () => undefined),
      listTabStates: vi.fn(async () => []),
    } as unknown as DragonIpc;
    const store = createTabsStore(ipc, {
      getConnectionId: () => null,
      getDatabaseName: () => null,
    });
    store.setState({
      tabs: [
        baseTab({ id: "t1", isActive: false, lastAccessedAt: "30", order: 0 }),
        baseTab({ id: "t2", isActive: true, lastAccessedAt: "20", order: 1 }),
        baseTab({ id: "t3", isActive: false, lastAccessedAt: "10", order: 2 }),
      ],
      activeTabId: "t2",
    });
    store.getState().closeTab("t2");
    expect(store.getState().tabs.map((t) => t.id)).toEqual(["t1", "t3"]);
    expect(store.getState().activeTabId).toBe("t1");
  });

  it("closeTab on last tab recreates empty active tab", () => {
    const ipc = {
      saveTabState: vi.fn(async () => undefined),
      deleteTabState: vi.fn(async () => undefined),
      listTabStates: vi.fn(async () => []),
    } as unknown as DragonIpc;
    const store = createTabsStore(ipc, {
      getConnectionId: () => "c1",
      getDatabaseName: () => "app",
    });
    store.setState({
      tabs: [baseTab({ id: "only" })],
      activeTabId: "only",
    });
    store.getState().closeTab("only");
    expect(store.getState().tabs).toHaveLength(1);
    const next = store.getState().tabs[0];
    expect(next).toBeDefined();
    expect(next?.id).not.toBe("only");
    expect(next?.queryText).toBe("");
    expect(store.getState().activeTabId).toBe(next?.id);
  });

  it("pending-deleted tab ids ignore subsequent writes", async () => {
    const saveTabState = vi.fn(async () => undefined);
    const ipc = {
      saveTabState,
      deleteTabState: vi.fn(async () => undefined),
      listTabStates: vi.fn(async () => []),
    } as unknown as DragonIpc;
    const store = createTabsStore(ipc, {
      getConnectionId: () => null,
      getDatabaseName: () => null,
    });
    store.setState({
      tabs: [
        baseTab({ id: "keep", isActive: true, lastAccessedAt: "2" }),
        baseTab({ id: "gone", isActive: false, lastAccessedAt: "1" }),
      ],
      activeTabId: "keep",
      pendingDeletedIds: new Set(["gone"]),
    });
    await store.getState().persistTab(baseTab({ id: "gone", queryText: "SELECT 9" }));
    expect(saveTabState).not.toHaveBeenCalled();
  });

  it("hydrate recomputes compact from raw via result-compactor", () => {
    const ipc = {
      saveTabState: vi.fn(async () => undefined),
      deleteTabState: vi.fn(async () => undefined),
      listTabStates: vi.fn(async () => []),
    } as unknown as DragonIpc;
    const store = createTabsStore(ipc, {
      getConnectionId: () => null,
      getDatabaseName: () => null,
    });
    const long = "x".repeat(3000);
    store.getState().hydrateFromDto(
      baseTab({
        id: "t1",
        cachedResultsData: JSON.stringify({ columns: ["c"], rows: [[long]] }),
        cachedColumnNames: ["c"],
      }),
    );
    const tab = store.getState().tabs.find((t) => t.id === "t1");
    expect(tab).toBeDefined();
    expect(tab?.raw?.rows[0]?.[0]).toBe(long);
    expect(tab?.compact?.rows[0]?.[0]).toBe(compactCell(long));
  });
});
