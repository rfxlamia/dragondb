import { createStore, type StoreApi } from "zustand/vanilla";
import type { ConnectionId, DragonIpc, TableRef } from "../ipc/contract";

export type SchemaState = {
  tables: TableRef[];
  loadTables: (connectionId: ConnectionId) => Promise<void>;
  clear: () => void;
};

/**
 * Schema metadata store — generation-guarded listTables so late results
 * after clear/disconnect/switch are ignored.
 */
export function createSchemaStore(ipc: DragonIpc): StoreApi<SchemaState> {
  let tableGeneration = 0;

  return createStore<SchemaState>((set) => ({
    tables: [],

    async loadTables(connectionId) {
      const generation = ++tableGeneration;
      try {
        const rows = await ipc.listTables(connectionId);
        if (generation !== tableGeneration) return;
        set({ tables: rows });
      } catch {
        if (generation !== tableGeneration) return;
        set({ tables: [] });
      }
    },

    clear() {
      tableGeneration += 1;
      set({ tables: [] });
    },
  }));
}
