/**
 * Thin orchestrator — constructs session + schema + tabs and wires disconnect
 * clear / connect loadTables. No library/history. No React / UI imports.
 */
import type { StoreApi } from "zustand/vanilla";
import type { DragonIpc, ProfileId } from "../ipc/contract";
import { createSchemaStore, type SchemaState } from "./schema-store";
import { createSessionStore, type SessionState } from "./session-store";
import { createTabsStore, type TabsState } from "./tabs-store";

export type AppStores = {
  session: StoreApi<SessionState>;
  schema: StoreApi<SchemaState>;
  tabs: StoreApi<TabsState>;
  noteCanvasDisconnect: (profileId: ProfileId | null) => void;
  /** Returns true if canvas should remount empty for this connect (different profile after disconnect). */
  shouldRemountCanvasOnConnect: (profileId: ProfileId) => boolean;
  /** Call after canvas remount decision — clears snapshot. */
  acknowledgeConnect: (profileId: ProfileId) => void;
  bumpCanvasEpoch: () => number;
  getCanvasEpoch: () => number;
  /** Subscribe for React `useSyncExternalStore(subscribeCanvasEpoch, getCanvasEpoch)`. */
  subscribeCanvasEpoch: (onStoreChange: () => void) => () => void;
};

export function composeAppStores(ipc: DragonIpc): AppStores {
  const schema = createSchemaStore(ipc);

  let tabs!: StoreApi<TabsState>;
  let snapshotProfileId: ProfileId | null = null;
  let canvasEpoch = 0;
  const canvasEpochListeners = new Set<() => void>();

  const session = createSessionStore(ipc, {
    onConnected: ({ connectionId }) => schema.getState().loadTables(connectionId),
    onDisconnected: () => {
      schema.getState().clear();
      tabs.getState().clearInMemoryResults();
    },
  });

  tabs = createTabsStore(ipc, {
    getConnectionId: () => session.getState().connectionId,
    getDatabaseName: () => null,
  });

  function noteCanvasDisconnect(profileId: ProfileId | null): void {
    snapshotProfileId = profileId;
  }

  function shouldRemountCanvasOnConnect(profileId: ProfileId): boolean {
    return snapshotProfileId !== null && snapshotProfileId !== profileId;
  }

  function acknowledgeConnect(_profileId: ProfileId): void {
    snapshotProfileId = null;
  }

  function bumpCanvasEpoch(): number {
    canvasEpoch += 1;
    for (const listener of canvasEpochListeners) {
      listener();
    }
    return canvasEpoch;
  }

  function getCanvasEpoch(): number {
    return canvasEpoch;
  }

  function subscribeCanvasEpoch(onStoreChange: () => void): () => void {
    canvasEpochListeners.add(onStoreChange);
    return () => {
      canvasEpochListeners.delete(onStoreChange);
    };
  }

  return {
    session,
    schema,
    tabs,
    noteCanvasDisconnect,
    shouldRemountCanvasOnConnect,
    acknowledgeConnect,
    bumpCanvasEpoch,
    getCanvasEpoch,
    subscribeCanvasEpoch,
  };
}
