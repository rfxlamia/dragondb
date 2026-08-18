# SP-4b remaining UI — Swift parity prerequisite ledger

**Date:** 2026-08-14
**Status:** discovery ledger (not an implementation spec). First-slice shell + read-only results **shipped** 2026-08-15. Workspace chrome (welcome, tables list, Queries column, tabs, history, URI mode, native Help/Shortcuts/Settings) **shipped** 2026-08-15 on `feat/sp-4b-ui` (HEAD at ledger update: `e7b97f5`).
**Swift tree:** `~/project/dragondb-swift` (read-only)
**Tauri tree:** `~/project/dragondb`
**Parent:** `docs/superpowers/specs/2026-08-10-cross-platform-design.md` §12.1, §12.2, §13.1

This file is the reviewable done-bar for **all of SP-4b**. First-slice (app shell + read-only results grid, canvas stays primary) is extracted in §6. Remaining clusters are **SEQUENCE**, never silent-drop.

**Disposition legend**

| Tag | Meaning |
|---|---|
| **SHIP** | Required for full SP-4b complete. Also in first-slice if marked FIRST-SLICE. |
| **SEQUENCE** | Required for full SP-4b complete, but *after* first-slice. Must not vanish. |
| **needs-decision** | Code exists on both sides or is ambiguous; product intent is not guessed. |
| **DROP (dead)** | Swift view is unreachable from `DragonDBApp` / `RootView`. Evidence cited. Behaviors that still live elsewhere remain SHIP/SEQUENCE. |

**Hierarchy vs behavior (read before cloning MainSplitView)**

Swift hosts the visual canvas as a **mode inside** `QueryEditorView` (`editorMode: QueryEditorMode = .sql` default; visual content is a `@ViewBuilder` slot). Tauri already shipped the canvas as the **primary editor** (`src/App.tsx` + `src/ui/visual-query/canvas.tsx`). A literal `MainSplitView` clone (saved-queries column | SQL editor on top of results) would demote the canvas and fight SP-4a. Swift *behaviors* below must still land somewhere; the *view tree* must not.

Already-decided **out of SP-4b product chrome** (still listed where Swift screens would have been touched): light-only / no dark mode; no SP-5 distribution; no SP-6 archive; no SwiftData → rusqlite importer (release-notes obligation remains until SP-6). Do not redesign `src/core/`.

---

## 1. Executive count

| Metric | Count |
|---|---:|
| Swift `Views/` files on disk | **52** (directory listing; all accounted in §2–§3) |
| Parent §12.1 claimed files | 52 |
| SP-4b clusters (§12.1) | **10** |
| SP-4a clusters (already shipped; not new SP-4b work) | 2 (cards + canvas container) |
| Master-bar checklist items (§2.1–2.10) | **100** |
| Capability-table rows (§2.11, includes all 12 §12.2 rows + extras) | **29** |
| §12 miss / miscategorization rows (§4) | **18** |
| Extra capabilities with no §12.2 row | **14** (included in §2 “Capabilities without screens”) |
| DROP (dead) view files | **3** (`ConnectionsListView`, `ResizableSplitView`, `ColumnRowView`) + `Badge` only used by dead `ColumnRowView` |
| Swift test files under `DragonDBTests/` | 25 (UI/service-relevant ones cited per cluster; visual-query suites are SP-4a) |
| Tauri UI today | `App.tsx` = welcome **or** collapsible `ConnectionPanel` (profiles + URI mode + database picker + tables list with Show All Rows / expand / DDL / export / truncate / drop) \| resizable Queries column \| `TabBar` + vertical `WorkspaceSplit` (per-tab `VisualQueryCanvas` or SQL hatch above results). History sheet from canvas toolbar. Native Help / Shortcuts / Settings. Loading overlay on launch restore. |

**Headline Tauri status**

- **DONE (UI):** SP-4a canvas plus SP-4b first-slice (shell + read-only grid) plus SP-4b workspace chrome (2026-08-15, `feat/sp-4b-ui` `e7b97f5`) plus last-slice connection chrome / SQL hatch / table browser host: welcome gating, “No connections”, tables list in the connection column (click = Show All Rows; expand loads columns + PK/FK icons; Refresh/DDL/Export/Truncate/Drop via dedicated IPC), connection-string mode, Queries column + B′ session cache, per-tab visual documents (persisted `visualDocumentJson`), tab bar (hidden at 1 tab, `+` always, Swift-style titles), history sheet + JSON/CSV/SQL export + relative dates, native Help / Shortcuts / Settings, Accel+T/W/Enter, collapsible connection sidebar, database picker, launch restore + loading overlay, Visual\|SQL hatch. SP-2/SP-3 connection panel (save / connect / disconnect / switch / delete / SSL / SSH).
- **PARTIAL:** result-grid editability UI attaches but `RowOperationError` kinds don't surface distinct messages; Edit row uses plain text inputs (no typed pickers); context-mismatch help is missing. T12 last slice: mutation toast, DetailContent modals, background persist shipped.
- **MISSING UI:** remaining SEQUENCE (context-mismatch editability help; row-editor typed pickers / saving-state disable; table-load timeout 300s). Workspace-chrome spec: `docs/pocket/spec/2026-08-15-sp4b-workspace-chrome/workspace-chrome.md`.

---

## 2. Master DONE BAR checklist

Group by cluster. Each item: Swift source → Tauri status → done criterion → slice → disposition.

### 2.1 App shell

Parent §12.1: `MainSplitView`, `RootView`, split/loading/badge/toast primitives — 7 files, 709 LOC (counts still match 2026-08-14 `wc -l`).

- [x] **Welcome vs main chrome.** Swift: `RootView.body` + `shouldShowWelcomeScreen(connectionCount:isShowingConnectionForm:)` in `Logic/AppLaunchDecisions.swift` (true iff 0 profiles and form not showing). Tauri: **DONE** `WelcomeView` when 0 profiles and form hidden (`public/onboarding.png`, “Hello, and welcome!”, “Connect to Server...”); workspace when ≥1 profile or form showing. **Done:** Given 0 saved profiles, When app launches, Then a welcome/empty state with a control that opens create-profile is shown; Given ≥1 profile, Then the connected workspace is shown. **WORKSPACE-CHROME**.
- [x] **Connection-form cancel (inline, not a sheet).** Swift: `RootView` `.sheet` on `appState.navigation.isShowingConnectionForm`, clears `connectionToEdit` on dismiss. Tauri: **DONE** for behavior — form stays inline in `ConnectionPanel`; form-level Cancel hides without saving; 0 profiles + hidden form returns to welcome. Literal Swift sheet is not required. **WORKSPACE-CHROME**.
- [x] **Create-database sheet host.** Swift: `RootView` sheet on `isShowingCreateDatabase`, `onConnect` → `RootViewModel.selectDatabase`. Tauri: **DONE** `CreateDatabaseDialog` hosted from the database picker (not a RootView sheet). `handleCreateDatabase` is create-only (`ipc.createDatabase` + best-effort list refresh); explicit Connect is the only `onSwitchDatabase` caller. Failed create keeps the previous selection (`createDatabaseError`). Failed list refresh after a confirmed create keeps the created name and Connect. Failed table reload after a confirmed switch does not repeat the switch. **Done:** after successful create, the sheet stays open with “Database created” + Connect; the session database changes only when Connect runs. **SEQUENCE**.
- [x] **Keyboard-shortcuts sheet host.** Swift: `RootView` observes `.showKeyboardShortcuts`. Tauri: **DONE** `ShortcutsDialog` from native menu + `handleMenuEvent("shortcuts")`. **Done:** Help/Shortcuts command opens a dismissible list of New Tab / Close Tab / Run Query. **WORKSPACE-CHROME**.
- [x] **Help sheet host.** Swift: `RootView` observes `.showHelp` → `HelpView`. Tauri: **DONE** `HelpDialog`; Support `https://github.com/rfxlamia/dragondb/issues`; Done dismisses. **WORKSPACE-CHROME**.
- [x] **Launch restore + loading overlay.** Swift: `RootView.task` → `RootViewModel.initializeApp`; `LoadingOverlayView(phase:)` while `loadingState.isLoading`; phases in `LoadingState.LoadingPhase` (`Initializing...`, `Restoring tabs...`, `Connecting to database...`, `Loading databases...`, `Loading tables...`). Tauri: **DONE** `App.tsx` restore path sets those phase strings and mounts `LoadingOverlay`; failure shows `Connection Error` (`ConnectionCopy.connectionError`). **Done:** Given persisted tabs + last profile, When app launches, Then overlay shows until connect+schema load finishes or fails with `Connection Error` alert. **SEQUENCE**.
- [x] **Background persist.** Swift: `scenePhase == .background` → `saveCurrentStateToTab` + `cleanupOnWindowClose`. Tauri: **DONE** `useBackgroundPersist` wired in `App.tsx` (visibilitychange + `beforeunload`/window-close hook) persists the active tab's query text; cached results are not persisted unless `includeCachedResults`. **Done:** hiding/closing the window persists active tab query text (and does not persist results unless `includeCachedResults`). **SEQUENCE**.
- [x] **Results + editor vertical split, resizable.** Swift: `MainSplitView` `VSplitView` editor row `minHeight: 250, idealHeight: 320` + results `minHeight: 300`. Tauri: **DONE** `WorkspaceSplit` (`react-resizable-panels` vertical `Group`) in `App.tsx`; canvas remounts with `key={\`${activeTabId}:${docsEpoch}\`}` (not `canvasEpoch`); canvas `minSize={250}` / results `minSize={300}`; `.app-main-column` `min-height: 550px`; divider not persisted. **Done:** canvas (primary) sits above a results pane; user can drag the divider; neither pane collapses below a min height. **FIRST-SLICE**.
- [x] **Do not clone Swift three-pane editor row.** Swift: `HSplitView` saved-queries (200–260) \| `QueryEditorView`. Tauri canvas-primary. **Done:** saved-queries are **not** required beside the canvas in first-slice; they SEQUENCE in Sidebar cluster. Literal SQL-primary clone is **rejected**. **FIRST-SLICE** (constraint). Workspace-chrome slice (2026-08-15) places Queries left of canvas without making SQL the default editor.
- [x] **Collapsible connection sidebar (`NavigationSplitView`).** Swift: connection/tables chrome can collapse. Tauri: **DONE** `connectionCollapsed` + `.app-shell--collapsed` hide the Connection column; `ConnectionCopy.showConnection` / `collapseConnection` restore it without unmounting Queries | canvas. **Done:** user can hide/show the connection column without losing Queries | canvas. **SEQUENCE**.
- [x] **Tab bar appears only when `tabs.count > 1`.** Swift: `MainSplitView` `if tabManager.tabs.count > 1 { TabBarView() }`. Tauri: **DONE** tab **strip** (`role="tablist"`) hidden at 1 tab; New Tab `+` still visible; strip at ≥2. At 1 tab a solo Untitled label + close still render (needed for close-last). **WORKSPACE-CHROME**.
- [x] **Mutation toast overlay.** Swift: `MainSplitView` bottom-trailing `MutationToastView` when `appState.query.mutationToast != nil`; View Table selects table + `requestTableQuery` if already selected; auto-dismiss 5s (`QueryState.showMutationToast`). Tauri: **DONE** `MutationToast` hosted in `AppWorkspace` above `QueryResultsPane`; successful 0-row mutation shows toast with title from `SUCCESS_TITLES`; DROP TABLE hides View Table; auto-dismisses after 5s; View Table browses the schema-qualified table (`extractTableName` schema threaded through `MutationToast.tableSchema`) — Tauri has no reactive `.onChange(of: selectedTable)` watcher, so `runBrowseOnActiveTab` is the single call that both selects and loads the table on every click rather than only when already selected. **Done:** successful mutation with 0 returned rows shows toast with title from `QueryType.successTitle`; DROP TABLE hides View Table (`MutationToastData.showViewTableButton`). **SEQUENCE**.
- [x] **DetailContent modals host.** Swift: `DetailContentModalsWrapper` on `MainSplitView`. Tauri: **DONE** `QueryResultsPane` now receives `raw`/`dateFormat`/`query`/`sourceTable`/`primaryKeyColumns`/pagination/`onUpdateRow`/`onDeleteRows`/`onSaveCsv` from `AppWorkspace`/`App.tsx`, so the JSON viewer, row editor, and delete-confirm modals attach to the results shell and call `ipc.updateRow`/`ipc.deleteRows`/`ipc.saveCsvFile`. **Done:** JSON / row editor / delete confirm attach to the shell that owns the grid. **SEQUENCE**.
- [x] **Window title = selected database.** Swift: `.navigationTitle(appState.connection.selectedDatabase?.name ?? "")`. Tauri: **DONE** `document.title = databaseName ?? "DragonDB"` (`App.tsx`). Deviation: Swift falls back to an empty string; Tauri uses `"DragonDB"` when no database is selected. **Done:** window/document title reflects current database name (or the DragonDB fallback). **SEQUENCE**.
- [x] **`LoadingOverlayView`.** Swift primitive 36 LOC. Tauri: **DONE** `src/ui/shell/loading-overlay.tsx` (`role="status"` + phase headline); mounted from `App.tsx` while `overlayPhase` is set. **Done:** dimmed overlay + phase headline. **SEQUENCE**.
- [x] **`EmptyQueryResultsView`.** Swift: `"No rows found"` vs `"Run a query to see results"` gated by `hasExecutedQuery`. Tauri: **DONE** `ResultsCopy.runQueryEmpty` / `noRowsFound`; idle (including hydrated cache) vs 0-row `ok`. **Done:** those two strings (English) in the results pane. **FIRST-SLICE**.
- [ ] **`ResizableSplitView`.** Swift: **DROP (dead)** — defined, never instantiated; live splits are SwiftUI `NavigationSplitView` / `VSplitView` / `HSplitView`. Do not port the NSSplitView wrapper.
- [ ] **`Badge`.** Swift: only used by unreachable `ColumnRowView`. **DROP (dead)** as a standalone screen. PK/FK icons in the *table expander* (`TableColumnRowView`) remain SEQUENCE under Table browser.

### 2.2 Connection

Parent §12.1: form, list, dropdown, database picker, status banner — 5 files, 1,464 LOC.

- [x] **Profile list + select.** Swift: `ConnectionDropdown` sorted by `displayName`; checkmark on active; tap inactive selects (`onSelect` → `ConnectionSidebarViewModel.selectConnection`). Tauri: **DONE** for first-slice — `ConnectionPanel` `<ul>` + switch confirm. **Done:** list persisted profiles (`ipc.listProfiles`); selecting a different live profile confirms switch. **SEQUENCE** remains: restyle into sidebar picker.
- [x] **Empty connections copy.** Swift: dropdown `"No connections"`; `ConnectionsListView` `ContentUnavailableView` “No Connections”. Tauri: **DONE** `ConnectionCopy.noConnections` when the list is empty and the form is showing. **WORKSPACE-CHROME**.
- [x] **New Connection.** Swift: `ConnectionDropdown.newConnectionButton` → `showConnectionForm()`. Tauri: **DONE** `ConnectionCopy.newProfile` → `startNewProfile`. **FIRST-SLICE**.
- [x] **Edit connection.** Swift: pencil in dropdown → `connectionToEdit` + form sheet. Tauri: **DONE** for first-slice — selecting a profile fills the form; `saveProfile` with that id. No distinct Edit affordance. **SEQUENCE** if a pencil/sheet is required. **FIRST-SLICE**.
- [x] **Delete connection with confirm.** Swift: trash → `ConnectionAlertsModifier` “Delete Connection?” irreversible copy. Tauri: **DONE** `pendingDeleteId` + `ConnectionCopy.deletePrompt`; disconnects if active then `deleteProfile`. **FIRST-SLICE**.
- [x] **Test connection (does not persist session).** Swift: `ConnectionFormView.test` → `ConnectionFormViewModel.testConnection` (SSH then DB, teardown tunnel, `ConnectionStatusBanner` testing/testingSSH/success/error, min 150ms). Tauri: **DONE** `ConnectionForm` Test → `ipc.testConnection` (`TEST_BANNER_MIN_MS = 150`); banner phases `testing` / `testingSSH` / `success` / `error`; does not call `connect` / does not set `sessionClaimed`. **Done:** Test does not leave `isConnected`; banner states match Swift copy. **SEQUENCE**.
- [x] **Save-then-Connect prompt on create.** Swift: `showConnectionSavedAlert` “Connection Created” / “Connect now?” / Not Now. Tauri: **DONE** `ConnectionCreatedDialog` after first save of a new profile (`connectionCreated` / `connectNowPrompt` / Connect now / Not now). `canConnect` still requires saved + not dirty. **Done:** cannot Connect an unsaved dirty form; post-save Connect prompt ships. **SEQUENCE**.
- [x] **Individual fields: name optional, host, port, SSL, database, username, password show/hide, keychain load.** Swift: `ConnectionFormView.individualFieldsView`. Tauri: **DONE** for show/hide — `connection-form.tsx` toggles password `type` via `showPassword`. Name is always a field (empty → `null`; Swift plus-button not ported). Keychain *reveal* of a stored secret is not a separate control; empty password on edit still means “keep stored”. **Done:** secrets never appear in sqlite (`ConnectionProfileDto` has no password); empty password on edit means “keep stored”; show/hide ships. **SEQUENCE**.
- [x] **SSL modes + SSH collapse.** Swift: `SSLMode.allCases` picker + hover tooltip; SP-2 table: allow/prefer → disable TLS; verify-ca/verify-full hidden when SSH. Tauri: **DONE** `SSL_MODES_SSH` vs `SSL_MODES_ALL` in `connection-form.tsx`; Rust collapse documented in SP-2 spec. **FIRST-SLICE**.
- [x] **SSH tunnel fields + key browse (contents to keyring, path hint only).** Swift: `browseForPrivateKey` + passphrase optional. Tauri: **DONE** file input reads `file.text()` into `secrets.sshPrivateKey`. **FIRST-SLICE**.
- [x] **Connection-string input mode.** Swift: toolbar toggle individual ↔ URI; URI **read-only when editing** with Copy. Tauri: **DONE** `connection-string-fields.tsx` + `parseConnectionString` on Save; edit = read-only + Copy (`YOUR_PASSWORD`). **WORKSPACE-CHROME**.
- [x] **Keychain denied alert.** Swift: `showKeychainAlert`. Tauri: save failure surfaces as `errorMessage` via `IpcError`. **Done:** keyring failure is a human message, profile row not half-saved (SP-2 atomicity). **FIRST-SLICE**.
- [x] **Status banner.** Swift: `ConnectionStatusBanner` four non-idle states. Tauri: **DONE** `ConnectionStatusBanner` phases `testing` / `testingSSH` / `success` / `error`, plus a connected line when idle+connected. **SEQUENCE**.
- [x] **Database picker (list + switch).** Swift: `ConnectionDatabasePicker` after a connection is selected; disabled until `isConnected`; empty `"No databases"`; pulse `"⚠️ Select DB"`. Tauri: **DONE** `connection-database-picker.tsx` after connect; `ipc.listDatabases` / `switchDatabase`; empty `"No databases"`; pulse `ConnectionCopy.selectDbPulse`. **Done:** Given connected session, When user picks another database on the same server, Then tables reload for that database. **SEQUENCE**.
- [x] **Create Database entry from picker.** Swift: picker footer → `navigation.showCreateDatabase()`. Tauri: **DONE** picker Create database button opens `CreateDatabaseDialog`. **SEQUENCE**.
- [x] **Delete database from picker row.** Swift: trash → confirm “Delete Database?” → `ConnectionSidebarViewModel.deleteDatabase`. Tests: `ConnectionSidebarViewModelTests`, `DatabaseServiceDeleteDatabaseTests`. Tauri: **DONE** picker Drop database → confirm → `ipc.deleteDatabase` + list refresh; error copy `deleteDatabaseError` leaves the previous selection. Confirm reuses the irreversible profile-delete prompt rather than Swift “Delete Database?”. **SEQUENCE**.
- [x] **Restore last connection on launch.** Swift: `ConnectionsDatabasesSidebar.task` `restoreLastConnection`; `RootViewModel.initializeApp` uses active tab’s `connectionId`. Tauri: **DONE** launch restore auto-connects the active tab’s profile (else first profile) after profiles hydrate; overlay + `Connection Error` on failure. **SEQUENCE**.
- [ ] **`ConnectionsListView` (600×500 management window).** Swift: **DROP (dead)** — no caller outside its own file / preview. Behaviors duplicated by dropdown + form. Favorite **star** is display-only here; `isFavorite` is never written in any Swift view (**needs-decision**: keep field on DTO, no UI).

### 2.3 Sidebar, saved queries, folders

Parent §12.1: 8 files, 1,544 LOC.

- [x] **Tables names in the connection column after connect.** Swift: `ConnectionsDatabasesSidebar.mainContent` (also schema picker + db picker). Tauri: **DONE** `ConnectionTablesList` — loading / names / “No tables found” / fail copy; clear on disconnect; click runs Show All Rows (`App` → `onBrowse` → `runBrowseOnActiveTab`). Schema picker + SET search_path live on the Queries toolbar; sidebar Refresh reloads tables + picker databases. **WORKSPACE-CHROME**.
- [x] **Sidebar refresh.** Swift: toolbar `arrow.clockwise` → `refreshOnDemandFromToolbar`, min 0.45s spinner (`isRefreshingSidebarMetadata`). Tests: `ConnectionSidebarViewModelTests`. Tauri: **DONE** Queries-column Refresh (`REFRESH_MIN_MS = 450`) calls `library.refresh` + `reloadTables` + `ConnectionPanel.refreshDatabases`; overlay on the Queries column (not the tables list). Button label is `Refresh`, not Swift’s longer help string. **Done:** refresh re-fetches database list and `listTables`. **SEQUENCE**.
- [x] **Schema filter when `schemas.count > 1`.** Swift: `SchemaPicker` “All Schemas” vs named; clears selected table if schema mismatch; `setSchemaSearchPathDebounced`; `tabManager.updateActiveTabSchemaFilter`. Tauri: **DONE** Queries toolbar schema `<select>` when `schemaNames.length > 1`; client-side filter on `TableRef.schema`; `handleSelectSchema` → `ipc.setSearchPath` then `loadTables`. **Done:** filter is client-side on `TableRef.schema`; selecting a schema runs `SET search_path`. **SEQUENCE**.
- [x] **Schema error alert.** Swift: `appState.connection.schemaError`. Tauri: **DONE** Queries toolbar `role="alert"` + OK (`QueriesCopy.schemaError` / `onDismissSchemaError`). **Done:** failed SET search_path shows alert, OK clears. **SEQUENCE**.
- [ ] **Table-load timeout alert.** Swift: 300s `Constants.Timeout.databaseOperation`, Try Again / Cancel. Tauri: **MISSING**. **SEQUENCE**.
- [x] **Saved-queries column: title Queries + new query.** Swift: `SavedQueriesSidebarSection` also has filter field + six-way sort. Tauri: **DONE** resizable `QueriesColumn` left of canvas (including disconnected); `+` names `Query yy-MM-dd H:mm:ss` and clears the active tab canvas+grid. Filter field, six-way sort, duplicate, multi-select, green cache dot **shipped**. **WORKSPACE-CHROME**.
- [x] **Empty copy.** Swift: `"No saved queries"` / `"No matching queries"`. Tauri: **DONE** `"No saved queries"` and `"No matching queries"` when the filter matches nothing. **WORKSPACE-CHROME**.
- [x] **Folders as disclosure groups; unfoldered queries below.** Swift: `folderDisclosureGroup` + `QueryFolderRowView`. Tauri: **DONE** `QueriesFolderRow` `aria-expanded` disclosure; unfiled queries render *above* folders (Swift puts unfoldered below). **SEQUENCE**.
- [x] **Select query restores B′ cached results; does not rebuild visual cards from SQL.** Swift: `handleSelectionChange` + `SavedQueriesViewModel.loadQuery` also loads SQL text. Tauri: **DONE** for canvas-primary — click sets tab `savedQueryId`, loads hatch `queryText`, and restores last **successful** Run grid; cards unchanged; cache dropped on profile switch. Loading `queryText` into visual IR remains **SEQUENCE**. **WORKSPACE-CHROME**.
- [x] **Deselect clears tab savedQueryId.** Swift: `tabManager.clearActiveTabSavedQueryId`. Tauri: **DONE** Queries Deselect → `onSelectQuery(null)` → `setSavedQueryId(tabId, null)`. **SEQUENCE**.
- [x] **Rename query sheet.** Swift: `EditQuerySheet` / `EditFolderSheet`; Save disabled on blank; Enter submits. Tauri: **DONE** rename query and rename folder (Save disabled if blank). **WORKSPACE-CHROME**.
- [x] **Move to folder.** Swift: `MoveToFolderSheet` also has No Folder / New Folder. Tauri: **DONE** move to an existing folder, No Folder (`folderId: null`), and New Folder (`createQueryFolder` then move). **WORKSPACE-CHROME**.
- [x] **Duplicate query.** Swift: `duplicateQuery`. Tauri: **DONE** Queries Duplicate → `library.duplicateSavedQuery`. **SEQUENCE**.
- [x] **Delete query confirm (single).** Swift: confirmationDialog + Delete key (`onDeleteCommand`) also covers N. Tauri: **DONE** confirm then `deleteSavedQueries([id])`; multi-select (meta/ctrl) + Delete key confirm the picked set. **WORKSPACE-CHROME**.
- [x] **Delete folder: folder-only vs folder+queries.** Swift: two destructive buttons; IPC already `deleteFolder(id, deleteQueries)`. Tauri: **DONE** both actions in `QueriesColumn`, but only when a **selected query lives in that folder** (empty folders have no delete control). **WORKSPACE-CHROME**.
- [x] **Executing spinner + cached-results green dot on row.** Swift: `SavedQueryRowView.isExecuting` / `shouldShowCachedRowCount`. Tauri: **DONE** `QueriesQueryRow` spinner when `executingQueryId` matches; cache dot when B′ has a hit. **SEQUENCE**.
- [x] **Debounced auto-save of editor SQL into current SavedQuery (500ms, skip while restoring).** Swift: `QueryEditorViewModel.handleQueryTextChange`. Tauri: **DONE** `useSavedQueryAutosave` (`AUTOSAVE_MS = 500`) persists hatch `queryText`; skips while `isRestoring` / overlay / query-select pulse; auto-creates a SavedQuery when none is selected; never writes visual IR into `SavedQuery.queryText`. **SEQUENCE**.

### 2.4 Results grid and row editing

Parent §12.1: 7 files, 1,374 LOC.

- [x] **Read-only grid bound to executing-tab results.** Swift: `QueryResultsView` → `QueryResultsComponent` from `QueryState.queryResults` / `queryColumnNames`. Tauri: **DONE** `QueryResultsPane` reads active-tab `status` + `compact` after `runSelectOnActiveTab`; idle ignores hydrated cache. **Done:** Given a successful SELECT on the active tab, When results land, Then a table shows `compact` cells (2048 + `... [truncated]`, `src/lib/result-compactor.ts`) with column headers; JSON/numbers/bools stringify consistently. **FIRST-SLICE**.
- [x] **Loading.** Swift: `ProgressView("Loading results...")` when `isExecuting`. Tauri: **DONE** `ResultsCopy.loadingResults` while `status.kind === "running"` (prior grid cleared). **FIRST-SLICE**.
- [x] **Error.** Swift: `ContentUnavailableView` “Query Failed” + `queryErrorMessage`. Tauri: **DONE** results pane `Query Failed` + `status.message`; canvas `OK / N rows / ms` strip **removed** (not relocated). **FIRST-SLICE**.
- [x] **Empty with headers.** Swift: empty `Table` + overlay `EmptyQueryResultsView` if column names exist. **Done:** 0-row SELECT still shows headers + “No rows found”. **FIRST-SLICE**.
- [x] **NULL display.** Swift: `formatValue` → `"NULL"` for nil. Tauri: **DONE** `formatResultCell` (`null`/`undefined` → `NULL`; `false`/`0`/`""` unchanged). **FIRST-SLICE**.
- [x] **Date formatting from Settings.** Swift: `@AppStorage` `QueryResultsDateFormat` (iso8601, date-only, US, European, relative); parse guards `shouldAttemptDateParsing` / 64-char cap. Tauri: **DONE** for the grid — `App.tsx` holds `dateFormat` state (`loadDateFormat`/`saveDateFormat`, reloaded when `SettingsDialog` closes) and passes it to `QueryResultsPane`, which already calls `formatResultCell(value, dateFormat)` → `formatQueryDate`. History labels are a separate, already-tracked gap (§2.7 "History relative date labels"), not part of this row's SEQUENCE item. **SEQUENCE** to apply the format to the grid.
- [x] **Client filter “Filter results”.** Swift: `QueryResultsToolbar.filterField` → case-insensitive substring any cell. Tauri: **DONE** `QueryResultsPane` filter input (`query-results-pane.tsx`) case-insensitive substring match on any cell. **SEQUENCE**.
- [x] **Column sort.** Swift: `TableRowComparator` localizedStandardCompare, nulls last in forward. Tauri: **DONE** `QueryResultsPane` header click toggles asc/desc with nulls last (`toggleSort` / `headerCells`). **SEQUENCE**.
- [x] **Row selection (multi).** Swift: `Table` selection `selectedRowIDs`. Tauri: **DONE** `QueryResultsPane` row click with meta/ctrl additive selection (`selectRow`). **SEQUENCE** (not first-slice; first-slice is read-only with no mutation chrome).
- [x] **Pagination bar (table browse only).** Swift: `currentPage` / `hasNextPage`; 100 rows/page (`Constants.Pagination.defaultRowsPerPage`); fetch `limit+1`; Prev disabled on page 0. `QueryResultsViewModel.goToPreviousPage/Next`. Tauri: **DONE** — composed `browse` store tracks `page` (`App.tsx` subscribes; `PAGE_SIZE` 100, exported from `run-browse-on-active-tab.ts`) fetches `LIMIT 101`; `hasNextPage`/`hasPrevPage` and `onNextPage`/`onPrevPage` wired to `QueryResultsPane`'s pagination bar, which disables Prev at page 0. Only shown for an actual table browse (`sourceTable` set). Database/connection reset returns page to 0 via `browse.invalidate`. **SEQUENCE** (Table browser).
- [x] **JSON viewer.** Swift: toolbar / Space → `DetailContentViewModel.openJSONView` → `JSONViewerView` pretty JSON, Copy JSON (1.75s checkmark), Download CSV of **selected** rows via `CSVExporter`. Tauri: **DONE** `JsonViewer` (`src/ui/results/json-viewer.tsx`) now reachable with real `raw` data (`COPY_JSON_MS = 1750` checkmark; `downloadCsv` → `toCsv` → `onSaveCsv` → `ipc.saveCsvFile`), previously unreachable because `QueryResultsPane` had no `raw`/`onSaveCsv` wired in. **SEQUENCE**.
- [ ] **Edit row sheet.** Swift: `RowEditorView` PK read-only + badge, NULL checkbox if nullable, date/time pickers by type, Save disabled while saving, error alert. Tauri: **PARTIAL-as-shipped** — `RowEditor` (`src/ui/results/row-editor.tsx`) now attaches and submits via `ipc.updateRow` (PK fields read-only/disabled, NULL checkbox per field); it uses a plain text input for every column (no typed date/time pickers), and has no saving-state disable or error alert. **Done** criterion for *attaches and functions* is met; the Swift-parity input-affordance gaps remain **SEQUENCE**.
- [x] **Delete rows confirm.** Swift: “Delete N row(s)?” then `performDelete`. Tauri: **DONE** — `QueryResultsPane`'s delete dialog (`deleteRowsPrompt`) now calls `onDeleteRows` → `ipc.deleteRows`, previously a no-op with no handler wired. **SEQUENCE**.
- [ ] **Editability + context-mismatch disable.** Swift: `determineQueryEditability`; toolbar popover `DetailContentViewModel.contextMismatchHelpText`; `QueryEditabilityTests`. Tauri: **PARTIAL** — `QueryResultsPane` calls `determineEditability(query, { sourceTable })` and gates Edit/Delete on browse context + loaded primary keys; JOIN/CTE/aggregate reason titles surface as button `title` tooltips. **Approved Slice B reset (done):** successful database switch and disconnect clear table-browse results, selected-table metadata, page, and generation via one composed path (`browse.invalidate` + `tabs.clearBrowseResults` in `onDatabaseSwitched`; full in-memory tab clear + `browse.invalidate` on disconnect). Failed `switchDatabase` before session mutation preserves browse state. Ordinary SQL/canvas results stay visible. Stale browse responses after a generation bump cannot repopulate tabs or browse identity. Context-mismatch help popover when results come from another connection/db remains **MISSING** (deliberate deviation: clear browse state instead of retaining it behind help). **SEQUENCE**.
- [x] **Delete/Space key on grid.** Swift: `.onDeleteCommand` / `.onKeyPress(.space)`. Tauri: **DONE** — `onRowKeyDown` (Enter select, Space open JSON, Delete/Backspace open delete confirm) existed but was inert without `onDeleteRows` wired; now functional. **SEQUENCE**.
- [ ] **`ColumnRowView` (PK/UNQ/FK/NOT NULL badges).** **DROP (dead)** — never instantiated. Do not treat as a missing screen.

### 2.5 Table browser

Parent §12.1: 6 files, 1,164 LOC.

- [x] **Tables list after connect.** Swift: `TablesListIsolated`; loading spinner if empty+loading; “No tables found”; refresh overlay. Tauri: **DONE** names in the connection column (`ConnectionTablesList`); loading / empty / fail copy; no refresh overlay. Click runs Show All Rows. **WORKSPACE-CHROME**.
- [x] **Click table name = Show All Rows (does not auto-run on mere selection).** Swift: `TableListRowComponent.onShowAllRows` → `requestTableQuery`; `QueryResultsViewModel.handleTableSelectionChange` comment: no auto-execute. Tests: `AppStateTests` race/supersede. Tauri: **DONE** `App` passes `onBrowse` → `runBrowseOnActiveTab` (paginated `SELECT` LIMIT 101); focus without click does not fetch (`tests/ui/app-wiring.test.tsx`). **SEQUENCE**.
- [x] **Expand table → columns (lazy fetch).** Swift: `TableListRowView.toggleExpanded` / `fetchColumnInfo` + PK merge; `TableColumnRowView` simplified types + key icons. Tauri: **DONE** `TableList.onExpand` → `schema.loadExpanderColumns`; `columnsByTable` keyed `schema.name` keeps full `ColumnInfo` (PK/FK flags) while canvas `loadColumns` owns `columnNames` for the FROM picker. Expander shows names, types, and PK/FK icons when the catalog returns those flags. **SEQUENCE**.
- [x] **Grouped schemas + Load more (100).** Swift: `SchemaGroupView` / `displayedCount` batch 100. Tauri: **DONE** `TableList` groups by schema and batches 100 with Load more (`SCHEMA_BATCH_SIZE`). **SEQUENCE**.
- [x] **Context menu: Refresh, Generate DDL, Export, Truncate, Drop** — disabled while `isExecutingQuery`. Swift: `TableListRowComponent.tableMenuContent`. Tauri: **DONE** `App` wires `onRefresh` / `onGenerateDdl` / `onFetchAll` / `onTruncate` / `onDrop` to dedicated IPC (never hatch `runQuery`); `executing={status.kind === "running"}` disables the menu. **SEQUENCE**.
- [x] **DDL sheet + copy.** Swift: `TableDDLSheet`. Tauri: **DONE** `TableDdlSheet` via `ipc.generateTableDdl`. **SEQUENCE**.
- [x] **Export sheet: Fetch Data → CSV/JSON preview counts → native save.** Swift: `TableExportSheet` + `fetchAllTableData`. Tauri: **DONE** `TableExportSheet` via `onFetchAll` (`SELECT * FROM` quoted table, full rows) + `saveCsvFile` / `saveTextFile`. **SEQUENCE**.
- [x] **Truncate / Drop confirms** with irreversible copy. Swift: `TableContextMenuModals`. Tauri: **DONE** confirm copy then `ipc.truncateTable` / `ipc.dropTable` + `reloadTables`. **SEQUENCE**.
- [x] **Foreign table icon.** Swift: `table.tableType == .foreign`. Tauri: **DONE** `TableRef.tableType`; `TableList` shows `TablesCopy.foreignTable` when `tableType === "foreign"`. **SEQUENCE**.

### 2.6 Query editor (SQL)

Parent §12.1: 4 files, 937 LOC. **Not first-slice** (canvas stays primary).

- [x] **View generated SQL dialog (Swift 1:1).** Swift: toolbar → `GeneratedSQLPreviewView` sheet (Copy, Done, `—`). Tauri: **DONE** `GeneratedSQLDialog`; always-on `.vq-sql-preview` **removed**. **FIRST-SLICE**.
- [x] **SQL mode as escape hatch, not the default layout.** Swift: segmented `QueryEditorMode` sql/visual; SQL is default. Tauri: **DONE** canvas toolbar Visual\|SQL (`toolbar.tsx`); default `editorMode` is `"visual"` (`canvas.tsx`); SQL mode mounts `SqlHatch` bound to `tabs.active.queryText`. **Done:** a control reveals a SQL buffer bound to `tabs.active.queryText`; visual remains the default surface. **SEQUENCE**.
- [x] **Run Query + ⌘↵ on the visual surface.** Swift: `QueryEditorComponent` `keyboardShortcut(.return, modifiers: [.command])`. Tauri: **DONE** Accel+Enter via `handleWorkspaceKeydown` + native menu `CmdOrCtrl+Enter`; hatch also binds `Mod-Enter`; no-op when Run disabled; welcome ignores it. **WORKSPACE-CHROME**.
- [x] **No database selected alert.** Swift: `QueryEditorView` “Select a database from the sidebar before running queries.” Tauri: run throws `Not connected`. **Done:** disconnected/no-db disables Run with help, not a silent no-op. Canvas already disables Run when `!isConnected`. SQL editor must match. **SEQUENCE**.
- [x] **Cancel after 3s elapsed + Esc.** Swift: Stop button when `isExecuting && displayedElapsedTime > 3`; `tab.cancelQuery()` + `query.cancelCurrentQuery()` clears results and status “Query cancelled”. Tauri: **DONE** hatch Stop/Esc after `CANCEL_AFTER_MS = 3_000`; `App.handleCancelSql` → `ipc.cancelQuery` + `applyRunCancelled`. **SEQUENCE**.
- [x] **Elapsed / last executed / status / timeout 300s Try Again.** Swift: `QueryEditorView` timeout alert. Tauri: **DONE** hatch `QUERY_TIMEOUT_MS = 300_000`; Try Again re-runs the current buffer, Cancel calls `onCancel`. Elapsed / last-executed status labels are not shown on the hatch. **SEQUENCE**.
- [x] **History button opens `QueryHistoryView`.** Swift: clock button (SQL-mode toolbar only). Tauri: **DONE** History on the canvas toolbar (`QueryHistorySheet`). **WORKSPACE-CHROME**.
- [x] **Syntax highlighting + line numbers.** Swift: `SyntaxHighlightedEditor` + `LineNumberRulerView`; skip highlight if `count > 50_000`. Tauri: **DONE** CodeMirror `lineNumbers` + `syntaxHighlighting`; `shouldHighlightSql` skips highlight when length > 50_000. **SEQUENCE**.
- [x] **Visual mode hosts a per-tab document (in-session).** Swift: `restoreVisualViewModelIfNeeded`. Tauri: **DONE** `tab-documents.ts` keyed by tab id; switch restores cards+grid; `visualDocumentJson` on `TabStateDto` persists via `setVisualDocumentJson` / `persistTab` and hydrates on tab activate. **WORKSPACE-CHROME**.
- [x] **CREATE confirmation in visual — SELECT-only recorded.** Swift: `VisualQueryCanvasView.createConfirmationSheet`. Tauri: Run disabled unless connected + `statementKind === "select"` + `canRun`; CREATE/UPDATE/DELETE cannot fire `runQuery`. **Done (first-slice):** keep SELECT-only; decision recorded 2026-08-15 in first-slice spec. Port confirm+execute remains **SEQUENCE** if that decision is reversed. **needs-decision** closed for first-slice.

### 2.7 Query history

Parent §12.1: 1 file, 232 LOC.

- [x] **History sheet list newest-first.** Swift: `@Query(sort: \QueryHistory.executionDate, order: .reverse)` **global** (all profiles). Tauri: **DONE** `listHistory({ limit: 50 })` without profileId; row shows success/fail, duration, SQL (5-line). Database column is N/A (`HistoryDto` has no databaseName). Relative dates **DONE** (`formatRelativeDate` parses epoch-millis `created_at` as well as ISO). **WORKSPACE-CHROME**.
- [x] **Empty state.** Swift: “No Query History” / “Executed queries will appear here.” Tauri: **DONE**; `listHistory` failure shows an error, not this empty copy. **WORKSPACE-CHROME**.
- [x] **Copy SQL.** Swift: `QueryHistoryRow.onCopy` with 1.2s checkmark. Tauri: **DONE** Copy writes SQL to the clipboard; `COPY_CHECKMARK_MS = 1200` shows Copied. **WORKSPACE-CHROME**.
- [x] **Export JSON / CSV / SQL** via save panel; Export disabled when empty. Swift: `QueryHistoryView.exportHistory` + `QueryHistoryExporter`. Tauri: **DONE** `query-history-exporter.ts` + `saveTextFile` (JSON/CSV/SQL filters); cancel writes nothing. **WORKSPACE-CHROME**.
- [x] **History relative date labels.** Swift: relative `executionDate`. Tauri: **DONE** `formatRelativeDate` accepts epoch-millis text and ISO. **SEQUENCE**.
- [ ] **Do not require per-row delete / clear in UI** unless we choose Tauri extras. Swift UI has **no** delete/clear; SP-3 IPC `deleteHistory` / `clearHistory(profileId)` is net-new. **needs-decision** to expose. Persistence of successful **and** failed runs: Swift inserts on every `executeQuery` (`QueryEditorViewModel`); Tauri SP-2 writes history on `runQuery` (SELECT). **needs-decision** whether SQL-editor mutations also write history.

### 2.8 Tab bar

Parent §12.1: 1 file, 170 LOC.

- [x] **Horizontal tabs + + button.** Swift: `TabBarView`; label = `db / savedQuery.name` or `connection.displayName / db` or `New Tab N`. Tauri: **DONE** `TabBar` + store `createTab/switchTab/closeTab`; titles via `formatTabTitle` (`db / savedQuery` or `connection / db` or `New Tab N`). **WORKSPACE-CHROME**.
- [x] **Pending deletion shows “Closing...” and ignores clicks.** Swift: `tab.isPendingDeletion`. Tauri: **DONE** `pendingDeletedIds` → `TabBarCopy.closing`; click on a pending tab is ignored. **SEQUENCE**.
- [x] **Switch saves query text of previous tab, not connection/database (those already on tab).** Swift: `selectTab` comment. `RootView` `.tabDidChange` → `handleTabChange`. Tauri: **DONE** `switchTab` → `syncMetadataForCurrentTabs` → `persistTab(..., { includeCachedResults: false })` so the previous tab’s `queryText` is saved without wiping a results blob. **SEQUENCE**.
- [x] **Close last tab recreates empty active.** Swift: `TabManager.closeTab`; SP-3 tabs-store same. Tauri: **DONE** UI calls `closeTab`; store recreates. **WORKSPACE-CHROME**.
- [x] **Close among N activates MRU `lastAccessedAt`.** SP-3 / Swift. Tauri: **DONE** via existing store + tab bar close. **WORKSPACE-CHROME**.
- [x] **⌘T / ⌘W** via menu notifications `.createNewTab` / `.closeCurrentTab` (`DragonDBApp.commands`). Tauri: **DONE** native menu `CmdOrCtrl+T`/`CmdOrCtrl+W` + `handleWorkspaceKeydown`; welcome ignores them. **WORKSPACE-CHROME**.
- [x] **New tab inherits connection + database from active.** Swift: `createNewTab(inheritingFrom:)`. Tauri `emptyTab` uses session getters; UI `+` / Accel+T call `createTab`. **WORKSPACE-CHROME**.

### 2.9 Database management

Parent §12.1: `CreateDatabaseView` 102 LOC.

- [x] **Create Database modal.** Swift: name field, Create disabled if blank/creating/success, Enter submits, error label, success “Database created” + Connect. Calls `databaseService.createDatabase` then `fetchDatabases`. Tauri: **DONE** picker-hosted `CreateDatabaseDialog` with native form Enter/Create, create-only IPC, then explicit Connect (`ConnectionCopy.connect`) for `switchDatabase`. Failed catalog refresh keeps Connect; a committed switch is not repeated when table reload fails. **SEQUENCE**.
- [x] **Delete database** (picker + confirm + error alert). Covered in Connection cluster. **SEQUENCE**.

### 2.10 Static pages

Parent §12.1: help, keyboard shortcuts, welcome, settings — 4 files, 230 LOC.

- [x] **WelcomeView.** Swift: logo, “Hello, and welcome!”, “Connect to Server...”. Tauri: **DONE** `src/ui/welcome/welcome-view.tsx` + `public/onboarding.png`. **WORKSPACE-CHROME**.
- [x] **HelpView.** Swift: Support link `https://github.com/rfxlamia/dragon-db/issues` (**stale repo name** — port uses `rfxlamia/dragondb/issues`), plus embedded shortcuts. Tauri: **DONE** `HelpDialog`. **WORKSPACE-CHROME**.
- [x] **KeyboardShortcutsView.** Swift: General ⌘T/⌘W, Query Editor ⌘↵. Tauri: **DONE** `ShortcutsDialog`; Windows lists Ctrl bindings that are actually registered. **WORKSPACE-CHROME**.
- [x] **SettingsView date format radios.** Swift: `Settings { SettingsView() }` scene; radio `QueryResultsDateFormat`. Tauri: **DONE** `SettingsDialog` + `localStorage` `dragondb.queryResultsDateFormat`. Grid cells apply the format (§2.4 Date formatting). History labels are relative, not Settings-driven. **WORKSPACE-CHROME**.
- [x] **App menu commands.** Swift: replace New Item with New Tab/Close Tab; after appInfo Help and Support + Keyboard Shortcuts; replace Help with DragonDB Help. Tauri: **DONE** native `MenuBuilder` in `src-tauri/src/lib.rs` (Help, Keyboard Shortcuts, Settings, New Tab, Close Tab, Run Query). **WORKSPACE-CHROME**.

### 2.11 Capabilities without screens (§12.2 + extras)

Every §12.2 row appears here. Extras flagged `§12.2 miss`.

| Capability | Swift | Tauri status | Done criterion | Slice | Disposition |
|---|---|---|---|---|---|
| CSV export | `CSVExporter` + `TableExportSheet` + JSON viewer Download CSV | Util **DONE** `src/lib/csv-exporter.ts`; IPC **DONE** `saveCsvFile`; JSON viewer Download CSV **DONE**; table-export sheet **DONE** (`onFetchAll` + `saveCsvFile` / `saveTextFile` from `App`) | Save dialog writes RFC4180 CSV (quote only when needed; null → empty field) | SEQUENCE | SHIP — JSON viewer path **done** |
| Multi-statement queries | `SQLStatementSplitter` | Util **DONE** `src/lib/sql-statement-splitter.ts`; execute multi **out of SP-3** | Splitter available to SQL editor; executing multiple statements is **needs-decision** (Swift `QueryService` behavior unread in full) | SEQUENCE | needs-decision on execute |
| Query type detection | `QueryTypeDetector` | Util **DONE** `src/lib/query-type-detector.ts`; mutation toast path **DONE** | Mutations take toast path not grid replace; DROP TABLE hides View Table | SEQUENCE | SHIP — **done** |
| Result-grid editability | `QueryEditability` + `RowOperationsService` | Util **DONE**; IPC `updateRow`/`deleteRows` **DONE**; UI **PARTIAL** — Edit/Delete now attach and call `ipc.updateRow`/`ipc.deleteRows` gated on `isEditable` (`determineEditability`); the six `RowOperationError` kinds are not yet distinguished/surfaced (a rejected call fails silently); context-mismatch help **MISSING** (approved deviation: browse results/page/generation clear on successful database/connection change; ordinary SQL/canvas results are preserved) | Edit/delete only when `isEditable`; six `RowOperationError` kinds surface | SEQUENCE | SHIP |
| Create / delete database | `DatabaseManagementService` | **DONE** `ipc.createDatabase` / `deleteDatabase` + picker dialogs; success refreshes the picker | CREATE DATABASE / DROP DATABASE succeed and refresh picker | SEQUENCE | SHIP — **done** |
| Connection string parsing | `ConnectionStringParser` | Util **DONE**; UI **DONE** URI mode on Save | Paste URI fills form on Save; invalid URI errors | WORKSPACE-CHROME | SHIP — **done** |
| Large-result compaction | `TableBrowseResultCompactor` | Util **DONE**; tabs-store applies `compactCell` on run success; grid binds `compact` | Grid cells never exceed 2048 including suffix | FIRST-SLICE | SHIP — **done** |
| Query history persistence | `QueryHistory` + SwiftData | rusqlite write-on-`runQuery` **DONE**; `listHistory` **DONE**; UI **DONE** `QueryHistorySheet` | After SELECT, history list contains the SQL | WORKSPACE-CHROME | SHIP — **done** |
| Saved queries and folders | `SavedQuery`, `QueryFolder` | IPC+store **DONE**; UI **DONE** `QueriesColumn` (filter/sort/duplicate/folders/deselect/autosave) | CRUD matrix in sidebar | SEQUENCE remainder | SHIP — **done** |
| Tab state persistence | `TabState`, `TabManager`, `TabService` | IPC+store **DONE**; tab bar **DONE**; `visualDocumentJson` on DTO persists + hydrates | Relaunch restores tabs (query text; results blob optional). Visual cards persist **done** | WORKSPACE-CHROME | SHIP — **done** |
| SSL modes | `SSLMode` | Form+Rust **DONE** | Six modes; SSH hides verify-ca/full | FIRST-SLICE | SHIP — **done** |
| Keyboard shortcuts | `KeyboardShortcutsView` + `DragonDBApp.commands` | **DONE** native menu + Accel+T/W/Enter | ⌘T/W/↵ documented and bound | WORKSPACE-CHROME | SHIP — **done** |
| Cancel query | `QueryState.cancelCurrentQuery` + Stop after 3s | **DONE** hatch Stop/Esc after 3s + `ipc.cancelQuery` | Esc/Stop cancels in-flight run, status “Query cancelled”, results cleared | SEQUENCE | SHIP; §12.2 miss — **done** |
| Query timeout 300s | `QueryEditorView` / table-load alerts | Hatch timeout **DONE** (`QUERY_TIMEOUT_MS = 300_000` Try Again / Cancel); table-load timeout **MISSING** | Try Again reissues; Cancel dismisses | SEQUENCE | SHIP; §12.2 miss — hatch **done** |
| Pagination | `QueryState` page cache + `requestPaginatedTableQuery` | **DONE** — page navigation plus current-identity 20-page LRU (`browse.readPage`/`writePage`, `LIMIT 101` probe, 100 visible rows, `hasNext` separate; Refresh/Truncate invalidate+reload; Drop clears identity). Visible page stays per-tab `browsePage` (T3). | Page N of table browse is 100 rows; cached pages skip refetch | SEQUENCE | SHIP |
| JSON viewer | `JSONViewerView` | **DONE** UI — `JsonViewer` now reachable with real `raw` data | Space/toolbar opens pretty JSON of selection | SEQUENCE | SHIP; §12.2 miss — **done** |
| Mutation toast | `MutationToastView` + `QueryState.showMutationToast` | **DONE** — hosted in `AppWorkspace`; 5s auto-dismiss; View Table browses the schema-qualified table | 5s toast; View Table re-runs browse | SEQUENCE | SHIP; §12.2 miss — **done** |
| Welcome gating | `shouldShowWelcomeScreen` | **DONE** `WelcomeView` | 0 profiles → welcome | WORKSPACE-CHROME | SHIP; §12.2 miss — **done** |
| Test connection | `ConnectionFormViewModel.testConnection` | **DONE** `ipc.testConnection` + banner; does not keep session | Test does not keep session | SEQUENCE | SHIP; §12.2 miss — **done** |
| SET search_path | `AppState.setSchemaSearchPath` | **DONE** schema picker → `ipc.setSearchPath` | Schema picker changes query search_path | SEQUENCE | SHIP; §12.2 miss — **done** |
| History export | `QueryHistoryExporter` | **DONE** `query-history-exporter.ts` + `saveTextFile` | JSON/CSV/SQL files | WORKSPACE-CHROME | SHIP; §12.2 miss — **done** |
| Auto-save SQL | `QueryEditorViewModel` 500ms | **DONE** `useSavedQueryAutosave` | Typing persists SavedQuery without Save button | SEQUENCE | SHIP; §12.2 miss — **done** |
| Restore last connection | `RootViewModel.initializeApp` | **DONE** launch restore auto-connect | Launch reconnects active tab’s profile | SEQUENCE | SHIP; §12.2 miss — **done** |
| Sidebar metadata refresh | toolbar refresh | **DONE** Queries Refresh reloads tables + picker databases | Reloads tables without reconnect | SEQUENCE | SHIP; §12.2 miss — **done** |
| Truncate / Drop / DDL | `TableContextMenuViewModel` | **DONE** dedicated `ipc.truncateTable` / `dropTable` / `generateTableDdl` from `App` via `ConnectionPanel` (never hatch `runQuery`) | Confirms then mutates; DDL copyable | SEQUENCE | SHIP; §12.2 miss — **done** |
| Visual CREATE confirm | `VisualQueryCanvasView.createConfirmationSheet` | First-slice: SELECT-only Run (disabled for CREATE); confirm+execute not ported | Decision recorded 2026-08-15; SEQUENCE if reversed | SEQUENCE | decision recorded; §12.2 miss |
| Favorite flag | `ConnectionProfile.isFavorite` | DTO field, no UI | **needs-decision** | — | needs-decision; display-only dead UI |
| SwiftData importer | — | Out of SP-4b | Release notes until SP-6 | out of chrome | already decided |
| Dark mode | Swift system appearance | Out of SP-4b light-only | Do not add theme switch | out of chrome | already decided |

---

## 3. Per-cluster deep dives

### 3.1 App shell

**Files + LOC (2026-08-14 `wc -l`)**

| File | LOC | Role |
|---|---:|---|
| `Containers/MainSplitView.swift` | 327 | NavigationSplitView + editor/results split + toast |
| `Containers/RootView.swift` | 145 | Welcome gate, sheets, launch, notifications |
| `Primitives/ResizableSplitView.swift` | 89 | **Unreachable** NSSplitView wrapper |
| `Primitives/LoadingOverlayView.swift` | 36 | Full-window loading |
| `Primitives/Badge.swift` | 24 | Used only by dead `ColumnRowView` |
| `Primitives/EmptyQueryResultsView.swift` | 17 | Results empty copy |
| `Components/Toast/MutationToastView.swift` | 71 | Mutation toast |
| **Sum** | **709** | matches §12.1 |

**Wiring / entry:** `DragonDBApp` `Window` → `RootView` → `WelcomeView` or `MainSplitView`. `MainSplitView` constructs `DetailContentViewModel` onAppear (RowOperations + QueryService).

**Behaviors (evidence):** see §2.1. Additional: preview seeder in `MainSplitView` is DEBUG-only, not product.

**Tests:** `AppStateTests` (table-query races, supersession interrupt — shell-adjacent). `QueryStateTests` pins `rowsPerPage` default 100. No dedicated RootView UI test.

**Tauri gap:** `src/App.tsx` welcome **or** connection column | main (`App.css` two-column grid, collapsible). Main hosts horizontal Queries | (`TabBar` + vertical `WorkspaceSplit`). Native Help/Shortcuts/Settings. Loading overlay + mutation toast + collapsible connection sidebar **shipped**. `composeAppStores` hydrates tabs; first-slice pane gates on this-session `status` (idle ignores cache). Per-tab `QueryDocument` hydrates from persisted `visualDocumentJson`.

**Dependencies:** Results cluster for empty/error; Connection for welcome gate; Tabs for bar visibility.

**Risks:** Cloning `MainSplitView` would bury the canvas. Loading overlay can hide the whole window for slow SSH — keep cancellable in Tauri.

### 3.2 Connection

**Files + LOC**

| File | LOC |
|---|---:|
| `Containers/Connection/ConnectionFormView.swift` | 570 |
| `Containers/Connection/ConnectionsListView.swift` | 273 |
| `Components/Connection/ConnectionDatabasePicker.swift` | 288 |
| `Components/Connection/ConnectionDropdown.swift` | 178 |
| `Components/Connection/ConnectionStatusBanner.swift` | 155 |
| **Sum** | **1,464** |

**Wiring:** Form sheet from `RootView` / sidebar create-edit. Dropdown+DB picker live in sidebar header. `ConnectionsListView` has **zero** call sites.

**Behaviors:** Test (temporary SSH+DB), Save (keychain + SwiftData), post-save Connect prompt, SSL tooltip, connection-string toggle, password bullets vs reveal, SSH auth segmented, database pulse when connected-but-unselected, delete confirms.

**Tests:** `ConnectionStateTests`, `ConnectionStringParser` tests, `ConnectionSidebarViewModelTests` (delete database, refresh). Form VM not fully covered in the suites listed.

**Tauri:** `src/ui/connection/connection-panel.tsx` + `connection-form.tsx` — Save/Connect/Disconnect/Switch/Delete/SSL/SSH **DONE**; URI mode **DONE**; “No connections” **DONE**; tables names **DONE** (click = Show All Rows). Test, database list/switch, status banner states, show-password **DONE**.

**Dependencies:** Database management IPC for picker create/delete; new list/switch-database for picker.

**Risks:** Tauri session is one `profile.database`; Swift is connect-to-server then pick database. Treating those as equivalent would silently drop multi-database workflow.

### 3.3 Sidebar, saved queries, folders

**Files + LOC**

| File | LOC |
|---|---:|
| `Containers/Sidebar/ConnectionsDatabasesSidebar.swift` | 431 |
| `Containers/Sidebar/SavedQueriesSidebarSection.swift` | 481 |
| `Components/Sidebar/SavedQueryRowView.swift` | 177 |
| `Components/Sidebar/SchemaPicker.swift` | 103 |
| `Components/Sidebar/QueryFolderRowView.swift` | 75 |
| `Components/Sheets/MoveToFolderSheet.swift` | 169 |
| `Components/Sheets/EditFolderSheet.swift` | 56 |
| `Components/Sheets/EditQuerySheet.swift` | 52 |
| **Sum** | **1,544** |

**Wiring:** Sidebar column of `MainSplitView`; saved-queries is the **detail** HSplit left pane, not the NavigationSplit sidebar.

**Behaviors:** Refresh, schema filter + search_path, table list embedding, full saved-query CRUD/multi-select/delete-key, folder dual-delete.

**Tests:** `ConnectionSidebarViewModelTests`. No SavedQueriesViewModel test file.

**Tauri:** `library-store.ts` bound in `QueriesColumn` (list, +, rename query/folder, delete confirm, move + No Folder/New Folder, dual folder-delete, B′ result cache, filter/sort/duplicate/green-dot, schema picker). `schema-store.ts` tables shown in the connection column and the canvas FROM picker.

**Dependencies:** Connection (session); Table browser (list widget); Tabs (`savedQueryId`); SQL editor (load text). search_path needs a SET path.

**Risks:** Auto-creating a SavedQuery on every SQL keystroke (`QueryEditorViewModel.saveQuery` when `currentSavedQueryId == nil`) can surprise visual-first users — **needs-decision** if SQL hatch is hidden.

### 3.4 Results grid and row editing

**Files + LOC**

| File | LOC |
|---|---:|
| `Components/Content/RowEditorView.swift` | 432 |
| `Components/Content/QueryResultsComponent.swift` | 373 |
| `Components/Toolbar/QueryResultsToolbar.swift` | 152 |
| `Components/Content/JSONViewerView.swift` | 143 |
| `Components/Content/DetailContentModals.swift` | 136 |
| `Containers/Content/QueryResultsView.swift` | 86 |
| `Components/Content/ColumnRowView.swift` | 52 |
| **Sum** | **1,374** |

**Wiring:** Bottom of `MainSplitView`; toolbar constructed even if `viewModel` nil (disabled) so split does not jump.

**Behaviors:** Loading/error/empty/headers/NULL/dates/filter/sort/selection/pagination/JSON/CSV/edit/delete/keys. `QueryResultsView` loading includes table-browse (`isExecutingTableQueryForSelectedTable`) vs editor query (`executingSavedQueryId` matching).

**Tests:** `QueryEditabilityTests` (large), `QueryResultNormalizerTests`, `TableBrowseResultCompactorTests`, `CSVExporterTests`, `AppStateTests` pagination/cache.

**Tauri:** `runSelectOnActiveTab` writes tab `raw`/`compact`/`status`; `QueryResultsPane` renders this-session `status` + `compact` (idle/loading/error/grid/NULL). Canvas `OK / N rows / ms` strip **removed**. Filter/sort/JSON/edit/delete/pagination **shipped**; typed row-editor pickers and context-mismatch help remain SEQUENCE.

**Dependencies:** Tabs store (already); row-ops IPC (already) for SEQUENCE edit; Settings for dates; Table browser for pagination.

**Risks:** Showing `raw` unbounded cells will freeze WebView; first-slice **must** bind `compact`. Compaction is display-only; JSON/CSV export in Swift uses selected `TableRow` values (pre-compact? table browse applies compaction in `AppState.executeTableQueryInternal` `applyTableBrowseCompaction: true` — export-from-grid may be compacted; export-from-table-sheet fetches full via `fetchAllTableData`). **needs-decision** for JSON viewer: compact vs raw (`tabs-store` keeps both).

### 3.5 Table browser

**Files + LOC**

| File | LOC |
|---|---:|
| `Containers/Tables/TablesListView.swift` | 467 | includes `TablesListIsolated`, `TableListRowView`, `TableColumnRowView` |
| `Components/Tables/TableListRowComponent.swift` | 263 |
| `Components/Sheets/TableExportSheet.swift` | 172 |
| `Components/Tables/SchemaGroupView.swift` | 115 |
| `Components/Tables/TableContextMenuModals.swift` | 93 |
| `Components/Sheets/TableDDLSheet.swift` | 54 |
| **Sum** | **1,164** |

**Wiring:** Embedded in `ConnectionsDatabasesSidebar.makeTablesList`. `TablesListView` is a legacy wrapper still compiling.

**Behaviors:** Incremental render 100, grouped vs flat, Show All Rows, expander column fetch, DDL/export/truncate/drop, foreign-table icon.

**Tests:** `TableRefreshServiceTests`, `AppStateTests` interrupt-on-supersede (`interruptInFlightTableBrowseLoadForSupersession`).

**Tauri:** `ipc.listTables` / `listColumns` **DONE**; names listed in the connection column. Show All Rows via `runBrowseOnActiveTab`; expand loads `columnsByTable`; DDL / truncate / drop / fetch-all via dedicated IPC from `App`.

**Dependencies:** Results grid; CSV; optional new catalog IPC for PK flags.

**Risks:** `LIMIT 100` browse vs canvas SELECT are different queries; editability uses `selectedTable` as explicit source — browse path must set that.

### 3.6 Query editor (SQL)

**Files + LOC**

| File | LOC |
|---|---:|
| `Containers/Content/QueryEditorView.swift` | 299 |
| `Primitives/SyntaxHighlightedEditor.swift` | 296 |
| `Primitives/LineNumberRulerView.swift` | 201 |
| `Components/Content/QueryEditorComponent.swift` | 141 |
| **Sum** | **937** |

**Wiring:** Right-top of Swift HSplit. Owns `QueryEditorViewModel` + per-tab `VisualQueryViewModel`.

**Behaviors:** Mode toggle, run/cancel/history/status/timeout/no-db/save-error, visual restore, column metadata error copy “Could not load columns. You can still type a name.”

**Tests:** `QueryEditor` path covered indirectly by `QueryStateTests`, `VisualQueryRunIntegrationTests` (SP-4a), `SQLStatementSplitterTests`, `QueryTypeDetectorTests`.

**Tauri:** SQL hatch on the canvas toolbar (Visual default; SQL bound to `queryText`). Canvas toolbar Run SELECT only + History. Generated SQL is a **dismissible dialog** (`GeneratedSQLDialog`). Accel+Enter bound on the visual surface and hatch `Mod-Enter`.

**Dependencies:** History sheet; tabs visual-document persistence; cancel IPC.

**Risks:** Shipping a Swift-like SQL-primary split would undo SP-4a. SQL hatch should be a secondary surface (drawer/toggle) over the same results grid.

### 3.7 Query history

**File:** `Containers/History/QueryHistoryView.swift` 232 LOC.

**Wiring:** Sheet from `QueryEditorView.isShowingHistory` (SQL-mode toolbar only — **visual mode hides the history button** in `QueryEditorComponent` `if editorMode == .sql`). Tauri canvas-primary **exposes History on the visual toolbar** (2026-08-15).

**Behaviors:** list, empty, copy, export 3 formats, Escape → Done.

**Tests:** `QueryHistoryTests` (model persist, migration). No UI tests. Exporter untested as its own suite.

**Tauri:** `QueryHistorySheet` from the canvas toolbar; global `listHistory`; Copy; export JSON/CSV/SQL via `saveTextFile`. No row delete/clear UI.

**Dependencies:** SQL or canvas chrome to open the sheet.

### 3.8 Tab bar

**File:** `Containers/TabBar/TabBarView.swift` 170 LOC (includes `TabItemView` + `Notification.Name.tabDidChange`).

**Wiring:** Hidden at 1 tab. Menu ⌘T/W always available via `DragonDBApp`.

**Behaviors:** labels, hover close, inherit, pending deletion, scroll-to-active.

**Tests:** none dedicated; store tests live in Tauri `tests/stores/*`.

**Tauri:** `TabBar` in `App.tsx`; strip at count ≥ 2; `+` always; Accel+T/W. Per-tab `QueryDocument` via `tab-documents.ts` + persisted `visualDocumentJson`. Tab titles via `formatTabTitle`. Pending-deletion shows “Closing...”.

**Dependencies:** RootViewModel-equivalent to reload query/results/connection on switch.

**Risks:** Without per-tab visual IR, tab switch will reset or share one canvas — user-visible data loss.

### 3.9 Database management

**File:** `Containers/Database/CreateDatabaseView.swift` 102 LOC.

**Wiring:** RootView sheet; picker “Create Database”.

**Behaviors:** validation, creating spinner, error `PostgresError.extractDetailedMessage`, success + Connect callback.

**Tests:** `DatabaseServiceDeleteDatabaseTests` (reconnect-while-connected). Create path untested at UI.

**Tauri:** `ipc.createDatabase` / `deleteDatabase` + picker-hosted `CreateDatabaseDialog` (Enter-to-submit and success+Connect chrome still PARTIAL).

**Dependencies:** new IPC; session must support database name change without new profile (Swift reconnects with stored credentials).

**Risks:** Implementing create as `runQuery("CREATE DATABASE")` on a session connected **to** that server’s `postgres` db is how Swift’s executor works — still needs a dedicated command or documented `runQuery` + refresh list.

### 3.10 Static pages

**Files + LOC**

| File | LOC |
|---|---:|
| `Pages/KeyboardShortcutsView.swift` | 78 |
| `Pages/HelpView.swift` | 59 |
| `Pages/WelcomeView.swift` | 48 |
| `Pages/SettingsView.swift` | 45 |
| **Sum** | **230** |

**Wiring:** Welcome in RootView; Help/Shortcuts sheets; Settings is a separate SwiftUI `Settings` scene (macOS app settings, not an in-window page).

**Behaviors:** first-run CTA; support URL; shortcut list; date-format radios.

**Tests:** none.

**Tauri:** `WelcomeView`, `HelpDialog`, `ShortcutsDialog`, `SettingsDialog` (date-format radios persist; grid dates unchanged this slice). Native app menu in `src-tauri/src/lib.rs`. Light-only already matches Settings (Settings has no appearance control).

**Dependencies:** Results date formatting; menus.

**Risks:** Dropping Help/Welcome because they are small is the exact silent-drop §12 exists to prevent.

---

## 4. §12 miss / miscategorization table

| # | Item | Parent said | Code says | Action |
|---|---|---|---|---|
| 1 | `EmptyQueryResultsView` | App shell cluster | Results empty-state primitive | Recategorize under Results for implementation; keep file in shell inventory |
| 2 | `MutationToastView` | App shell | Results/mutation capability | Same — behavior is Results; host is shell overlay |
| 3 | `ResizableSplitView` | Live shell split | **Never instantiated**; `MainSplitView` uses stock split views | DROP (dead) |
| 4 | `ConnectionsListView` | Live connection cluster | **No call sites** from App/Root/Sidebar | DROP view; keep dropdown behaviors |
| 5 | `ColumnRowView` | Results cluster | **Never instantiated**; live expander is `TableColumnRowView` inside `TablesListView.swift` | DROP view; table expander SEQUENCE |
| 6 | `Badge` | App shell primitive | Only used by dead `ColumnRowView` | DROP with #5 |
| 7 | `TablesListView.swift` extra types | One “list” file | Also defines `TableColumnRowView` (~90 LOC) unnamed in §12.1 | Inventory note; not a missing file |
| 8 | Favorite connections | Implied by list UI | `isFavorite` never toggled; star only on dead list | needs-decision |
| 9 | Help support URL | — | `HelpView` still `github.com/rfxlamia/dragon-db/issues` | Fix on port to `dragondb` |
| 10 | Cancel query | not in §12.2 | Stop after 3s + Esc | Add to capabilities |
| 11 | Timeout 300s | not in §12.2 | Editor + table-load alerts | Add |
| 12 | Pagination | not in §12.2 | Table browse 100 + page cache | Add |
| 13 | JSON viewer | has a view file but not §12.2 | `JSONViewerView` | Add as capability-with-screen |
| 14 | Mutation toast | not in §12.2 | `QueryState.showMutationToast` | Add |
| 15 | Welcome gating | WelcomeView in 12.1 but not 12.2 | `shouldShowWelcomeScreen` | Add |
| 16 | Test connection | not in §12.2 | Form Test button | Add |
| 17 | SET search_path | not in §12.2 | `AppState.setSchemaSearchPath` | Add (SP-3 already flagged) |
| 18 | History export; auto-save; restore-last-connection; sidebar refresh; Truncate/Drop/DDL; visual CREATE confirm | not in §12.2 | See §2.11 | Add; no silent drop |

LOC totals in §12.1 still match `wc -l` on 2026-08-14. No missing `Views/` files. No extra unlisted `.swift` under `Views/` (52/52).

Visual-query cards remain 767 LOC; canvas container 281 — SP-4a arithmetic still holds. Those clusters are **not** SP-4b new work except residual CREATE-confirm / per-tab IR.

---

## 5. IPC / store already-ready vs still-needed

| User-facing need | Bind today (SP-2/SP-3) | Still needs Rust/IPC |
|---|---|---|
| Save/list/delete profiles, connect, disconnect, switch | `DragonIpc` profile methods; `session-store`; `ConnectionPanel` | No |
| SSL + SSH + keyring secrets | Form + Rust | No |
| Connection string paste | `parseConnectionString` + URI mode UI | No |
| List tables / columns for FROM + sidebar | `listTables`, `listColumns`; `schema-store` + `ConnectionTablesList` | PK/unique/FK flags **deferred** in `list_columns` |
| Run SELECT, history insert side-effect | `runQuery`; `runSelectOnActiveTab`; `tabs-store` raw/compact | Cancel/interrupt |
| Results grid display | Read `tabs[active].compact/status` via `QueryResultsPane` | No |
| Saved queries / folders CRUD | `library-store` + library IPC + `QueriesColumn` | Filter/sort/duplicate/SQL→IR (UI) |
| Tab persist/hydrate | `tabs-store` + tab bar; in-session visual docs | Visual IR field **not on** `TabStateDto` |
| History list | `history-store` + `QueryHistorySheet` | No (delete/clear extras unused) |
| CSV save dialog | `saveCsvFile` + `toCsv`; history uses `saveTextFile` | Grid/table export UI |
| Row update/delete | `updateRow` / `deleteRows` + `query-editability.ts` | No (UI only) |
| Query type / splitter / compaction / CSV escape | `src/lib/*` | No |
| List/switch databases on server | `listDatabases` / `switchDatabase` + picker **DONE** | No |
| Create / delete database | `createDatabase` / `deleteDatabase` + picker dialogs **DONE** | No |
| Generate DDL / truncate / drop / fetch-all-for-export | **DONE** `ipc.generateTableDdl` / `truncateTable` / `dropTable`; fetch-all is `runQuery` `SELECT * FROM` quoted table (not compact) | No |
| SET search_path | `ipc.setSearchPath` + schema picker **DONE** | No |
| Test connection without session | `ipc.testConnection` **DONE** | No |
| Cancel in-flight query | `ipc.cancelQuery` + hatch Stop/Esc **DONE** | No |
| Per-tab visual document | `visualDocumentJson` on DTO persist + hydrate **DONE** | No |
| SwiftData importer | out of SP-4b | SP-6 / release notes |

**Rule:** SP-3 store/IPC existence ≠ UI done. Workspace chrome **binds** welcome, tables names, Queries, tabs, history, URI mode, and native menus. Last slice binds collapse sidebar, SQL hatch, grid mutation, database picker, loading overlay, and table-browser host (Show All Rows / expand / DDL / export / truncate / drop).

---

## 6. First-slice subset (shell + read-only grid only)

**Status: shipped** 2026-08-15 on `feat/sp-4b-ui` (HEAD at ledger update: `f4167ba`). Spec: `first-slice-shell-results.md`. Remaining clusters stay **SEQUENCE**.

Confirmed grinding scope: **app shell + read-only results grid; canvas stays primary; remaining clusters SEQUENCE.**

Extracted from §2 (FIRST-SLICE rows only):

1. [x] **Canvas remains the primary editor** in the main column (`VisualQueryCanvas`). Do not wrap it as a secondary mode inside a SQL-first `QueryEditorView` clone.
2. [x] **Vertical split:** canvas above results; both min-heights; divider draggable (`WorkspaceSplit` + `.app-main-column` min 550px).
3. [x] **Keep existing `ConnectionPanel`** as the connect surface for this slice (sidebar picker SEQUENCE). Empty profile list still has heading + New profile. Swift “No connections” copy shipped in workspace chrome (§6.1).
4. [x] **Read-only results table** bound to the **executing/active tab** `compact` grid + column headers after `runSelectOnActiveTab` (idle ignores hydrated cache).
5. [x] **Loading** state in the results pane while `status.kind === "running"`.
6. [x] **Error** state in the results pane from `status.kind === "error"` / `IpcError.message`.
7. [x] **Empty copy:** “Run a query to see results” vs “No rows found”; 0-row SELECT still shows headers.
8. [x] **NULL** token for SQL nulls (`formatResultCell`).
9. [x] **Compaction** already applied in tabs-store is what the grid shows.
10. [x] **SSL/SSH/save/connect/delete/switch** remain as already shipped in the panel (not rebuilt).
11. [x] **View generated SQL** toolbar → dialog (Copy, Done, `—`); no always-on `.vq-sql-preview`.
12. [x] **SELECT-only Run** (CREATE/UPDATE/DELETE disabled); `canRun` help stays on the toolbar.
13. [x] **Start over** resets canvas + clears results; ignores in-flight IPC; does not call `deleteHistory` / `clearHistory`.
14. [x] **Constraint honored for first-slice:** no pagination, filter, sort, JSON, edit, delete, toast, tab bar, saved queries, SQL editor, history, table list, create-database, or static pages **in that slice** — later SEQUENCE items that workspace chrome shipped are listed in §6.1.

**Out of first-slice but must appear on the full SP-4b bar:** every SEQUENCE row in §2 (including small pages Help/Welcome/Settings/Shortcuts/CreateDatabase).

---

## 6.1 Workspace-chrome subset (shipped 2026-08-15)

**Status: shipped** 2026-08-15 on `feat/sp-4b-ui` (HEAD at ledger update: `e7b97f5`). Spec: `docs/pocket/spec/2026-08-15-sp4b-workspace-chrome/workspace-chrome.md`. Collapsible connection sidebar **shipped** in the last slice.

1. [x] Welcome iff 0 profiles and form hidden; Cancel / delete-last returns to welcome.
2. [x] “No connections” when the form is showing and the list is empty.
3. [x] Tables names in the connection column (loading / empty / fail copy). Show All Rows / expand / DDL / export / truncate / drop wired from `App` after this subset.
4. [x] Connection-string mode (parse on Save; edit read-only + Copy).
5. [x] Queries column left of canvas, including disconnected; B′ success cache; + named query clears active tab; rename / delete confirm / move / dual folder-delete.
6. [x] Tab bar hidden at 1 tab, `+` visible; in-session per-tab visual documents; close last recreates; Accel+T/W.
7. [x] History sheet from canvas toolbar; global list; Copy; export JSON/CSV/SQL; fail ≠ empty copy. Relative date labels shipped (epoch `created_at`).
8. [x] Native Help / Keyboard Shortcuts / Settings; Accel+Enter Run (SELECT-only, no-op if disabled); Settings radios persist (grid dates applied).

**Still SEQUENCE after this slice:** context-mismatch editability help; row-editor typed pickers / saving-state disable; table-load timeout 300s.

---

## 7. Gaps / unread / residual uncertainty

### Unread or only sampled (do not treat as fully specified)

- `ViewModels/ConnectionFormViewModel.swift` (~800 lines): save/keychain/URI parse sampled (`testConnection`, `saveConnection` start, `copyConnectionString`); full validation matrix unread.
- `ViewModels/ConnectionSidebarViewModel.swift`, `ViewModels/RootViewModel.swift` (tab restore, `selectDatabase`, generation counters): entry + initialize sampled.
- `ViewModels/SavedQueriesViewModel.swift` from `loadQuery` onward (duplicate/delete/move internals).
- `ViewModels/DetailContentViewModel.swift` from `fetchPrimaryKeysAndShowDeleteDialog` (save/delete perform).
- `Services/QueryService.swift`, `DatabaseService.swift`, `PostgresQueryExecutor.swift` (exact CREATE/DROP/DDL SQL).
- `Services/TabService.swift`, `State/TabManager.closeTab` remainder, `State/ConnectionState.swift`.
- `Utilities/QueryWrapping.swift` (LIMIT/OFFSET SQL shape for browse).
- `DragonDBTests/QueryDecisionsTests.swift`, `QueryStateTests.swift` (beyond rowsPerPage), `ConnectionStateTests.swift`, Tauri `tests/stores/**` (not re-audited here; SP-3 spec claims they exist).
- Visual-query Swift tests (SP-4a contract; not SP-4b chrome).

### Residual product risks (needs-decision, not guessed)

1. **Database-as-picker vs database-as-profile-field** — picker + switch **shipped**; profile.database remains the connect default.
2. **Per-tab visual IR after quit** — **done** (`visualDocumentJson` persist + hydrate).
3. **History from canvas** — **done** 2026-08-15 (Swift visual mode hid the button; Tauri exposes it on the canvas toolbar).
4. **SELECT-only canvas run** vs Swift CREATE confirm — **recorded 2026-08-15:** keep SELECT-only for first-slice; confirm+execute remains SEQUENCE if reversed.
5. **Cancel query** — hatch Stop/Esc + `ipc.cancelQuery` **shipped**; table-load timeout still missing.
6. **Truncate/Drop/DDL** — **done** dedicated `ipc.truncateTable` / `dropTable` / `generateTableDdl` (never hatch `runQuery`).
7. **Favorites**, **PK badges** without catalog enrichment (foreign-table icon shipped).
8. **Auto-create SavedQuery** on SQL typing — **done** (`useSavedQueryAutosave`).
9. **Global vs per-profile history** UI — **done** global list 2026-08-15.
10. **JSON/CSV from grid** using compact vs raw tab buffers.

### Stop conditions honored

- All 52 `Views/` files listed; none missing on disk.
- First-slice implementation shipped 2026-08-15; workspace chrome shipped 2026-08-15 (`e7b97f5`); remaining SEQUENCE clusters not silently dropped (context-mismatch help, typed row-editor pickers, table-load timeout 300s).
- No DROP without unreachable-file evidence.
- SP-2/SP-3 not claimed incomplete where files show shipped IPC/stores; SEQUENCE UI still missing.

---

## Appendix A — Full `Views/` account (52)

SP-4a (not SP-4b new UI): `Components/VisualQuery/{VisualClauseCardFieldViews,VisualStatementRootCardView,VisualClauseCardView,SchemaFieldPopover,VisualQueryToolbar,GeneratedSQLPreviewView,VisualStatementPickerView}.swift`, `Containers/Content/VisualQueryCanvasView.swift`.

SP-4b App shell: `MainSplitView`, `RootView`, `ResizableSplitView`, `LoadingOverlayView`, `Badge`, `EmptyQueryResultsView`, `MutationToastView`.

SP-4b Connection: `ConnectionFormView`, `ConnectionsListView`, `ConnectionDatabasePicker`, `ConnectionDropdown`, `ConnectionStatusBanner`.

SP-4b Sidebar: `ConnectionsDatabasesSidebar`, `SavedQueriesSidebarSection`, `SavedQueryRowView`, `QueryFolderRowView`, `SchemaPicker`, `MoveToFolderSheet`, `EditQuerySheet`, `EditFolderSheet`.

SP-4b Results: `QueryResultsView`, `QueryResultsComponent`, `RowEditorView`, `QueryResultsToolbar`, `JSONViewerView`, `DetailContentModals`, `ColumnRowView`.

SP-4b Table browser: `TablesListView`, `TableListRowComponent`, `SchemaGroupView`, `TableExportSheet`, `TableDDLSheet`, `TableContextMenuModals`.

SP-4b Query editor: `QueryEditorView`, `QueryEditorComponent`, `SyntaxHighlightedEditor`, `LineNumberRulerView`.

SP-4b History: `QueryHistoryView`.

SP-4b Tab bar: `TabBarView`.

SP-4b Database: `CreateDatabaseView`.

SP-4b Static: `HelpView`, `KeyboardShortcutsView`, `WelcomeView`, `SettingsView`.
