import type { DragonIpc, QueryResult, TableRef } from "../ipc/contract";
import { QUERY_FAILED_MESSAGE, unknownErrorMessage } from "../lib/unknown-error-message";
import {
  BROWSE_VISIBLE_PAGE_SIZE,
  type BrowseCachedPage,
  type BrowseIdentity,
  browseIdentityMatches,
} from "./browse-session-store";
import type { AppStores } from "./compose-app-stores";

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

export async function runBrowseOnActiveTab(
  stores: AppStores,
  ipc: DragonIpc,
  table: TableRef,
  page: number,
): Promise<QueryResult> {
  const identity = liveBrowseIdentity(stores, table);
  if (!browseIdentityMatches(stores.browse.getState().identity, identity)) {
    stores.browse.getState().startBrowse(identity);
  }
  const tabId = identity.tabId;
  const safePage = Math.max(0, Math.trunc(page));
  const browseGeneration = stores.browse.getState().generation;
  const identityAtStart = stores.browse.getState().identity;

  stores.browse.getState().selectPage(safePage);
  stores.tabs.getState().setBrowsePage(tabId, safePage);

  const cached = stores.browse.getState().readPage(safePage);
  if (cached !== null) {
    stores.browse.getState().publish(browseGeneration, { hasNext: cached.hasNext });
    const tabGeneration = stores.tabs.getState().beginRun(tabId, { preserveResults: true });
    await publishBrowsePageToTab(stores, tabId, table, cached, tabGeneration);
    return cachedPageToQueryResult(cached);
  }

  return stores.browse.getState().ownBrowsePageRequest(safePage, async () => {
    const tabGeneration = stores.tabs.getState().beginRun(tabId);
    let result: QueryResult;
    try {
      result = await ipc.runQuery(identity.connectionId, {
        text: `SELECT * FROM ${quotedTableSql(table)} LIMIT ${PAGE_SIZE + 1} OFFSET ${safePage * PAGE_SIZE}`,
        params: [],
      });
    } catch (error) {
      if (stores.session.getState().isConnected && tabGeneration !== null) {
        stores.tabs
          .getState()
          .applyRunFailure(tabId, unknownErrorMessage(error, QUERY_FAILED_MESSAGE), tabGeneration);
      }
      throw error;
    }

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
    return cachedPageToQueryResult(visible);
  });
}
