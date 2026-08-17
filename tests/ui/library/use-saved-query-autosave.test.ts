/** @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DragonIpc, SavedQueryDto } from "../../../src/ipc/contract";
import { composeAppStores } from "../../../src/stores/compose-app-stores";
import { useSavedQueryAutosave } from "../../../src/ui/library/use-saved-query-autosave";

afterEach(() => {
  vi.useRealTimers();
});

function ipcWithSave(saveSavedQuery: ReturnType<typeof vi.fn>): DragonIpc {
  return {
    connectProfile: vi.fn(async () => ({ connectionId: "c1", profileId: "P", database: "app" })),
    disconnect: vi.fn(async () => undefined),
    listTables: vi.fn(async () => []),
    listColumns: vi.fn(async () => []),
    listSavedQueries: vi.fn(async () => []),
    listQueryFolders: vi.fn(async () => []),
    saveSavedQuery,
    saveTabState: vi.fn(async () => undefined),
    deleteTabState: vi.fn(async () => undefined),
    listTabStates: vi.fn(async () => []),
  } as unknown as DragonIpc;
}

describe("useSavedQueryAutosave", () => {
  it("auto-creates a SavedQuery 500ms after hatch typing with none selected", async () => {
    vi.useFakeTimers();
    const saveSavedQuery = vi.fn(async (q: SavedQueryDto) => q);
    const ipc = ipcWithSave(saveSavedQuery);
    const stores = composeAppStores(ipc);
    const tab = stores.tabs.getState().createTab();
    const { rerender } = renderHook(
      ({ queryText }) => useSavedQueryAutosave({ stores, queryText, isRestoring: false }),
      { initialProps: { queryText: "" } },
    );

    act(() => stores.tabs.getState().setQueryText(tab.id, "SELECT 1"));
    rerender({ queryText: stores.tabs.getState().tabs[0]?.queryText ?? "" });
    await vi.advanceTimersByTimeAsync(500);
    expect(saveSavedQuery).toHaveBeenCalledWith(expect.objectContaining({ queryText: "SELECT 1" }));
    const created = saveSavedQuery.mock.calls[0]?.[0];
    expect(stores.tabs.getState().tabs[0]?.savedQueryId).toBe(created?.id);
  });

  it("does not auto-create after a persisted buffer finishes restoring", async () => {
    vi.useFakeTimers();
    const saveSavedQuery = vi.fn(async (q: SavedQueryDto) => q);
    const ipc = ipcWithSave(saveSavedQuery);
    const stores = composeAppStores(ipc);
    stores.tabs.getState().hydrateFromDto({
      id: "restored",
      connectionId: "c1",
      databaseName: "app",
      queryText: "SELECT restored",
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
      visualDocumentJson: null,
    });
    const { rerender } = renderHook(
      ({ isRestoring }) =>
        useSavedQueryAutosave({
          stores,
          queryText: "SELECT restored",
          isRestoring,
        }),
      { initialProps: { isRestoring: true } },
    );
    rerender({ isRestoring: false });
    await vi.advanceTimersByTimeAsync(500);
    expect(saveSavedQuery).not.toHaveBeenCalled();
  });

  it("does not persist when the buffer already matches the selected SavedQuery's text", async () => {
    vi.useFakeTimers();
    const saveSavedQuery = vi.fn(async (q: SavedQueryDto) => q);
    const ipc = ipcWithSave(saveSavedQuery);
    const stores = composeAppStores(ipc);
    const tab = stores.tabs.getState().createTab();
    stores.tabs.getState().setSavedQueryId(tab.id, "q1");
    stores.library.setState({
      queries: [
        {
          id: "q1",
          name: "Q1",
          queryText: "SELECT 1",
          connectionId: null,
          databaseName: null,
          createdAt: "1",
          updatedAt: "1",
          folderId: null,
        },
      ],
      folders: [],
    });
    const { rerender } = renderHook(
      ({ queryText }) => useSavedQueryAutosave({ stores, queryText, isRestoring: false }),
      { initialProps: { queryText: "SELECT 1" } },
    );
    rerender({ queryText: "SELECT 1" });
    await vi.advanceTimersByTimeAsync(500);
    expect(saveSavedQuery).not.toHaveBeenCalled();
  });

  it("selecting a different query while a debounce is pending cancels it — the previous query's text is not overwritten", async () => {
    vi.useFakeTimers();
    const library: SavedQueryDto[] = [
      {
        id: "q1",
        name: "Q1",
        queryText: "SELECT 1",
        connectionId: null,
        databaseName: null,
        createdAt: "1",
        updatedAt: "1",
        folderId: null,
      },
      {
        id: "q2",
        name: "Q2",
        queryText: "SELECT 2",
        connectionId: null,
        databaseName: null,
        createdAt: "1",
        updatedAt: "1",
        folderId: null,
      },
    ];
    const saveSavedQuery = vi.fn(async (query: SavedQueryDto) => {
      const idx = library.findIndex((item) => item.id === query.id);
      if (idx >= 0) library[idx] = query;
      else library.push(query);
      return query;
    });
    const ipc = ipcWithSave(saveSavedQuery);
    const stores = composeAppStores(ipc);
    stores.library.setState({ queries: library.slice(), folders: [] });
    const tab = stores.tabs.getState().createTab();
    stores.tabs.getState().setSavedQueryId(tab.id, "q1");

    const { rerender } = renderHook(
      ({ queryText, isRestoring }) => useSavedQueryAutosave({ stores, queryText, isRestoring }),
      { initialProps: { queryText: "SELECT 1", isRestoring: false } },
    );

    // User edits Q1's buffer — schedules a debounce for Q1.
    rerender({ queryText: "SELECT 1 -- edited", isRestoring: false });
    await vi.advanceTimersByTimeAsync(200);

    // Before the debounce fires, App.handleSelectQuery switches to Q2: it
    // loads Q2's text into the buffer and pulses isRestoring true→false
    // (mirroring App.tsx's querySelectRestoring), which must cancel Q1's
    // pending timer via effect cleanup.
    stores.tabs.getState().setSavedQueryId(tab.id, "q2");
    rerender({ queryText: "SELECT 2", isRestoring: true });
    rerender({ queryText: "SELECT 2", isRestoring: false });

    await vi.advanceTimersByTimeAsync(600);

    expect(library.find((item) => item.id === "q1")?.queryText).toBe("SELECT 1");
    expect(library.find((item) => item.id === "q2")?.queryText).toBe("SELECT 2");
  });
});
