import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import type { ExecutableSQL, QueryDocument, TableReference } from "./core";
import type {
  ConnectionProfileDto,
  ConnectResult,
  DragonIpc,
  IpcError,
  ProfileId,
  TableRef,
} from "./ipc/contract";
import { coreToTableRef, tableRefToCore } from "./ipc/table-ref";
import { createTauriDragonIpc } from "./ipc/tauri-client";
import { loadDateFormat, type QueryResultsDateFormat } from "./lib/date-format-setting";
import { newSavedQueryName } from "./lib/new-saved-query-name";
import { type AppStores, composeAppStores } from "./stores/compose-app-stores";
import { PAGE_SIZE, quotedTableSql, runBrowseOnActiveTab } from "./stores/run-browse-on-active-tab";
import { runSelectOnActiveTab } from "./stores/run-select-on-active-tab";
import { runSqlOnActiveTab } from "./stores/run-sql-on-active-tab";
import { ConnectionCopy, humanIpcErrorMessage } from "./ui/connection/connection-copy";
import { ConnectionPanel, type ConnectionPanelHandle } from "./ui/connection/connection-panel";
import { HelpDialog } from "./ui/help/help-dialog";
import { SettingsDialog } from "./ui/help/settings-dialog";
import { ShortcutsDialog } from "./ui/help/shortcuts-dialog";
import { QueriesCopy } from "./ui/library/queries-copy";
import { createSavedQueryResultCache } from "./ui/library/saved-query-result-cache";
import { useSavedQueryAutosave } from "./ui/library/use-saved-query-autosave";
import { AppWorkspace } from "./ui/shell/app-workspace";
import { LoadingOverlay } from "./ui/shell/loading-overlay";
import type { MutationToastTable } from "./ui/shell/mutation-toast";
import { useBackgroundPersist } from "./ui/shell/use-background-persist";
import {
  handleMenuEvent,
  handleWorkspaceKeydown,
  isTauriRuntime,
  type MenuEventId,
  type WorkspaceAccelContext,
} from "./ui/shell/workspace-accelerators";
import { VisualQueryCanvas, type VisualQueryCanvasHandle } from "./ui/visual-query/canvas";
import { VisualQueryCopy } from "./ui/visual-query/copy";
import { createTabDocuments, serializeQueryDocument } from "./ui/visual-query/tab-documents";
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
  const databaseName = useStore(stores.session, (s) => s.databaseName);
  const tableRefs = useStore(stores.schema, (s) => s.tables);
  const tablesLoading = useStore(stores.schema, (s) => s.tablesLoading);
  const tablesErrorMessage = useStore(stores.schema, (s) => s.tablesErrorMessage);
  const columnNames = useStore(stores.schema, (s) => s.columnNames);
  const columnsByTable = useStore(stores.schema, (s) => s.columnsByTable);
  const metadataErrorCode = useStore(stores.schema, (s) => s.metadataErrorMessage);
  const tabs = useStore(stores.tabs, (s) => s.tabs);
  const activeTabId = useStore(stores.tabs, (s) => s.activeTabId);
  const tabsReady = useStore(stores.tabs, (s) => s.tabsReady);
  const pendingDeletedIds = useStore(stores.tabs, (s) => s.pendingDeletedIds);
  const savedQueryId = useStore(
    stores.tabs,
    (s) => s.tabs.find((t) => t.id === s.activeTabId)?.savedQueryId ?? null,
  );
  const queryText = useStore(
    stores.tabs,
    (s) => s.tabs.find((t) => t.id === s.activeTabId)?.queryText ?? "",
  );
  const activeTabDatabaseName = useStore(
    stores.tabs,
    (s) => s.tabs.find((t) => t.id === s.activeTabId)?.databaseName ?? null,
  );
  const status = useStore(
    stores.tabs,
    (s) => s.tabs.find((t) => t.id === s.activeTabId)?.status ?? IDLE_STATUS,
  );
  const compact = useStore(
    stores.tabs,
    (s) => s.tabs.find((t) => t.id === s.activeTabId)?.compact ?? null,
  );
  const raw = useStore(stores.tabs, (s) => s.tabs.find((t) => t.id === s.activeTabId)?.raw ?? null);
  const selectedTableSchema = useStore(
    stores.tabs,
    (s) => s.tabs.find((t) => t.id === s.activeTabId)?.selectedTableSchema ?? null,
  );
  const selectedTableName = useStore(
    stores.tabs,
    (s) => s.tabs.find((t) => t.id === s.activeTabId)?.selectedTableName ?? null,
  );
  const mutationToast = useStore(
    stores.tabs,
    (s) => s.tabs.find((t) => t.id === s.activeTabId)?.mutationToast ?? null,
  );
  const libraryQueries = useStore(stores.library, (s) => s.queries);
  const libraryFolders = useStore(stores.library, (s) => s.folders);

  // Background persist (Swift `scenePhase == .background` equivalent): saves
  // typed query text on hide/close without re-sending cached results.
  useBackgroundPersist(stores.tabs);

  /** Last live profile id — store clears before panel calls onDisconnected. */
  const lastProfileIdRef = useRef<ProfileId | null>(null);
  const formVisibilityTouchedRef = useRef(false);
  const restoreAttemptedRef = useRef(false);
  const tabDocumentsRef = useRef(createTabDocuments());
  const savedQueryCacheRef = useRef(createSavedQueryResultCache());
  const [profilesReady, setProfilesReady] = useState(false);
  const [profiles, setProfiles] = useState<ConnectionProfileDto[]>([]);
  const [profileCount, setProfileCount] = useState(0);
  const [formVisible, setFormVisible] = useState(false);
  const [docsEpoch, setDocsEpoch] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [overlayPhase, setOverlayPhase] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [connectionCollapsed, setConnectionCollapsed] = useState(false);
  const [missingDatabase, setMissingDatabase] = useState(false);
  const [selectedSchema, setSelectedSchema] = useState<string | null>(null);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [dateFormat, setDateFormat] = useState<QueryResultsDateFormat>(loadDateFormat);
  const [primaryKeyColumns, setPrimaryKeyColumns] = useState<string[]>([]);
  const [browsePage, setBrowsePage] = useState(0);
  const canvasHandleRef = useRef<VisualQueryCanvasHandle | null>(null);
  const connectionPanelRef = useRef<ConnectionPanelHandle | null>(null);
  /**
   * Pulses true→false around a saved-query selection's queryText load, reusing
   * the autosave hook's isRestoring skip so the loaded SQL is never mistaken
   * for a live edit and persisted back (T10 critical fix: selecting a query
   * must not clobber another SavedQuery's text via a stale debounce).
   */
  const [querySelectRestoring, setQuerySelectRestoring] = useState(false);
  const accelCtxRef = useRef<WorkspaceAccelContext>({
    newTab: () => {},
    closeTab: () => {},
    runQuery: () => {},
    canRun: () => false,
    welcome: true,
    openHelp: () => {},
    openShortcuts: () => {},
    openSettings: () => {},
  });

  const schemaNames = useMemo(() => {
    const names = new Set<string>();
    for (const table of tableRefs) {
      if (table.schema !== undefined) names.add(table.schema);
    }
    return [...names].sort();
  }, [tableRefs]);
  const visibleTables = selectedSchema
    ? tableRefs.filter((table) => table.schema === selectedSchema)
    : tableRefs;
  const executingQueryId = status.kind === "running" ? savedQueryId : null;

  // sourceTable mirrors Swift's connection.selectedTable: only set right after
  // an actual table browse (tabs-store.applyRunSuccess resolves it fresh on
  // every run, clearing it for plain SELECT/canvas results) — DetailContent
  // modals (row edit / delete) must only treat browsed-table grids as editable.
  // Memoized so effects keyed on it don't re-fire every render.
  const sourceTable = useMemo(
    () =>
      selectedTableName !== null
        ? { schema: selectedTableSchema ?? undefined, name: selectedTableName }
        : undefined,
    [selectedTableSchema, selectedTableName],
  );
  const hasNextPage = (raw?.rows.length ?? 0) > PAGE_SIZE;
  const hasPrevPage = browsePage > 0;

  // Reset pagination whenever the browsed table (or active tab) changes —
  // page 0 is always the correct start for a newly-selected table.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps are intentional re-run triggers (table/tab change), not values read in the effect body.
  useEffect(() => {
    setBrowsePage(0);
  }, [activeTabId, selectedTableSchema, selectedTableName]);

  useEffect(() => {
    if (connectionId === null || sourceTable === undefined) {
      setPrimaryKeyColumns([]);
      return;
    }
    let cancelled = false;
    void ipc
      .listColumns(connectionId, {
        schema: sourceTable.schema,
        name: sourceTable.name,
        tableType: "regular",
      })
      .then((columns) => {
        if (cancelled) return;
        setPrimaryKeyColumns(columns.filter((c) => c.isPrimaryKey).map((c) => c.name));
      })
      .catch(() => {
        if (cancelled) return;
        setPrimaryKeyColumns([]);
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId, ipc, sourceTable]);

  useSavedQueryAutosave({
    stores,
    queryText,
    isRestoring: overlayPhase !== null || !tabsReady || querySelectRestoring,
  });

  useEffect(() => {
    if (!querySelectRestoring) return;
    setQuerySelectRestoring(false);
  }, [querySelectRestoring]);

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
        setProfiles(list);
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

  useEffect(() => {
    if (!profilesReady || profileCount === 0 || stores.session.getState().isConnected) return;
    if (restoreAttemptedRef.current || formVisibilityTouchedRef.current) return;
    restoreAttemptedRef.current = true;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        if (cancelled || formVisibilityTouchedRef.current) return;
        if (stores.session.getState().isConnected) return;
        setOverlayPhase("Initializing…");
        await stores.tabs
          .getState()
          .refresh()
          .catch(() => {
            /* best-effort hydrate */
          });
        if (cancelled || formVisibilityTouchedRef.current) {
          setOverlayPhase(null);
          return;
        }
        setOverlayPhase("Restoring tabs…");
        const list = await ipc.listProfiles();
        const tabState = stores.tabs.getState();
        const active = tabState.tabs.find((tab) => tab.id === tabState.activeTabId);
        const byTab = active?.connectionId
          ? list.find((profile) => profile.id === active.connectionId)
          : undefined;
        const profileToConnect = byTab ?? list[0];
        if (profileToConnect === undefined) {
          setOverlayPhase(null);
          return;
        }
        if (cancelled || formVisibilityTouchedRef.current) {
          setOverlayPhase(null);
          return;
        }
        setOverlayPhase("Connecting to database…");
        try {
          const result = await stores.session.getState().connect(profileToConnect.id);
          if (cancelled || formVisibilityTouchedRef.current) {
            const live = stores.session.getState();
            if (
              formVisibilityTouchedRef.current &&
              !cancelled &&
              live.profileId === profileToConnect.id
            ) {
              await live.disconnect().catch(() => {
                /* user started a new profile; drop the restore session */
              });
            }
            setOverlayPhase(null);
            return;
          }
          stores.acknowledgeConnect(result.profileId);
          setOverlayPhase("Loading databases…");
          const databases = await ipc.listDatabases(result.connectionId);
          const wanted = active?.databaseName;
          if (wanted && databases.includes(wanted)) {
            await stores.session.getState().switchDatabase(wanted);
            setMissingDatabase(false);
          } else if (wanted) {
            // Persisted db missing from the live list: clear the selection
            // rather than keep connect's default profile.database — the
            // picker must show the "Select DB" pulse with nothing chosen.
            stores.session.setState({ databaseName: null });
            setMissingDatabase(true);
          }
          if (!stores.schema.getState().tablesLoading) {
            setOverlayPhase(null);
          }
        } catch (error) {
          if (cancelled) return;
          setOverlayPhase(null);
          setLaunchError(humanIpcErrorMessage(error));
        }
      })();
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [profilesReady, profileCount, ipc, stores]);

  useEffect(() => {
    document.title = databaseName ?? "DragonDB";
  }, [databaseName]);

  useEffect(() => {
    if (tablesLoading) {
      setOverlayPhase((current) => (current === null ? null : "Loading tables…"));
    } else {
      setOverlayPhase((current) => (current === "Loading tables…" ? null : current));
    }
  }, [tablesLoading]);

  const handleFormVisibleChange = useCallback((next: boolean) => {
    formVisibilityTouchedRef.current = true;
    setOverlayPhase(null);
    setFormVisible(next);
  }, []);

  const handleProfilesLoaded = useCallback(
    (count: number) => {
      setProfileCount(count);
      void ipc.listProfiles().then(setProfiles, () => undefined);
    },
    [ipc],
  );

  useEffect(() => {
    void stores.tabs
      .getState()
      .refresh()
      .catch(() => {
        /* best-effort hydrate on start */
      });
  }, [stores]);

  const welcome = profilesReady && profileCount === 0 && !formVisible;

  function handleNewTab(): void {
    const created = stores.tabs.getState().createTab();
    tabDocumentsRef.current.getOrCreate(created.id);
  }

  function handleCloseTab(id: string): void {
    stores.tabs.getState().closeTab(id);
    tabDocumentsRef.current.delete(id);
  }

  useLayoutEffect(() => {
    if (activeTabId === null) return;
    if (tabDocumentsRef.current.get(activeTabId) !== undefined) return;
    const activeTab = stores.tabs.getState().tabs.find((tab) => tab.id === activeTabId);
    if (activeTab?.visualDocumentJson) {
      tabDocumentsRef.current.hydrate(activeTabId, activeTab.visualDocumentJson);
    } else {
      tabDocumentsRef.current.getOrCreate(activeTabId);
    }
    setDocsEpoch((value) => value + 1);
  }, [activeTabId, stores]);

  useLayoutEffect(() => {
    accelCtxRef.current = {
      newTab: handleNewTab,
      closeTab: () => {
        const id = stores.tabs.getState().activeTabId;
        if (id !== null) handleCloseTab(id);
      },
      runQuery: () => {
        canvasHandleRef.current?.runIfRunnable();
      },
      canRun: () => canvasHandleRef.current?.canRun() ?? false,
      welcome,
      openHelp: () => setHelpOpen(true),
      openShortcuts: () => setShortcutsOpen(true),
      openSettings: () => setSettingsOpen(true),
    };
  });

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void listen<MenuEventId>("dragondb://menu", (event) => {
      handleMenuEvent(event.payload, accelCtxRef.current);
    })
      .then((fn) => {
        if (cancelled) {
          fn();
          return;
        }
        unlisten = fn;
      })
      .catch(() => {
        /* non-Tauri unit tests still exercise the keydown fallback */
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (isTauriRuntime()) return;
    function onKeyDown(event: KeyboardEvent): void {
      handleWorkspaceKeydown(event, accelCtxRef.current);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!welcome) return;
    const ids = stores.tabs.getState().tabs.map((tab) => tab.id);
    tabDocumentsRef.current.resetAll(ids);
    savedQueryCacheRef.current.clear();
    stores.tabs.getState().clearInMemoryResults();
  }, [welcome, stores]);

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
    stores.tabs.getState().clearInMemoryResults();
    setDocsEpoch((value) => value + 1);
  }

  function resetTabDocument(tabId: string): void {
    const document = tabDocumentsRef.current.getOrCreate(tabId);
    const priorFrom = document.committedFromTable;
    document.startOver();
    const activeId = stores.tabs.getState().activeTabId;
    if (tabId === activeId && priorFrom !== null) {
      stores.schema.getState().clearColumns();
    }
    if (tabId === activeId) {
      setDocsEpoch((value) => value + 1);
    }
    stores.tabs.getState().restoreSavedQueryResult(tabId, null);
  }

  function handleConnected(result: ConnectResult): void {
    if (stores.shouldRemountCanvasOnConnect(result.profileId)) {
      resetTabDocuments();
    }
    stores.acknowledgeConnect(result.profileId);
    // The connection form is a sheet over the workspace now: once the session
    // is live its job is done, so dismiss it instead of leaving a modal over
    // the tables the user just connected to. Disconnect lives in the sidebar.
    handleFormVisibleChange(false);
  }

  function handleDisconnected(): void {
    stores.noteCanvasDisconnect(lastProfileIdRef.current);
    setSelectedSchema(null);
    setSchemaError(null);
  }

  function handleSwitchSuccess(result: ConnectResult): void {
    resetTabDocuments();
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

  const onRunSql =
    isConnected && connectionId !== null
      ? (sql: ExecutableSQL) => runSqlOnActiveTab(stores, ipc, sql)
      : undefined;

  function handleQueryTextChange(text: string): void {
    const tabId = stores.tabs.getState().activeTabId;
    if (tabId === null) return;
    stores.tabs.getState().setQueryText(tabId, text);
  }

  function handleDocumentChange(document: QueryDocument): void {
    const tabId = stores.tabs.getState().activeTabId;
    if (tabId === null) return;
    void stores.tabs
      .getState()
      .setVisualDocumentJson(tabId, serializeQueryDocument(document))
      .catch(() => {
        /* best-effort visual document persistence */
      });
  }

  function handleCancelSql(): void {
    const liveId = stores.session.getState().connectionId;
    if (liveId === null) return;
    const tabId = stores.tabs.getState().activeTabId;
    if (tabId !== null) {
      stores.tabs.getState().applyRunCancelled(tabId);
    }
    void ipc.cancelQuery(liveId).catch(() => undefined);
  }

  function handleClearTabResults(): void {
    const tabId = stores.tabs.getState().activeTabId;
    if (tabId === null) return;
    stores.tabs.getState().clearTabResults(tabId);
  }

  function handleDismissMutationToast(): void {
    const tabId = stores.tabs.getState().activeTabId;
    if (tabId === null) return;
    stores.tabs.getState().clearMutationToast(tabId);
  }

  // View Table on the mutation toast selects + browses the mutated table
  // (Swift MainSplitView.onViewTable), schema-qualified via extractTableName
  // so it never degrades to an unqualified `SELECT * FROM "name"`.
  //
  // Swift only calls requestTableQuery explicitly when the table was already
  // selectedTable (its SwiftUI .onChange(of: selectedTable) fires the query
  // automatically otherwise). Tauri has no such reactive watcher, so
  // runBrowseOnActiveTab is the single mechanism that both selects (via
  // applyRunSuccess's selectedTable option) and loads the table in every
  // case — this reproduces Swift's net effect (exactly one query per click)
  // without a second, easy-to-double-fire code path.
  function handleViewMutationTable(table: MutationToastTable): void {
    void runBrowseOnActiveTab(
      stores,
      ipc,
      { schema: table.schema, name: table.name, tableType: "regular" },
      0,
    ).catch(() => undefined);
  }

  function handleBrowseTable(table: TableRef): void {
    void runBrowseOnActiveTab(stores, ipc, table, 0).catch(() => undefined);
  }

  function handleExpandTable(table: TableRef): void {
    const liveId = stores.session.getState().connectionId;
    if (liveId === null) return;
    void stores.schema.getState().loadExpanderColumns(liveId, table);
  }

  async function handleDropTable(table: TableRef): Promise<void> {
    await ipc.dropTable(table);
    const liveId = stores.session.getState().connectionId;
    if (liveId === null) return;
    await stores.schema.getState().reloadTables(liveId);
  }

  async function handleTruncateTable(table: TableRef): Promise<void> {
    await ipc.truncateTable(table);
    const liveId = stores.session.getState().connectionId;
    if (liveId === null) return;
    await stores.schema.getState().reloadTables(liveId);
  }

  function handleGenerateTableDdl(table: TableRef): Promise<string> {
    return ipc.generateTableDdl(table);
  }

  function handleRefreshTables(_table: TableRef): void {
    const liveId = stores.session.getState().connectionId;
    if (liveId === null) return;
    void stores.schema.getState().reloadTables(liveId);
  }

  async function handleFetchAllTable(
    table: TableRef,
  ): Promise<{ columns: string[]; rows: unknown[][] }> {
    const liveId = stores.session.getState().connectionId;
    if (liveId === null) throw new Error("Not connected");
    const result = await ipc.runQuery(liveId, {
      text: `SELECT * FROM ${quotedTableSql(table)}`,
      params: [],
    });
    return { columns: result.columns, rows: result.rows };
  }

  function handleNextPage(): void {
    if (sourceTable === undefined) return;
    const nextPage = browsePage + 1;
    void runBrowseOnActiveTab(
      stores,
      ipc,
      { schema: sourceTable.schema, name: sourceTable.name, tableType: "regular" },
      nextPage,
    )
      .then(() => setBrowsePage(nextPage))
      .catch(() => undefined);
  }

  function handlePrevPage(): void {
    if (sourceTable === undefined || browsePage === 0) return;
    const prevPage = browsePage - 1;
    void runBrowseOnActiveTab(
      stores,
      ipc,
      { schema: sourceTable.schema, name: sourceTable.name, tableType: "regular" },
      prevPage,
    )
      .then(() => setBrowsePage(prevPage))
      .catch(() => undefined);
  }

  async function handleUpdateRow(
    patch: Record<string, unknown | null>,
    primaryKey: Record<string, unknown>,
  ): Promise<void> {
    if (connectionId === null || sourceTable === undefined) return;
    await ipc.updateRow({
      connectionId,
      table: { schema: sourceTable.schema, name: sourceTable.name, tableType: "regular" },
      primaryKey,
      patch,
    });
    await runBrowseOnActiveTab(
      stores,
      ipc,
      { schema: sourceTable.schema, name: sourceTable.name, tableType: "regular" },
      browsePage,
    ).catch(() => undefined);
  }

  async function handleDeleteRows(primaryKeys: Record<string, unknown>[]): Promise<void> {
    if (connectionId === null || sourceTable === undefined) return;
    await ipc.deleteRows({
      connectionId,
      table: { schema: sourceTable.schema, name: sourceTable.name, tableType: "regular" },
      primaryKeys,
    });
    await runBrowseOnActiveTab(
      stores,
      ipc,
      { schema: sourceTable.schema, name: sourceTable.name, tableType: "regular" },
      browsePage,
    ).catch(() => undefined);
  }

  async function handleSaveCsv(csv: string): Promise<void> {
    await ipc.saveCsvFile(csv).catch(() => undefined);
  }

  function handleSelectQuery(queryId: string | null): void {
    const tabId = stores.tabs.getState().activeTabId;
    if (tabId === null) return;
    const activeTab = stores.tabs.getState().tabs.find((tab) => tab.id === tabId);
    const previousSavedQueryId = activeTab?.savedQueryId ?? null;
    if (queryId === null) {
      // Pulse querySelectRestoring so any pending autosave debounce is
      // cancelled before savedQueryId clears — otherwise persistHatchText
      // would auto-create an extra SavedQuery from the stale hatch buffer.
      setQuerySelectRestoring(true);
      stores.tabs.getState().setSavedQueryId(tabId, null);
      stores.tabs.getState().restoreSavedQueryResult(tabId, null);
      return;
    }
    stores.tabs.getState().setSavedQueryId(tabId, queryId);
    if (queryId !== previousSavedQueryId) {
      // Load the selection's hatch SQL into the active tab's buffer — pulse
      // querySelectRestoring first so the autosave hook treats this the same
      // as a tab restore and never schedules a persist for it. Pulsing here
      // (regardless of whether a matching library entry was found yet) also
      // cancels any debounce still pending for the query we just navigated
      // away from, so it can never clobber the newly-selected query's text.
      setQuerySelectRestoring(true);
      const query = stores.library.getState().queries.find((item) => item.id === queryId);
      if (query !== undefined) {
        stores.tabs.getState().setQueryText(tabId, query.queryText);
      }
    }
    stores.tabs.getState().restoreSavedQueryResult(tabId, savedQueryCacheRef.current.read(queryId));
  }

  async function handleClearDatabaseSelection(): Promise<void> {
    stores.session.setState({ databaseName: null });
    setMissingDatabase(true);
    const tabId = stores.tabs.getState().activeTabId;
    if (tabId !== null) {
      await stores.tabs.getState().setDatabaseName(tabId, null);
    }
    stores.schema.getState().clear();
  }

  async function handleSwitchDatabase(name: string): Promise<void> {
    await stores.session.getState().switchDatabase(name);
    setMissingDatabase(false);
    const tabId = stores.tabs.getState().activeTabId;
    if (tabId !== null) {
      await stores.tabs.getState().setDatabaseName(tabId, name);
    }
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
    resetTabDocument(tabId);
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

  async function handleMoveQuery(id: string, folderId: string | null): Promise<void> {
    await stores.library.getState().moveSavedQuery(id, folderId);
  }

  async function handleDeleteFolder(id: string, deleteQueries: boolean): Promise<void> {
    await stores.library.getState().deleteFolder(id, deleteQueries);
  }

  async function handleLibraryRefresh(): Promise<void> {
    await stores.library.getState().refresh();
    const liveId = stores.session.getState().connectionId;
    if (liveId === null) return;
    await stores.schema.getState().reloadTables(liveId);
    try {
      // Applies the refreshed database list to the connection picker instead
      // of discarding it — the picker owns its own `databases` state, so the
      // refresh has to be pushed in via this imperative handle.
      await connectionPanelRef.current?.refreshDatabases();
    } catch {
      /* best-effort database list refresh */
    }
  }

  async function handleSelectSchema(schema: string | null): Promise<void> {
    const liveId = stores.session.getState().connectionId;
    if (liveId === null) return;
    try {
      await stores.schema.getState().setSearchPath(liveId, schema);
      setSelectedSchema(schema);
      setSchemaError(null);
    } catch {
      setSchemaError(QueriesCopy.schemaError);
    }
  }

  // Visual canvas surfaces the Swift-parity no-database Run alert (decision
  // 14) via canvas.tsx's handleRunQuery guard, reusing
  // SqlHatchCopy.selectDatabaseAlert verbatim on both Visual and SQL:
  // "Select a database from the sidebar before running queries."
  const tabDocument = activeTabId === null ? undefined : tabDocumentsRef.current.get(activeTabId);
  const canvas =
    workspaceReady && tabDocument !== undefined ? (
      <VisualQueryCanvas
        key={`${activeTabId}:${docsEpoch}`}
        ref={canvasHandleRef}
        document={tabDocument}
        tables={tables}
        columnNames={columnNames}
        metadataErrorMessage={metadataErrorMessage}
        isConnected={isConnected}
        onRunQuery={onRunQuery}
        onDocumentChange={handleDocumentChange}
        queryText={queryText}
        onQueryTextChange={handleQueryTextChange}
        onRunSql={onRunSql}
        databaseName={activeTabDatabaseName ?? databaseName}
        sqlRunning={status.kind === "running"}
        onCancelSql={handleCancelSql}
        onClearTabResults={handleClearTabResults}
        onCommittedFromChange={handleCommittedFromChange}
        historyStore={stores.history}
        saveTextFile={ipc.saveTextFile}
      />
    ) : null;

  const platform = typeof navigator === "undefined" ? "Win32" : navigator.platform;
  const chromeDialogs = (
    <>
      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} platform={platform} />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} platform={platform} />
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={(open) => {
          setSettingsOpen(open);
          // SettingsDialog owns its own localStorage-backed radio state; pick
          // up the saved value on close so the results grid re-renders dates.
          if (!open) setDateFormat(loadDateFormat());
        }}
      />
    </>
  );

  if (!profilesReady) {
    if (overlayPhase) {
      return (
        <>
          <LoadingOverlay phase={overlayPhase} />
          {chromeDialogs}
        </>
      );
    }
    return (
      <>
        <main aria-busy="true" className="app-startup" />
        {chromeDialogs}
      </>
    );
  }

  if (welcome) {
    return (
      <>
        <main className="app-welcome">
          <WelcomeView onConnectToServer={() => handleFormVisibleChange(true)} />
        </main>
        {chromeDialogs}
      </>
    );
  }

  return (
    <>
      {overlayPhase ? <LoadingOverlay phase={overlayPhase} /> : null}
      <main className={connectionCollapsed ? "app-shell app-shell--collapsed" : "app-shell"}>
        {launchError ? (
          <div className="app-connection-error" role="alert">
            <strong>{ConnectionCopy.connectionError}</strong>
            <p>{launchError}</p>
          </div>
        ) : null}
        {connectionCollapsed ? (
          <button
            type="button"
            className="app-show-connection"
            onClick={() => setConnectionCollapsed(false)}
          >
            {ConnectionCopy.showConnection}
          </button>
        ) : (
          <ConnectionPanel
            ref={connectionPanelRef}
            ipc={ipc}
            isConnected={isConnected}
            activeProfileId={profileId ?? undefined}
            formVisible={formVisible}
            onFormVisibleChange={handleFormVisibleChange}
            onProfilesLoaded={handleProfilesLoaded}
            tables={visibleTables}
            tablesLoading={tablesLoading}
            tablesErrorMessage={tablesErrorMessage}
            onBrowse={handleBrowseTable}
            columnsByTable={columnsByTable}
            executing={status.kind === "running"}
            onDrop={handleDropTable}
            onTruncate={handleTruncateTable}
            onGenerateDdl={handleGenerateTableDdl}
            onRefresh={handleRefreshTables}
            onFetchAll={handleFetchAllTable}
            onExpand={handleExpandTable}
            saveCsvFile={(csv, defaultPath) => ipc.saveCsvFile(csv, defaultPath)}
            saveTextFile={(text, defaultPath, filter) =>
              ipc.saveTextFile(text, defaultPath, filter)
            }
            connectionId={connectionId}
            databaseName={databaseName}
            onSwitchDatabase={handleSwitchDatabase}
            onClearDatabase={handleClearDatabaseSelection}
            onCollapse={() => setConnectionCollapsed(true)}
            missingDatabase={missingDatabase}
            connectProfile={(id) => stores.session.getState().connect(id)}
            disconnectSession={() => stores.session.getState().disconnect()}
            onConnected={handleConnected}
            onDisconnected={handleDisconnected}
            onSwitchSuccess={handleSwitchSuccess}
            onSwitchFailure={handleSwitchFailure}
          />
        )}
        <div className="app-main-column" aria-busy={workspaceReady ? undefined : true}>
          <AppWorkspace
            workspaceReady={workspaceReady}
            tabs={tabs}
            activeTabId={activeTabId}
            pendingDeletedIds={pendingDeletedIds}
            profiles={profiles}
            profileId={profileId}
            libraryQueries={libraryQueries}
            libraryFolders={libraryFolders}
            savedQueryId={savedQueryId}
            executingQueryId={executingQueryId}
            schemaNames={schemaNames}
            selectedSchema={selectedSchema}
            schemaError={schemaError}
            status={status}
            compact={compact}
            raw={raw}
            dateFormat={dateFormat}
            query={sourceTable !== undefined ? queryText : ""}
            sourceTable={sourceTable}
            primaryKeyColumns={primaryKeyColumns}
            browse={sourceTable !== undefined}
            hasNextPage={hasNextPage}
            hasPrevPage={hasPrevPage}
            onNextPage={handleNextPage}
            onPrevPage={handlePrevPage}
            onUpdateRow={handleUpdateRow}
            onDeleteRows={handleDeleteRows}
            onSaveCsv={handleSaveCsv}
            mutationToast={mutationToast}
            canvas={canvas}
            onNewTab={handleNewTab}
            onSwitchTab={(id) => stores.tabs.getState().switchTab(id)}
            onCloseTab={handleCloseTab}
            onSelectQuery={handleSelectQuery}
            onNewQuery={handleNewQuery}
            onRenameQuery={handleRenameQuery}
            onDeleteQuery={handleDeleteQuery}
            onMoveQuery={handleMoveQuery}
            onDeleteFolder={handleDeleteFolder}
            onLibraryRefresh={handleLibraryRefresh}
            onDuplicateQuery={(id) => {
              void stores.library.getState().duplicateSavedQuery(id);
            }}
            onRenameFolder={(id, name) => {
              void stores.library.getState().renameQueryFolder(id, name);
            }}
            onCreateFolder={(name) => stores.library.getState().createQueryFolder(name)}
            hasCachedResult={(id) => savedQueryCacheRef.current.read(id) !== null}
            onSelectSchema={(schema) => {
              void handleSelectSchema(schema);
            }}
            onDismissSchemaError={() => setSchemaError(null)}
            onDismissMutationToast={handleDismissMutationToast}
            onViewMutationTable={handleViewMutationTable}
          />
        </div>
        {chromeDialogs}
      </main>
    </>
  );
}
