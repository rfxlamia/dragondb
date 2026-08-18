import type { ConnectionId, DragonIpc, QueryResult, TableRef } from "../ipc/contract";
import { QUERY_FAILED_MESSAGE, unknownErrorMessage } from "../lib/unknown-error-message";
import {
  BROWSE_VISIBLE_PAGE_SIZE,
  type BrowseCachedPage,
  type BrowseIdentity,
  type BrowseRetryTarget,
  browseIdentityMatches,
  browseRetryBlocked,
} from "./browse-session-store";
import type { AppStores } from "./compose-app-stores";

export const PAGE_SIZE = BROWSE_VISIBLE_PAGE_SIZE;
export const BROWSE_TIMEOUT_MS = 300_000;
export const BROWSE_CANCEL_WAIT_MS = 12_000;

const BROWSE_CANCEL_STUCK_MESSAGE = "Cancellation did not finish. Reconnect, then try again.";
const BROWSE_CANCEL_FAILED_MESSAGE = "Couldn't cancel this request. Reconnect, then try again.";

export class BrowseTimeoutError extends Error {
  constructor() {
    super("Browse timed out");
    this.name = "BrowseTimeoutError";
  }
}

/** Single owner for timeout / cancel-wait handles; always cleared in finally. */
function createTimerHandles() {
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
function createFirstSettlement<T extends string>() {
  let winner: T | null = null;
  return {
    tryWin(candidate: T): boolean {
      if (winner !== null) return false;
      winner = candidate;
      return true;
    },
  };
}

type TimerHandles = ReturnType<typeof createTimerHandles>;
type Settlement<T extends string> = ReturnType<typeof createFirstSettlement<T>>;

type BrowseRaceOutcome =
  | { kind: "query"; result: QueryResult }
  | { kind: "query-error"; error: unknown }
  | { kind: "timeout" };

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

/** Schema-qualified identifier for browse/export SELECT, matching table-list quoting. */
export function quotedTableSql(table: TableRef): string {
  const name = quoteIdentifier(table.name);
  return table.schema ? `${quoteIdentifier(table.schema)}.${name}` : name;
}

function ensureActiveTab(stores: AppStores): string {
  return stores.tabs.getState().activeTabId ?? stores.tabs.getState().createTab().id;
}

function liveBrowseIdentity(stores: AppStores, table: TableRef): BrowseIdentity {
  const session = stores.session.getState();
  if (session.connectionId === null || session.databaseName === null) {
    throw new Error("Not connected");
  }
  return {
    tabId: ensureActiveTab(stores),
    connectionId: session.connectionId,
    database: session.databaseName,
    table,
  };
}

function visibleBrowsePage(result: QueryResult): BrowseCachedPage {
  return {
    columns: result.columns,
    rows: result.rows.slice(0, PAGE_SIZE),
    durationMs: result.durationMs,
    hasNext: result.rows.length > PAGE_SIZE,
  };
}

function cachedPageToQueryResult(page: BrowseCachedPage): QueryResult {
  return {
    columns: page.columns,
    rows: page.rows,
    rowsAffected: null,
    durationMs: page.durationMs,
  };
}

async function publishBrowsePageToTab(
  stores: AppStores,
  tabId: string,
  table: TableRef,
  page: BrowseCachedPage,
  tabGeneration: number | null,
): Promise<void> {
  if (!stores.session.getState().isConnected || tabGeneration === null) return;
  try {
    await stores.tabs
      .getState()
      .applyRunSuccess(
        tabId,
        { columns: page.columns, rows: page.rows, durationMs: page.durationMs },
        tabGeneration,
        { displayRowLimit: PAGE_SIZE, selectedTable: table },
      );
  } catch {
    /* in-memory result is authoritative; persistence is best-effort */
  }
}

function isVisibleBrowsePage(stores: AppStores, tabId: string, page: number): boolean {
  const tab = stores.tabs.getState().tabs.find((candidate) => candidate.id === tabId);
  return tab?.browsePage === page;
}

/** Invalidate cached pages for the current identity, then refetch the visible page. */
export async function reloadBrowseOnActiveTab(
  stores: AppStores,
  ipc: DragonIpc,
): Promise<QueryResult | undefined> {
  const identity = stores.browse.getState().identity;
  if (identity === null) return undefined;
  stores.browse.getState().invalidateCache();
  const tabId = stores.tabs.getState().activeTabId ?? identity.tabId;
  const page = stores.tabs.getState().tabs.find((tab) => tab.id === tabId)?.browsePage ?? 0;
  return runBrowseOnActiveTab(stores, ipc, identity.table, page);
}

function retryTargetFor(identity: BrowseIdentity, page: number): BrowseRetryTarget {
  return { ...identity, page };
}

function raceBrowseQuery(
  ipc: DragonIpc,
  connectionId: ConnectionId,
  table: TableRef,
  page: number,
  timers: TimerHandles,
  settlement: Settlement<"query" | "timeout">,
): Promise<BrowseRaceOutcome> {
  return new Promise((resolve) => {
    void ipc
      .runQuery(connectionId, {
        text: `SELECT * FROM ${quotedTableSql(table)} LIMIT ${PAGE_SIZE + 1} OFFSET ${page * PAGE_SIZE}`,
        params: [],
      })
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

async function waitForBrowseCancellation(
  ipc: DragonIpc,
  connectionId: ConnectionId,
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
    void ipc.cancelQuery(connectionId).then(
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

async function settleBrowseTimeout(
  stores: AppStores,
  ipc: DragonIpc,
  identity: BrowseIdentity,
  page: number,
  timers: TimerHandles,
): Promise<never> {
  stores.browse.getState().invalidateCache();
  const retry = retryTargetFor(identity, page);
  const generation = stores.browse.getState().generation;
  stores.browse.getState().publish(generation, {
    lifecycle: { phase: "cancelling", retry, error: null },
  });
  await waitForBrowseCancellation(ipc, identity.connectionId, stores, retry, timers);
  throw new BrowseTimeoutError();
}

export async function runBrowseOnActiveTab(
  stores: AppStores,
  ipc: DragonIpc,
  table: TableRef,
  page: number,
): Promise<QueryResult> {
  if (browseRetryBlocked(stores.browse.getState().lifecycle)) {
    throw new Error("Browse recovery in progress");
  }
  const identity = liveBrowseIdentity(stores, table);
  if (!browseIdentityMatches(stores.browse.getState().identity, identity)) {
    stores.browse.getState().startBrowse(identity);
  }
  const tabId = identity.tabId;
  const safePage = Math.max(0, Math.trunc(page));
  const startingLifecycle = stores.browse.getState().lifecycle;
  if (startingLifecycle.phase === "retryReady") {
    stores.browse.getState().publish(stores.browse.getState().generation, {
      lifecycle: { phase: "idle" },
    });
  }
  const browseGeneration = stores.browse.getState().generation;
  const identityAtStart = stores.browse.getState().identity;

  stores.browse.getState().selectPage(safePage);
  stores.tabs.getState().setBrowsePage(tabId, safePage);

  const cached = stores.browse.getState().readPage(safePage);
  if (cached !== null) {
    stores.browse.getState().publish(browseGeneration, {
      hasNext: cached.hasNext,
      lifecycle: { phase: "ready" },
    });
    const tabGeneration = stores.tabs.getState().beginRun(tabId, { preserveResults: true });
    await publishBrowsePageToTab(stores, tabId, table, cached, tabGeneration);
    return cachedPageToQueryResult(cached);
  }

  return stores.browse.getState().ownBrowsePageRequest(safePage, async () => {
    const tabGeneration = stores.tabs.getState().beginRun(tabId);
    const timers = createTimerHandles();
    const settlement = createFirstSettlement<"query" | "timeout">();
    try {
      const outcome = await raceBrowseQuery(
        ipc,
        identity.connectionId,
        table,
        safePage,
        timers,
        settlement,
      );
      if (outcome.kind === "timeout") {
        return await settleBrowseTimeout(
          stores,
          ipc,
          identityAtStart ?? identity,
          safePage,
          timers,
        );
      }
      if (outcome.kind === "query-error") {
        if (stores.session.getState().isConnected && tabGeneration !== null) {
          stores.tabs
            .getState()
            .applyRunFailure(
              tabId,
              unknownErrorMessage(outcome.error, QUERY_FAILED_MESSAGE),
              tabGeneration,
            );
        }
        throw outcome.error;
      }

      const result = outcome.result;
      const visible = visibleBrowsePage(result);
      const stillCurrentIdentity = browseIdentityMatches(
        stores.browse.getState().identity,
        identityAtStart ?? identity,
      );
      if (stillCurrentIdentity) {
        stores.browse.getState().writePage(browseGeneration, safePage, visible);
      }
      if (isVisibleBrowsePage(stores, tabId, safePage)) {
        await publishBrowsePageToTab(stores, tabId, table, visible, tabGeneration);
      }
      stores.browse.getState().publish(stores.browse.getState().generation, {
        lifecycle: { phase: "ready" },
      });
      return cachedPageToQueryResult(visible);
    } finally {
      timers.clearAll();
    }
  });
}
