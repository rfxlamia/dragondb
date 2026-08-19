import { useEffect, useRef } from "react";
import { newSavedQueryName } from "../../lib/new-saved-query-name";
import type { AppStores } from "../../stores/compose-app-stores";

const AUTOSAVE_MS = 500;

export type SavedQueryAutosaveArgs = {
  stores: AppStores;
  /** Hatch SQL buffer only — never visual-canvas IR. */
  queryText: string;
  isRestoring: boolean;
};

/**
 * Debounced hatch-buffer persist. Auto-creates a SavedQuery when none is
 * selected. Skips while `isRestoring` so restore writes do not spawn extras —
 * callers also pulse `isRestoring` around a saved-query selection's buffer
 * load, so switching queries always cancels any debounce still pending for
 * the previously-selected query (App.handleSelectQuery relies on this).
 * Never writes visualDocumentJson / canvas IR into SavedQuery.queryText.
 */
export function useSavedQueryAutosave(args: SavedQueryAutosaveArgs): void {
  const { stores, queryText, isRestoring } = args;
  const skipAfterRestoreRef = useRef(isRestoring);
  /**
   * Per-tab save queue. Debounces are cancelled on every keystroke, but a save
   * already in flight is not: without this chain a second debounce firing
   * before the first `saveSavedQuery` resolves would still read
   * `savedQueryId === null` and auto-create a second SavedQuery, leaving an
   * orphan row in the library.
   */
  const queueRef = useRef(new Map<string, Promise<void>>());

  useEffect(() => {
    if (isRestoring) {
      skipAfterRestoreRef.current = true;
      return;
    }
    if (skipAfterRestoreRef.current) {
      skipAfterRestoreRef.current = false;
      return;
    }
    if (queryText.length === 0) return;

    const tabs = stores.tabs.getState();
    const tabId = tabs.activeTabId;
    if (tabId === null) return;
    const savedQueryId = tabs.tabs.find((item) => item.id === tabId)?.savedQueryId ?? null;

    const timer = window.setTimeout(() => {
      const queue = queueRef.current;
      const previous = queue.get(tabId) ?? Promise.resolve();
      const next = previous
        .then(() => persistHatchText(stores, queryText, tabId, savedQueryId))
        .catch(() => undefined)
        .finally(() => {
          if (queue.get(tabId) === next) queue.delete(tabId);
        });
      queue.set(tabId, next);
    }, AUTOSAVE_MS);

    return () => window.clearTimeout(timer);
  }, [stores, queryText, isRestoring]);
}

async function persistHatchText(
  stores: AppStores,
  queryText: string,
  tabId: string,
  scheduledSavedQueryId: string | null,
): Promise<void> {
  const tab = stores.tabs.getState().tabs.find((item) => item.id === tabId);
  if (tab === undefined) return;
  // Re-read at persist time rather than trusting the value captured when the
  // debounce was scheduled: an earlier queued save for this tab may have just
  // created the SavedQuery and stamped its id, and this text belongs to that
  // same query. Selecting a different saved query pulses `isRestoring`, which
  // cancels the pending debounce, so only a genuine switch trips this guard.
  const savedQueryId = tab.savedQueryId;
  if (scheduledSavedQueryId !== null && savedQueryId !== scheduledSavedQueryId) return;

  if (savedQueryId !== null) {
    const existing = stores.library.getState().queries.find((query) => query.id === savedQueryId);
    if (existing === undefined) return;
    if (existing.queryText === queryText) return;
    await stores.library.getState().saveSavedQuery({
      ...existing,
      queryText,
      updatedAt: String(Date.now()),
    });
    return;
  }

  const now = String(Date.now());
  const id = crypto.randomUUID();
  const session = stores.session.getState();
  await stores.library.getState().saveSavedQuery({
    id,
    name: newSavedQueryName(new Date()),
    queryText,
    connectionId: session.connectionId,
    databaseName: session.databaseName,
    createdAt: now,
    updatedAt: now,
    folderId: null,
  });
  const still = stores.tabs.getState().tabs.find((item) => item.id === tabId);
  if (still === undefined || still.savedQueryId !== null) return;
  stores.tabs.getState().setSavedQueryId(tabId, id);
}
