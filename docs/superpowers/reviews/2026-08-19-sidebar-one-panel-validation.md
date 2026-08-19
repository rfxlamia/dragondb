# Plan Validation Report: Sidebar Redesign — One Panel, Permanent Rail

**Plan:** `docs/superpowers/plans/2026-08-19-sidebar-one-panel.md` (1710 lines, 5 tasks)
**Spec:** `docs/superpowers/specs/2026-08-19-sidebar-redesign-design.md`
**Validated:** 2026-08-19 · every claim below checked against source, not inferred.

## Executive Summary

- **Critical:** 4 blockers
- **Warnings:** 6
- **Info:** 3
- **Overall Grade: B**

Unusually precise plan — real line numbers, real prop names, correct constants,
genuine red-green-refactor per task. Three of the four blockers are the same
class of omission (fixed-position surfaces the blocking guard does not cover),
and the fourth is a cross-task ordering defect that breaks the plan's own stated
invariant.

---

## Critical Issues

### C1 — Task 4 misses `TableList`'s three fixed-position surfaces

`src/ui/tables/table-list.tsx:51-55` owns three blocking surfaces:

```
const [pending, setPending] = useState<PendingAdmin | null>(null);   // drop/truncate confirm
const [ddl, setDdl] = useState<string | null>(null);                 // DDL sheet
const [exportTable, setExportTable] = useState<TableRef | null>(null); // export sheet
```

All three render through `.table-sheet`, which is `position: fixed; z-index: 40`
(`src/ui/tables/tables.css:205`). After Task 3 they live inside the Schema tab.
Switching to Queries or collapsing the sidebar strands a fixed sheet over a body
that is gone — the exact failure the spec names as the reason the guard exists
("Blocking surfaces", spec:195-217). Neither spec nor plan mentions them.

**Fix:** add `onBlockingChange?: (blocking: boolean) => void` to `TableList`,
emitting `pending !== null || ddl !== null || exportTable !== null`, forwarded
through `ConnectionTablesList` (the sidebar's slot boundary) and OR'd into
`sidebarBlocked` in `App.tsx`. Task 4 gains one more producer and two more tests.

### C2 — `ConnectionDatabasePicker` owns an unreported fixed dialog

`connection-database-picker.tsx:30` holds `const [createOpen, setCreateOpen] = useState(false)`
and renders `CreateDatabaseDialog` at `:168`, which uses `.connection-panel__confirm`
— `position: fixed` (`connection.css:361`, `:375`). The picker renders inside
`ConnectionPanel` (`connection-panel.tsx:506`), outside the `formVisible` branch,
so Task 4's `formVisible || confirm.hasPending` does not cover it.

**Fix:** `ConnectionDatabasePicker` reports `createOpen` upward; `ConnectionPanel`
folds it into its `blocking` expression.

*(Checked and dismissed: `createdDialogOpen` is **not** a gap. `handleSave`
never calls `onFormVisibleChange(false)` before `setCreatedDialogOpen(true)`
(`connection-panel.tsx:295-307`), so the form sheet is still mounted and
`formVisible` already covers it. The plan is correct here.)*

### C3 — Task 2 opens a regression window that only Task 4 closes

Task 2 Step 8 deletes the collapse button, and with it `disabled={formVisible}`
(`connection-panel.tsx:480`). Nothing supplies `toggleDisabled` until Task 4
Step 5. After Task 2's commit and Task 3's commit the collapse toggle is
**enabled while the connection form sheet is open** — the stranded-sheet bug the
spec forbids. Task 2's own rail test asserts `toggleDisabled` works while no
producer exists.

This breaks the plan's stated invariant: *"The app builds, passes tests, and runs
after every task."*

**Fix:** Task 2 Step 9 passes `toggleDisabled={formVisible}` (already in scope in
`App.tsx` — it is handed to `ConnectionPanel`). Task 4 Step 5 then generalizes it
to `sidebarBlocked`.

### C4 — Task 4's test code calls a helper that does not exist

Task 4 Step 1 writes `renderPanel({ formVisible: true, onBlockingChange })`.
`tests/ui/connection/connection-panel.test.tsx` has three `describe` blocks
(`:39`, `:141`, `:206`) and **no** `renderPanel` helper — every test renders
`<ConnectionPanel>` inline. The prose hedges ("matching the render helper that
file already uses"); the code does not compile.

**Fix:** either write the helper as an explicit sub-step, or inline the render in
both new tests the way `:187-202` already does.

---

## Warnings

### W1 — The ≤48rem stacked layout is broken by the rail's `height: 100vh`

Task 2 Step 5 gives `.activity-rail` `height: 100vh`. Task 2 Step 7 makes the
narrow layout `grid-template-columns: var(--sidebar-rail-width) 1fr` with
`.app-main-column { grid-column: 1 / -1 }` — so the rail sits in grid row 1 and
forces that row to 100vh, pushing the entire workspace below the fold.

**Fix:** `height: 100%` on the rail (the shell is already `height: 100vh`), or an
explicit `height: auto` override inside the 48rem block. The plan's manual step 7
would catch this by eye — after five commits.

### W2 — Task 3 Step 10 is too vague to execute; the sites are enumerable

"Re-point any assertion that reached the queries column" leaves the executor to
find them. They are:

| Site | What breaks | Action |
|------|-------------|--------|
| `app-wiring.test.tsx:1757`, `:1770` | `QueriesColumn` unmounted — default tab is `"schema"` | click `SidebarCopy.queriesTab` first |
| `app-wiring.test.tsx:2002`, `:2037` | `QueriesAccessibility.newQuery` unreachable | same |
| `app-wiring.test.tsx:2264` | asserts "collapse keeps Queries" — premise dead, column now inside the collapsed panel | rewrite the assertion, not just the query |
| `app-wiring.test.tsx:1751` (title) | "shows Queries left of the canvas" no longer describes the app | retitle |
| `app-wiring.test.tsx:1763` | "does not persist the Queries split layout" — the split is deleted | delete the test |
| `app-workspace.test.tsx:90-107` | `QueriesAccessibility.column` assertions incl. the `workspaceReady: false` case | delete |

### W3 — The riskiest edit in the plan has no red phase

Task 3 Step 8 replaces ~80 lines of `App.tsx` JSX (three components' worth of
prop wiring, moved verbatim). Its only coverage is `app-wiring.test.tsx`, which
Step 10 rewrites in the same commit — so nothing fails first.

**Fix:** make Step 8's red phase one assertion: render `App`, click the Queries
tab, assert `QueriesAccessibility.column` is present. Run it before the edit.

### W4 — `getByLabelText("Schema")` collides after Task 5

`SidebarCopy.schemaTab` is `"Schema"` on the switcher's radio label; Task 5 adds
`TablesCopy.schema` = `"Schema"` as a `.ui-visually-hidden` span inside the
picker's `<label>`. Both live in the Schema tab at once, so `getByLabelText("Schema")`
throws "found multiple elements". The planned tests use `getByTestId` and are
safe; the app-wiring rewrite (W2) is where this will bite.

### W5 — Task 5 deletes a constant before the test that uses it

Step 5 deletes `QueriesCopy.ok`; `tests/ui/library/queries-column.test.tsx:334`
reads it (`getByRole("button", { name: QueriesCopy.ok })`). Step 7 deletes that
test. Between the two, `bun run typecheck` fails.

**Fix:** swap Steps 5 and 7, or fold the test deletion into Step 5.

### W6 — Task 1's caching of a DOM node across a re-render is fragile

The "counts matches in the schema header" test captures `toggle` before typing,
then asserts on it after. It works because the `public` group survives the filter
and React keeps the node (key is `group.schema`). It silently breaks if the
filter ever excludes the group. Re-query after `user.type` instead.

---

## DRY Analysis

- **Verified reuse — good.** Every shared primitive the plan leans on exists:
  `.ui-search`, `.ui-segment`, `.ui-icon-btn`, `.ui-quiet-select`,
  `.ui-visually-hidden` (`controls.css:18-217`); `SearchIcon`, `ChevronDownIcon`,
  `ChevronRightIcon`, `SidebarIcon` (`icons.tsx:32,40,78,112`);
  `--sidebar-rail-width`, `--surface-sidebar`, `--border-subtle`
  (`App.css:10`, `tokens.css:66,70`). The switcher markup matches the existing
  `.ui-segment` radio pattern in `visual-query/toolbar.tsx:41-60` exactly.
  `confirm.hasPending` exists at `use-connection-confirmations.tsx:177`.
- **Duplication, ruled acceptable.** Task 1 reimplements the filter +
  `collapsed: ReadonlySet<string>` + no-matches pattern that
  `queries-column.tsx:83-115` already runs, and the two lists now sit in the same
  sidebar. Extracting a shared hook now is premature — the shapes differ (groups
  vs folders, batching vs sorting) and there are only two instances. Named here so
  a third instance triggers the extraction.
- Task 3 removes a real layer of prop drilling: the tables props already
  originate in `App.tsx:1197-1211` and were passing through `ConnectionPanel`
  purely as a conduit. Net reduction.

## YAGNI Analysis

- No speculative abstraction. `AppSidebar` takes `ReactNode` slots instead of
  importing the three panels — the right call for testability, and the tests use it.
- `toggleDisabled` / `switcherDisabled` ship in Tasks 2-3 with no consumer until
  Task 4. Acceptable as intra-plan forward declaration; the real cost is C3, not
  the dead prop.
- `ConnectionTablesList`'s five new schema props are all optional though `App`
  always passes them. Consistent with the file's existing style (`onBrowse`,
  `onRefresh`, … are all optional), so leave it.
- Nothing to cut. No config surface, no plugin seam, no premature persistence —
  the spec explicitly declines to persist `sidebarTab`.

## TDD Analysis

- **Test-first is real, not decorative.** Every task opens with the test, then a
  step that runs it and names the expected failure mode ("`TablesAccessibility.search`
  is `undefined`", "cannot resolve `../../../src/ui/shell/activity-rail`"). Commits
  land at green. This is the shape the workflow asks for.
- `bun run test <path>` resolves correctly (`test` is `vitest run`; bun forwards args).
- **Gaps:** C4 (helper does not exist), W3 (largest edit has no red phase),
  W6 (stale node reference). Layout is verified by eye only — accepted and stated
  by the plan, correctly.

## Gap Analysis

- **C1/C2** are the substantive gaps: the blocking inventory is incomplete, and
  the plan inherited that from the spec.
- **C3** is an ordering defect — the per-task shippability invariant the plan
  states in its own File Structure section does not hold between Tasks 2 and 4.
- **W1** is the only functional layout defect found.
- No security, performance, migration, or data surface is touched. No persisted
  state is destroyed (`WorkspaceSplit` declares no `autoSaveId` — confirmed).
- **Behavior change worth stating in the plan, not a defect:** collapsing the
  sidebar now hides saved queries as well as the schema. Today `QueriesColumn`
  survives a collapse (`app-wiring.test.tsx:2264` asserts exactly that). The spec's
  trade-off list does not mention it.

## Info

- **I1 — Spec/plan drift.** The spec puts the table filter in
  `ConnectionTablesList` with tests in `connection-tables-list.test.tsx`; the plan
  puts both in `TableList` / `table-list.test.tsx`. The plan is right —
  `TableList` owns `groupTables` and the section headers. Sync the spec.
- **I2 — Copy-module boundary.** Task 5 moves the picker to the Schema tab and
  moves `schema` / `allSchemas` / `ok` into `TablesCopy`, but `QueriesCopy.schemaError`
  stays behind and is still what `App.tsx:1060` sets and what the Schema tab will
  render. Move it to `TablesCopy` with the rest.
- **I3 — Redundant heading.** `queries-column-toolbar.tsx:36` renders
  `<h2>{QueriesCopy.title}</h2>` = "Queries", directly under a switcher segment
  already labeled "Queries". Same for the Connection panel's own title inside a
  block called Connections. Worth a look against the creative brief; not a
  correctness issue and not required to ship.

## Codebase Context

- Every file path, prop name, constant, and line reference the plan cites was
  verified present. `App.tsx:1168-1183` (inline rail), `:1217` (`onCollapse`),
  `App.css:8-95` and `:305-348` (grid + media queries), `connection-panel.tsx:473-486`
  (collapse button), `app-workspace.tsx:145-190` (queries panel + `queriesRow`)
  all match the plan's description.
- `tests/ui/shell/` exists and takes new files without scaffolding.
- `bun run check` = `typecheck && lint && test`, biome over `src tests`.
