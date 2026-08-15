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
  deleteSavedQueries: (ids: string[]) => Promise<void>;
  duplicateSavedQuery: (id: string) => Promise<SavedQueryDto>;
  moveSavedQuery: (id: string, folderId: string | null) => Promise<void>;
  createQueryFolder: (name: string) => Promise<QueryFolderDto>;
  renameQueryFolder: (id: string, name: string) => Promise<void>;
  getSavedQuery: (id: string) => Promise<SavedQueryDto | null>;
};

export function createLibraryStore(ipc: DragonIpc): StoreApi<LibraryState> {
  let generation = 0;

  return createStore<LibraryState>((set, get) => ({
    queries: [],
    folders: [],

    async refresh() {
      const current = ++generation;
      const [queries, folders] = await Promise.all([
        ipc.listSavedQueries(),
        ipc.listQueryFolders(),
      ]);
      if (current !== generation) return;
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

    async deleteSavedQueries(ids: string[]) {
      await ipc.deleteSavedQueries(ids);
      await get().refresh();
    },

    async duplicateSavedQuery(id: string) {
      const duplicated = await ipc.duplicateSavedQuery(id);
      await get().refresh();
      return duplicated;
    },

    async moveSavedQuery(id: string, folderId: string | null) {
      await ipc.moveSavedQuery(id, folderId);
      await get().refresh();
    },

    async createQueryFolder(name: string) {
      const folder = await ipc.createQueryFolder(name);
      await get().refresh();
      return folder;
    },

    async renameQueryFolder(id: string, name: string) {
      await ipc.renameQueryFolder(id, name);
      await get().refresh();
    },

    async getSavedQuery(id: string) {
      return ipc.getSavedQuery(id);
    },
  }));
}
