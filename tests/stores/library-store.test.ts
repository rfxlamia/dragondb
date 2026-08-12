import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DragonIpc, QueryFolderDto, SavedQueryDto } from "../../src/ipc/contract";
import { createLibraryStore } from "../../src/stores/library-store";

function query(partial: Partial<SavedQueryDto> & Pick<SavedQueryDto, "id" | "name">): SavedQueryDto {
  return {
    queryText: "SELECT 1",
    connectionId: null,
    databaseName: null,
    createdAt: "1",
    updatedAt: "1",
    folderId: null,
    ...partial,
  };
}

describe("library-store", () => {
  let ipc: DragonIpc;
  let listSavedQueries: ReturnType<typeof vi.fn>;
  let saveSavedQuery: ReturnType<typeof vi.fn>;
  let deleteFolder: ReturnType<typeof vi.fn>;
  let listQueryFolders: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    listSavedQueries = vi.fn(async () => [query({ id: "q1", name: "a", folderId: "f1" })]);
    saveSavedQuery = vi.fn(async (q: SavedQueryDto) => q);
    deleteFolder = vi.fn(async () => undefined);
    listQueryFolders = vi.fn(async () => [] as QueryFolderDto[]);
    ipc = {
      listSavedQueries,
      saveSavedQuery,
      deleteFolder,
      listQueryFolders,
    } as unknown as DragonIpc;
  });

  it("refresh loads saved queries into state", async () => {
    const store = createLibraryStore(ipc);
    await store.getState().refresh();
    expect(listSavedQueries).toHaveBeenCalledOnce();
    expect(store.getState().queries).toEqual([
      expect.objectContaining({ id: "q1", folderId: "f1" }),
    ]);
  });

  it("saveSavedQuery delegates to ipc then refreshes", async () => {
    const store = createLibraryStore(ipc);
    const dto = query({ id: "q2", name: "b" });
    await store.getState().saveSavedQuery(dto);
    expect(saveSavedQuery).toHaveBeenCalledWith(dto);
    expect(listSavedQueries).toHaveBeenCalled();
  });

  it("deleteFolder(false) nullifies then refresh shows queries with folderId null", async () => {
    listSavedQueries
      .mockResolvedValueOnce([query({ id: "q1", name: "a", folderId: "f1" })])
      .mockResolvedValueOnce([query({ id: "q1", name: "a", folderId: null })]);
    const store = createLibraryStore(ipc);
    await store.getState().refresh();
    await store.getState().deleteFolder("f1", false);
    expect(deleteFolder).toHaveBeenCalledWith("f1", false);
    expect(store.getState().queries[0]?.folderId).toBeNull();
  });

  it("deleteFolder(true) cascade then refresh drops folder queries", async () => {
    listSavedQueries
      .mockResolvedValueOnce([query({ id: "q1", name: "a", folderId: "f1" })])
      .mockResolvedValueOnce([]);
    const store = createLibraryStore(ipc);
    await store.getState().refresh();
    await store.getState().deleteFolder("f1", true);
    expect(deleteFolder).toHaveBeenCalledWith("f1", true);
    expect(store.getState().queries).toEqual([]);
  });
});
