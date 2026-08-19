# SP-4b workspace chrome — tabs, queries, history, welcome, menus

**Date:** 2026-08-15
**Status:** approved
**Author:** brainstorm session (pocket-grinding)
**Spec path:** docs/pocket/spec/2026-08-15-sp4b-workspace-chrome/workspace-chrome.md
**Parity ledger:** docs/pocket/spec/2026-08-14-sp4b-remaining-ui/swift-parity-prerequisites.md
**Previous slice:** docs/pocket/spec/2026-08-14-sp4b-remaining-ui/first-slice-shell-results.md
**Parent:** docs/superpowers/specs/2026-08-10-cross-platform-design.md §12.1

---

## Summary

Bind remaining **store-ready** Swift chrome onto the Tauri workspace without a SQL-primary layout: welcome gating, tables list in the connection column, a Queries column left of the canvas, a tab bar with in-session per-tab visual cards, history from the canvas toolbar, connection-string mode, and native Help / Shortcuts / Settings. Canvas stays the primary editor. Collapsing the connection sidebar is **SEQUENCE for the next grinding** (Swift `NavigationSplitView`), not dropped.

---

## Context

### Current State

- `App.tsx` is ConnectionPanel | `WorkspaceSplit` (canvas above read-only `QueryResultsPane`). First-slice shipped 2026-08-15.
- `tabs-store`, `library-store`, `history-store`, `schema-store` exist. Canvas document is **one** React tree keyed by `canvasEpoch` (profile switch), not per tab. `TabStateDto` has `queryText` and no visual-document field.
- Saved queries persist SQL `queryText` only. There is no SQL → visual IR parser. Swift visual cards and SQL text are independent; Swift caches saved-query **results** only on SQL-editor execute.
- `listTables` / `listHistory` / library CRUD IPC exist. `saveCsvFile` is CSV-only. No native app menu. `public/onboarding.png` exists.

### Problem / Motivation

After first-slice the learning loop works, but the app still lacks the chrome that makes multiple queries, saved SQL, history, and first-run feel like DragonDB. Parent §12.1 forbids silent-drop. This grinding batches **bind-only** clusters so the migration is not ten separate grinding sessions.

### Related Areas

- `src/App.tsx`, `src/App.css`, `src/ui/connection/*`, `src/ui/visual-query/*`, `src/ui/shell/workspace-split.tsx`, `src/ui/results/*`
- `src/stores/{tabs-store,library-store,history-store,schema-store,session-store,compose-app-stores,run-select-on-active-tab}.ts`
- `src/lib/connection-string.ts`, `src/ipc/contract.ts`, `src-tauri` (menu + generic save only)
- Swift: `RootView`, `WelcomeView`, `MainSplitView`, `TabBarView`, `SavedQueriesSidebarSection`, `QueryHistoryView`, `HelpView`, `KeyboardShortcutsView`, `SettingsView`, `ConnectionFormView` URI mode, `ConnectionsDatabasesSidebar` tables list
- Next grinding (must include): connection sidebar **collapse** (Option C), plus previously planned grid mutation / table browse / SQL hatch

---

## Scope

### In-Scope

- Welcome when 0 profiles and form hidden: `public/onboarding.png`, “Hello, and welcome!”, “Connect to Server...”
- Cancel / hide form with 0 profiles returns to welcome; delete last profile returns to welcome
- “No connections” when the connection list is empty and the form is showing
- Tables names in the left connection column after connect: loading, names, “No tables found”, load-error copy; clear on disconnect; click name does not run a query
- Queries column left of canvas whenever workspace (not welcome) is showing, including disconnected; resizable with existing `react-resizable-panels`
- Saved query click: cards unchanged; B′ session cache — successful canvas Run while Q selected stores compact+status for Q; later click restores that grid; cache dropped on profile switch
- `+` new saved query: auto name `Query yy-MM-dd H:mm:ss`; select it; clear **active tab** canvas + grid (Swift SQL `+`)
- Rename (Save disabled if blank), delete confirm, move folder, delete folder only vs folder+queries; empty “No saved queries”
- Tab bar hidden at 1 tab; visible `+` even at 1 tab; bar visible at ≥2
- New tab: empty canvas + “Run a query to see results”, same connection; ⌘T / Ctrl+T
- In-session per-tab visual cards: switch restores that tab’s cards and grid; not required after quit
- Close last tab recreates empty tab; ⌘W / Ctrl+W; MRU when closing among N
- Start over: only active tab cards+grid. Disconnect: cards remain, locked. Profile switch: all tabs cards+grid empty and B′ cache cleared
- History from canvas toolbar: Swift list (global newest-first, copy, 5-line SQL, no re-run on row click); Export JSON/CSV/SQL; empty copy; listHistory error is an error message; Done/Esc
- Connection string mode: toggle; parse on Save via `connection-string.ts`; invalid URI errors; edit = read-only + Copy
- Native app menu: Help, Keyboard Shortcuts, Settings. Help = Support `https://github.com/rfxlamia/dragondb/issues` + shortcuts. Shortcuts actually bound. Settings date-format radios persist; grid dates unchanged this slice
- Windows Help lists Ctrl accelerators that actually work

### Out-of-Scope

- Collapsible connection sidebar (Swift `NavigationSplitView`) — **SEQUENCE next grinding**, recorded on the parity ledger
- SQL editor hatch; loading saved SQL into visual cards; SQL → IR parser
- Show All Rows, column expander, DDL, table export sheet, schema picker, `SET search_path`, sidebar refresh overlay
- Grid filter / sort / JSON viewer / row edit / delete / pagination / cell date formatting
- Persist visual IR on `TabStateDto` / relaunch
- Database picker, create/delete database, test-connection, cancel query
- Saved-query filter field, six-way sort, duplicate, multi-select delete, green cache dot, 500ms auto-save SQL
- History row delete / clear (`deleteHistory` / `clearHistory` unused)
- Dark mode, SP-5, SP-6
- `src/core/` redesign

---

## Architecture Constraints

- Layers this work may touch: `src/ui/**`, `App.tsx`, `App.css`, session-memory for per-tab visual documents and B′ cache, thin store wiring, `src/ipc/contract.ts` + `src-tauri` **only** for native menu / accelerators and history export save (generic text save if `saveCsvFile` cannot write JSON/SQL)
- Layers this work must NOT touch: `src/core/` (read-only), `src-tauri` beyond menu + export save, library/history **schema** changes, new IPC for listDatabases / cancel / testConnection / visual IR column
- Patterns: English copy + accessibility ids; light-only; canvas primary; ConnectionPanel remains connect surface; `runSelectOnActiveTab` remains the only results writer; compact grid for display; no runtime mocks
- Architecture validation result: **PASS** (2026-08-15)

### Phase 6 checklist

- [x] Layer boundaries (core pure; tauri limited to menu + export)
- [x] Existing patterns (copy/a11y modules, zustand stores, Testing Library)
- [x] No forbidden new dependencies (reuse `react-resizable-panels`, Tauri menu, existing parser)
- [x] Build-vs-buy: split library already installed; native menu via Tauri, not a hand-rolled fake menu bar
- [x] Rollback: revert branch / commits
- [x] No silent DTO/sqlite visual-IR migration
- [x] Performance: in-session maps only; history list existing IPC
- [x] No new secret surfaces beyond existing profile save

---

## Dependencies

### Existing (to leverage)

- `react-resizable-panels` — horizontal Group for Queries | main (vertical split already used)
- `@tauri-apps/api` + Tauri v2 menu / accelerator APIs — native Help/Shortcuts/Settings and ⌘/Ctrl bindings
- `@tauri-apps/plugin-dialog` — save panels for history export
- `src/lib/connection-string.ts` — URI parse on Save
- `library-store` / `history-store` / `tabs-store` / `schema-store` — bind only
- `public/onboarding.png` — welcome mascot

### New (proposed)

none

---

## Stories + Scenarios

### Story: First-run welcome

> As a new user, I want a greeting before any profiles exist, so that the empty app is not a blank form.

**Rule: Welcome iff 0 profiles and form hidden**

```gherkin
Scenario: Launch with no profiles
  Given 0 saved profiles
  When the app launches
  Then the welcome screen shows public/onboarding.png, "Hello, and welcome!", and "Connect to Server..."

Scenario: Connect to Server opens form
  Given the welcome screen
  When the user clicks Connect to Server...
  Then the connection form is showing and welcome is hidden
  And the profile list shows "No connections"

Scenario: Cancel with 0 profiles returns to welcome
  Given 0 profiles and the form showing
  When the user clicks Cancel (hides the form without saving)
  Then welcome returns
  And no profile is saved

Scenario: Delete last profile
  Given 1 profile
  When the user deletes it
  Then welcome returns (form hidden)

Scenario: Cancel with existing profiles
  Given ≥1 profile and a New profile form that is dirty
  When the user clicks Cancel
  Then the workspace stays (not welcome)
  And dirty fields are not saved

Scenario: Launch with profiles
  Given ≥1 saved profile
  When the app launches
  Then welcome is not shown
```

### Story: Tables in the connection column

> As a connected user, I want to see table names without opening FROM, so that the schema is visible.

**Rule: Names only; click does not run**

```gherkin
Scenario: Tables listed after connect
  Given a successful connect
  When listTables returns public.users and other.orders
  Then the left column lists display names (users, other.orders)

Scenario: Loading
  Given connect in flight for tables
  Then the tables region shows loading, not "No tables found"

Scenario: Empty database
  Given listTables returns []
  Then the tables region shows "No tables found"

Scenario: listTables fails
  Given listTables rejects
  Then the tables region shows "Could not load tables. You can still type a name."
  And it does not show "No tables found"

Scenario: Disconnect clears tables
  Given names or a fail copy showing
  When the user disconnects
  Then those names / fail copy are gone

Scenario: Click table does nothing
  Given names listed
  When the user clicks users
  Then no query runs and canvas/grid are unchanged
```

### Story: Queries column

> As a user, I want saved queries beside the canvas, so that I can pick a named query without a SQL editor.

**Rule: Column visible in workspace; click does not change cards; B′ caches successful Run**

```gherkin
Scenario: Queries column layout
  Given workspace (not welcome), including disconnected
  Then a Queries column sits left of the canvas (not inside ConnectionPanel)
  And its width is user-resizable
  And it is hidden on welcome

Scenario: Empty list
  Given no saved queries
  Then the column shows "No saved queries"

Scenario: Click Q1 with B′ cache
  Given Q1 was selected, a canvas Run succeeded with 10 rows
  And the user then selected Q2
  When the user clicks Q1
  Then Q1 is selected, visual cards do not change to Q1 SQL
  And the grid shows those 10 rows (or 0-row headers + "No rows found" if that was the success)

Scenario: Failed run does not overwrite B′
  Given Q1 has a success cache
  When a later Run while Q1 is selected fails
  Then clicking Q1 still restores the last success cache

Scenario: Profile switch drops B′
  Given Q1 cache from profile A
  When the user switches to profile B
  Then all tabs are empty and clicking Q1 does not refill A's rows

Scenario: Plus new query
  Given Q1 selected with cards and grid
  When the user clicks + in Queries
  Then a new query is selected named like Query yy-MM-dd H:mm:ss
  And the active tab canvas is empty and the grid shows "Run a query to see results"

Scenario: Rename blank
  Given rename sheet open
  When the name is blank
  Then Save is disabled

Scenario: Delete folder
  Given a folder with queries
  When the user deletes the folder
  Then they can choose Delete Folder Only or Delete Folder and Queries
```

### Story: Tabs and per-tab cards

> As a user, I want more than one visual query at once, so that switching tabs restores what I was building.

**Rule: In-session documents; bar at count > 1; never 0 tabs**

```gherkin
Scenario: One tab hides the bar, plus remains
  Given 1 tab
  Then the tab strip is hidden
  And a New Tab + control is still visible

Scenario: New tab
  Given 1 tab with SELECT+FROM users cards, connected
  When the user clicks + or presses Accel+T
  Then 2 tabs, bar visible, the new tab is empty canvas + "Run a query to see results"
  And connection is unchanged
  And tab 1's cards are unchanged

Scenario: Switch restores cards
  Given tab 1 has SELECT+FROM users
  When the user switches to tab 2 then back to tab 1
  Then tab 1 still shows SELECT+FROM users and its grid

Scenario: Run on background tab
  Given tab 1 Run is in flight
  When the user switches to tab 2 before it finishes
  Then tab 2's grid is not loading
  And when the run succeeds, tab 1's grid updates
  And switching back shows tab 1's cards and those rows

Scenario: Start over is per active tab
  Given tab 1 and tab 2 both have cards
  When Start over on tab 1
  Then tab 1 is empty canvas + idle empty copy
  And tab 2 is unchanged

Scenario: Disconnect locks cards
  Given cards on the active tab
  When disconnect
  Then those cards remain visible and mutate/Run are locked

Scenario: Profile switch empties all tabs
  Given cards on any tabs
  When the user switches profile
  Then every tab's cards and grids are empty
  And B′ cache is cleared

Scenario: Close last tab
  Given 1 tab
  When the user closes it or presses Accel+W
  Then a replacement empty tab exists (never 0)
  And canvas + grid are empty

Scenario: Close among three
  Given 3 tabs, tab 2 active
  When the user closes inactive tab 1
  Then tab 2's cards/grid stay
```

### Story: History

> As a user, I want to see what already ran, from the canvas, so that I do not need SQL mode.

**Rule: Swift sheet; no re-execute on row click**

```gherkin
Scenario: Open from canvas
  Given the workspace
  When the user clicks History on the canvas toolbar
  Then the history sheet opens

Scenario: Empty
  Given no history rows
  Then "No Query History" and "Executed queries will appear here."
  And Export is disabled

Scenario: Rows
  Given history from any profiles
  Then the list is global newest-first
  And each row shows success/fail, duration, relative date, optional database, SQL up to 5 lines selectable
  And Copy copies SQL
  And clicking a row does not call runQuery and does not change canvas cards

Scenario: listHistory fails
  Given listHistory rejects
  Then the sheet shows an error message, not the empty copy

Scenario: Export
  Given history rows
  When the user exports JSON, CSV, or SQL and confirms the save dialog
  Then a file is written in that format (Swift QueryHistoryExporter shapes)
  When they cancel the dialog
  Then no file is written

Scenario: Dismiss
  Given the sheet open
  When Done or Escape
  Then the sheet closes
```

### Story: Connection string

> As a user, I want to paste a postgres URL, so that I do not retype fields.

```gherkin
Scenario: Save parses URI
  Given a new profile in Connection String mode
  When the user pastes a valid postgres:// URL and Saves
  Then the profile is stored with parsed host/user/database
  And the password is not in sqlite

Scenario: Invalid URI
  Given Connection String mode
  When the user Saves a malformed URL
  Then a parser error shows on the form
  And no half-saved profile exists

Scenario: Toggle back before Save
  Given URI text entered on a new profile
  When the user toggles to individual fields before Save
  Then host/user/database are not filled from the URI

Scenario: Edit is read-only
  Given an existing profile in Connection String mode
  Then the URI box is read-only
  And Copy copies the generated URI (stored password as YOUR_PASSWORD)
```

### Story: Native help, shortcuts, settings

```gherkin
Scenario: Help menu
  Given the native application menu
  When the user opens DragonDB Help
  Then a small window titled DragonDB Help shows Support (github.com/rfxlamia/dragondb/issues) and the shortcut list
  And Done closes it

Scenario: Keyboard Shortcuts menu
  When the user opens Keyboard Shortcuts
  Then the same shortcut list appears without Support

Scenario: Accelerators
  Given the workspace
  When Accel+T / Accel+W / Accel+Enter
  Then New Tab / Close Tab / Run Query fire (Run still SELECT-only; no-op if Run disabled)

Scenario: Welcome ignores tab/run accelerators
  Given welcome showing
  When Accel+T or Accel+Enter
  Then no tab is created and no query runs
  And Help can still open

Scenario: Settings date format
  When the user picks a date format radio
  Then it persists across relaunch
  And this slice's grid cells and history relative labels are unchanged (history stays relative)
```

---

## Acceptance Criteria

```
ACCEPTANCE CRITERIA — SP-4b workspace chrome
Date: 2026-08-15 | Scope confirmed: yes

Rule: Welcome gating
  ✓ Given 0 profiles, When launch, Then onboarding.png + Hello + Connect to Server
  ✓ Given welcome, When Connect to Server, Then form + "No connections"
  ✓ Given 0 profiles and form, When Cancel, Then welcome
  ✓ Given last profile deleted, Then welcome
  ✗ Given ≥1 profile, When launch, Then welcome is not shown

Rule: Tables list
  ✓ Given connected + tables, Then names in the connection column
  ✓ Given [], Then "No tables found"
  ✗ Given listTables fails, Then "No tables found" (must be fail copy instead)
  ✓ Given disconnect, Then names/fail copy gone
  ✗ Given click table name, Then a query runs

Rule: Queries column
  ✓ Given workspace including disconnected, Then Queries left of canvas
  ✓ Given click Q1 with B′ success cache, Then grid restores cache, cards unchanged
  ✓ Given profile switch, Then B′ cache dropped
  ✓ Given +, Then new named query selected, active canvas+grid cleared
  ✗ Given click Q1, Then visual cards rebuilt from SQL

Rule: Tabs
  ✓ Given 1 tab, Then bar hidden and + visible
  ✓ Given Accel+T, Then empty new tab, same connection, prior tab cards kept
  ✓ Given switch back, Then that tab's cards+grid restored (in-session)
  ✓ Given close last tab / Accel+W, Then empty replacement tab
  ✓ Given Start over, Then only active tab cleared
  ✓ Given disconnect, Then cards remain locked
  ✓ Given profile switch, Then all tabs empty

Rule: History
  ✓ Given toolbar History, Then Swift sheet
  ✓ Given rows, When Copy, Then clipboard has SQL
  ✗ Given click row, Then runQuery is called
  ✓ Given listHistory fails, Then error, not empty copy
  ✓ Given Export JSON/CSV/SQL confirmed, Then file written; cancel writes nothing

Rule: Connection string
  ✓ Given valid URI Save, Then parsed profile
  ✗ Given invalid URI Save, Then saved profile
  ✓ Given edit mode, Then URI read-only + Copy

Rule: Menus
  ✓ Given native Help, Then Support URL dragondb/issues + shortcuts
  ✓ Given Accel+Enter while Run disabled, Then no-op
  ✓ Given Settings radio, Then persists; grid dates unchanged this slice

OPEN QUESTIONS (risks if unresolved):
  - B′ vs Swift visual (visual Run did not cache) → assumed: B′ on canvas success while Q selected, drop on profile switch
  - Generic save IPC for JSON/SQL → assumed: extend save beyond CSV in tauri for this slice only
  - Per-tab cards after quit → assumed: not this slice

OUT-OF-SCOPE (remind pocket-planning):
  - Collapsible connection sidebar — NEXT GRINDING (ledger item)
  - SQL hatch, Show All Rows, grid mutation, persist IR, database picker, core/
```

---

## Design Decision

**Chosen option:** Option A — compose columns in App; Queries width via `react-resizable-panels`; per-tab visual documents in session memory; native Tauri menu.

**Summary:** Connection stays always visible this slice. Queries is its own resizable column left of canvas. No new AppShell wrapper. No `NavigationSplitView` collapse.

**Rejected options:**

- Option B (AppShell wrapper): same pixels, extra file; rejected as ceremony
- Option C (collapsible connection sidebar): Swift-real, **deferred to next grinding**, recorded on the ledger — not dropped

**Key tradeoffs accepted:**

- In-session visual docs only (no sqlite IR)
- B′ result cache is a canvas-side analogue of Swift SQL-editor cache
- Native menu requires limited `src-tauri` work
- Inline form + Cancel instead of Swift sheet, so welcome can return

---

## Open Questions / Assumptions

| Question | Resolution | Risk if Wrong |
|----------|------------|---------------|
| B′ cache on canvas Run | assumed: last **success** while Q selected; drop on profile switch | Users may expect failed runs or cross-profile restore |
| Visual IR after quit | assumed: out of slice | Relaunch loses cards (today already true) |
| History export JSON/SQL | assumed: allow generic save in tauri | Planning must not reuse CSV filter for JSON |
| Windows accelerators | assumed: Ctrl+T/W/Enter listed and bound | Help would lie if ⌘-only |
| Queries highlight follows tab `savedQueryId` | assumed: yes | Highlight could be global and surprise on tab switch |

---

## Implementation Notes

- Per-tab `QueryDocument` lives in UI/session memory keyed by tab id, synced on mutate; **do not** add a `TabStateDto` column this slice.
- B′ cache: in-memory map `savedQueryId → compact + ok status`; write on `applyRunSuccess` only if that tab’s `savedQueryId` matches; read on saved-query click; clear map on profile switch.
- Welcome Cancel: ConnectionPanel must be able to hide the form when profile count is 0 (equivalent to Swift sheet dismiss).
- Table click: no `runQuery`. Display names: unqualified `public` schema like Swift `displayName`.
- History `listHistory()` **without** `profileId` (global list).
- Help Support URL: `https://github.com/rfxlamia/dragondb/issues` (not `dragon-db`).
- Dual exit: `bun run check`; manual: welcome, tab switch cards, Queries B′, history export, native Help.
- **Next grinding must implement collapsible connection sidebar (Option C / Swift NavigationSplitView).**

---

## Rollback Plan

- Revert the workspace-chrome commits / branch.
- If a generic `saveTextFile` IPC was added, revert it with the UI; `saveCsvFile` remains for later CSV export.
- No sqlite migration to roll back for visual IR (none added).
