# Sidebar Redesign — One Panel, Permanent Rail

Date: 2026-08-19
Status: design approved, spec under review

## Problem

The app shell spends two independent columns on navigation. `ConnectionPanel`
(20rem, fixed) holds profiles, the database picker, and the schema table list.
`QueriesColumn` (220px, resizable) sits separately inside `AppWorkspace`, beside
the tab strip and canvas. Each column carries its own header, its own toolbar,
and its own search field, so the same three chrome elements are drawn twice
before any data appears. On a schema with two hundred tables the left column is
a single unbroken scroll with no grouping and no counts.

The goal is a tidier, denser sidebar in the shape of Seaquel's: one panel, a
segmented view switcher inside it, collapsible sections with counts, and a
permanent icon rail.

## Non-goals

- **Dark mode.** The creative brief lists it under Known Gaps ("the app ships
  light-only on all three platforms"). The reference screenshot is dark; only
  its structure and density are being copied, not its palette.
- **New hues, radii, or fonts.** The brief mandates Inter + JetBrains Mono, hue
  245, `--radius: 4px`, and forbids inventing values without refining the brief.
  This redesign introduces no color and no radius.
- **Moving query History into the sidebar.** History stays a sheet opened from
  the canvas toolbar (`visual-query/canvas.tsx`). Relocating it would duplicate
  the affordance and is a separate spec.

## Architecture

### Shell grid

`.app-shell` currently declares `grid-template-columns: auto minmax(0, 1fr)`,
with the rail as an absolutely positioned overlay on the panel's left edge that
only becomes visible once `.app-shell--collapsed` shrinks the column to
`--sidebar-rail-width`.

It becomes three tracks:

```css
grid-template-columns: var(--sidebar-rail-width) auto minmax(0, 1fr);
/*                     rail (permanent)          panel  main        */
```

The rail is a real track that always renders. Collapse animates the panel's
width from `--sidebar-width` to `0` while the rail stays put. The overlay trick
and the `.app-shell--collapsed .app-sidebar__rail` rules are **deleted**, not
layered on: the permanent rail is what the collapsed state was already faking.

The panel keeps today's collapse mechanics — a fixed inner width so contents do
not reflow mid-animation while the column narrows.

Two media queries touch this. At `max-width: 64rem`, `--sidebar-width` steps to
`15rem` — a step rather than a range, because a width transition needs two
definite endpoints; the rail track is unaffected and must not be computed
against 20rem there. At `max-width: 48rem` the shell stacks to a single column
with the sidebar as a full-width band above the workspace; rail and panel fold
into that band, and the collapsed state drops back to `auto minmax(0, 1fr)`.

### Who owns the collapse toggle

Today there are two controls. The rail's expand button (`App.tsx:1174`,
`ConnectionCopy.showConnection`, no testid) is reachable only while collapsed;
`ConnectionPanel`'s header holds the collapse button carrying
`data-testid={ConnectionAccessibility.collapseConnection}` and
`disabled={formVisible}`.

With a permanent rail, **the rail owns the single toggle.** Its `aria-label` and
`title` swap between `ConnectionCopy.showConnection` and
`ConnectionCopy.collapseConnection` with state, and it carries
`ConnectionAccessibility.collapseConnection` so the existing assertions keep a
target. The collapse button is removed from the Connections header, which then
holds only its label and `+`. The blocking rule below applies to this one
button.

### Sidebar composition

```
┌──┬──────────────────────┐
│▣ │ ˅ Connections      + │   persistent block; ▣ = the one collapse toggle
│  │     ▪ fastrack-local │
│  │     ▪ fastrack-prod  │
│  │   ▤ fastrack_db    ˅ │   database picker
│  │ ┌─────────┬────────┐ │
│  │ │ Schema  │Queries │ │   .ui-segment, two tabs
│  │ └─────────┴────────┘ │
│  │ 🔍 Search tables     │   .ui-search  ── new
│  │ All schemas        ˅ │   moved here from the Queries toolbar
│⚙ │ ˅ public          42 │   .ui-section-label + count, collapsible
│? │     ▤ activity       │
└──┴──────────────────────┘
```

The Connections block stays above the switcher and is visible in both tabs — the
session is context for everything below it, not one view among several.

### Components

| File | Change |
|------|--------|
| `src/ui/shell/activity-rail.tsx` | **new** — presentational rail: sidebar toggle (top), settings and help (bottom), all `.ui-icon-btn` with existing copy constants as `aria-label` |
| `src/ui/shell/app-sidebar.tsx` | **new** — owns the segmented switcher and slots the active tab's body |
| `src/ui/connection/connection-panel.tsx` | shrinks to the Connections block (header, profile list, database picker, its sheets and confirms). Stops rendering `ConnectionTablesList` |
| `src/ui/connection/connection-tables-list.tsx` | gains the table search field (below); otherwise unchanged. Rendered by the sidebar directly from `App` state, removing one layer of prop drilling (its props already originate in `App`) |
| `src/ui/library/queries-column.tsx` | internals unchanged; relocated from `AppWorkspace` into the Queries tab |
| `src/ui/shell/app-workspace.tsx` | the `queries` `Panel` and its `Separator` are removed; the workspace is tab strip + canvas + results |
| `src/App.tsx` | routes the Queries props to the sidebar; adds `sidebarTab` state |
| `src/App.css` | three-track grid, permanent rail, deleted overlay rules |

### Reused primitives

Nothing here is a new atom. `controls.css` already ships every piece:

- `.ui-segment` / `.ui-segment__item` — the `<label>` + visually hidden radio
  pattern, already used for Visual/SQL in `visual-query/toolbar.tsx`. The
  browser keeps roving focus and arrow keys; only the OS dot is replaced.
- `.ui-search` — leading-glyph search field.
- `.ui-section-label` — 11px/600 neutral-600, sentence case (no ALL-CAPS).
- `.ui-row` — flush list row with hover-reveal actions.
- `ChevronRightIcon` / `ChevronDownIcon` in `icons.tsx` for disclosure. No text
  glyphs and no `::after` content, per the brief.

## What is genuinely new

Most of this spec is relocation. Four things are not, and each is named here so
review can price them.

### 1. Table search (approved addition)

The Schema tab gains a search field, which the table list does not have today —
only `QueriesColumn` does (`queries-column-toolbar.tsx:96`). Without it the tab
is still a two-hundred-row unbroken scroll, merely a denser one, and the brief
already names its placeholder ("Search tables") as a copy example.

It is a case-insensitive substring filter over the table name, mirroring the
Queries filter exactly: `.ui-search` markup, `aria-label` and `placeholder` from
a copy constant, state local to the list component, no debounce. When the filter
matches nothing the list shows the same "no matches" empty-state shape the
Queries column uses. The section count reflects matches, not the total.

### 2. Schema sections gain counts and collapse

`TableList` already groups by schema — `<h3 class="table-list__schema-title">`
per group, with per-schema batching (`SCHEMA_BATCH_SIZE` plus a "load more"
button). Grouping is therefore not new. Two things are: the header gains a match
count, and it becomes a disclosure button with `aria-expanded`, matching the
folder rows the Queries column already collapses. On a database with several
schemas this is what keeps the tab short; on a single-schema database it costs
one chevron.

### 3. The schema picker moves to the tab it controls

`schemas` / `selectedSchema` / `onSelectSchema` are props of
`QueriesColumnToolbar` today — the "All schemas" dropdown lives in the Queries
column. It does not filter queries. It filters the **table list**: `App.tsx:211`
derives `visibleTables` from `selectedSchema` and passes it to
`ConnectionPanel`. The control and the thing it controls are in different
columns.

Merging the columns makes that indefensible rather than merely odd, so the
picker moves into the Schema tab beside the search field. Its state stays in
`App.tsx` and nothing about `visibleTables` changes; only the render site moves.
This is a correction, not a feature.

### 4. The Queries heading goes, because the tab is the heading

`queries-column-toolbar.tsx` renders `<h2>Queries</h2>` directly beneath a
switcher segment reading "Queries". The heading was the column's only name in the
workspace; the tab names it now, so the `<h2>` is deleted and `QueriesCopy.title`
becomes the section's `aria-label`. The Connection panel keeps its own title —
no tab is labeled "Connection", and it names a region.

### 5. Settings and help get their first visible trigger

`helpOpen`, `shortcutsOpen`, and `settingsOpen` exist in `App.tsx`, but the only
things that set them are menu events and keyboard accelerators
(`App.tsx:539-541`, via `workspace-accelerators`). There is no on-screen control
today. The rail's bottom buttons are therefore an addition, not a move — and
because nothing visible is being duplicated, the brief's "a session action never
exists twice at once" rule is satisfied. Shortcuts stays keyboard/menu-only; two
rail buttons, not three.

## State

One new piece of state in the shell: `sidebarTab: "schema" | "queries"` in
`App.tsx`, defaulting to `"schema"`. It is **not** persisted — date format is
the only persisted preference today, and a view toggle does not earn a second
one. The table filter string is local to `TableList`, which already owns
`groupTables` and the section headers the filter and the counts act on, the way
the queries filter is local to `QueriesColumn`.

Both tabs work independently of the session. `library-store.refresh()` calls
`ipc.listSavedQueries()` with no connection id, so Queries stays usable while
disconnected. The Schema tab while disconnected shows the existing empty state,
`ConnectionCopy.noTablesFound`.

Section counts: the Schema tab shows the table count per schema; the Queries tab
reuses `countsByFolder`, already computed in `queries-column.tsx`. Counts render
in neutral-500 with `tabular-nums`.

## Blocking surfaces

`ConnectionPanel` already disables its collapse button while `formVisible`,
because its `position: fixed` sheet would otherwise float over a column that no
longer exists. Switching sidebar tabs is the identical failure mode and needs
the same guard. The rule:

> While any blocking surface is open in the sidebar, **both the switcher and the
> collapse toggle are disabled.**

The signal is reported upward rather than inferred:

- `ConnectionPanel` gains `onBlockingChange(boolean)`, emitting
  `formVisible || confirm.hasPending || pickerBlocking`. `hasPending` already
  exists (`use-connection-confirmations.tsx:177`).
- `ConnectionDatabasePicker` gains the same prop, emitting
  `createOpen || deleteOpen` (`connection-database-picker.tsx:30,32`). Both render
  `.connection-panel__confirm`, which is `position: fixed`, and neither is implied
  by `formVisible` — the picker is only reachable once the form is closed.
- `QueriesColumn` gains `onBlockingChange(boolean)`, emitting `sheet !== null` —
  the same value its existing `sheetOpen` uses to drive `inert`/`aria-hidden`.
- `TableList` gains the same prop, emitting
  `pending !== null || ddl !== null || exportTable !== null`
  (`table-list.tsx:51,53,55`) — the drop/truncate confirm, the DDL sheet, and the
  export sheet, all `.table-sheet`, all `position: fixed` (`tables.css:205`).
  `ConnectionTablesList` forwards it, since the list is the slot the sidebar
  renders. These are the surfaces the Schema tab gains by hosting the table
  browser, and they are the largest part of the guard, not a footnote to it.

`createdDialogOpen` needs no entry: `handleSave` never closes the form before
setting it (`connection-panel.tsx:295-307`), so the created dialog only appears
over a sheet `formVisible` already covers.

Because sheets stay mounted inside their own panels and tab switching cannot
unmount them mid-request, the shared Escape LIFO registry
(`src/ui/use-escape-dismiss.ts`) is untouched. Hoisting every sheet up to `App`
would achieve the same guarantee through a far larger refactor.

## Accepted trade-offs

1. **Collapsing now hides saved queries too.** `QueriesColumn` currently survives
   a collapse because it sits in the workspace; in one column it closes with
   everything else. The rail toggle is one keystroke away and the tab it reopens
   into is remembered for the session.
2. **The sidebar is fixed at 20rem and not resizable.** For the schema list this
   matches today's behavior exactly. For saved queries it is a small regression:
   `QueriesColumn` is currently a resizable `Panel` (`defaultSize={220}`,
   `minSize={160}`) and loses its drag handle. Long names continue to ellipsize,
   as they already do in the Connection sidebar. Decided deliberately; a
   resizable sidebar can be refined in later.
3. **Results narrow by `--sidebar-rail-width` (2.25rem).** Results currently span
   the full main column, flush to the Connection sidebar. The canvas gains the
   ~220px that `QueriesColumn` used to occupy beside it, so the net effect is a
   wider canvas and a marginally narrower results grid.
4. No panel sizes are persisted (`WorkspaceSplit` declares no `autoSaveId`), so
   removing the queries panel destroys no stored user state.

## Testing

Test-first, per the project workflow.

| Test file | Change |
|-----------|--------|
| `tests/ui/shell/app-sidebar.test.tsx` | **new** — switcher swaps the body; switcher and the rail toggle are disabled while a blocking surface is open; the rail still renders when the panel is collapsed; the toggle's label swaps with state |
| `tests/ui/shell/activity-rail.test.tsx` | **new** — settings and help buttons open their dialogs |
| `tests/ui/shell/app-workspace.test.tsx` | queries assertions removed — `QueriesColumn` is no longer its child |
| `tests/ui/app-wiring.test.tsx` | queries wiring re-pointed at the sidebar |
| `tests/ui/connection/connection-panel.test.tsx` | tables assertions move to the sidebar test; the `collapseConnection` assertion follows that testid onto the rail; adds `onBlockingChange` coverage |
| `tests/ui/tables/table-list.test.tsx` | table search filters case-insensitively, empty state on no matches, count follows matches; schema section collapses via `aria-expanded`; the sheets report blocking |
| `tests/ui/connection/connection-tables-list.test.tsx` | the schema picker filters and hides itself at one schema |
| `tests/ui/library/queries-column.test.tsx` | schema-picker assertions removed (the picker moves to the Schema tab); adds `onBlockingChange` coverage |

Gate: `bun run check` (typecheck + lint + tests).

Cross-platform: the brief requires new chrome to be checked on WebKitGTK, the
least consistent of the three engines. The permanent rail track and the
`.ui-segment` focus ring are the two things to look at there.

## Accessibility

- The rail's buttons are icon-only and carry `aria-label` from the same copy
  constants a text button would have shown.
- The switcher is a native radio group in `<label>` wrappers, so arrow-key
  navigation and the focus ring come from the platform.
- Disclosure state on collapsible sections is carried by `aria-expanded` on the
  section's button; the chevron is inline SVG with `aria-hidden="true"`.
- Disabled switcher segments announce as disabled rather than disappearing.
