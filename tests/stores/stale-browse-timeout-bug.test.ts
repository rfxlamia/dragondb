/**
 * Proof: a browse that times out after the user moved to another table must not
 * mutate the newer browse.
 *
 * `startBrowse()` swaps identity without bumping `generation`, and
 * `settleBrowseTimeout()` calls `invalidateCache()` unconditionally and then
 * reads the store's CURRENT generation to publish its lifecycle. So table A's
 * timeout wipes table B's cached pages and installs A's cancelling/retry
 * lifecycle into B's browse state.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DragonIpc, QueryResult, TableRef } from "../../src/ipc/contract";
import { browseRetryOf } from "../../src/stores/browse-session-store";
import { composeAppStores } from "../../src/stores/compose-app-stores";
import { BROWSE_TIMEOUT_MS } from "../../src/stores/recover-browse-after-timeout";
import { runBrowseOnActiveTab } from "../../src/stores/run-browse-on-active-tab";

const TABLE_A: TableRef = { schema: "public", name: "hangs", tableType: "regular" };
const TABLE_B: TableRef = { schema: "public", name: "orders", tableType: "regular" };

const PAGE_B: QueryResult = {
  columns: ["id"],
  rows: [[1]],
  rowsAffected: null,
  durationMs: 4,
};

function composeIpc(): DragonIpc {
  return {
    connectProfile: vi.fn(async () => ({
      connectionId: "c1",
      profileId: "P",
      database: "app",
    })),
    disconnect: vi.fn(async () => undefined),
    listTables: vi.fn(async () => []),
    listColumns: vi.fn(async () => []),
    // Table A never answers; table B answers immediately.
    runQuery: vi.fn(async (_c: string, sql: { text: string }) => {
      if (sql.text.includes(TABLE_A.name)) return new Promise<QueryResult>(() => {});
      return PAGE_B;
    }),
    cancelQuery: vi.fn(async () => undefined),
    saveTabState: vi.fn(async () => undefined),
    deleteTabState: vi.fn(async () => undefined),
    listTabStates: vi.fn(async () => []),
  } as unknown as DragonIpc;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("stale browse timeout must not touch a newer browse", () => {
  it("table A's timeout leaves table B's cache and lifecycle intact", async () => {
    vi.useFakeTimers();
    const ipc = composeIpc();
    const stores = composeAppStores(ipc);
    await stores.session.getState().connect("P");
    stores.tabs.getState().createTab();

    // Table A hangs — its 300s timeout is now armed.
    const runA = runBrowseOnActiveTab(stores, ipc, TABLE_A, 0);
    runA.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);

    // User moves to table B, which loads and caches page 0.
    await runBrowseOnActiveTab(stores, ipc, TABLE_B, 0);
    expect(stores.browse.getState().identity?.table.name).toBe(TABLE_B.name);
    expect(stores.browse.getState().readPage(0)).not.toBeNull();
    expect(stores.browse.getState().lifecycle.phase).toBe("ready");

    // Table A finally times out.
    await vi.advanceTimersByTimeAsync(BROWSE_TIMEOUT_MS);

    const state = stores.browse.getState();
    expect(state.identity?.table.name).toBe(TABLE_B.name);
    // A's recovery lifecycle must not be installed into B's browse.
    expect(state.lifecycle.phase).toBe("ready");
    expect(browseRetryOf(state.lifecycle)?.table.name).toBeUndefined();
    // And B's cached page must survive A's cache invalidation.
    expect(state.readPage(0)).not.toBeNull();
  });

  it("table A's timeout does not evict table B's cached page", async () => {
    vi.useFakeTimers();
    const ipc = composeIpc();
    const stores = composeAppStores(ipc);
    await stores.session.getState().connect("P");
    stores.tabs.getState().createTab();

    const runA = runBrowseOnActiveTab(stores, ipc, TABLE_A, 0);
    runA.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);

    await runBrowseOnActiveTab(stores, ipc, TABLE_B, 0);
    expect(stores.browse.getState().cacheSize()).toBe(1);

    await vi.advanceTimersByTimeAsync(BROWSE_TIMEOUT_MS);

    // settleBrowseTimeout() calls invalidateCache() with no identity check.
    expect(stores.browse.getState().cacheSize()).toBe(1);
    expect(stores.browse.getState().readPage(0)).not.toBeNull();
  });
});
