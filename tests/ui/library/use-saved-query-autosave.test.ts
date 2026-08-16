/** @vitest-environment jsdom */

import { renderHook } from "@testing-library/react";
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
    stores.tabs.getState().createTab();
    renderHook(() =>
      useSavedQueryAutosave({ stores, ipc, queryText: "SELECT 1", isRestoring: false }),
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(saveSavedQuery).toHaveBeenCalledWith(expect.objectContaining({ queryText: "SELECT 1" }));
  });

  it("skips auto-create while restoring", async () => {
    vi.useFakeTimers();
    const saveSavedQuery = vi.fn(async (q: SavedQueryDto) => q);
    const ipc = ipcWithSave(saveSavedQuery);
    const stores = composeAppStores(ipc);
    stores.tabs.getState().createTab();
    renderHook(() =>
      useSavedQueryAutosave({ stores, ipc, queryText: "SELECT 1", isRestoring: true }),
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(saveSavedQuery).not.toHaveBeenCalled();
  });
});
