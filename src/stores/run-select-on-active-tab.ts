/**
 * Run SELECT on the executing tab — clear-at-start, apply success/failure to that
 * tab id (not whichever tab is active later), return QueryResult / rethrow so
 * canvas dual-writer can keep local runOutcome strip.
 *
 * Lazy ensureTab only here — never on connect.
 */
import type { ExecutableSQL } from "../core";
import type { DragonIpc, QueryResult } from "../ipc/contract";
import { QUERY_FAILED_MESSAGE, unknownErrorMessage } from "../lib/unknown-error-message";
import type { AppStores } from "./compose-app-stores";
import type { TabState } from "./tabs-store";

function ensureActiveTab(stores: AppStores): string {
  const { activeTabId, createTab } = stores.tabs.getState();
  if (activeTabId !== null) return activeTabId;
  return createTab().id;
}

export async function runSelectOnActiveTab(
  stores: AppStores,
  ipc: DragonIpc,
  sql: ExecutableSQL,
  onAppliedSuccess?: (tab: TabState) => void,
): Promise<QueryResult> {
  const connectionId = stores.session.getState().connectionId;
  if (connectionId === null) {
    throw new Error("Not connected");
  }

  const executingTabId = ensureActiveTab(stores);
  const gen = stores.tabs.getState().beginRun(executingTabId);
  if (gen === null) throw new Error("Tab run could not start");

  let result: QueryResult;
  try {
    result = await ipc.runQuery(connectionId, sql, gen);
  } catch (error) {
    const { isConnected } = stores.session.getState();
    if (isConnected && gen !== null) {
      stores.tabs
        .getState()
        .applyRunFailure(executingTabId, unknownErrorMessage(error, QUERY_FAILED_MESSAGE), gen);
    }
    throw error;
  }

  // Persist is best-effort — a rejecting saveTabState must not flip a successful
  // run into status error / null raw (see tabs-store deleteTabState .catch).
  const { isConnected } = stores.session.getState();
  if (isConnected && gen !== null) {
    let applied = false;
    try {
      applied = await stores.tabs.getState().applyRunSuccess(
        executingTabId,
        {
          columns: result.columns,
          rows: result.rows,
          durationMs: result.durationMs,
        },
        gen,
      );
    } catch {
      /* in-memory apply landed; persist is best-effort */
      applied = true;
    }
    if (applied) {
      const tab = stores.tabs.getState().tabs.find((t) => t.id === executingTabId);
      if (tab !== undefined) {
        onAppliedSuccess?.(tab);
      }
    }
  }
  return result;
}
