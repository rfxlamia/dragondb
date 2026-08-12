import { describe, expect, it, vi } from "vitest";
import type { DragonIpc } from "../../src/ipc/contract";
import { createStoreApi } from "../../src/stores/create-store-api";
import type { StoreApiBase } from "../../src/stores/types";

describe("createStoreApi", () => {
  it("holds injectable DragonIpc reachable via getState without React Provider", () => {
    const mockIpc = {
      listProfiles: vi.fn(async () => []),
    } as unknown as DragonIpc;

    const api: StoreApiBase = createStoreApi(mockIpc);
    expect(api.getState().ipc).toBe(mockIpc);
    expect(api.getState().ipc.listProfiles).toBe(mockIpc.listProfiles);
  });
});
