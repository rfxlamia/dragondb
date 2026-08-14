# SP-4b first slice — app shell + read-only results

**Date:** 2026-08-14
**Status:** draft
**Author:** brainstorm session (pocket-grinding)
**Spec path:** docs/pocket/spec/2026-08-14-sp4b-remaining-ui/first-slice-shell-results.md
**Parity ledger:** docs/pocket/spec/2026-08-14-sp4b-remaining-ui/swift-parity-prerequisites.md
**Parent:** docs/superpowers/specs/2026-08-10-cross-platform-design.md §12.1 (App shell + Results grid, first-slice subset)

---

## Summary

Close the visual-query learning loop on Tauri: Build → View generated SQL → Run SELECT → See rows. The workspace becomes connection column | (canvas above a always-on results pane). The grid is read-only and bound to this-session tab `status` + `compact`. Generated SQL returns to Swift 1:1 (toolbar button → dialog). Remaining SP-4b clusters stay SEQUENCE in the parity ledger — not silent drops.

---

## Context

### Current State

- `src/App.tsx` is a two-column shell: `ConnectionPanel` | `VisualQueryCanvas` (`src/App.css`). No results region.
- Canvas Run SELECT already calls `runSelectOnActiveTab`, which writes `tabs-store` `raw` / `compact` / `status`. Nothing renders those fields. Canvas instead shows a local `runOutcome` strip (`OK / N rows / X ms` or error) and an always-on `GeneratedSQLPreview` (SP-4a S10, not Swift).
- `canRun` in `src/core/validation.ts` still marks a complete CREATE as runnable. SP-2 gated CREATE in the Run handler with `runSelectOnlyMessage`.
- `tabs.refresh()` on mount hydrates sqlite `cachedResultsData` into `compact` while `status.kind` is `idle` (`hydrateFromDto` → `toTabState`).
- Profile switch remounts the canvas via `key={canvasEpoch}`. Start over already calls `onClearTabResults` (store generation bump + `status: idle`); canvas `runGeneration` is **not** bumped on Start over (only on disconnect).

### Problem / Motivation

The north star requires seeing the result. Status-only chrome is not a result. An always-on SQL panel plus a new grid would sandwich three regions and invite live-SQL vs stale-rows. First-slice therefore uses Swift’s **View generated SQL** sheet, an always-on results split, and a grid that never claims to match un-run card edits.

### Related Areas

- `src/App.tsx`, `src/App.css`
- `src/ui/visual-query/{canvas,toolbar,generated-sql-preview,copy,accessibility}.tsx`
- `src/stores/{tabs-store,run-select-on-active-tab,compose-app-stores}.ts`
- Swift: `MainSplitView` `VSplitView`, `QueryResultsComponent`, `EmptyQueryResultsView`, `VisualQueryToolbar`, `GeneratedSQLPreviewView`
- Ledger: `swift-parity-prerequisites.md` §6 first-slice subset; full SP-4b done-bar remains §2

---

## Scope

### In-Scope

- Always-on vertical split: canvas above results; `ConnectionPanel` stays left
- Canvas remains the primary editor (no Swift SQL-editor HSplit)
- Read-only HTML table bound to **this-session** `status.kind` + `compact` (not raw, not hydrated cache while idle)
- Empty / loading / error / 0-row headers / SQL NULL token
- Remove canvas `OK / N rows / X ms` strip entirely; do not relocate count/duration
- `canRun` help for incomplete SELECT stays on the toolbar
- Run disabled unless connected **and** `statementKind === "select"` **and** `canRun` (CREATE / UPDATE / DELETE cannot fire `runQuery`)
- View generated SQL toolbar button → dismissible dialog (Copy, Done, `—`); remove always-on `.vq-sql-preview`
- Start over: reset document **and** clear results pane; ignore in-flight IPC; no history DB deletes
- Split uses `react-resizable-panels`; lives in `App` **outside** `canvasEpoch`; divider survives profile switch; default ratio only on fresh launch (not persisted)
- Anti-glitch: grid not filled from canvas `onRunQuery` promise; Start over bumps store generation **and** canvas `runGeneration` / `runInFlight` before next paint
- Thin store guard if needed so later `hydrateFromDto` cannot replace this-session `compact` while `status` is `ok` / `running` / `error`

### Out-of-Scope

- Remaining ledger clusters (sidebar, tab bar, SQL editor, history UI, row edit/JSON/filter/sort/pagination, connection polish, database picker/create/delete, static pages) — SEQUENCE, not dropped
- Always-on / draft-vs-receipt SQL inspector (deferred until remaining chrome exists)
- Dark mode, SP-5, SP-6, SwiftData importer
- New Rust IPC (cancel, listDatabases, create/delete database, visual IR on `TabStateDto`)
- `src/core/` IR / `canRun(CREATE)` semantics — disable Run in the toolbar instead
- Runtime mocks; library/history UI; putting results inside the disconnected canvas `fieldset`
- Rendering `status.rowCount` / `durationMs` anywhere

---

## Architecture Constraints

- Layers this work may touch: `src/ui/**`, `App.tsx`, `App.css`, thin `tabs-store` hydrate guard, canvas/toolbar wiring already used by `runSelectOnActiveTab` / `clearTabResults`
- Layers this work must NOT touch: `src/core/` (except reading `statementKind` / `canRun` / `generateSQL`), `src-tauri/**`, library/history stores in App, IPC contract expansion
- Patterns: creative-brief tokens + focus ring; English UI strings; light-only; compact cells for display; `runSelectOnActiveTab` is the only results writer
- Architecture validation result: **PASS** (2026-08-14)

### Phase 6 checklist

- [x] Layer boundaries (`core/` stays pure; split/grid are UI)
- [x] Existing patterns (Vitest + Testing Library; canvas owns `QueryDocument`; App owns session chrome)
- [x] New dependency is UI-only (`react-resizable-panels`) — not a second state layer
- [x] Build-vs-buy: split is a commodity; library chosen over hand-roll (Option A) because pane size must not follow grid content and SEQUENCE sidebar needs nested groups
- [x] Rollback: revert the feature branch
- [x] No silent sqlite migrations; hydrate cache still ignored by UI while `idle`
- [x] Performance: unbounded SELECT row count accepted (Swift editor also unbounded); cells compacted to 2048
- [x] Security: SQL shown as text (no `dangerouslySetInnerHTML`); secrets stay in keyring

---

## Dependencies

### Existing (to leverage)

- `zustand` — `tabs-store` status / compact / `clearTabResults` / `clearInMemoryResults` / `beginRun` generation
- `runSelectOnActiveTab` — clear-at-start + generation-guarded apply
- `@testing-library/react` + Vitest + jsdom
- Creative-brief CSS variables in `src/ui/tokens.css`
- `src/lib/result-compactor.ts` — already applied when writing compact
- `@fontsource/jetbrains-mono` — grid/SQL dialog mono

### New (proposed)

- `react-resizable-panels` (current major compatible with React 19; planning locks exact version) — vertical `Group`/`Panel`/`Separator` (v4) or `PanelGroup`/`PanelResizeHandle` (v3). `minSize` in **pixels** (canvas 250, results 300, from Swift). Do **not** persist layout via `onLayoutChanged` / `defaultLayout` to disk.

  Alternatives rejected: hand-rolled flex drag (content can blow the ratio; nested split rewrite later); data-grid libraries (filter/sort/virtualization out of scope).

---

## Stories + Scenarios

### Story: Persistent results pane

> As a learner, I want a results pane always under the canvas so Run does not jump the layout.

**Rule 1: Pane always present**
- Launch → copy `Run a query to see results`
- Drag divider → both panes change; neither below min height
- Window shorter than mins → column/window scrolls; panes do not go below min

```gherkin
Scenario: Results pane present before first run
  Given the workspace shows ConnectionPanel and canvas
  When no Run has completed in this session (status idle)
  Then the results pane is visible
  And it shows "Run a query to see results"

Scenario: Vertical split is resizable
  Given the results pane is visible
  When the user drags the separator
  Then canvas and results heights change
  And neither pane is smaller than minSize 250px / 300px

Scenario: Divider survives profile switch
  Given the user has dragged the divider
  When they switch profile successfully (canvas remounts)
  Then cards reset empty
  And the divider stays where it was dragged

Scenario: Divider resets only on fresh launch
  Given a previous session had a dragged divider
  When the app launches
  Then the split uses the default ratio (not restored from disk)
```

**Rule 2: Canvas stays primary**
- Main column is `VisualQueryCanvas` above results, not `QueryEditorView`

```gherkin
Scenario: No SQL-editor HSplit
  Given the first-slice workspace
  Then there is no saved-queries column beside the canvas
  And there is no SQL editor as the default surface
```

### Story: Read-only SELECT grid

> As a learner, I want Run SELECT to fill a read-only grid so I can see what the query returned.

**Rule 3: This-session status is the only gate**
- `idle` → empty copy even if hydrated `compact` is non-null
- `running` → `Loading results...`
- `ok` with rows → compact table
- `ok` with 0 rows → headers + `No rows found`
- `error` → heading `Query Failed` + message (IPC / mapped)
- Never show `rowCount` / `durationMs`

```gherkin
Scenario: Launch ignores sqlite result cache
  Given sqlite has cachedResultsData for a tab
  And App hydrates tabs on mount
  When the workspace appears
  Then the pane shows "Run a query to see results"
  And no grid is shown until a Run in this session sets status ok or error

Scenario: Successful SELECT fills compact grid
  Given a connected session and a runnable SELECT
  When the user clicks Run
  Then the pane shows "Loading results..."
  And when runQuery succeeds
  Then a read-only table shows compact cell strings and column headers
  And SQL null cells show the token NULL
  And boolean false, number 0, and empty string are not shown as NULL
  And no OK / N rows / X ms text exists in canvas or results

Scenario: Zero-row SELECT
  Given a successful SELECT with columns and 0 rows
  Then headers are visible
  And the empty copy is "No rows found"

Scenario: Failed SELECT
  Given a runnable SELECT
  When runQuery rejects
  Then the pane shows "Query Failed" and the error message
  And no previous grid rows remain

Scenario: In-flight second Run
  Given the grid shows rows from run A
  When the user clicks Run for query B
  Then rows from A disappear immediately
  And "Loading results..." shows until B succeeds or fails

Scenario: Edit cards after results
  Given the grid shows rows from the last SELECT
  When the user changes a WHERE value and does not Run
  Then the grid still shows the previous rows

Scenario: Edit cards after Query Failed
  Given the pane shows Query Failed
  When the user edits a card and does not Run
  Then the error stays

Scenario: Edit cards while loading
  Given the pane shows Loading results...
  When the user edits a card and does not Start over
  Then the pane stays loading until that in-flight request settles
  And the later grid or error is for the SQL captured at click
```

**Rule 4: Run is SELECT-only in the toolbar**
- Disable Run unless connected, `statementKind === "select"`, and `canRun.isRunnable`
- Incomplete SELECT: Swift-parity help on the toolbar
- CREATE/UPDATE/DELETE: Run disabled, no post-click `runSelectOnlyMessage`

```gherkin
Scenario: CREATE disables Run
  Given the canvas statement is CREATE (or UPDATE/DELETE coming soon)
  Then Run is disabled
  And clicking it does not call runQuery

Scenario: Incomplete SELECT disables Run with toolbar help
  Given connected but canRun is false
  Then Run is disabled
  And canRun help appears on the toolbar, not in the results pane
```

**Rule 5: Grid chrome**
- Cells single-line; table scrolls horizontally; split ratio does not jump with content
- Read-only: no filter, sort, pagination, JSON, row selection, edit, delete

### Story: View generated SQL (Swift 1:1)

> As a learner, I want generated SQL behind a button so the results pane can own the lower half of the window.

**Rule 6: Button + dialog; always-on panel gone**

```gherkin
Scenario: Open generated SQL dialog
  Given a document that generates SELECT display SQL
  When the user clicks View generated SQL
  Then a dialog shows that display SQL
  And Copy copies it
  And Done dismisses the dialog

Scenario: Empty preview
  Given generateSQL returns null
  When the user opens View generated SQL
  Then the text is "—"
  And Copy is disabled
  And Done dismisses (Copy must not become the dismiss control)

Scenario: Always-on panel gone
  Given the canvas is visible
  Then there is no persistent .vq-sql-preview under the cards

Scenario: Dialog does not survive canvas remount
  Given the SQL dialog is open
  When a profile switch remounts the canvas
  Then the dialog is gone
  And the divider stays
```

### Story: Start over throws the query away

> As a learner, I want Start over to reset cards and the result view together.

**Rule 7: Clear canvas + pane; ignore late IPC; no history delete**

```gherkin
Scenario: Start over clears canvas and grid
  Given results are showing and the canvas has clauses
  When the user clicks Start over
  Then the visual document is reset
  And the pane shows "Run a query to see results"
  And no grid rows remain

Scenario: Start over during loading
  Given the pane shows Loading results...
  When the user clicks Start over
  Then the next paint is "Run a query to see results"
  And a late runQuery success or failure does not fill the grid
  And Run enablement follows the new empty document (disabled until SELECT is runnable)
  And there is no Loading → grid → empty flicker

Scenario: Start over then Run before abandoned IPC returns
  Given Start over happened during loading
  When the user rebuilds a runnable SELECT and clicks Run before the old IPC returns
  Then a new store and canvas generation starts
  And the late apply is a no-op

Scenario: Deleting the SELECT root
  Given clauses and a grid are showing
  When the user deletes the SELECT root (existing handleStartOver path)
  Then results clear the same way as toolbar Start over

Scenario: Start over does not wipe history DB
  Given a prior successful run wrote history via runQuery
  When the user clicks Start over
  Then listHistory still contains that row
```

### Story: Session chrome already shipped

> As the existing connect flow, I want disconnect and switch to keep working with the new pane.

```gherkin
Scenario: Disconnect clears visible results
  Given a grid is showing
  When the user disconnects
  Then the canvas is interaction-locked as today
  And the pane shows "Run a query to see results"
  And a late IPC success does not refill the grid

Scenario: Disconnect then reconnect same profile
  Given the user dragged the divider and had cards
  When they disconnect and reconnect the same profile (no canvasEpoch remount)
  Then cards are still there
  And the pane shows "Run a query to see results"
  And the divider is unchanged

Scenario: Switch profile remounts canvas and empty results
  Given profile A had results
  When the user switches to profile B successfully
  Then canvas remounts empty
  And the pane is the pre-run empty copy
```

---

## Acceptance Criteria

```
ACCEPTANCE CRITERIA — SP-4b first slice shell + read-only results
Date: 2026-08-14 | Scope confirmed: yes

Rule: Persistent split
  ✓ Given workspace shown, When no this-session Run, Then pane visible with "Run a query to see results"
  ✓ Given divider dragged, When profile switch remounts canvas, Then divider stays
  ✓ Given app relaunch, Then split uses default ratio (not persisted)
  ✓ Given window shorter than mins, Then panes stay ≥ 250 / 300 and the column scrolls

Rule: This-session status gate
  ✓ Given hydrated compact and status idle, Then empty copy, not the grid
  ✓ Given Run clicked, Then empty → "Loading results..." → ok grid or Query Failed
  ✓ Given 0-row ok, Then headers + "No rows found"
  ✓ Given SQL null, Then token NULL; false / 0 / "" not NULL
  ✓ Given no surface, Then rowCount / durationMs never rendered

Rule: SELECT-only Run
  ✓ Given CREATE or coming-soon UPDATE/DELETE, Then Run disabled, runQuery not called
  ✓ Given incomplete SELECT, Then Run disabled and canRun help on toolbar

Rule: Swift SQL dialog
  ✓ Given View generated SQL, Then dialog with display SQL or "—", Copy, Done
  ✓ Given canvas, Then no persistent .vq-sql-preview
  ✗ Given empty SQL, When Copy, Then Copy is disabled (not a dismiss action)

Rule: Start over
  ✓ Given grid or loading, When Start over, Then document reset + empty copy
  ✓ Given in-flight Run, When Start over, Then late IPC ignored, no flicker
  ✗ Given Start over, Then deleteHistory / clearHistory is not called

Rule: Anti-glitch wiring
  ✓ Grid reads tabs-store compact/status only (not canvas QueryResult)
  ✓ Start over bumps store generation and canvas runGeneration/runInFlight before next paint
  ✓ Split wrapper is not keyed by canvasEpoch

Rule: Dual exit
  ✓ bun run check green
  ✓ Manual verify macOS + Linux (WebKitGTK) for split drag, empty/loading/grid swap, Start over during load
```

---

## Design Decision

**Chosen option:** Option B — `react-resizable-panels` + read-only HTML `<table>`

**Summary:** Library split so pane sizes are independent of grid content and nested groups remain available for the SEQUENCE sidebar. Grid stays a brief-token `<table>` (no data-grid). SQL preview is a Swift-like dialog, not an always-on panel.

**Rejected options:**
- Option A (hand-rolled CSS split): content can blow the split ratio; nested split would be rewritten for sidebar
- Option C (data-grid library): filter/sort/virtualization are out of scope

**Key tradeoffs accepted:**
- New UI dependency (small) vs layout glitches
- Unbounded SELECT row count (Swift editor parity)
- Start over clearing the grid is an intentional divergence from Swift `QueryState`
- SP-4a always-on SQL (S10) temporarily reverted; always-on inspector deferred
- CREATE remains buildable; Run is disabled rather than changing `core` `canRun`

---

## Open Questions / Assumptions

| Question | Resolution | Risk if Wrong |
|----------|------------|---------------|
| Persist divider across relaunch | No — default on launch only | User re-drags each session (accepted) |
| Dialog pixel size 480×280 | Behavior 1:1; web size follows brief, not AppKit pts | Cosmetic |
| Date format settings | Raw strings this slice | SEQUENCE |
| Tab cache restore on launch | Out of slice (status idle wins) | SEQUENCE tab bar |
| `react-resizable-panels` v3 vs v4 names | Planning locks current React 19–compatible major | Import names differ (`PanelGroup` vs `Group`) |
| Huge SELECT | No extra cap | Slow WebView; accepted |

---

## Implementation Notes

- Bind the pane with `status.kind` **first**. Do not treat “compact present” as “show grid.”
- Do not dual-write results from `canvas.tsx` `handleRunQuery`. Keep `runSelectOnActiveTab` as the only writer; canvas should stop setting `runOutcome` success/error strings. Loading belongs to store `running`.
- `handleStartOver` / disconnect already call `clearTabResults` / `clearInMemoryResults` (idle + store generation). Also bump canvas `runGeneration` and clear `runInFlight` on Start over (today only disconnect does).
- Toolbar `canRunQuery`: `isConnected && statementKind === "select" && eligibility.isRunnable && !runInFlight`.
- Put `Group orientation="vertical"` in `App` wrapping canvas + results. `key={canvasEpoch}` stays on `VisualQueryCanvas` only.
- Style `Separator` with brief neutrals; hit target must meet the library’s coarse/fine minimums.
- Grid: `font-variant-numeric: tabular-nums` on numeric-looking cells is SEQUENCE-nice but not required; Inter + 4px radius + focus ring on dialog/Run still required.
- Copy strings (English): `Run a query to see results`, `No rows found`, `Loading results...`, `Query Failed`, `View generated SQL`, `Copy`, `Done`, `—`.
- Tests must prove: idle+hydrated compact → empty copy; Start over during running → late apply no-op and no flicker; divider node is outside the canvas key; CREATE Run disabled; `.vq-sql-preview` absent from canvas.
- Manual verify log (macOS + Linux) like SP-4a: drag, content swap without ratio jump, Start over while loading.

---

## Rollback Plan

- Revert the feature branch / PR. No sqlite schema change required for this slice.
- If the hydrate guard lands: it is additive (keep in-memory compact when status is non-idle); revert restores today’s hydrate overwrite.
