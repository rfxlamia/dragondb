import { describe, expect, it, vi } from "vitest";
import type { DragonIpc, IpcError } from "../../src/ipc/contract";
import { createSessionStore } from "../../src/stores/session-store";

describe("session-store", () => {
  it("connect success sets isConnected + ids", async () => {
    const connectProfile = vi.fn(async () => ({ connectionId: "c-a", profileId: "P" }));
    const ipc = { connectProfile, disconnect: vi.fn() } as unknown as DragonIpc;
    const onConnected = vi.fn();
    const store = createSessionStore(ipc, { onConnected });
    await store.getState().connect("P");
    expect(store.getState()).toMatchObject({
      isConnected: true,
      connectionId: "c-a",
      profileId: "P",
    });
    expect(onConnected).toHaveBeenCalledWith({ connectionId: "c-a", profileId: "P" });
  });

  it("connect auth fail stays disconnected with no connectionId", async () => {
    const err: IpcError = { kind: "auth", message: "Authentication failed" };
    const connectProfile = vi.fn(async () => {
      throw err;
    });
    const ipc = { connectProfile } as unknown as DragonIpc;
    const store = createSessionStore(ipc, { onConnected: vi.fn() });
    await expect(store.getState().connect("P")).rejects.toEqual(err);
    expect(store.getState()).toMatchObject({
      isConnected: false,
      connectionId: null,
      profileId: null,
    });
  });

  it("superseded older fail must not clear newer success", async () => {
    let resolveA!: (v: { connectionId: string; profileId: string }) => void;
    let rejectA!: (e: IpcError) => void;
    const connectProfile = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            resolveA = resolve;
            rejectA = reject;
          }),
      )
      .mockResolvedValueOnce({ connectionId: "c-b", profileId: "B" });
    const ipc = { connectProfile } as unknown as DragonIpc;
    const store = createSessionStore(ipc, { onConnected: vi.fn() });
    const pA = store.getState().connect("A");
    const pB = store.getState().connect("B");
    await pB;
    rejectA({ kind: "unknown", message: "cancelled" });
    await expect(pA).rejects.toMatchObject({ message: "cancelled" });
    expect(store.getState()).toMatchObject({
      isConnected: true,
      connectionId: "c-b",
      profileId: "B",
    });
    void resolveA;
  });

  it("disconnect clears session", async () => {
    const disconnect = vi.fn(async () => undefined);
    const ipc = {
      connectProfile: vi.fn(async () => ({ connectionId: "c1", profileId: "P" })),
      disconnect,
    } as unknown as DragonIpc;
    const onDisconnected = vi.fn();
    const store = createSessionStore(ipc, { onConnected: vi.fn(), onDisconnected });
    await store.getState().connect("P");
    await store.getState().disconnect();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(store.getState()).toMatchObject({
      isConnected: false,
      connectionId: null,
      profileId: null,
    });
    expect(onDisconnected).toHaveBeenCalledOnce();
  });

  it("switchSuccess(profile B) reflects B connected", async () => {
    const ipc = {
      connectProfile: vi.fn(async (id: string) => ({
        connectionId: id === "B" ? "c-b" : "c-a",
        profileId: id,
      })),
      disconnect: vi.fn(async () => undefined),
    } as unknown as DragonIpc;
    const store = createSessionStore(ipc, { onConnected: vi.fn() });
    await store.getState().connect("A");
    await store.getState().switchSuccess("B");
    expect(store.getState()).toMatchObject({
      isConnected: true,
      connectionId: "c-b",
      profileId: "B",
    });
  });

  it("switchFailAfterTeardown leaves disconnected", async () => {
    const err: IpcError = { kind: "auth", message: "B failed" };
    const connectProfile = vi
      .fn()
      .mockResolvedValueOnce({ connectionId: "c-a", profileId: "A" })
      .mockRejectedValueOnce(err);
    const disconnect = vi.fn(async () => undefined);
    const ipc = { connectProfile, disconnect } as unknown as DragonIpc;
    const store = createSessionStore(ipc, { onConnected: vi.fn() });
    await store.getState().connect("A");
    await expect(store.getState().switchFailAfterTeardown("B")).rejects.toEqual(err);
    expect(store.getState()).toMatchObject({
      isConnected: false,
      connectionId: null,
      profileId: null,
    });
  });
});
