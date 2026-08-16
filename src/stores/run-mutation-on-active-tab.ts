import type { ExecutableSQL } from "../core";
import type { DragonIpc, QueryResult } from "../ipc/contract";
import {
  detectQueryType,
  extractTableName,
  isMutation,
  type SqlQueryType,
} from "../lib/query-type-detector";
import { QUERY_FAILED_MESSAGE, unknownErrorMessage } from "../lib/unknown-error-message";
import type { AppStores } from "./compose-app-stores";

const SUCCESS_TITLES: Record<SqlQueryType, string> = {
  select: "Query Executed",
  insert: "Insert Successful",
  update: "Update Successful",
  delete: "Delete Successful",
  createTable: "Table Created",
  dropTable: "Table Dropped",
  alterTable: "Table Altered",
  other: "Query Executed",
};

function ensureActiveTab(stores: AppStores): string {
  return stores.tabs.getState().activeTabId ?? stores.tabs.getState().createTab().id;
}

export async function runMutationOnActiveTab(
  stores: AppStores,
  ipc: DragonIpc,
  sql: ExecutableSQL,
): Promise<QueryResult> {
  if (!isMutation(sql.text)) throw new Error("Expected a mutation query");
  const connectionId = stores.session.getState().connectionId;
  if (connectionId === null) throw new Error("Not connected");
  const tabId = ensureActiveTab(stores);
  const previousStatus = stores.tabs.getState().tabs.find((tab) => tab.id === tabId)?.status;
  const generation = stores.tabs.getState().beginRun(tabId, { preserveResults: true });

  let result: QueryResult;
  try {
    result = await ipc.runQuery(connectionId, sql);
  } catch (error) {
    if (stores.session.getState().isConnected && generation !== null) {
      stores.tabs
        .getState()
        .applyRunFailure(tabId, unknownErrorMessage(error, QUERY_FAILED_MESSAGE), generation);
    }
    throw error;
  }

  if (stores.session.getState().isConnected && generation !== null) {
    const queryType = detectQueryType(sql.text);
    const table = extractTableName(sql.text);
    stores.tabs.getState().applyMutationSuccess(
      tabId,
      {
        title: SUCCESS_TITLES[queryType],
        tableName: table?.name ?? null,
        queryType,
        sql: sql.text,
      },
      previousStatus,
      generation,
    );
  }
  return result;
}
