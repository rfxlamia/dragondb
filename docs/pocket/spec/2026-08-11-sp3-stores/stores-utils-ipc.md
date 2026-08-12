# SP-3 — Modular Zustand stores + utils + IPC (fuller, Swift-parity foundations)

**Date:** 2026-08-11
**Status:** approved
**Author:** brainstorm session (pocket-grinding)
**Spec path:** docs/pocket/spec/2026-08-11-sp3-stores/stores-utils-ipc.md
**Amended:** 2026-08-11 — folded Swift parity review (BLOCKING + IMPORTANT) vs `dragondb-swift`

---

## Summary

SP-3 replaces the thin `App.tsx` session with **modular Zustand stores**, ports Swift-parity **utilities** and **persistence/IPC** that SP-4b UI clusters will consume, and expands `DragonIpc` where stubs today are id-only. Canvas Connect/SSH/Run SELECT behavior that passed the macOS exit checklist must remain **byte-identical in user-visible outcomes**. Success is dual: SP-4b-ready foundations **and** zero regression on the verified learning loop.

---

## Context

### Current State

- `main` has SP-0/SP-1/SP-4a/SP-2: real Rust I/O, rough Connect UI, canvas Run SELECT, status-only results.
- No `src/stores/` — session, tables/columns, canvas epoch live in `App.tsx`.
- `DragonIpc` covers profiles + connect lifecycle + listTables/listColumns/runQuery.
- rusqlite: `saved_queries` / `query_folders` / `tab_states` are **id-only stubs**; `query_history` write-on-run exists; no delete/clear helpers.
- macOS checklist: human PASS (Connect + SSH + Run SELECT verified 2026-08-11).
- Parent design labeled SP-3 “Stores + real IPC”; **real IPC already landed in SP-2**, so SP-3 is stores + fuller utils/IPC.

### Problem / Motivation

SP-4b is UI-heavy (ten clusters). Without stores, tab/result/library/history/CSV/row-ops, and metadata lifecycle, every UI session re-ports Swift logic or invents half-stores inside components — the exact failure SP-4a was forbidden to create.

### Related Areas

- `src/App.tsx`, `src/ui/connection/*`, `src/ui/visual-query/*`
- `src/ipc/{contract,tauri-client,mock}.ts`
- `src-tauri/src/{storage,session,commands}.rs`
- Swift: `State/AppState.swift`, `QueryState`, `TabManager`/`TabService`, `SavedQueriesViewModel`, `QueryEditability`, `TableBrowseResultCompactor`, `CSVExporter`, `ConnectionStringParser`, `SQLStatementSplitter`, `QueryTypeDetector`, `RowOperationsService` / `RowOperationError`
- Prior: `docs/pocket/spec/2026-08-11-sp2-rust-io/rust-io-connect-run.md`, `.claude.globals/docs/sum/sp2-rust-io-2026-08-11.md`

---

## Scope

### In-Scope

- **Zustand** modular stores: `session`, `schema` (tables/columns + generation late-ignore), `tabs` (per-tab raw+compact+status; persist **full** Swift `TabState` field set including result blob), `library` (SavedQuery/QueryFolder **full** API matrix), `history`
- Refactor App/connection/canvas wiring to consume stores; preserve SP-2 Connect/Disconnect/switch/lock/Run SELECT semantics
- Utils (tested, Swift ports):
  - `ConnectionStringParser` — parse + validate + `sslmode` + `build()` round-trip + error taxonomy
  - `SQLStatementSplitter` — including `;` inside quotes / dollar-quotes / `--` / `/* */`
  - `QueryTypeDetector` — type classify + `extractTableName` + mutation classification (`isMutation`)
  - Compaction (2048 + `... [truncated]`, length includes suffix)
  - CSV from **raw** (escape rules incl. empty→`""`)
  - Full `QueryEditability` rule table (not JOIN-only)
- IPC/commands:
  - **Library matrix:** create/list/rename/update/delete SavedQuery; duplicate; move/unfolder; create/rename/delete Folder; `deleteFolder(id, deleteQueries: boolean)`
  - **History:** `listHistory` (contract below) + `deleteHistory(id)` + `clearHistory(profileId)` (net-new vs Swift UI)
  - **Tabs:** create/switch/close + persist metadata sync vs results-blob sync; hydrate all TabState fields
  - CSV **save-file** via native dialog
  - Row update/delete with full `RowOperationError` mapping
- Schema **migration** stubs → Swift-parity columns; IPC DTOs mirror checklists below
- Connect **true** failure → full rollback; **cancelled/superseded** connect must not wipe newer attempt
- In-flight Run → ignore late results after disconnect/switch; late Run after tab switch lands on **executing tab**
- Switch fail after teardown A: clear in-memory results; keep card snapshot
- `closeTab` last → recreate empty active; `closeTab` among N → activate **MRU by `lastAccessedAt`**
- Pending-deleted tab ids: ignore further writes (async safety)

### Out-of-Scope

- SP-4b chrome: TabBar, History/SavedQuery browser, Export button, results grid, cell-edit UI, 3-pane shell, SQL editor
- Library UI-only state (search/sort/expanded-folder sets) — persist/CRUD APIs only
- Paste connection-string UI in Connect panel (parser logic-only)
- Multi-statement **execute** / changing canvas Run gate / Run CREATE / create-delete database
- Table-browse pagination / page-cache (`QueryState` browse cache) — SP-4b table browser
- SavedQuery **in-memory** results cache distinct from TabState blob — session-only; don’t confuse with tab persist
- `SET search_path` from `selectedSchemaFilter` on hydrate — **SP-4b wiring** (record owner; not SP-3 session requirement)
- Connect/canvas UX redesign beyond store extraction
- SP-5 distribution / SP-6 archive
- SwiftData → rusqlite importer (release-notes obligation remains until SP-6)

---

## Architecture Constraints

- Layers OK: `src/stores/**`, util modules (e.g. `src/lib/**` or `src/stores/utils/**`), thin `src/ui/**` + `App.tsx`, `src/ipc/**` delta, `src-tauri/**` storage/commands as needed
- MUST NOT: pollute `src/core/` with DOM/Tauri/store; grow Rust into business-logic home for pure TS utils; runtime production mocks
- Patterns: Rust thin I/O; IR in TypeScript; privacy-local; Swift mirror when example exists; explicit pathspec git culture
- Orchestration: disconnect/switch must explicitly clear session + schema + in-memory tab results (avoid circular imports — prefer session actions calling clear helpers or a thin orchestrator)
- Architecture validation: **PASS** (2026-08-11)

### Phase 6 checklist

- [x] Layer boundaries
- [x] Existing patterns
- [x] Deps (Zustand)
- [x] Build-vs-buy
- [x] Rollback (branch revert; additive sqlite)
- [x] Explicit IPC/schema contract
- [x] Performance acceptable
- [x] Security (keyring-only secrets)

---

## Dependencies

### Existing (to leverage)

- `@tauri-apps/api` — invoke
- `tauri-plugin-dialog` — save CSV path (same family as key-file pick)
- `src/core` — `generateSQL`, validation, `QueryDocument` (unchanged contract)
- Vitest / Biome / `bun run check`
- SP-2 `DragonIpc` + rusqlite/history write path

### New (proposed)

- `zustand` (current major, lock exact version in planning) — modular client stores; rejected Context-only (re-render/selector cost) and Jotai (atomic model less natural for session/tab modules); not a server-cache library

Pure utils are **Swift ports** (not new npm SQL/CSV frameworks). Hand-rolling connection-string parse / CSV escape / splitter is justified as fidelity ports of existing Swift utilities, not greenfield crypto/auth.

---

## Design Decision

**Chosen option:** Option A — Modular Zustand (mirror Swift `AppState`)

**Summary:** Separate stores for session, schema, tabs, library, history + pure util modules + IPC/schema expansion. Best fit for per-tab results, SP-4b selectors, and Swift composition.

**Rejected options:**

- Option B (monolith store): harder selective subscribe; large PRs; fights Zustand rationale
- Option C (logic-heavy Rust): violates thin I/O; pure utils become IPC round-trips

**Key tradeoffs accepted:**

- Cross-store orchestration complexity on disconnect/switch
- Full tab blob persist size cost (Swift parity)
- History delete/clear is net-new vs Swift UI (API allowed)
- Dual raw+compact per tab is intentional Tauri model (Swift browse often caches compacted-only; editor Run does not compact)
- Clear-at-start on new Run is intentional SP-3/orchestration choice (Swift editor often keeps prior rows until completion) — documented divergence

---

## IPC / DTO checklists (planning must expand contract delta)

### TabState (Swift `TabState.swift`) — migrate + hydrate ALL

| Field | Persist |
|-------|---------|
| `id` | yes |
| `connectionId` | yes |
| `databaseName` | yes |
| `queryText` | yes |
| `savedQueryId` | yes |
| `isActive` | yes |
| `order` | yes |
| `createdAt` | yes |
| `lastAccessedAt` | yes |
| `selectedTableSchema` | yes |
| `selectedTableName` | yes |
| `selectedSchemaFilter` | yes |
| `cachedResultsData` (blob) | yes (results sync path) |
| `cachedColumnNames` | yes (results sync path) |

**Two persist modes** (mirror `TabService` / `TabManager`):

1. **Metadata/text sync** — update fields **without** re-encoding blob (`includeCachedResults: false` equivalent)
2. **Results sync** — encode/write blob + column names on successful Run (write-on-success)

### SavedQuery DTO — Swift fields

`id`, `name`, `queryText`, `connectionId?`, `databaseName?`, `createdAt`, `updatedAt`, `folderId?`

### QueryFolder DTO — Swift fields

`id`, `name`, `createdAt`, `updatedAt`

### Library IPC matrix (logic/API only; no sidebar chrome)

| Op | Notes |
|----|-------|
| `listSavedQueries` / `getSavedQuery` | |
| `saveSavedQuery` (create/update) | bumps `updatedAt` on update |
| `deleteSavedQuery` / `deleteSavedQueries` | |
| `duplicateSavedQuery` | Swift duplicate |
| `moveSavedQuery` / unfolder (`folderId=null`) | |
| `listFolders` / `createFolder` / `renameFolder` | |
| `deleteFolder(id, deleteQueries: boolean)` | `false`=nullify; `true`=cascade |

### History field mapping (SP-2 superset)

| SP-2 / Tauri | Swift `QueryHistory` | Notes |
|--------------|----------------------|-------|
| `id` | `id` | |
| `profile_id` | `connectionId` | map in DTO as `profileId` (session profile), document alias |
| `sql` | `queryText` | |
| `success` | `isSuccess` | |
| `error_message` | — | **keep** SP-2 extra |
| `duration_ms` | `executionTime` | |
| `row_count` | — | **keep** SP-2 extra |
| `created_at` | `executionDate` | |
| — | `databaseName` | **optional**; include if cheap, else drop with recorded reason in planning |

**List contract:** `listHistory({ profileId?: ProfileId, limit: number })` — newest-first; if `profileId` omitted → global list; `clearHistory(profileId)` always per-profile (never global wipe).

### RowOperationError kinds (map to `IpcError` / typed row-op error)

Mirror Swift: `noPrimaryKey`, `noTableSelected`, `noRowsSelected`, `metadataFetchFailed`, `updateFailed`, `deleteFailed`; support `.null` edit values where Swift does.

---

## Stories + Scenarios

### Story: Session store preserves Connect/Run

> As the DragonDB author, I want session state in Zustand so SP-4b does not reinvent Connect/Run and App stays thin.

```gherkin
Scenario: Connect success
  Given disconnected app with saved profile P
  When connectProfile(P) succeeds
  Then session store isConnected=true with connectionId and profileId
  And schema store starts listTables with generation guard

Scenario: Connect failure full rollback
  Given SSH would succeed but Postgres auth fails
  When connectProfile is attempted
  Then session remains disconnected (no connectionId)
  And no orphan tunnel remains
  And UI surfaces IpcError

Scenario: Superseded connect does not wipe newer attempt
  Given connect A in-flight then connect B starts (A cancelled/superseded)
  When A fails with cancelled and B succeeds
  Then session reflects B connected
  And cancelled A does not clear B's session

Scenario: Disconnect clears session
  Given Connected session with clause cards and results
  When disconnect
  Then isConnected=false and connectionId=null
  And in-memory per-tab raw/compact/status cleared
  And cards preserved as read-only snapshot
  And list/run with old id fail without silent reconnect

Scenario: Switch success resets canvas
  Given Connected to A with cards
  When user confirms switch to B and connect B succeeds
  Then session reflects B
  And canvas remounts empty for B
  And schema reloads for B

Scenario: Switch fails after teardown A
  Given Connected to A with results
  When A is disconnected and connectProfile(B) fails
  Then store disconnected
  And results cleared
  And prior cards remain as snapshot without old result
```

### Story: Per-tab results + late ignore

> As the app, I want per-tab raw+compact+status so SP-4b grid binds without stale writes.

**Intentional divergence:** SP-3 keeps **raw + compact** dual model and **clears in-memory result at new Run start** on that tab. Swift editor often keeps prior rows until completion; Swift table-browse may cache compacted-only. Documented — do not claim editor 1:1 on these two points.

```gherkin
Scenario: Run stores raw and compact on active tab
  Given Connected and eligible SELECT on tab T
  When Run succeeds with a cell longer than 2048 chars
  Then T.raw keeps full cell
  And T.compact truncates to 2048 chars including "... [truncated]"
  And status shows OK / rows / ms
  And results-blob sync writes cachedResultsData/cachedColumnNames

Scenario: Run failure stored on tab
  Given clear-at-start on tab T
  When Run fails
  Then T has failure status+message and no rows
  And other tabs unchanged

Scenario: Late result after disconnect ignored
  Given Run in-flight
  When user disconnects then the promise resolves
  Then disconnected session does not apply that result

Scenario: Late result after tab switch lands on executing tab
  Given tab A started Run then API switched to tab B (still connected)
  When Run A completes successfully
  Then raw/compact/status write to tab A
  And active UI tab B is not overwritten

Scenario: New Run clears previous on that tab
  Given tab T has previous result
  When user starts a new Run on T
  Then previous in-memory result on T cleared at start
```

### Story: Schema metadata store

```gherkin
Scenario: Late listTables ignored
  Given Connected
  When disconnect or switch while listTables in-flight
  Then schema store does not apply late rows
```

### Story: Logic-only utilities

```gherkin
Scenario: Parser happy path
  Given postgres://admin:secret@127.0.0.1:5432/fstrack
  When parseConnectionString
  Then host/port/user/password/database extracted

Scenario: Parser validates and sslmode
  Given invalid scheme or bad port
  When parseConnectionString
  Then structured error per Swift taxonomy
  And sslmode query param is parsed when present
  And build() round-trips a valid parsed form

Scenario: Splitter respects quotes and comments
  Given SQL with semicolons inside quotes, dollar-quotes, -- line comments, or /* block comments */
  When split
  Then statements are not broken on those internal semicolons

Scenario: Query type detect + extractTableName + mutation
  Given representative SQL samples
  When detect
  Then type classification, extractTableName, and isMutation match Swift port tests

Scenario: Canvas Run unchanged
  Given Connected CREATE visual query
  When Run
  Then still gated with no Postgres execute (SP-2)
```

### Story: Tabs API without TabBar

```gherkin
Scenario: Create tab inherits connection and empty query
  Given Connected session with databaseName D
  When store.createTab()
  Then new tab has connectionId/databaseName inherited
  And queryText is empty
  And order = max(existing)+1
  And no TabBar UI appears

Scenario: Close among N activates MRU
  Given tabs T1,T2,T3 with T2 active and T1 most recently accessed among remaining
  When closeTab(T2)
  Then T2 gone and T1 becomes active (MRU by lastAccessedAt)

Scenario: Close last tab recreates empty
  Given exactly one tab
  When closeTab
  Then a new empty active tab exists (always >= 1)

Scenario: Persist round-trip all TabState fields
  Given active tab with full metadata + successful cached results blob
  When app restarts
  Then all TabState checklist fields restore
  And compact is recomputed from raw (not a separate persist field)

Scenario: Metadata sync does not rewrite blob
  Given tab with existing blob
  When queryText/order/isActive sync with includeCachedResults=false equivalent
  Then blob bytes unchanged

Scenario: Writes ignored for pending-deleted tab
  Given tab id marked pending deletion / closed
  When a late Run or persist write targets that id
  Then store/IPC ignores the write
```

### Story: SavedQuery / QueryFolder full library matrix

```gherkin
Scenario: Save update list rename duplicate move
  When create, update queryText/name, duplicate, move to folder, unfolder, rename folder
  Then list reflects Swift-parity fields and relationships

Scenario: Delete queries
  Given saved queries Q1,Q2
  When deleteSavedQueries([Q1,Q2])
  Then they are absent from list

Scenario: Delete folder nullify
  Given folder F with N queries
  When deleteFolder(F, deleteQueries=false)
  Then F is gone and queries remain with folderId=null

Scenario: Delete folder cascade
  Given folder F with N queries
  When deleteFolder(F, deleteQueries=true)
  Then F and its queries are deleted
```

### Story: QueryHistory list + delete + clear per profile

```gherkin
Scenario: List after run
  Given Run completed (history row written)
  When listHistory({ limit })
  Then newest-first rows with SP-2 superset fields (incl. error_message, row_count)

Scenario: List filtered by profile
  Given history for P and Q
  When listHistory({ profileId: P, limit })
  Then only P rows returned

Scenario: Clear per profile
  Given history for profiles P and Q
  When clearHistory(P)
  Then only profile_id=P rows removed

Scenario: Delete one
  Given history id H
  When deleteHistory(H)
  Then H absent from list
```

### Story: CSV + save-file IPC

```gherkin
Scenario: CSV from raw with escaping
  Given raw result with comma, quote, and empty cell
  When toCsv
  Then properly escaped CSV text (empty → "")

Scenario: Save file
  Given CSV text and user confirms save dialog path
  When saveCsvFile
  Then file written
  And dialog cancel performs no write without crash
```

### Story: Editability + row operations

```gherkin
Scenario: Full QueryEditability rule table
  Given SQL samples for CTE, UNION/INTERSECT/EXCEPT, GROUP BY, DISTINCT, window, aggregates, multi-FROM, JOIN
  When determineEditability
  Then isEditable=false with Swift-parity reasons
  And sourceTable short-circuit yields editable when set
  And simple single-table SELECT extracts tableName/schema

Scenario: Row ops error mapping
  Given Connected without PK / no table selected / no rows selected / metadata failure
  When updateRow or deleteRows
  Then typed error matches RowOperationError set; DB unchanged on validation errors

Scenario: Update row via IPC success
  Given Connected editable table context with PK
  When updateRow(...) including null edit values where supported
  Then DB row updated
```

---

## Acceptance Criteria

```
ACCEPTANCE CRITERIA — SP-3 stores + utils + IPC
Date: 2026-08-11 | Scope confirmed: yes | Swift-review amend: yes

Rule: Session Connect/Run parity
  ✓ Given saved profile, When connect succeeds, Then session+schema stores update like SP-2 App
  ✓ Given SSH OK then DB auth fail, When connect, Then full rollback, no connectionId, IpcError
  ✓ Given superseded/cancelled connect under newer success, When older fails cancelled, Then newer session preserved
  ✓ Given Connected, When disconnect, Then clear session + in-memory results; cards snapshot; no silent reconnect
  ✓ Given Connected A, When switch to B succeeds, Then session=B, canvas empty, schema reload
  ✗ Given Connected A, When switch B fails after teardown, Then disconnected, results cleared, cards snapshot without result

Rule: Per-tab results
  ✓ Given Run success long cell, When store, Then raw full + compact 2048 incl suffix on that tab + results-blob sync
  ✓ Given Run fail, When complete, Then failure status+message on that tab, no rows
  ✓ Given Run in-flight, When disconnect, Then late result ignored
  ✓ Given Run on tab A then switch to B, When A completes, Then write to A not B
  ✓ Given Start over / new Run / disconnect / switch teardown, When triggered, Then in-memory results clear (intentional clear-at-start)

Rule: Schema store
  ✓ Given listTables in-flight, When disconnect/switch, Then late metadata ignored

Rule: Logic-only utils
  ✓ Given URI variants, When parse/build, Then Swift-parity validation + sslmode + errors
  ✓ Given quoted/commented SQL, When split, Then internal semicolons preserved
  ✓ Given SQL samples, When detect, Then type + extractTableName + isMutation covered
  ✓ Given CREATE on canvas, When Run, Then still gated (no execute)

Rule: Tabs
  ✓ Given createTab, Then inherit connection/databaseName, empty queryText, order=max+1
  ✓ Given close among N, Then MRU lastAccessedAt becomes active
  ✓ Given last tab, When closeTab, Then recreate empty active tab
  ✓ Given full TabState checklist + blob, When restart, Then all fields hydrate; compact from raw
  ✓ Given metadata sync, Then blob not rewritten; pending-deleted ids ignore writes
  ✓ No TabBar UI

Rule: Library
  ✓ Given full IPC matrix (create/update/rename/duplicate/move/delete queries + folders + deleteFolder(deleteQueries)), When exercised, Then Swift-parity outcomes
  ✓ Schema/DTO migrated from id-only stubs to Swift fields

Rule: History
  ✓ Given listHistory with/without profileId + limit, Then newest-first per contract
  ✓ Given runs on P and Q, When clearHistory(P), Then only P removed
  ✓ Given id H, When deleteHistory(H), Then H gone
  ✓ Field mapping table honored (SP-2 superset)

Rule: CSV
  ✓ Given raw rows, When toCsv + saveCsvFile, Then escaped CSV (empty→"") and native save; cancel safe
  ✓ CSV uses raw not compact

Rule: Editability + row ops
  ✓ Given full QueryEditability rule table samples, When determineEditability, Then Swift-parity
  ✓ Given RowOperationError cases, When update/delete, Then typed errors; success path mutates DB

Rule: Dual exit
  ✓ bun run check green; stores/utils/IPC tests cover rules above
  ✓ Connect/SSH/Run SELECT user-visible behavior remains as macOS-PASS SP-2
```

---

## Open Questions / Assumptions

| Question | Resolution | Risk if Wrong |
|----------|------------|---------------|
| R8 clear vs sqlite blob wipe | clear **in-memory** on disconnect/switch; sqlite blob write-on-success (not mandatory wipe) | Stale blob — mitigate hydrate + overwrite on next success |
| Compact persist | recompute compact from raw on hydrate | Extra CPU — OK |
| Dual raw+compact | intentional Tauri model; Swift browse often compacted-only; editor often uncompacted | SP-4b must use raw for CSV/export accuracy |
| Clear-at-start vs Swift editor | intentional SP-3: clear in-memory at new Run start | Diverges from Swift editor keep-until-finish |
| Late ignore after disconnect | intentional stricter than Swift (no soft cancel required) | OK for store correctness |
| History API vs Swift UI | list+delete+clear net-new OK; list filter optional `profileId` | OK |
| History `databaseName` | planning may keep optional or drop with recorded reason | Low |
| Canvas IR ↔ tab.queryText | active-tab under hood; full visual sync SP-4b | SP-4b owns |
| `selectedSchemaFilter` → search_path | **SP-4b wiring**, not SP-3 | If done early, document as stretch |
| Exact zustand version | planning locks | Low |

---

## Implementation Notes

- IPC contract delta must list **every** library/tab/history/row-op/CSV method + DTO (SP-2 C1 discipline).
- Prefer `createStore` + selectors; inject `DragonIpc` via factory for tests.
- Migration: additive columns on stub tables; document id-only legacy rows.
- Port test tables from Swift: `QueryEditabilityTests`, `TableBrowseResultCompactorTests`, splitter/parser/type-detector tests where present.
- Do not change `canRun` core semantics for CREATE; gate remains UI/store Run handler.
- Keep release-notes non-migration obligation visible.
- Library sort/search/expanded-folder = UI state only — out of SP-3.

---

## Rollback Plan

- Revert feature branch / PR; do not ship.
- Additive sqlite migrations are forward-compatible; avoid destructive down-migration of user app DB.
- No SwiftData importer path; no production cloud state.

---

## Edge Case Hunter

- Cycle 1: Needs Clarification (9 blocking) — resolved with user.
- Cycle 2: **Clear** — recommended scenarios folded into Stories above.

## Spec review vs Swift

- 2026-08-11 explorer review: **Amend before planning** (2 BLOCKING + many IMPORTANT).
- This amend folds **all** BLOCKING + IMPORTANT findings into Scope / checklists / Stories / AC / Assumptions.
