# SP-4a — Visual Query Canvas Design

**Date:** 2026-08-10
**Status:** Approved (brainstorming output; amended after validation review)
**Parent:** [2026-08-10-cross-platform-design.md](./2026-08-10-cross-platform-design.md) (§4 IPC contract, §7 SP-4a outline, §12.3 scope correction)
**Depends on:** SP-0 (scaffold), SP-1 (core IR) — both complete
**Swift reference:** `~/project/dragondb-swift`
**Amendment note:** 2026-08-10 validation review closed four blockers (mock wiring, validation surface without Run, CREATE in exit, null-safe SQL preview) and folded key warnings into this document.

---

## 1. Why

SP-0 and SP-1 left `dragondb` with a green, tested visual-query IR and a **stock Tauri + React greet scaffold** as the only UI. The highest remaining migration risk is whether the Swift block-card interaction model survives in a webview at creative-brief fidelity.

SP-4a answers that before Rust I/O (SP-2) or stores (SP-3), by running the real `src/core/` against a mocked `DragonIpc`.

---

## 2. Decisions locked in this brainstorm

| # | Decision | Notes |
|---|----------|-------|
| S1 | **Light-only** | No dark-mode refine before SP-4a. Matches creative brief Known Gaps and parent §10. |
| S2 | **Canvas-only window** | Not the full three-pane Swift shell (sidebars, SQL editor, results). That is SP-4b. |
| S3 | **`App.tsx` = canvas full-window** | Replace the greet scaffold entirely. |
| S4 | **Port approach: Swift file-boundary mirror** | One Swift view ≈ one TS module. Favours port fidelity over idiomatic React structure. |
| S5 | **Mirror structure is scheduled tech debt** | React regroup is deferred; see §9. Not paid silently mid-port. |
| S6 | **Manual engine verification** | macOS + Linux required before SP-4a exit; Windows optional. CI stays `bun run check` only — no WebKitGTK job in this sub-project. |
| S7 | **Scaffold purge is an exit criterion** | Any leftover Tauri-React demo UI fails the exit. Easy to forget; treated as a hard gate. |
| S8 | **CREATE stays in SP-4a** | Statement picker + CREATE root card are in scope and in exit criteria. UPDATE/DELETE remain selectable as Coming soon. |
| S9 | **No Run button in SP-4a** | Brief toolbar molecule's Primary Run is deferred to SP-4b. Validation help surfaces via a status strip instead. |
| S10 | **Live SQL preview panel** | Always-visible preview (not Swift's toolbar link → sheet). Null-safe: `generateSQL(doc)?.display ?? "—"`. Copy-to-clipboard on the preview is in scope. |

---

## 3. Goal

> Does the block-card interaction model survive the move to a web UI at the fidelity the creative brief demands?

Production UI, written once, kept into SP-4b — not a throwaway spike.

---

## 4. Scope

### 4.1 In scope

From `dragondb-swift` (~1,220 LOC of listed views/copy, plus folded ViewModel behaviours — see §5.2):

| Swift source | Role |
|---|---|
| `Views/Components/VisualQuery/*.swift` (7 files, 767 LOC) | Cards, toolbar, picker, SQL preview, schema popover |
| `Views/Containers/Content/VisualQueryCanvasView.swift` (281 LOC) | Container that assembles the canvas |
| `Logic/VisualQueryCopy.swift` (176 LOC) + `VisualQueryClauseCopyTests` | UI chrome copy + tests |
| `Utilities/VisualQueryAccessibility.swift` | Ported as `data-testid` constants module |
| Folded from `VisualQueryViewModel` (no separate store) | Document mutators, presentation, metadata error, start-over, choose-statement including CREATE |

Also created in this sub-project:

- `src/ipc/contract.ts` — `DragonIpc` types from parent §4 (not invented ad hoc)
- `src/ipc/mock.ts` — fixture tables/columns + wired load path (§5.1)
- Creative-brief CSS tokens on `:root` + bundled Inter and JetBrains Mono
- `App.tsx` mounts the canvas only and owns mock IPC wiring

Runs against **real** `src/core/` from SP-1.

**Statements in scope**

- SELECT with clauses SELECT, FROM, WHERE, ORDER BY, LIMIT — fully editable.
- CREATE TABLE — root card editable (table name + columns); SQL preview from `core/`.
- UPDATE / DELETE — appear in the statement picker with Coming soon badges; selecting them shows the root card Coming-soon state; `generateSQL` returns null → preview shows `"—"`.

### 4.2 Out of scope

- Three-pane shell, connection sidebar, Queries pane, results grid, SQL editor mode
- Run Query chrome and actual `runQuery` execution (contract method may exist; UI does not call it)
- Create-confirmation sheet that executes DDL against a live DB (Swift's confirm→run path); CREATE editing + preview only
- Global store layer (`src/stores/`)
- Real IPC / Rust / live database
- Dark mode
- SwiftData → rusqlite data migration
- Expanding CI to Tauri or WebKitGTK builds
- Rewriting `src/core/validation` help strings to match brief examples (surface as-is; brief-pattern rewrite is a follow-up)

If the canvas turns out to need global state beyond local container state + App wiring, that is a **finding to report**, not permission to start SP-3 early.

---

## 5. Architecture

```
App.tsx
  ├─ mock DragonIpc + fixture ConnectionId
  ├─ isConnected = true (fixture; no real connection UI)
  ├─ load tables on mount; reload columns when FROM identity changes
  └─ VisualQueryCanvas (container)
        ├─ local state: QueryDocument          (src/core)
        ├─ tables / columnNames / metadataError (from App wiring)
        ├─ status strip: canRun(doc, true).helpMessage
        ├─ cards / toolbar (no Run) / picker / live SQL preview
        └─ on edit → mutate doc → validate → preview = generateSQL(doc)?.display ?? "—"
```

| Path | Responsibility |
|---|---|
| `src/ui/visual-query/*` | Mirrored Swift UI modules |
| `src/ui/visual-query/copy.ts` | Port of `VisualQueryCopy` **plus** empty-canvas strings, popover `"No matches"`, preview empty/`Done`/Copy labels that today live inline in Swift views |
| `src/ui/visual-query/accessibility.ts` | `data-testid` constants from `VisualQueryAccessibility` |
| `src/ipc/contract.ts` | Shared `DragonIpc` surface (parent §4) |
| `src/ipc/mock.ts` | Fixture backend for SP-4a only |
| `src/core/*` | Unchanged IR; UI consumes it |

### 5.1 Mock IPC wiring (required)

In Swift, the canvas does **not** call IPC. `QueryEditorView` injects `tables` / `columnNames` and sets metadata errors. SP-4a folds that injection into `App.tsx` (or a thin wiring helper next to it) — still not a store layer.

| Concern | Spec |
|---|---|
| `ConnectionId` | Single fixture id, e.g. `"fixture"`, used for all mock calls |
| `isConnected` | Always `true` for `canRun` in SP-4a so validation messages are about the query, not "Connect a database first" |
| Tables load | On App mount → `listTables(fixtureId)` → pass into canvas |
| Columns load | When committed FROM table identity changes → `listColumns(fixtureId, table)` → pass into canvas |
| Column load failure | Map to metadata error copy matching Swift: `"Could not load columns. You can still type a name."` |
| `runQuery` | Present on contract; **not called** by SP-4a UI |

### 5.2 Container behaviours (folded ViewModel)

**In (must port into canvas/App local state):**

- `QueryDocument` mutators used by the cards (select/from/where/order/limit/create fields, add/remove clause, choose statement, start over)
- `CanvasPresentation` from `core/` for visible cards / empty state
- Status strip from `canRun(doc, isConnected).helpMessage` when not runnable (replaces Swift toolbar `runHelpMessage` next to Run)
- Metadata error strip (Swift `metadataErrorMessage`)
- Statement picker including CREATE / Coming-soon UPDATE/DELETE

**Out (do not port in SP-4a):**

- Run / isRunning / execute path
- Create-confirmation → execute DDL
- Anything that requires a real connection or results grid

### 5.3 Boundary rules

- UI may import `core/` and `ipc/` contract (+ mock at the App wiring point).
- `core/` remains free of DOM, Tauri, and UI (existing `tsconfig.core.json` + Biome + architecture test).
- No `src/stores/` in SP-4a.
- AppKit/`Constants` colors map to brief neutrals (`--neutral-*`), not system semantic colors.

### 5.4 Styling

- Plain CSS custom properties named after brief tokens on `:root` (primary, neutral, semantic — full brief set, not fonts-only).
- `oklch()` values used verbatim from `docs/pocket/rule/creative-brief.md`.
- `--radius: 4px`. Focus rings via `outline` + `outline-offset` per brief.
- `@font-face` for Inter and JetBrains Mono as **local** assets — no CDN.
- Light-only surfaces.
- No Tailwind unless a later decision introduces it.
- System/`controlBackgroundColor`-style fills → brief neutrals.

### 5.5 Toolbar vs brief molecule

Creative brief lists Ghost Add + Primary Run + Link View SQL as a toolbar example. For SP-4a:

- **Include:** Start over; live SQL preview (replaces View SQL sheet link); Add block controls on the canvas.
- **Defer to SP-4b:** Primary Run button.

---

## 6. File map (Swift → TypeScript)

Names may be adjusted slightly in the implementation plan; the invariant is **one Swift file ≈ one TS module** (plus the accessibility constants module).

| Swift | Target |
|---|---|
| `VisualClauseCardFieldViews.swift` | `src/ui/visual-query/clause-card-fields.tsx` |
| `VisualStatementRootCardView.swift` | `src/ui/visual-query/statement-root-card.tsx` |
| `VisualClauseCardView.swift` | `src/ui/visual-query/clause-card.tsx` |
| `SchemaFieldPopover.swift` | `src/ui/visual-query/schema-field-popover.tsx` |
| `VisualQueryToolbar.swift` | `src/ui/visual-query/toolbar.tsx` (no Run control) |
| `GeneratedSQLPreviewView.swift` | `src/ui/visual-query/generated-sql-preview.tsx` (always-on panel) |
| `VisualStatementPickerView.swift` | `src/ui/visual-query/statement-picker.tsx` |
| `VisualQueryCanvasView.swift` | `src/ui/visual-query/canvas.tsx` |
| `VisualQueryCopy.swift` (+ inline chrome strings §4.1) | `src/ui/visual-query/copy.ts` |
| `VisualQueryAccessibility.swift` | `src/ui/visual-query/accessibility.ts` |

`data-testid` constants for Run / mode-toggle may exist in `accessibility.ts` for parity with the Swift enum even if those controls are not rendered in SP-4a.

---

## 7. Mock fixtures

Minimum fixture set (named, not "some tables"):

| Mode | Contents |
|---|---|
| Default happy path | At least one `public` table (e.g. `users`) with several columns, **and** at least one non-`public` schema table so FROM display of schema-qualified names is exercisable |
| Empty tables | `listTables` → `[]` (popover shows Swift-mirrored `"No matches"` / needs-FROM messaging — not the brief's connection empty-state copy) |
| Empty columns | `listColumns` → `[]` for a chosen table |
| Columns error | `listColumns` rejects / fails → metadata error string above |

Popover empty copy mirrors Swift (`"No matches"`), not the brief's “No tables yet — connect…” line, because SP-4a has no connection UI.

---

## 8. Error handling

- Validation comes from `src/core/validation` (`canRun`). SP-4a **surfaces existing `helpMessage` strings as-is**. It does not rewrite them to new brief examples in this sub-project.
- Status strip shows `helpMessage` when `isRunnable` is false (the surface that replaces Swift's Run-disabled help text).
- Metadata errors from column load failures use the Swift copy cited in §5.1.
- No real Postgres error mapping (Rust is out of scope).
- User-facing strings stay in English (project convention).

---

## 9. Scheduled tech debt (approach S4)

**Debt:** Component boundaries follow SwiftUI files rather than an idiomatic React composition.

**Why accepted:** Port fidelity is the dominant SP-4a risk; regrouping during the port increases the chance of silent behavior drift.

**How it is paid:** Explicit follow-up after SP-4a exit is green, or when the related SP-4b cluster touches the same modules — with a written reason. Not a silent mid-port cleanup.

**Tracking:** This section is the record. The implementation plan must list it under deferred work.

---

## 10. Testing and verification

| Layer | Approach |
|---|---|
| Copy / chrome strings | Port `VisualQueryClauseCopyTests` → Vitest; cover empty-canvas + `"No matches"` strings moved into `copy.ts` |
| Card behavior (cheap cases) | Optional Testing Library for critical paths (FROM commit, LIMIT parse, WHERE → preview, CREATE fields → preview) |
| Visual / engine fidelity | Manual: macOS + Linux required; Windows optional — checklist in §11.2 |
| CI | Existing `core` workflow: `bun run check` on `ubuntu-latest` only |
| Architecture | Existing core-boundary test must stay green |

---

## 11. Exit criteria

### 11.1 Must be true

1. **SELECT path:** All five clause cards render and are editable: SELECT, FROM, WHERE, ORDER BY, LIMIT.
2. **Statement picker:** SELECT and CREATE are runnable choices; UPDATE and DELETE show Coming soon badges and are selectable into the Coming-soon root state.
3. **CREATE path:** CREATE root card is editable (table name + columns); preview updates from `core/`.
4. **Live preview:** Editing a block updates the always-visible SQL preview using `generateSQL(doc)?.display ?? "—"`.
5. **Validation surface:** When `canRun` is not runnable, its `helpMessage` appears in the canvas status strip (no Run button required).
6. **Visual output:** `:root` brief tokens (primary/neutral/semantic), `--radius: 4px`, focus-ring `outline` rule, bundled Inter + JetBrains Mono via local `@font-face` (no CDN).
7. **Manual verify:** macOS + Linux (Windows optional) against checklist §11.2.
8. **Copy tests:** `VisualQueryClauseCopyTests` translated and green; empty-canvas / `"No matches"` covered.
9. **Scaffold purge:** zero remaining Tauri-React demo UI or assets.
   - No “Welcome to Tauri + React”, greet form, or unused Vite/Tauri/React logo chrome.
   - Default scaffold `App.css` replaced by brief tokens (not layered on top).
   - Unused demo assets removed.
   - `greet` command removed from Rust if nothing else calls it.
   - Plan checklist includes grep gates for: `Welcome to Tauri`, `greet-input`, `You've been greeted`, and demo logo usage in UI.

### 11.2 Manual verification checklist

On each required OS (macOS, Linux):

1. Empty canvas → pick SELECT → chain appears.
2. FROM picker lists fixture tables including a non-`public` schema entry.
3. Column picker populates after FROM commit; metadata error path still allows typing a name.
4. Invalid LIMIT shows status-strip help from `canRun`.
5. Live SQL preview updates on edit; empty/Coming-soon states show `"—"`.
6. Pick CREATE → root card edits update preview.
7. Pick UPDATE or DELETE → Coming soon root; preview `"—"`.
8. Focus ring visible on an interactive control per brief.
9. Scaffold grep gates clean.

---

## 12. Relationship to later sub-projects

- **SP-2 / SP-3:** Independent of SP-4a visually; SP-3 replaces `src/ipc/mock.ts` with real invoke wrappers behind the same `DragonIpc` contract. App wiring that today hard-codes `isConnected = true` becomes real connection state.
- **SP-4b:** Keeps SP-4a canvas code; adds shell screens, Run chrome, and swaps mock → real IPC. May pay §9 debt when touching these modules. May adopt brief empty-state copy once a connection UI exists.
- **Parent §7 / §9:** This document supersedes them for SP-4a detail where they differ (scaffold purge, tech-debt stance, CI vs manual Linux, full-window mount, no-Run validation surface, live preview, CREATE in exit). Parent §4 IPC contract remains authoritative.

---

## 13. Reference paths

```
~/project/dragondb/                         active Tauri app
  docs/pocket/rule/creative-brief.md        design authority
  docs/superpowers/specs/2026-08-10-cross-platform-design.md
  src/core/                                 SP-1 IR (done)
~/project/dragondb-swift/                   Swift reference
  DragonDB/Views/Components/VisualQuery/
  DragonDB/Views/Containers/Content/VisualQueryCanvasView.swift
  DragonDB/Views/Containers/Content/QueryEditorView.swift   # schema injection prior art
  DragonDB/Logic/VisualQueryCopy.swift
  DragonDB/Utilities/VisualQueryAccessibility.swift
  DragonDB/ViewModels/VisualQueryViewModel.swift            # behaviours folded into canvas/App
```
