import { describe, expect, it, vi } from "vitest";
import type { DragonIpc } from "../../src/ipc/contract";
import { compactCell } from "../../src/lib/result-compactor";
import { composeAppStores } from "../../src/stores/compose-app-stores";
import { runSelectOnActiveTab } from "../../src/stores/run-select-on-active-tab";

const FIXTURE_SQL = { text: "SELECT 1", params: [] as unknown[] };

function composeIpc(overrides: Partial<DragonIpc> = {}): DragonIpc {
  return {
    connectProfile: vi.fn(async () => ({ connectionId: "c1", profileId: "P" })),
    disconnect: vi.fn(async () => undefined),
    listTables: vi.fn(async () => [{ name: "users", schema: "public" }]),
    listColumns: vi.fn(async () => []),
    runQuery: vi.fn(async () => ({
      columns: ["id"],
      rows: [[1]],
      rowsAffected: null,
      durationMs: 9,
    })),
    saveTabState: vi.fn(async () => undefined),
    deleteTabState: vi.fn(async () => undefined),
    listTabStates: vi.fn(async () => []),
    ...overrides,
  } as unknown as DragonIpc;
}

describe("run → executing tab orchestration", () => {
  it("Run success writes raw+status ok and returns QueryResult (lazy ensureTab)", async () => {
    const long = "y".repeat(3000);
    const ipc = composeIpc({
      runQuery: vi.fn(async (_cid, sql) => {
        expect(sql).toEqual(FIXTURE_SQL);
        return { columns: ["c"], rows: [[long]], rowsAffected: null, durationMs: 12 };
      }),
    });
    const stores = composeAppStores(ipc);
    await stores.session.getState().connect("P");
    expect(stores.tabs.getState().tabs).toHaveLength(0);
    const result = await runSelectOnActiveTab(stores, ipc, FIXTURE_SQL);
    expect(result.durationMs).toBe(12);
    expect(stores.tabs.getState().tabs).toHaveLength(1);
    const tab = stores.tabs.getState().tabs[0]!;
    expect(tab.raw?.rows[0]?.[0]).toBe(long);
    expect(tab.compact?.rows[0]?.[0]).toBe(compactCell(long));
    expect(tab.status).toEqual({ kind: "ok", rowCount: 1, durationMs: 12 });
  });

  it("late result after switchTab writes to executing tab A not B", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const ipc = composeIpc({
      runQuery: vi.fn(async () => {
        await gate;
        return { columns: ["id"], rows: [[1]], rowsAffected: null, durationMs: 5 };
      }),
    });
    const stores = composeAppStores(ipc);
    await stores.session.getState().connect("P");
    const a = stores.tabs.getState().createTab();
    const runA = runSelectOnActiveTab(stores, ipc, FIXTURE_SQL);
    stores.tabs.getState().createTab();
    expect(stores.tabs.getState().activeTabId).not.toBe(a.id);
    release();
    await runA;
    expect(stores.tabs.getState().tabs.find((t) => t.id === a.id)?.status?.kind).toBe("ok");
    const b = stores.tabs.getState().tabs.find((t) => t.id !== a.id)!;
    expect(b.status).toEqual({ kind: "idle" });
  });

  it("disconnect clearInMemoryResults makes late apply no-op", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const ipc = composeIpc({
      runQuery: vi.fn(async () => {
        await gate;
        return { columns: ["id"], rows: [[1]], rowsAffected: null, durationMs: 5 };
      }),
    });
    const stores = composeAppStores(ipc);
    await stores.session.getState().connect("P");
    const tab = stores.tabs.getState().createTab();
    const pending = runSelectOnActiveTab(stores, ipc, FIXTURE_SQL);
    await stores.session.getState().disconnect();
    release();
    await pending;
    expect(stores.tabs.getState().tabs.find((t) => t.id === tab.id)?.status).toEqual({
      kind: "idle",
    });
    expect(stores.tabs.getState().tabs.find((t) => t.id === tab.id)?.raw).toBeNull();
  });

  it("clearTabResults (Start over) clears in-memory results on T", async () => {
    const ipc = composeIpc();
    const stores = composeAppStores(ipc);
    await stores.session.getState().connect("P");
    const tab = stores.tabs.getState().createTab();
    await runSelectOnActiveTab(stores, ipc, FIXTURE_SQL);
    stores.tabs.getState().clearTabResults(tab.id);
    expect(stores.tabs.getState().tabs.find((t) => t.id === tab.id)?.raw).toBeNull();
    expect(stores.tabs.getState().tabs.find((t) => t.id === tab.id)?.status).toEqual({
      kind: "idle",
    });
  });

  it("Run failure applies error status then rethrows", async () => {
    const ipc = composeIpc({
      runQuery: vi.fn(async () => {
        throw new Error("syntax error");
      }),
    });
    const stores = composeAppStores(ipc);
    await stores.session.getState().connect("P");
    const tab = stores.tabs.getState().createTab();
    await expect(runSelectOnActiveTab(stores, ipc, FIXTURE_SQL)).rejects.toThrow(/syntax error/);
    expect(stores.tabs.getState().tabs.find((t) => t.id === tab.id)?.status).toEqual({
      kind: "error",
      message: "syntax error",
    });
  });
});
