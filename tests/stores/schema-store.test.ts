import { describe, expect, it, vi } from "vitest";
import type { DragonIpc } from "../../src/ipc/contract";
import { createSchemaStore } from "../../src/stores/schema-store";

describe("schema-store", () => {
  it("loadTables started on connect path via generation-guarded listTables", async () => {
    const listTables = vi.fn(async () => [{ name: "users", schema: "public" }]);
    const ipc = { listTables } as unknown as DragonIpc;
    const store = createSchemaStore(ipc);
    await store.getState().loadTables("c-a");
    expect(listTables).toHaveBeenCalledWith("c-a");
    expect(store.getState().tables).toEqual([{ name: "users", schema: "public" }]);
  });

  it("switchSuccess path reloads schema for B", async () => {
    const listTables = vi
      .fn()
      .mockResolvedValueOnce([{ name: "a", schema: "public" }])
      .mockResolvedValueOnce([{ name: "b", schema: "public" }]);
    const ipc = { listTables } as unknown as DragonIpc;
    const store = createSchemaStore(ipc);
    await store.getState().loadTables("c-a");
    store.getState().clear();
    await store.getState().loadTables("c-b");
    expect(listTables).toHaveBeenLastCalledWith("c-b");
    expect(store.getState().tables).toEqual([{ name: "b", schema: "public" }]);
  });

  it("late listTables after clear/disconnect is ignored", async () => {
    let resolveLate!: (rows: { name: string; schema: string }[]) => void;
    const listTables = vi.fn(
      () =>
        new Promise<{ name: string; schema: string }[]>((resolve) => {
          resolveLate = resolve;
        }),
    );
    const ipc = { listTables } as unknown as DragonIpc;
    const store = createSchemaStore(ipc);
    const pending = store.getState().loadTables("c-old");
    store.getState().clear();
    resolveLate([{ name: "stale", schema: "public" }]);
    await pending;
    expect(store.getState().tables).toEqual([]);
  });
});
