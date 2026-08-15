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

const DEFAULT_LIST_OPTS: HistoryListOptions = { limit: 50 };

export type HistoryState = {
  entries: HistoryDto[];
  loadError: string | null;
  refresh: (opts?: HistoryListOptions) => Promise<void>;
  deleteHistory: (id: string) => Promise<void>;
  clearHistory: (profileId: ProfileId) => Promise<void>;
};

function messageFromUnknown(err: unknown): string {
  if (err instanceof Error && err.message.length > 0) return err.message;
  if (err !== null && typeof err === "object" && "message" in err) {
    const message = (err as { message: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return "Failed to load history";
}

export function createHistoryStore(ipc: DragonIpc): StoreApi<HistoryState> {
  let lastOpts: HistoryListOptions = DEFAULT_LIST_OPTS;
  let generation = 0;

  return createStore<HistoryState>((set, get) => ({
    entries: [],
    loadError: null,

    async refresh(opts = DEFAULT_LIST_OPTS) {
      lastOpts = opts;
      const current = ++generation;
      try {
        const entries = await ipc.listHistory(opts);
        if (current !== generation) return;
        set({ entries, loadError: null });
      } catch (err) {
        if (current !== generation) return;
        set({ entries: [], loadError: messageFromUnknown(err) });
      }
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
