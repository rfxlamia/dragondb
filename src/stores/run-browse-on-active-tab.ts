import type { DragonIpc, QueryResult, TableRef } from "../ipc/contract";
import { QUERY_FAILED_MESSAGE, unknownErrorMessage } from "../lib/unknown-error-message";
import type { AppStores } from "./compose-app-stores";

const PAGE_SIZE = 100;

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function tableSql(table: TableRef): string {
  const name = quoteIdentifier(table.name);
  return table.schema ? `${quoteIdentifier(table.schema)}.${name}` : name;
}

function ensureActiveTab(stores: AppStores): string {
  return stores.tabs.getState().activeTabId ?? stores.tabs.getState().createTab().id;
}

export async function runBrowseOnActiveTab(
  stores: AppStores,
  ipc: DragonIpc,
  table: TableRef,
  page: number,
): Promise<QueryResult> {
  const connectionId = stores.session.getState().connectionId;
  if (connectionId === null) throw new Error("Not connected");
  const tabId = ensureActiveTab(stores);
  const generation = stores.tabs.getState().beginRun(tabId);
  const safePage = Math.max(0, Math.trunc(page));

  let result: QueryResult;
  try {
    result = await ipc.runQuery(connectionId, {
      text: `SELECT * FROM ${tableSql(table)} LIMIT ${PAGE_SIZE + 1} OFFSET ${safePage * PAGE_SIZE}`,
      params: [],
    });
  } catch (error) {
    if (stores.session.getState().isConnected && generation !== null) {
      stores.tabs
        .getState()
        .applyRunFailure(tabId, unknownErrorMessage(error, QUERY_FAILED_MESSAGE), generation);
    }
    throw error;
  }

  if (stores.session.getState().isConnected && generation !== null) {
    try {
      await stores.tabs
        .getState()
        .applyRunSuccess(
          tabId,
          { columns: result.columns, rows: result.rows, durationMs: result.durationMs },
          generation,
          { displayRowLimit: PAGE_SIZE, selectedTable: table },
        );
    } catch {
      /* in-memory result is authoritative; persistence is best-effort */
    }
  }
  return result;
}
