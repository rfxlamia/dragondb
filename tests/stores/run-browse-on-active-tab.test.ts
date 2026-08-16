import { describe, expect, it, vi } from "vitest";
import type { DragonIpc } from "../../src/ipc/contract";
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
    expect(tab?.raw?.rows.length).toBe(101);
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
});
