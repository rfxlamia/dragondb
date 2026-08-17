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

    const timer = window.setTimeout(() => {
      void persistHatchText(stores, queryText);
    }, AUTOSAVE_MS);

    return () => window.clearTimeout(timer);
  }, [stores, queryText, isRestoring]);
}

async function persistHatchText(stores: AppStores, queryText: string): Promise<void> {
  const tabs = stores.tabs.getState();
  const tabId = tabs.activeTabId;
  if (tabId === null) return;
  const tab = tabs.tabs.find((item) => item.id === tabId);
  if (tab === undefined) return;

  const savedQueryId = tab.savedQueryId;
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
  stores.tabs.getState().setSavedQueryId(tabId, id);
}
