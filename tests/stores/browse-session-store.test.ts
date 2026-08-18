import { describe, expect, it } from "vitest";
import {
  browseSessionSnapshot,
  createBrowseSessionStore,
} from "../../src/stores/browse-session-store";

const orders = {
  tabId: "t1",
  connectionId: "c1",
  database: "shop",
  table: { schema: "public", name: "orders", tableType: "regular" as const },
};

describe("browse-session-store contract", () => {
  it("starts idle with a stable serializable generation", () => {
    const store = createBrowseSessionStore();
    const before = browseSessionSnapshot(store.getState());
    const after = browseSessionSnapshot(store.getState());
    expect(before).toEqual({
      identity: null,
      page: 0,
      hasNext: false,
      lifecycle: { phase: "idle" },
      generation: 0,
    });
    expect(after).toEqual(before);
    expect(() => structuredClone(before)).not.toThrow();
    expect(JSON.stringify(before)).not.toMatch(/timeout|promise|react/i);
  });

  it("establishes exact identity and rejects an old-generation transition", () => {
    const store = createBrowseSessionStore();
    store.getState().startBrowse(orders);
    const oldGeneration = store.getState().generation;
    expect(store.getState()).toMatchObject({ identity: orders, page: 0 });

    store.getState().selectPage(2);
    store.getState().invalidate();
    expect(store.getState()).toMatchObject({
      identity: null,
      page: 0,
      hasNext: false,
      lifecycle: { phase: "idle" },
      generation: oldGeneration + 1,
    });
    expect(
      store.getState().publish(oldGeneration, {
        lifecycle: { phase: "ready" },
        page: 2,
        hasNext: true,
      }),
    ).toBe(false);
    expect(store.getState().page).toBe(0);
  });

  it("a new startBrowse after invalidate uses the bumped generation", () => {
    const store = createBrowseSessionStore();
    store.getState().startBrowse(orders);
    const first = store.getState().generation;
    store.getState().invalidate();
    store.getState().startBrowse({ ...orders, database: "analytics" });
    expect(store.getState().generation).toBe(first + 1);
    expect(store.getState().identity?.database).toBe("analytics");
    expect(
      store.getState().publish(first, { lifecycle: { phase: "ready" }, page: 0, hasNext: false }),
    ).toBe(false);
    expect(store.getState().identity?.database).toBe("analytics");
  });

  it("keeps a 20-page LRU and rejects stale cache writes", () => {
    const store = createBrowseSessionStore();
    store.getState().startBrowse(orders);
    const generation = store.getState().generation;
    for (let page = 0; page < 21; page += 1) {
      store.getState().writePage(generation, page, {
        columns: ["id"],
        rows: [[page]],
        durationMs: 1,
        hasNext: page < 20,
      });
    }
    expect(store.getState().readPage(0)).toBeNull();
    expect(store.getState().readPage(20)?.rows).toEqual([[20]]);
    expect(store.getState().cacheSize()).toBe(20);

    store.getState().invalidate();
    expect(
      store.getState().writePage(generation, 9, {
        columns: ["id"],
        rows: [[9]],
        durationMs: 1,
        hasNext: false,
      }),
    ).toBe(false);
    expect(store.getState().cacheSize()).toBe(0);
  });
});
