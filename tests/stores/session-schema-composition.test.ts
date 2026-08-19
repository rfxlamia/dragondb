import { describe, expect, it, vi } from "vitest";
import type { DragonIpc, IpcError } from "../../src/ipc/contract";
import { createSchemaStore } from "../../src/stores/schema-store";
import { createSessionStore } from "../../src/stores/session-store";

describe("session↔schema composition", () => {
  it("onConnected loads tables; disconnect and switch-fail clear schema", async () => {
    const err: IpcError = { kind: "auth", message: "B failed" };
    const listTables = vi.fn(async () => [{ name: "users", schema: "public" }]);
    const connectProfile = vi
      .fn()
      .mockResolvedValueOnce({ connectionId: "c1", profileId: "P", database: "app" })
      .mockRejectedValueOnce(err);
    const ipc = {
      connectProfile,
      disconnect: vi.fn(async () => undefined),
      listTables,
    } as unknown as DragonIpc;

    const schema = createSchemaStore(ipc);
    const session = createSessionStore(ipc, {
      onConnected: ({ connectionId }) => schema.getState().loadTables(connectionId),
      onDisconnected: () => {
        schema.getState().clear();
      },
    });

    await session.getState().connect("P");
    expect(listTables).toHaveBeenCalledWith("c1");
    expect(schema.getState().tables).toEqual([{ name: "users", schema: "public" }]);

    await session.getState().disconnect();
    expect(schema.getState().tables).toEqual([]);

    // switch-fail path: teardown calls onDisconnected which must clear schema
    schema.setState({ tables: [{ name: "stale", schema: "public", tableType: "regular" }] });
    await expect(session.getState().switchFailAfterTeardown("B")).rejects.toEqual(err);
    expect(schema.getState().tables).toEqual([]);
  });
});
