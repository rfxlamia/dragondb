import { createStore, type StoreApi } from "zustand/vanilla";
import type { ConnectionId, TableRef } from "../ipc/contract";

export const BROWSE_PAGE_CACHE_LIMIT = 20;
export const BROWSE_VISIBLE_PAGE_SIZE = 100;

export type BrowseIdentity = {
  tabId: string;
  connectionId: ConnectionId;
  database: string;
  table: TableRef;
};

export type BrowseRetryTarget = BrowseIdentity & { page: number };

export type BrowseLifecycle =
  | { phase: "idle" }
  | { phase: "ready" }
  | { phase: "cancelling"; retry?: BrowseRetryTarget; error?: string | null }
  | { phase: "retryReady"; retry?: BrowseRetryTarget; error?: string | null }
  | {
      phase: "reconnectRequired";
      retry?: BrowseRetryTarget;
      error?: string | null;
      busy?: boolean;
    };

/** True while cancel or reconnect must finish before another browse may start. */
export function browseRetryBlocked(lifecycle: BrowseLifecycle): boolean {
  return lifecycle.phase === "cancelling" || lifecycle.phase === "reconnectRequired";
}

export function isBrowseTimeoutPhase(lifecycle: BrowseLifecycle): boolean {
  return (
    lifecycle.phase === "cancelling" ||
    lifecycle.phase === "retryReady" ||
    lifecycle.phase === "reconnectRequired"
  );
}

export function browseRetryOf(lifecycle: BrowseLifecycle): BrowseRetryTarget | undefined {
  if (lifecycle.phase === "idle" || lifecycle.phase === "ready") return undefined;
  return lifecycle.retry;
}

export type BrowseGeneration = number;

export type BrowsePublishPatch = {
  lifecycle?: BrowseLifecycle;
  page?: number;
  hasNext?: boolean;
};

export type BrowseCachedPage = {
  columns: string[];
  rows: unknown[][];
  durationMs: number;
  hasNext: boolean;
};

export type BrowseSessionState = {
  identity: BrowseIdentity | null;
  page: number;
  hasNext: boolean;
  lifecycle: BrowseLifecycle;
  generation: BrowseGeneration;
  startBrowse: (identity: BrowseIdentity) => void;
  selectPage: (page: number) => void;
  invalidate: () => void;
  invalidateCache: () => void;
  publish: (generation: BrowseGeneration, patch: BrowsePublishPatch) => boolean;
  readPage: (page: number) => BrowseCachedPage | null;
  writePage: (generation: BrowseGeneration, page: number, entry: BrowseCachedPage) => boolean;
  cacheSize: () => number;
  ownBrowsePageRequest: <T>(page: number, start: () => Promise<T>) => Promise<T>;
  /** Restore identity / hasNext / lifecycle for a tab without dropping other tabs' cache. */
  rebindToTab: (tabId: string, identity: BrowseIdentity | null, page: number) => void;
};

export type BrowseSessionSnapshot = {
  identity: BrowseIdentity | null;
  page: number;
  hasNext: boolean;
  lifecycle: BrowseLifecycle;
  generation: BrowseGeneration;
};

const IDLE: BrowseLifecycle = { phase: "idle" };

function initialObservable(): BrowseSessionSnapshot {
  return {
    identity: null,
    page: 0,
    hasNext: false,
    lifecycle: IDLE,
    generation: 0,
  };
}

export function browseSessionSnapshot(state: BrowseSessionState): BrowseSessionSnapshot {
  return {
    identity: state.identity,
    page: state.page,
    hasNext: state.hasNext,
    lifecycle: state.lifecycle,
    generation: state.generation,
  };
}

/** Current-identity cache key: live connection, database, schema, table, page. */
export function browsePageCacheKey(
  identity: Pick<BrowseIdentity, "connectionId" | "database" | "table">,
  page: number,
): string {
  return [
    identity.connectionId,
    identity.database,
    identity.table.schema ?? "",
    identity.table.name,
    String(page),
  ].join("\0");
}

export function browseIdentityMatches(
  current: BrowseIdentity | null,
  next: Pick<BrowseIdentity, "connectionId" | "database" | "table">,
): boolean {
  return (
    current !== null &&
    current.connectionId === next.connectionId &&
    current.database === next.database &&
    (current.table.schema ?? "") === (next.table.schema ?? "") &&
    current.table.name === next.table.name
  );
}

/** Deduplicate concurrent work for one cache key; the first caller owns the request. */
export function ownBrowsePageRequest<T>(
  inFlight: Map<string, Promise<unknown>>,
  key: string,
  start: () => Promise<T>,
): Promise<T> {
  const existing = inFlight.get(key);
  if (existing !== undefined) return existing as Promise<T>;
  const pending: Promise<T> = start().finally(() => {
    if (inFlight.get(key) === pending) inFlight.delete(key);
  });
  inFlight.set(key, pending);
  return pending;
}

function touchLru<V>(map: Map<string, V>, key: string, value: V): void {
  map.delete(key);
  map.set(key, value);
}

function evictLru<V>(map: Map<string, V>, limit: number): void {
  while (map.size > limit) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

/**
 * Ephemeral browse identity / page / lifecycle store.
 * Does not own rendered tab results — those stay on tabs-store.
 */
export function createBrowseSessionStore(): StoreApi<BrowseSessionState> {
  const pageCache = new Map<string, BrowseCachedPage>();
  const inFlight = new Map<string, Promise<unknown>>();
  const tabProjections = new Map<
    string,
    Pick<BrowseSessionSnapshot, "identity" | "page" | "hasNext" | "lifecycle">
  >();

  function clearCacheAndInFlight(): void {
    pageCache.clear();
    inFlight.clear();
  }

  function persistProjection(state: BrowseSessionState): void {
    if (state.identity === null) return;
    tabProjections.set(state.identity.tabId, {
      identity: state.identity,
      page: state.page,
      hasNext: state.hasNext,
      lifecycle: state.lifecycle,
    });
  }

  return createStore<BrowseSessionState>((set, get) => ({
    ...initialObservable(),

    startBrowse(identity) {
      persistProjection(get());
      clearCacheAndInFlight();
      set({
        identity,
        page: 0,
        hasNext: false,
        lifecycle: IDLE,
      });
      persistProjection(get());
    },

    selectPage(page) {
      set({ page });
      persistProjection(get());
    },

    invalidate() {
      clearCacheAndInFlight();
      tabProjections.clear();
      set({
        identity: null,
        page: 0,
        hasNext: false,
        lifecycle: IDLE,
        generation: get().generation + 1,
      });
    },

    invalidateCache() {
      clearCacheAndInFlight();
      set({
        hasNext: false,
        generation: get().generation + 1,
      });
      persistProjection(get());
    },

    publish(generation, patch) {
      if (generation !== get().generation) return false;
      set(patch);
      persistProjection(get());
      return true;
    },

    readPage(page) {
      const identity = get().identity;
      if (identity === null) return null;
      const key = browsePageCacheKey(identity, page);
      const entry = pageCache.get(key);
      if (entry === undefined) return null;
      touchLru(pageCache, key, entry);
      return entry;
    },

    writePage(generation, page, entry) {
      if (generation !== get().generation) return false;
      const identity = get().identity;
      if (identity === null) return false;
      const key = browsePageCacheKey(identity, page);
      const stored: BrowseCachedPage = {
        columns: [...entry.columns],
        rows: entry.rows.slice(0, BROWSE_VISIBLE_PAGE_SIZE),
        durationMs: entry.durationMs,
        hasNext: entry.hasNext,
      };
      touchLru(pageCache, key, stored);
      evictLru(pageCache, BROWSE_PAGE_CACHE_LIMIT);
      if (get().page === page) {
        set({ hasNext: entry.hasNext });
      }
      persistProjection(get());
      return true;
    },

    cacheSize() {
      return pageCache.size;
    },

    ownBrowsePageRequest(page, start) {
      const identity = get().identity;
      if (identity === null) return start();
      const key = browsePageCacheKey(identity, page);
      return ownBrowsePageRequest(inFlight, key, start);
    },

    rebindToTab(tabId, identity, page) {
      persistProjection(get());
      const generation = get().generation + 1;
      const saved = tabProjections.get(tabId);
      if (saved !== undefined) {
        set({
          identity: saved.identity,
          page: saved.page,
          hasNext: saved.hasNext,
          lifecycle: saved.lifecycle,
          generation,
        });
        return;
      }
      set({
        identity,
        page,
        hasNext: false,
        lifecycle: IDLE,
        generation,
      });
    },
  }));
}
