import { describe, expect, it, vi } from "vitest";
import type { ColumnInfo, DragonIpc } from "../../src/ipc/contract";
import { createSchemaStore, TABLES_LOAD_FAILED } from "../../src/stores/schema-store";

function column(name: string): ColumnInfo {
  return {
    name,
    dataType: "text",
    isNullable: true,
    defaultValue: null,
    isPrimaryKey: false,
    isUnique: false,
    isForeignKey: false,
  };
}

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

  it("loadColumns success sets columnNames from listColumns", async () => {
    const listColumns = vi.fn(async () => [column("id"), column("email")]);
    const ipc = { listTables: vi.fn(), listColumns } as unknown as DragonIpc;
    const store = createSchemaStore(ipc);
    await store
      .getState()
      .loadColumns("c-a", { name: "users", schema: "public", tableType: "regular" });
    expect(listColumns).toHaveBeenCalledWith("c-a", {
      name: "users",
      schema: "public",
      tableType: "regular",
    });
    expect(store.getState().columnNames).toEqual(["id", "email"]);
    expect(store.getState().metadataErrorMessage).toBeNull();
  });

  it("late loadColumns success after clear() ignored", async () => {
    let resolveLate!: (rows: ColumnInfo[]) => void;
    const listColumns = vi.fn(
      () =>
        new Promise<ColumnInfo[]>((resolve) => {
          resolveLate = resolve;
        }),
    );
    const ipc = { listTables: vi.fn(), listColumns } as unknown as DragonIpc;
    const store = createSchemaStore(ipc);
    const pending = store.getState().loadColumns("c-old", { name: "users", tableType: "regular" });
    store.getState().clear();
    resolveLate([column("stale")]);
    await pending;
    expect(store.getState().columnNames).toEqual([]);
  });

  it("late loadColumns rejection after clear() does not set metadataErrorMessage", async () => {
    let rejectLate!: (error: Error) => void;
    const listColumns = vi.fn(
      () =>
        new Promise<never>((_resolve, reject) => {
          rejectLate = reject;
        }),
    );
    const ipc = { listTables: vi.fn(), listColumns } as unknown as DragonIpc;
    const store = createSchemaStore(ipc);
    const pending = store.getState().loadColumns("c-old", { name: "users", tableType: "regular" });
    store.getState().clear();
    rejectLate(new Error("gone"));
    await pending;
    expect(store.getState().metadataErrorMessage).toBeNull();
    expect(store.getState().columnNames).toEqual([]);
  });

  it("live loadColumns failure sets metadataErrorMessage columns_load_failed and empty columnNames", async () => {
    const listColumns = vi.fn(async () => {
      throw new Error("boom");
    });
    const ipc = { listTables: vi.fn(), listColumns } as unknown as DragonIpc;
    const store = createSchemaStore(ipc);
    await store.getState().loadColumns("c-a", { name: "users", tableType: "regular" });
    expect(store.getState().columnNames).toEqual([]);
    expect(store.getState().metadataErrorMessage).toBe("columns_load_failed");
  });

  it("clearColumns bumps generation and clears columns+error without clearing tables", async () => {
    const listTables = vi.fn(async () => [{ name: "users", schema: "public" }]);
    let resolveLate!: (rows: ColumnInfo[]) => void;
    const listColumns = vi
      .fn()
      .mockResolvedValueOnce([column("id")])
      .mockRejectedValueOnce(new Error("boom"))
      .mockImplementationOnce(
        () =>
          new Promise<ColumnInfo[]>((resolve) => {
            resolveLate = resolve;
          }),
      );
    const ipc = { listTables, listColumns } as unknown as DragonIpc;
    const store = createSchemaStore(ipc);
    await store.getState().loadTables("c-a");
    await store.getState().loadColumns("c-a", { name: "users", tableType: "regular" });
    expect(store.getState().columnNames).toEqual(["id"]);
    await store.getState().loadColumns("c-a", { name: "users", tableType: "regular" });
    expect(store.getState().metadataErrorMessage).toBe("columns_load_failed");

    const pending = store.getState().loadColumns("c-a", { name: "users", tableType: "regular" });
    store.getState().clearColumns();
    expect(store.getState().columnNames).toEqual([]);
    expect(store.getState().metadataErrorMessage).toBeNull();
    expect(store.getState().tables).toEqual([{ name: "users", schema: "public" }]);
    resolveLate([column("stale")]);
    await pending;
    expect(store.getState().columnNames).toEqual([]);
    expect(store.getState().tables).toEqual([{ name: "users", schema: "public" }]);
  });

  it("loadTables failure then success clears tables_load_failed", async () => {
    const listTables = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce([{ name: "users", schema: "public" }]);
    const ipc = { listTables, listColumns: vi.fn() } as unknown as DragonIpc;
    const store = createSchemaStore(ipc);
    await store.getState().loadTables("c-a");
    expect(store.getState().tables).toEqual([]);
    expect(store.getState().metadataErrorMessage).toBe(TABLES_LOAD_FAILED);
    await store.getState().loadTables("c-a");
    expect(store.getState().tables).toEqual([{ name: "users", schema: "public" }]);
    expect(store.getState().metadataErrorMessage).toBeNull();
  });

  it("loadTables sets tablesLoading true before IPC resolves and false after success", async () => {
    let resolveTables!: (rows: { name: string; schema: string }[]) => void;
    const listTables = vi.fn(
      () =>
        new Promise<{ name: string; schema: string }[]>((resolve) => {
          resolveTables = resolve;
        }),
    );
    const ipc = { listTables } as unknown as DragonIpc;
    const store = createSchemaStore(ipc);
    const pending = store.getState().loadTables("c-a");
    expect(store.getState().tablesLoading).toBe(true);
    resolveTables([{ name: "users", schema: "public" }]);
    await pending;
    expect(store.getState().tablesLoading).toBe(false);
    expect(store.getState().tables).toEqual([{ name: "users", schema: "public" }]);
  });

  it("loadTables reject sets tables_load_failed, tablesLoading false, and no stale names", async () => {
    let rejectTables!: (error: Error) => void;
    const listTables = vi.fn(
      () =>
        new Promise<never>((_resolve, reject) => {
          rejectTables = reject;
        }),
    );
    const ipc = { listTables } as unknown as DragonIpc;
    const store = createSchemaStore(ipc);
    const pending = store.getState().loadTables("c-a");
    expect(store.getState().tablesLoading).toBe(true);
    rejectTables(new Error("boom"));
    await pending;
    expect(store.getState().tablesLoading).toBe(false);
    expect(store.getState().tablesErrorMessage).toBe(TABLES_LOAD_FAILED);
    expect(store.getState().tables).toEqual([]);
  });

  it("clear cancels a pending table load and resets tablesLoading", async () => {
    let resolveTables!: (rows: { name: string; schema: string }[]) => void;
    const listTables = vi.fn(
      () =>
        new Promise<{ name: string; schema: string }[]>((resolve) => {
          resolveTables = resolve;
        }),
    );
    const ipc = { listTables } as unknown as DragonIpc;
    const store = createSchemaStore(ipc);
    const pending = store.getState().loadTables("c-a");
    expect(store.getState().tablesLoading).toBe(true);
    store.getState().clear();
    expect(store.getState().tablesLoading).toBe(false);
    resolveTables([{ name: "stale", schema: "public" }]);
    await pending;
    expect(store.getState().tables).toEqual([]);
  });

  it("keeps a columns failure out of the tables error channel", async () => {
    const ipc = {
      listColumns: vi.fn(async () => {
        throw new Error("columns boom");
      }),
    } as unknown as DragonIpc;
    const store = createSchemaStore(ipc);
    await store
      .getState()
      .loadColumns("c-a", { schema: "public", name: "users", tableType: "regular" });
    expect(store.getState().columnsErrorMessage).toBe("columns_load_failed");
    expect(store.getState().tablesErrorMessage).toBeNull();
  });

  it("setSearchPath named schema vs All Schemas", async () => {
    const setSearchPath = vi.fn(async () => undefined);
    const listTables = vi.fn(async () => [{ name: "t", schema: "audit", tableType: "regular" }]);
    const ipc = { listTables, setSearchPath } as unknown as DragonIpc;
    const store = createSchemaStore(ipc);
    await store.getState().setSearchPath("c1", "audit");
    expect(setSearchPath).toHaveBeenCalledWith("c1", "audit");
    await store.getState().setSearchPath("c1", null);
    expect(setSearchPath).toHaveBeenCalledWith("c1", null);
  });

  it("loadColumns keeps columnNames and stores full ColumnInfo in columnsByTable keyed schema.name", async () => {
    const id = {
      name: "id",
      dataType: "integer",
      isNullable: false,
      defaultValue: null,
      isPrimaryKey: true,
      isUnique: true,
      isForeignKey: false,
    };
    const email = column("email");
    const listColumns = vi.fn(async () => [id, email]);
    const ipc = { listTables: vi.fn(), listColumns } as unknown as DragonIpc;
    const store = createSchemaStore(ipc);
    await store
      .getState()
      .loadColumns("c-a", { name: "users", schema: "public", tableType: "regular" });
    expect(store.getState().columnNames).toEqual(["id", "email"]);
    expect(store.getState().columnsByTable["public.users"]).toEqual([id, email]);
  });

  it("loadExpanderColumns does not overwrite canvas columnNames or metadataErrorMessage", async () => {
    const usersCols = [column("id"), column("email")];
    const eventsCols = [column("event_id")];
    const listColumns = vi.fn(async (_id: string, table: { name: string }) =>
      table.name === "users" ? usersCols : eventsCols,
    );
    const ipc = { listTables: vi.fn(), listColumns } as unknown as DragonIpc;
    const store = createSchemaStore(ipc);
    const users = { name: "users", schema: "public", tableType: "regular" as const };
    const events = { name: "events", schema: "analytics", tableType: "regular" as const };
    await store.getState().loadColumns("c-a", users);
    expect(store.getState().columnNames).toEqual(["id", "email"]);
    await store.getState().loadExpanderColumns("c-a", events);
    expect(store.getState().columnNames).toEqual(["id", "email"]);
    expect(store.getState().columnsByTable["analytics.events"]).toEqual(eventsCols);
    expect(store.getState().metadataErrorMessage).toBeNull();
  });

  it("two in-flight loadExpanderColumns both land", async () => {
    let resolveUsers!: (rows: ColumnInfo[]) => void;
    let resolveEvents!: (rows: ColumnInfo[]) => void;
    const listColumns = vi.fn((_id: string, table: { name: string }) => {
      if (table.name === "users") {
        return new Promise<ColumnInfo[]>((resolve) => {
          resolveUsers = resolve;
        });
      }
      return new Promise<ColumnInfo[]>((resolve) => {
        resolveEvents = resolve;
      });
    });
    const ipc = { listTables: vi.fn(), listColumns } as unknown as DragonIpc;
    const store = createSchemaStore(ipc);
    const users = { name: "users", schema: "public", tableType: "regular" as const };
    const events = { name: "events", schema: "analytics", tableType: "regular" as const };
    const pendingUsers = store.getState().loadExpanderColumns("c-a", users);
    const pendingEvents = store.getState().loadExpanderColumns("c-a", events);
    resolveUsers([column("id")]);
    resolveEvents([column("event_id")]);
    await Promise.all([pendingUsers, pendingEvents]);
    expect(store.getState().columnsByTable["public.users"]).toEqual([column("id")]);
    expect(store.getState().columnsByTable["analytics.events"]).toEqual([column("event_id")]);
    expect(store.getState().columnNames).toEqual([]);
  });

  it("loadExpanderColumns failure does not clear canvas columnNames", async () => {
    const listColumns = vi
      .fn()
      .mockResolvedValueOnce([column("id")])
      .mockRejectedValueOnce(new Error("columns boom"));
    const ipc = { listTables: vi.fn(), listColumns } as unknown as DragonIpc;
    const store = createSchemaStore(ipc);
    const users = { name: "users", schema: "public", tableType: "regular" as const };
    const events = { name: "events", schema: "analytics", tableType: "regular" as const };
    await store.getState().loadColumns("c-a", users);
    await store.getState().loadExpanderColumns("c-a", events);
    expect(store.getState().columnNames).toEqual(["id"]);
    expect(store.getState().columnsByTable["analytics.events"]).toBeUndefined();
    expect(store.getState().metadataErrorMessage).toBeNull();
  });

  it("clear, clearColumns, and reloadTables reset columnsByTable", async () => {
    const listTables = vi.fn(async () => [
      { name: "users", schema: "public", tableType: "regular" },
    ]);
    const listColumns = vi.fn(async () => [column("id")]);
    const ipc = { listTables, listColumns } as unknown as DragonIpc;
    const store = createSchemaStore(ipc);
    const table = { name: "users", schema: "public", tableType: "regular" as const };
    await store.getState().loadTables("c-a");
    await store.getState().loadColumns("c-a", table);
    expect(store.getState().columnsByTable["public.users"]).toHaveLength(1);

    store.getState().clearColumns();
    expect(store.getState().columnsByTable).toEqual({});
    expect(store.getState().columnNames).toEqual([]);

    await store.getState().loadColumns("c-a", table);
    await store.getState().reloadTables("c-a");
    expect(store.getState().columnsByTable).toEqual({});
    expect(store.getState().columnNames).toEqual([]);

    await store.getState().loadColumns("c-a", table);
    store.getState().clear();
    expect(store.getState().columnsByTable).toEqual({});
    expect(store.getState().columnNames).toEqual([]);
  });
});
