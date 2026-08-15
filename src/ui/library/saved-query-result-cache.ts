import type { TabResultGrid, TabRunStatus } from "../../stores/tabs-store";

export type SavedQueryOkStatus = Extract<TabRunStatus, { kind: "ok" }>;

export type SavedQueryCachedResult = {
  compact: TabResultGrid;
  status: SavedQueryOkStatus;
};

export type SavedQueryResultCache = {
  write: (id: string, compact: TabResultGrid, status: TabRunStatus) => void;
  read: (id: string) => SavedQueryCachedResult | null;
  clear: () => void;
};

/** In-memory B′ map: last successful canvas Run while a saved query is selected. */
export function createSavedQueryResultCache(): SavedQueryResultCache {
  const entries = new Map<string, SavedQueryCachedResult>();

  return {
    write(id, compact, status) {
      if (status.kind !== "ok") return;
      entries.set(id, { compact, status });
    },
    read(id) {
      return entries.get(id) ?? null;
    },
    clear() {
      entries.clear();
    },
  };
}
