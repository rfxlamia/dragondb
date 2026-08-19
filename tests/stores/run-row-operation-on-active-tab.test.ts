import { expect, it, vi } from "vitest";
import type { DragonIpc, QueryResult } from "../../src/ipc/contract";
import { composeAppStores } from "../../src/stores/compose-app-stores";
import {
  retryRowOperationReload,
  runDeleteRowsOnActiveTab,
  runUpdateRowOnActiveTab,
} from "../../src/stores/run-row-operation-on-active-tab";

const table = { schema: "public", name: "orders", tableType: "regular" as const };
const result: QueryResult = {
  columns: ["id", "note"],
  rows: [[1, "saved"]],
  rowsAffected: null,
  durationMs: 1,
};

function operationIpc(overrides: Partial<DragonIpc> = {}): DragonIpc {
  return {
    connectProfile: vi.fn(async () => ({ connectionId: "c1", profileId: "P", database: "shop" })),
    listTables: vi.fn(async () => []),
    listColumns: vi.fn(async () => []),
    saveTabState: vi.fn(async () => undefined),
    deleteTabState: vi.fn(async () => undefined),
    listTabStates: vi.fn(async () => []),
    updateRow: vi.fn(async () => undefined),
    deleteRows: vi.fn(async () => undefined),
    runQuery: vi.fn(async () => result),
    ...overrides,
  } as unknown as DragonIpc;
}

it.each(["update", "delete"] as const)(
  "never repeats a successful %s when reload fails",
  async (kind) => {
    const runQuery = vi.fn().mockRejectedValueOnce(new Error("reload offline"));
    const ipc = operationIpc({ runQuery });
    const stores = composeAppStores(ipc);
    await stores.session.getState().connect("P");
    stores.browse.getState().startBrowse({
      tabId: stores.tabs.getState().createTab().id,
      connectionId: "c1",
      database: "shop",
      table,
    });
    const outcome =
      kind === "update"
        ? await runUpdateRowOnActiveTab(stores, ipc, table, 0, { id: 1 }, { note: "saved" })
        : await runDeleteRowsOnActiveTab(stores, ipc, table, 0, [{ id: 1 }]);
    expect(outcome).toMatchObject({ kind: "reloadFailed", retry: { table, page: 0 } });
    expect(stores.browse.getState().cacheSize()).toBe(0);

    runQuery.mockResolvedValueOnce(result);
    if (outcome.kind !== "reloadFailed") throw new Error("Expected reload recovery");
    await retryRowOperationReload(stores, ipc, outcome.retry);
    expect(ipc.updateRow).toHaveBeenCalledTimes(kind === "update" ? 1 : 0);
    expect(ipc.deleteRows).toHaveBeenCalledTimes(kind === "delete" ? 1 : 0);
    expect(runQuery).toHaveBeenCalledTimes(2);
  },
);

it("keeps valid cache when updateRow rejects", async () => {
  const ipc = operationIpc({
    updateRow: vi.fn(async () => {
      throw { kind: "updateFailed", message: "denied" };
    }),
  });
  const stores = composeAppStores(ipc);
  await stores.session.getState().connect("P");
  stores.browse.getState().startBrowse({
    tabId: stores.tabs.getState().createTab().id,
    connectionId: "c1",
    database: "shop",
    table,
  });
  const generation = stores.browse.getState().generation;
  stores.browse.getState().writePage(generation, 0, {
    columns: result.columns,
    rows: result.rows,
    durationMs: 1,
    hasNext: false,
  });
  await expect(
    runUpdateRowOnActiveTab(stores, ipc, table, 0, { id: 1 }, { note: "retry me" }),
  ).rejects.toMatchObject({ kind: "updateFailed" });
  expect(stores.browse.getState().readPage(0)?.rows).toEqual(result.rows);
});
