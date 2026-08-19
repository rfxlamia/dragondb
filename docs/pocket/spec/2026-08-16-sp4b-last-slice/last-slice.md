# SP-4b last slice — remaining SEQUENCE SHIP

**Date:** 2026-08-16
**Status:** approved
**Author:** brainstorm session (pocket-grinding)
**Spec path:** docs/pocket/spec/2026-08-16-sp4b-last-slice/last-slice.md
**Parity ledger:** docs/pocket/spec/2026-08-14-sp4b-remaining-ui/swift-parity-prerequisites.md
**Previous slice:** docs/pocket/spec/2026-08-15-sp4b-workspace-chrome/workspace-chrome.md
**Parent:** docs/superpowers/specs/2026-08-10-cross-platform-design.md §12.1

After this slice ships, **no SEQUENCE SHIP row** in ledger §2.1–2.11 may remain open. Tick the ledger the same way as §6.1.

---

## Summary

Close every remaining Swift-parity UI behavior on `feat/sp-4b-ui`: collapsible connection column, launch overlay + restore, database picker with create/delete, Test connection, SQL hatch (visual stays default), table browse + grid mutation, catalog PK/FK and foreign tables, tab titles + persist visual IR, history relative dates plus delete/clear. Canvas stays primary. Dedicated Rust IPC for catalog, database management, Test, cancel, truncate/drop/DDL, `SET search_path`, and global history clear — not raw `runQuery` for those app-generated mutations.

---

## Context

### Current State

- Workspace chrome shipped: Welcome **or** Connection | Queries | TabBar + canvas / read-only `QueryResultsPane`. History from canvas toolbar. Native Help / Shortcuts / Settings.
- `runSelectOnActiveTab` is the only results writer. Table name buttons are inert. Statement picker still offers CREATE/UPDATE/DELETE.
- IPC ready to bind: `duplicateSavedQuery`, `updateRow` / `deleteRows`, `query-editability.ts`, date-format `localStorage`, `pendingDeletedIds`, `listTables` / `listColumns` (PK/unique/FK hardcoded `false`; tables SQL is `BASE TABLE` only).
- Missing Rust: list/switch/create/delete database, `testConnection`, cancel/interrupt, catalog enrichment, `tableType`, visual IR on `TabStateDto`, global history wipe (`clearHistory` is per-profile).
- History `formatRelativeDate` uses `Date.parse`; rusqlite `created_at` is epoch-millis text — UI shows raw digits.
- No SQL highlighter dependency. `src/core/` off-limits.

### Problem / Motivation

Parent §12.1 forbids silent-drop. Workspace chrome deferred collapse, hatch, browse, mutation, and picker. The user required one last grinding so **nothing from the Swift prerequisite ledger carries over**.

### Related Areas

- `src/App.tsx`, `src/App.css`, `src/ui/**`, `src/stores/**`, `src/ipc/**`, `src/lib/**`
- `src-tauri/src/{commands.rs,session,postgres,storage}`
- Swift: `RootView`, `MainSplitView`, `ConnectionFormView`, `ConnectionDatabasePicker`, `ConnectionsDatabasesSidebar`, `SavedQueriesSidebarSection`, `QueryResultsView`, `TablesListView`, `QueryEditorView`, `TabBarView`, `QueryHistoryView`, `CreateDatabaseView`, services for DB management / query cancel / catalog
- Ledger: `swift-parity-prerequisites.md` §2.1–2.11 remaining `[ ]` SEQUENCE SHIP rows

---

## Scope

### In-Scope

- Shell: collapse Connection column; launch overlay + restore; background persist; mutation toast host; window title = database; create-database sheet host; detail modals host
- Connection: Test (temporary probe); status banner; show-password; Save-then-Connect prompt on **create**; database picker + create/delete DB; restore last connection (tab profile + last picker DB)
- Queries remainder: refresh overlay; schema picker + `SET search_path`; folder disclosure; deselect `savedQueryId`; duplicate; filter/sort; green cache dot; 500ms auto-save SQL; auto-create SavedQuery when hatch typing with none selected; empty-folder delete on folder row; rename folder; Move No Folder / New Folder; multi-select delete + Delete key
- Results: Settings date format on grid cells; filter; sort; multi-select; JSON viewer; edit row; delete rows; editability disable; Delete/Space; pagination **table-browse only**
- Table browser: Show All Rows (click ≠ mere selection); column expander with PK/FK icons; grouped schemas / load more 100; DDL/export/truncate/drop; foreign-table icon
- SQL hatch: Visual | SQL toggle (one surface, default Visual); CodeMirror highlight + line numbers; cancel after 3s + Esc; timeout 300s; no-db alert; multi-statement like Swift; hatch mutations + history
- Visual picker: **only SELECT** (hide CREATE/UPDATE/DELETE)
- Tabs: titles `db / query` not Untitled; “Closing...”; persist visual IR after quit; switch saves query text
- History: relative labels from epoch millis; 1.2s copy checkmark; per-row delete; Clear **entire global list**
- Every remaining ledger SEQUENCE SHIP row in §2.1–2.11

### Out-of-Scope

- Dark mode; SP-5; SP-6; SwiftData importer
- Redesign `src/core/`
- DROP (dead): `ResizableSplitView`, `ConnectionsListView`, `ColumnRowView`, `Badge` as a screen (PK/FK icons are table expander, not Badge)
- SQL → visual IR parser (cards and hatch text stay independent)
- Clone Swift SQL-primary `MainSplitView` (SQL as default editor)
- Favorites star UI (`isFavorite` DTO unused)
- Visual CREATE/UPDATE/DELETE on canvas (including Swift CREATE confirm)
- Moving History off the canvas toolbar (Tauri already exposes it on visual)

---

## Architecture Constraints

- Layers this work **may** touch: `src/ui/**`, `App.tsx`, `App.css`, stores, `src/lib/**`, `src/ipc/**`, `src-tauri` for the dedicated IPC listed in Design Decision
- Layers this work **must NOT** touch: `src/core/` redesign; dark theme; SP-5/SP-6
- Patterns: English copy + a11y ids; light-only; canvas primary; compact grid for **display**; **raw** buffers for JSON viewer and CSV export; generation-aware writers for SELECT / browse / mutation; no runtime mocks; no silent-drop
- `runSelectOnActiveTab` remains the SELECT-grid writer. Browse and mutation get sibling writers that share tab generation (stale results must not land).
- Architecture validation result: **CONDITIONAL PASS** (2026-08-16) — Option B IPC accepted; Monaco rejected (see Phase 6)

### Phase 6 checklist

- [x] Layer boundaries (core untouched; Tauri owns new commands)
- [x] Existing patterns (copy/a11y modules, zustand, Testing Library, DragonIpc camelCase)
- [x] No forbidden deps — CodeMirror 6 for hatch; Monaco rejected
- [x] Build-vs-buy: highlighter is CodeMirror (`@codemirror/lang-sql` PostgreSQL dialect), not a hand-rolled lexer; identifier quoting and catalog SQL live in Rust
- [x] Rollback: revert branch / commits + sqlite column for visual IR
- [x] No silent contract change: new IPC and `TabStateDto` field are explicit
- [x] Performance: CodeMirror acceptable; Monaco workers/bundle not acceptable in this webview
- [x] Security: dedicated truncate/drop/DDL quote identifiers in Rust; Test does not write secrets to sqlite; hatch SQL still uses existing `runQuery`

### ARCHITECTURE VALIDATION RESULT

```
Status: CONDITIONAL PASS

Checks run: quick checklist + anti-patterns (layering, coupling, contracts, concurrency)
Anti-patterns reviewed: leaky abstraction, silent breaking change, race/generation, shotgun surgery (accepted: last-slice is many files, packetized in planning)

Findings:
  ✓ Layer boundaries — UI/stores/IPC/Tauri; core remains pure
  ✓ Test isolation — static/temporary probe, not connect+disconnect
  ✓ Cancel — real interrupt, not wait-for-finish
  ✓ Picker vs profile.database — session/tab databaseName, not rewriting the profile field
  ✗ Monaco as hatch editor — violated performance/integration for Tauri+Vite (workers, CSS, bundle)
  ⚠ Shared selectedTable / search_path / tab generation — mitigated by Swift 1:1 GWT below
  ⚠ sqlite visual IR column — explicit schema add, not stuffed into queryText

Mitigations applied before handoff:
  - Hatch editor is CodeMirror 6, not Monaco (Option B’s IPC surface unchanged)
  - CREATE/DROP DATABASE use a maintenance connection pattern in dedicated IPC (Postgres cannot CREATE/DROP the DB you are connected to; CREATE cannot run inside a transaction)
  - Global history Clear is a new command (existing clearHistory(profileId) is insufficient)
```

---

## Dependencies

### Existing (to leverage)

- `react-resizable-panels` — collapse Connection column (or hide/show the existing column without a new split library)
- `zustand` stores — tabs, session, schema, library, history
- `duplicateSavedQuery`, `updateRow`, `deleteRows`, `saveTextFile`, `saveCsvFile`, `toCsv`
- `query-editability.ts`, `query-type-detector.ts`, `sql-statement-splitter.ts`, `date-format-setting.ts`, `result-compactor.ts`
- `tab-documents.ts` — extend persist onto `TabStateDto`
- `@tauri-apps/plugin-dialog` — export save panels
- `tokio-postgres` — catalog queries, cancel, maintenance-db CREATE/DROP DATABASE

### New (proposed)

- `@codemirror/view`, `@codemirror/state`, `@codemirror/lang-sql` (and the small set of CodeMirror 6 packages required for line numbers + light theme) — SQL hatch highlight + line numbers; skip highlight when `queryText.length > 50_000`
  - Alternatives rejected: Monaco (Phase 6 performance fail); Prism/highlight.js (read-only, not an editor); hand-rolled highlighter (commodity)

---

## Session decisions (override Swift where they conflict)

1. Save of a **new** profile → prompt “Connection Created” / “Connect now?” / Connect / Not Now
2. SQL hatch typing with no selected SavedQuery → auto-create SavedQuery (Swift auto-create)
3. JSON viewer and CSV from grid → **raw/full** values, not compact truncated cells
4. Visual canvas **SELECT-only**; picker **hides** CREATE, UPDATE, DELETE
5. SQL hatch multi-statement → Swift `DatabaseService`: split, sequential, BEGIN/COMMIT unless user SQL already has transaction commands; grid = last statement that returned rows; failure ROLLBACK
6. Launch restore → active tab `connectionId` + tab `databaseName` (last picker), **not** `profile.database` (login entrypoint only)
7. No favorites star UI
8. Column expander shows PK/FK icons (catalog enrichment)
9. Foreign tables listed with distinct icon
10. Hatch = segmented Visual | SQL, one surface, **default Visual** (Swift default SQL overridden)
11. History extras: per-row delete **and** Clear of the **entire visible global list**
12. Empty folders deletable from the folder row
13. Test = temporary connection (+ own SSH tunnel if needed), teardown; **never** mutates live session; banner min 150ms
14. Connected but no database selected → Run/Accel+Enter **shows** Swift alert “Select a database from the sidebar before running queries.” (not disabled). Disconnected → Run disabled no-op (no alert)
15. Remaining SEQUENCE SHIP not listed here → Swift 1:1
16. Design: **Option B dedicated IPC** for app-generated catalog/DDL/DB/truncate/drop/search_path/test/cancel/global-clear; hatch editor **CodeMirror** (Monaco dropped at validation)

---

## Stories + Scenarios

### Story: App shell

> As a returning user, I want overlay, persist, collapse, toasts, and window title so launch and mutations match Swift chrome.

**Rule: Launch overlay**
- Success: phases until connect + tables ready
- Failure: overlay ends; Connection Error alert

```gherkin
Scenario: Launch overlay success
  Given persisted tabs and last profile exist
  When the app launches
  Then a dimmed overlay shows phase copy until connect and table load finish
  And the workspace is then interactive

Scenario: Launch overlay connection failure
  Given persisted tabs and last profile exist
  When connect fails during launch
  Then overlay ends
  And a Connection Error alert shows the human message

Scenario: Restore missing database
  Given tab.databaseName is absent from listDatabases
  When launch connect succeeds
  Then no database is selected
  And the picker shows the pulse Select DB state
```

**Rule: Background persist**
```gherkin
Scenario: Background persist query text
  Given the active tab has typed SQL "SELECT 1"
  When the window is hidden or closed
  Then that query text is persisted
  And cached results are not persisted unless includeCachedResults is true

Scenario: Persist does not wipe cached results blob
  Given a successful SELECT was persisted with includeCachedResults true
  When the window is hidden (includeCachedResults false)
  Then query text is saved
  And the existing results blob is not wiped
```

**Rule: Collapse connection column**
```gherkin
Scenario: Collapse connection column
  Given the workspace is showing Connection | Queries | canvas
  When the user hides the connection column
  Then Connection is not visible
  And Queries | canvas remain
  And showing it again restores the column without disconnecting
```

**Rule: Mutation toast**
```gherkin
Scenario: Mutation toast View Table
  Given a successful UPDATE that returns 0 rows
  When the mutation completes
  Then a bottom-trailing toast shows the success title
  And View Table is visible
  And the toast auto-dismisses after 5 seconds

Scenario: DROP TABLE toast hides View Table
  Given a successful DROP TABLE
  When the toast appears
  Then View Table is not shown

Scenario: View Table from toast
  Given mutation toast shows View Table for table orders
  When the user clicks View Table
  Then orders is selected
  And requestTableQuery runs only if it was already selected
  And the toast dismisses
```

**Rule: Window title and create-database host**
```gherkin
Scenario: Window title follows picker
  Given the session database is analytics
  When the user looks at the window title
  Then it is "analytics"

Scenario: Create database becomes session DB
  Given the user is connected
  When Create Database succeeds with name "shop"
  Then selected database is shop
  And the table list reloads for shop
  And the sheet does not require a second Connect click

Scenario: Create DB failure no half-update
  Given Create Database fails
  When the error returns
  Then the picker and session database are unchanged
  And the Swift error label is shown
```

### Story: Connection

> As a user managing servers, I want Test, banners, password reveal, picker, and restore without treating profile.database as the session database.

**Rule: Test probe**
```gherkin
Scenario: Test success does not connect
  Given the form is filled and the app is disconnected
  When the user clicks Test and the probe succeeds
  Then the banner shows success
  And isConnected remains false

Scenario: Test failure leaves live session
  Given a live session to profile A
  When Test is run on a form for a host that fails
  Then the live session to A remains connected
  And the form banner shows error
```

**Rule: Save-then-Connect**
```gherkin
Scenario: Save-then-Connect Not Now
  Given the user saves a brand-new profile
  When they choose Not Now
  Then the profile is persisted
  And the session stays disconnected

Scenario: Save-then-Connect Connect
  Given the user saves a brand-new profile
  When they choose Connect
  Then the session connects with that profile
```

**Rule: Show password and picker**
```gherkin
Scenario: Show password
  Given the password field is masked
  When the user toggles show-password
  Then the secret is visible
  And toggling again masks it

Scenario: Picker switch database
  Given connected via profile database postgres, picker selects shop
  When tables load
  Then the table list is for shop
  And the saved profile.database field is still postgres

Scenario: Picker persists tab.databaseName
  Given connected and picker selects shop
  When the selection commits
  Then active tab.databaseName is shop
  And profile.database is unchanged

Scenario: Restore last picker database
  Given last session tab stored databaseName shop
  When the app launches and connect succeeds
  Then selected database is shop
  And tables load for shop

Scenario: Delete database confirm
  Given picker lists shop
  When the user confirms Delete Database
  Then dedicated delete IPC succeeds and picker refreshes
  And if shop was selected, selection is cleared

Scenario: Delete database failure rolls back
  Given Delete Database was confirmed and DROP fails
  When the error returns
  Then picker, session, and table list roll back to the pre-delete snapshot
  And the Swift delete-error alert is shown
```

**Rule: No-database Run**
```gherkin
Scenario: Connected no database shows alert
  Given connected and no database selected
  When Run or Accel+Enter is invoked on Visual or SQL hatch
  Then the alert "Select a database from the sidebar before running queries." is shown
  And Run is not disabled

Scenario: Disconnected Run is no-op
  Given disconnected
  When Run or Accel+Enter is invoked
  Then it is a no-op
  And the no-database alert is not shown
```

### Story: Sidebar and saved queries

> As a user organizing SQL, I want Swift sidebar remainder including empty-folder delete and hatch auto-save.

```gherkin
Scenario: Schema picker SET search_path
  Given connected with schemas public and audit
  When the user selects audit
  Then dedicated setSearchPath runs for audit, public
  And the table list filters to audit

Scenario: All Schemas search_path
  Given a named schema was selected
  When the user selects All Schemas
  Then SET search_path TO public runs
  And the table list is unfiltered

Scenario: Schema SET failure alert
  Given setSearchPath fails
  When the error returns
  Then an alert shows
  And OK clears it

Scenario: Deselect saved query
  Given the active tab savedQueryId is Q1
  When the user deselects Q1
  Then savedQueryId is null

Scenario: Duplicate query
  Given saved query "Report"
  When the user duplicates it
  Then a new saved query exists with copied SQL

Scenario: Filter no matches
  Given queries named Alpha and Beta
  When the filter is "zzz"
  Then copy is "No matching queries"

Scenario: Auto-create on SQL typing
  Given SQL hatch is showing and no saved query is selected
  When the user types "SELECT 1" and 500ms elapses
  Then a new Saved Query is created and selected
  And queryText is saved into it

Scenario: Auto-save skip while restoring
  Given the tab is restoring query text
  When restore writes the buffer
  Then no extra SavedQuery is created from that write

Scenario: Delete empty folder
  Given folder Laporan has 0 queries
  When the user deletes the folder from the folder row and confirms
  Then the folder is gone

Scenario: Refresh overlay
  Given tables are listed
  When the user clicks sidebar refresh
  Then a refresh overlay shows at least 0.45s
  And databases and tables re-fetch
```

### Story: Results grid

> As a user reading and editing results, I want dates, filter, sort, JSON, and row ops on raw data.

```gherkin
Scenario: Date format from Settings
  Given Settings is us and a cell is timestamp 2026-08-15T12:00:00Z
  When the grid renders
  Then the cell uses US date formatting
  And values over 64 chars are not parsed as dates

Scenario: Filter results
  Given the grid has rows containing "alpha" and "beta"
  When the filter is "ALP"
  Then only matching rows remain

Scenario: Sort nulls last
  Given column X has values 2, NULL, 1
  When the user sorts X ascending
  Then order is 1, 2, NULL

Scenario: JSON viewer raw
  Given a selected row whose compact cell is truncated
  When JSON viewer opens
  Then the JSON contains the full raw value

Scenario: CSV download selected raw
  Given selected rows with a truncated compact cell
  When Download CSV runs
  Then the file contains full raw fields (RFC4180)

Scenario: Edit disabled for JOIN without leftover table
  Given results came from SELECT with JOIN and selectedTable is nil
  When the user looks at edit/delete
  Then they are disabled with the Swift JOIN reason title

Scenario: Leftover selectedTable after JOIN hatch
  Given Show All Rows left orders selected
  When the user runs SQL-hatch SELECT with JOIN
  Then editability follows Swift sourceTable short-circuit (selectedTable still orders)

Scenario: Delete rows confirm
  Given 2 selected editable rows
  When the user confirms "Delete 2 row(s)?"
  Then deleteRows runs
  And the grid refreshes

Scenario: Edit one row only
  Given two grid rows are selected
  When Edit is invoked
  Then Swift copy "Multiple Rows Selected" / "Please select only one row to edit at a time." is shown

Scenario: Space opens JSON
  Given at least one row selected
  When Space is pressed on the grid
  Then JSON viewer opens
```

### Story: Table browser

> As a user exploring tables, I want Show All Rows, expander, groups, DDL/export/truncate/drop, foreign icon, PK/FK.

```gherkin
Scenario: Click runs Show All Rows
  Given tables list includes public.orders
  When the user clicks the name
  Then a paginated SELECT for orders fills the results grid
  And the first page has at most 100 rows

Scenario: Selection without click does not fetch
  Given a table is focused without Show All Rows
  When no click occurs
  Then no browse query is sent

Scenario: Next page
  Given page 0 returned 101 rows internally (limit+1)
  When the user clicks Next
  Then page 1 loads
  And Prev becomes enabled

Scenario: Expand columns PK icon
  Given orders has primary key id
  When the user expands the table
  Then columns show names, types, and a PK icon on id

Scenario: Foreign table icon
  Given a foreign table remote_orders exists
  When the list renders
  Then remote_orders appears with the foreign-table icon

Scenario: Drop confirm
  Given context menu Drop on public.temp
  When the user confirms the irreversible copy
  Then dedicated drop IPC runs and the list refreshes

Scenario: Menu disabled while executing
  Given a query is running
  When the user opens a table context menu
  Then Refresh/DDL/Export/Truncate/Drop are disabled

Scenario: Browse sets editability source
  Given Show All Rows on public.orders succeeded
  When editability is computed
  Then rows are editable as table orders

Scenario: Stale browse ignored
  Given Show All Rows for orders is in flight
  When the user clicks customers
  Then orders results do not replace the customers generation
```

### Story: SQL hatch

> As a user needing typed SQL, I want a secondary CodeMirror editor with run/cancel/timeout and multi-statement.

```gherkin
Scenario: Toggle to SQL hatch
  Given Visual canvas is showing
  When the user selects SQL
  Then the canvas is hidden
  And the SQL buffer shows tab.queryText

Scenario: Toggle back keeps cards
  Given visual cards exist and user switched to SQL
  When they select Visual
  Then the same cards are restored

Scenario: SQL run mutation toast
  Given SQL hatch text UPDATE t SET x=1 WHERE false
  When Run succeeds with 0 rows
  Then a mutation toast appears
  And the grid is not replaced as a SELECT result

Scenario: SQL run SELECT uses same grid
  Given SQL hatch text SELECT 1 AS n
  When Run succeeds
  Then the results pane shows column n and one row

Scenario: Empty SQL hatch does not run generated visual SQL
  Given visual cards exist and tab.queryText is empty
  When the user toggles to SQL and Runs
  Then the empty hatch buffer is submitted (not generated visual SQL)
  And cards stay unchanged

Scenario: Cancel after 3s
  Given a query has been running > 3 seconds
  When the user presses Esc or Stop
  Then the run is interrupted
  And status is "Query cancelled"
  And results are cleared

Scenario: Highlight skipped for huge buffer
  Given queryText length is 50_001
  When SQL hatch renders
  Then line numbers still show
  And syntax highlight is skipped

Scenario: Multi-statement last result
  Given buffer is SELECT 1 AS a; SELECT 2 AS b
  When Run succeeds
  Then the grid shows column b and value 2

Scenario: Multi-statement rollback
  Given buffer is a two-statement script whose second statement fails
  When Run fails
  Then the transaction is rolled back
  And an error is shown

Scenario: Picker only SELECT
  Given the visual statement picker is open
  When it renders
  Then CREATE, UPDATE, DELETE are not present
  And only SELECT can be chosen

Scenario: Stale hatch run ignored
  Given a SQL-hatch or Visual Run is in flight
  When the user Runs again or switches tabs
  Then generation-aware writers ignore the stale result
```

### Story: Tabs remainder

```gherkin
Scenario: Tab title with saved query
  Given selected database shop and saved query "Daily"
  When the tab bar shows that tab
  Then the label is "shop / Daily"

Scenario: Closing pending
  Given close is in flight for tab T
  When the user clicks T
  Then the click is ignored
  And the label is "Closing..."

Scenario: Persist visual IR after quit
  Given tab T has visual cards (FROM orders)
  When the app quits and relaunches
  Then tab T restores those cards
  And not an empty canvas

Scenario: Switch saves SQL buffer
  Given tab A SQL hatch text is "SELECT 1" and user switches to tab B
  When they return to A
  Then the buffer is still "SELECT 1"
```

### Story: History remainder

```gherkin
Scenario: Relative date from epoch millis
  Given createdAt is "1723700000000" (epoch millis text)
  When the history row renders
  Then a relative label is shown (not the raw digits)

Scenario: Delete one history row
  Given the sheet lists 3 entries
  When the user deletes one
  Then 2 remain

Scenario: Clear all profiles
  Given history contains runs from profile A and B
  When the user confirms Clear
  Then the list is empty
  And empty copy is shown
```

---

## Acceptance Criteria

```
ACCEPTANCE CRITERIA — SP-4b last slice
Date: 2026-08-16 | Scope confirmed: yes

Rule: Shell
  ✓ Given persisted tabs + last profile, When launch, Then overlay phases then ready
  ✓ Given connect fails at launch, Then Connection Error alert
  ✓ Given hide/close window, Then active query text persisted; results blob not wiped
  ✓ Given hide Connection column, Then Queries|canvas remain; expand restores without disconnect
  ✓ Given 0-row mutation, Then 5s toast with View Table; DROP TABLE hides View Table
  ✓ Given session database analytics, Then window title is analytics
  ✓ Given Create Database shop succeeds, Then shop is selected and tables reload
  ✗ Given Create Database fails, Then session/picker half-updated

Rule: Connection
  ✓ Given Test succeeds while disconnected, Then banner success and isConnected false
  ✓ Given live session A and Test fails, Then A stays connected
  ✓ Given Save new profile, Then Connect now? prompt; Not Now stays disconnected
  ✓ Given picker selects shop, Then tables for shop; profile.database unchanged; tab.databaseName shop
  ✓ Given relaunch, Then restore tab connection + tab.databaseName
  ✓ Given tab.databaseName missing from list, Then pulse Select DB
  ✓ Given connected no DB, When Run/Accel+Enter, Then Swift no-database alert
  ✓ Given disconnected, When Run, Then no-op (no alert)
  ✗ Given Test, Then live session torn down

Rule: Queries
  ✓ Given schemas > 1, When pick audit, Then setSearchPath + filter
  ✓ Given All Schemas, Then search_path public and unfiltered list
  ✓ Given deselect query, Then savedQueryId null
  ✓ Given duplicate, Then new row with copied SQL
  ✓ Given filter zzz, Then "No matching queries"
  ✓ Given hatch typing 500ms with no selection, Then SavedQuery auto-created
  ✓ Given empty folder, When delete from folder row, Then folder gone
  ✓ Given refresh, Then overlay ≥0.45s and lists reload

Rule: Results
  ✓ Given Settings us, Then grid dates use US format; >64 chars not parsed as dates
  ✓ Given filter/sort, Then substring filter; nulls last ascending
  ✓ Given JSON/CSV from selection, Then raw full values
  ✓ Given JOIN and selectedTable nil, Then edit/delete disabled with Swift title
  ✓ Given leftover selectedTable + JOIN hatch, Then Swift sourceTable short-circuit
  ✓ Given 2 rows Edit, Then "Multiple Rows Selected" copy
  ✓ Given 2 rows Delete confirm, Then deleteRows
  ✓ Given Space with selection, Then JSON viewer

Rule: Table browser
  ✓ Given click orders, Then paginated Show All Rows ≤100; mere selection does not fetch
  ✓ Given expand, Then names/types + PK/FK icons
  ✓ Given foreign table, Then listed with distinct icon
  ✓ Given Drop confirm, Then dedicated drop IPC + refresh
  ✓ Given executing, Then table menu actions disabled
  ✓ Given stale browse, Then superseded generation ignored

Rule: SQL hatch
  ✓ Given Visual|SQL toggle, Then one surface; default Visual; cards independent of queryText
  ✓ Given hatch Run SELECT, Then same results grid
  ✓ Given hatch 0-row mutation, Then toast not SELECT grid replace
  ✓ Given empty hatch Run, Then empty buffer submitted, not generated visual SQL
  ✓ Given >3s running, When Esc/Stop, Then interrupted, "Query cancelled", results cleared
  ✓ Given 50001 chars, Then line numbers on, highlight off
  ✓ Given SELECT 1; SELECT 2, Then grid is b=2; failure rolls back
  ✓ Given statement picker, Then only SELECT (CREATE/UPDATE/DELETE hidden)
  ✗ Given hatch Run, Then visual cards rebuilt from SQL

Rule: Tabs + history
  ✓ Given shop + saved query Daily, Then tab label "shop / Daily"
  ✓ Given pending close, Then "Closing..." and clicks ignored
  ✓ Given quit with visual cards, Then relaunch restores IR
  ✓ Given epoch-millis createdAt, Then relative history label not raw digits
  ✓ Given Clear, Then entire global list empty
  ✓ Given delete one history row, Then that row gone

OPEN QUESTIONS (risks if unresolved):
  - CodeMirror package set / light theme tokens → assumed: match existing Inter/JetBrains Mono light UI
  - Exact DragonIpc method names → assumed: camelCase mirroring commands below
  - Swift leftover selectedTable short-circuit copied 1:1 → assumed: yes (user: rest follows Swift)

OUT-OF-SCOPE (remind pocket-planning):
  - Dark mode, SP-5, SP-6, SwiftData importer, src/core/ redesign
  - SQL → visual IR parser; visual DML; favorites star; SQL-primary layout
  - DROP-dead views
```

---

## Design Decision

**Chosen option:** Option B — dedicated mutation/catalog/database IPC — with CodeMirror 6 for the SQL hatch (Monaco dropped at Phase 6).

**Summary:** App-generated Truncate/Drop/DDL/`SET search_path`/list-switch-create-delete database/Test/cancel/global history clear/catalog enrichment are first-class Tauri commands with identifier quoting and typed errors. User-typed SQL in the hatch still uses `runQuery`. Hatch editor is CodeMirror, not Monaco.

**Rejected options:**

- Option A (blessed `runQuery` for Truncate/Drop/DDL/SET): rejected by user to avoid that tech debt this slice
- Option C (textarea + Test=connect+disconnect + cancel=wait): fails Test isolation, cancel interrupt, and highlight GWT
- Monaco as B’s original editor: failed Phase 6 performance/integration

**Key tradeoffs accepted:**

- Larger Rust surface (planning must packetize ≥7 tasks)
- New CodeMirror dependency + light theme work
- Explicit sqlite column for visual IR
- Swift `selectedTable` editability short-circuit copied (JOIN after browse can still look editable)
- History Clear is a Tauri extra vs Swift (global wipe)

---

## Open Questions / Assumptions

| Question | Resolution | Risk if Wrong |
|----------|------------|---------------|
| Hatch editor | CodeMirror 6, not Monaco | Bundle/theme mismatch if packages poorly chosen |
| CREATE/DROP DATABASE | dedicated IPC via maintenance connection (typically `postgres` db), not `runQuery` on the session db | Connecting to the target db would make DROP impossible |
| Global history Clear | new IPC (not loop of per-profile `clearHistory`) | N round-trips / partial clear |
| Visual IR storage | new `TabStateDto` / sqlite column; never stuff JSON into `queryText` | Hatch SQL and cards would clobber each other |
| Leftover `selectedTable` | copy Swift short-circuit | Users may edit the wrong table after a JOIN hatch |
| Empty hatch Run | submit empty text-editor buffer (server/error), not a special client empty alert | Copy may differ slightly from Swift alert vs backend error |
| Favorites | DTO unused, no UI | None |

---

## Implementation Notes

### Dedicated IPC (minimum)

Add to `DragonIpc` + `commands.rs` (names locked at planning; behavior locked here):

- `testConnection(input)` — temporary SSH+DB probe; no session mutation; maps to banner states
- `cancelQuery(connectionId)` — interrupt in-flight `runQuery` / browse; Swift “Query cancelled”
- `listDatabases(connectionId)` / `switchDatabase(connectionId, name)` — picker; switch does not rewrite `profile.database`
- `createDatabase(name)` / `deleteDatabase(name)` — maintenance connection; refresh picker; create selects the new db
- `truncateTable(table)` / `dropTable(table)` — quoted identifiers; then refresh tables
- `generateTableDdl(table)` — DDL sheet + copy
- `setSearchPath(schema \| null)` — named schema → `TO schema, public`; All Schemas → `TO public`
- `listTables` includes `tableType` (`regular` \| `foreign`); union foreign tables like Swift
- `listColumns` fills `isPrimaryKey` / `isUnique` / `isForeignKey` (stop hardcoding false)
- `clearAllHistory()` — wipe all profiles’ history rows
- `saveTabState` persists visual IR JSON on a **new** DTO/sqlite field

Hatch `runQuery` remains for user-typed SQL (including multi-statement sequential execution with transaction wrap in Rust or a dedicated `runScript` that matches Swift `DatabaseService.executeQueryInternal`). App Truncate/Drop/DDL must **not** go through that user-SQL path.

### UI / store

- Collapse Connection without dropping Queries | canvas.
- Overlay phases (Swift copy): Initializing… / Restoring tabs… / Connecting to database… / Loading databases… / Loading tables…
- Statement picker: SELECT only.
- Results: bind compact for cells; keep raw on the tab for JSON/CSV.
- Browse writer: `LIMIT 100` pagination, `limit+1`, generation-aware; sets `selectedTable`.
- Mutation writer: 0-row → toast via `query-type-detector`; SELECT → grid.
- `formatRelativeDate` must accept epoch-millis **and** ISO fixtures.
- Dual exit: `bun run check` + manual verify of overlay, picker, Test, hatch, browse, edit/delete, collapse, history clear, relaunch cards.

### Ledger

After ship: tick every remaining `[ ]` SEQUENCE SHIP row in `swift-parity-prerequisites.md` §2.1–2.11 (same style as §6.1). SP-4b complete iff none remain.

---

## Rollback Plan

- Revert last-slice commits / branch.
- Drop the visual-IR sqlite column with a down migration or restore prior schema if the column was added.
- Remove CodeMirror packages from `package.json`.
- New IPC unused if UI reverted; do not leave half-registered commands that panic.
- `saveCsvFile` / existing profile/connect/`runQuery` stay.
