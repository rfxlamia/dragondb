/**
 * Run SELECT on the executing tab — clear-at-start, apply success/failure to that
 * tab id (not whichever tab is active later), return QueryResult / rethrow so
 * canvas dual-writer can keep local runOutcome strip.
 *
 * Lazy ensureTab only here — never on connect.
 */
import type { ExecutableSQL } from "../core";
import type { DragonIpc, QueryResult } from "../ipc/contract";
import type { AppStores } from "./compose-app-stores";

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return "Query failed";
}

function ensureActiveTab(stores: AppStores): string {
  const { activeTabId, createTab } = stores.tabs.getState();
  if (activeTabId !== null) return activeTabId;
  return createTab().id;
}

export async function runSelectOnActiveTab(
  stores: AppStores,
  ipc: DragonIpc,
  sql: ExecutableSQL,
): Promise<QueryResult> {
  const connectionId = stores.session.getState().connectionId;
  if (connectionId === null) {
    throw new Error("Not connected");
  }

  const executingTabId = ensureActiveTab(stores);
  const gen = stores.tabs.getState().beginRun(executingTabId);

  try {
    const result = await ipc.runQuery(connectionId, sql);
    const { isConnected } = stores.session.getState();
    if (isConnected && gen !== null) {
      await stores.tabs.getState().applyRunSuccess(
        executingTabId,
        {
          columns: result.columns,
          rows: result.rows,
          durationMs: result.durationMs,
        },
        gen,
      );
    }
    return result;
  } catch (error) {
    const { isConnected } = stores.session.getState();
    if (isConnected && gen !== null) {
      stores.tabs.getState().applyRunFailure(executingTabId, errorMessage(error), gen);
    }
    throw error;
  }
}
