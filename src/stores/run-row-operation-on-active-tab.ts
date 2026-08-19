import type { DragonIpc, TableRef } from "../ipc/contract";
import type { BrowseRetryTarget } from "./browse-session-store";
import type { AppStores } from "./compose-app-stores";
import { runBrowseOnActiveTab } from "./run-browse-on-active-tab";

export type RowOperationOutcome =
  | { kind: "ok" }
  | { kind: "reloadFailed"; retry: BrowseRetryTarget };

function connectionIdOf(stores: AppStores): string {
  const connectionId = stores.session.getState().connectionId;
  if (connectionId === null) {
    throw { kind: "noTableSelected", message: "not connected" };
  }
  return connectionId;
}

function retryOf(stores: AppStores, table: TableRef, page: number): BrowseRetryTarget {
  const identity = stores.browse.getState().identity;
  const session = stores.session.getState();
  return {
    tabId: identity?.tabId ?? stores.tabs.getState().activeTabId ?? "",
    connectionId: identity?.connectionId ?? session.connectionId ?? "",
    database: identity?.database ?? session.databaseName ?? "",
    table,
    page,
  };
}

async function reloadAfterConfirmedMutation(
  stores: AppStores,
  ipc: DragonIpc,
  table: TableRef,
  page: number,
): Promise<RowOperationOutcome> {
  stores.browse.getState().invalidateCache();
  try {
    await runBrowseOnActiveTab(stores, ipc, table, page);
    return { kind: "ok" };
  } catch {
    return { kind: "reloadFailed", retry: retryOf(stores, table, page) };
  }
}

export async function runUpdateRowOnActiveTab(
  stores: AppStores,
  ipc: DragonIpc,
  table: TableRef,
  page: number,
  primaryKey: Record<string, unknown>,
  patch: Record<string, unknown | null>,
): Promise<RowOperationOutcome> {
  await ipc.updateRow({
    connectionId: connectionIdOf(stores),
    table,
    primaryKey,
    patch,
  });
  return reloadAfterConfirmedMutation(stores, ipc, table, page);
}

export async function runDeleteRowsOnActiveTab(
  stores: AppStores,
  ipc: DragonIpc,
  table: TableRef,
  page: number,
  primaryKeys: Record<string, unknown>[],
): Promise<RowOperationOutcome> {
  await ipc.deleteRows({
    connectionId: connectionIdOf(stores),
    table,
    primaryKeys,
  });
  return reloadAfterConfirmedMutation(stores, ipc, table, page);
}

/** Reload the current page only — never repeat a mutation that already committed. */
export async function retryRowOperationReload(
  stores: AppStores,
  ipc: DragonIpc,
  retry: BrowseRetryTarget,
): Promise<void> {
  await runBrowseOnActiveTab(stores, ipc, retry.table, retry.page);
}
