/**
 * Library store — saved queries + folders via injected DragonIpc.
 *
 * `createLibraryStore(ipc)` uses zustand/vanilla. Does NOT require
 * `createStoreApi` singleton — ipc is constructor-injected (T1 pattern).
 */
import { createStore, type StoreApi } from "zustand/vanilla";
import type { DragonIpc, QueryFolderDto, SavedQueryDto } from "../ipc/contract";

export type LibraryState = {
  queries: SavedQueryDto[];
  folders: QueryFolderDto[];
  refresh: () => Promise<void>;
  saveSavedQuery: (query: SavedQueryDto) => Promise<void>;
  deleteFolder: (id: string, deleteQueries: boolean) => Promise<void>;
};

export function createLibraryStore(ipc: DragonIpc): StoreApi<LibraryState> {
  return createStore<LibraryState>((set, get) => ({
    queries: [],
    folders: [],

    async refresh() {
      const [queries, folders] = await Promise.all([
        ipc.listSavedQueries(),
        ipc.listQueryFolders(),
      ]);
      set({ queries, folders });
    },

    async saveSavedQuery(query: SavedQueryDto) {
      await ipc.saveSavedQuery(query);
      await get().refresh();
    },

    async deleteFolder(id: string, deleteQueries: boolean) {
      await ipc.deleteFolder(id, deleteQueries);
      await get().refresh();
    },
  }));
}
