/**
 * Tiny shared `{ ipc }` holder for smoke/tests.
 *
 * Domain stores (T2–T5) use `createXStore(ipc: DragonIpc)` directly with
 * `zustand/vanilla` — they inject ipc via constructor, not via reading a
 * global `createStoreApi` singleton. `createStoreApi` is NOT a required
 * runtime dependency for domain stores.
 */
import { createStore } from "zustand/vanilla";
import type { DragonIpc } from "../ipc/contract";
import type { StoreApiBase } from "./types";

export function createStoreApi(ipc: DragonIpc): StoreApiBase {
  return createStore<{ ipc: DragonIpc }>(() => ({ ipc }));
}
