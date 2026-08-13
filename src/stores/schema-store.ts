import { createStore, type StoreApi } from "zustand/vanilla";
import type { ConnectionId, DragonIpc, TableRef } from "../ipc/contract";

export type SchemaState = {
  tables: TableRef[];
  columnNames: string[];
  metadataErrorMessage: string | null;
  loadTables: (connectionId: ConnectionId) => Promise<void>;
  loadColumns: (connectionId: ConnectionId, table: TableRef) => Promise<void>;
  clearColumns: () => void;
  clear: () => void;
};

/**
 * Schema metadata store — generation-guarded listTables/listColumns so late
 * results after clear/disconnect/switch are ignored.
 */
export function createSchemaStore(ipc: DragonIpc): StoreApi<SchemaState> {
  let tableGeneration = 0;
  let columnGeneration = 0;

  return createStore<SchemaState>((set) => ({
    tables: [],
    columnNames: [],
    metadataErrorMessage: null,

    async loadTables(connectionId) {
      const generation = ++tableGeneration;
      try {
        const rows = await ipc.listTables(connectionId);
        if (generation !== tableGeneration) return;
        set({ tables: rows, metadataErrorMessage: null });
      } catch {
        if (generation !== tableGeneration) return;
        set({ tables: [], metadataErrorMessage: "tables_load_failed" });
      }
    },

    async loadColumns(connectionId, table) {
      const generation = ++columnGeneration;
      try {
        const rows = await ipc.listColumns(connectionId, table);
        if (generation !== columnGeneration) return;
        set({
          columnNames: rows.map((column) => column.name),
          metadataErrorMessage: null,
        });
      } catch {
        if (generation !== columnGeneration) return;
        set({
          columnNames: [],
          metadataErrorMessage: "columns_load_failed",
        });
      }
    },

    clearColumns() {
      columnGeneration += 1;
      set({ columnNames: [], metadataErrorMessage: null });
    },

    clear() {
      tableGeneration += 1;
      columnGeneration += 1;
      set({ tables: [], columnNames: [], metadataErrorMessage: null });
    },
  }));
}
