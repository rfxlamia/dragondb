import { useCallback, useEffect, useRef, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { useStore } from "zustand";
import type { ExecutableSQL, TableReference } from "./core";
import type { ConnectResult, DragonIpc, IpcError, ProfileId } from "./ipc/contract";
import { coreToTableRef, tableRefToCore } from "./ipc/table-ref";
import { createTauriDragonIpc } from "./ipc/tauri-client";
import { newSavedQueryName } from "./lib/new-saved-query-name";
import { type AppStores, composeAppStores } from "./stores/compose-app-stores";
import { runSelectOnActiveTab } from "./stores/run-select-on-active-tab";
import { ConnectionPanel } from "./ui/connection/connection-panel";
import { QueriesColumn } from "./ui/library/queries-column";
import { createSavedQueryResultCache } from "./ui/library/saved-query-result-cache";
import { QueryResultsPane } from "./ui/results/query-results-pane";
import { TabBar } from "./ui/shell/tab-bar";
import { TabBarCopy } from "./ui/shell/tab-bar-copy";
import { WorkspaceSplit } from "./ui/shell/workspace-split";
import { VisualQueryCanvas } from "./ui/visual-query/canvas";
import { VisualQueryCopy } from "./ui/visual-query/copy";
import { createTabDocuments } from "./ui/visual-query/tab-documents";
import { WelcomeView } from "./ui/welcome/welcome-view";
import "./App.css";

export type AppProps = { ipc?: DragonIpc };

const IDLE_STATUS = { kind: "idle" } as const;

function ensureDefaultIpc(ref: { current: DragonIpc | null }): DragonIpc {
  const existing = ref.current;
  if (existing !== null) return existing;
  const created = createTauriDragonIpc();
  ref.current = created;
  return created;
}

function mapSchemaError(code: string | null): string | null {
  if (code === null) return null;
  if (code === "tables_load_failed") return VisualQueryCopy.tablesLoadError;
  if (code === "columns_load_failed") return VisualQueryCopy.columnsLoadError;
  return code;
}

export default function App({ ipc: ipcProp }: AppProps = {}) {
  // Lazy default: never call createTauriDragonIpc at module scope or when ipc is injected.
  const defaultIpcRef = useRef<DragonIpc | null>(null);
  const ipc = ipcProp ?? ensureDefaultIpc(defaultIpcRef);

  const storesHolder = useRef<{ ipc: DragonIpc; stores: AppStores } | null>(null);
  if (storesHolder.current === null || storesHolder.current.ipc !== ipc) {
    storesHolder.current = { ipc, stores: composeAppStores(ipc) };
  }
  const stores = storesHolder.current.stores;

  const isConnected = useStore(stores.session, (s) => s.isConnected);
  const connectionId = useStore(stores.session, (s) => s.connectionId);
  const profileId = useStore(stores.session, (s) => s.profileId);
  const tableRefs = useStore(stores.schema, (s) => s.tables);
  const tablesLoading = useStore(stores.schema, (s) => s.tablesLoading);
  const tablesErrorMessage = useStore(stores.schema, (s) => s.tablesErrorMessage);
  const columnNames = useStore(stores.schema, (s) => s.columnNames);
  const metadataErrorCode = useStore(stores.schema, (s) => s.metadataErrorMessage);
  const tabs = useStore(stores.tabs, (s) => s.tabs);
  const activeTabId = useStore(stores.tabs, (s) => s.activeTabId);
  const tabsReady = useStore(stores.tabs, (s) => s.tabsReady);
  const savedQueryId = useStore(
    stores.tabs,
    (s) => s.tabs.find((t) => t.id === s.activeTabId)?.savedQueryId ?? null,
  );
  const status = useStore(
    stores.tabs,
    (s) => s.tabs.find((t) => t.id === s.activeTabId)?.status ?? IDLE_STATUS,
  );
  const compact = useStore(
    stores.tabs,
    (s) => s.tabs.find((t) => t.id === s.activeTabId)?.compact ?? null,
  );
  const libraryQueries = useStore(stores.library, (s) => s.queries);
  const libraryFolders = useStore(stores.library, (s) => s.folders);

  /** Last live profile id — store clears before panel calls onDisconnected. */
  const lastProfileIdRef = useRef<ProfileId | null>(null);
  const formVisibilityTouchedRef = useRef(false);
  const tabDocumentsRef = useRef(createTabDocuments());
  const savedQueryCacheRef = useRef(createSavedQueryResultCache());
  const [profilesReady, setProfilesReady] = useState(false);
  const [profileCount, setProfileCount] = useState(0);
  const [formVisible, setFormVisible] = useState(false);
  const [docsEpoch, setDocsEpoch] = useState(0);

  useEffect(() => {
    if (isConnected && profileId !== null) {
      lastProfileIdRef.current = profileId;
    }
  }, [isConnected, profileId]);

  useEffect(() => {
    let cancelled = false;
    void ipc
      .listProfiles()
      .then((list) => {
        if (cancelled) return;
        setProfileCount(list.length);
        if (!formVisibilityTouchedRef.current) {
          setFormVisible(list.length > 0);
        }
        setProfilesReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setProfileCount(0);
        if (!formVisibilityTouchedRef.current) {
          setFormVisible(false);
        }
        setProfilesReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [ipc]);

  const handleFormVisibleChange = useCallback((next: boolean) => {
    formVisibilityTouchedRef.current = true;
    setFormVisible(next);
  }, []);

  const handleProfilesLoaded = useCallback((count: number) => {
    setProfileCount(count);
  }, []);

  useEffect(() => {
    void stores.tabs
      .getState()
      .refresh()
      .catch(() => {
        /* best-effort hydrate on start */
      });
  }, [stores]);

  const welcome = profilesReady && profileCount === 0 && !formVisible;

  useEffect(() => {
    if (!profilesReady || welcome) return;
    void stores.library
      .getState()
      .refresh()
      .catch(() => {
        /* best-effort library hydrate on workspace mount */
      });
  }, [stores, profilesReady, welcome]);

  const tables = tableRefs.map(tableRefToCore);
  const metadataErrorMessage = mapSchemaError(metadataErrorCode);
  const workspaceReady = tabsReady && activeTabId !== null;

  function resetTabDocuments(): void {
    const ids = stores.tabs.getState().tabs.map((tab) => tab.id);
    tabDocumentsRef.current.resetAll(ids);
    savedQueryCacheRef.current.clear();
    setDocsEpoch((value) => value + 1);
  }

  function resetActiveTabDocument(): void {
    const tabId = stores.tabs.getState().activeTabId;
    if (tabId === null) return;
    const document = tabDocumentsRef.current.getOrCreate(tabId);
    const priorFrom = document.committedFromTable;
    document.startOver();
    if (priorFrom !== null) {
      stores.schema.getState().clearColumns();
    }
    setDocsEpoch((value) => value + 1);
    stores.tabs.getState().restoreSavedQueryResult(tabId, null);
  }

  function handleConnected(result: ConnectResult): void {
    if (stores.shouldRemountCanvasOnConnect(result.profileId)) {
      resetTabDocuments();
      stores.bumpCanvasEpoch();
    }
    stores.acknowledgeConnect(result.profileId);
  }

  function handleDisconnected(): void {
    stores.noteCanvasDisconnect(lastProfileIdRef.current);
  }

  function handleSwitchSuccess(result: ConnectResult): void {
    resetTabDocuments();
    stores.bumpCanvasEpoch();
    stores.acknowledgeConnect(result.profileId);
  }

  function handleSwitchFailure(_error: IpcError): void {
    // Snapshot already set by onDisconnected after A teardown — keep it for remount-on-B.
    // See tests/stores/sp3-spec-audit.test.ts "App.handleSwitchFailure must not wipe the disconnect snapshot".
  }

  function handleCommittedFromChange(table: TableReference | null): void {
    if (table === null) {
      stores.schema.getState().clearColumns();
      return;
    }
    const liveId = stores.session.getState().connectionId;
    if (liveId === null) return;
    void stores.schema.getState().loadColumns(liveId, coreToTableRef(table));
  }

  const onRunQuery =
    isConnected && connectionId !== null
      ? (sql: ExecutableSQL) =>
          runSelectOnActiveTab(stores, ipc, sql, (tab) => {
            if (tab.savedQueryId !== null && tab.compact != null && tab.status?.kind === "ok") {
              savedQueryCacheRef.current.write(tab.savedQueryId, tab.compact, tab.status);
            }
          })
      : undefined;

  function handleClearTabResults(): void {
    const tabId = stores.tabs.getState().activeTabId;
    if (tabId === null) return;
    stores.tabs.getState().clearTabResults(tabId);
  }

  function handleNewTab(): void {
    const created = stores.tabs.getState().createTab();
    tabDocumentsRef.current.getOrCreate(created.id);
  }

  function handleCloseTab(id: string): void {
    stores.tabs.getState().closeTab(id);
    tabDocumentsRef.current.delete(id);
  }

  function handleSelectQuery(queryId: string): void {
    const tabId = stores.tabs.getState().activeTabId;
    if (tabId === null) return;
    stores.tabs.getState().setSavedQueryId(tabId, queryId);
    stores.tabs.getState().restoreSavedQueryResult(tabId, savedQueryCacheRef.current.read(queryId));
  }

  async function handleNewQuery(): Promise<void> {
    const tabId = stores.tabs.getState().activeTabId;
    if (tabId === null) return;
    const now = String(Date.now());
    const session = stores.session.getState();
    const id = crypto.randomUUID();
    await stores.library.getState().saveSavedQuery({
      id,
      name: newSavedQueryName(new Date()),
      queryText: "",
      connectionId: session.connectionId,
      databaseName: session.databaseName,
      createdAt: now,
      updatedAt: now,
      folderId: null,
    });
    stores.tabs.getState().setSavedQueryId(tabId, id);
    resetActiveTabDocument();
  }

  async function handleRenameQuery(id: string, name: string): Promise<void> {
    const existing = stores.library.getState().queries.find((query) => query.id === id);
    if (existing === undefined) return;
    await stores.library.getState().saveSavedQuery({
      ...existing,
      name,
      updatedAt: String(Date.now()),
    });
  }

  async function handleDeleteQuery(id: string): Promise<void> {
    await stores.library.getState().deleteSavedQueries([id]);
  }

  async function handleMoveQuery(id: string, folderId: string): Promise<void> {
    await stores.library.getState().moveSavedQuery(id, folderId);
  }

  async function handleDeleteFolder(id: string, deleteQueries: boolean): Promise<void> {
    await stores.library.getState().deleteFolder(id, deleteQueries);
  }

  const canvas =
    workspaceReady && activeTabId !== null ? (
      <VisualQueryCanvas
        key={`${activeTabId}:${docsEpoch}`}
        document={tabDocumentsRef.current.getOrCreate(activeTabId)}
        tables={tables}
        columnNames={columnNames}
        metadataErrorMessage={metadataErrorMessage}
        isConnected={isConnected}
        onRunQuery={onRunQuery}
        onClearTabResults={handleClearTabResults}
        onCommittedFromChange={handleCommittedFromChange}
        historyStore={stores.history}
        saveTextFile={ipc.saveTextFile}
      />
    ) : null;

  if (!profilesReady) {
    return <main aria-busy="true" className="app-startup" />;
  }

  if (welcome) {
    return (
      <main className="app-welcome">
        <WelcomeView onConnectToServer={() => handleFormVisibleChange(true)} />
      </main>
    );
  }

  return (
    <main className="app-shell">
      <ConnectionPanel
        ipc={ipc}
        isConnected={isConnected}
        activeProfileId={profileId ?? undefined}
        formVisible={formVisible}
        onFormVisibleChange={handleFormVisibleChange}
        onProfilesLoaded={handleProfilesLoaded}
        tables={tableRefs}
        tablesLoading={tablesLoading}
        tablesErrorMessage={tablesErrorMessage}
        connectProfile={(id) => stores.session.getState().connect(id)}
        disconnectSession={() => stores.session.getState().disconnect()}
        onConnected={handleConnected}
        onDisconnected={handleDisconnected}
        onSwitchSuccess={handleSwitchSuccess}
        onSwitchFailure={handleSwitchFailure}
      />
      <div className="app-main-column" aria-busy={workspaceReady ? undefined : true}>
        <Group orientation="horizontal" className="app-workspace-split">
          <Panel className="app-workspace-split__queries" defaultSize={220} minSize={160}>
            <QueriesColumn
              queries={libraryQueries}
              folders={libraryFolders}
              selectedQueryId={savedQueryId}
              onSelectQuery={handleSelectQuery}
              onNewQuery={handleNewQuery}
              onRenameQuery={handleRenameQuery}
              onDeleteQuery={handleDeleteQuery}
              onMoveQuery={handleMoveQuery}
              onDeleteFolder={handleDeleteFolder}
            />
          </Panel>
          <Separator className="app-workspace-split__separator" />
          <Panel className="app-workspace-split__main" minSize={400}>
            <div className="app-workspace-main">
              {workspaceReady ? (
                <>
                  <TabBar
                    tabs={tabs.map((tab) => ({
                      id: tab.id,
                      title: TabBarCopy.untitled,
                      isActive: tab.id === activeTabId,
                    }))}
                    onNewTab={handleNewTab}
                    onSwitchTab={(id) => stores.tabs.getState().switchTab(id)}
                    onCloseTab={handleCloseTab}
                  />
                  <WorkspaceSplit
                    canvas={canvas}
                    results={<QueryResultsPane status={status} compact={compact} />}
                  />
                </>
              ) : null}
            </div>
          </Panel>
        </Group>
      </div>
    </main>
  );
}
