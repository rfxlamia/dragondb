import { createStore, type StoreApi } from "zustand/vanilla";
import type { ConnectionId, DragonIpc, TableRef } from "../ipc/contract";

/** Sentinel written on listTables failure; tables UI matches this exact code. */
export const TABLES_LOAD_FAILED = "tables_load_failed";

export type SchemaState = {
  tables: TableRef[];
  columnNames: string[];
  metadataErrorMessage: string | null;
  tablesLoading: boolean;
  tablesErrorMessage: string | null;
  columnsErrorMessage: string | null;
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
    tablesLoading: false,
    tablesErrorMessage: null,
    columnsErrorMessage: null,

    async loadTables(connectionId) {
      const generation = ++tableGeneration;
      set({ tablesLoading: true, tablesErrorMessage: null });
      try {
        const rows = await ipc.listTables(connectionId);
        if (generation !== tableGeneration) return;
        set({
          tables: rows,
          tablesLoading: false,
          tablesErrorMessage: null,
          metadataErrorMessage: null,
        });
      } catch {
        if (generation !== tableGeneration) return;
        set({
          tables: [],
          tablesLoading: false,
          tablesErrorMessage: TABLES_LOAD_FAILED,
          metadataErrorMessage: TABLES_LOAD_FAILED,
        });
      }
    },

    async loadColumns(connectionId, table) {
      const generation = ++columnGeneration;
      try {
        const rows = await ipc.listColumns(connectionId, table);
        if (generation !== columnGeneration) return;
        set({
          columnNames: rows.map((column) => column.name),
          columnsErrorMessage: null,
          metadataErrorMessage: null,
        });
      } catch {
        if (generation !== columnGeneration) return;
        set({
          columnNames: [],
          columnsErrorMessage: "columns_load_failed",
          metadataErrorMessage: "columns_load_failed",
        });
      }
    },

    clearColumns() {
      columnGeneration += 1;
      set({ columnNames: [], columnsErrorMessage: null, metadataErrorMessage: null });
    },

    clear() {
      tableGeneration += 1;
      columnGeneration += 1;
      set({
        tables: [],
        columnNames: [],
        metadataErrorMessage: null,
        tablesLoading: false,
        tablesErrorMessage: null,
        columnsErrorMessage: null,
      });
    },
  }));
}
