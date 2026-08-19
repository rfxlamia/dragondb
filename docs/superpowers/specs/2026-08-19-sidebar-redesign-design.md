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

The 60rem media query, which stacks the sidebar as a full-width band above the
workspace, folds rail and panel into that single band.

### Sidebar composition

```
┌──┬──────────────────────┐
│▣ │ ˅ Connections      + │   persistent block
│  │     ▪ fastrack-local │
│  │     ▪ fastrack-prod  │
│  │   ▤ fastrack_db    ˅ │   database picker
│  │ ┌─────────┬────────┐ │
│  │ │ Schema  │Queries │ │   .ui-segment, two tabs
│⚙ │ └─────────┴────────┘ │
│? │ 🔍 Search tables     │   .ui-search
│  │ ˅ public          42 │   .ui-section-label + count
│  │     ▤ activity       │
└──┴──────────────────────┘
```

The Connections block stays above the switcher and is visible in both tabs — the
session is context for everything below it, not one view among several.

### Components

| File | Change |
|------|--------|
| `src/ui/shell/activity-rail.tsx` | **new** — presentational rail: sidebar toggle (top), settings + help (bottom), all `.ui-icon-btn` with existing copy constants as `aria-label` |
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

### The one behavior addition: table search

Everything else here is a relocation. The Schema tab additionally gains a search
field, which the table list does not have today — only `QueriesColumn` does
(`queries-column-toolbar.tsx:96`). Without it the tab is still a two-hundred-row
unbroken scroll, merely a denser one, and the brief already names its
placeholder ("Search tables") as a copy example.

It is a case-insensitive substring filter over the table name, mirroring the
Queries filter exactly: `.ui-search` markup, `aria-label` and `placeholder` from
a copy constant, state local to the list component, no debounce. When the filter
matches nothing the list shows the same "no matches" empty-state shape the
Queries column uses. The section count reflects matches, not the total.

## State

One new piece of state in the shell: `sidebarTab: "schema" | "queries"` in
`App.tsx`, defaulting to `"schema"`. It is **not** persisted — date format is
the only persisted preference today, and a view toggle does not earn a second
one. The table filter string is local to `ConnectionTablesList`, the way the
queries filter is local to `QueriesColumn`.

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
  `formVisible || confirm.hasPending`. `hasPending` already exists
  (`use-connection-confirmations.tsx:177`); no new state is introduced.
- `QueriesColumn` gains `onBlockingChange(boolean)`, emitting `sheet !== null` —
  the same value its existing `sheetOpen` uses to drive `inert`/`aria-hidden`.

Because sheets stay mounted inside their own panels and tab switching cannot
unmount them mid-request, the shared Escape LIFO registry
(`src/ui/use-escape-dismiss.ts`) is untouched. Hoisting every sheet up to `App`
would achieve the same guarantee through a far larger refactor.

## Accepted trade-offs

1. **The sidebar is fixed at 20rem and not resizable.** For the schema list this
   matches today's behavior exactly. For saved queries it is a small regression:
   `QueriesColumn` is currently a resizable `Panel` (`defaultSize={220}`,
   `minSize={160}`) and loses its drag handle. Long names continue to ellipsize,
   as they already do in the Connection sidebar. Decided deliberately; a
   resizable sidebar can be refined in later.
2. **Results narrow by `--sidebar-rail-width` (2.25rem).** Results currently span
   the full main column, flush to the Connection sidebar. The canvas gains the
   ~220px that `QueriesColumn` used to occupy beside it, so the net effect is a
   wider canvas and a marginally narrower results grid.
3. No panel sizes are persisted (`WorkspaceSplit` declares no `autoSaveId`), so
   removing the queries panel destroys no stored user state.

## Testing

Test-first, per the project workflow.

| Test file | Change |
|-----------|--------|
| `tests/ui/shell/app-sidebar.test.tsx` | **new** — switcher swaps the body; switcher and collapse are disabled while a blocking surface is open; the rail still renders when the panel is collapsed; section counts render |
| `tests/ui/shell/app-workspace.test.tsx` | queries assertions removed — `QueriesColumn` is no longer its child |
| `tests/ui/app-wiring.test.tsx` | queries wiring re-pointed at the sidebar |
| `tests/ui/connection/connection-panel.test.tsx` | tables assertions move to the sidebar test; adds `onBlockingChange` coverage |
| `tests/ui/connection/connection-tables-list.test.tsx` | table search: filters case-insensitively, empty state on no matches, count follows matches |
| `tests/ui/library/queries-column.test.tsx` | unchanged in substance; adds `onBlockingChange` coverage |

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
