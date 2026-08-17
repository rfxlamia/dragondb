import { createStore, type StoreApi } from "zustand/vanilla";
import type { ColumnInfo, ConnectionId, DragonIpc, TableRef } from "../ipc/contract";

/** Same key TableList uses for `columnsByTable` (`schema.name`). */
function tableCatalogKey(table: TableRef): string {
  return table.schema ? `${table.schema}.${table.name}` : table.name;
}

/** Sentinel written on listTables failure; tables UI matches this exact code. */
export const TABLES_LOAD_FAILED = "tables_load_failed";

export type SchemaState = {
  tables: TableRef[];
  columnNames: string[];
  columnsByTable: Record<string, ColumnInfo[]>;
  metadataErrorMessage: string | null;
  tablesLoading: boolean;
  tablesErrorMessage: string | null;
  columnsErrorMessage: string | null;
  loadTables: (connectionId: ConnectionId) => Promise<void>;
  reloadTables: (connectionId: ConnectionId) => Promise<void>;
  loadColumns: (connectionId: ConnectionId, table: TableRef) => Promise<void>;
  /** Sidebar expander only — must not touch canvas `columnNames`. */
  loadExpanderColumns: (connectionId: ConnectionId, table: TableRef) => Promise<void>;
  /** Named schema vs All Schemas (`null`). Reloads tables after the dedicated IPC. */
  setSearchPath: (connectionId: ConnectionId, schema: string | null) => Promise<void>;
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
  const expanderGeneration = new Map<string, number>();

  function bumpExpanderGenerations(): void {
    expanderGeneration.clear();
  }

  return createStore<SchemaState>((set, get) => ({
    tables: [],
    columnNames: [],
    columnsByTable: {},
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

    async reloadTables(connectionId) {
      columnGeneration += 1;
      bumpExpanderGenerations();
      set({ columnNames: [], columnsByTable: {}, columnsErrorMessage: null });
      await get().loadTables(connectionId);
    },

    async setSearchPath(connectionId, schema) {
      await ipc.setSearchPath(schema);
      await get().loadTables(connectionId);
    },

    async loadColumns(connectionId, table) {
      const generation = ++columnGeneration;
      try {
        const rows = await ipc.listColumns(connectionId, table);
        if (generation !== columnGeneration) return;
        set({
          columnNames: rows.map((column) => column.name),
          columnsByTable: { ...get().columnsByTable, [tableCatalogKey(table)]: rows },
          columnsErrorMessage: null,
          metadataErrorMessage: null,
        });
      } catch {
        if (generation !== columnGeneration) return;
        const next = { ...get().columnsByTable };
        delete next[tableCatalogKey(table)];
        set({
          columnNames: [],
          columnsByTable: next,
          columnsErrorMessage: "columns_load_failed",
          metadataErrorMessage: "columns_load_failed",
        });
      }
    },

    async loadExpanderColumns(connectionId, table) {
      const key = tableCatalogKey(table);
      const generation = (expanderGeneration.get(key) ?? 0) + 1;
      expanderGeneration.set(key, generation);
      try {
        const rows = await ipc.listColumns(connectionId, table);
        if (expanderGeneration.get(key) !== generation) return;
        set({
          columnsByTable: { ...get().columnsByTable, [key]: rows },
        });
      } catch {
        if (expanderGeneration.get(key) !== generation) return;
        const next = { ...get().columnsByTable };
        delete next[key];
        set({ columnsByTable: next });
      }
    },

    clearColumns() {
      columnGeneration += 1;
      bumpExpanderGenerations();
      set({
        columnNames: [],
        columnsByTable: {},
        columnsErrorMessage: null,
        metadataErrorMessage: null,
      });
    },

    clear() {
      tableGeneration += 1;
      columnGeneration += 1;
      bumpExpanderGenerations();
      set({
        tables: [],
        columnNames: [],
        columnsByTable: {},
        metadataErrorMessage: null,
        tablesLoading: false,
        tablesErrorMessage: null,
        columnsErrorMessage: null,
      });
    },
  }));
}
