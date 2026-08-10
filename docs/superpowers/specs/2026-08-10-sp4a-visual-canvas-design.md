# SP-4a — Visual Query Canvas Design

**Date:** 2026-08-10
**Status:** Approved (brainstorming output)
**Parent:** [2026-08-10-cross-platform-design.md](./2026-08-10-cross-platform-design.md) (§4 IPC contract, §7 SP-4a outline, §12.3 scope correction)
**Depends on:** SP-0 (scaffold), SP-1 (core IR) — both complete
**Swift reference:** `~/project/dragondb-swift`

---

## 1. Why

SP-0 and SP-1 left `dragondb` with a green, tested visual-query IR and a **stock Tauri + React greet scaffold** as the only UI. The highest remaining migration risk is whether the Swift block-card interaction model survives in a webview at creative-brief fidelity.

SP-4a answers that before Rust I/O (SP-2) or stores (SP-3), by running the real `src/core/` against a mocked `DragonIpc`.

---

## 2. Decisions locked in this brainstorm

| # | Decision | Notes |
|---|----------|-------|
| S1 | **Light-only** | No dark-mode refine before SP-4a. Matches creative brief §Known gaps and parent §10. |
| S2 | **Canvas-only window** | Not the full three-pane Swift shell (sidebars, SQL editor, results). That is SP-4b. |
| S3 | **`App.tsx` = canvas full-window** | Replace the greet scaffold entirely. |
| S4 | **Port approach: Swift file-boundary mirror** | One Swift view ≈ one TS module. Favours port fidelity over idiomatic React structure. |
| S5 | **Mirror structure is scheduled tech debt** | React regroup is deferred; see §8. Not paid silently mid-port. |
| S6 | **Manual engine verification** | macOS + Linux required before SP-4a exit; Windows optional. CI stays `bun run check` only — no WebKitGTK job in this sub-project. |
| S7 | **Scaffold purge is an exit criterion** | Any leftover Tauri-React demo UI fails the exit. Easy to forget; treated as a hard gate. |

---

## 3. Goal

> Does the block-card interaction model survive the move to a web UI at the fidelity the creative brief demands?

Production UI, written once, kept into SP-4b — not a throwaway spike.

---

## 4. Scope

### 4.1 In scope

From `dragondb-swift` (~1,220 LOC total):

| Swift source | Role |
|---|---|
| `Views/Components/VisualQuery/*.swift` (7 files, 767 LOC) | Cards, toolbar, picker, SQL preview, schema popover |
| `Views/Containers/Content/VisualQueryCanvasView.swift` (281 LOC) | Container that assembles the canvas |
| `Logic/VisualQueryCopy.swift` (176 LOC) + `VisualQueryClauseCopyTests` | UI chrome copy + tests |
| Accessibility identifiers | Ported as `data-testid` |

Also created in this sub-project:

- `src/ipc/contract.ts` — `DragonIpc` types from parent §4 (not invented ad hoc)
- `src/ipc/mock.ts` — fixture tables/columns
- Creative-brief CSS tokens on `:root` + bundled Inter and JetBrains Mono
- `App.tsx` mounts the canvas only

Runs against **real** `src/core/` from SP-1.

### 4.2 Out of scope

- Three-pane shell, connection sidebar, Queries pane, results grid, SQL editor mode
- Global store layer (`src/stores/`)
- Real IPC / Rust / live database
- Dark mode
- SwiftData → rusqlite data migration
- Expanding CI to Tauri or WebKitGTK builds

If the canvas turns out to need global state, that is a **finding to report**, not permission to start SP-3 early.

---

## 5. Architecture

```
App.tsx
  └─ VisualQueryCanvas (container)
        ├─ local state: QueryDocument     (src/core)
        ├─ mock DragonIpc                 (src/ipc/mock)
        ├─ cards / toolbar / picker / preview
        └─ on edit → mutate doc → validate → generateSQL().display → preview
```

| Path | Responsibility |
|---|---|
| `src/ui/visual-query/*` | Mirrored Swift UI modules |
| `src/ui/visual-query/copy.ts` | Port of `VisualQueryCopy` |
| `src/ipc/contract.ts` | Shared `DragonIpc` surface (parent §4) |
| `src/ipc/mock.ts` | Fixture backend for SP-4a only |
| `src/core/*` | Unchanged IR; UI consumes it |

**Boundary rules**

- UI may import `core/` and `ipc/` contract (+ mock at the App wiring point).
- `core/` remains free of DOM, Tauri, and UI (existing `tsconfig.core.json` + Biome + architecture test).
- No `src/stores/` in SP-4a.
- `runQuery` remains on the contract for SP-3, but SP-4a does not require a Run chrome control (that belongs with SP-4b shell). Live **display** SQL preview is required.

**Styling**

- Plain CSS custom properties named after brief tokens (`--primary-600`, etc.).
- `oklch()` values used verbatim from `docs/pocket/rule/creative-brief.md`.
- Focus rings via `outline` + `outline-offset` per brief.
- 4px radius. Light-only surfaces.
- No Tailwind unless a later decision introduces it.

---

## 6. File map (Swift → TypeScript)

Names may be adjusted slightly in the implementation plan; the invariant is **one Swift file ≈ one TS module**.

| Swift | Target |
|---|---|
| `VisualClauseCardFieldViews.swift` | `src/ui/visual-query/clause-card-fields.tsx` |
| `VisualStatementRootCardView.swift` | `src/ui/visual-query/statement-root-card.tsx` |
| `VisualClauseCardView.swift` | `src/ui/visual-query/clause-card.tsx` |
| `SchemaFieldPopover.swift` | `src/ui/visual-query/schema-field-popover.tsx` |
| `VisualQueryToolbar.swift` | `src/ui/visual-query/toolbar.tsx` |
| `GeneratedSQLPreviewView.swift` | `src/ui/visual-query/generated-sql-preview.tsx` |
| `VisualStatementPickerView.swift` | `src/ui/visual-query/statement-picker.tsx` |
| `VisualQueryCanvasView.swift` | `src/ui/visual-query/canvas.tsx` |
| `VisualQueryCopy.swift` | `src/ui/visual-query/copy.ts` |

---

## 7. Error handling

- Validation comes from `src/core/validation`. UI surfaces the creative-brief copy pattern: what happened + how to fix; no internal codes; never blame the user.
- Mock IPC may expose empty-schema / empty-column fixtures for popover paths. No real Postgres error mapping (Rust is out of scope).
- User-facing strings stay in English (project convention).

---

## 8. Scheduled tech debt (approach S4)

**Debt:** Component boundaries follow SwiftUI files rather than an idiomatic React composition.

**Why accepted:** Port fidelity is the dominant SP-4a risk; regrouping during the port increases the chance of silent behavior drift.

**How it is paid:** Explicit follow-up after SP-4a exit is green, or when the related SP-4b cluster touches the same modules — with a written reason. Not a silent mid-port cleanup.

**Tracking:** This section is the record. The implementation plan must list it under deferred work.

---

## 9. Testing and verification

| Layer | Approach |
|---|---|
| Copy / chrome strings | Port `VisualQueryClauseCopyTests` → Vitest |
| Card behavior (cheap cases) | Optional Testing Library for critical paths (FROM commit, LIMIT parse, WHERE → preview) |
| Visual / engine fidelity | Manual: macOS + Linux required; Windows optional |
| CI | Existing `core` workflow: `bun run check` on `ubuntu-latest` only |
| Architecture | Existing core-boundary test must stay green |

---

## 10. Exit criteria

1. All five clause cards render and are editable: SELECT, FROM, WHERE, ORDER BY, LIMIT.
2. Editing a block updates the generated-SQL preview immediately from `generateSQL(doc).display`.
3. Validation failures use the brief's error copy pattern.
4. Visual output matches the brief: bundled Inter + JetBrains Mono, 4px radius, focus-ring rule.
5. Verified manually on macOS and Linux (Windows optional).
6. `VisualQueryClauseCopyTests` translated and green.
7. **Scaffold purge:** zero remaining Tauri-React demo UI or assets.
   - No “Welcome to Tauri + React”, greet form, or unused Vite/Tauri/React logo chrome.
   - Default scaffold `App.css` replaced by brief tokens (not layered on top).
   - Unused demo assets removed.
   - Plan checklist includes grep gates for: `Welcome to Tauri`, `greet-input`, `You've been greeted`, and demo logo usage in UI.

---

## 11. Relationship to later sub-projects

- **SP-2 / SP-3:** Independent of SP-4a visually; SP-3 replaces `src/ipc/mock.ts` with real invoke wrappers behind the same `DragonIpc` contract.
- **SP-4b:** Keeps SP-4a canvas code; adds shell screens and swaps mock → real IPC. May pay §8 debt when touching these modules.
- **Parent §7:** This document supersedes §7 for SP-4a detail where they differ (scaffold purge, tech-debt stance, CI vs manual Linux, full-window mount). Parent §4 IPC contract remains authoritative.

---

## 12. Reference paths

```
~/project/dragondb/                         active Tauri app
  docs/pocket/rule/creative-brief.md        design authority
  docs/superpowers/specs/2026-08-10-cross-platform-design.md
  src/core/                                 SP-1 IR (done)
~/project/dragondb-swift/                   Swift reference
  DragonDB/Views/Components/VisualQuery/
  DragonDB/Views/Containers/Content/VisualQueryCanvasView.swift
  DragonDB/Logic/VisualQueryCopy.swift
```
