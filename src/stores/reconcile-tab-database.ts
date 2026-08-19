/**
 * A tab carries the database its SQL must run against. SQL executes against
 * whatever database Rust last switched to, so activating a tab and switching
 * afterwards can leave the tab pointing at one database while statements run
 * on another — hence activation is gated on this reconciliation.
 *
 * `databaseName === null` means the tab has no database: it was created before
 * a session existed, or its database was deleted out from under it. Such a tab
 * must NOT inherit whatever database the previously active tab left live in
 * Rust; the hatch and canvas read `tab.databaseName ?? session.databaseName`,
 * so leaving the live name in place would re-enable Run against a database the
 * user never chose for this tab.
 */
export type TabDatabaseReconciliation =
  | { kind: "none" }
  | { kind: "switch"; database: string }
  | { kind: "clear" };

export function reconcileTabDatabase(args: {
  tabDatabase: string | null;
  liveDatabase: string | null;
  isConnected: boolean;
}): TabDatabaseReconciliation {
  const { tabDatabase, liveDatabase, isConnected } = args;
  if (!isConnected) return { kind: "none" };
  if (tabDatabase === null) {
    // Nothing to switch to. Drop the frontend's database context so the picker
    // asks for an explicit selection instead of the tab silently adopting the
    // database another tab is holding open.
    return liveDatabase === null ? { kind: "none" } : { kind: "clear" };
  }
  if (tabDatabase === liveDatabase) return { kind: "none" };
  return { kind: "switch", database: tabDatabase };
}

/**
 * Whether the live database should be stamped onto the active tab.
 *
 * A tab created before a session existed carries `databaseName === null` and
 * must adopt the live database once connected, otherwise
 * `reconcileTabDatabase` would later read it as a tab with no database and
 * clear the context Run needs.
 *
 * A tab whose database was *deleted* also carries null, and must NOT adopt
 * one. `databaseSelectionCleared` separates the two. It matters because a tab
 * can become active without going through the switch path at all — closing its
 * neighbour activates it directly — and stamping there would silently bind the
 * tab to whatever database the closed tab left live.
 */
export function shouldStampTabDatabase(args: {
  tabDatabase: string | null;
  liveDatabase: string | null;
  isConnected: boolean;
  databaseSelectionCleared: boolean;
}): boolean {
  const { tabDatabase, liveDatabase, isConnected, databaseSelectionCleared } = args;
  if (!isConnected || liveDatabase === null) return false;
  if (databaseSelectionCleared) return false;
  return tabDatabase === null;
}
