import type { DragonIpc, QueryResult, TableRef } from "../ipc/contract";
import { QUERY_FAILED_MESSAGE, unknownErrorMessage } from "../lib/unknown-error-message";
import {
  BROWSE_VISIBLE_PAGE_SIZE,
  type BrowseCachedPage,
  type BrowseIdentity,
  browseIdentityMatches,
  browseRetryBlocked,
} from "./browse-session-store";
import type { AppStores } from "./compose-app-stores";
import {
  createFirstSettlement,
  createTimerHandles,
  raceBrowseQuery,
  settleBrowseTimeout,
} from "./recover-browse-after-timeout";

export const PAGE_SIZE = BROWSE_VISIBLE_PAGE_SIZE;

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

type BrowseRunContext = {
  identity: BrowseIdentity;
  identityAtStart: BrowseIdentity | null;
  tabId: string;
  safePage: number;
  browseGeneration: number;
};

function beginBrowseOnActiveTab(
  stores: AppStores,
  table: TableRef,
  page: number,
): BrowseRunContext {
  if (browseRetryBlocked(stores.browse.getState().lifecycle)) {
    throw new Error("Browse recovery in progress");
  }
  const identity = liveBrowseIdentity(stores, table);
  if (!browseIdentityMatches(stores.browse.getState().identity, identity)) {
    stores.browse.getState().startBrowse(identity);
  }
  const safePage = Math.max(0, Math.trunc(page));
  if (stores.browse.getState().lifecycle.phase === "retryReady") {
    stores.browse.getState().publish(stores.browse.getState().generation, {
      lifecycle: { phase: "idle" },
    });
  }
  const browseGeneration = stores.browse.getState().generation;
  const identityAtStart = stores.browse.getState().identity;
  stores.browse.getState().selectPage(safePage);
  stores.tabs.getState().setBrowsePage(identity.tabId, safePage);
  return { identity, identityAtStart, tabId: identity.tabId, safePage, browseGeneration };
}

async function serveCachedBrowsePage(
  stores: AppStores,
  table: TableRef,
  ctx: BrowseRunContext,
  cached: BrowseCachedPage,
): Promise<QueryResult> {
  stores.browse.getState().publish(ctx.browseGeneration, {
    hasNext: cached.hasNext,
    lifecycle: { phase: "ready" },
  });
  const tabGeneration = stores.tabs.getState().beginRun(ctx.tabId, { preserveResults: true });
  await publishBrowsePageToTab(stores, ctx.tabId, table, cached, tabGeneration);
  return cachedPageToQueryResult(cached);
}

async function fetchAndPublishBrowsePage(
  stores: AppStores,
  ipc: DragonIpc,
  table: TableRef,
  ctx: BrowseRunContext,
): Promise<QueryResult> {
  const tabGeneration = stores.tabs.getState().beginRun(ctx.tabId);
  const timers = createTimerHandles();
  const settlement = createFirstSettlement<"query" | "timeout">();
  try {
    const outcome = await raceBrowseQuery(
      ipc,
      ctx.identity.connectionId,
      table,
      ctx.safePage,
      timers,
      settlement,
    );
    if (outcome.kind === "timeout") {
      return await settleBrowseTimeout(
        stores,
        ipc,
        ctx.identityAtStart ?? ctx.identity,
        ctx.safePage,
        timers,
      );
    }
    if (outcome.kind === "query-error") {
      if (stores.session.getState().isConnected && tabGeneration !== null) {
        stores.tabs
          .getState()
          .applyRunFailure(
            ctx.tabId,
            unknownErrorMessage(outcome.error, QUERY_FAILED_MESSAGE),
            tabGeneration,
          );
      }
      throw outcome.error;
    }

    const visible = visibleBrowsePage(outcome.result);
    const stillCurrentIdentity = browseIdentityMatches(
      stores.browse.getState().identity,
      ctx.identityAtStart ?? ctx.identity,
    );
    if (stillCurrentIdentity) {
      stores.browse.getState().writePage(ctx.browseGeneration, ctx.safePage, visible);
    }
    if (isVisibleBrowsePage(stores, ctx.tabId, ctx.safePage)) {
      await publishBrowsePageToTab(stores, ctx.tabId, table, visible, tabGeneration);
    }
    stores.browse.getState().publish(stores.browse.getState().generation, {
      lifecycle: { phase: "ready" },
    });
    return cachedPageToQueryResult(visible);
  } finally {
    timers.clearAll();
  }
}

export async function runBrowseOnActiveTab(
  stores: AppStores,
  ipc: DragonIpc,
  table: TableRef,
  page: number,
): Promise<QueryResult> {
  const ctx = beginBrowseOnActiveTab(stores, table, page);
  const cached = stores.browse.getState().readPage(ctx.safePage);
  if (cached !== null) {
    return serveCachedBrowsePage(stores, table, ctx, cached);
  }
  return stores.browse.getState().ownBrowsePageRequest(ctx.safePage, () =>
    fetchAndPublishBrowsePage(stores, ipc, table, ctx),
  );
}
