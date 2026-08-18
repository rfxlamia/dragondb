import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DragonIpc, QueryResult } from "../../src/ipc/contract";
import { composeAppStores } from "../../src/stores/compose-app-stores";
import { runBrowseOnActiveTab } from "../../src/stores/run-browse-on-active-tab";

function composeIpc(overrides: Partial<DragonIpc> = {}): DragonIpc {
  return {
    connectProfile: vi.fn(async () => ({ connectionId: "c1", profileId: "P", database: "app" })),
    disconnect: vi.fn(async () => undefined),
    listTables: vi.fn(async () => [{ name: "orders", schema: "public", tableType: "regular" }]),
    listColumns: vi.fn(async () => []),
    runQuery: vi.fn(async () => ({
      columns: ["id"],
      rows: Array.from({ length: 101 }, (_, i) => [i]),
      rowsAffected: null,
      durationMs: 9,
    })),
    saveTabState: vi.fn(async () => undefined),
    deleteTabState: vi.fn(async () => undefined),
    listTabStates: vi.fn(async () => []),
    truncateTable: vi.fn(async () => undefined),
    dropTable: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as DragonIpc;
}

describe("runBrowseOnActiveTab", () => {
  it("page 0 requests LIMIT 101, displays ≤100, sets selectedTable", async () => {
    const ipc = composeIpc();
    const stores = composeAppStores(ipc);
    await stores.session.getState().connect("P");
    await runBrowseOnActiveTab(
      stores,
      ipc,
      { schema: "public", name: "orders", tableType: "regular" },
      0,
    );
    const sql = String(vi.mocked(ipc.runQuery).mock.calls[0]?.[1]?.text ?? "");
    expect(sql).toMatch(/LIMIT\s+101/i);
    const tab = stores.tabs.getState().tabs[0];
    expect(tab?.selectedTableName).toBe("orders");
    expect(tab?.selectedTableSchema).toBe("public");
    expect(tab?.compact?.rows.length).toBeLessThanOrEqual(100);
    expect(tab?.raw?.rows.length).toBe(100);
    expect(stores.browse.getState().hasNext).toBe(true);
  });

  it("does not call truncateTable or dropTable", async () => {
    const ipc = composeIpc();
    const stores = composeAppStores(ipc);
    await stores.session.getState().connect("P");
    await runBrowseOnActiveTab(
      stores,
      ipc,
      { schema: "public", name: "orders", tableType: "regular" },
      0,
    );
    expect(ipc.truncateTable).not.toHaveBeenCalled();
    expect(ipc.dropTable).not.toHaveBeenCalled();
  });

  it("ignores a stale browse generation", async () => {
    let releaseOrders!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseOrders = resolve;
    });
    const runQuery = vi
      .fn()
      .mockImplementationOnce(async () => {
        await gate;
        return { columns: ["id"], rows: [[1]], rowsAffected: null, durationMs: 1 };
      })
      .mockResolvedValueOnce({ columns: ["id"], rows: [[2]], rowsAffected: null, durationMs: 1 });
    const ipc = composeIpc({ runQuery });
    const stores = composeAppStores(ipc);
    await stores.session.getState().connect("P");
    const first = runBrowseOnActiveTab(
      stores,
      ipc,
      { schema: "public", name: "orders", tableType: "regular" },
      0,
    );
    const second = runBrowseOnActiveTab(
      stores,
      ipc,
      { schema: "public", name: "customers", tableType: "regular" },
      0,
    );
    releaseOrders();
    await Promise.all([first, second]);
    const tab = stores.tabs.getState().tabs[0];
    expect(tab?.selectedTableName).toBe("customers");
    expect(tab?.raw?.rows).toEqual([[2]]);
  });

  it("serves a visited page from cache without a second query", async () => {
    const ipc = composeIpc();
    const stores = composeAppStores(ipc);
    await stores.session.getState().connect("P");
    const table = { schema: "public", name: "orders", tableType: "regular" as const };

    await runBrowseOnActiveTab(stores, ipc, table, 0);
    await runBrowseOnActiveTab(stores, ipc, table, 1);
    await runBrowseOnActiveTab(stores, ipc, table, 0);

    expect(ipc.runQuery).toHaveBeenCalledTimes(2);
    expect(String(vi.mocked(ipc.runQuery).mock.calls[1]?.[1].text)).toMatch(/LIMIT 101 OFFSET 100/);
    expect(stores.tabs.getState().tabs[0]?.raw?.rows).toHaveLength(100);
  });

  it("deduplicates two callers for the same missing page", async () => {
    let release!: (result: QueryResult) => void;
    const runQuery = vi.fn(
      () =>
        new Promise<QueryResult>((resolve) => {
          release = resolve;
        }),
    );
    const ipc = composeIpc({ runQuery });
    const stores = composeAppStores(ipc);
    await stores.session.getState().connect("P");
    const table = { schema: "public", name: "orders", tableType: "regular" as const };

    const first = runBrowseOnActiveTab(stores, ipc, table, 2);
    const second = runBrowseOnActiveTab(stores, ipc, table, 2);
    expect(runQuery).toHaveBeenCalledTimes(1);
    release({
      columns: ["id"],
      rows: Array.from({ length: 101 }, (_, index) => [index]),
      rowsAffected: null,
      durationMs: 1,
    });
    await Promise.all([first, second]);
    expect(stores.browse.getState().hasNext).toBe(true);
    expect(stores.tabs.getState().tabs[0]?.compact?.rows).toHaveLength(100);
  });

  it("lets a valid late page fill only its own cache entry", async () => {
    const releases: Array<(result: QueryResult) => void> = [];
    const page = (start: number): QueryResult => ({
      columns: ["id"],
      rows: Array.from({ length: 101 }, (_, index) => [start + index]),
      rowsAffected: null,
      durationMs: 1,
    });
    const runQuery = vi.fn(
      () =>
        new Promise<QueryResult>((resolve) => {
          releases.push(resolve);
        }),
    );
    const ipc = composeIpc({ runQuery });
    const stores = composeAppStores(ipc);
    await stores.session.getState().connect("P");
    const table = { schema: "public", name: "orders", tableType: "regular" as const };

    const slow = runBrowseOnActiveTab(stores, ipc, table, 1);
    const fast = runBrowseOnActiveTab(stores, ipc, table, 2);
    expect(runQuery).toHaveBeenCalledTimes(2);

    releases[1]?.(page(200));
    await fast;
    releases[0]?.(page(100));
    await slow;

    // Page 1 is still a valid entry for this identity, so it may cache …
    expect(stores.browse.getState().readPage(1)?.rows[0]).toEqual([100]);
    // … but page 2 stays the visible page and the rendered result.
    // T3 ruling: visible page lives on the active tab, not browse.page.
    expect(stores.tabs.getState().tabs[0]?.browsePage).toBe(2);
    expect(stores.tabs.getState().tabs[0]?.raw?.rows[0]).toEqual([200]);
  });
});

describe("browse timeout", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("times out at 300 seconds and enables retry only after cancellation", async () => {
    const runQuery = vi.fn(() => new Promise<QueryResult>(() => {}));
    let releaseCancel!: () => void;
    const cancelQuery = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseCancel = resolve;
        }),
    );
    const ipc = composeIpc({ runQuery, cancelQuery });
    const stores = composeAppStores(ipc);
    await stores.session.getState().connect("P");
    const request = runBrowseOnActiveTab(
      stores,
      ipc,
      { schema: "public", name: "orders", tableType: "regular" },
      0,
    );

    await vi.advanceTimersByTimeAsync(299_999);
    expect(cancelQuery).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(cancelQuery).toHaveBeenCalledTimes(1);
    expect(stores.browse.getState().lifecycle.phase).toBe("cancelling");

    releaseCancel();
    await expect(request).rejects.toMatchObject({ name: "BrowseTimeoutError" });
    await vi.advanceTimersByTimeAsync(0);
    expect(stores.browse.getState().lifecycle.phase).toBe("retryReady");
  });

  it("issues exactly one retry for the same table and page after cancellation", async () => {
    let releaseCancel!: () => void;
    const runQuery = vi
      .fn()
      .mockImplementationOnce(() => new Promise<QueryResult>(() => {}))
      .mockResolvedValue({ columns: ["id"], rows: [[7]], rowsAffected: null, durationMs: 1 });
    const cancelQuery = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseCancel = resolve;
        }),
    );
    const ipc = composeIpc({ runQuery, cancelQuery });
    const stores = composeAppStores(ipc);
    await stores.session.getState().connect("P");
    const table = { schema: "public", name: "orders", tableType: "regular" as const };
    void runBrowseOnActiveTab(stores, ipc, table, 3).catch(() => undefined);

    await vi.advanceTimersByTimeAsync(300_000);
    releaseCancel();
    await vi.advanceTimersByTimeAsync(0);
    expect(stores.browse.getState().lifecycle.phase).toBe("retryReady");

    // Try Again is now allowed exactly once, for the same table and page.
    await runBrowseOnActiveTab(stores, ipc, table, 3);
    expect(runQuery).toHaveBeenCalledTimes(2);
    expect(String(vi.mocked(runQuery).mock.calls[1]?.[1].text)).toMatch(/LIMIT 101 OFFSET 300/);
    expect(stores.browse.getState().lifecycle.phase).toBe("ready");
  });

  it("requires reconnect when cancellation remains pending for 12 seconds", async () => {
    const ipc = composeIpc({
      runQuery: vi.fn(() => new Promise<QueryResult>(() => {})),
      cancelQuery: vi.fn(() => new Promise<void>(() => {})),
    });
    const stores = composeAppStores(ipc);
    await stores.session.getState().connect("P");
    void runBrowseOnActiveTab(
      stores,
      ipc,
      { schema: "public", name: "orders", tableType: "regular" },
      0,
    ).catch(() => undefined);

    await vi.advanceTimersByTimeAsync(300_000);
    await vi.advanceTimersByTimeAsync(11_999);
    expect(stores.browse.getState().lifecycle.phase).toBe("cancelling");
    await vi.advanceTimersByTimeAsync(1);
    expect(stores.browse.getState().lifecycle.phase).toBe("reconnectRequired");
  });

  it("lets only the first exact-boundary settlement publish", async () => {
    let releaseQuery!: (value: QueryResult) => void;
    const ipc = composeIpc({
      runQuery: vi.fn(
        () =>
          new Promise<QueryResult>((resolve) => {
            releaseQuery = resolve;
          }),
      ),
      cancelQuery: vi.fn(async () => undefined),
    });
    const stores = composeAppStores(ipc);
    await stores.session.getState().connect("P");
    const request = runBrowseOnActiveTab(
      stores,
      ipc,
      { schema: "public", name: "orders", tableType: "regular" },
      0,
    );
    releaseQuery({ columns: ["id"], rows: [[1]], rowsAffected: null, durationMs: 300_000 });
    await vi.advanceTimersByTimeAsync(300_000);
    await expect(request).resolves.toMatchObject({ rows: [[1]] });
    expect(ipc.cancelQuery).not.toHaveBeenCalled();
    expect(stores.browse.getState().lifecycle.phase).toBe("ready");
  });

  it("moves directly to reconnect recovery when cancel rejects", async () => {
    const ipc = composeIpc({
      runQuery: vi.fn(() => new Promise<QueryResult>(() => {})),
      cancelQuery: vi.fn(async () => {
        throw new Error("cancel failed");
      }),
    });
    const stores = composeAppStores(ipc);
    await stores.session.getState().connect("P");
    void runBrowseOnActiveTab(
      stores,
      ipc,
      { schema: "public", name: "orders", tableType: "regular" },
      0,
    ).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(stores.browse.getState().lifecycle).toMatchObject({
      phase: "reconnectRequired",
      error: expect.any(String),
    });
  });

  it("ignores the original query result after cancellation wins", async () => {
    let releaseQuery!: (value: QueryResult) => void;
    const ipc = composeIpc({
      runQuery: vi.fn(
        () =>
          new Promise<QueryResult>((resolve) => {
            releaseQuery = resolve;
          }),
      ),
      cancelQuery: vi.fn(async () => undefined),
    });
    const stores = composeAppStores(ipc);
    await stores.session.getState().connect("P");
    const request = runBrowseOnActiveTab(
      stores,
      ipc,
      { schema: "public", name: "orders", tableType: "regular" },
      0,
    );
    const timedOut = expect(request).rejects.toMatchObject({ name: "BrowseTimeoutError" });
    await vi.advanceTimersByTimeAsync(300_000);
    await timedOut;
    releaseQuery({ columns: ["id"], rows: [[999]], rowsAffected: null, durationMs: 300_001 });
    await vi.advanceTimersByTimeAsync(0);
    expect(stores.tabs.getState().tabs[0]?.raw?.rows).not.toEqual([[999]]);
    expect(stores.browse.getState().cacheSize()).toBe(0);
  });
});
