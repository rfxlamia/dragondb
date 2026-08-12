/**
 * History store — query history via injected DragonIpc.
 *
 * `createHistoryStore(ipc)` uses zustand/vanilla. Does NOT require
 * `createStoreApi` singleton — ipc is constructor-injected (T1 pattern).
 *
 * clearHistory(profileId) is always per-profile (never global wipe).
 * No History UI in this module (Phase C).
 */
import { createStore, type StoreApi } from "zustand/vanilla";
import type { DragonIpc, HistoryDto, HistoryListOptions, ProfileId } from "../ipc/contract";

export type HistoryState = {
  entries: HistoryDto[];
  refresh: (opts: HistoryListOptions) => Promise<void>;
  deleteHistory: (id: string) => Promise<void>;
  clearHistory: (profileId: ProfileId) => Promise<void>;
};

export function createHistoryStore(ipc: DragonIpc): StoreApi<HistoryState> {
  let lastOpts: HistoryListOptions = { limit: 50 };

  return createStore<HistoryState>((set, get) => ({
    entries: [],

    async refresh(opts) {
      lastOpts = opts;
      const entries = await ipc.listHistory(opts);
      set({ entries });
    },

    async deleteHistory(id) {
      await ipc.deleteHistory(id);
      await get().refresh(lastOpts);
    },

    async clearHistory(profileId) {
      await ipc.clearHistory(profileId);
      await get().refresh(lastOpts);
    },
  }));
}
