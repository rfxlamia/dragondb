/**
 * Proof: run ids handed to `runQuery` must be unique per connection, not per tab.
 *
 * `tabs-store` derives the run id from a PER-TAB generation counter
 * (`runGenerations` starts at 0 and is bumped to 1 on the first `beginRun`),
 * so the first run of every tab is run id 1. Rust `CancelRegistry` keys
 * `cancelled_runs` / `active_run_id` by that number for the whole connection
 * (`src-tauri/src/postgres/cancel.rs`), so ids from different tabs collide:
 * cancelling tab B's run 1 issues a PostgreSQL cancel against tab A's run 1.
 *
 * This is reviewer finding #2 ("cancelling one tab can cancel another query")
 * surviving the run-id fix in a different form.
 */
import { describe, expect, it, vi } from "vitest";
import type { DragonIpc, QueryResult } from "../../src/ipc/contract";
import { composeAppStores } from "../../src/stores/compose-app-stores";
import { runMutationOnActiveTab } from "../../src/stores/run-mutation-on-active-tab";
import { runSelectOnActiveTab } from "../../src/stores/run-select-on-active-tab";

const LONG_SELECT = { text: "SELECT pg_sleep(60)", params: [] as unknown[] };
const DELETE_MUTATION = { text: "DELETE FROM users WHERE id = 1", params: [] as unknown[] };

/**
 * IPC mock that mirrors the Rust CancelRegistry semantics:
 * - `cancelled_runs` and `active_run_id` are per CONNECTION, keyed by run id.
 * - `cancel_run` marks the id cancelled and, when that id is the ACTIVE run,
 *   issues a PostgreSQL cancel against the running statement.
 * - `run_query` rejects before and after acquiring the session mutex when its
 *   run id is marked cancelled (commands.rs::run_query).
 */
function composeRegistryIpc(
  handler: (sql: string, abort: Promise<never>) => Promise<QueryResult>,
): {
  ipc: DragonIpc;
  runQuery: ReturnType<typeof vi.fn>;
} {
  const cancelledRuns = new Set<number>();
  const pgCancels = new Map<number, () => void>();
  let activeRunId: number | null = null;
  let tail: Promise<void> = Promise.resolve();

  const runQuery = vi.fn(async (_cid: string, sql: { text: string }, runId: number) => {
    if (cancelledRuns.has(runId)) throw new Error("Query cancelled");
    let release!: () => void;
    const slot = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prev = tail;
    tail = slot;
    await prev; // session mutex
    activeRunId = runId;
    if (cancelledRuns.has(runId)) {
      activeRunId = null;
      release();
      throw new Error("Query cancelled");
    }
    let abortRun!: () => void;
    const abort = new Promise<never>((_resolve, reject) => {
      abortRun = () => reject(new Error("Query cancelled"));
    });
    pgCancels.set(runId, abortRun);
    try {
      return await handler(sql.text, abort);
    } finally {
      pgCancels.delete(runId);
      cancelledRuns.delete(runId);
      if (activeRunId === runId) activeRunId = null;
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
    cancelQuery: vi.fn(async (_c: string, runId: number) => {
      cancelledRuns.add(runId);
      if (activeRunId === runId) pgCancels.get(runId)?.();
    }),
  } as unknown as DragonIpc;

  return { ipc, runQuery };
}

describe("run id collision across tabs", () => {
  it("two tabs running concurrently must receive distinct run ids", async () => {
    let releaseLongQuery!: () => void;
    const longQueryGate = new Promise<void>((resolve) => {
      releaseLongQuery = resolve;
    });

    const { ipc, runQuery } = composeRegistryIpc(async (sql, abort) => {
      if (sql.includes("pg_sleep")) {
        await Promise.race([longQueryGate, abort]);
        return { columns: ["n"], rows: [[1]], rowsAffected: null, durationMs: 5 };
      }
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
    await vi.waitFor(() => expect(runQuery).toHaveBeenCalledTimes(2));

    const runIdA = runQuery.mock.calls[0]?.[2] as number;
    const runIdB = runQuery.mock.calls[1]?.[2] as number;
    expect(runIdB).not.toBe(runIdA);

    releaseLongQuery();
    await runA.catch(() => undefined);
    await runB.catch(() => undefined);
  });

  it("cancelling tab B must not PostgreSQL-cancel tab A's running query", async () => {
    let releaseLongQuery!: () => void;
    const longQueryGate = new Promise<void>((resolve) => {
      releaseLongQuery = resolve;
    });

    let completedMutations = 0;
    const { ipc, runQuery } = composeRegistryIpc(async (sql, abort) => {
      if (sql.includes("pg_sleep")) {
        await Promise.race([longQueryGate, abort]);
        return { columns: ["n"], rows: [[1]], rowsAffected: null, durationMs: 5 };
      }
      completedMutations += 1;
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
    await vi.waitFor(() => expect(runQuery).toHaveBeenCalledTimes(2));

    // App.tsx handleCancelQuery: cancel the ACTIVE tab (B) by its run generation.
    const runIdB = stores.tabs.getState().getRunGeneration(tabB.id);
    expect(runIdB).not.toBeNull();
    stores.tabs.getState().applyRunCancelled(tabB.id);
    await ipc.cancelQuery("c1", runIdB as number);

    releaseLongQuery();
    await expect(runA).resolves.toMatchObject({ rows: [[1]] });
    await runB.catch(() => undefined);

    // clear_active_run() drops the cancelled marker for the id, so tab A's
    // cleanup un-cancels tab B's queued DELETE — it then runs for real.
    expect(completedMutations).toBe(0);

    const a = stores.tabs.getState().tabs.find((t) => t.id === tabA.id);
    expect(a?.status?.kind).toBe("ok");
  });

  it("a cancelled queued mutation must not execute after the other tab's run settles", async () => {
    let releaseLongQuery!: () => void;
    const longQueryGate = new Promise<void>((resolve) => {
      releaseLongQuery = resolve;
    });
    let completedMutations = 0;

    const { ipc, runQuery } = composeRegistryIpc(async (sql, abort) => {
      if (sql.includes("pg_sleep")) {
        await Promise.race([longQueryGate, abort]);
        return { columns: ["n"], rows: [[1]], rowsAffected: null, durationMs: 5 };
      }
      completedMutations += 1;
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
    await vi.waitFor(() => expect(runQuery).toHaveBeenCalledTimes(2));

    const runIdB = stores.tabs.getState().getRunGeneration(tabB.id);
    stores.tabs.getState().applyRunCancelled(tabB.id);
    await ipc.cancelQuery("c1", runIdB as number);

    releaseLongQuery();
    await runA.catch(() => undefined);
    await runB.catch(() => undefined);

    // clear_active_run() drops the cancelled marker for the shared id, so the
    // other tab's cleanup un-cancels this queued DELETE and it runs for real.
    expect(completedMutations).toBe(0);
    expect(stores.tabs.getState().tabs.find((t) => t.id === tabB.id)?.status).toEqual({
      kind: "cancelled",
    });
  });
});
