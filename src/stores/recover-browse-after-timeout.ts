import type { ConnectionId, DragonIpc, ProfileId, QueryResult, TableRef } from "../ipc/contract";
import { unknownErrorMessage } from "../lib/unknown-error-message";
import {
  BROWSE_VISIBLE_PAGE_SIZE,
  type BrowseIdentity,
  type BrowseLifecycle,
  type BrowseRetryTarget,
  browseRetryOf,
} from "./browse-session-store";
import type { AppStores } from "./compose-app-stores";

export const BROWSE_TIMEOUT_MS = 300_000;
export const BROWSE_CANCEL_WAIT_MS = 12_000;

const BROWSE_CANCEL_STUCK_MESSAGE = "Cancellation did not finish. Reconnect, then try again.";
const BROWSE_CANCEL_FAILED_MESSAGE = "Couldn't cancel this request. Reconnect, then try again.";
const RECONNECT_FAILED_MESSAGE = "Couldn't reconnect. Check the connection, then try again.";

export class BrowseTimeoutError extends Error {
  constructor() {
    super("Browse timed out");
    this.name = "BrowseTimeoutError";
  }
}

/** Single owner for timeout / cancel-wait handles; always cleared in finally. */
export function createTimerHandles() {
  const handles: ReturnType<typeof setTimeout>[] = [];
  return {
    arm(ms: number, callback: () => void): void {
      handles.push(setTimeout(callback, ms));
    },
    clearAll(): void {
      for (const handle of handles) clearTimeout(handle);
      handles.length = 0;
    },
  };
}

/** Single owner for the first terminal event at a concurrency boundary. */
export function createFirstSettlement<T extends string>() {
  let winner: T | null = null;
  return {
    tryWin(candidate: T): boolean {
      if (winner !== null) return false;
      winner = candidate;
      return true;
    },
  };
}

export type TimerHandles = ReturnType<typeof createTimerHandles>;
export type Settlement<T extends string> = ReturnType<typeof createFirstSettlement<T>>;

type BrowseRaceOutcome =
  | { kind: "query"; result: QueryResult }
  | { kind: "query-error"; error: unknown }
  | { kind: "timeout" };

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function quotedBrowseTableSql(table: TableRef): string {
  const name = quoteIdentifier(table.name);
  return table.schema ? `${quoteIdentifier(table.schema)}.${name}` : name;
}

function retryTargetFor(identity: BrowseIdentity, page: number): BrowseRetryTarget {
  return { ...identity, page };
}

export function raceBrowseQuery(
  ipc: DragonIpc,
  connectionId: ConnectionId,
  table: TableRef,
  page: number,
  runId: number,
  timers: TimerHandles,
  settlement: Settlement<"query" | "timeout">,
): Promise<BrowseRaceOutcome> {
  return new Promise((resolve) => {
    void ipc
      .runQuery(
        connectionId,
        {
          text: `SELECT * FROM ${quotedBrowseTableSql(table)} LIMIT ${BROWSE_VISIBLE_PAGE_SIZE + 1} OFFSET ${page * BROWSE_VISIBLE_PAGE_SIZE}`,
          params: [],
        },
        runId,
      )
      .then(
        (result) => {
          if (!settlement.tryWin("query")) return;
          resolve({ kind: "query", result });
        },
        (error: unknown) => {
          if (!settlement.tryWin("query")) return;
          resolve({ kind: "query-error", error });
        },
      );
    timers.arm(BROWSE_TIMEOUT_MS, () => {
      if (!settlement.tryWin("timeout")) return;
      resolve({ kind: "timeout" });
    });
  });
}

export async function waitForBrowseCancellation(
  ipc: DragonIpc,
  connectionId: ConnectionId,
  runId: number,
  stores: AppStores,
  retry: BrowseRetryTarget,
  timers: TimerHandles,
): Promise<void> {
  const cancelWait = createFirstSettlement<"cancel" | "stuck">();
  await new Promise<void>((resolve) => {
    const finish = (phase: "retryReady" | "reconnectRequired", error: string | null) => {
      const generation = stores.browse.getState().generation;
      stores.browse.getState().publish(generation, {
        lifecycle: { phase, retry, error },
      });
      resolve();
    };
    timers.arm(BROWSE_CANCEL_WAIT_MS, () => {
      if (!cancelWait.tryWin("stuck")) return;
      finish("reconnectRequired", BROWSE_CANCEL_STUCK_MESSAGE);
    });
    void ipc.cancelQuery(connectionId, runId).then(
      () => {
        if (!cancelWait.tryWin("cancel")) return;
        finish("retryReady", null);
      },
      (error: unknown) => {
        if (!cancelWait.tryWin("cancel")) return;
        finish("reconnectRequired", unknownErrorMessage(error, BROWSE_CANCEL_FAILED_MESSAGE));
      },
    );
  });
}

export async function settleBrowseTimeout(
  stores: AppStores,
  ipc: DragonIpc,
  identity: BrowseIdentity,
  page: number,
  runId: number,
  timers: TimerHandles,
): Promise<never> {
  stores.browse.getState().invalidateCache();
  const retry = retryTargetFor(identity, page);
  const generation = stores.browse.getState().generation;
  stores.browse.getState().publish(generation, {
    lifecycle: { phase: "cancelling", retry, error: null },
  });
  await waitForBrowseCancellation(ipc, identity.connectionId, runId, stores, retry, timers);
  throw new BrowseTimeoutError();
}

let reconnectInFlight: Promise<void> | null = null;

function reconnectRequired(
  retry: BrowseRetryTarget | undefined,
  error: string | null,
  busy = false,
): BrowseLifecycle {
  return { phase: "reconnectRequired", retry, error, busy };
}

/**
 * Single owner for explicit reconnect after a stuck/failed browse cancel.
 * Uses the composed session graph (disconnect then connect); never auto-retries browse.
 */
export function recoverBrowseAfterTimeout(stores: AppStores, profileId: ProfileId): Promise<void> {
  if (reconnectInFlight !== null) return reconnectInFlight;
  reconnectInFlight = (async () => {
    const retry = browseRetryOf(stores.browse.getState().lifecycle);
    const generationAtStart = stores.browse.getState().generation;
    stores.browse.getState().publish(generationAtStart, {
      lifecycle: reconnectRequired(retry, null, true),
    });
    try {
      await stores.session.getState().disconnect();
      await stores.session.getState().connect(profileId);
      const generation = stores.browse.getState().generation;
      stores.browse.getState().publish(generation, {
        lifecycle: { phase: "retryReady", retry, error: null },
      });
    } catch (error) {
      const generation = stores.browse.getState().generation;
      stores.browse.getState().publish(generation, {
        lifecycle: reconnectRequired(retry, unknownErrorMessage(error, RECONNECT_FAILED_MESSAGE)),
      });
      throw error;
    }
  })().finally(() => {
    reconnectInFlight = null;
  });
  return reconnectInFlight;
}
