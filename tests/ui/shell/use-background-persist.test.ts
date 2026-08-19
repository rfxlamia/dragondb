/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DragonIpc, TabStateDto } from "../../../src/ipc/contract";
import { createTabsStore } from "../../../src/stores/tabs-store";
import { useBackgroundPersist } from "../../../src/ui/shell/use-background-persist";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

function tab(overrides: Partial<TabStateDto> = {}): TabStateDto {
  return {
    id: "t1",
    connectionId: "c1",
    databaseName: "app",
    queryText: "SELECT 1",
    savedQueryId: null,
    isActive: true,
    order: 0,
    createdAt: "1",
    lastAccessedAt: "1",
    selectedTableSchema: null,
    selectedTableName: null,
    selectedSchemaFilter: null,
    cachedResultsData: JSON.stringify({ columns: ["c"], rows: [["kept"]] }),
    cachedColumnNames: ["c"],
    visualDocumentJson: null,
    ...overrides,
  };
}

describe("useBackgroundPersist", () => {
  it("visibilitychange hidden persists query text with includeCachedResults false", () => {
    const saveTabState = vi.fn(async () => undefined);
    const ipc = {
      saveTabState,
      deleteTabState: vi.fn(async () => undefined),
      listTabStates: vi.fn(async () => []),
    } as unknown as DragonIpc;
    const tabs = createTabsStore(ipc, {
      getConnectionId: () => "c1",
      getDatabaseName: () => "app",
    });
    tabs.setState({ tabs: [tab()], activeTabId: "t1" });
    renderHook(() => useBackgroundPersist(tabs));
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(saveTabState).toHaveBeenCalledWith(
      expect.objectContaining({ id: "t1", queryText: "SELECT 1" }),
      { includeCachedResults: false },
    );
  });

  it("beforeunload runs the same persist path", () => {
    const persistTab = vi.fn(async () => undefined);
    const ipc = {
      saveTabState: persistTab,
      deleteTabState: vi.fn(async () => undefined),
      listTabStates: vi.fn(async () => []),
    } as unknown as DragonIpc;
    const tabs = createTabsStore(ipc, {
      getConnectionId: () => "c1",
      getDatabaseName: () => "app",
    });
    tabs.setState({ tabs: [tab()], activeTabId: "t1" });
    renderHook(() => useBackgroundPersist(tabs));
    window.dispatchEvent(new Event("beforeunload"));
    expect(persistTab).toHaveBeenCalledWith(expect.objectContaining({ queryText: "SELECT 1" }), {
      includeCachedResults: false,
    });
  });

  it("Tauri onCloseRequested runs the same persist path", async () => {
    const persistTab = vi.fn(async () => undefined);
    const onCloseRequested = vi.fn(async (handler: () => void | Promise<void>) => {
      await handler();
      return () => {};
    });
    vi.doMock("@tauri-apps/api/window", () => ({
      getCurrentWindow: () => ({ onCloseRequested }),
    }));
    vi.stubGlobal("window", Object.assign(window, { __TAURI_INTERNALS__: {} }));
    const ipc = {
      saveTabState: persistTab,
      deleteTabState: vi.fn(async () => undefined),
      listTabStates: vi.fn(async () => []),
    } as unknown as DragonIpc;
    const tabs = createTabsStore(ipc, {
      getConnectionId: () => "c1",
      getDatabaseName: () => "app",
    });
    tabs.setState({ tabs: [tab()], activeTabId: "t1" });
    const { useBackgroundPersist: hook } = await import(
      "../../../src/ui/shell/use-background-persist"
    );
    renderHook(() => hook(tabs));
    expect(onCloseRequested).toHaveBeenCalled();
    expect(persistTab).toHaveBeenCalledWith(expect.objectContaining({ queryText: "SELECT 1" }), {
      includeCachedResults: false,
    });
  });
});
