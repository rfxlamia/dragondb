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
