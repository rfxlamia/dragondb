import type { StoreApi } from "zustand/vanilla";
import type { DragonIpc } from "../ipc/contract";

/** Zustand vanilla store API holding an injectable DragonIpc. */
export type StoreApiBase = StoreApi<{ ipc: DragonIpc }>;
