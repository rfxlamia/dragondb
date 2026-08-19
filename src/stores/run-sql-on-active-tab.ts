/**
 * Dispatch hatch SQL: a single SELECT replaces the grid; a mutation keeps it
 * and sets a toast; a multi-statement script goes through ipc.runQuery once
 * (T4 server split) rather than looping the SELECT writer.
 */
import type { ExecutableSQL } from "../core";
import type { DragonIpc, QueryResult } from "../ipc/contract";
import { isMutation } from "../lib/query-type-detector";
import { splitSqlStatements } from "../lib/sql-statement-splitter";
import type { AppStores } from "./compose-app-stores";
import { runMutationOnActiveTab } from "./run-mutation-on-active-tab";
import { runSelectOnActiveTab } from "./run-select-on-active-tab";

export async function runSqlOnActiveTab(
  stores: AppStores,
  ipc: DragonIpc,
  sql: ExecutableSQL,
): Promise<QueryResult> {
  if (splitSqlStatements(sql.text).length > 1) {
    return runSelectOnActiveTab(stores, ipc, sql);
  }
  if (isMutation(sql.text)) {
    return runMutationOnActiveTab(stores, ipc, sql);
  }
  return runSelectOnActiveTab(stores, ipc, sql);
}
