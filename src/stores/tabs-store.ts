/**
 * Tabs store — create/switch/close (MRU + last-tab recreate), pending-delete ignore,
 * per-tab raw+compact+status, hydrate compact via result-compactor.
 *
 * `createTabsStore(ipc, { getConnectionId, getDatabaseName })` uses zustand/vanilla.
 * Does NOT require `createStoreApi` singleton — ipc is constructor-injected (T1 pattern).
 *
 * Hydration sets tabsReady after listTabStates; creates one empty tab if none remain.
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

export type TabRunResult = {
  columns: string[];
  rows: unknown[][];
  durationMs: number;
};

export type TabsState = {
  tabs: TabState[];
  activeTabId: string | null;
  tabsReady: boolean;
  pendingDeletedIds: Set<string>;
  createTab: () => TabState;
  switchTab: (id: string) => void;
  closeTab: (id: string) => void;
  persistTab: (dto: TabStateDto, opts?: { includeCachedResults?: boolean }) => Promise<void>;
  hydrateFromDto: (dto: TabStateDto) => void;
  refresh: () => Promise<void>;
  beginRun: (tabId: string) => number | null;
  applyRunSuccess: (tabId: string, result: TabRunResult, generation?: number) => Promise<void>;
  applyRunFailure: (tabId: string, message: string, generation?: number) => void;
  clearTabResults: (tabId: string) => void;
  clearInMemoryResults: () => void;
  setSavedQueryId: (tabId: string, queryId: string | null) => void;
  restoreSavedQueryResult: (
    tabId: string,
    cached: { compact: TabResultGrid; status: Extract<TabRunStatus, { kind: "ok" }> } | null,
  ) => void;
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
    const rows: unknown[][] = [];
    for (const row of parsed.rows) {
      if (!Array.isArray(row)) return null;
      rows.push(row);
    }
    return {
      columns: parsed.columns.map(String),
      rows,
    };
  } catch {
    return null;
  }
}

function compactCells(row: unknown): unknown[] {
  const cells = Array.isArray(row) ? row : [];
  return cells.map((cell) => (typeof cell === "string" ? compactCell(cell) : cell));
}

function compactGrid(raw: TabResultGrid): TabResultGrid {
  const rows = Array.isArray(raw.rows) ? raw.rows : [];
  return {
    columns: raw.columns,
    rows: rows.map(compactCells),
  };
}

function isThisSessionResultStatus(status: TabRunStatus | undefined): boolean {
  const kind = status?.kind ?? "idle";
  return kind === "ok" || kind === "running" || kind === "error";
}

function maxOrder(tabs: TabState[]): number {
  if (tabs.length === 0) return -1;
  return Math.max(...tabs.map((t) => t.order));
}

function accessedAt(tab: TabState): number {
  const parsed = Number(tab.lastAccessedAt);
  if (Number.isFinite(parsed)) return parsed;
  const iso = Date.parse(tab.lastAccessedAt);
  return Number.isFinite(iso) ? iso : 0;
}

function mruId(tabs: TabState[]): string | null {
  if (tabs.length === 0) return null;
  let best = tabs[0];
  if (!best) return null;
  for (const t of tabs) {
    if (accessedAt(t) > accessedAt(best)) best = t;
  }
  return best.id;
}

function toTabStateDto(tab: TabState): TabStateDto {
  const { raw: _raw, compact: _compact, status: _status, ...dto } = tab;
  return dto;
}

export function createTabsStore(ipc: DragonIpc, getters: TabsSessionGetters): StoreApi<TabsState> {
  /** Per-tab run generation — module-private; never on TabState / never persisted. */
  const runGenerations = new Map<string, number>();

  function bumpRunGeneration(tabId: string): number {
    const next = (runGenerations.get(tabId) ?? 0) + 1;
    runGenerations.set(tabId, next);
    return next;
  }

  return createStore<TabsState>((set, get) => {
    function canApplyRun(tabId: string, generation?: number): boolean {
      const { tabs, pendingDeletedIds } = get();
      if (pendingDeletedIds.has(tabId)) return false;
      if (!tabs.some((t) => t.id === tabId)) return false;
      if (generation !== undefined && generation !== runGenerations.get(tabId)) return false;
      return true;
    }

    function patchTab(tabId: string, patch: Partial<TabState>): void {
      set((state) => ({
        tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, ...patch } : t)),
      }));
    }

    function queueMetadataPersist(tab: TabState): void {
      void get()
        .persistTab(toTabStateDto(tab), { includeCachedResults: false })
        .catch(() => {
          /* best-effort metadata sync */
        });
    }

    function syncMetadataForCurrentTabs(): void {
      for (const tab of get().tabs) {
        queueMetadataPersist(tab);
      }
    }

    return {
      tabs: [],
      activeTabId: null,
      tabsReady: false,
      pendingDeletedIds: new Set(),

      createTab() {
        const order = maxOrder(get().tabs) + 1;
        const created = emptyTab(getters.getConnectionId(), getters.getDatabaseName(), order);
        set((state) => ({
          tabs: [...state.tabs.map((t) => ({ ...t, isActive: false })), created],
          activeTabId: created.id,
        }));
        // Persist new active + deactivated siblings (isActive must not stay true in sqlite).
        syncMetadataForCurrentTabs();
        return created;
      },

      switchTab(id) {
        if (!get().tabs.some((t) => t.id === id)) return;
        const ts = nowMillis();
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === id ? { ...t, isActive: true, lastAccessedAt: ts } : { ...t, isActive: false },
          ),
          activeTabId: id,
        }));
        // Always persist target (lastAccessedAt) even when already active; sync siblings too.
        syncMetadataForCurrentTabs();
      },

      closeTab(id) {
        const { tabs, activeTabId } = get();
        const remaining = tabs.filter((t) => t.id !== id);
        runGenerations.delete(id);

        set((state) => {
          const pending = new Set(state.pendingDeletedIds);
          pending.add(id);
          return { pendingDeletedIds: pending };
        });

        void ipc.deleteTabState(id).catch(() => {
          /* keep pendingDeletedIds so refresh cannot resurrect the tab */
        });

        if (remaining.length === 0) {
          const next = emptyTab(getters.getConnectionId(), getters.getDatabaseName(), 0);
          set({ tabs: [next], activeTabId: next.id });
          queueMetadataPersist(next);
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
        syncMetadataForCurrentTabs();
      },

      async persistTab(dto, opts) {
        if (get().pendingDeletedIds.has(dto.id)) return;
        await ipc.saveTabState(dto, opts);
        // Compensating delete if close raced past the pre-check.
        if (get().pendingDeletedIds.has(dto.id)) {
          await ipc.deleteTabState(dto.id).catch(() => {
            /* best-effort */
          });
        }
      },

      hydrateFromDto(dto) {
        if (get().pendingDeletedIds.has(dto.id)) return;
        const raw = parseCachedResults(dto.cachedResultsData);
        const compact = raw ? compactGrid(raw) : null;
        const hydrated = toTabState(dto, raw, compact);
        set((state) => {
          const idx = state.tabs.findIndex((t) => t.id === dto.id);
          if (idx >= 0) {
            const existing = state.tabs[idx];
            const tabs = state.tabs.slice();
            if (existing && isThisSessionResultStatus(existing.status)) {
              tabs[idx] = {
                ...hydrated,
                raw: existing.raw,
                compact: existing.compact,
                status: existing.status,
              };
            } else {
              tabs[idx] = { ...hydrated, status: existing?.status };
            }
            return { tabs };
          }
          return {
            tabs: [...state.tabs, hydrated],
            activeTabId: state.activeTabId ?? (dto.isActive ? dto.id : state.activeTabId),
          };
        });
      },

      async refresh() {
        try {
          const dtos = await ipc.listTabStates();
          for (const dto of dtos) {
            try {
              get().hydrateFromDto(dto);
            } catch {
              /* malformed cache must not abort remaining tabs */
            }
          }
          const { tabs, activeTabId } = get();
          if (activeTabId === null || !tabs.some((t) => t.id === activeTabId)) {
            const active = tabs.find((t) => t.isActive) ?? tabs[0];
            if (active) {
              set({ activeTabId: active.id });
            }
          }
        } catch {
          /* retain empty in-memory fallback below */
        }

        if (get().tabs.length === 0) {
          get().createTab();
        }
        set({ tabsReady: true });
      },

      beginRun(tabId) {
        const { tabs, pendingDeletedIds } = get();
        if (pendingDeletedIds.has(tabId)) return null;
        if (!tabs.some((t) => t.id === tabId)) return null;
        const generation = bumpRunGeneration(tabId);
        patchTab(tabId, {
          raw: null,
          compact: null,
          status: { kind: "running" },
        });
        return generation;
      },

      async applyRunSuccess(tabId, result, generation) {
        if (!canApplyRun(tabId, generation)) return;
        const raw: TabResultGrid = { columns: result.columns, rows: result.rows };
        const compact = compactGrid(raw);
        patchTab(tabId, {
          raw,
          compact,
          status: {
            kind: "ok",
            rowCount: result.rows.length,
            durationMs: result.durationMs,
          },
          cachedResultsData: JSON.stringify(raw),
          cachedColumnNames: result.columns,
        });
        const tab = get().tabs.find((t) => t.id === tabId);
        if (!tab) return;
        await get().persistTab(toTabStateDto(tab), { includeCachedResults: true });
      },

      applyRunFailure(tabId, message, generation) {
        if (!canApplyRun(tabId, generation)) return;
        patchTab(tabId, {
          raw: null,
          compact: null,
          status: { kind: "error", message },
        });
      },

      clearTabResults(tabId) {
        if (!get().tabs.some((t) => t.id === tabId)) return;
        bumpRunGeneration(tabId);
        patchTab(tabId, {
          raw: null,
          compact: null,
          status: { kind: "idle" },
        });
      },

      clearInMemoryResults() {
        for (const tab of get().tabs) {
          bumpRunGeneration(tab.id);
        }
        set((state) => ({
          tabs: state.tabs.map((t) => ({
            ...t,
            raw: null,
            compact: null,
            status: { kind: "idle" as const },
          })),
        }));
      },

      setSavedQueryId(tabId, queryId) {
        if (!get().tabs.some((t) => t.id === tabId)) return;
        patchTab(tabId, { savedQueryId: queryId });
        const tab = get().tabs.find((t) => t.id === tabId);
        if (tab) queueMetadataPersist(tab);
      },

      restoreSavedQueryResult(tabId, cached) {
        if (!get().tabs.some((t) => t.id === tabId)) return;
        bumpRunGeneration(tabId);
        if (cached === null) {
          patchTab(tabId, {
            raw: null,
            compact: null,
            status: { kind: "idle" },
          });
          return;
        }
        patchTab(tabId, {
          raw: null,
          compact: cached.compact,
          status: cached.status,
        });
      },
    };
  });
}
