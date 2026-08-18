import { describe, expect, it, vi } from "vitest";
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
