# Sidebar Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the app's two navigation columns into one sidebar with a permanent icon rail and a Schema/Queries switcher.

**Architecture:** `.app-shell` becomes a three-track grid — a permanent 2.25rem rail, the sidebar panel, and the main column. The rail owns the single collapse toggle plus the first on-screen triggers for Settings and Help. The sidebar hosts a persistent Connections block above a `.ui-segment` switcher whose two tabs render the existing `ConnectionTablesList` and `QueriesColumn`. `AppWorkspace` sheds its queries panel and becomes tab strip + canvas + results.

**Tech Stack:** React 19 + TypeScript, Zustand stores, Vite, Vitest + Testing Library (jsdom), Biome, Tauri v2. Package manager: `bun`.

**Spec:** `docs/superpowers/specs/2026-08-19-sidebar-redesign-design.md`

## Global Constraints

- **Design authority:** `docs/pocket/rule/creative-brief.md`. No new hue, no new radius, no new font. Light-only — dark mode is an explicit Known Gap and is out of scope.
- **Radius:** `--radius: 4px` base; badges may use 8px. Nothing else.
- **Micro-labels:** sentence case, 11px/600, `var(--neutral-600)`. No ALL-CAPS section headers.
- **Icons:** inline SVG on a 16×16 grid, 1.4px stroke, `currentColor`, `aria-hidden="true"`, added to `src/ui/icons.tsx`. Never a text glyph (`▸`, `×`, `+`), never via `::after { content }`.
- **Focus ring:** `outline: 2px solid var(--primary-600); outline-offset: 2px;`. Never an inset `box-shadow`.
- **Copy:** every user-visible string is a constant in a `*-copy.ts` module, English, sentence case, verb-led. Every `data-testid` is a constant in a `*-accessibility.ts` module.
- **Architecture boundary:** `src/core/` stays pure. UI lives in `src/ui/**`.
- **Shared chrome** goes in `src/ui/controls.css` (`.ui-icon-btn`, `.ui-segment`, `.ui-search`, `.ui-row`, `.ui-section-label`, `.ui-quiet-select`, `.ui-visually-hidden`), not re-drawn per stylesheet.
- **Gate:** `bun run check` (typecheck + lint + tests) must pass before a task is considered done.
- **Commits:** conventional commits, English.

---

## File Structure

| File | Responsibility | Task |
|------|----------------|------|
| `src/ui/tables/table-list.tsx` | table search + collapsible per-schema sections | 1 |
| `src/ui/tables/tables-copy.ts` | new copy constants | 1, 5 |
| `src/ui/tables/tables-accessibility.ts` | new testids | 1, 5 |
| `src/ui/tables/tables.css` | search + section-header chrome | 1 |
| `src/ui/icons.tsx` | `SettingsIcon`, `HelpIcon` | 2 |
| `src/ui/help/help-copy.ts` | rail button labels | 2 |
| `src/ui/shell/activity-rail.tsx` | **new** — permanent rail, presentational | 2 |
| `src/ui/shell/activity-rail.css` | **new** — rail chrome | 2 |
| `src/App.css` | three-track grid, rail track, switcher chrome | 2, 3 |
| `src/ui/connection/connection-panel.tsx` | shrinks: loses collapse button (2), loses tables (3), reports blocking (4) | 2, 3, 4 |
| `src/ui/shell/app-sidebar.tsx` | **new** — Connections block + switcher + tab body | 3 |
| `src/ui/shell/sidebar-copy.ts` | **new** — switcher copy | 3 |
| `src/ui/shell/sidebar-accessibility.ts` | **new** — switcher testids | 3 |
| `src/ui/shell/app-workspace.tsx` | loses the queries panel and its props | 3 |
| `src/ui/library/queries-column.tsx` | reports blocking (4), loses schema-picker props (5) | 4, 5 |
| `src/ui/library/queries-column-toolbar.tsx` | loses the schema picker | 5 |
| `src/ui/connection/connection-tables-list.tsx` | gains the schema picker | 5 |
| `src/App.tsx` | wires rail, sidebar, `sidebarTab`, blocking state | 2, 3, 4, 5 |

Task order is dependency order. The app builds, passes tests, and runs after every task.

---

### Task 1: Table search and collapsible schema sections

Self-contained inside the table browser. No shell changes. `TableList` already
groups by schema (`groupTables`) and batches long schemas (`SCHEMA_BATCH_SIZE` +
"Load more"); this task adds a filter above the groups and turns each group
title into a disclosure button with a count.

**Files:**
- Modify: `src/ui/tables/tables-copy.ts`
- Modify: `src/ui/tables/tables-accessibility.ts`
- Modify: `src/ui/tables/table-list.tsx`
- Modify: `src/ui/tables/tables.css`
- Test: `tests/ui/tables/table-list.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `TablesAccessibility.search` (string), `TablesAccessibility.schemaToggle(schema: string) => string`, `TablesCopy.searchTables`, `TablesCopy.noMatchingTables`. `TableList`'s public props are unchanged — the filter and collapse state are internal.

- [ ] **Step 1: Write the failing tests**

Append to `tests/ui/tables/table-list.test.tsx` (inside the existing top-level
`describe`). Reuse whatever prop-stub helper that file already defines; if it
builds props inline, copy the shape of the nearest existing test in the file.

```tsx
  it("filters tables by a case-insensitive substring", async () => {
    const user = userEvent.setup();
    render(
      <TableList
        tables={[
          { schema: "public", name: "activity" },
          { schema: "public", name: "migrations" },
        ]}
        columnsByTable={{}}
        executing={false}
        onBrowse={vi.fn()}
        onDrop={vi.fn()}
        onTruncate={vi.fn()}
        onGenerateDdl={vi.fn()}
      />,
    );

    await user.type(screen.getByTestId(TablesAccessibility.search), "MIGRA");

    expect(screen.queryByText("activity")).toBeNull();
    expect(screen.getByText("migrations")).toBeTruthy();
  });

  it("shows a no-matches message when the filter matches nothing", async () => {
    const user = userEvent.setup();
    render(
      <TableList
        tables={[{ schema: "public", name: "activity" }]}
        columnsByTable={{}}
        executing={false}
        onBrowse={vi.fn()}
        onDrop={vi.fn()}
        onTruncate={vi.fn()}
        onGenerateDdl={vi.fn()}
      />,
    );

    await user.type(screen.getByTestId(TablesAccessibility.search), "zzz");

    expect(screen.getByText(TablesCopy.noMatchingTables)).toBeTruthy();
  });

  it("counts matches in the schema header, not the total", async () => {
    const user = userEvent.setup();
    render(
      <TableList
        tables={[
          { schema: "public", name: "activity" },
          { schema: "public", name: "migrations" },
        ]}
        columnsByTable={{}}
        executing={false}
        onBrowse={vi.fn()}
        onDrop={vi.fn()}
        onTruncate={vi.fn()}
        onGenerateDdl={vi.fn()}
      />,
    );

    const toggle = screen.getByTestId(TablesAccessibility.schemaToggle("public"));
    expect(toggle.textContent).toContain("2");

    await user.type(screen.getByTestId(TablesAccessibility.search), "activity");
    expect(toggle.textContent).toContain("1");
  });

  it("collapses a schema section and hides its rows", async () => {
    const user = userEvent.setup();
    render(
      <TableList
        tables={[{ schema: "public", name: "activity" }]}
        columnsByTable={{}}
        executing={false}
        onBrowse={vi.fn()}
        onDrop={vi.fn()}
        onTruncate={vi.fn()}
        onGenerateDdl={vi.fn()}
      />,
    );

    const toggle = screen.getByTestId(TablesAccessibility.schemaToggle("public"));
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    await user.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("activity")).toBeNull();
  });
```

Add the imports the file does not already have:

```tsx
import userEvent from "@testing-library/user-event";
import { TablesAccessibility } from "../../../src/ui/tables/tables-accessibility";
import { TablesCopy } from "../../../src/ui/tables/tables-copy";
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test tests/ui/tables/table-list.test.tsx`
Expected: FAIL — `TablesAccessibility.search` is `undefined`, so `getByTestId` cannot find the field.

- [ ] **Step 3: Add the copy and testid constants**

In `src/ui/tables/tables-copy.ts`, add to the `TablesCopy` object:

```ts
  searchTables: "Search tables",
  noMatchingTables: "No matching tables",
```

In `src/ui/tables/tables-accessibility.ts`, add to the `TablesAccessibility` object:

```ts
  search: "tables.search",
  schemaToggle: (schema: string) => `tables.schemaToggle.${schema}`,
```

- [ ] **Step 4: Add filter and collapse state to `TableList`**

In `src/ui/tables/table-list.tsx`, add to the imports:

```tsx
import { ChevronDownIcon, ChevronRightIcon, SearchIcon } from "../icons";
```

Immediately after the existing `const [displayedBySchema, setDisplayedBySchema] = useState(...)` declaration, add:

```tsx
  const [filter, setFilter] = useState("");
  const [collapsedSchemas, setCollapsedSchemas] = useState<ReadonlySet<string>>(() => new Set());
```

Replace the existing `const groups = groupTables(tables);` line with:

```tsx
  const needle = filter.trim().toLowerCase();
  const matchedTables =
    needle === "" ? tables : tables.filter((table) => table.name.toLowerCase().includes(needle));
  const groups = groupTables(matchedTables);
```

Add this function beside the existing `loadMoreSchema`:

```tsx
  function toggleSchema(schema: string): void {
    setCollapsedSchemas((current) => {
      const next = new Set(current);
      if (next.has(schema)) next.delete(schema);
      else next.add(schema);
      return next;
    });
  }
```

- [ ] **Step 5: Render the search field and the disclosure headers**

In the same file, inside the returned `<div className="table-list">`, insert the
search field as the first child, immediately before `{groups.map(...)}`:

```tsx
      <div className="ui-search table-list__search">
        <span className="ui-search__icon">
          <SearchIcon />
        </span>
        <input
          type="search"
          className="ui-search__input"
          aria-label={TablesCopy.searchTables}
          placeholder={TablesCopy.searchTables}
          data-testid={TablesAccessibility.search}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      </div>
      {groups.length === 0 ? (
        <p className="table-list__empty">{TablesCopy.noMatchingTables}</p>
      ) : null}
```

Then replace the whole `<h3 className="table-list__schema-title">{group.schema}</h3>` line with:

```tsx
            <h3 className="table-list__schema-title">
              <button
                type="button"
                className="table-list__schema-toggle"
                data-testid={TablesAccessibility.schemaToggle(group.schema)}
                aria-expanded={!collapsedSchemas.has(group.schema)}
                onClick={() => toggleSchema(group.schema)}
              >
                {collapsedSchemas.has(group.schema) ? <ChevronRightIcon /> : <ChevronDownIcon />}
                <span className="table-list__schema-name">{group.schema}</span>
                <span className="table-list__schema-count">{group.tables.length}</span>
              </button>
            </h3>
```

Wrap the rows and the "Load more" button so a collapsed section renders neither.
Inside the same `<section>`, change the `<ul className="table-list__rows">` block
and the `{hasMore ? ... : null}` block so both sit behind the guard:

```tsx
            {collapsedSchemas.has(group.schema) ? null : (
              <>
                <ul className="table-list__rows">
                  {/* ...existing row mapping, unchanged... */}
                </ul>
                {hasMore ? (
                  <button
                    type="button"
                    className="table-list__load-more"
                    onClick={() => loadMoreSchema(group.schema)}
                  >
                    {TablesCopy.loadMore}
                  </button>
                ) : null}
              </>
            )}
```

The count is `group.tables.length` — post-filter by construction, since `groups`
is built from `matchedTables`. A collapsed section keeps showing its count: the
number is what tells you what is hidden, so it is computed whether or not the
rows render.

- [ ] **Step 6: Add the chrome**

In `src/ui/tables/tables.css`, replace the existing `.table-list__schema-title`
rule with the block below and append the rest:

```css
.table-list__schema-title {
  margin: 0 0 2px 0;
}

.table-list__schema-toggle {
  align-items: center;
  background: transparent;
  border: none;
  border-radius: var(--radius);
  color: var(--neutral-600);
  cursor: pointer;
  display: flex;
  font-family: var(--font-sans);
  font-size: 11px;
  font-weight: 600;
  gap: 4px;
  letter-spacing: 0.01em;
  padding: 3px 6px;
  width: 100%;
}

.table-list__schema-toggle:hover {
  color: var(--neutral-900);
}

.table-list__schema-toggle:focus-visible {
  outline: 2px solid var(--primary-600);
  outline-offset: 2px;
}

.table-list__schema-name {
  flex: 1;
  text-align: left;
}

.table-list__schema-count {
  color: var(--neutral-500);
  font-variant-numeric: tabular-nums;
}

.table-list__search {
  margin-bottom: 0.25rem;
}

.table-list__empty {
  color: var(--neutral-600);
  font-family: var(--font-sans);
  font-size: 13px;
  margin: 0;
  padding: 0 6px;
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `bun run test tests/ui/tables/table-list.test.tsx`
Expected: PASS, including every pre-existing test in that file.

- [ ] **Step 8: Run the full gate**

Run: `bun run check`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/ui/tables tests/ui/tables/table-list.test.tsx
git commit -m "feat(tables): add table search and collapsible schema sections"
```

---

### Task 2: Permanent activity rail

The rail today is an absolutely positioned overlay on the panel's left edge
(`.app-sidebar__rail`), invisible and `pointer-events: none` until
`.app-shell--collapsed` fades it in. It becomes a real grid track that always
renders. The collapse button moves out of `ConnectionPanel`'s header onto the
rail, taking `ConnectionAccessibility.collapseConnection` with it, so exactly one
toggle exists. The rail's lower buttons are the first on-screen triggers for
Settings and Help — until now only menu events and keyboard accelerators set
`settingsOpen` / `helpOpen` (`App.tsx:539-541`).

**Files:**
- Modify: `src/ui/icons.tsx`
- Modify: `src/ui/help/help-copy.ts`
- Create: `src/ui/shell/activity-rail.tsx`
- Create: `src/ui/shell/activity-rail.css`
- Modify: `src/App.css:8-95` (grid, sidebar, rail rules) and its media queries at `:305-348`
- Modify: `src/ui/connection/connection-panel.tsx` (remove the collapse button and the `onCollapse` prop)
- Modify: `src/App.tsx:1168-1183` (replace the inline rail) and the `ConnectionPanel` call site
- Test: `tests/ui/shell/activity-rail.test.tsx` (new)
- Test: `tests/ui/connection/connection-panel.test.tsx` (drop the collapse assertions)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  ```ts
  export type ActivityRailProps = {
    collapsed: boolean;
    toggleDisabled?: boolean;
    onToggle: () => void;
    onOpenSettings: () => void;
    onOpenHelp: () => void;
  };
  export function ActivityRail(props: ActivityRailProps): React.JSX.Element;
  ```
  Also `SettingsIcon`, `HelpIcon` in `icons.tsx`; `HelpCopy.openSettings`, `HelpCopy.openHelp`.
  Task 4 uses `toggleDisabled`.

- [ ] **Step 1: Write the failing test**

Create `tests/ui/shell/activity-rail.test.tsx`:

```tsx
/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionAccessibility } from "../../../src/ui/connection/connection-accessibility";
import { ConnectionCopy } from "../../../src/ui/connection/connection-copy";
import { HelpCopy } from "../../../src/ui/help/help-copy";
import { ActivityRail } from "../../../src/ui/shell/activity-rail";

afterEach(() => {
  cleanup();
});

describe("ActivityRail", () => {
  it("labels the toggle Hide sidebar while the panel is open", () => {
    render(
      <ActivityRail
        collapsed={false}
        onToggle={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenHelp={vi.fn()}
      />,
    );

    const toggle = screen.getByTestId(ConnectionAccessibility.collapseConnection);
    expect(toggle.getAttribute("aria-label")).toBe(ConnectionCopy.collapseConnection);
  });

  it("labels the toggle Show sidebar while the panel is collapsed", () => {
    render(
      <ActivityRail
        collapsed={true}
        onToggle={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenHelp={vi.fn()}
      />,
    );

    const toggle = screen.getByTestId(ConnectionAccessibility.collapseConnection);
    expect(toggle.getAttribute("aria-label")).toBe(ConnectionCopy.showConnection);
  });

  it("calls onToggle when the toggle is pressed", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <ActivityRail
        collapsed={false}
        onToggle={onToggle}
        onOpenSettings={vi.fn()}
        onOpenHelp={vi.fn()}
      />,
    );

    await user.click(screen.getByTestId(ConnectionAccessibility.collapseConnection));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("disables the toggle when toggleDisabled is set", () => {
    render(
      <ActivityRail
        collapsed={false}
        toggleDisabled={true}
        onToggle={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenHelp={vi.fn()}
      />,
    );

    const toggle = screen.getByTestId(ConnectionAccessibility.collapseConnection);
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
  });

  it("opens settings and help from the lower buttons", async () => {
    const user = userEvent.setup();
    const onOpenSettings = vi.fn();
    const onOpenHelp = vi.fn();
    render(
      <ActivityRail
        collapsed={false}
        onToggle={vi.fn()}
        onOpenSettings={onOpenSettings}
        onOpenHelp={onOpenHelp}
      />,
    );

    await user.click(screen.getByLabelText(HelpCopy.openSettings));
    await user.click(screen.getByLabelText(HelpCopy.openHelp));

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(onOpenHelp).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test tests/ui/shell/activity-rail.test.tsx`
Expected: FAIL — cannot resolve `../../../src/ui/shell/activity-rail`.

- [ ] **Step 3: Add the two icons**

In `src/ui/icons.tsx`, append:

```tsx
export function SettingsIcon({ size = 16 }: IconProps = {}): React.JSX.Element {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <path d="M2.5 4.75h11M2.5 11.25h11" />
      <circle cx="6" cy="4.75" r="1.75" />
      <circle cx="10.5" cy="11.25" r="1.75" />
    </svg>
  );
}

export function HelpIcon({ size = 16 }: IconProps = {}): React.JSX.Element {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <circle cx="8" cy="8" r="6" />
      <path d="M6.35 6.3a1.7 1.7 0 1 1 2.2 1.85c-.4.16-.62.5-.62.92v.28" />
      <path d="M8 11.9h.01" />
    </svg>
  );
}
```

(`svgProps` already sets `fill: "none"`, `stroke: "currentColor"`, and
`strokeWidth: 1.4`, so both icons match the 16×16 grid rule.)

- [ ] **Step 4: Add the rail copy**

In `src/ui/help/help-copy.ts`, add to the `HelpCopy` object:

```ts
  openSettings: "Settings",
  openHelp: "Help",
```

- [ ] **Step 5: Write the rail component**

Create `src/ui/shell/activity-rail.tsx`:

```tsx
/**
 * Permanent icon rail on the shell's left edge. It is a real grid track, not a
 * layer that appears when the panel collapses — collapsing now animates the
 * panel to zero width and leaves the rail exactly where it already was.
 *
 * The rail owns the only sidebar toggle in the app: a panel-header copy would
 * vanish with the panel it collapses, and two toggles for one state is the
 * duplication the brief forbids for session actions.
 */
import { ConnectionAccessibility } from "../connection/connection-accessibility";
import { ConnectionCopy } from "../connection/connection-copy";
import { HelpCopy } from "../help/help-copy";
import { HelpIcon, SettingsIcon, SidebarIcon } from "../icons";
import "./activity-rail.css";

export type ActivityRailProps = {
  collapsed: boolean;
  /** Set while a sheet or confirm owns the sidebar — see AppSidebar. */
  toggleDisabled?: boolean;
  onToggle: () => void;
  onOpenSettings: () => void;
  onOpenHelp: () => void;
};

export function ActivityRail(props: ActivityRailProps): React.JSX.Element {
  const { collapsed, toggleDisabled = false, onToggle, onOpenSettings, onOpenHelp } = props;
  const toggleLabel = collapsed ? ConnectionCopy.showConnection : ConnectionCopy.collapseConnection;

  return (
    <div className="activity-rail">
      <button
        type="button"
        className="ui-icon-btn"
        data-testid={ConnectionAccessibility.collapseConnection}
        aria-label={toggleLabel}
        title={toggleLabel}
        aria-expanded={!collapsed}
        disabled={toggleDisabled}
        onClick={onToggle}
      >
        <SidebarIcon />
      </button>

      <div className="activity-rail__spacer" />

      <button
        type="button"
        className="ui-icon-btn"
        aria-label={HelpCopy.openSettings}
        title={HelpCopy.openSettings}
        onClick={onOpenSettings}
      >
        <SettingsIcon />
      </button>
      <button
        type="button"
        className="ui-icon-btn"
        aria-label={HelpCopy.openHelp}
        title={HelpCopy.openHelp}
        onClick={onOpenHelp}
      >
        <HelpIcon />
      </button>
    </div>
  );
}
```

Create `src/ui/shell/activity-rail.css`:

```css
/* Sidebars recede: the rail carries the sidebar surface, and the hairline on
   its right edge is the shell's first vertical separator. */
.activity-rail {
  align-items: center;
  background: var(--surface-sidebar);
  border-right: 1px solid var(--border-subtle);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 2px;
  height: 100vh;
  max-height: 100vh;
  padding: 0.5rem 5px;
  position: sticky;
  top: 0;
  width: var(--sidebar-rail-width);
}

.activity-rail__spacer {
  flex: 1;
}
```

- [ ] **Step 6: Run the rail test to verify it passes**

Run: `bun run test tests/ui/shell/activity-rail.test.tsx`
Expected: PASS.

- [ ] **Step 7: Make the rail a grid track**

In `src/App.css`, in the `.app-shell` rule, replace

```css
  grid-template-columns: auto minmax(0, 1fr);
```

with

```css
  /* rail (permanent) · panel (animates its own width) · main */
  grid-template-columns: var(--sidebar-rail-width) auto minmax(0, 1fr);
```

Replace the `.app-shell--collapsed .app-sidebar` rule with:

```css
.app-shell--collapsed .app-sidebar {
  width: 0;
}
```

Delete both rail rules entirely — the block starting at the comment "The rail is
the same column seen once the panel has gone" through `.app-sidebar__rail { ... }`,
and the `.app-shell--collapsed .app-sidebar__rail { ... }` rule that follows it.

In the `@media (max-width: 48rem)` block, replace

```css
  .app-shell {
    grid-template-columns: 1fr;
  }
```

with

```css
  /* Stacked: rail keeps its column, the sidebar becomes a band beside it, and
     the workspace spans the full width on the row below. */
  .app-shell {
    grid-template-columns: var(--sidebar-rail-width) 1fr;
  }

  .app-main-column {
    grid-column: 1 / -1;
  }
```

and in the same block replace

```css
  .app-shell--collapsed {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .app-shell--collapsed .app-sidebar {
    width: var(--sidebar-rail-width);
  }
```

with

```css
  .app-shell--collapsed .app-sidebar {
    width: 0;
  }
```

Leave the `@media (max-width: 64rem)` step (`--sidebar-width: 15rem`) untouched —
it sizes the panel only, and the rail track reads `--sidebar-rail-width`.

- [ ] **Step 8: Remove the collapse button from `ConnectionPanel`**

In `src/ui/connection/connection-panel.tsx`:

1. Delete the `onCollapse?: () => void;` line from `ConnectionPanelProps`.
2. Delete `onCollapse,` from the destructuring in the component body.
3. Delete the whole `{onCollapse ? ( ... ) : null}` block in the header actions —
   the button carrying `data-testid={ConnectionAccessibility.collapseConnection}`
   and the comment above it, which no longer describes anything.
4. Remove `SidebarIcon` from the `../icons` import if nothing else in the file
   uses it.

In `src/App.tsx`, delete the `onCollapse={() => setConnectionCollapsed(true)}`
prop from the `<ConnectionPanel ... />` call.

- [ ] **Step 9: Render the rail from `App.tsx`**

In `src/App.tsx`, add the import:

```tsx
import { ActivityRail } from "./ui/shell/activity-rail";
```

Replace the entire `<div className="app-sidebar">` opening through the closing
`</div>` of the inline `app-sidebar__rail` layer — that is, the comment block
starting "Rail and panel share one column", the `<div className="app-sidebar">`
line, and the whole `<div className="app-sidebar__rail"> ... </div>` — with:

```tsx
          <ActivityRail
            collapsed={connectionCollapsed}
            onToggle={() => setConnectionCollapsed(!connectionCollapsed)}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenHelp={() => setHelpOpen(true)}
          />
          <div className="app-sidebar">
```

The `<div className="app-sidebar__panel">` wrapper and everything inside it stay
exactly as they are, as does the closing `</div>` of `.app-sidebar`.

Remove the now-unused `SidebarIcon` import from `App.tsx`.

- [ ] **Step 10: Drop the stale collapse assertions**

In `tests/ui/connection/connection-panel.test.tsx`, delete any test that renders
`ConnectionPanel` with an `onCollapse` prop or queries
`ConnectionAccessibility.collapseConnection`; that behavior is now covered by
`tests/ui/shell/activity-rail.test.tsx`. Remove `onCollapse` from any shared
prop-stub helper in the file.

Run: `bun run test tests/ui/connection/connection-panel.test.tsx`
Expected: PASS.

- [ ] **Step 11: Run the full gate**

Run: `bun run check`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add src/App.css src/App.tsx src/ui/icons.tsx src/ui/help/help-copy.ts \
  src/ui/shell/activity-rail.tsx src/ui/shell/activity-rail.css \
  src/ui/connection/connection-panel.tsx \
  tests/ui/shell/activity-rail.test.tsx tests/ui/connection/connection-panel.test.tsx
git commit -m "feat(shell): make the activity rail a permanent grid track"
```

---

### Task 3: One sidebar with a Schema/Queries switcher

`ConnectionPanel` stops rendering `ConnectionTablesList`; the sidebar renders it
directly from `App` state (those props already originate in `App`, so this
removes a layer of drilling rather than adding one). `QueriesColumn` moves out of
`AppWorkspace` into the Queries tab, and the workspace loses its queries `Panel`
and `Separator`.

**Files:**
- Create: `src/ui/shell/sidebar-copy.ts`
- Create: `src/ui/shell/sidebar-accessibility.ts`
- Create: `src/ui/shell/app-sidebar.tsx`
- Modify: `src/App.css` (switcher and tab-body chrome)
- Modify: `src/ui/connection/connection-panel.tsx` (drop the tables props)
- Modify: `src/ui/shell/app-workspace.tsx` (drop the queries panel)
- Modify: `src/App.tsx`
- Test: `tests/ui/shell/app-sidebar.test.tsx` (new)
- Test: `tests/ui/shell/app-workspace.test.tsx`, `tests/ui/app-wiring.test.tsx`

**Interfaces:**
- Consumes: `ActivityRail` from Task 2.
- Produces:
  ```ts
  export type SidebarTab = "schema" | "queries";
  export type AppSidebarProps = {
    tab: SidebarTab;
    onTabChange: (tab: SidebarTab) => void;
    switcherDisabled?: boolean;
    connections: React.ReactNode;
    schema: React.ReactNode;
    queries: React.ReactNode;
  };
  export function AppSidebar(props: AppSidebarProps): React.JSX.Element;
  ```
  `SidebarAccessibility.switcher`, `SidebarAccessibility.tabPanel`;
  `SidebarCopy.views`, `SidebarCopy.schemaTab`, `SidebarCopy.queriesTab`.
  Task 4 uses `switcherDisabled`.

- [ ] **Step 1: Write the failing test**

Create `tests/ui/shell/app-sidebar.test.tsx`:

```tsx
/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppSidebar } from "../../../src/ui/shell/app-sidebar";
import { SidebarCopy } from "../../../src/ui/shell/sidebar-copy";

afterEach(() => {
  cleanup();
});

describe("AppSidebar", () => {
  it("shows the connections block in both tabs", () => {
    const { rerender } = render(
      <AppSidebar
        tab="schema"
        onTabChange={vi.fn()}
        connections={<p>connections block</p>}
        schema={<p>schema body</p>}
        queries={<p>queries body</p>}
      />,
    );
    expect(screen.getByText("connections block")).toBeTruthy();

    rerender(
      <AppSidebar
        tab="queries"
        onTabChange={vi.fn()}
        connections={<p>connections block</p>}
        schema={<p>schema body</p>}
        queries={<p>queries body</p>}
      />,
    );
    expect(screen.getByText("connections block")).toBeTruthy();
  });

  it("renders only the active tab's body", () => {
    render(
      <AppSidebar
        tab="schema"
        onTabChange={vi.fn()}
        connections={<p>connections block</p>}
        schema={<p>schema body</p>}
        queries={<p>queries body</p>}
      />,
    );

    expect(screen.getByText("schema body")).toBeTruthy();
    expect(screen.queryByText("queries body")).toBeNull();
  });

  it("reports the selected tab when the other segment is chosen", async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();
    render(
      <AppSidebar
        tab="schema"
        onTabChange={onTabChange}
        connections={<p>connections block</p>}
        schema={<p>schema body</p>}
        queries={<p>queries body</p>}
      />,
    );

    await user.click(screen.getByLabelText(SidebarCopy.queriesTab));

    expect(onTabChange).toHaveBeenCalledWith("queries");
  });

  it("disables both segments while switcherDisabled is set", () => {
    render(
      <AppSidebar
        tab="schema"
        onTabChange={vi.fn()}
        switcherDisabled={true}
        connections={<p>connections block</p>}
        schema={<p>schema body</p>}
        queries={<p>queries body</p>}
      />,
    );

    expect((screen.getByLabelText(SidebarCopy.schemaTab) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText(SidebarCopy.queriesTab) as HTMLInputElement).disabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test tests/ui/shell/app-sidebar.test.tsx`
Expected: FAIL — cannot resolve `../../../src/ui/shell/app-sidebar`.

- [ ] **Step 3: Add the copy and testid modules**

Create `src/ui/shell/sidebar-copy.ts`:

```ts
/** English chrome copy for the sidebar's view switcher. */
export const SidebarCopy = {
  views: "Sidebar view",
  schemaTab: "Schema",
  queriesTab: "Queries",
} as const;
```

Create `src/ui/shell/sidebar-accessibility.ts`:

```ts
/** Stable accessibility identifiers for the sidebar shell. */
export const SidebarAccessibility = {
  switcher: "sidebar.switcher",
  tabPanel: "sidebar.tabPanel",
} as const;
```

- [ ] **Step 4: Write the sidebar component**

Create `src/ui/shell/app-sidebar.tsx`:

```tsx
/**
 * The app's single navigation column: a persistent Connections block above a
 * two-way view switch. The session is context for everything below it, so it
 * stays visible in both tabs rather than becoming a third view.
 *
 * The switch is a real radio group in visually hidden inputs (the `.ui-segment`
 * pattern already used for Visual/SQL), so roving focus and arrow keys come
 * from the platform and only the OS dot is replaced.
 */
import { SidebarAccessibility } from "./sidebar-accessibility";
import { SidebarCopy } from "./sidebar-copy";

export type SidebarTab = "schema" | "queries";

export type AppSidebarProps = {
  tab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  /** Set while a sheet or confirm owns the sidebar — switching would strand it. */
  switcherDisabled?: boolean;
  connections: React.ReactNode;
  schema: React.ReactNode;
  queries: React.ReactNode;
};

const TAB_LABELS: Record<SidebarTab, string> = {
  schema: SidebarCopy.schemaTab,
  queries: SidebarCopy.queriesTab,
};

export function AppSidebar(props: AppSidebarProps): React.JSX.Element {
  const { tab, onTabChange, switcherDisabled = false, connections, schema, queries } = props;

  return (
    <div className="app-sidebar__inner">
      {connections}

      <div
        className="ui-segment app-sidebar__switcher"
        role="radiogroup"
        aria-label={SidebarCopy.views}
        data-testid={SidebarAccessibility.switcher}
      >
        {(["schema", "queries"] as const).map((value) => (
          <label key={value} className="ui-segment__item">
            <input
              type="radio"
              className="ui-visually-hidden"
              name="app-sidebar-tab"
              value={value}
              checked={tab === value}
              disabled={switcherDisabled}
              onChange={() => onTabChange(value)}
            />
            {TAB_LABELS[value]}
          </label>
        ))}
      </div>

      <div className="app-sidebar__tabpanel" data-testid={SidebarAccessibility.tabPanel}>
        {tab === "schema" ? schema : queries}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run the sidebar test to verify it passes**

Run: `bun run test tests/ui/shell/app-sidebar.test.tsx`
Expected: PASS.

- [ ] **Step 6: Strip the tables props from `ConnectionPanel`**

In `src/ui/connection/connection-panel.tsx`:

1. Delete this whole block from the render — the panel no longer draws tables:

```tsx
      {sessionClaimed ? (
        <ConnectionTablesList
          tables={tables}
          /* ...through... */
          saveTextFile={saveTextFile}
        />
      ) : null}
```

2. Delete the `ConnectionTablesList` import.
3. Delete these props from `ConnectionPanelProps` and from the destructuring:
   `tables`, `tablesLoading`, `tablesErrorMessage`, `onBrowse`, `columnsByTable`,
   `executing`, `onDrop`, `onTruncate`, `onGenerateDdl`, `onRefresh`,
   `onFetchAll`, `onExpand`.
4. Keep `saveCsvFile` and `saveTextFile`: the create-database and DDL flows in
   this file still use them. Verify with `grep -n "saveCsvFile\|saveTextFile" src/ui/connection/connection-panel.tsx` before deleting anything.

- [ ] **Step 7: Remove the queries panel from `AppWorkspace`**

In `src/ui/shell/app-workspace.tsx`:

1. Delete the `queriesPanel` constant (the `<Panel className="app-workspace-split__queries">` block and the `<QueriesColumn ... />` inside it) **and** the `queriesRow` helper below it.
2. Replace the early return and the `WorkspaceSplit` call so nothing wraps the
   canvas horizontally any more. `WorkspaceSplit` itself is untouched — the
   vertical canvas/results split stays. The result reads exactly:

```tsx
  if (!workspaceReady) {
    return <div className="app-workspace-main" />;
  }

  return (
    <WorkspaceSplit
      canvas={
        <div className="app-workspace-main">
          <TabBar
            tabs={tabs.map((tab, index) => {
              const savedQueryName = libraryQueries.find(
                (query) => query.id === tab.savedQueryId,
              )?.name;
              const profile =
                profiles.find((candidate) => candidate.id === tab.connectionId) ??
                profiles.find((candidate) => candidate.id === profileId);
              const connectionDisplayName = profile ? profile.name?.trim() || profile.host : null;
              return {
                id: tab.id,
                title: formatTabTitle({
                  databaseName: tab.databaseName,
                  savedQueryName,
                  connectionDisplayName,
                  index: index + 1,
                }),
                isActive: tab.id === activeTabId,
                pendingClose: pendingDeletedIds.has(tab.id),
              };
            })}
            onNewTab={onNewTab}
            onSwitchTab={onSwitchTab}
            onCloseTab={onCloseTab}
          />
          {canvas}
        </div>
      }
      results={/* ...unchanged: the existing app-results-wrapper block... */}
    />
  );
```

   Note the tab-title mapping still reads `libraryQueries`, `profiles`, and
   `profileId`, so those three props **stay** on `AppWorkspaceProps` even though
   the queries column is gone.
3. Delete the `QueriesColumn` import, and the `react-resizable-panels` import if
   nothing else in the file uses it.
4. Delete these props from `AppWorkspaceProps` and the destructuring:
   `libraryFolders`, `savedQueryId`, `executingQueryId`, `schemaNames`,
   `selectedSchema`, `schemaError`, `onSelectQuery`, `onNewQuery`,
   `onRenameQuery`, `onDeleteQuery`, `onMoveQuery`, `onDeleteFolder`,
   `onLibraryRefresh`, `onDuplicateQuery`, `onRenameFolder`, `onCreateFolder`,
   `hasCachedResult`, `onSelectSchema`, `onDismissSchemaError`.
   Keep `libraryQueries`, `profiles`, and `profileId` — the tab-title mapping in
   Step 7.2 still reads all three.

In `src/App.css`, delete these three now-dead rules: `.app-workspace-split`,
`.app-workspace-split__queries, .app-workspace-split__main` (the shared
`min-height`/`min-width` rule), and `.app-workspace-split__queries`. In the two
separator rules, delete only the `.app-workspace-split__separator` selectors and
keep their `.workspace-split__separator` siblings — those still style the
vertical canvas/results handle:

```css
.workspace-split__separator {
  background: var(--border-subtle);
  transition: background-color var(--duration-fast) var(--ease-standard);
}

.workspace-split__separator:hover,
.workspace-split__separator[data-resize-handle-state="drag"] {
  background: var(--primary-400);
}
```

Keep `.app-workspace-main` — Step 7.2 still renders that class. Confirm nothing
else survives: `grep -rn "app-workspace-split" src` must return no hits.

- [ ] **Step 8: Wire it in `App.tsx`**

Add the imports:

```tsx
import { AppSidebar, type SidebarTab } from "./ui/shell/app-sidebar";
import { ConnectionTablesList } from "./ui/connection/connection-tables-list";
import { QueriesColumn } from "./ui/library/queries-column";
```

Add the state beside the other `useState` calls:

```tsx
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("schema");
```

Replace the `<div className="app-sidebar__panel"> ... </div>` contents so the
panel hosts `AppSidebar`. `ConnectionPanel` keeps every prop it still declares
after Step 6; the tables props move onto `ConnectionTablesList`, and the queries
props move onto `QueriesColumn` verbatim from the `AppWorkspace` call site:

```tsx
            <div
              className="app-sidebar__panel"
              inert={connectionCollapsed ? true : undefined}
              aria-hidden={connectionCollapsed ? true : undefined}
            >
              <AppSidebar
                tab={sidebarTab}
                onTabChange={setSidebarTab}
                connections={
                  <ConnectionPanel
                    ref={connectionPanelRef}
                    ipc={ipc}
                    isConnected={isConnected}
                    activeProfileId={profileId ?? undefined}
                    formVisible={formVisible}
                    onFormVisibleChange={handleFormVisibleChange}
                    onProfilesLoaded={handleProfilesLoaded}
                    saveCsvFile={(csv, defaultPath) => ipc.saveCsvFile(csv, defaultPath)}
                    saveTextFile={(text, defaultPath, filter) =>
                      ipc.saveTextFile(text, defaultPath, filter)
                    }
                    connectionId={connectionId}
                    databaseName={databaseName}
                    onSwitchDatabase={handleSwitchDatabase}
                    onClearDatabase={handleClearDatabaseSelection}
                    missingDatabase={missingDatabase}
                    connectProfile={(id) => stores.session.getState().connect(id)}
                    disconnectSession={() => stores.session.getState().disconnect()}
                    onConnected={handleConnected}
                    onDisconnected={handleDisconnected}
                    onSwitchSuccess={handleSwitchSuccess}
                    onSwitchFailure={handleSwitchFailure}
                  />
                }
                schema={
                  <ConnectionTablesList
                    tables={visibleTables}
                    tablesLoading={tablesLoading}
                    tablesErrorMessage={tablesErrorMessage}
                    onBrowse={handleBrowseTable}
                    columnsByTable={columnsByTable}
                    executing={status.kind === "running"}
                    onDrop={handleDropTable}
                    onTruncate={handleTruncateTable}
                    onGenerateDdl={handleGenerateTableDdl}
                    onRefresh={handleRefreshTables}
                    onFetchAll={handleFetchAllTable}
                    onExpand={handleExpandTable}
                    saveCsvFile={(csv, defaultPath) => ipc.saveCsvFile(csv, defaultPath)}
                    saveTextFile={(text, defaultPath, filter) =>
                      ipc.saveTextFile(text, defaultPath, filter)
                    }
                  />
                }
                queries={
                  <QueriesColumn
                    queries={libraryQueries}
                    folders={libraryFolders}
                    selectedQueryId={savedQueryId}
                    onSelectQuery={handleSelectQuery}
                    onNewQuery={handleNewQuery}
                    onRenameQuery={handleRenameQuery}
                    onDeleteQuery={handleDeleteQuery}
                    onMoveQuery={handleMoveQuery}
                    onDeleteFolder={handleDeleteFolder}
                    onRefresh={handleLibraryRefresh}
                    onDuplicateQuery={(id) => {
                      void stores.library.getState().duplicateSavedQuery(id);
                    }}
                    onRenameFolder={(id, name) => {
                      void stores.library.getState().renameQueryFolder(id, name);
                    }}
                    onCreateFolder={(name) => stores.library.getState().createQueryFolder(name)}
                    hasCachedResult={(id) => savedQueryCacheRef.current.read(id) !== null}
                    executingQueryId={executingQueryId}
                    schemas={schemaNames}
                    selectedSchema={selectedSchema}
                    onSelectSchema={(schema) => {
                      void handleSelectSchema(schema);
                    }}
                    schemaError={schemaError}
                    onDismissSchemaError={() => setSchemaError(null)}
                  />
                }
              />
            </div>
```

Then delete the same props from the `<AppWorkspace ... />` call to match the
props removed in Step 7 — but keep `libraryQueries`, `profiles`, and `profileId`
there, since the tab-title mapping still needs them. `libraryQueries` is now
passed to both `AppWorkspace` (for titles) and `QueriesColumn` (for the list). Compare the exact prop names `QueriesColumn` declares
before pasting: `grep -n "^  [a-zA-Z]*[?]*:" src/ui/library/queries-column.tsx`.

- [ ] **Step 9: Add the sidebar chrome**

In `src/App.css`, replace the `.app-shell .connection-panel` rule with the block
below — the border and scroll now belong to the sidebar's inner column, not to
the connection panel, which is one block inside it:

```css
.app-shell .connection-panel {
  background: transparent;
  box-sizing: border-box;
  padding: 0 0 0.5rem;
}

.app-sidebar__inner {
  background: var(--surface-sidebar);
  border-right: 1px solid var(--border-subtle);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  height: 100%;
  max-height: 100vh;
  min-height: 0;
  overflow: hidden;
  padding: 0.5rem 0.5rem 1rem;
  width: var(--sidebar-width);
}

.app-sidebar__switcher {
  align-self: stretch;
}

.app-sidebar__switcher .ui-segment__item {
  flex: 1;
}

.app-sidebar__tabpanel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: auto;
}
```

In the `@media (max-width: 48rem)` block, replace the
`.app-shell .connection-panel` override with one on the inner column:

```css
  .app-sidebar__inner {
    border-bottom: 1px solid var(--border-subtle);
    border-right: none;
    height: auto;
    max-height: none;
    width: 100%;
  }
```

- [ ] **Step 10: Update the workspace and wiring tests**

In `tests/ui/shell/app-workspace.test.tsx`, delete every assertion that queries
`QueriesAccessibility.*` and remove the deleted props from `stubProps`.

In `tests/ui/app-wiring.test.tsx`, re-point any assertion that reached the
queries column through the workspace so it renders `App` and finds the column in
the sidebar; where a test selects the Queries view first, click
`screen.getByLabelText(SidebarCopy.queriesTab)` before asserting.

Run: `bun run test tests/ui/shell tests/ui/app-wiring.test.tsx`
Expected: PASS.

- [ ] **Step 11: Run the full gate**

Run: `bun run check`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add src tests
git commit -m "feat(shell): merge connection and queries columns into one sidebar"
```

---

### Task 4: Blocking surfaces disable the switcher and the toggle

`ConnectionPanel` already treats its `position: fixed` sheet as a reason not to
collapse the column. Switching tabs is the same failure mode. Both panels report
whether they own a blocking surface; the shell disables the switcher and the rail
toggle while either does. Sheets stay mounted where they are, so the shared
Escape LIFO registry is untouched.

**Files:**
- Modify: `src/ui/connection/connection-panel.tsx`
- Modify: `src/ui/library/queries-column.tsx`
- Modify: `src/App.tsx`
- Test: `tests/ui/connection/connection-panel.test.tsx`
- Test: `tests/ui/library/queries-column.test.tsx`

**Interfaces:**
- Consumes: `AppSidebar.switcherDisabled` and `ActivityRail.toggleDisabled` from Tasks 2–3.
- Produces: `onBlockingChange?: (blocking: boolean) => void` on both `ConnectionPanelProps` and `QueriesColumnProps`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/ui/connection/connection-panel.test.tsx`, matching the render
helper that file already uses for a panel with a visible form:

```tsx
  it("reports a blocking surface while the connection form is visible", () => {
    const onBlockingChange = vi.fn();
    renderPanel({ formVisible: true, onBlockingChange });

    expect(onBlockingChange).toHaveBeenCalledWith(true);
  });

  it("reports no blocking surface while the form is closed", () => {
    const onBlockingChange = vi.fn();
    renderPanel({ formVisible: false, onBlockingChange });

    expect(onBlockingChange).toHaveBeenLastCalledWith(false);
  });
```

Append to `tests/ui/library/queries-column.test.tsx`:

```tsx
  it("reports a blocking surface while a sheet is open", async () => {
    const user = userEvent.setup();
    const onBlockingChange = vi.fn();
    render(
      <QueriesColumn
        queries={[q1]}
        folders={[]}
        selectedQueryId="q1"
        onSelectQuery={vi.fn()}
        onNewQuery={vi.fn()}
        onRenameQuery={vi.fn()}
        onDeleteQuery={vi.fn()}
        onMoveQuery={vi.fn()}
        onDeleteFolder={vi.fn()}
        onBlockingChange={onBlockingChange}
      />,
    );

    expect(onBlockingChange).toHaveBeenLastCalledWith(false);

    await user.click(screen.getByLabelText(QueriesCopy.rename));

    expect(onBlockingChange).toHaveBeenLastCalledWith(true);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test tests/ui/connection/connection-panel.test.tsx tests/ui/library/queries-column.test.tsx`
Expected: FAIL — `onBlockingChange` is never called (the prop does not exist).

- [ ] **Step 3: Report blocking from `ConnectionPanel`**

In `src/ui/connection/connection-panel.tsx`, add to `ConnectionPanelProps`:

```tsx
  /** True while a sheet or confirm owns this panel, so the shell can freeze the
      sidebar's view switch — a fixed-position sheet would otherwise be stranded
      over a body that is no longer there. */
  onBlockingChange?: (blocking: boolean) => void;
```

Destructure `onBlockingChange` in the component body, then add this effect below
the existing effects (`confirm` is the value returned by
`useConnectionConfirmations`):

```tsx
  const blocking = formVisible || confirm.hasPending;
  useEffect(() => {
    onBlockingChange?.(blocking);
  }, [blocking, onBlockingChange]);
```

- [ ] **Step 4: Report blocking from `QueriesColumn`**

In `src/ui/library/queries-column.tsx`, add to its props type:

```tsx
  /** True while one of this column's sheets is open — see ConnectionPanel. */
  onBlockingChange?: (blocking: boolean) => void;
```

Destructure it, and add beside the existing `sheetOpen` derivation:

```tsx
  useEffect(() => {
    onBlockingChange?.(sheet !== null);
  }, [sheet, onBlockingChange]);
```

Add `useEffect` to the `react` import in both files if it is not already there.

- [ ] **Step 5: Freeze the switcher and toggle in `App.tsx`**

Add the state:

```tsx
  const [connectionBlocking, setConnectionBlocking] = useState(false);
  const [queriesBlocking, setQueriesBlocking] = useState(false);
  const sidebarBlocked = connectionBlocking || queriesBlocking;
```

Pass `onBlockingChange={setConnectionBlocking}` to `<ConnectionPanel>` and
`onBlockingChange={setQueriesBlocking}` to `<QueriesColumn>`, then
`switcherDisabled={sidebarBlocked}` to `<AppSidebar>` and
`toggleDisabled={sidebarBlocked}` to `<ActivityRail>`.

Pass the setters directly — never an inline arrow. `onBlockingChange` sits in the
dependency array of the effects from Steps 3–4, so a fresh function identity on
every render would turn them into a render loop. A `useState` setter's identity
is stable, which is the whole reason this wiring is safe.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun run test tests/ui/connection/connection-panel.test.tsx tests/ui/library/queries-column.test.tsx`
Expected: PASS.

- [ ] **Step 7: Run the full gate**

Run: `bun run check`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src tests
git commit -m "feat(shell): freeze the sidebar switcher while a sheet is open"
```

---

### Task 5: Move the schema picker to the tab it controls

The "All schemas" dropdown lives in the Queries toolbar but does not filter
queries — `App.tsx` derives `visibleTables` from `selectedSchema` and feeds the
table list. With one sidebar the control and its target must sit in the same tab.
The state stays in `App.tsx`; only the render site moves.

**Files:**
- Modify: `src/ui/tables/tables-copy.ts`
- Modify: `src/ui/tables/tables-accessibility.ts`
- Modify: `src/ui/connection/connection-tables-list.tsx`
- Modify: `src/ui/library/queries-column-toolbar.tsx`
- Modify: `src/ui/library/queries-column.tsx`
- Modify: `src/App.tsx`
- Test: `tests/ui/connection/connection-tables-list.test.tsx`
- Test: `tests/ui/library/queries-column.test.tsx`

**Interfaces:**
- Consumes: the sidebar from Task 3.
- Produces: `ConnectionTablesList` gains `schemas?: string[]`, `selectedSchema?: string | null`, `onSelectSchema?: (schema: string | null) => void`, `schemaError?: string | null`, `onDismissSchemaError?: () => void`. `TablesAccessibility.schemaPicker`, `TablesCopy.schema`, `TablesCopy.allSchemas`, `TablesCopy.ok`. `QueriesColumn` and `QueriesColumnToolbar` lose the same five props, and `QueriesAccessibility.schemaPicker` is deleted.

- [ ] **Step 1: Write the failing test**

Append to `tests/ui/connection/connection-tables-list.test.tsx`:

```tsx
  it("filters by schema through the picker", async () => {
    const user = userEvent.setup();
    const onSelectSchema = vi.fn();
    render(
      <ConnectionTablesList
        tables={[{ schema: "public", name: "activity" }]}
        tablesLoading={false}
        tablesErrorMessage={null}
        schemas={["public", "audit"]}
        selectedSchema={null}
        onSelectSchema={onSelectSchema}
      />,
    );

    await user.selectOptions(screen.getByTestId(TablesAccessibility.schemaPicker), "audit");

    expect(onSelectSchema).toHaveBeenCalledWith("audit");
  });

  it("hides the picker when there is only one schema", () => {
    render(
      <ConnectionTablesList
        tables={[{ schema: "public", name: "activity" }]}
        tablesLoading={false}
        tablesErrorMessage={null}
        schemas={["public"]}
        selectedSchema={null}
        onSelectSchema={vi.fn()}
      />,
    );

    expect(screen.queryByTestId(TablesAccessibility.schemaPicker)).toBeNull();
  });
```

Add the imports the file lacks:

```tsx
import userEvent from "@testing-library/user-event";
import { TablesAccessibility } from "../../../src/ui/tables/tables-accessibility";
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test tests/ui/connection/connection-tables-list.test.tsx`
Expected: FAIL — no element carries `tables.schemaPicker`.

- [ ] **Step 3: Add the copy and testid**

In `src/ui/tables/tables-copy.ts`, add:

```ts
  schema: "Schema",
  allSchemas: "All schemas",
  ok: "OK",
```

In `src/ui/tables/tables-accessibility.ts`, add:

```ts
  schemaPicker: "tables.schemaPicker",
```

- [ ] **Step 4: Render the picker in `ConnectionTablesList`**

In `src/ui/connection/connection-tables-list.tsx`, add the five props to the
props type and destructuring, add `import { TablesAccessibility } from "../tables/tables-accessibility";`
and `import { TablesCopy } from "../tables/tables-copy";`, then render the picker
above `{body}` inside the existing `<div className="connection-tables">`:

```tsx
      {schemas !== undefined && schemas.length > 1 && onSelectSchema ? (
        <label className="connection-tables__schema">
          <span className="ui-visually-hidden">{TablesCopy.schema}</span>
          <select
            className="ui-quiet-select"
            data-testid={TablesAccessibility.schemaPicker}
            value={selectedSchema ?? ""}
            onChange={(event) =>
              onSelectSchema(event.target.value === "" ? null : event.target.value)
            }
          >
            <option value="">{TablesCopy.allSchemas}</option>
            {schemas.map((schema) => (
              <option key={schema} value={schema}>
                {schema}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {schemaError ? (
        <div className="connection-tables__schema-error" role="alert">
          <p>{schemaError}</p>
          <button type="button" onClick={onDismissSchemaError}>
            {TablesCopy.ok}
          </button>
        </div>
      ) : null}
```

Move the `.queries-column__schema` and `.queries-column__schema-error` rules from
`src/ui/library/queries.css` into `src/ui/connection/connection.css`, renamed to
`.connection-tables__schema` and `.connection-tables__schema-error`.

- [ ] **Step 5: Delete the picker from the queries toolbar**

In `src/ui/library/queries-column-toolbar.tsx`, delete the `schemas`,
`selectedSchema`, `onSelectSchema`, `schemaError`, and `onDismissSchemaError`
props and both JSX blocks that used them (the `<label className="queries-column__schema">`
block and the `{schemaError ? ... : null}` block). In
`src/ui/library/queries-column.tsx`, delete the same five props and stop
forwarding them to the toolbar. Delete `schemaPicker` from
`src/ui/library/queries-accessibility.ts`, and delete the now-unused
`QueriesCopy.schema`, `QueriesCopy.allSchemas`, and `QueriesCopy.ok` entries —
confirm each is unused first with `grep -rn "QueriesCopy.allSchemas" src tests`.

- [ ] **Step 6: Re-point the props in `App.tsx`**

Move `schemas={schemaNames}`, `selectedSchema={selectedSchema}`,
`onSelectSchema={...}`, `schemaError={schemaError}`, and
`onDismissSchemaError={...}` off the `<QueriesColumn>` element and onto the
`<ConnectionTablesList>` element in the sidebar's `schema` slot.

- [ ] **Step 7: Update the queries tests**

In `tests/ui/library/queries-column.test.tsx`, delete every test and prop that
referenced `QueriesAccessibility.schemaPicker` or the schema props.

Run: `bun run test tests/ui/library tests/ui/connection`
Expected: PASS.

- [ ] **Step 8: Run the full gate**

Run: `bun run check`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src tests
git commit -m "refactor(sidebar): move the schema picker to the tab it filters"
```

---

## Manual verification

After Task 5, run the app and confirm by eye — automated tests do not cover
layout:

```bash
bun run tauri dev
```

1. The rail is visible with the panel open and with the panel collapsed; the
   toggle's tooltip swaps between "Hide sidebar" and "Show sidebar".
2. Collapsing animates the panel closed without the rail moving.
3. The Connections block stays visible in both tabs.
4. With the connection form open, both switcher segments and the rail toggle are
   disabled; closing the form re-enables them.
5. Typing in the table search narrows the list and the schema count follows;
   collapsing a schema hides its rows and its "Load more" button.
6. The schema dropdown appears in the Schema tab (only with more than one
   schema) and filters the table list.
7. Narrow the window past 64rem and 48rem: the panel steps to 15rem, then the
   layout stacks with the rail beside the sidebar band.

The brief requires new chrome to be checked on WebKitGTK, the least consistent of
the three engines. The rail track and the `.ui-segment` focus ring are what to
look at there.
