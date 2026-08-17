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
      ({ queryText }) => useSavedQueryAutosave({ stores, ipc, queryText, isRestoring: false }),
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
          ipc,
          queryText: "SELECT restored",
          isRestoring,
        }),
      { initialProps: { isRestoring: true } },
    );
    rerender({ isRestoring: false });
    await vi.advanceTimersByTimeAsync(500);
    expect(saveSavedQuery).not.toHaveBeenCalled();
  });
});
