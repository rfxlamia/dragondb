/**
 * Tabs store — create/switch/close (MRU + last-tab recreate), pending-delete ignore,
 * per-tab raw+compact+status, hydrate compact via result-compactor.
 *
 * `createTabsStore(ipc, { getConnectionId, getDatabaseName })` uses zustand/vanilla.
 * Does NOT require `createStoreApi` singleton — ipc is constructor-injected (T1 pattern).
 *
 * No TabBar / App canvas wiring (Phase C).
 */
import { createStore, type StoreApi } from "zustand/vanilla";
import type { ConnectionId, DragonIpc, TabStateDto } from "../ipc/contract";
import { compactCell } from "../lib/result-compactor";

export type TabResultGrid = {
  columns: string[];
  rows: unknown[][];
};

export type TabRunStatus =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "ok"; rowCount: number; durationMs: number }
  | { kind: "error"; message: string };

/** In-memory tab = persist DTO fields + dual raw/compact + run status. */
export type TabState = TabStateDto & {
  raw?: TabResultGrid | null;
  compact?: TabResultGrid | null;
  status?: TabRunStatus;
};

export type TabsSessionGetters = {
  getConnectionId: () => ConnectionId | null;
  getDatabaseName: () => string | null;
};

export type TabsState = {
  tabs: TabState[];
  activeTabId: string | null;
  pendingDeletedIds: Set<string>;
  createTab: () => TabState;
  switchTab: (id: string) => void;
  closeTab: (id: string) => void;
  persistTab: (dto: TabStateDto, opts?: { includeCachedResults?: boolean }) => Promise<void>;
  hydrateFromDto: (dto: TabStateDto) => void;
  refresh: () => Promise<void>;
};

function nowMillis(): string {
  return String(Date.now());
}

function newId(): string {
  return crypto.randomUUID();
}

function toTabState(
  dto: TabStateDto,
  raw: TabResultGrid | null = null,
  compact: TabResultGrid | null = null,
): TabState {
  return {
    ...dto,
    raw,
    compact,
    status: { kind: "idle" },
  };
}

function emptyTab(
  connectionId: ConnectionId | null,
  databaseName: string | null,
  order: number,
): TabState {
  const ts = nowMillis();
  return toTabState({
    id: newId(),
    connectionId,
    databaseName,
    queryText: "",
    savedQueryId: null,
    isActive: true,
    order,
    createdAt: ts,
    lastAccessedAt: ts,
    selectedTableSchema: null,
    selectedTableName: null,
    selectedSchemaFilter: null,
    cachedResultsData: null,
    cachedColumnNames: null,
  });
}

function parseCachedResults(data: string | null): TabResultGrid | null {
  if (data == null || data === "") return null;
  try {
    const parsed = JSON.parse(data) as { columns?: unknown; rows?: unknown };
    if (!Array.isArray(parsed.columns) || !Array.isArray(parsed.rows)) return null;
    return {
      columns: parsed.columns.map(String),
      rows: parsed.rows as unknown[][],
    };
  } catch {
    return null;
  }
}

function compactGrid(raw: TabResultGrid): TabResultGrid {
  return {
    columns: raw.columns,
    rows: raw.rows.map((row) =>
      row.map((cell) => (typeof cell === "string" ? compactCell(cell) : cell)),
    ),
  };
}

function maxOrder(tabs: TabState[]): number {
  if (tabs.length === 0) return -1;
  return Math.max(...tabs.map((t) => t.order));
}

function mruId(tabs: TabState[]): string | null {
  if (tabs.length === 0) return null;
  let best = tabs[0];
  if (!best) return null;
  for (const t of tabs) {
    if (t.lastAccessedAt > best.lastAccessedAt) best = t;
  }
  return best.id;
}

export function createTabsStore(ipc: DragonIpc, getters: TabsSessionGetters): StoreApi<TabsState> {
  return createStore<TabsState>((set, get) => ({
    tabs: [],
    activeTabId: null,
    pendingDeletedIds: new Set(),

    createTab() {
      const order = maxOrder(get().tabs) + 1;
      const created = emptyTab(getters.getConnectionId(), getters.getDatabaseName(), order);
      set((state) => ({
        tabs: [...state.tabs.map((t) => ({ ...t, isActive: false })), created],
        activeTabId: created.id,
      }));
      return created;
    },

    switchTab(id) {
      const ts = nowMillis();
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === id ? { ...t, isActive: true, lastAccessedAt: ts } : { ...t, isActive: false },
        ),
        activeTabId: id,
      }));
    },

    closeTab(id) {
      const { tabs, activeTabId } = get();
      const remaining = tabs.filter((t) => t.id !== id);

      set((state) => {
        const pending = new Set(state.pendingDeletedIds);
        pending.add(id);
        return { pendingDeletedIds: pending };
      });

      void ipc.deleteTabState(id).catch(() => {
        /* best-effort persist delete */
      });

      if (remaining.length === 0) {
        const next = emptyTab(getters.getConnectionId(), getters.getDatabaseName(), 0);
        set({ tabs: [next], activeTabId: next.id });
        return;
      }

      let nextActive = activeTabId;
      if (activeTabId === id) {
        nextActive = mruId(remaining);
      }
      set({
        tabs: remaining.map((t) => ({
          ...t,
          isActive: t.id === nextActive,
        })),
        activeTabId: nextActive,
      });
    },

    async persistTab(dto, opts) {
      if (get().pendingDeletedIds.has(dto.id)) return;
      await ipc.saveTabState(dto, opts);
    },

    hydrateFromDto(dto) {
      const raw = parseCachedResults(dto.cachedResultsData);
      const compact = raw ? compactGrid(raw) : null;
      const hydrated = toTabState(dto, raw, compact);
      set((state) => {
        const idx = state.tabs.findIndex((t) => t.id === dto.id);
        if (idx >= 0) {
          const tabs = state.tabs.slice();
          tabs[idx] = { ...hydrated, status: tabs[idx]?.status };
          return { tabs };
        }
        return {
          tabs: [...state.tabs, hydrated],
          activeTabId: state.activeTabId ?? (dto.isActive ? dto.id : state.activeTabId),
        };
      });
    },

    async refresh() {
      const dtos = await ipc.listTabStates();
      for (const dto of dtos) {
        get().hydrateFromDto(dto);
      }
      const { tabs } = get();
      const active = tabs.find((t) => t.isActive) ?? tabs[0];
      if (active) {
        set({ activeTabId: active.id });
      }
    },
  }));
}
