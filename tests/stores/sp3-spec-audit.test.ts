/**
 * SP-3 spec audit oracles — encode AC / Gherkin gaps found by bug-hunting.
 *
 * These tests are intentionally written against the approved spec
 * (docs/pocket/spec/2026-08-11-sp3-stores/stores-utils-ipc.md).
 *
 * Marked `it.fails`: each oracle currently FAILS against Phase A/B/C code.
 * When a gap is fixed, the corresponding `it.fails` will turn red — flip it
 * to `it` and keep the assertion as the regression lock.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { DragonIpc, TabStateDto } from "../../src/ipc/contract";
import { parseConnectionString } from "../../src/lib/connection-string";
import { composeAppStores } from "../../src/stores/compose-app-stores";
import { createLibraryStore } from "../../src/stores/library-store";
import { createSessionStore } from "../../src/stores/session-store";
import { createTabsStore } from "../../src/stores/tabs-store";

function stubIpc(overrides: Partial<DragonIpc> = {}): DragonIpc {
  return {
    connectProfile: vi.fn(async () => ({ connectionId: "c1", profileId: "P" , database: "app"})),
    disconnect: vi.fn(async () => undefined),
    listTables: vi.fn(async () => []),
    listColumns: vi.fn(async () => []),
    saveTabState: vi.fn(async () => undefined),
    deleteTabState: vi.fn(async () => undefined),
    listTabStates: vi.fn(async () => []),
    listSavedQueries: vi.fn(async () => []),
    listQueryFolders: vi.fn(async () => []),
    saveSavedQuery: vi.fn(async (q) => q),
    deleteFolder: vi.fn(async () => undefined),
    deleteSavedQueries: vi.fn(async () => undefined),
    duplicateSavedQuery: vi.fn(async () => {
      throw new Error("not stubbed");
    }),
    moveSavedQuery: vi.fn(async () => undefined),
    createQueryFolder: vi.fn(async () => {
      throw new Error("not stubbed");
    }),
    renameQueryFolder: vi.fn(async () => undefined),
    getSavedQuery: vi.fn(async () => null),
    ...overrides,
  } as unknown as DragonIpc;
}

function baseTab(overrides: Partial<TabStateDto> = {}): TabStateDto {
  return {
    id: "t1",
    connectionId: "c1",
    databaseName: "app",
    queryText: "",
    savedQueryId: null,
    isActive: true,
    order: 0,
    createdAt: "1",
    lastAccessedAt: "1",
    selectedTableSchema: null,
    selectedTableName: null,
    selectedSchemaFilter: null,
    cachedResultsData: null,
    cachedColumnNames: null,
    ...overrides,
  };
}

describe("SP-3 audit — compose createTab inherits databaseName (AC Tabs)", () => {
  it("composeAppStores createTab inherits session databaseName, not null", async () => {
    // Spec: Scenario Create tab inherits connection and empty query
    // "new tab has connectionId/databaseName inherited"
    const ipc = stubIpc({
      // Profile database is "app"; composition must surface it to tabs getters.
      connectProfile: vi.fn(async () => ({ connectionId: "c1", profileId: "P" , database: "app"})),
      getProfile: undefined,
    });
    const stores = composeAppStores(ipc);
    await stores.session.getState().connect("P");
    // Even without a profile lookup helper, composition must not hardcode null
    // if the session/profile database is available — current wiring passes
    // `getDatabaseName: () => null` unconditionally.
    const created = stores.tabs.getState().createTab();
    expect(created.connectionId).toBe("c1");
    expect(created.databaseName).not.toBeNull();
  });
});

describe("SP-3 audit — tab metadata persist (AC Tabs)", () => {
  it("createTab / switchTab / closeTab metadata-sync via saveTabState", async () => {
    // Spec: create/switch/close + persist metadata sync vs results-blob sync
    // Scenario: Metadata sync does not rewrite blob
    const saveTabState = vi.fn(async () => undefined);
    const ipc = stubIpc({ saveTabState });
    const store = createTabsStore(ipc, {
      getConnectionId: () => "c1",
      getDatabaseName: () => "app",
    });

    const created = store.getState().createTab();
    // Allow microtask flush for any fire-and-forget persist
    await Promise.resolve();
    expect(saveTabState).toHaveBeenCalled();
    const createCall = saveTabState.mock.calls.find((c) => c[0]?.id === created.id);
    expect(createCall?.[1]).toMatchObject({ includeCachedResults: false });

    saveTabState.mockClear();
    store.getState().switchTab(created.id);
    await Promise.resolve();
    expect(saveTabState).toHaveBeenCalled();
    expect(saveTabState.mock.calls.some((c) => c[1]?.includeCachedResults === false)).toBe(true);

    // Seed a second tab so close is among N
    const other = store.getState().createTab();
    saveTabState.mockClear();
    store.getState().closeTab(other.id);
    await Promise.resolve();
    // Remaining active tab's isActive / lastAccessedAt must metadata-sync
    expect(
      saveTabState.mock.calls.some(
        (c) => c[0]?.id === created.id && c[1]?.includeCachedResults === false,
      ),
    ).toBe(true);
  });
});

describe("SP-3 audit — pending-deleted TOCTOU (AC Tabs)", () => {
  it.fails("close during in-flight results persist does not resurrect deleted tab", async () => {
    // Spec: Scenario Writes ignored for pending-deleted tab
    let releaseSave!: () => void;
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    const savedIds: string[] = [];
    const saveTabState = vi.fn(async (dto: TabStateDto) => {
      await saveGate;
      savedIds.push(dto.id);
    });
    const deleteTabState = vi.fn(async () => undefined);
    const ipc = stubIpc({ saveTabState, deleteTabState });
    const store = createTabsStore(ipc, {
      getConnectionId: () => "c1",
      getDatabaseName: () => "app",
    });
    store.setState({
      tabs: [baseTab({ id: "gone" }), baseTab({ id: "keep", isActive: false, order: 1 })],
      activeTabId: "gone",
    });

    const persistPromise = store.getState().applyRunSuccess("gone", {
      columns: ["id"],
      rows: [[1]],
      durationMs: 1,
    });
    // Close while persist awaits IPC
    await Promise.resolve();
    store.getState().closeTab("gone");
    releaseSave();
    await persistPromise;

    expect(deleteTabState).toHaveBeenCalledWith("gone");
    // After close, save must not complete a write for the deleted id
    expect(savedIds).not.toContain("gone");
  });
});

describe("SP-3 audit — App hydrates tabs on start (AC Tabs)", () => {
  it("App.tsx calls tabs.refresh / listTabStates on mount", () => {
    // Spec: Persist round-trip all TabState fields — When app restarts
    const src = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");
    expect(src).toMatch(/\.refresh\s*\(/);
  });
});

describe("SP-3 audit — switch-fail snapshot must remount next different profile (AC Session)", () => {
  it("App.handleSwitchFailure must not wipe the disconnect snapshot", () => {
    // Spec: Switch fails after teardown → cards snapshot without result; later
    // connect to a different profile must remount empty (same as disconnect→B).
    // Bug: App.tsx handleSwitchFailure calls noteCanvasDisconnect(null).
    const src = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");
    expect(src).not.toMatch(/handleSwitchFailure[\s\S]*?noteCanvasDisconnect\(\s*null\s*\)/);

    const stores = composeAppStores(stubIpc());
    stores.noteCanvasDisconnect("A");
    expect(stores.shouldRemountCanvasOnConnect("B")).toBe(true);
  });
});

describe("SP-3 audit — disconnect during in-flight connect (AC Session)", () => {
  it("cancelled connect after disconnect does not leave live Rust session orphaned", async () => {
    // Spec: Disconnect clears session; cancelled connect must not leave live I/O
    let resolveConnect!: (v: { connectionId: string; profileId: string }) => void;
    const connectProfile = vi.fn(
      () =>
        new Promise<{ connectionId: string; profileId: string }>((resolve) => {
          resolveConnect = resolve;
        }),
    );
    const disconnect = vi.fn(async () => undefined);
    const ipc = stubIpc({ connectProfile, disconnect });
    const store = createSessionStore(ipc);

    const connectPromise = store.getState().connect("P");
    await store.getState().disconnect();
    // Rust connect finishes after TS disconnect — generation cancels apply
    resolveConnect({ connectionId: "orphan-c", profileId: "P" , database: "app"});
    await expect(connectPromise).rejects.toMatchObject({ message: "cancelled" });

    expect(store.getState().isConnected).toBe(false);
    // Must tear down the live session that connect_profile just established
    // (disconnect was issued *before* connect resolved; need a follow-up).
    expect(disconnect.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe("SP-3 audit — library store matrix (AC Library)", () => {
  it.fails("library store exposes full SavedQuery/QueryFolder API matrix", () => {
    // Spec: library store with full API matrix (not IPC-only)
    const store = createLibraryStore(stubIpc());
    const state = store.getState() as Record<string, unknown>;
    for (const method of [
      "deleteSavedQueries",
      "duplicateSavedQuery",
      "moveSavedQuery",
      "createQueryFolder",
      "renameQueryFolder",
      "getSavedQuery",
    ]) {
      expect(typeof state[method], `missing library store action: ${method}`).toBe("function");
    }
  });
});

describe("SP-3 audit — connection string taxonomy (AC Utils)", () => {
  it("invalid percent-encoding yields invalidPercentEncoding (not raw URIError)", () => {
    // Spec: structured error per Swift taxonomy (invalidPercentEncoding declared)
    try {
      parseConnectionString("postgres://u:%ZZx@127.0.0.1/db");
      expect.unreachable("must throw");
    } catch (error) {
      expect(error).toMatchObject({
        name: "ConnectionStringParseError",
        code: "invalidPercentEncoding",
      });
    }
  });
});

describe("SP-3 audit — TabState timestamp round-trip (AC Tabs)", () => {
  it.fails("tab_write_from_input / TabStateWrite must carry client createdAt/lastAccessedAt", () => {
    // Spec: Persist round-trip all TabState checklist fields including timestamps
    // (MRU closeTab depends on lastAccessedAt surviving restart).
    const session = readFileSync(join(process.cwd(), "src-tauri/src/session/mod.rs"), "utf8");
    const storage = readFileSync(join(process.cwd(), "src-tauri/src/storage/tabs.rs"), "utf8");
    // tab_write_from_input must map input timestamps into TabStateWrite
    expect(session).toMatch(/created_at:\s*input\.created_at/);
    expect(session).toMatch(/last_accessed_at:\s*input\.last_accessed_at/);
    // TabStateWrite must have fields to carry them (not server-now only)
    expect(storage).toMatch(/pub created_at:/);
    expect(storage).toMatch(/pub last_accessed_at:/);
  });
});
