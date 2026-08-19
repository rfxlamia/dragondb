/**
 * Proof tests: table-admin IPC must include connectionId for Rust deserialization.
 * These fail until tauri-client.ts passes connectionId (see commands.rs signatures).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import { createTauriDragonIpc } from "../../src/ipc/tauri-client";

describe("table-admin IPC connectionId contract (Rust requires connectionId)", () => {
  const connectionId = "c-uuid";
  const table = { schema: "public", name: "temp", tableType: "regular" as const };

  beforeEach(() => {
    invoke.mockReset();
  });

  it("truncateTable invoke payload must include connectionId", async () => {
    const ipc = createTauriDragonIpc();
    invoke.mockResolvedValueOnce(undefined);
    await ipc.truncateTable(connectionId, table);
    expect(invoke).toHaveBeenCalledWith("truncate_table", { connectionId, table });
  });

  it("dropTable invoke payload must include connectionId", async () => {
    const ipc = createTauriDragonIpc();
    invoke.mockResolvedValueOnce(undefined);
    await ipc.dropTable(connectionId, table);
    expect(invoke).toHaveBeenCalledWith("drop_table", { connectionId, table });
  });

  it("generateTableDdl invoke payload must include connectionId", async () => {
    const ipc = createTauriDragonIpc();
    invoke.mockResolvedValueOnce("CREATE TABLE public.temp ();");
    await ipc.generateTableDdl(connectionId, table);
    expect(invoke).toHaveBeenCalledWith("generate_table_ddl", { connectionId, table });
  });

  it("setSearchPath invoke payload must include connectionId", async () => {
    const ipc = createTauriDragonIpc();
    invoke.mockResolvedValueOnce(undefined);
    await ipc.setSearchPath(connectionId, "audit");
    expect(invoke).toHaveBeenCalledWith("set_search_path", {
      connectionId,
      schema: "audit",
    });
  });
});
