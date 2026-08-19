/**
 * Proof: switching tabs must reconcile live database with tab.databaseName.
 * Before the fix, tab 1 showed DB "alpha" while Rust stayed on "beta".
 * After the fix, switchDatabase is called from handleSwitchTab in App.tsx.
 * These store-level tests prove the bug exists at the store layer
 * (handleSwitchTab lives in App.tsx, not in the store).
 */
import { describe, expect, it, vi } from "vitest";
import type { DragonIpc } from "../../src/ipc/contract";
import { composeAppStores } from "../../src/stores/compose-app-stores";
import { runSelectOnActiveTab } from "../../src/stores/run-select-on-active-tab";

const SELECT_SQL = { text: "SELECT 1", params: [] as unknown[] };

function composeIpc(overrides: Partial<DragonIpc> = {}): DragonIpc {
  return {
    connectProfile: vi.fn(async () => ({
      connectionId: "c1",
      profileId: "P",
      database: "alpha",
    })),
    disconnect: vi.fn(async () => undefined),
    listTables: vi.fn(async () => []),
    listColumns: vi.fn(async () => []),
    runQuery: vi.fn(async () => ({
      columns: ["n"],
      rows: [[1]],
      rowsAffected: null,
      durationMs: 5,
    })),
    saveTabState: vi.fn(async () => undefined),
    deleteTabState: vi.fn(async () => undefined),
    listTabStates: vi.fn(async () => []),
    switchDatabase: vi.fn(async (_cid: string, _name: string) => undefined),
    listDatabases: vi.fn(async () => ["alpha", "beta"]),
    ...overrides,
  } as unknown as DragonIpc;
}

describe("tab database mismatch bug (proof)", () => {
  it("after switching DB on tab2 then switching back to tab1, session.databaseName stays on tab2's DB", async () => {
    const ipc = composeIpc();
    const stores = composeAppStores(ipc);

    await stores.session.getState().connect("P");
    expect(stores.session.getState().databaseName).toBe("alpha");

    // Tab 1 inherits "alpha"
    const tab1 = stores.tabs.getState().createTab();
    await stores.tabs.getState().setDatabaseName(tab1.id, "alpha");

    // Tab 2
    const tab2 = stores.tabs.getState().createTab();
    stores.tabs.getState().switchTab(tab2.id);

    // Switch live DB to "beta" (as handleSwitchDatabase would do)
    await stores.session.getState().switchDatabase("beta");
    await stores.tabs.getState().setDatabaseName(tab2.id, "beta");

    expect(stores.session.getState().databaseName).toBe("beta");

    // Switch back to tab1 — BUG: no reconciliation happens
    stores.tabs.getState().switchTab(tab1.id);

    // After switching, session is still "beta" even though tab1 says "alpha"
    const tab1State = stores.tabs.getState().tabs.find((t) => t.id === tab1.id);
    expect(tab1State?.databaseName).toBe("alpha");
    expect(stores.session.getState().databaseName).toBe("beta"); // BUG: should be "alpha"

    // This proves any runQuery from tab1 would target "beta" on the backend
    expect(ipc.switchDatabase).not.toHaveBeenCalledWith("c1", "alpha");
  });

  it("runQuery on tab1 uses the live connection (database beta) even though UI shows alpha", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    const switchDatabase = vi.fn(async (_cid: string, _name: string) => undefined) as any;
    const ipc = composeIpc({ switchDatabase });
    const stores = composeAppStores(ipc);

    await stores.session.getState().connect("P");
    const tab1 = stores.tabs.getState().createTab();
    await stores.tabs.getState().setDatabaseName(tab1.id, "alpha");

    const tab2 = stores.tabs.getState().createTab();
    stores.tabs.getState().switchTab(tab2.id);
    await stores.session.getState().switchDatabase("beta");
    await stores.tabs.getState().setDatabaseName(tab2.id, "beta");

    // Switch back to tab1
    stores.tabs.getState().switchTab(tab1.id);

    // Execute query on tab1 — uses live connectionId bound to "beta"
    await runSelectOnActiveTab(stores, ipc, SELECT_SQL);

    // The runQuery was called with connection c1 which is on "beta"
    expect(stores.session.getState().databaseName).toBe("beta");
    // switchDatabase was NOT called with "alpha" to reconcile
    const switchCalls = switchDatabase.mock.calls.filter((call: string[]) => call[1] === "alpha");
    expect(switchCalls).toHaveLength(0);
  });
});
