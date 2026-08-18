import { createStore, type StoreApi } from "zustand/vanilla";

export type BrowseIdentity = {
  tabId: string;
  connectionId: string;
  database: string;
  table: { schema: string; name: string; tableType: "regular" };
};

export type BrowseLifecycle = { phase: "idle" } | { phase: "ready" };

export type BrowseGeneration = number;

export type BrowsePublishPatch = {
  lifecycle?: BrowseLifecycle;
  page?: number;
  hasNext?: boolean;
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
  publish: (generation: BrowseGeneration, patch: BrowsePublishPatch) => boolean;
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

/**
 * Ephemeral browse identity / page / lifecycle store.
 * Does not own rendered tab results — those stay on tabs-store.
 */
export function createBrowseSessionStore(): StoreApi<BrowseSessionState> {
  return createStore<BrowseSessionState>((set, get) => ({
    ...initialObservable(),

    startBrowse(identity) {
      set({
        identity,
        page: 0,
        hasNext: false,
        lifecycle: IDLE,
      });
    },

    selectPage(page) {
      set({ page });
    },

    invalidate() {
      set({
        identity: null,
        page: 0,
        hasNext: false,
        lifecycle: IDLE,
        generation: get().generation + 1,
      });
    },

    publish(generation, patch) {
      if (generation !== get().generation) return false;
      set(patch);
      return true;
    },
  }));
}
