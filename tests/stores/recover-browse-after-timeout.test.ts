import { expect, it, vi } from "vitest";
import type { DragonIpc } from "../../src/ipc/contract";
import { composeAppStores } from "../../src/stores/compose-app-stores";
import { recoverBrowseAfterTimeout } from "../../src/stores/recover-browse-after-timeout";

// Gate `disconnect`, not `connectProfile`: recovery must await the teardown
// before it connects, so `connectProfile` is still uncalled on the synchronous
// turn where the dedupe assertion runs.
it("deduplicates reconnect and leaves one explicit retry ready", async () => {
  let releaseDisconnect!: () => void;
  const ipc = {
    disconnect: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseDisconnect = resolve;
        }),
    ),
    connectProfile: vi.fn(async () => ({
      connectionId: "c2",
      profileId: "P",
      database: "shop",
    })),
    listTables: vi.fn(async () => []),
    listColumns: vi.fn(async () => []),
    saveTabState: vi.fn(async () => undefined),
    deleteTabState: vi.fn(async () => undefined),
    listTabStates: vi.fn(async () => []),
  } as unknown as DragonIpc;
  const stores = composeAppStores(ipc);
  const retry = {
    tabId: "t1",
    connectionId: "c1",
    database: "shop",
    table: { schema: "public", name: "orders", tableType: "regular" },
  } as const;
  stores.browse.getState().startBrowse(retry);
  stores.browse.getState().selectPage(2);
  const generation = stores.browse.getState().generation;
  stores.browse.getState().publish(generation, {
    lifecycle: { phase: "reconnectRequired", retry: { ...retry, page: 2 }, error: null },
  });

  const first = recoverBrowseAfterTimeout(stores, "P");
  const second = recoverBrowseAfterTimeout(stores, "P");
  // Both calls are in flight; the second must not start its own teardown.
  expect(ipc.disconnect).toHaveBeenCalledTimes(1);

  releaseDisconnect();
  await Promise.all([first, second]);
  expect(ipc.disconnect).toHaveBeenCalledTimes(1);
  expect(ipc.connectProfile).toHaveBeenCalledTimes(1);
  expect(stores.browse.getState()).toMatchObject({
    identity: null,
    lifecycle: {
      phase: "retryReady",
      retry: { table: { name: "orders" }, page: 2 },
    },
  });
});

it("retains a retryable recovery error when reconnect rejects", async () => {
  const ipc = {
    disconnect: vi.fn(async () => undefined),
    connectProfile: vi.fn(async () => {
      throw new Error("offline");
    }),
  } as unknown as DragonIpc;
  const stores = composeAppStores(ipc);
  const retry = {
    tabId: "t1",
    connectionId: "c1",
    database: "shop",
    table: { schema: "public", name: "orders", tableType: "regular" },
  } as const;
  stores.browse.getState().startBrowse(retry);
  const generation = stores.browse.getState().generation;
  stores.browse.getState().publish(generation, {
    lifecycle: { phase: "reconnectRequired", retry: { ...retry, page: 0 }, error: null },
  });
  await expect(recoverBrowseAfterTimeout(stores, "P")).rejects.toThrow("offline");
  expect(stores.browse.getState().lifecycle).toMatchObject({
    phase: "reconnectRequired",
    error: expect.any(String),
  });
});
