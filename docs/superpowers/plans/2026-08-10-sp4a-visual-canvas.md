# SP-4a Visual Query Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Tauri-React greet scaffold with a production visual-query canvas that ports Swift block-card behaviour against real `src/core/` and a mocked `DragonIpc`.

**Architecture:** Swift file-boundary mirror under `src/ui/visual-query/`. `App.tsx` owns mock IPC wiring (fixture `ConnectionId`, table/column loads) and mounts the canvas full-window. Component-local `QueryDocument` plus an explicit **revision counter** so in-place mutators still re-render. No `src/stores/`. Live SQL preview uses `generateSQL(doc)?.display ?? "—"`. Validation help uses a status strip (`canRun` messages as-is); no Run button.

**Tech Stack:** Tauri v2, React 19, TypeScript, Bun, Vitest (+ jsdom + Testing Library for UI), Biome, CSS custom properties from the creative brief, `@fontsource/inter` + `@fontsource/jetbrains-mono` for local fonts.

**Spec:** `docs/superpowers/specs/2026-08-10-sp4a-visual-canvas-design.md`  
**Swift reference:** `~/project/dragondb-swift`

## Global Constraints

- Conversation/UI/docs/code English for product strings; follow creative brief copy tone.
- Light-only; no dark mode.
- `src/core/` must stay free of DOM / Tauri / `ui` / `stores` / `ipc` (tsconfig.core + Biome + `tests/architecture/core-boundary.test.ts`).
- No `src/stores/` in this plan.
- Do not call `runQuery` from UI; do not add Run chrome.
- CREATE is in scope; UPDATE/DELETE are Coming soon selectable states.
- Mirror Swift file boundaries (scheduled tech debt — do not regroup into idiomatic React).
- Scaffold purge is a hard exit: zero greet/demo leftovers — includes `src/`, `index.html`, `public/`, and Rust `greet`.
- Package manager: Bun (`bun add`, `bun run check`).
- Manual verify on macOS + Linux after Task 10 (checklist in spec §11.2); not automated in CI. Sign-off artifact required (Task 11).
- **QueryDocument reactivity:** mutators update the instance in place. Every canvas mutation must bump a React revision (`setRevision(r => r + 1)` or equivalent) after the mutator returns so DOM/preview re-render. Tests must prove choosing a statement, typing a field, and Start over update the DOM without remounting a new `QueryDocument` instance.
- **Committed-FROM invalidation:** expose `QueryDocument.committedFromTable` getter; canvas mutations go through one wrapper that compares committed FROM before/after and calls `onCommittedFromChange` on any change (commit, popover select, delete FROM, start over). Typing via `setFromTableText` must **not** notify.
- **Types:** reuse core `TableReference` in helpers/callbacks; convert to IPC `TableRef` only at the `listColumns` call site.
- **Git hygiene:** before each commit step, `git status` must show only the files for that task (or untracked noise the worker explicitly leaves alone). Stage with **explicit pathspecs only** — never `git add -A`. If the worktree has unrelated dirty files, stop and ask; do not scoop them up.

## Deferred work (do not implement in this plan)

- Idiomatic React regroup of mirrored Swift modules (spec §9 tech debt).
- Brief-pattern rewrite of `canRun` help strings.
- Run button / create-confirm execute / three-pane shell (SP-4b).
- Real IPC (SP-3), Rust I/O (SP-2).
- WebKitGTK CI job.

---

## File structure (create / modify)

| Path | Responsibility |
|---|---|
| `src/ipc/contract.ts` | `DragonIpc` types from parent §4; import `ExecutableSQL` from `../core` |
| `src/ipc/mock.ts` | Fixture `DragonIpc` with happy / empty / error modes |
| `src/ipc/table-ref.ts` | Helpers: `TableRef` ↔ core `TableReference`, display name (`public` bare) |
| `src/ui/visual-query/copy.ts` | Port `VisualQueryCopy` + empty-canvas / No matches / preview labels |
| `src/ui/visual-query/accessibility.ts` | `data-testid` constants from `VisualQueryAccessibility` |
| `src/ui/tokens.css` | `:root` brief tokens + focus ring + radius |
| `src/ui/fonts.css` | `@fontsource` imports / `@font-face` wiring |
| `src/ui/visual-query/schema-field-popover.tsx` | Search + list popover |
| `src/ui/visual-query/statement-picker.tsx` | Statement menu |
| `src/ui/visual-query/toolbar.tsx` | Start over only (no Run) |
| `src/ui/visual-query/generated-sql-preview.tsx` | Always-on SQL preview + Copy |
| `src/ui/visual-query/clause-card-fields.tsx` | Field editors per clause |
| `src/ui/visual-query/clause-card.tsx` | Clause card chrome |
| `src/ui/visual-query/statement-root-card.tsx` | CREATE / Coming-soon roots |
| `src/ui/visual-query/canvas.tsx` | Assembles chain, status strips, pickers |
| `src/ui/visual-query/visual-query.css` | Canvas/card layout using tokens |
| `src/App.tsx` | Mock wiring + mount canvas; optional `ipc` prop for tests |
| `src/App.css` | Delete scaffold; re-export or replace with tokens |
| `index.html` | Title `DragonDB`; favicon `/favicon.svg` |
| `public/favicon.svg` | Production favicon (not vite/tauri/react logos) |
| `src/main.tsx` | Import fonts + tokens |
| `src-tauri/src/lib.rs` | Remove `greet` |
| `tests/ipc/mock.test.ts` | Mock fixture modes |
| `tests/ui/visual-query/copy.test.ts` | Ported copy tests |
| `tests/ui/visual-query/accessibility.test.ts` | Unique + Swift-parity ids |
| `tests/ui/visual-query/*.test.tsx` | Component tests (jsdom) |
| `tests/ui/scaffold-purge.test.ts` | Hard exit gate for scaffold leftovers |
| `tests/ui/app-wiring.test.tsx` | Tables/columns/error/stale/`runQuery` ban |
| `tests/core/query-document-committed-from.test.ts` | `committedFromTable` getter |
| `docs/superpowers/plans/2026-08-10-sp4a-manual-verify-log.md` | Mac/Linux sign-off |
| `vitest.config.ts` | Allow `.tsx` tests; keep default node, per-file jsdom |
| `package.json` | Add fontsource + testing-library + jsdom |

**Amendment (validation review):** QueryDocument revision counter + `committedFromTable` invalidation; full TDD for Tasks 6–10; scaffold purge covers `index.html`/`public/`; explicit git pathspecs; clipboard + stale column-load tests; manual verify sign-off log.

---

### Task 1: IPC contract + mock fixtures

**Files:**
- Create: `src/ipc/contract.ts`
- Create: `src/ipc/table-ref.ts`
- Create: `src/ipc/mock.ts`
- Test: `tests/ipc/mock.test.ts`

**Interfaces:**
- Consumes: `ExecutableSQL` from `src/core` (type-only)
- Produces:
  - `export type ConnectionId = string;`
  - `export interface TableRef { schema?: string; name: string; }`
  - `export interface ColumnInfo { name: string; dataType: string; isNullable: boolean; defaultValue: string | null; isPrimaryKey: boolean; isUnique: boolean; isForeignKey: boolean; }`
  - `export interface QueryResult { columns: string[]; rows: unknown[][]; rowsAffected: number | null; durationMs: number; }`
  - `export type IpcError = { kind: "connection"; message: string } | { kind: "auth"; message: string } | { kind: "syntax"; message: string; position: number | null } | { kind: "permission"; message: string } | { kind: "unknown"; message: string };`
  - `export interface DragonIpc { listTables(c: ConnectionId): Promise<TableRef[]>; listColumns(c: ConnectionId, table: TableRef): Promise<ColumnInfo[]>; runQuery(c: ConnectionId, sql: ExecutableSQL): Promise<QueryResult>; }`
  - `export const FIXTURE_CONNECTION_ID: ConnectionId = "fixture";`
  - `export type MockMode = "happy" | "emptyTables" | "emptyColumns" | "columnsError";`
  - `export function createMockDragonIpc(mode?: MockMode): DragonIpc;`
  - `export function tableRefToCore(ref: TableRef): TableReference;` — import type from `../core`
  - `export function coreToTableRef(ref: TableReference): TableRef;`
  - `export function formatTableDisplayName(ref: TableReference): string;` — bare name when schema is null or `"public"`
  - `export function sameTable(a: TableReference | null, b: TableReference | null): boolean;`

- [ ] **Step 1: Write the failing mock test**

```ts
// tests/ipc/mock.test.ts
import { describe, expect, it } from "vitest";
import { FIXTURE_CONNECTION_ID, createMockDragonIpc } from "../../src/ipc/mock";
import { coreToTableRef, formatTableDisplayName, tableRefToCore } from "../../src/ipc/table-ref";

describe("mock DragonIpc", () => {
  it("happy path lists public + non-public schema tables", async () => {
    const ipc = createMockDragonIpc("happy");
    const tables = await ipc.listTables(FIXTURE_CONNECTION_ID);
    expect(tables.some((t) => t.name === "users" && (t.schema === undefined || t.schema === "public"))).toBe(
      true,
    );
    expect(tables.some((t) => t.schema === "analytics" && t.name === "events")).toBe(true);
  });

  it("happy path returns columns for users", async () => {
    const ipc = createMockDragonIpc("happy");
    const cols = await ipc.listColumns(FIXTURE_CONNECTION_ID, { name: "users", schema: "public" });
    expect(cols.map((c) => c.name)).toEqual(
      expect.arrayContaining(["id", "name", "email", "created_at"]),
    );
  });

  it("emptyTables returns []", async () => {
    const ipc = createMockDragonIpc("emptyTables");
    expect(await ipc.listTables(FIXTURE_CONNECTION_ID)).toEqual([]);
  });

  it("emptyColumns returns []", async () => {
    const ipc = createMockDragonIpc("emptyColumns");
    expect(await ipc.listColumns(FIXTURE_CONNECTION_ID, { name: "users" })).toEqual([]);
  });

  it("columnsError rejects", async () => {
    const ipc = createMockDragonIpc("columnsError");
    await expect(ipc.listColumns(FIXTURE_CONNECTION_ID, { name: "users" })).rejects.toBeTruthy();
  });

  it("runQuery is present but unused by UI — returns empty result", async () => {
    const ipc = createMockDragonIpc("happy");
    const result = await ipc.runQuery(FIXTURE_CONNECTION_ID, { text: "SELECT 1", params: [] });
    expect(result.columns).toEqual([]);
    expect(result.rows).toEqual([]);
  });
});

describe("table ref helpers", () => {
  it("maps optional schema to TableReference", () => {
    expect(tableRefToCore({ name: "users" })).toEqual({ schema: null, name: "users" });
    expect(tableRefToCore({ schema: "analytics", name: "events" })).toEqual({
      schema: "analytics",
      name: "events",
    });
  });

  it("round-trips TableReference to TableRef", () => {
    expect(coreToTableRef({ schema: null, name: "users" })).toEqual({ name: "users" });
    expect(coreToTableRef({ schema: "analytics", name: "events" })).toEqual({
      schema: "analytics",
      name: "events",
    });
  });

  it("formats display names like Swift", () => {
    expect(formatTableDisplayName({ schema: null, name: "users" })).toBe("users");
    expect(formatTableDisplayName({ schema: "public", name: "users" })).toBe("users");
    expect(formatTableDisplayName({ schema: "analytics", name: "events" })).toBe("analytics.events");
  });
});
```

Update the test import line to also pull `coreToTableRef` from `../../src/ipc/table-ref`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/ipc/mock.test.ts`  
Expected: FAIL — module not found.

- [ ] **Step 3: Implement contract, helpers, and mock**

Put types in `src/ipc/contract.ts` exactly as parent §4 (import type `{ ExecutableSQL }` from `../core`).

Put `tableRefToCore` / `formatTableDisplayName` in `src/ipc/table-ref.ts` and re-export from `mock.ts` for the test import path above **or** change the test to import helpers from `table-ref.ts` and keep `createMockDragonIpc` in `mock.ts`. Prefer:

```ts
// tests import:
import { FIXTURE_CONNECTION_ID, createMockDragonIpc } from "../../src/ipc/mock";
import { coreToTableRef, formatTableDisplayName, tableRefToCore } from "../../src/ipc/table-ref";
```

Update the test imports accordingly when implementing.

Happy fixture must include:
- `{ schema: "public", name: "users" }` with columns id/name/email/created_at (types arbitrary but complete `ColumnInfo` fields)
- `{ schema: "analytics", name: "events" }` with at least one column

`columnsError`: `listColumns` rejects with `Error("columns failed")` (App maps message to Swift copy later).

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test tests/ipc/mock.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ipc tests/ipc
git commit -m "$(cat <<'EOF'
feat(ipc): add DragonIpc contract and fixture mock

Give SP-4a a typed mock schema surface with happy/empty/error modes before UI work.
EOF
)"
```

---

### Task 2: Copy + accessibility modules

**Files:**
- Create: `src/ui/visual-query/copy.ts`
- Create: `src/ui/visual-query/accessibility.ts`
- Test: `tests/ui/visual-query/copy.test.ts`
- Test: `tests/ui/visual-query/accessibility.test.ts`

**Interfaces:**
- Consumes: `ClauseKind`, `StatementKind`, `WhereOperator`, `OrderDirection`, `CreateColumnType`, `QueryDocument` from `src/core`
- Produces: `VisualQueryCopy` namespace/object mirroring Swift `VisualQueryCopy` + extras below; `VisualQueryA11y` (or `VisualQueryAccessibility`) with string constants and helpers from Swift

Extra copy keys (spec):
- `emptyCanvasTitle = "Build a query visually"`
- `emptyCanvasBody = "Add a block to start. Each + adds one clause — never a full chain at once."`
- `noMatchesTitle = "No matches"`
- `sqlPreviewEmpty = "—"`
- `columnsLoadError = "Could not load columns. You can still type a name."`

- [ ] **Step 1: Write failing copy + accessibility tests**

Port `DragonDBTests/VisualQueryClauseCopyTests.swift` assertions into Vitest. Add:

```ts
expect(VisualQueryCopy.emptyCanvasTitle).toBe("Build a query visually");
expect(VisualQueryCopy.noMatchesTitle).toBe("No matches");
expect(VisualQueryCopy.columnsLoadError).toContain("Could not load columns");
```

Accessibility test — uniqueness **and** parity with Swift's expected static ids:

```ts
import { VisualQueryAccessibility } from "../../../src/ui/visual-query/accessibility";

const EXPECTED_STATICS = [
  "visualQuery.modeToggle",
  "visualQuery.initialAddBlock",
  "visualQuery.trailingAddBlock",
  "visualQuery.statementMenu",
  "visualQuery.clauseMenu",
  "visualQuery.startOver",
  "visualQuery.runQuery",
  "visualQuery.viewGeneratedSQL",
  "visualQuery.generatedSQLText",
  "visualQuery.copySQL",
  "visualQuery.generatedSQLDone",
  "visualQuery.allColumnsToggle",
  "visualQuery.selectColumnsField",
  "visualQuery.selectColumnsPicker",
  "visualQuery.fromTableField",
  "visualQuery.fromTablePicker",
  "visualQuery.whereColumnField",
  "visualQuery.whereColumnPicker",
  "visualQuery.whereOperatorField",
  "visualQuery.whereValueField",
  "visualQuery.orderByColumnField",
  "visualQuery.orderByColumnPicker",
  "visualQuery.orderByDirectionField",
  "visualQuery.limitField",
  "visualQuery.createTableNameField",
  "visualQuery.createColumnsList",
  "visualQuery.addCreateColumn",
  "visualQuery.schemaPopoverSearch",
  "visualQuery.schemaPopoverList",
  "visualQuery.confirmCreateContinue",
  "visualQuery.confirmCreateCancel",
] as const;

it("static identifiers match Swift VisualQueryAccessibility", () => {
  for (const id of EXPECTED_STATICS) {
    expect(VisualQueryAccessibility.allInteractiveIdentifiers).toContain(id);
  }
  expect(VisualQueryAccessibility.modeToggle).toBe("visualQuery.modeToggle");
  expect(VisualQueryAccessibility.clauseCard("orderBy")).toBe("visualQuery.clauseCard.orderBy");
  expect(VisualQueryAccessibility.statementMenuItem("createTable")).toBe(
    "visualQuery.statementMenu.createTable",
  );
});

it("interactive identifiers are unique", () => {
  const ids = VisualQueryAccessibility.allInteractiveIdentifiers;
  expect(new Set(ids).size).toBe(ids.length);
});
```

Port `allInteractiveIdentifiers` logic from Swift (include runQuery / modeToggle / confirm ids even if unused in SP-4a UI).

- [ ] **Step 2: Run tests — expect FAIL**

Run: `bun run test tests/ui/visual-query/copy.test.ts tests/ui/visual-query/accessibility.test.ts`

- [ ] **Step 3: Implement `copy.ts` and `accessibility.ts`**

Port verbatim strings from:
- `~/project/dragondb-swift/DragonDB/Logic/VisualQueryCopy.swift`
- `~/project/dragondb-swift/DragonDB/Utilities/VisualQueryAccessibility.swift`

`nextClauseOptions(doc)` → `doc.availableNextClauses()`.  
`clauseMenuItems(doc)` maps those to `{ kind, title, helper }`.  
`statementMenuItems()` exact runnable/badge behaviour from Swift.

Use `data-testid` values equal to the Swift accessibility identifier strings.

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/ui/visual-query/copy.ts src/ui/visual-query/accessibility.ts tests/ui/visual-query/copy.test.ts tests/ui/visual-query/accessibility.test.ts
git commit -m "$(cat <<'EOF'
feat(ui): port visual query copy and accessibility ids

Lock chrome strings and data-testid constants to the Swift reference before components.
EOF
)"
```

---

### Task 3: Design tokens, fonts, and UI test harness

**Files:**
- Create: `src/ui/tokens.css`
- Create: `src/ui/fonts.css`
- Modify: `src/main.tsx` (import fonts + tokens)
- Modify: `package.json` / lockfile via bun
- Modify: `vitest.config.ts` — `include: ['tests/**/*.{test.ts,test.tsx}']`
- Modify: `tsconfig.json` if needed for jsx in tests (already has `jsx: react-jsx` and includes `tests`)

**Interfaces:**
- Consumes: creative brief OKLCH values
- Produces: CSS variables on `:root` named `--primary-100` … `--primary-900`, `--neutral-100` … `--neutral-900`, `--success-tint`, `--success-solid`, `--success-text`, same for warning/error/info, `--radius: 4px`, focus utility class `.focus-ring` matching brief

- [ ] **Step 1: Add dependencies**

```bash
bun add @fontsource/inter @fontsource/jetbrains-mono
bun add -d @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom @types/jsdom
```

- [ ] **Step 2: Write a tiny tokens presence test (node, read file)**

```ts
// tests/ui/tokens.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("tokens.css", () => {
  const css = readFileSync(join(process.cwd(), "src/ui/tokens.css"), "utf8");

  it("defines full primary / neutral / semantic sets from the brief", () => {
    for (const shade of [100, 200, 300, 400, 500, 600, 700, 800, 900]) {
      expect(css).toContain(`--primary-${shade}`);
      expect(css).toContain(`--neutral-${shade}`);
    }
    for (const role of ["success", "warning", "error", "info"]) {
      expect(css).toContain(`--${role}-tint`);
      expect(css).toContain(`--${role}-solid`);
      expect(css).toContain(`--${role}-text`);
    }
    expect(css).toMatch(/--radius:\s*4px/);
    expect(css).toContain("oklch(0.55 0.123 245)"); // primary-600
    expect(css).toMatch(/:focus-visible/);
    expect(css).toContain("outline-offset: 2px");
  });
});

describe("fonts.css", () => {
  const css = readFileSync(join(process.cwd(), "src/ui/fonts.css"), "utf8");
  it("loads Inter and JetBrains Mono locally (no CDN)", () => {
    expect(css).toMatch(/@fontsource\/inter/);
    expect(css).toMatch(/@fontsource\/jetbrains-mono/);
    expect(css).not.toMatch(/fonts\.googleapis|cdn\.jsdelivr|unpkg\.com/i);
  });
});
```

Run — expect FAIL.

- [ ] **Step 3: Implement `tokens.css` and `fonts.css`**

Copy OKLCH values verbatim from `docs/pocket/rule/creative-brief.md`. Include:

```css
:root {
  /* …all primary/neutral/semantic tokens… */
  --radius: 4px;
  --font-sans: "Inter", -apple-system, "Segoe UI Variable Text", "Segoe UI", system-ui, "Cantarell",
    "Ubuntu", sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, "Cascadia Mono", "Liberation Mono",
    monospace;
}

:focus-visible {
  outline: 2px solid var(--primary-600);
  outline-offset: 2px;
}
```

`fonts.css`:

```css
@import "@fontsource/inter/400.css";
@import "@fontsource/inter/500.css";
@import "@fontsource/inter/600.css";
@import "@fontsource/jetbrains-mono/400.css";
@import "@fontsource/jetbrains-mono/500.css";
```

Update `main.tsx`:

```tsx
import "./ui/fonts.css";
import "./ui/tokens.css";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// …
```

Update `vitest.config.ts` include for `test.tsx`.

Add `tests/setup.ts` for jest-dom if using Testing Library matchers:

```ts
import "@testing-library/jest-dom/vitest";
```

Wire in vitest config `setupFiles: ["./tests/setup.ts"]`.

- [ ] **Step 4: Run `bun run test tests/ui/tokens.test.ts` — PASS; `bun run check` still green for core**

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lock src/ui/tokens.css src/ui/fonts.css src/main.tsx vitest.config.ts tests/ui/tokens.test.ts tests/setup.ts
git commit -m "$(cat <<'EOF'
feat(ui): add creative-brief tokens and bundled fonts

Establish light-only OKLCH tokens and local Inter/JetBrains Mono before canvas components.
EOF
)"
```

---

### Task 4: SchemaFieldPopover

**Files:**
- Create: `src/ui/visual-query/schema-field-popover.tsx`
- Create: `src/ui/visual-query/visual-query.css` (shared card/popover styles started here)
- Test: `tests/ui/visual-query/schema-field-popover.test.tsx`

**Interfaces:**
- Consumes: `VisualQueryCopy.noMatchesTitle`, `VisualQueryAccessibility.schemaPopover*`
- Produces:

```tsx
export type SchemaFieldPopoverProps<T> = {
  title: string;
  items: T[];
  itemTitle: (item: T) => string;
  needsFromMessage?: string | null;
  errorMessage?: string | null;
  onSelect: (item: T) => void;
};

export function SchemaFieldPopover<T>(props: SchemaFieldPopoverProps<T>): JSX.Element;

export function schemaPopoverEmptyStateMessage(args: {
  itemsAreEmpty: boolean;
  needsFromMessage?: string | null;
  errorMessage?: string | null;
}): string | null;
// Mirror Swift: if items empty → needsFromMessage ?? errorMessage; else null
```

- [ ] **Step 1: Write failing tests** (`/** @vitest-environment jsdom */` at top of file)

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SchemaFieldPopover } from "../../../src/ui/visual-query/schema-field-popover";
import { VisualQueryCopy } from "../../../src/ui/visual-query/copy";

describe("SchemaFieldPopover", () => {
  it("shows needsFrom message when items empty", () => {
    render(
      <SchemaFieldPopover
        title="Columns"
        items={[]}
        itemTitle={(s) => s}
        needsFromMessage={VisualQueryCopy.columnPopoverNeedsFromMessage}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText(/from first/i)).toBeInTheDocument();
  });

  it("shows No matches when filter excludes all", async () => {
    const user = userEvent.setup();
    render(
      <SchemaFieldPopover title="Tables" items={["users"]} itemTitle={(s) => s} onSelect={() => {}} />,
    );
    await user.type(screen.getByRole("textbox"), "zzz");
    expect(screen.getByText(VisualQueryCopy.noMatchesTitle)).toBeInTheDocument();
  });

  it("calls onSelect", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <SchemaFieldPopover title="Tables" items={["users"]} itemTitle={(s) => s} onSelect={onSelect} />,
    );
    await user.click(screen.getByRole("button", { name: "users" }));
    expect(onSelect).toHaveBeenCalledWith("users");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement popover** — port behaviour from `SchemaFieldPopover.swift` (search filter case-insensitive; empty state helper; list `data-testid`s). Style with tokens (`background: var(--neutral-100)`, border `var(--neutral-300)`, radius `var(--radius)`).

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add src/ui/visual-query/schema-field-popover.tsx src/ui/visual-query/visual-query.css tests/ui/visual-query/schema-field-popover.test.tsx
git commit -m "$(cat <<'EOF'
feat(ui): add schema field popover

Port searchable schema/table/column picker shell used by FROM and column fields.
EOF
)"
```

---

### Task 5: Statement picker + toolbar

**Files:**
- Create: `src/ui/visual-query/statement-picker.tsx`
- Create: `src/ui/visual-query/toolbar.tsx`
- Test: `tests/ui/visual-query/statement-picker.test.tsx`
- Test: `tests/ui/visual-query/toolbar.test.tsx`

**Interfaces:**

```tsx
// statement-picker.tsx
export function StatementPicker(props: {
  onChoose: (kind: StatementKind) => void;
}): JSX.Element;
// Renders VisualQueryCopy.statementMenuItems(); Coming soon badge on update/delete
// data-testid: statementMenu, statementMenuItem(kind)

// toolbar.tsx
export function VisualQueryToolbar(props: {
  canStartOver: boolean;
  onStartOver: () => void;
}): JSX.Element;
// ONLY Start over control — no Run, no View generated SQL link (live preview is separate)
// data-testid: startOver
```

- [ ] **Step 1: Failing tests**

Statement picker: four items; UPDATE/DELETE show `/coming soon/i`; clicking SELECT calls `onChoose("select")`; CREATE calls `onChoose("createTable")`.

Toolbar: Start over button disabled or hidden when `canStartOver === false`; calls `onStartOver` when enabled. Assert **no** button named `/run query/i`.

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement** from `VisualStatementPickerView.swift` + `VisualQueryToolbar.swift` (strip Run / View SQL / isRunning props).

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git status
git add src/ui/visual-query/statement-picker.tsx src/ui/visual-query/toolbar.tsx tests/ui/visual-query/statement-picker.test.tsx tests/ui/visual-query/toolbar.test.tsx
git commit -m "$(cat <<'EOF'
feat(ui): add statement picker and start-over toolbar

Port statement menu including CREATE and Coming soon entries; omit Run chrome.
EOF
)"
```

---

### Task 6: Generated SQL preview

**Files:**
- Create: `src/ui/visual-query/generated-sql-preview.tsx`
- Test: `tests/ui/visual-query/generated-sql-preview.test.tsx`

**Interfaces:**

```tsx
export function GeneratedSQLPreview(props: {
  sql: string; // already null-coalesced by parent to "—" when needed
}): JSX.Element;
// read-only <pre data-testid={generatedSQLText}>
// Copy button data-testid={copySQL}; label VisualQueryCopy.copySQLTitle
// onClick: try { await navigator.clipboard.writeText(sql) } catch { /* ignore — no toast in SP-4a */ }
```

- [ ] **Step 1: Write the failing tests** (`/** @vitest-environment jsdom */`)

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { GeneratedSQLPreview } from "../../../src/ui/visual-query/generated-sql-preview";
import { VisualQueryAccessibility } from "../../../src/ui/visual-query/accessibility";
import { VisualQueryCopy } from "../../../src/ui/visual-query/copy";

describe("GeneratedSQLPreview", () => {
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    writeText.mockClear();
  });

  afterEach(() => {
    // leave clipboard stub; next test redefines
  });

  it("renders sql text", () => {
    render(<GeneratedSQLPreview sql={'SELECT * FROM "users"'} />);
    expect(screen.getByTestId(VisualQueryAccessibility.generatedSQLText)).toHaveTextContent(
      'SELECT * FROM "users"',
    );
  });

  it("renders em dash placeholder", () => {
    render(<GeneratedSQLPreview sql={VisualQueryCopy.sqlPreviewEmpty} />);
    expect(screen.getByTestId(VisualQueryAccessibility.generatedSQLText)).toHaveTextContent("—");
  });

  it("Copy calls navigator.clipboard.writeText with the sql", async () => {
    const user = userEvent.setup();
    render(<GeneratedSQLPreview sql={'SELECT 1'} />);
    await user.click(screen.getByTestId(VisualQueryAccessibility.copySQL));
    expect(writeText).toHaveBeenCalledWith("SELECT 1");
  });

  it("Copy still succeeds in UI when clipboard rejects", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    const user = userEvent.setup();
    render(<GeneratedSQLPreview sql={'SELECT 1'} />);
    await user.click(screen.getByTestId(VisualQueryAccessibility.copySQL));
    expect(screen.getByTestId(VisualQueryAccessibility.generatedSQLText)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/ui/visual-query/generated-sql-preview.test.tsx`  
Expected: FAIL — module not found / component missing.

- [ ] **Step 3: Write minimal implementation**

Port chrome from `GeneratedSQLPreviewView.swift` as an always-on panel (no Done dismiss). Mono font via `var(--font-mono)`. Swallow clipboard errors.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/ui/visual-query/generated-sql-preview.test.tsx`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git status
git add src/ui/visual-query/generated-sql-preview.tsx tests/ui/visual-query/generated-sql-preview.test.tsx
git commit -m "$(cat <<'EOF'
feat(ui): add always-on generated SQL preview

Show display SQL with copy control; parent supplies null-safe placeholder text.
EOF
)"
```

---

### Task 7: Clause card fields + clause card

**Files:**
- Create: `src/ui/visual-query/clause-card-fields.tsx`
- Create: `src/ui/visual-query/clause-card.tsx`
- Test: `tests/ui/visual-query/clause-card.test.tsx`

**Interfaces:**

```tsx
import type {
  ClauseKind,
  OrderDirection,
  QueryDocument,
  WhereOperator,
} from "../../core";
import type { TableRef } from "../../ipc/contract";

export type ClauseCardProps = {
  kind: ClauseKind;
  document: QueryDocument;
  tables: TableRef[];
  columnNames: string[];
  metadataErrorMessage: string | null;
  onDelete: () => void;
  onSetSelectColumns: (columns: string[]) => void;
  onSetFromTableText: (raw: string) => void;
  onCommitFromTable: (raw: string) => void;
  onSelectFromTable: (name: string, schema: string | null) => void;
  onSetWhereCondition: (column: string, op: WhereOperator, value: string | null) => void;
  onSetOrderBy: (column: string, direction: OrderDirection) => void;
  onSetLimitText: (text: string) => void;
};

export function ClauseCard(props: ClauseCardProps): JSX.Element;
```

Wire popovers via `SchemaFieldPopover`. FROM display uses `formatTableDisplayName(tableRefToCore(ref))` or format after converting. Column popovers pass `needsFromMessage` when FROM not set (same predicate as Swift `needsFrom`).

- [ ] **Step 1: Write the failing tests** (`/** @vitest-environment jsdom */`)

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { QueryDocument } from "../../../src/core";
import { ClauseCard } from "../../../src/ui/visual-query/clause-card";
import { VisualQueryAccessibility } from "../../../src/ui/visual-query/accessibility";
import { VisualQueryCopy } from "../../../src/ui/visual-query/copy";

function docWithSelectFrom(): QueryDocument {
  const doc = new QueryDocument();
  doc.chooseStatement("select");
  doc.addClause("from");
  return doc;
}

describe("ClauseCard", () => {
  it("shows clause helper copy", () => {
    const doc = docWithSelectFrom();
    render(
      <ClauseCard
        kind="from"
        document={doc}
        tables={[{ name: "users", schema: "public" }]}
        columnNames={[]}
        metadataErrorMessage={null}
        onDelete={() => {}}
        onSetSelectColumns={() => {}}
        onSetFromTableText={() => {}}
        onCommitFromTable={() => {}}
        onSelectFromTable={() => {}}
        onSetWhereCondition={() => {}}
        onSetOrderBy={() => {}}
        onSetLimitText={() => {}}
      />,
    );
    expect(screen.getByText(VisualQueryCopy.helper("from"))).toBeInTheDocument();
    expect(screen.getByTestId(VisualQueryAccessibility.deleteClause("from"))).toBeInTheDocument();
  });

  it("FROM popover select calls onSelectFromTable", async () => {
    const user = userEvent.setup();
    const onSelectFromTable = vi.fn();
    const doc = docWithSelectFrom();
    render(
      <ClauseCard
        kind="from"
        document={doc}
        tables={[
          { name: "users", schema: "public" },
          { name: "events", schema: "analytics" },
        ]}
        columnNames={[]}
        metadataErrorMessage={null}
        onDelete={() => {}}
        onSetSelectColumns={() => {}}
        onSetFromTableText={() => {}}
        onCommitFromTable={() => {}}
        onSelectFromTable={onSelectFromTable}
        onSetWhereCondition={() => {}}
        onSetOrderBy={() => {}}
        onSetLimitText={() => {}}
      />,
    );
    await user.click(screen.getByTestId(VisualQueryAccessibility.fromTablePicker));
    await user.click(screen.getByRole("button", { name: "analytics.events" }));
    expect(onSelectFromTable).toHaveBeenCalledWith("events", "analytics");
  });

  it("LIMIT typing calls onSetLimitText", async () => {
    const user = userEvent.setup();
    const onSetLimitText = vi.fn();
    const doc = new QueryDocument();
    doc.chooseStatement("select");
    doc.addClause("limit");
    render(
      <ClauseCard
        kind="limit"
        document={doc}
        tables={[]}
        columnNames={[]}
        metadataErrorMessage={null}
        onDelete={() => {}}
        onSetSelectColumns={() => {}}
        onSetFromTableText={() => {}}
        onCommitFromTable={() => {}}
        onSelectFromTable={() => {}}
        onSetWhereCondition={() => {}}
        onSetOrderBy={() => {}}
        onSetLimitText={onSetLimitText}
      />,
    );
    await user.type(screen.getByTestId(VisualQueryAccessibility.limitField), "abc");
    expect(onSetLimitText).toHaveBeenCalled();
    expect(onSetLimitText.mock.calls.at(-1)?.[0]).toContain("abc");
  });

  it("WHERE column popover needs FROM message when from unset", async () => {
    const user = userEvent.setup();
    const doc = new QueryDocument();
    doc.chooseStatement("select");
    doc.addClause("where");
    render(
      <ClauseCard
        kind="where"
        document={doc}
        tables={[]}
        columnNames={[]}
        metadataErrorMessage={null}
        onDelete={() => {}}
        onSetSelectColumns={() => {}}
        onSetFromTableText={() => {}}
        onCommitFromTable={() => {}}
        onSelectFromTable={() => {}}
        onSetWhereCondition={() => {}}
        onSetOrderBy={() => {}}
        onSetLimitText={() => {}}
      />,
    );
    await user.click(screen.getByTestId(VisualQueryAccessibility.whereColumnPicker));
    expect(screen.getByText(VisualQueryCopy.columnPopoverNeedsFromMessage)).toBeInTheDocument();
  });

  it("SELECT all-columns toggle and ORDER BY direction call mutator props", async () => {
    const user = userEvent.setup();
    const onSetSelectColumns = vi.fn();
    const onSetOrderBy = vi.fn();
    const doc = new QueryDocument();
    doc.chooseStatement("select");
    doc.addClause("orderBy");
    const { rerender } = render(
      <ClauseCard
        kind="select"
        document={doc}
        tables={[]}
        columnNames={["id"]}
        metadataErrorMessage={null}
        onDelete={() => {}}
        onSetSelectColumns={onSetSelectColumns}
        onSetFromTableText={() => {}}
        onCommitFromTable={() => {}}
        onSelectFromTable={() => {}}
        onSetWhereCondition={() => {}}
        onSetOrderBy={() => {}}
        onSetLimitText={() => {}}
      />,
    );
    await user.click(screen.getByTestId(VisualQueryAccessibility.allColumnsToggle));
    expect(onSetSelectColumns).toHaveBeenCalled();

    rerender(
      <ClauseCard
        kind="orderBy"
        document={doc}
        tables={[]}
        columnNames={["id"]}
        metadataErrorMessage={null}
        onDelete={() => {}}
        onSetSelectColumns={() => {}}
        onSetFromTableText={() => {}}
        onCommitFromTable={() => {}}
        onSelectFromTable={() => {}}
        onSetWhereCondition={() => {}}
        onSetOrderBy={onSetOrderBy}
        onSetLimitText={() => {}}
      />,
    );
    await user.selectOptions(screen.getByTestId(VisualQueryAccessibility.orderByDirectionField), "desc");
    expect(onSetOrderBy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/ui/visual-query/clause-card.test.tsx`  
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

Port `VisualClauseCardView.swift` + `VisualClauseCardFieldViews.swift`. Operators/directions from core unions only. Do not invent UX.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/ui/visual-query/clause-card.test.tsx`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git status
git add src/ui/visual-query/clause-card-fields.tsx src/ui/visual-query/clause-card.tsx tests/ui/visual-query/clause-card.test.tsx src/ui/visual-query/visual-query.css
git commit -m "$(cat <<'EOF'
feat(ui): port clause cards and field editors

Add SELECT/FROM/WHERE/ORDER BY/LIMIT cards against QueryDocument mutators and schema popovers.
EOF
)"
```

---

### Task 8: Statement root card (CREATE + Coming soon)

**Files:**
- Create: `src/ui/visual-query/statement-root-card.tsx`
- Test: `tests/ui/visual-query/statement-root-card.test.tsx`

**Interfaces:**

```tsx
export function StatementRootCard(props: {
  kind: StatementKind; // createTable | update | delete
  document: QueryDocument;
  onStartOver: () => void;
  onSetCreateTableName: (name: string) => void;
  onSetCreateColumns: (columns: CreateColumn[]) => void;
}): JSX.Element;
```

- [ ] **Step 1: Write the failing tests**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { QueryDocument } from "../../../src/core";
import { StatementRootCard } from "../../../src/ui/visual-query/statement-root-card";
import { VisualQueryAccessibility } from "../../../src/ui/visual-query/accessibility";
import { VisualQueryCopy } from "../../../src/ui/visual-query/copy";

describe("StatementRootCard", () => {
  it("UPDATE shows Coming soon and no create fields", () => {
    const doc = new QueryDocument();
    doc.chooseStatement("update");
    render(
      <StatementRootCard
        kind="update"
        document={doc}
        onStartOver={() => {}}
        onSetCreateTableName={() => {}}
        onSetCreateColumns={() => {}}
      />,
    );
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
    expect(screen.queryByTestId(VisualQueryAccessibility.createTableNameField)).toBeNull();
  });

  it("CREATE table name typing calls onSetCreateTableName", async () => {
    const user = userEvent.setup();
    const onSetCreateTableName = vi.fn();
    const doc = new QueryDocument();
    doc.chooseStatement("createTable");
    render(
      <StatementRootCard
        kind="createTable"
        document={doc}
        onStartOver={() => {}}
        onSetCreateTableName={onSetCreateTableName}
        onSetCreateColumns={() => {}}
      />,
    );
    await user.type(screen.getByTestId(VisualQueryAccessibility.createTableNameField), "orders");
    expect(onSetCreateTableName).toHaveBeenCalled();
    expect(onSetCreateTableName.mock.calls.at(-1)?.[0]).toContain("orders");
  });

  it("CREATE add column calls onSetCreateColumns", async () => {
    const user = userEvent.setup();
    const onSetCreateColumns = vi.fn();
    const doc = new QueryDocument();
    doc.chooseStatement("createTable");
    render(
      <StatementRootCard
        kind="createTable"
        document={doc}
        onStartOver={() => {}}
        onSetCreateTableName={() => {}}
        onSetCreateColumns={onSetCreateColumns}
      />,
    );
    await user.click(screen.getByTestId(VisualQueryAccessibility.addCreateColumn));
    expect(onSetCreateColumns).toHaveBeenCalled();
    const cols = onSetCreateColumns.mock.calls.at(-1)?.[0];
    expect(Array.isArray(cols)).toBe(true);
    expect(cols.length).toBeGreaterThan(0);
    expect(cols[0]).toEqual(expect.objectContaining({ name: expect.any(String), type: expect.any(String) }));
  });

  it("start-over control fires onStartOver", async () => {
    const user = userEvent.setup();
    const onStartOver = vi.fn();
    const doc = new QueryDocument();
    doc.chooseStatement("delete");
    render(
      <StatementRootCard
        kind="delete"
        document={doc}
        onStartOver={onStartOver}
        onSetCreateTableName={() => {}}
        onSetCreateColumns={() => {}}
      />,
    );
    await user.click(screen.getByTestId(VisualQueryAccessibility.deleteStatementRoot("delete")));
    expect(onStartOver).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `bun run test tests/ui/visual-query/statement-root-card.test.tsx`

- [ ] **Step 3: Implement** — port `VisualStatementRootCardView.swift`; type labels via `VisualQueryCopy.createColumnTypeTitle`.

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git status
git add src/ui/visual-query/statement-root-card.tsx tests/ui/visual-query/statement-root-card.test.tsx
git commit -m "$(cat <<'EOF'
feat(ui): port statement root card for CREATE and coming soon

Keep CREATE editable in SP-4a; UPDATE/DELETE show Coming soon chrome only.
EOF
)"
```

---

### Task 9: Canvas container + QueryDocument reactivity

**Files:**
- Modify: `src/core/query-document.ts` — add public `committedFromTable` getter
- Test: `tests/core/query-document-committed-from.test.ts`
- Create: `src/ui/visual-query/canvas.tsx`
- Test: `tests/ui/visual-query/canvas.test.tsx`

**Interfaces:**

```ts
// src/core/query-document.ts — ADD:
get committedFromTable(): Readonly<TableReference> | null {
  return this.#committedFromTable === null ? null : { ...this.#committedFromTable };
}
```

```tsx
import type { QueryDocument, TableReference } from "../../core";
import type { TableRef } from "../../ipc/contract";

export type VisualQueryCanvasProps = {
  tables: TableRef[];
  columnNames: string[];
  metadataErrorMessage: string | null;
  isConnected: boolean;
  /**
   * Uncontrolled by default: canvas owns one QueryDocument instance for the
   * lifetime of the mount. If `document` is passed, canvas still mutates that
   * instance in place and bumps an internal revision; it does NOT clone.
   * There is no prop→state sync on later document identity changes — pass a
   * stable instance (tests) or omit the prop (App).
   */
  document?: QueryDocument;
  onDocumentChange?: (doc: QueryDocument) => void;
  /** Fires when committed FROM identity changes (including to null). */
  onCommittedFromChange?: (table: TableReference | null) => void;
};

export function VisualQueryCanvas(props: VisualQueryCanvasProps): JSX.Element;
```

**Required mutation wrapper (implement exactly this shape):**

```tsx
const [doc] = useState(() => props.document ?? new QueryDocument());
const [revision, setRevision] = useState(0);
// read revision in render so React subscribes: void revision;

function mutate(fn: (d: QueryDocument) => void): void {
  const before = doc.committedFromTable;
  fn(doc);
  const after = doc.committedFromTable;
  setRevision((r) => r + 1);
  props.onDocumentChange?.(doc);
  if (!sameTable(before, after)) {
    props.onCommittedFromChange?.(after);
  }
}
// sameTable from src/ipc/table-ref.ts (or a tiny local helper using TableReference)
```

All document edits (chooseStatement, addClause, removeClause, startOver, field setters, FROM commit/select) **must** go through `mutate`. Typing `setFromTableText` goes through `mutate` but must not notify when committed identity unchanged.

- [ ] **Step 1a: Failing core test for committedFromTable getter**

```ts
// tests/core/query-document-committed-from.test.ts
import { describe, expect, it } from "vitest";
import { QueryDocument } from "../../src/core";

describe("QueryDocument.committedFromTable", () => {
  it("stays null while typing FROM text", () => {
    const doc = new QueryDocument();
    doc.chooseStatement("select");
    doc.addClause("from");
    doc.setFromTableText("users");
    expect(doc.committedFromTable).toBeNull();
    expect(doc.fromTable).toEqual({ schema: null, name: "users" });
  });

  it("updates on selectFromTable and clears on startOver / removeClause from", () => {
    const doc = new QueryDocument();
    doc.chooseStatement("select");
    doc.addClause("from");
    doc.selectFromTable("users", "public");
    expect(doc.committedFromTable).toEqual({ schema: "public", name: "users" });
    doc.startOver();
    expect(doc.committedFromTable).toBeNull();
  });
});
```

- [ ] **Step 1b: Run core test — expect FAIL** (getter missing)

Run: `bun run test tests/core/query-document-committed-from.test.ts`

- [ ] **Step 1c: Add getter — expect PASS**

- [ ] **Step 1d: Write failing canvas tests** (`/** @vitest-environment jsdom */`)

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { VisualQueryCanvas } from "../../../src/ui/visual-query/canvas";
import { VisualQueryAccessibility } from "../../../src/ui/visual-query/accessibility";
import { VisualQueryCopy } from "../../../src/ui/visual-query/copy";

const tables = [
  { name: "users", schema: "public" },
  { name: "events", schema: "analytics" },
];

describe("VisualQueryCanvas", () => {
  it("empty → SELECT shows clause card and re-renders preview without new doc instance", async () => {
    const user = userEvent.setup();
    const onDocumentChange = vi.fn();
    render(
      <VisualQueryCanvas
        tables={tables}
        columnNames={[]}
        metadataErrorMessage={null}
        isConnected={true}
        onDocumentChange={onDocumentChange}
      />,
    );
    await user.click(screen.getByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    expect(screen.getByTestId(VisualQueryAccessibility.clauseCard("select"))).toBeInTheDocument();
    expect(onDocumentChange).toHaveBeenCalled();
    const doc = onDocumentChange.mock.calls.at(-1)?.[0];
    onDocumentChange.mockClear();
    await user.click(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.clauseMenuItem("from")));
    expect(onDocumentChange.mock.calls.at(-1)?.[0]).toBe(doc); // same instance
  });

  it("shows canRun help on status strip when SELECT incomplete", async () => {
    const user = userEvent.setup();
    render(
      <VisualQueryCanvas tables={tables} columnNames={[]} metadataErrorMessage={null} isConnected={true} />,
    );
    await user.click(screen.getByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    expect(screen.getByText(/table/i)).toBeInTheDocument();
  });

  it("notifies onCommittedFromChange on select, clear via delete FROM, and start over", async () => {
    const user = userEvent.setup();
    const onCommittedFromChange = vi.fn();
    render(
      <VisualQueryCanvas
        tables={tables}
        columnNames={["id"]}
        metadataErrorMessage={null}
        isConnected={true}
        onCommittedFromChange={onCommittedFromChange}
      />,
    );
    await user.click(screen.getByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.clauseMenuItem("from")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.fromTablePicker));
    await user.click(screen.getByRole("button", { name: "users" }));
    expect(onCommittedFromChange).toHaveBeenCalledWith({ schema: "public", name: "users" });

    onCommittedFromChange.mockClear();
    await user.click(screen.getByTestId(VisualQueryAccessibility.deleteClause("from")));
    expect(onCommittedFromChange).toHaveBeenCalledWith(null);

    // rebuild FROM then start over
    await user.click(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.clauseMenuItem("from")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.fromTablePicker));
    await user.click(screen.getByRole("button", { name: "users" }));
    onCommittedFromChange.mockClear();
    await user.click(screen.getByTestId(VisualQueryAccessibility.startOver));
    expect(onCommittedFromChange).toHaveBeenCalledWith(null);
  });

  it("does not notify onCommittedFromChange while typing FROM text", async () => {
    const user = userEvent.setup();
    const onCommittedFromChange = vi.fn();
    render(
      <VisualQueryCanvas
        tables={tables}
        columnNames={[]}
        metadataErrorMessage={null}
        isConnected={true}
        onCommittedFromChange={onCommittedFromChange}
      />,
    );
    await user.click(screen.getByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.clauseMenuItem("from")));
    onCommittedFromChange.mockClear();
    await user.type(screen.getByTestId(VisualQueryAccessibility.fromTableField), "u");
    expect(onCommittedFromChange).not.toHaveBeenCalled();
  });

  it("CREATE path updates live preview text", async () => {
    const user = userEvent.setup();
    render(
      <VisualQueryCanvas tables={tables} columnNames={[]} metadataErrorMessage={null} isConnected={true} />,
    );
    await user.click(screen.getByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("createTable")));
    await user.type(screen.getByTestId(VisualQueryAccessibility.createTableNameField), "orders");
    expect(screen.getByTestId(VisualQueryAccessibility.generatedSQLText).textContent).toMatch(/orders/i);
  });

  it("UPDATE shows Coming soon and preview em dash", async () => {
    const user = userEvent.setup();
    render(
      <VisualQueryCanvas tables={tables} columnNames={[]} metadataErrorMessage={null} isConnected={true} />,
    );
    await user.click(screen.getByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("update")));
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
    expect(screen.getByTestId(VisualQueryAccessibility.generatedSQLText)).toHaveTextContent(
      VisualQueryCopy.sqlPreviewEmpty,
    );
  });

  it("renders metadata error strip when provided", () => {
    render(
      <VisualQueryCanvas
        tables={tables}
        columnNames={[]}
        metadataErrorMessage={VisualQueryCopy.columnsLoadError}
        isConnected={true}
      />,
    );
    expect(screen.getByText(VisualQueryCopy.columnsLoadError)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run canvas tests — expect FAIL**

Run: `bun run test tests/ui/visual-query/canvas.test.tsx`

- [ ] **Step 3: Implement canvas** using the `mutate` wrapper above; fold ViewModel behaviours from spec §5.2; **no** Run / create-confirm sheet.

- [ ] **Step 4: Run core + canvas tests — expect PASS**

```bash
bun run test tests/core/query-document-committed-from.test.ts tests/ui/visual-query/canvas.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git status
git add src/core/query-document.ts tests/core/query-document-committed-from.test.ts src/ui/visual-query/canvas.tsx tests/ui/visual-query/canvas.test.tsx
git commit -m "$(cat <<'EOF'
feat(ui): assemble visual query canvas with revisioned mutations

Expose committed FROM for metadata invalidation and bump a revision after in-place QueryDocument edits.
EOF
)"
```

---

### Task 10: App wiring + scaffold purge + remove greet

**Files:**
- Modify: `src/App.tsx` (replace entirely)
- Modify: `src/App.css` (replace scaffold styles)
- Modify: `index.html` — title `DragonDB`; favicon not vite/tauri demo (use a simple production favicon path under `public/`, e.g. `public/favicon.svg` branded or neutral — **not** `vite.svg` / `tauri.svg` / `react.svg`)
- Modify: `src-tauri/src/lib.rs` — remove `greet`
- Delete: `src/assets/react.svg`, `public/vite.svg`, `public/tauri.svg` (and any unused demo logos)
- Create: `public/favicon.svg` (minimal mark; may be a simple SVG using brief primary-600)
- Test: `tests/ui/scaffold-purge.test.ts` (**required**)
- Test: `tests/ui/app-wiring.test.tsx` (**required**)

**Interfaces / App behaviour:**
- Default `createMockDragonIpc("happy")`.
- `isConnected={true}`.
- Mount: `listTables` → set tables; on reject → `tables=[]` (no throw to UI).
- `onCommittedFromChange`: null → clear columns + metadata; else `listColumns` via `coreToTableRef`.
- Column load: track a monotonic `requestId`; ignore stale resolutions; clear on unmount (`cancelled` flag).
- On `listColumns` reject → `columnNames=[]` + `metadataErrorMessage = VisualQueryCopy.columnsLoadError`.
- **Assert UI never calls `runQuery`:** in wiring tests, spy mock `runQuery` and expect zero calls after SELECT/FROM/CREATE flows.

- [ ] **Step 1: Write failing scaffold-purge + app-wiring tests**

```ts
// tests/ui/scaffold-purge.test.ts
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

describe("scaffold purge", () => {
  it("removes greet demo strings from src and index.html", () => {
    const FORBIDDEN = [/Welcome to Tauri/, /greet-input/, /You've been greeted/, /Tauri \+ React \+ Typescript/];
    const hits: string[] = [];
    for (const file of [...walk(join(ROOT, "src")), join(ROOT, "index.html")]) {
      if (!/\.(tsx?|css|html)$/.test(file)) continue;
      const text = readFileSync(file, "utf8");
      for (const re of FORBIDDEN) {
        if (re.test(text)) hits.push(`${file} matches ${re}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("index.html uses DragonDB title and non-scaffold favicon", () => {
    const html = readFileSync(join(ROOT, "index.html"), "utf8");
    expect(html).toMatch(/<title>DragonDB<\/title>/);
    expect(html).not.toMatch(/vite\.svg|tauri\.svg|react\.svg/);
    expect(html).toMatch(/rel="icon"[^>]+href="\/favicon\.svg"/);
  });

  it("deletes scaffold public/src logos", () => {
    expect(existsSync(join(ROOT, "public/vite.svg"))).toBe(false);
    expect(existsSync(join(ROOT, "public/tauri.svg"))).toBe(false);
    expect(existsSync(join(ROOT, "src/assets/react.svg"))).toBe(false);
    expect(existsSync(join(ROOT, "public/favicon.svg"))).toBe(true);
  });

  it("removes greet from Rust lib", () => {
    const rust = readFileSync(join(ROOT, "src-tauri/src/lib.rs"), "utf8");
    expect(rust).not.toMatch(/\bgreet\b/);
  });
});
```

```tsx
/** @vitest-environment jsdom */
// tests/ui/app-wiring.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

// App must accept an injectable ipc for tests. If production App closes over
// createMockDragonIpc(), export a named `AppView` that takes `ipc: DragonIpc`
// OR export `__test__` seam — prefer:
//   export function App(props?: { ipc?: DragonIpc })
vi.mock("../../src/ipc/mock", async () => {
  const actual = await vi.importActual<typeof import("../../src/ipc/mock")>("../../src/ipc/mock");
  return actual;
});

import App from "../../src/App";
import { createMockDragonIpc } from "../../src/ipc/mock";
import { VisualQueryAccessibility } from "../../src/ui/visual-query/accessibility";
import { VisualQueryCopy } from "../../src/ui/visual-query/copy";

describe("App wiring", () => {
  it("loads tables on mount into FROM picker", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    render(<App ipc={ipc} />);
    await user.click(await screen.findByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.clauseMenuItem("from")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.fromTablePicker));
    expect(await screen.findByRole("button", { name: "users" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "analytics.events" })).toBeInTheDocument();
  });

  it("reloads columns after FROM commit and clears on start over", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const listColumns = vi.spyOn(ipc, "listColumns");
    render(<App ipc={ipc} />);
    await user.click(await screen.findByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.clauseMenuItem("from")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.fromTablePicker));
    await user.click(await screen.findByRole("button", { name: "users" }));
    await waitFor(() => expect(listColumns).toHaveBeenCalled());
    await user.click(screen.getByTestId(VisualQueryAccessibility.startOver));
    // columns cleared — WHERE needs-from if added; at minimum listColumns not required again until new FROM
  });

  it("maps columnsError to metadata copy", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("columnsError");
    // still need tables: override listTables from happy tables
    const happy = createMockDragonIpc("happy");
    ipc.listTables = happy.listTables.bind(happy);
    render(<App ipc={ipc} />);
    await user.click(await screen.findByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.clauseMenuItem("from")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.fromTablePicker));
    await user.click(await screen.findByRole("button", { name: "users" }));
    expect(await screen.findByText(VisualQueryCopy.columnsLoadError)).toBeInTheDocument();
  });

  it("never calls runQuery during canvas editing", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const runQuery = vi.spyOn(ipc, "runQuery");
    render(<App ipc={ipc} />);
    await user.click(await screen.findByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.clauseMenuItem("from")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.fromTablePicker));
    await user.click(await screen.findByRole("button", { name: "users" }));
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("ignores stale listColumns resolution", async () => {
    const user = userEvent.setup();
    let releaseFirst!: (cols: unknown) => void;
    const first = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    const ipc = createMockDragonIpc("happy");
    const realTables = ipc.listTables.bind(ipc);
    const realColumns = createMockDragonIpc("happy").listColumns.bind(createMockDragonIpc("happy"));
    let call = 0;
    ipc.listTables = realTables;
    ipc.listColumns = async (c, table) => {
      call += 1;
      if (call === 1) {
        await first;
        return [{ name: "stale", dataType: "text", isNullable: true, defaultValue: null, isPrimaryKey: false, isUnique: false, isForeignKey: false }];
      }
      return realColumns(c, table);
    };
    render(<App ipc={ipc} />);
    await user.click(await screen.findByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.clauseMenuItem("from")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.fromTablePicker));
    await user.click(await screen.findByRole("button", { name: "users" }));
    // switch FROM to analytics.events before first resolves
    await user.click(screen.getByTestId(VisualQueryAccessibility.fromTablePicker));
    await user.click(await screen.findByRole("button", { name: "analytics.events" }));
    releaseFirst([]);
    await waitFor(async () => {
      await user.click(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock));
      // open WHERE picker — should not list "stale" if columns for events loaded
    });
    // Minimal assertion: second listColumns completed and UI did not crash
    expect(call).toBeGreaterThanOrEqual(2);
  });
});
```

**App prop seam (required for tests):**

```tsx
export type AppProps = { ipc?: DragonIpc };
export default function App({ ipc = createMockDragonIpc("happy") }: AppProps = {}) { /* … */ }
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
bun run test tests/ui/scaffold-purge.test.ts tests/ui/app-wiring.test.tsx
```

- [ ] **Step 3: Implement App, purge assets, fix index.html, remove greet**

Include abort/stale guards:

```tsx
useEffect(() => {
  let cancelled = false;
  void ipc.listTables(FIXTURE_CONNECTION_ID).then(
    (rows) => { if (!cancelled) setTables(rows); },
    () => { if (!cancelled) setTables([]); },
  );
  return () => { cancelled = true; };
}, [ipc]);

// columns: increment requestId; only apply if requestId matches latest; cleanup on unmount
```

- [ ] **Step 4: Run tests + `bun run check` — expect PASS**

- [ ] **Step 5: Manual smoke on macOS** — `bun run tauri dev`, walk spec §11.2 items 1–9.

- [ ] **Step 6: Commit with explicit pathspecs**

```bash
git status
git add \
  src/App.tsx src/App.css src/main.tsx index.html \
  src-tauri/src/lib.rs \
  public/favicon.svg \
  tests/ui/scaffold-purge.test.ts tests/ui/app-wiring.test.tsx
git add -u public/vite.svg public/tauri.svg src/assets/react.svg 2>/dev/null || true
# If deletions: `git add -u -- public src/assets` is OK only scoped to those dirs — never repo-wide -A
git add -u -- public src/assets
git commit -m "$(cat <<'EOF'
feat(app): mount visual canvas and purge Tauri greet scaffold

Wire injectable mock IPC with stale-safe column loads; remove demo HTML/assets/Rust greet.
EOF
)"
```

---

### Task 11: Full check + Linux verification handoff

**Files:**
- Create: `docs/superpowers/plans/2026-08-10-sp4a-manual-verify-log.md` (sign-off artifact)

- [ ] **Step 1: Run full gate**

```bash
bun run check
```

Expected: typecheck + lint + all tests PASS (including architecture boundary + scaffold purge).

- [ ] **Step 2: Write the sign-off log template and fill macOS results**

Create `docs/superpowers/plans/2026-08-10-sp4a-manual-verify-log.md`:

```markdown
# SP-4a Manual Verify Log

| OS | Device | Date | Tester | §11.2 1-9 | Notes |
|----|--------|------|--------|-----------|-------|
| macOS | | YYYY-MM-DD | | PASS/FAIL | |
| Linux | | YYYY-MM-DD | | PASS/FAIL | |
| Windows (optional) | | | | | |

Checklist reference: spec §11.2. Every required OS row must be PASS before SP-4a exit.
```

Fill the macOS row after Task 10 smoke.

- [ ] **Step 3: Linux manual verify**

On Linux: install Tauri v2 WebKitGTK deps as needed, `bun install && bun run tauri dev`, complete §11.2, set Linux row to PASS/FAIL with notes. Failures become fix commits (explicit pathspecs) or recorded blockers — do not claim exit while FAIL.

- [ ] **Step 4: Windows optional** — same log row if convenient.

- [ ] **Step 5: Commit sign-off log (and any fixes) with explicit paths**

```bash
git status
git add docs/superpowers/plans/2026-08-10-sp4a-manual-verify-log.md
# plus any explicit fix paths — never git add -A
git commit -m "$(cat <<'EOF'
docs: record SP-4a manual verification sign-off

EOF
)"
```

---

## Self-review (author checklist)

| Spec / validation requirement | Task |
|---|---|
| IPC contract + mock fixtures §5.1 / §7 | Task 1 |
| `TableReference` reuse in helpers | Task 1 |
| Copy + accessibility parity with Swift ids | Task 2 |
| Full brief tokens + local fonts | Task 3 |
| Schema popover | Task 4 |
| Statement picker SELECT/CREATE/Coming soon | Task 5 |
| Toolbar without Run | Task 5 |
| Live SQL preview + Copy clipboard | Task 6 |
| Clause cards five kinds (executable TDD) | Task 7 |
| CREATE root card (executable TDD) | Task 8 |
| Revision counter + committed FROM invalidation | Task 9 |
| Canvas status strip + live preview null-safe | Task 9 |
| App wiring stale-safe columns + no `runQuery` | Task 10 |
| Scaffold purge incl. `index.html` + `public/` | Task 10 |
| Manual Mac + Linux with sign-off log | Task 10–11 |
| Explicit pathspec commits (no `git add -A`) | All commit steps |
| Tech debt deferred (documented) | Deferred section |
| No stores / no runQuery UI | Tasks 5, 9, 10 |

Placeholder scan: none intentional.  
Type consistency: `TableReference` from core; IPC `TableRef` only at `listColumns` boundary; canvas `mutate` + `revision` required.
