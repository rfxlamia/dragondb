import { describe, expect, it, vi } from "vitest";
import type { DragonIpc } from "../../src/ipc/contract";
import { composeAppStores } from "../../src/stores/compose-app-stores";
import { runSqlOnActiveTab } from "../../src/stores/run-sql-on-active-tab";

function composeIpc(overrides: Partial<DragonIpc> = {}): DragonIpc {
  return {
    connectProfile: vi.fn(async () => ({ connectionId: "c1", profileId: "P", database: "app" })),
    disconnect: vi.fn(async () => undefined),
    listTables: vi.fn(async () => []),
    listColumns: vi.fn(async () => []),
    runQuery: vi.fn(async () => ({
      columns: ["n"],
      rows: [[1]],
      rowsAffected: null,
      durationMs: 2,
    })),
    saveTabState: vi.fn(async () => undefined),
    deleteTabState: vi.fn(async () => undefined),
    listTabStates: vi.fn(async () => []),
    ...overrides,
  } as unknown as DragonIpc;
}

describe("runSqlOnActiveTab", () => {
  it("routes a single SELECT through the SELECT writer (grid replaced)", async () => {
    const ipc = composeIpc();
    const stores = composeAppStores(ipc);
    await stores.session.getState().connect("P");
    stores.tabs.getState().createTab();
    await runSqlOnActiveTab(stores, ipc, { text: "SELECT 1 AS n", params: [] });
    expect(ipc.runQuery).toHaveBeenCalledOnce();
    expect(stores.tabs.getState().tabs[0]?.compact?.rows).toEqual([[1]]);
  });

  it("routes a 0-row UPDATE through the mutation writer (grid kept, toast set)", async () => {
    const ipc = composeIpc({
      runQuery: vi.fn(async () => ({
        columns: [],
        rows: [],
        rowsAffected: 0,
        durationMs: 3,
      })),
    });
    const stores = composeAppStores(ipc);
    await stores.session.getState().connect("P");
    stores.tabs.getState().createTab();
    stores.tabs.setState((s) => ({
      tabs: s.tabs.map((t) => ({
        ...t,
        compact: { columns: ["n"], rows: [[1]] },
        raw: { columns: ["n"], rows: [[1]] },
      })),
    }));
    await runSqlOnActiveTab(stores, ipc, { text: "UPDATE t SET x=1 WHERE false", params: [] });
    expect(stores.tabs.getState().tabs[0]?.compact?.rows).toEqual([[1]]);
    expect(stores.tabs.getState().tabs[0]).toMatchObject({
      mutationToast: expect.objectContaining({ sql: expect.stringMatching(/UPDATE/i) }),
    });
  });

  it("sends a multi-statement script through runQuery once (T4 server split)", async () => {
    const ipc = composeIpc({
      runQuery: vi.fn(async () => ({
        columns: ["b"],
        rows: [[2]],
        rowsAffected: null,
        durationMs: 5,
      })),
    });
    const stores = composeAppStores(ipc);
    await stores.session.getState().connect("P");
    stores.tabs.getState().createTab();
    const sql = { text: "SELECT 1 AS a; SELECT 2 AS b", params: [] };
    await runSqlOnActiveTab(stores, ipc, sql);
    expect(ipc.runQuery).toHaveBeenCalledOnce();
    expect(ipc.runQuery).toHaveBeenCalledWith("c1", sql, expect.any(Number));
  });
});
