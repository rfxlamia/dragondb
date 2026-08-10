# DragonDB Cross-Platform — Design

**Date:** 2026-08-10
**Status:** Approved (brainstorming output)
**Scope of this document:** parent decisions + decomposition, plus detailed specs for **SP-1** and **SP-4a**. The remaining sub-projects get their own spec → plan → implementation cycle.

---

## 1. Why

DragonDB is a fork of O'Saasy, a macOS-only SwiftUI PostgreSQL client. Its product direction — see `docs/pocket/ROADMAP.md` — is a visual SQL builder whose north star is moving a user from *"I don't remember SQL syntax"* to *"I know what this SQL is doing."*

That audience is disproportionately not on macOS. Students, bootcamp learners, and analysts early in SQL fluency are majority Windows. A macOS-only build excludes the product's largest natural audience.

**Timing argument.** The visual builder is 7 files today. Roadmap Phases 2–6 are almost entirely new UI surface: multi-condition WHERE, JOIN builder with schema-aware pickers, SUMMARIZE / GROUP BY / HAVING, the SQL inspector, escape hatch, SQL→visual reconstruction. Port cost scales with UI surface and never decreases. Today is the cheapest this migration will ever be.

---

## 2. Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Tauri v2** — TypeScript frontend, thin Rust I/O core | ~15MB bundle vs Electron's ~150MB, appropriate for a DB client (TablePlus ~50MB). IR stays in TS so Rust remains a dumb I/O layer. |
| D2 | **Three platforms ship together**; the Swift app is frozen, not deleted | macOS has zero install friction via an own-tap cask (see D4), so there is no reason to stage platforms. The Swift app remains the safety net for existing Mac users until Tauri proves stable. |
| D3 | **No paid Apple Developer account required** | Ad-hoc signing (`"signingIdentity": "-"`) satisfies Apple Silicon's requirement that binaries carry *some* signature. Notarization and App Store are deferred; neither blocks release. |
| D4 | **Distribution via own Homebrew tap + curl installer**, adapted from `termul` | The cask's `postflight` strips `com.apple.quarantine` itself, so plain `brew install --cask` has no Gatekeeper prompt and no `--no-quarantine` flag. Browser DMG downloads still hit Gatekeeper — documentation must steer macOS users to brew/curl. |
| D5 | **`generateSQL` returns dual output** | The brand line requires human-readable SQL; parameter placeholders (`$1`) would defeat the learning purpose. Emit both: inlined literals for display, bound parameters for execution. |
| D6 | **Risk-ordered sequencing**: core and UI first, distribution last | Distribution is proven prior art for this author in the same framework. Risk lives in the IR port and the UI rewrite. |
| D7 | **Creative brief amended before any UI work** | Done 2026-08-10. Platform, fonts, focus rings, and implementation notes updated; OKLCH palette unchanged. |
| D8 | **New non-fork repository** `rfxlamia/dragondb`, not a branch of the existing fork | GitHub hides forks from search. With 0 stars there is nothing to lose by fixing it now. See §3.0. |
| D9 | **Rename the existing repo** `dragon-db` → `dragondb-swift`. Done 2026-08-10, ahead of SP-0 | `dragon-db` and `dragondb` differ by one hyphen, and SP-0 runs commands naming both trees on the same line. Renaming the legacy side keeps the clean name on the surviving product. Executed immediately rather than during SP-0: moving the directory breaks any agent session anchored to it, so subagents spawn into a path that no longer exists. GitHub redirects the old URL. |

### 2.1 Rejected alternatives

- **Electron.** Consistent Chromium rendering across all three OSes is a genuine advantage for an interaction-heavy visual builder, but a ~150MB bundle and heavy RAM are poor fits for a DB client.
- **Staying in Swift with a cross-platform UI toolkit.** Swift runs on Linux and Windows; SwiftUI does not. The core could be shared, but the UI — the bulk of the work — would still be written in another technology. Thinnest ecosystem, most exotic path.
- **Two apps permanently** (Swift flagship on macOS, Tauri elsewhere). Best native Mac feel, but every roadmap phase gets built twice in UI, forever. Only justified if native Mac feel were the primary value proposition; for a product whose value is *learning SQL*, it is not.

---

## 3. Repositories and architecture

### 3.0 Repository layout (D8)

The Tauri app lives in a **new, non-fork repository**, not a branch of the existing one.

`rfxlamia/dragon-db` is a GitHub fork of `PostgresGUI/postgresgui`. GitHub excludes forks from repository and code search by default, and renders "forked from …" above the repo. For a product whose entire motivation is reaching an audience, that is a structural handicap. With 0 stars and 0 forks there is nothing to preserve, so the fix costs nothing today and gets more expensive with every star earned — the same timing logic as §1.

**The existing repository is renamed `dragon-db` → `dragondb-swift` before SP-0 begins (D9).** Otherwise the two repositories, and the two working directories, would differ by a single hyphen — and SP-0 itself contains commands naming both paths on one line, where one mistyped character copies from the wrong tree. Renaming the legacy side rather than compromising the new name means the clean name attaches to the product that survives, while the archived one carries a description of what it actually is. GitHub creates a redirect from the old URL, so existing clones and links keep working.

```
rfxlamia/dragondb              NEW, non-fork          → ~/project/dragondb
  src/
    core/                      pure IR — no DOM, no Tauri, no stores
      query-document.ts
      query-clause.ts
      sql-generator.ts
      validation.ts
      canvas-presentation.ts
    ipc/                       typed wrappers over invoke()
    stores/                    app state
    ui/                        components, driven by the creative brief
  src-tauri/src/
    postgres/                  tokio-postgres
    ssh/                       tunnel
    secrets/                   keyring (per-OS cargo features — see §11)
    storage/                   rusqlite (replaces SwiftData)
  scripts/install.sh           adapted from termul
  docs/                        creative brief + this spec, copied over
  .github/workflows/

rfxlamia/homebrew-dragondb     tap — its own repo, always
  Casks/dragondb.rb            adapted from termul

rfxlamia/dragondb-swift        EXISTING fork, renamed from dragon-db
  DragonDB/                    reference source for the port    → ~/project/dragondb-swift
  DragonDBTests/               the port's reference test contract
                               frozen at SP-6, then archived
```

The tap is a separate repository regardless of any other decision. `termul` settled this: `5ccbf0e chore: remove seed cask; tap repo is source of truth`. `scripts/install.sh` stays in the application repo; only the cask lives in the tap.

**Attribution is unaffected by the repo split.** DragonDB is a fork of O'Saasy by Fikri Ghazi. The `LICENSE` file and the README acknowledgment carry over to the new repository verbatim — this is a licence obligation, not a consequence of repo structure.

**Consequence for this document:** the design spec and the creative brief currently live in `dragondb-swift`, and `docs/pocket/**` is gitignored there. Both are copied into `dragondb` during SP-0, along with the `.claude/` brand-design enforcement (hook script, rule file, `settings.json` registration) so the design authority follows the work.

### 3.1 Module boundary

**Boundary rule.** `src/core/` may not import from `ui/`, `stores/`, `ipc/`, or `@tauri-apps/*`, and may not touch a DOM global. Three mechanisms enforce it, because each covers what the others miss:

1. A `tsconfig.core.json` whose `lib` omits `DOM`, making every browser global a compile error inside `core/` — no pattern-matching involved.
2. A lint rule restricting imports, which covers static, side-effect, and dynamic forms.
3. An architecture test as regression backup, which survives a deleted config or a disabled rule.

Roadmap Principle 5 ("visual cards mutate a query model, not SQL strings") was upheld by convention in the Swift codebase; here it is upheld by CI, which runs all three on every push.

### 3.2 Data flow

```
UI blocks  → mutate QueryDocument      (core)
           → validate                  (core) → errors surface in UI
           → generateSQL               (core)
           → ipc.runQuery(exec)        → Rust: pool → tokio-postgres → rows
           → QueryResult                                → results grid
```

Rust never sees the query model. It receives finished SQL plus bound parameters. The IR is single-sourced in TypeScript.

---

## 4. IPC surface (contract)

Defined here in the parent document because **SP-4a mocks this signature and SP-3 implements it**. If SP-4a invents its own shape ad hoc, SP-3 becomes a rewrite of everything the canvas touched.

```ts
// src/ipc/contract.ts
//
// ExecutableSQL is DEFINED IN core (`src/core/sql-generator.ts`) and imported
// here — never redeclared. It is the generator's output type; a second
// definition in the IPC layer would be free to drift from the thing that
// actually produces the value.
import type { ExecutableSQL } from '../core';

export type ConnectionId = string;

export interface TableRef { schema?: string; name: string; }

export interface ColumnInfo {
  name: string;
  dataType: string;
  isNullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
  isUnique: boolean;
  isForeignKey: boolean;
}

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  rowsAffected: number | null;
  durationMs: number;
}

export type IpcError =
  | { kind: 'connection'; message: string }
  | { kind: 'auth';       message: string }
  | { kind: 'syntax';     message: string; position: number | null }
  | { kind: 'permission'; message: string }
  | { kind: 'unknown';    message: string };

export interface DragonIpc {
  listTables(c: ConnectionId): Promise<TableRef[]>;
  listColumns(c: ConnectionId, table: TableRef): Promise<ColumnInfo[]>;
  runQuery(c: ConnectionId, sql: ExecutableSQL): Promise<QueryResult>;
}
```

`listTables` / `listColumns` exist because the canvas needs them for the FROM and column pickers — `SchemaFieldPopover.swift` is generic over its item list, and `ColumnInfo` above mirrors `DragonDB/Models/ColumnInfo.swift` field for field.

---

## 5. Decomposition

| SP | Scope | Approx LOC | Depends on | Risk |
|----|-------|-----------:|------------|------|
| SP-0 | Repo bootstrap: create `rfxlamia/dragondb`, scaffold Tauri v2, carry over brief + `.claude/` enforcement + this spec, port LICENSE and attribution | scaffold | — | Low |
| **SP-1** | Visual query IR → TypeScript | 585 | SP-0 | **High** (gate) |
| **SP-4a** | First UI slice: visual canvas + its container, IPC mocked | ~1,220 | SP-1 | **Highest** |
| SP-2 | Rust I/O: postgres, SSH, keyring, sqlite | ~2,500 | — | Medium |
| SP-3 | Stores + real IPC | ~5,000 | SP-1, SP-2 | Medium |
| SP-4b | Remaining UI — **ten clusters, enumerated in §12.1** | ~7,926 | SP-3, SP-4a | High (one spec per cluster) |
| SP-5 | Distribution: cask, installer, CI matrix | ~1,100 | SP-4b | **Low** (proven prior art) |
| SP-6 | Freeze the Swift app, **gated on the §13.1 parity checklist** | policy | SP-5 | — |

Total new code to reach parity with today's macOS app: roughly 17,000–19,000 LOC. Realistically 3–4 months solo, during which roadmap Phases 2–6 are paused.

**SP-4b is a container, not a task.** Its ten clusters are listed in §12.1 and each needs its own spec before implementation. Treating it as one unit is what allowed ten of the app's fifteen screens to go unnamed in the first draft of this document.

**Why SP-4a sits second.** UI is the largest and least test-guarded work, but its dependency chain is long, so it would normally be touched last. Mocking the §4 IPC surface breaks that chain and lets the highest risk be tested immediately after the core turns green.

**Why SP-5 is last.** The distribution chain is proven prior art — `termul` is a Tauri app by the same author with a working cask, curl installer, bats suite, and release workflow. The cost of deferring it is scheduling (nothing ships to users until near the end), not risk.

---

## 6. SP-1 — Visual query IR → TypeScript

### 6.1 Scope

| Swift source | LOC | TypeScript target |
|---|---:|---|
| `Models/VisualQueryDocument.swift` | 202 | `core/query-document.ts` |
| `Logic/VisualSQLGenerator.swift` | 129 | `core/sql-generator.ts` |
| `Logic/VisualQueryValidation.swift` | 118 | `core/validation.ts` |
| `Models/VisualQueryClause.swift` | 77 | `core/query-clause.ts` |
| `Logic/VisualQueryCanvasPresentation.swift` | 59 | `core/canvas-presentation.ts` |
| | **585** | |

**Explicitly not in SP-1:**

- `Logic/VisualQueryCopy.swift` (176 LOC) — despite living in `Logic/`, its header reads *"English helpers and chrome copy for the visual query canvas"* and its contents are menu titles, helper strings, and badges. That is UI-layer content governed by the creative brief's Copy Guidelines. It moves to **SP-4a**, and `VisualQueryClauseCopyTests` moves with it.
- `Logic/QueryDecisions.swift`, `Logic/AppLaunchDecisions.swift`, and the SwiftData-backed models (`ConnectionProfile`, `SavedQuery`, `QueryHistory`, `QueryFolder`, `TabState`) — app data and app-flow concerns, not visual-query IR. They belong to SP-2 / SP-3.

### 6.2 Test contract

Five Swift suites are translated to Vitest and constitute the definition of done:

```
VisualQueryDocumentTests
VisualSQLGeneratorTests
VisualQueryValidationTests
VisualQueryCanvasPresentationTests
VisualQueryFromFieldTests
```

All green ⇒ the IR transferred intact. This is transliteration guarded by tests, not a redesign — resist "improving" semantics during the port. Any behavior change other than §6.3 is out of scope.

### 6.3 The one intentional behavior change — dual output (D5)

Current Swift generator returns a single SQL string with inlined literals. Escaping is correct today (`quoteIdentifier` doubles `"`, `quoteLiteral` doubles `'`, `escapeLikePattern` escapes `\ % _` and emits `ESCAPE '\'`), but escaping sits on the security-critical path.

New signature:

```ts
export interface GeneratedSQL {
  display: string;          // literals inlined — what the SQL inspector shows
  exec: ExecutableSQL;      // $1, $2 … + params — what crosses IPC
}

export function generateSQL(doc: QueryDocument): GeneratedSQL | null;
```

**Test implications — this is what makes "the suites are the contract" true rather than approximate:**

- `VisualSQLGeneratorTests` currently asserts against a single string. Translated, each existing assertion targets **`display`** and must match the old expected output verbatim.
- **`exec` gets new cases**, with no Swift ancestor: placeholder emission, LIKE pattern construction as a parameter rather than an inlined literal, `NULL` handling for `isEmpty`, and an anchor test asserting that `display` and `exec.text` differ only at the bound value.

Phase 0's IR carries a **single** WHERE condition, so `$1` is the only placeholder that can occur. Multi-condition WHERE arrives with roadmap Phase 2; placeholder numbering and parameter ordering become testable then. Do not add multi-condition support to SP-1 merely to exercise `$2`.

**Security note.** Postgres cannot parameterize identifiers. Table and column names stay on the quote-and-escape path in *both* outputs, so `quoteIdentifier` remains security-critical and needs dedicated adversarial test cases (embedded quotes, backslashes, unicode).

### 6.4 Exit criteria

- All five suites green under Vitest.
- New `exec` cases green.
- The lint boundary rule is active and `core/` has zero imports from `ui/`, `stores/`, `ipc/`, or `@tauri-apps/*`.
- No file in `core/` references the DOM or any Tauri API.

---

## 7. SP-4a — First UI slice: visual canvas

### 7.1 What this answers

> Does the block-card interaction model survive the move to a web UI at the fidelity the creative brief demands?

This is real UI work, written once and to production standard — not throwaway exploration. Nothing here is undecided: the creative brief fixes every visual token, and the seven Swift source files fix every behavior. With no design left to discover, a rough draft would cost a second write-up and return no information the finished version does not.

It is sequenced second because it carries the highest risk in the whole migration, and mocking the §4 IPC surface lets that risk be tested immediately after the core turns green — instead of last, after Rust and stores are done.

### 7.2 Scope

The seven card components in `DragonDB/Views/Components/VisualQuery/`:

```text
VisualClauseCardFieldViews.swift     226
VisualStatementRootCardView.swift    149
VisualClauseCardView.swift           134
SchemaFieldPopover.swift              92
VisualQueryToolbar.swift              59
GeneratedSQLPreviewView.swift         57
VisualStatementPickerView.swift       50
                                   ─────
                                     767
```

**Plus the container that assembles them** — `Views/Containers/Content/VisualQueryCanvasView.swift`, 281 LOC. It sits in a different directory, which is how the first draft of this section missed it; without it there is no canvas to render the cards into.

Plus `Logic/VisualQueryCopy.swift` (176 LOC) and `VisualQueryClauseCopyTests`, reassigned from SP-1 per §6.1.

**~1,220 LOC in all.**

It runs against the **real** `core/` from SP-1 and a **mocked** `DragonIpc` (§4) returning fixture tables and columns.

### 7.3 Explicitly not in scope

- No store layer. Component-local state only. If the canvas turns out to need global state, that is a finding to report, not a licence to start SP-3 early — otherwise SP-3 arrives to find stores half-written inside components.
- No real IPC, no Rust, no database connection.
- No connection form, sidebar, results grid, or query editor.
- No dark mode (see §10).

### 7.4 Exit criteria

- All five clause cards render and are editable: SELECT, FROM, WHERE, ORDER BY, LIMIT.
- Editing a block updates the generated-SQL preview immediately, reading `display` from the real `core/` generator.
- Validation failures surface with the brief's error copy pattern (what happened + how to fix).
- Visual output matches the creative brief: Inter and JetBrains Mono bundled locally, 4px radius, the §"Focus ring" rule applied via `outline` + `outline-offset`.
- Verified on WebKitGTK (Linux) as well as the development machine — it is the least consistent of the three engines.
- `VisualQueryClauseCopyTests` translated and green.

### 7.5 Relationship to SP-4b

SP-4a's code **is** the first part of SP-4b — it is kept and built upon, not rewritten. SP-4b adds the remaining screens (connection form, sidebar, results grid, query editor) and swaps the mocked `DragonIpc` for the real one from SP-3.

The §7.3 boundary is what makes that swap cheap: because the canvas never reached past the `DragonIpc` interface, replacing the mock touches the IPC module and nothing else.

---

## 8. Error handling

The existing chain (`Errors/`, 496 LOC, plus `ErrorMappingTests`) keeps its shape. Mapping from raw Postgres error to domain type happens **in Rust** and crosses IPC as the typed `IpcError` variant from §4 — never as a free-form string, so the UI never parses messages.

User-facing strings come from the creative brief's Copy Guidelines: what happened plus how to fix it, no internal codes, never blaming the user.

---

## 9. Testing strategy

| Layer | Approach |
|---|---|
| `core/` | Vitest. Five translated Swift suites are the port contract (§6.2). |
| Rust — secrets | Integration test: `set_password` → **restart the process** → `get_password`. Non-negotiable; see §11. |
| Rust — postgres/ssh | Integration tests against a container-backed Postgres. |
| Installer | bats, adapted from `termul`'s 388-line suite. |
| Cross-platform | WebKitGTK (Linux) is checked explicitly for every new component, not assumed from macOS/Windows results. |

---

## 10. Known gaps

- **Dark mode is undefined.** Multi-theme support is an explicit later extension of the brand-design skill. Until refined in, the app ships light-only on all three platforms. SwiftUI inherited some of this free from system appearance; a webview does not. Windows and Linux users will notice.
- **SP-4b needs further decomposition** — now enumerated as ten clusters in §12.1, each requiring its own spec before implementation.
- **No data migration path exists.** Connection profiles, saved queries, query history, and tab state live in SwiftData in the old app and rusqlite in the new one. Nothing in this plan carries that data across. Either SP-2 gains an importer or the release notes state plainly that existing data does not transfer — decided before SP-6, not at archive time. Tracked as a checklist item in §13.1.
- **Nothing ships to users until near the end**, a consequence of D6. Accepted as a scheduling cost.

---

## 11. Carried-forward hazards

**keyring backend selection is a compile-time decision, and failure is silent.** Without an OS-backend cargo feature, `keyring` falls back to an in-memory mock: `set_password` reports success and `get_password` always returns `NoEntry`, so credentials never persist. This is the exact subsystem replacing `KeychainService`, and it stores SSH private keys and database passwords.

```toml
[target.'cfg(target_os = "windows")'.dependencies]
keyring = { version = "3.6", features = ["windows-native"] }

[target.'cfg(target_os = "macos")'.dependencies]
keyring = { version = "3.6", features = ["apple-native"] }

[target.'cfg(target_os = "linux")'.dependencies]
keyring = { version = "3.6", features = ["sync-secret-service", "crypto-rust"] }
```

The §9 restart-round-trip test exists to make a regression here visible in CI rather than in a user's lost credentials.

**The SSH key model ports unchanged and should not be redesigned.** Today: the user picks a key file through a native dialog, the *contents* are read once and stored in the OS credential store, and the filesystem is never touched again on reconnect. That is why the sandboxed macOS app needs no security-scoped bookmarks. In Tauri the same shape holds — `tauri-plugin-dialog` replaces `NSOpenPanel`, `keyring` replaces Keychain — and it works identically on Windows and Linux, which have no sandbox at all.

---

## 12. Parity inventory — the SP-6 gate

**Why this section exists.** §5 described SP-4b as "connection form, sidebar, results grid, query editor" and sized it at ~8,200 LOC. The arithmetic was right — `Views/` totals 8,974 and SP-4a takes 767 — so nothing looked wrong. But those four names were *illustrations*, not an inventory, and ten of the Swift app's fifteen screens appeared nowhere in this document. Arithmetic consistency is not feature coverage.

Without the table below, this failure mode is available and silent: SP-4b ships the four named screens, every test passes, SP-5 releases, SP-6 archives the Swift repo — and saved queries, query history, the tab bar, CSV export, and row editing are buried with it. Nothing errors. Nothing fails.

### 12.1 UI surface — every file in `Views/`, assigned

| Cluster | Files | LOC | Sub-project |
|---|---:|---:|---|
| Visual query cards | 7 | 767 | **SP-4a** |
| Visual canvas container (`VisualQueryCanvasView`) | 1 | 281 | **SP-4a** — see §12.3 |
| App shell (`MainSplitView`, `RootView`, split/loading/badge/toast primitives) | 7 | 709 | SP-4b |
| Connection (form, list, dropdown, database picker, status banner) | 5 | 1,464 | SP-4b |
| Sidebar, saved queries, folders (rows, move/edit sheets, schema picker) | 8 | 1,544 | SP-4b |
| Results grid and row editing (`RowEditorView`, results component, toolbar, JSON viewer, modals) | 7 | 1,374 | SP-4b |
| Table browser (list, rows, schema groups, export sheet, DDL sheet, context menus) | 6 | 1,164 | SP-4b |
| Query editor (syntax highlighting, line numbers, editor component) | 4 | 937 | SP-4b |
| Query history | 1 | 232 | SP-4b |
| Tab bar | 1 | 170 | SP-4b |
| Database management (`CreateDatabaseView`) | 1 | 102 | SP-4b |
| Static pages (help, keyboard shortcuts, welcome, settings) | 4 | 230 | SP-4b |
| **Total** | **52** | **8,974** | |

SP-4a = 1,048 LOC of views. SP-4b = 7,926 LOC across **ten clusters**, each of which should become its own spec.

### 12.2 Capabilities with no screen of their own

These live in services and utilities and are easy to lose because no view names them:

| Capability | Swift source | Destination |
|---|---|---|
| CSV export | `CSVExporter` + `TableExportSheet` | SP-3 + SP-4b (table browser) |
| Multi-statement queries | `SQLStatementSplitter` | SP-3 |
| Query type detection | `QueryTypeDetector` | SP-3 |
| Result-grid editability | `QueryEditability`, `RowOperationsService` | SP-3 + SP-4b (results grid) |
| Create / delete database | `DatabaseManagementService` | SP-2 + SP-4b |
| Connection string parsing | `ConnectionStringParser` | SP-3 |
| Large-result compaction | `TableBrowseResultCompactor` | SP-3 |
| Query history persistence | `QueryHistory` model + SwiftData | SP-2 (rusqlite) + SP-4b |
| Saved queries and folders | `SavedQuery`, `QueryFolder` | SP-2 + SP-4b |
| Tab state persistence | `TabState`, `TabManager`, `TabService` | SP-2 + SP-3 |
| SSL modes | `SSLMode` | SP-2 |
| Keyboard shortcuts | `KeyboardShortcutsView` | SP-4b |

### 12.3 Correction to SP-4a's scope

§7.2 lists the seven files in `Views/Components/VisualQuery/`. It omits `Views/Containers/Content/VisualQueryCanvasView.swift` (281 LOC) — the container that assembles those cards into a canvas. SP-4a cannot render anything without it.

**SP-4a's scope is 1,048 LOC of views, not 767**, plus the 176 LOC of `VisualQueryCopy.swift`. Roughly 1,220 LOC in total. This does not change SP-4a's sequencing or its exit criteria.

---

## 13. SP-6 — Swift freeze rule and parity gate

This is a written commitment, not an intention. Option D2 collapses into "two apps forever" if any roadmap work lands in Swift.

> **The `rfxlamia/dragondb-swift` Swift application accepts bug fixes only.**
> No roadmap phase — Phase 2 through Phase 6 — may be implemented against it.
> Any feature request for the Swift app is either declined or redirected to the Tauri build.
> Once the Tauri build has shipped and **passed the parity gate below**, the repository is **archived on GitHub** and its README points to `rfxlamia/dragondb`.

### 13.1 Parity gate — archiving is blocked until this passes

"Proven stable on macOS" was the original wording and it is not a criterion — nothing can fail it. Replace it with the following, which can:

Every row of §12.1 and §12.2 must be either **shipped** in the Tauri build, or **explicitly dropped** with the decision recorded here and the reason stated. Silence is not a valid state for any row.

Dropping a capability is a legitimate outcome — `HelpView` and `WelcomeView` may not be worth porting, and a keyboard-shortcuts sheet means something different in a webview. What is not legitimate is discovering after the archive that something was never carried over.

```text
[ ] Every §12.1 cluster: shipped, or dropped with a recorded reason
[ ] Every §12.2 capability: shipped, or dropped with a recorded reason
[ ] A user with an existing Swift install can reach their saved queries,
    query history, and connection profiles in the Tauri build — or has been
    told in the release notes that they cannot, before the archive
[ ] The Swift repo's README points at rfxlamia/dragondb
```

The third item is the one most likely to be skipped. Connection profiles, saved queries, query history, and tab state live in **SwiftData** in the old app and **rusqlite** in the new one. Nothing in this plan migrates that data. Either SP-2 gains an importer, or the release notes say plainly that existing data does not carry over. Deciding that at archive time is too late — a user who upgrades and loses their saved queries has no recourse once the old repo is archived.

Recorded in that repo's `README.md` and `AGENTS.md` when SP-6 executes.

Because the two applications live in separate repositories (§3.0), this rule is largely self-enforcing: roadmap work physically cannot land in the Swift codebase by accident. The written rule covers the remaining case — a deliberate decision to "just add this one thing" to the app that still has users.
