import { createStore, type StoreApi } from "zustand/vanilla";
import type { ConnectionId, ConnectResult, DragonIpc, ProfileId } from "../ipc/contract";

export type SessionState = {
  isConnected: boolean;
  connectionId: ConnectionId | null;
  profileId: ProfileId | null;
  connect: (profileId: ProfileId) => Promise<ConnectResult>;
  disconnect: () => Promise<void>;
  /** Disconnect then connect to `profileId` (SP-2 switch success path). */
  switchSuccess: (profileId: ProfileId) => Promise<void>;
  /** Teardown then connect; connect failure leaves disconnected (SP-2 switch fail). */
  switchFailAfterTeardown: (profileId: ProfileId) => Promise<void>;
};

export type SessionStoreOptions = {
  onConnected?: (result: ConnectResult) => void | Promise<void>;
  onDisconnected?: () => void | Promise<void>;
};

/**
 * Session store mirroring SP-2 connect / disconnect / switch.
 * Generation-guarded so an older in-flight connect cannot overwrite a newer one.
 * Compose with schema via callbacks (not App.tsx).
 */
export function createSessionStore(
  ipc: DragonIpc,
  options: SessionStoreOptions = {},
): StoreApi<SessionState> {
  let connectGeneration = 0;
  /** Last `connect()` start generation — not bumped by `disconnect()` alone. */
  let lastConnectAttempt = 0;

  const store = createStore<SessionState>((set, get) => ({
    isConnected: false,
    connectionId: null,
    profileId: null,

    async connect(profileId) {
      const generation = ++connectGeneration;
      lastConnectAttempt = generation;
      try {
        const result = await ipc.connectProfile(profileId);
        if (generation !== connectGeneration) {
          // Own attempt still latest connect() start → tear down orphaned Rust session.
          // A newer connect() start owns teardown via its connectProfile; skip disconnect.
          if (lastConnectAttempt === generation) {
            try {
              await ipc.disconnect();
            } catch {
              /* best-effort teardown */
            }
          }
          throw { kind: "unknown", message: "cancelled" };
        }
        set({
          isConnected: true,
          connectionId: result.connectionId,
          profileId: result.profileId,
        });
        await options.onConnected?.(result);
        return result;
      } catch (error) {
        if (generation === connectGeneration) {
          set({
            isConnected: false,
            connectionId: null,
            profileId: null,
          });
        }
        throw error;
      }
    },

    async disconnect() {
      connectGeneration += 1;
      await ipc.disconnect();
      set({
        isConnected: false,
        connectionId: null,
        profileId: null,
      });
      await options.onDisconnected?.();
    },

    async switchSuccess(profileId) {
      await get().disconnect();
      await get().connect(profileId);
    },

    async switchFailAfterTeardown(profileId) {
      await get().disconnect();
      await get().connect(profileId);
    },
  }));

  return store;
}
