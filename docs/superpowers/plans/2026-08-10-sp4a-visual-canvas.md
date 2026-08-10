# SP-4a Visual Query Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Tauri-React greet scaffold with a production visual-query canvas that ports Swift block-card behaviour against real `src/core/` and a mocked `DragonIpc`.

**Architecture:** Swift file-boundary mirror under `src/ui/visual-query/`. `App.tsx` owns mock IPC wiring (fixture `ConnectionId`, table/column loads) and mounts the canvas full-window. Component-local `QueryDocument` state; no `src/stores/`. Live SQL preview uses `generateSQL(doc)?.display ?? "—"`. Validation help uses a status strip (`canRun` messages as-is); no Run button.

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
- Scaffold purge is a hard exit: zero greet/demo leftovers.
- Package manager: Bun (`bun add`, `bun run check`).
- Manual verify on macOS + Linux after Task 10 (checklist in spec §11.2); not automated in CI.

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
| `src/App.tsx` | Mock wiring + mount canvas |
| `src/App.css` | Delete scaffold; re-export or replace with tokens |
| `src/main.tsx` | Import fonts + tokens |
| `src-tauri/src/lib.rs` | Remove `greet` |
| `tests/ipc/mock.test.ts` | Mock fixture modes |
| `tests/ui/visual-query/copy.test.ts` | Ported copy tests |
| `tests/ui/visual-query/accessibility.test.ts` | Unique id set |
| `tests/ui/visual-query/*.test.tsx` | Component tests (jsdom) |
| `tests/ui/scaffold-purge.test.ts` | Grep-gate exit for scaffold strings |
| `vitest.config.ts` | Allow `.tsx` tests; keep default node, per-file jsdom |
| `package.json` | Add fontsource + testing-library + jsdom |

**Swift → TS map (invariant: one Swift file ≈ one module):** see spec §6.

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
  - `export type IpcError = { kind: "connection" | "auth" | "syntax" | "permission" | "unknown"; message: string; position?: number | null; }` — match parent §4 (`syntax` includes `position: number | null`)
  - `export interface DragonIpc { listTables(c: ConnectionId): Promise<TableRef[]>; listColumns(c: ConnectionId, table: TableRef): Promise<ColumnInfo[]>; runQuery(c: ConnectionId, sql: ExecutableSQL): Promise<QueryResult>; }`
  - `export const FIXTURE_CONNECTION_ID: ConnectionId = "fixture";`
  - `export type MockMode = "happy" | "emptyTables" | "emptyColumns" | "columnsError";`
  - `export function createMockDragonIpc(mode?: MockMode): DragonIpc;`
  - `export function tableRefToCore(ref: TableRef): { schema: string | null; name: string };`
  - `export function formatTableDisplayName(ref: { schema: string | null; name: string }): string;` — bare name when schema is null or `"public"`

- [ ] **Step 1: Write the failing mock test**

```ts
// tests/ipc/mock.test.ts
import { describe, expect, it } from "vitest";
import { FIXTURE_CONNECTION_ID, createMockDragonIpc } from "../../src/ipc/mock";
import { formatTableDisplayName, tableRefToCore } from "../../src/ipc/table-ref";

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
  it("maps optional schema to null", () => {
    expect(tableRefToCore({ name: "users" })).toEqual({ schema: null, name: "users" });
    expect(tableRefToCore({ schema: "analytics", name: "events" })).toEqual({
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

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/ipc/mock.test.ts`  
Expected: FAIL — module not found.

- [ ] **Step 3: Implement contract, helpers, and mock**

Put types in `src/ipc/contract.ts` exactly as parent §4 (import type `{ ExecutableSQL }` from `../core`).

Put `tableRefToCore` / `formatTableDisplayName` in `src/ipc/table-ref.ts` and re-export from `mock.ts` for the test import path above **or** change the test to import helpers from `table-ref.ts` and keep `createMockDragonIpc` in `mock.ts`. Prefer:

```ts
// tests import:
import { FIXTURE_CONNECTION_ID, createMockDragonIpc } from "../../src/ipc/mock";
import { formatTableDisplayName, tableRefToCore } from "../../src/ipc/table-ref";
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

Accessibility test:

```ts
import { VisualQueryAccessibility } from "../../../src/ui/visual-query/accessibility";

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
  it("defines required brief variables", () => {
    for (const name of [
      "--primary-600",
      "--neutral-100",
      "--neutral-900",
      "--error-solid",
      "--radius",
    ]) {
      expect(css).toContain(name);
    }
    expect(css).toMatch(/--radius:\s*4px/);
    expect(css).toContain("oklch(0.55 0.123 245)"); // primary-600
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
// read-only <pre> with data-testid generatedSQLText
// Copy button data-testid copySQL using VisualQueryCopy.copySQLTitle
// uses navigator.clipboard.writeText(sql) when allowsCopy (always true for non-empty policy: allow copy even for "—")
```

- [ ] **Step 1: Failing test**

```tsx
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
```

- [ ] **Step 2: FAIL → Step 3: implement with mono font `var(--font-mono)` → Step 4: PASS → Step 5: Commit**

```bash
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

Port props from `VisualClauseCardView.swift` / `VisualClauseCardFieldViews.swift`:

```tsx
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
```

Wire popovers via `SchemaFieldPopover`. FROM display uses `formatTableDisplayName`. Column popovers pass `needsFromMessage` when FROM not set (same predicate as Swift `needsFrom`).

- [ ] **Step 1: Failing integration-style tests** (jsdom)

Minimum:
1. FROM: select `users` from popover → `onSelectFromTable` called with schema public/null appropriately.
2. LIMIT: type `abc` → `onSetLimitText("abc")`.
3. Helper text from `VisualQueryCopy.helper(kind)` visible.
4. Delete control present with `data-testid` `deleteClause(kind)`.

Implementers must open Swift files and port field UX (all-columns toggle, where operator select, order direction). Do not invent different operators — use `WhereOperator` union from core.

- [ ] **Step 2: FAIL → Step 3: Implement both modules → Step 4: PASS → Step 5: Commit**

```bash
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
  kind: StatementKind; // createTable | update | delete (caller only mounts when showsStatementRootCard)
  document: QueryDocument;
  onStartOver: () => void;
  onSetCreateTableName: (name: string) => void;
  onSetCreateColumns: (columns: CreateColumn[]) => void;
}): JSX.Element;
```

- [ ] **Step 1: Tests**

- UPDATE shows Coming soon badge; no create fields.
- CREATE: change table name → `onSetCreateTableName`; add column row → `onSetCreateColumns` with types from `CreateColumnType`.
- Use `createColumnTypeTitle` for type labels.

- [ ] **Step 2–4: TDD cycle porting `VisualStatementRootCardView.swift`**
- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(ui): port statement root card for CREATE and coming soon

Keep CREATE editable in SP-4a; UPDATE/DELETE show Coming soon chrome only.
EOF
)"
```

---

### Task 9: Canvas container

**Files:**
- Create: `src/ui/visual-query/canvas.tsx`
- Test: `tests/ui/visual-query/canvas.test.tsx`

**Interfaces:**

```tsx
export type VisualQueryCanvasProps = {
  tables: TableRef[];
  columnNames: string[];
  metadataErrorMessage: string | null;
  /** Always true in SP-4a App wiring; kept as prop so tests can assert help text. */
  isConnected: boolean;
  /** Optional controlled document for tests; default internal state. */
  document?: QueryDocument;
  onDocumentChange?: (doc: QueryDocument) => void;
  /** Notified when committed FROM identity changes — App reloads columns. */
  onCommittedFromChange?: (table: { schema: string | null; name: string } | null) => void;
};

export function VisualQueryCanvas(props: VisualQueryCanvasProps): JSX.Element;
```

Behaviour (fold ViewModel + `VisualQueryCanvasView.swift`):
- Hold `QueryDocument` in state (or use provided instance).
- `CanvasPresentation` from `new CanvasPresentation(doc, canRun(doc, isConnected).helpMessage)`.
- Status strip: `presentation.visibleStatusMessage`.
- Metadata strip: `metadataErrorMessage` when non-empty.
- Empty canvas → Add block → `StatementPicker`.
- Chain: root card and/or clause cards from presentation; trailing Add for `trailingOptions`.
- Toolbar `canStartOver={!presentation.showsInitialAddButton}`.
- Preview sql = `generateSQL(doc)?.display ?? VisualQueryCopy.sqlPreviewEmpty`.
- On FROM commit / selectFromTable success path, call `onCommittedFromChange(doc.fromTable)`.
- **Do not** mount create-confirmation sheet or Run.

- [ ] **Step 1: Failing canvas tests**

```tsx
it("empty → SELECT shows clause card and preview updates", async () => {
  const user = userEvent.setup();
  render(
    <VisualQueryCanvas tables={[{ name: "users", schema: "public" }]} columnNames={[]} metadataErrorMessage={null} isConnected={true} />,
  );
  await user.click(screen.getByTestId(VisualQueryAccessibility.initialAddBlock));
  await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
  expect(screen.getByTestId(VisualQueryAccessibility.clauseCard("select"))).toBeInTheDocument();
});

it("shows canRun help on status strip when incomplete", async () => {
  // choose SELECT only → help contains /table/i or /FROM/i
});

it("CREATE path updates preview text", async () => {
  // choose createTable, type table name, expect preview to contain CREATE or table name from generateSQL
});

it("UPDATE shows Coming soon and preview —", async () => {
  // preview test id text is "—"
});
```

- [ ] **Step 2–4: Implement canvas; keep mutations thin wrappers around `QueryDocument` methods**
- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(ui): assemble visual query canvas container

Wire presentation, status strips, live SQL preview, and card chain without Run or stores.
EOF
)"
```

---

### Task 10: App wiring + scaffold purge + remove greet

**Files:**
- Modify: `src/App.tsx` (replace entirely)
- Modify: `src/App.css` (replace with minimal layout importing visual-query.css or empty)
- Modify: `src-tauri/src/lib.rs` (remove greet command + handler)
- Delete unused: `src/assets/react.svg` if unused; any other demo logos only referenced by old App
- Test: `tests/ui/scaffold-purge.test.ts`
- Test: `tests/ui/visual-query/app-wiring.test.tsx` (optional but recommended)

**Interfaces:**
- App uses `createMockDragonIpc("happy")` by default.
- `FIXTURE_CONNECTION_ID`, `isConnected={true}`.
- On mount: `listTables` → `tables` state.
- On `onCommittedFromChange`: if null, clear columns + metadata; else `listColumns` → set `columnNames` from `.map(c => c.name)`; on reject set `metadataErrorMessage` to `VisualQueryCopy.columnsLoadError` and `columnNames=[]`.

- [ ] **Step 1: Write scaffold purge test**

```ts
// tests/ui/scaffold-purge.test.ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(process.cwd(), "src");
const FORBIDDEN = [/Welcome to Tauri/, /greet-input/, /You've been greeted/, /react\.svg/];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(tsx?|css)$/.test(e)) out.push(full);
  }
  return out;
}

describe("scaffold purge", () => {
  it("removes Tauri greet demo UI strings from src", () => {
    const hits: string[] = [];
    for (const file of walk(ROOT)) {
      const text = readFileSync(file, "utf8");
      for (const re of FORBIDDEN) {
        if (re.test(text)) hits.push(`${file} matches ${re}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
```

Also assert `src-tauri/src/lib.rs` has no `greet`:

```ts
const rust = readFileSync(join(process.cwd(), "src-tauri/src/lib.rs"), "utf8");
expect(rust).not.toMatch(/\bgreet\b/);
```

- [ ] **Step 2: Run purge test — expect FAIL (scaffold still present)**

- [ ] **Step 3: Replace App, CSS, Rust; delete unused demo assets**

Example App shape:

```tsx
import { useCallback, useEffect, useState } from "react";
import type { TableRef } from "./ipc/contract";
import { FIXTURE_CONNECTION_ID, createMockDragonIpc } from "./ipc/mock";
import { VisualQueryCopy } from "./ui/visual-query/copy";
import { VisualQueryCanvas } from "./ui/visual-query/canvas";
import "./ui/visual-query/visual-query.css";

const ipc = createMockDragonIpc("happy");

export default function App() {
  const [tables, setTables] = useState<TableRef[]>([]);
  const [columnNames, setColumnNames] = useState<string[]>([]);
  const [metadataErrorMessage, setMetadataErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    void ipc.listTables(FIXTURE_CONNECTION_ID).then(setTables);
  }, []);

  const onCommittedFromChange = useCallback(
    (table: { schema: string | null; name: string } | null) => {
      if (table === null) {
        setColumnNames([]);
        setMetadataErrorMessage(null);
        return;
      }
      const ref: TableRef = {
        name: table.name,
        ...(table.schema !== null ? { schema: table.schema } : {}),
      };
      void ipc
        .listColumns(FIXTURE_CONNECTION_ID, ref)
        .then((cols) => {
          setColumnNames(cols.map((c) => c.name));
          setMetadataErrorMessage(null);
        })
        .catch(() => {
          setColumnNames([]);
          setMetadataErrorMessage(VisualQueryCopy.columnsLoadError);
        });
    },
    [],
  );

  return (
    <VisualQueryCanvas
      tables={tables}
      columnNames={columnNames}
      metadataErrorMessage={metadataErrorMessage}
      isConnected={true}
      onCommittedFromChange={onCommittedFromChange}
    />
  );
}
```

`lib.rs` becomes builder with empty invoke list (or only plugins), no greet.

- [ ] **Step 4: Run purge test + `bun run check` — PASS**

- [ ] **Step 5: Manual smoke on macOS**

Run: `bun run tauri dev`  
Walk spec §11.2 checklist items 1–9 on macOS. Fix gaps before committing if checklist fails.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/App.css src-tauri/src/lib.rs src/assets tests/ui/scaffold-purge.test.ts
git commit -m "$(cat <<'EOF'
feat(app): mount visual canvas and purge Tauri greet scaffold

Wire mock IPC schema loading into App and remove demo UI/Rust greet command.
EOF
)"
```

---

### Task 11: Full check + Linux verification handoff

**Files:**
- Modify: none required unless fixes arise
- Optional: add `docs/superpowers/plans/2026-08-10-sp4a-manual-verify.md` only if you need a writable checklist log — otherwise use spec §11.2 directly (prefer **no** extra doc unless user asks)

- [ ] **Step 1: Run full gate**

```bash
bun run check
```

Expected: typecheck + lint + all tests PASS (including architecture boundary).

- [ ] **Step 2: Linux manual verify**

On a Linux device: `bun install && bun run tauri dev` (install WebKitGTK/system deps per Tauri v2 Linux docs if needed). Complete spec §11.2 checklist. Record any engine-specific bugs as follow-up issues — do not silently drop checklist items.

- [ ] **Step 3: Windows optional** — same checklist if convenient.

- [ ] **Step 4: Final commit only if fixes were needed**; otherwise done.

```bash
git status
# if fixes:
git add -A
git commit -m "$(cat <<'EOF'
fix(ui): address SP-4a manual verification findings

EOF
)"
```

---

## Self-review (author checklist)

| Spec requirement | Task |
|---|---|
| IPC contract + mock fixtures §5.1 / §7 | Task 1 |
| Copy + accessibility + empty/No matches strings | Task 2 |
| Brief tokens, fonts, radius, focus | Task 3 |
| Schema popover | Task 4 |
| Statement picker SELECT/CREATE/Coming soon | Task 5 |
| Toolbar without Run | Task 5 |
| Live SQL preview null-safe | Task 6 + 9 |
| Clause cards five kinds | Task 7 |
| CREATE root card | Task 8 |
| Canvas + status strip + metadata | Task 9 |
| App wiring isConnected=true, column reload | Task 10 |
| Scaffold purge + greet removal | Task 10 |
| Manual Mac + Linux | Task 10–11 |
| Tech debt deferred (documented) | Deferred section |
| No stores / no runQuery UI | Tasks 5, 9, 10 |

Placeholder scan: none intentional.  
Type consistency: `TableRef` / `QueryDocument` / `StatementKind` / `ClauseKind` shared via `src/core` + `src/ipc/contract.ts`.
