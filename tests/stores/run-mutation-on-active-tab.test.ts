import { describe, expect, it, vi } from "vitest";
import type { DragonIpc } from "../../src/ipc/contract";
import { detectQueryType, isMutation } from "../../src/lib/query-type-detector";
import { composeAppStores } from "../../src/stores/compose-app-stores";
import { runMutationOnActiveTab } from "../../src/stores/run-mutation-on-active-tab";

describe("runMutationOnActiveTab", () => {
  it("sets a toast for a 0-row UPDATE without replacing the SELECT grid", async () => {
    expect(isMutation("UPDATE t SET x=1 WHERE false")).toBe(true);
    expect(detectQueryType("UPDATE t SET x=1 WHERE false")).toBe("update");
    const ipc = {
      connectProfile: vi.fn(async () => ({ connectionId: "c1", profileId: "P", database: "app" })),
      disconnect: vi.fn(async () => undefined),
      listTables: vi.fn(async () => []),
      listColumns: vi.fn(async () => []),
      runQuery: vi.fn(async () => ({ columns: [], rows: [], rowsAffected: 0, durationMs: 4 })),
      saveTabState: vi.fn(async () => undefined),
      deleteTabState: vi.fn(async () => undefined),
      listTabStates: vi.fn(async () => []),
    } as unknown as DragonIpc;
    const stores = composeAppStores(ipc);
    await stores.session.getState().connect("P");
    stores.tabs.getState().createTab();
    stores.tabs.setState((state) => ({
      tabs: state.tabs.map((tab) => ({
        ...tab,
        compact: { columns: ["n"], rows: [[1]] },
        raw: { columns: ["n"], rows: [[1]] },
        status: { kind: "ok" as const, rowCount: 1, durationMs: 1 },
      })),
    }));
    await runMutationOnActiveTab(stores, ipc, { text: "UPDATE t SET x=1 WHERE false", params: [] });
    const tab = stores.tabs.getState().tabs[0];
    expect(tab?.compact?.rows).toEqual([[1]]);
    expect(tab).toMatchObject({
      mutationToast: expect.objectContaining({ sql: expect.stringMatching(/UPDATE/i) }),
    });
  });
});
