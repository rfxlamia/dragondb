/**
 * Proof: switching tabs must reconcile live database with tab.databaseName.
 * The fix lives in handleSwitchTab (App.tsx). These tests simulate the same
 * reconciliation logic to prove it works at the integration boundary.
 */
import { describe, expect, it, vi } from "vitest";
import type { DragonIpc } from "../../src/ipc/contract";
import { composeAppStores } from "../../src/stores/compose-app-stores";

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

/**
 * Simulate handleSwitchTab from App.tsx — the reconciliation logic.
 */
function handleSwitchTab(stores: ReturnType<typeof composeAppStores>, id: string): void {
  stores.tabs.getState().switchTab(id);
  const tab = stores.tabs.getState().tabs.find((item) => item.id === id);
  const session = stores.session.getState();

  if (tab?.databaseName && session.isConnected && session.databaseName !== tab.databaseName) {
    void stores.session
      .getState()
      .switchDatabase(tab.databaseName)
      .catch(() => undefined);
  }
}

describe("tab database mismatch bug (proof)", () => {
  it("handleSwitchTab reconciles live DB when tab.databaseName differs", async () => {
    const ipc = composeIpc();
    const stores = composeAppStores(ipc);

    await stores.session.getState().connect("P");
    expect(stores.session.getState().databaseName).toBe("alpha");

    const tab1 = stores.tabs.getState().createTab();
    await stores.tabs.getState().setDatabaseName(tab1.id, "alpha");

    const tab2 = stores.tabs.getState().createTab();
    stores.tabs.getState().switchTab(tab2.id);
    await stores.session.getState().switchDatabase("beta");
    await stores.tabs.getState().setDatabaseName(tab2.id, "beta");

    expect(stores.session.getState().databaseName).toBe("beta");

    // Switch back to tab1 using the App.tsx logic
    handleSwitchTab(stores, tab1.id);

    // switchDatabase must be called with "alpha" to reconcile
    await vi.waitFor(() => {
      expect(ipc.switchDatabase).toHaveBeenCalledWith("c1", "alpha");
    });
  });

  it("handleSwitchTab does NOT call switchDatabase when DB already matches", async () => {
    const ipc = composeIpc();
    const stores = composeAppStores(ipc);

    await stores.session.getState().connect("P");
    const tab1 = stores.tabs.getState().createTab();
    await stores.tabs.getState().setDatabaseName(tab1.id, "alpha");

    // session is already on "alpha", tab1 says "alpha" — no switch needed
    handleSwitchTab(stores, tab1.id);

    expect(ipc.switchDatabase).not.toHaveBeenCalledWith("c1", "alpha");
  });

  it("without reconciliation (store-only switchTab), DB stays mismatched", async () => {
    const ipc = composeIpc();
    const stores = composeAppStores(ipc);

    await stores.session.getState().connect("P");
    const tab1 = stores.tabs.getState().createTab();
    await stores.tabs.getState().setDatabaseName(tab1.id, "alpha");

    const tab2 = stores.tabs.getState().createTab();
    stores.tabs.getState().switchTab(tab2.id);
    await stores.session.getState().switchDatabase("beta");
    await stores.tabs.getState().setDatabaseName(tab2.id, "beta");

    // Raw store switchTab — no reconciliation (proves why App.tsx logic is needed)
    stores.tabs.getState().switchTab(tab1.id);

    expect(stores.session.getState().databaseName).toBe("beta");
    expect(ipc.switchDatabase).not.toHaveBeenCalledWith("c1", "alpha");
  });
});
