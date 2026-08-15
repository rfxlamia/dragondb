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

  it("closeTab MRU compares lastAccessedAt numerically", () => {
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
        baseTab({ id: "t1", isActive: false, lastAccessedAt: "9", order: 0 }),
        baseTab({ id: "t2", isActive: true, lastAccessedAt: "8", order: 1 }),
        baseTab({ id: "t3", isActive: false, lastAccessedAt: "10", order: 2 }),
      ],
      activeTabId: "t2",
    });
    store.getState().closeTab("t2");
    expect(store.getState().activeTabId).toBe("t3");
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

  function mockTabsIpc() {
    return {
      saveTabState: vi.fn(async () => undefined),
      deleteTabState: vi.fn(async () => undefined),
      listTabStates: vi.fn(async () => []),
    } as unknown as DragonIpc;
  }

  function tabsWithResults(
    ipc: DragonIpc,
    tabs: ReturnType<typeof baseTab>[],
    activeTabId: string,
  ) {
    const store = createTabsStore(ipc, {
      getConnectionId: () => "c1",
      getDatabaseName: () => "app",
    });
    store.setState({
      tabs: tabs.map((t) => ({
        ...t,
        raw: { columns: ["c"], rows: [["prior"]] },
        compact: { columns: ["c"], rows: [["prior"]] },
        status: { kind: "ok" as const, rowCount: 1, durationMs: 1 },
      })),
      activeTabId,
    });
    return store;
  }

  it("hydrateFromDto keeps this-session ok compact when cache differs", () => {
    const ipc = mockTabsIpc();
    const store = createTabsStore(ipc, {
      getConnectionId: () => "c1",
      getDatabaseName: () => "app",
    });
    store.setState({
      tabs: [
        {
          ...baseTab({ id: "T" }),
          raw: { columns: ["c"], rows: [["live"]] },
          compact: { columns: ["c"], rows: [["live"]] },
          status: { kind: "ok", rowCount: 1, durationMs: 5 },
        },
      ],
      activeTabId: "T",
    });
    store.getState().hydrateFromDto(
      baseTab({
        id: "T",
        cachedResultsData: JSON.stringify({ columns: ["c"], rows: [["cached"]] }),
        cachedColumnNames: ["c"],
      }),
    );
    const tab = store.getState().tabs.find((t) => t.id === "T");
    expect(tab?.compact?.rows).toEqual([["live"]]);
    expect(tab?.raw?.rows).toEqual([["live"]]);
    expect(tab?.status).toEqual({ kind: "ok", rowCount: 1, durationMs: 5 });
  });

  it("hydrateFromDto keeps running compact/raw/status when cache differs", () => {
    const ipc = mockTabsIpc();
    const store = createTabsStore(ipc, {
      getConnectionId: () => "c1",
      getDatabaseName: () => "app",
    });
    store.setState({
      tabs: [
        {
          ...baseTab({ id: "T" }),
          raw: { columns: ["c"], rows: [["inflight"]] },
          compact: { columns: ["c"], rows: [["inflight"]] },
          status: { kind: "running" },
        },
      ],
      activeTabId: "T",
    });
    store.getState().hydrateFromDto(
      baseTab({
        id: "T",
        cachedResultsData: JSON.stringify({ columns: ["c"], rows: [["cached"]] }),
        cachedColumnNames: ["c"],
      }),
    );
    const tab = store.getState().tabs.find((t) => t.id === "T");
    expect(tab?.compact?.rows).toEqual([["inflight"]]);
    expect(tab?.raw?.rows).toEqual([["inflight"]]);
    expect(tab?.status).toEqual({ kind: "running" });
  });

  it("hydrateFromDto keeps error compact/raw/status when cache differs", () => {
    const ipc = mockTabsIpc();
    const store = createTabsStore(ipc, {
      getConnectionId: () => "c1",
      getDatabaseName: () => "app",
    });
    store.setState({
      tabs: [
        {
          ...baseTab({ id: "T" }),
          raw: { columns: ["c"], rows: [["old"]] },
          compact: { columns: ["c"], rows: [["old"]] },
          status: { kind: "error", message: "boom" },
        },
      ],
      activeTabId: "T",
    });
    store.getState().hydrateFromDto(
      baseTab({
        id: "T",
        cachedResultsData: JSON.stringify({ columns: ["c"], rows: [["cached"]] }),
        cachedColumnNames: ["c"],
      }),
    );
    const tab = store.getState().tabs.find((t) => t.id === "T");
    expect(tab?.compact?.rows).toEqual([["old"]]);
    expect(tab?.raw?.rows).toEqual([["old"]]);
    expect(tab?.status).toEqual({ kind: "error", message: "boom" });
  });

  it("hydrateFromDto applies cache compact when status is idle", () => {
    const ipc = mockTabsIpc();
    const store = createTabsStore(ipc, {
      getConnectionId: () => "c1",
      getDatabaseName: () => "app",
    });
    store.setState({
      tabs: [
        {
          ...baseTab({ id: "T" }),
          raw: null,
          compact: null,
          status: { kind: "idle" },
        },
      ],
      activeTabId: "T",
    });
    store.getState().hydrateFromDto(
      baseTab({
        id: "T",
        cachedResultsData: JSON.stringify({ columns: ["id"], rows: [["cached"]] }),
        cachedColumnNames: ["id"],
      }),
    );
    const tab = store.getState().tabs.find((t) => t.id === "T");
    expect(tab?.compact?.columns).toEqual(["id"]);
    expect(tab?.compact?.rows).toEqual([["cached"]]);
    expect(tab?.status).toEqual({ kind: "idle" });
  });

  it("beginRun clears prior result, sets status=running, returns generation", () => {
    const ipc = mockTabsIpc();
    const store = tabsWithResults(ipc, [baseTab({ id: "T" })], "T");
    const gen = store.getState().beginRun("T");
    expect(gen).toEqual(expect.any(Number));
    expect(gen).not.toBeNull();
    const tab = store.getState().tabs.find((t) => t.id === "T");
    expect(tab?.raw).toBeNull();
    expect(tab?.compact).toBeNull();
    expect(tab?.status).toEqual({ kind: "running" });
  });

  it("beginRun returns null for missing or pending-deleted tab", () => {
    const ipc = mockTabsIpc();
    const store = createTabsStore(ipc, {
      getConnectionId: () => null,
      getDatabaseName: () => null,
    });
    store.setState({
      tabs: [baseTab({ id: "keep" })],
      activeTabId: "keep",
      pendingDeletedIds: new Set(["gone"]),
    });
    expect(store.getState().beginRun("gone")).toBeNull();
    expect(store.getState().beginRun("missing")).toBeNull();
  });

  it("applyRunSuccess writes raw+compact+ok status and persists blob with matching generation", async () => {
    const saveTabState = vi.fn(async () => undefined);
    const ipc = {
      saveTabState,
      deleteTabState: vi.fn(async () => undefined),
      listTabStates: vi.fn(async () => []),
    } as unknown as DragonIpc;
    const store = tabsWithResults(ipc, [baseTab({ id: "T" })], "T");
    const gen = store.getState().beginRun("T");
    expect(gen).toEqual(expect.any(Number));
    if (gen === null) throw new Error("expected generation");
    const long = "x".repeat(3000);
    await store
      .getState()
      .applyRunSuccess("T", { columns: ["c"], rows: [[long]], durationMs: 12 }, gen);
    const tab = store.getState().tabs.find((t) => t.id === "T");
    expect(tab?.raw?.rows[0]?.[0]).toBe(long);
    expect(tab?.compact?.rows[0]?.[0]).toBe(compactCell(long));
    expect(tab?.compact?.rows[0]?.[0]).toMatch(/\.\.\. \[truncated\]$/);
    expect(String(tab?.compact?.rows[0]?.[0]).length).toBe(2048);
    expect(tab?.status).toEqual({ kind: "ok", rowCount: 1, durationMs: 12 });
    expect(saveTabState).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "T",
        cachedColumnNames: ["c"],
        cachedResultsData: expect.stringContaining(long),
      }),
      { includeCachedResults: true },
    );
  });

  it("applyRunFailure sets error status and clears rows with matching generation", async () => {
    const ipc = mockTabsIpc();
    const store = tabsWithResults(ipc, [baseTab({ id: "T" })], "T");
    const gen = store.getState().beginRun("T");
    expect(gen).toEqual(expect.any(Number));
    if (gen === null) throw new Error("expected generation");
    store.getState().applyRunFailure("T", "boom", gen);
    const tab = store.getState().tabs.find((t) => t.id === "T");
    expect(tab?.raw).toBeNull();
    expect(tab?.compact).toBeNull();
    expect(tab?.status).toEqual({ kind: "error", message: "boom" });
  });

  it("applyRunSuccess ignores pending-deleted tab (no persist)", async () => {
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
      tabs: [baseTab({ id: "T" })],
      activeTabId: "T",
      pendingDeletedIds: new Set(["T"]),
    });
    await store.getState().applyRunSuccess("T", { columns: ["c"], rows: [[1]], durationMs: 1 }, 1);
    expect(saveTabState).not.toHaveBeenCalled();
    expect(store.getState().tabs.find((t) => t.id === "T")?.status).not.toEqual(
      expect.objectContaining({ kind: "ok" }),
    );
  });

  it("applyRunSuccess ignores mismatched generation", async () => {
    const saveTabState = vi.fn(async () => undefined);
    const ipc = {
      saveTabState,
      deleteTabState: vi.fn(async () => undefined),
      listTabStates: vi.fn(async () => []),
    } as unknown as DragonIpc;
    const store = tabsWithResults(ipc, [baseTab({ id: "T" })], "T");
    const gen = store.getState().beginRun("T");
    await store
      .getState()
      .applyRunSuccess("T", { columns: ["c"], rows: [["stale"]], durationMs: 1 }, (gen ?? 0) - 1);
    const tab = store.getState().tabs.find((t) => t.id === "T");
    expect(tab?.status).toEqual({ kind: "running" });
    expect(tab?.raw).toBeNull();
    expect(saveTabState).not.toHaveBeenCalled();
  });

  it("applyRunFailure ignores mismatched generation", () => {
    const ipc = mockTabsIpc();
    const store = tabsWithResults(ipc, [baseTab({ id: "T" })], "T");
    const gen = store.getState().beginRun("T");
    store.getState().applyRunFailure("T", "stale boom", (gen ?? 0) - 1);
    const tab = store.getState().tabs.find((t) => t.id === "T");
    expect(tab?.status).toEqual({ kind: "running" });
    expect(tab?.raw).toBeNull();
  });

  it("clearTabResults sets idle and makes prior generation apply no-op", async () => {
    const ipc = mockTabsIpc();
    const store = tabsWithResults(ipc, [baseTab({ id: "T" })], "T");
    const gen = store.getState().beginRun("T");
    expect(gen).toEqual(expect.any(Number));
    if (gen === null) throw new Error("expected generation");
    store.getState().clearTabResults("T");
    const tab = store.getState().tabs.find((t) => t.id === "T");
    expect(tab?.raw).toBeNull();
    expect(tab?.compact).toBeNull();
    expect(tab?.status).toEqual({ kind: "idle" });
    await store
      .getState()
      .applyRunSuccess("T", { columns: ["c"], rows: [[1]], durationMs: 1 }, gen);
    expect(store.getState().tabs.find((t) => t.id === "T")?.status).toEqual({ kind: "idle" });
  });

  it("clearInMemoryResults clears all tabs without wiping sqlite via deleteTabState", () => {
    const deleteTabState = vi.fn(async () => undefined);
    const ipc = {
      saveTabState: vi.fn(async () => undefined),
      deleteTabState,
      listTabStates: vi.fn(async () => []),
    } as unknown as DragonIpc;
    const store = tabsWithResults(
      ipc,
      [baseTab({ id: "T1", isActive: true }), baseTab({ id: "T2", isActive: false, order: 1 })],
      "T1",
    );
    store.getState().clearInMemoryResults();
    for (const tab of store.getState().tabs) {
      expect(tab.raw).toBeNull();
      expect(tab.compact).toBeNull();
      expect(tab.status).toEqual({ kind: "idle" });
    }
    expect(deleteTabState).not.toHaveBeenCalled();
  });

  it("switchTab ignores unknown ids", () => {
    const ipc = mockTabsIpc();
    const store = createTabsStore(ipc, {
      getConnectionId: () => null,
      getDatabaseName: () => null,
    });
    store.setState({
      tabs: [baseTab({ id: "keep", isActive: true })],
      activeTabId: "keep",
    });
    store.getState().switchTab("missing");
    expect(store.getState().activeTabId).toBe("keep");
    expect(store.getState().tabs[0]?.isActive).toBe(true);
  });

  it("refresh skips pending-deleted ids and keeps a local active tab", async () => {
    const listTabStates = vi.fn(async () => [
      baseTab({ id: "db-active", isActive: true }),
      baseTab({ id: "gone", isActive: false }),
    ]);
    const ipc = {
      saveTabState: vi.fn(async () => undefined),
      deleteTabState: vi.fn(async () => undefined),
      listTabStates,
    } as unknown as DragonIpc;
    const store = createTabsStore(ipc, {
      getConnectionId: () => "c1",
      getDatabaseName: () => "app",
    });
    const local = baseTab({ id: "local", isActive: true, lastAccessedAt: "99" });
    store.setState({
      tabs: [local],
      activeTabId: "local",
      pendingDeletedIds: new Set(["gone"]),
    });
    await store.getState().refresh();
    expect(store.getState().activeTabId).toBe("local");
    expect(store.getState().tabs.map((t) => t.id)).toEqual(["local", "db-active"]);
    expect(store.getState().tabs.some((t) => t.id === "gone")).toBe(false);
  });

  it("hydrateFromDto does not throw when cached rows are not arrays, so later tabs still hydrate", () => {
    const ipc = mockTabsIpc();
    const store = createTabsStore(ipc, {
      getConnectionId: () => "c1",
      getDatabaseName: () => "app",
    });
    expect(() => {
      store.getState().hydrateFromDto(
        baseTab({
          id: "bad",
          cachedResultsData: JSON.stringify({ columns: ["id"], rows: ["not-a-row"] }),
        }),
      );
    }).not.toThrow();
    store.getState().hydrateFromDto(
      baseTab({
        id: "good",
        isActive: true,
        cachedResultsData: JSON.stringify({ columns: ["id"], rows: [["ok"]] }),
      }),
    );
    const good = store.getState().tabs.find((t) => t.id === "good");
    expect(good?.compact?.rows).toEqual([["ok"]]);
    expect(good?.status).toEqual({ kind: "idle" });
  });

  it("refresh continues hydrating later tabs when one cachedResultsData row is not an array", async () => {
    const ipc = {
      saveTabState: vi.fn(async () => undefined),
      deleteTabState: vi.fn(async () => undefined),
      listTabStates: vi.fn(async () => [
        baseTab({
          id: "bad",
          isActive: false,
          cachedResultsData: JSON.stringify({ columns: ["id"], rows: ["not-a-row"] }),
        }),
        baseTab({
          id: "good",
          isActive: true,
          cachedResultsData: JSON.stringify({ columns: ["id"], rows: [["ok"]] }),
        }),
      ]),
    } as unknown as DragonIpc;
    const store = createTabsStore(ipc, {
      getConnectionId: () => "c1",
      getDatabaseName: () => "app",
    });
    await expect(store.getState().refresh()).resolves.toBeUndefined();
    expect(store.getState().tabs.map((t) => t.id)).toEqual(["bad", "good"]);
    expect(store.getState().activeTabId).toBe("good");
    expect(store.getState().tabs.find((t) => t.id === "good")?.compact?.rows).toEqual([["ok"]]);
  });

  it("does not create a default tab before listTabStates resolves, then creates one when empty", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const saveTabState = vi.fn(async () => undefined);
    const ipc = {
      saveTabState,
      deleteTabState: vi.fn(async () => undefined),
      listTabStates: vi.fn(async () => {
        await gate;
        return [];
      }),
    } as unknown as DragonIpc;
    const store = createTabsStore(ipc, {
      getConnectionId: () => null,
      getDatabaseName: () => null,
    });
    expect(store.getState().tabsReady).toBe(false);
    expect(store.getState().tabs).toHaveLength(0);
    const pending = store.getState().refresh();
    expect(store.getState().tabs).toHaveLength(0);
    expect(store.getState().tabsReady).toBe(false);
    expect(store.getState().activeTabId).toBeNull();
    release();
    await pending;
    expect(store.getState().tabsReady).toBe(true);
    expect(store.getState().tabs).toHaveLength(1);
    const created = store.getState().tabs[0];
    expect(created).toBeDefined();
    expect(store.getState().activeTabId).toBe(created?.id);
    expect(created?.queryText).toBe("");
    expect(saveTabState).toHaveBeenCalled();
  });

  it("sets tabsReady with one in-memory tab when listTabStates rejects", async () => {
    const saveTabState = vi.fn(async () => undefined);
    const ipc = {
      saveTabState,
      deleteTabState: vi.fn(async () => undefined),
      listTabStates: vi.fn(async () => {
        throw new Error("hydrate failed");
      }),
    } as unknown as DragonIpc;
    const store = createTabsStore(ipc, {
      getConnectionId: () => null,
      getDatabaseName: () => null,
    });
    await store.getState().refresh();
    expect(store.getState().tabsReady).toBe(true);
    expect(store.getState().tabs).toHaveLength(1);
    expect(store.getState().activeTabId).toBe(store.getState().tabs[0]?.id);
    expect(saveTabState).toHaveBeenCalled();
  });

  it("preserves hydrated tabs without adding a default", async () => {
    const saveTabState = vi.fn(async () => undefined);
    const ipc = {
      saveTabState,
      deleteTabState: vi.fn(async () => undefined),
      listTabStates: vi.fn(async () => [baseTab({ id: "hydrated", isActive: true })]),
    } as unknown as DragonIpc;
    const store = createTabsStore(ipc, {
      getConnectionId: () => "c1",
      getDatabaseName: () => "app",
    });
    await store.getState().refresh();
    expect(store.getState().tabs.map((t) => t.id)).toEqual(["hydrated"]);
    expect(store.getState().tabsReady).toBe(true);
    expect(store.getState().activeTabId).toBe("hydrated");
    expect(saveTabState).not.toHaveBeenCalled();
  });

  it("setSavedQueryId updates in-memory tab and persists metadata without changing compact/status", async () => {
    const saveTabState = vi.fn(
      async (_dto: TabStateDto, _opts?: { includeCachedResults?: boolean }) => undefined,
    );
    const ipc = {
      saveTabState,
      deleteTabState: vi.fn(async () => undefined),
      listTabStates: vi.fn(async () => []),
    } as unknown as DragonIpc;
    const store = createTabsStore(ipc, {
      getConnectionId: () => "c1",
      getDatabaseName: () => "app",
    });
    const compact = { columns: ["id"], rows: [[1]] };
    store.setState({
      tabs: [
        {
          ...baseTab({ id: "t1", savedQueryId: null }),
          compact,
          status: { kind: "ok", rowCount: 1, durationMs: 3 },
        },
      ],
      activeTabId: "t1",
    });
    saveTabState.mockClear();
    store.getState().setSavedQueryId("t1", "q1");
    expect(store.getState().tabs[0]?.savedQueryId).toBe("q1");
    expect(store.getState().tabs[0]?.compact).toEqual(compact);
    expect(store.getState().tabs[0]?.status).toEqual({
      kind: "ok",
      rowCount: 1,
      durationMs: 3,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(saveTabState).toHaveBeenCalled();
    const persisted = saveTabState.mock.calls[0]?.[0];
    expect(persisted?.savedQueryId).toBe("q1");
    store.getState().setSavedQueryId("t1", null);
    expect(store.getState().tabs[0]?.savedQueryId).toBeNull();
  });

  it("restoreSavedQueryResult restores a success cache or clears an uncached selection", () => {
    const store = createTabsStore(
      {
        saveTabState: vi.fn(async () => undefined),
        deleteTabState: vi.fn(async () => undefined),
        listTabStates: vi.fn(async () => []),
      } as unknown as DragonIpc,
      { getConnectionId: () => "c1", getDatabaseName: () => "app" },
    );
    store.setState({ tabs: [{ ...baseTab({ id: "t1" }) }], activeTabId: "t1" });
    const staleGeneration = store.getState().beginRun("t1");
    const cached = {
      compact: { columns: ["id"], rows: [[9]] },
      status: { kind: "ok" as const, rowCount: 1, durationMs: 7 },
    };
    store.getState().restoreSavedQueryResult("t1", cached);
    expect(store.getState().tabs[0]?.raw).toBeNull();
    expect(store.getState().tabs[0]?.compact).toEqual(cached.compact);
    expect(store.getState().tabs[0]?.status).toEqual(cached.status);
    void store
      .getState()
      .applyRunSuccess(
        "t1",
        { columns: ["id"], rows: [[1]], durationMs: 1 },
        staleGeneration ?? undefined,
      );
    expect(store.getState().tabs[0]?.compact).toEqual(cached.compact);
    store.getState().restoreSavedQueryResult("t1", null);
    expect(store.getState().tabs[0]?.compact).toBeNull();
    expect(store.getState().tabs[0]?.status).toEqual({ kind: "idle" });
  });
});
