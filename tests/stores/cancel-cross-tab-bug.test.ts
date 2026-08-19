/**
 * Cross-tab cancel: cancelling tab B must not PG-cancel tab A or execute B's queued mutation.
 */
import { describe, expect, it, vi } from "vitest";
import type { DragonIpc, QueryResult } from "../../src/ipc/contract";
import { composeAppStores } from "../../src/stores/compose-app-stores";
import { runMutationOnActiveTab } from "../../src/stores/run-mutation-on-active-tab";
import { runSelectOnActiveTab } from "../../src/stores/run-select-on-active-tab";
import { defined } from "../lib/defined";

const LONG_SELECT = { text: "SELECT pg_sleep(60)", params: [] as unknown[] };
const DELETE_MUTATION = { text: "DELETE FROM users WHERE id = 1", params: [] as unknown[] };

/** Serializes runQuery like AppSession's Mutex; honours runId cancellation. */
function composeSerializedIpc(handler: (sql: string) => Promise<QueryResult>): {
  ipc: DragonIpc;
  runQuery: ReturnType<typeof vi.fn>;
  cancelledRuns: Set<number>;
} {
  const cancelledRuns = new Set<number>();
  let tail: Promise<void> = Promise.resolve();
  const runQuery = vi.fn(async (_cid, sql: { text: string }, runId: number) => {
    let release!: () => void;
    const slot = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prev = tail;
    tail = slot;
    await prev;
    try {
      if (cancelledRuns.has(runId)) {
        throw new Error("Query cancelled");
      }
      return await handler(sql.text);
    } finally {
      release();
    }
  });
  const ipc = {
    connectProfile: vi.fn(async () => ({ connectionId: "c1", profileId: "P", database: "app" })),
    disconnect: vi.fn(async () => undefined),
    listTables: vi.fn(async () => []),
    listColumns: vi.fn(async () => []),
    runQuery,
    saveTabState: vi.fn(async () => undefined),
    deleteTabState: vi.fn(async () => undefined),
    listTabStates: vi.fn(async () => []),
    cancelQuery: vi.fn(async (_c, runId: number) => {
      cancelledRuns.add(runId);
    }),
  } as unknown as DragonIpc;
  return { ipc, runQuery, cancelledRuns };
}

describe("cancel cross-tab runId targeting", () => {
  it("tab B cancel drops queued DELETE without executing after tab A releases mutex", async () => {
    let releaseLongQuery!: () => void;
    const longQueryGate = new Promise<void>((resolve) => {
      releaseLongQuery = resolve;
    });
    let completedQueries = 0;

    const { ipc, runQuery } = composeSerializedIpc(async (sql) => {
      if (sql.includes("pg_sleep")) {
        await longQueryGate;
        return { columns: ["n"], rows: [[1]], rowsAffected: null, durationMs: 5 };
      }
      completedQueries += 1;
      return { columns: [], rows: [], rowsAffected: 1, durationMs: 3 };
    });

    const stores = composeAppStores(ipc);
    await stores.session.getState().connect("P");
    stores.tabs.getState().createTab();
    const runA = runSelectOnActiveTab(stores, ipc, LONG_SELECT);
    await vi.waitFor(() => expect(runQuery).toHaveBeenCalledTimes(1));

    const tabB = stores.tabs.getState().createTab();
    stores.tabs.getState().switchTab(tabB.id);
    const runB = runMutationOnActiveTab(stores, ipc, DELETE_MUTATION);
    await vi.waitFor(() =>
      expect(stores.tabs.getState().tabs.find((t) => t.id === tabB.id)?.status).toEqual({
        kind: "running",
      }),
    );
    expect(completedQueries).toBe(0);

    const runId = stores.tabs.getState().getRunGeneration(tabB.id);
    stores.tabs.getState().applyRunCancelled(tabB.id);
    if (runId !== null) void ipc.cancelQuery("c1", runId);

    releaseLongQuery();
    await runA;
    await expect(runB).rejects.toThrow(/Query cancelled/);

    expect(completedQueries).toBe(0);
    expect(runQuery).toHaveBeenCalledTimes(2);

    const b = defined(
      stores.tabs.getState().tabs.find((t) => t.id === tabB.id),
      "tab B",
    );
    expect(b.status).toEqual({ kind: "cancelled" });
    expect(b.mutationToast ?? null).toBeNull();
  });

  it("tab B cancel does not error tab A while A is still running", async () => {
    let releaseLongQuery!: () => void;
    const longQueryGate = new Promise<void>((resolve) => {
      releaseLongQuery = resolve;
    });

    const { ipc, runQuery } = composeSerializedIpc(async (sql) => {
      if (sql.includes("pg_sleep")) {
        await longQueryGate;
        return { columns: ["n"], rows: [[1]], rowsAffected: null, durationMs: 5 };
      }
      return { columns: [], rows: [], rowsAffected: 1, durationMs: 3 };
    });

    const stores = composeAppStores(ipc);
    await stores.session.getState().connect("P");
    const tabA = stores.tabs.getState().createTab();
    const runA = runSelectOnActiveTab(stores, ipc, LONG_SELECT);
    await vi.waitFor(() => expect(runQuery).toHaveBeenCalledTimes(1));

    const tabB = stores.tabs.getState().createTab();
    stores.tabs.getState().switchTab(tabB.id);
    const runB = runMutationOnActiveTab(stores, ipc, DELETE_MUTATION);

    const runId = stores.tabs.getState().getRunGeneration(tabB.id);
    stores.tabs.getState().applyRunCancelled(tabB.id);
    if (runId !== null) void ipc.cancelQuery("c1", runId);
    releaseLongQuery();

    await runA;
    await expect(runB).rejects.toThrow(/Query cancelled/);

    const a = defined(
      stores.tabs.getState().tabs.find((t) => t.id === tabA.id),
      "tab A",
    );
    expect(a.status?.kind).toBe("ok");
  });
});
