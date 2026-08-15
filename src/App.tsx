import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { ExecutableSQL, TableReference } from "./core";
import type { ConnectResult, DragonIpc, IpcError, ProfileId } from "./ipc/contract";
import { coreToTableRef, tableRefToCore } from "./ipc/table-ref";
import { createTauriDragonIpc } from "./ipc/tauri-client";
import { type AppStores, composeAppStores } from "./stores/compose-app-stores";
import { runSelectOnActiveTab } from "./stores/run-select-on-active-tab";
import { ConnectionPanel } from "./ui/connection/connection-panel";
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
  const columnNames = useStore(stores.schema, (s) => s.columnNames);
  const metadataErrorCode = useStore(stores.schema, (s) => s.metadataErrorMessage);
  const tabs = useStore(stores.tabs, (s) => s.tabs);
  const activeTabId = useStore(stores.tabs, (s) => s.activeTabId);
  const tabsReady = useStore(stores.tabs, (s) => s.tabsReady);
  const status = useStore(
    stores.tabs,
    (s) => s.tabs.find((t) => t.id === s.activeTabId)?.status ?? IDLE_STATUS,
  );
  const compact = useStore(
    stores.tabs,
    (s) => s.tabs.find((t) => t.id === s.activeTabId)?.compact ?? null,
  );

  /** Last live profile id — store clears before panel calls onDisconnected. */
  const lastProfileIdRef = useRef<ProfileId | null>(null);
  const formVisibilityTouchedRef = useRef(false);
  const tabDocumentsRef = useRef(createTabDocuments());
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
    setDocsEpoch((value) => value + 1);
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
      ? (sql: ExecutableSQL) => runSelectOnActiveTab(stores, ipc, sql)
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
        connectProfile={(id) => stores.session.getState().connect(id)}
        disconnectSession={() => stores.session.getState().disconnect()}
        onConnected={handleConnected}
        onDisconnected={handleDisconnected}
        onSwitchSuccess={handleSwitchSuccess}
        onSwitchFailure={handleSwitchFailure}
      />
      <div className="app-main-column" aria-busy={workspaceReady ? undefined : true}>
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
    </main>
  );
}
