# SP-4b Slice B — Remaining Table and Results Parity

**Date:** 2026-08-18
**Status:** approved
**Author:** brainstorm session
**Spec path:** `docs/pocket/spec/2026-08-18-sp4b-slice-b/sp4b-slice-b.md`

---

## Summary

Finish the five remaining SP-4b SEQUENCE roots without reopening the completed
Slice A table-host work. Slice B adds metadata-aware row editing, safe browse
context reset, a 300-second browse timeout with cancellation recovery, the
remaining Create Database interaction states, and an in-memory table-page cache.

This is a delta specification. The existing SP-4b parity ledger remains the
historical source, while this document resolves its remaining ambiguities and
records one approved product deviation: stale table-browse results are cleared on
connection/database changes instead of being retained behind mismatch help.

---

## Context

### Current State

- Slice A is shipped: clicking a table runs a quoted `SELECT * ... LIMIT 101`,
  expansion loads PK/FK metadata, and Refresh/DDL/Export/Truncate/Drop are wired.
- `RowEditor` attaches and calls `updateRow`, but receives only column names,
  renders text inputs for every value, has no saving state, and closes without
  surfacing rejected row operations.
- `QueryResultsPane` derives editability from `sourceTable` and primary-key names.
  It does not track the connection/database that produced a browse result.
- SQL hatch timeout handling exists at 300 seconds. Table browse has no timer.
- Create Database validates and reports create errors, but Enter does not submit.
  The current Rust `create_database` session method also switches immediately, so
  the approved explicit Connect boundary requires a narrow create-only semantic
  correction in that existing method.
- Table-browse Prev/Next works with 100 visible rows and a `LIMIT 101` probe, but
  every navigation refetches.

### Problem / Motivation

The remaining rows are small individually but share lifecycle and data-integrity
concerns. A stale browse response can repopulate the wrong context, a failed
post-mutation reload can accidentally invite a duplicate mutation, and retrying
before query cancellation settles can overlap database work. These behaviors need
one explicit lifecycle boundary rather than unrelated component-local flags.

### Related Areas

- `src/stores/compose-app-stores.ts`
- `src/stores/session-store.ts`
- `src/stores/tabs-store.ts`
- `src/stores/run-browse-on-active-tab.ts`
- `src/App.tsx`
- `src/ui/results/query-results-pane.tsx`
- `src/ui/results/row-editor.tsx`
- `src/ui/connection/create-database-dialog.tsx`
- `src/ui/connection/connection-panel.tsx`
- `src/ipc/contract.ts`
- `src-tauri/src/session/mod.rs`
- Existing store, result, connection, and app-wiring tests

---

## Scope

### In-Scope

- Pass column metadata to row editing and provide safe type-aware controls.
- Disable duplicate row saves, preserve failed drafts, and surface the six
  existing `RowOperationError` kinds through accessible user-facing errors.
- Clear table-browse results, metadata, pagination, selection, and cache when the
  active connection or database context changes.
- Ignore late browse responses from a prior table, context, refresh generation,
  cancellation, or reconnect.
- Apply a 300,000 ms timeout to table browse, cancel before retry, and expose an
  explicit reconnect recovery after cancellation is stuck for 12,000 ms.
- Add Enter submit plus created/Connect states to Create Database.
- Make the existing `createDatabase` command create-only; the explicit Connect
  action is the sole operation that switches the live session.
- Cache visited table-browse pages in memory and invalidate them on every approved
  stale-data boundary.
- Add or update tests and tick only ledger rows whose acceptance criteria pass.
- Run `bun run check` before implementation completion.

### Out-of-Scope

- Context-mismatch popover/help. The approved behavior clears table-browse state
  instead of retaining stale browse results.
- Clearing ordinary SQL or visual-canvas results during a context change.
- Timeout, reconnect recovery, or page caching for ordinary SQL/canvas execution.
- Persistent page cache or cache reuse across tables, sessions, or app launches.
- A general PostgreSQL type editor beyond the temporal/nullability metadata needed
  for the remaining RowEditor parity requirement.
- Visual CREATE/UPDATE/DELETE, SQL-to-IR, dark mode, favorites, export redesign,
  or changes to completed Slice A admin wiring.

---

## Architecture Constraints

- Layers this work may touch: `src/stores/**`, `src/ui/**`, `src/App.tsx`, existing
  TypeScript IPC types/clients, tests, the SP-4b ledger, and the narrow
  `AppSession::create_database` implementation/test in `src-tauri/src/session/mod.rs`.
- Layers this work must not touch for new behavior: `src/core/**` and all other Rust
  database I/O. No command/signature is added; only the existing create side effect
  is separated from the existing explicit switch command.
- `tabs-store` remains the sole owner of the current rendered tab result and run
  status. The new browse store must not become a second rendered-result source.
- The browse store owns only ephemeral browse identity, generation, page cache,
  current page metadata, and timeout/cancellation/recovery state. It is not
  persisted.
- Application orchestrators coordinate IPC, session, tabs, schema, and browse
  state. The browse store must not import React or call UI code.
- Connection/database reset hooks are composed in `composeAppStores`; components
  must not each implement their own partial reset.
- Existing dedicated IPC remains authoritative. No raw administrative SQL is
  introduced, and the canvas remains SELECT-only.
- All dialogs follow the creative brief's sheet, focus, busy, error, and Escape
  ownership rules.
- Each of the five roots is a separate implementation/review packet even though
  they share this specification.

### Architecture Validation Result

**Status:** PASS after design constraints were tightened.

Checks run: layered boundaries, modular composition, shared-state ownership,
public-contract impact, concurrency hazards, rollback, performance, and security.

Findings:

- Layer boundaries pass: the design stays in application/store/UI layers and uses
  injected `DragonIpc` contracts.
- Existing pattern reuse passes: `zustand/vanilla` stores are constructor-injected
  and composed in `composeAppStores` today.
- Single ownership passes conditionally on `tabs-store` remaining authoritative
  for visible results; this condition is mandatory.
- Concurrency passes conditionally on one generation token covering table/context,
  refresh, timeout, and reconnect invalidation; this condition is mandatory.
- Contract safety passes: no database schema, persisted DTO, command, or IPC
  signature change is required. The documented side-effect contract changes from
  create-and-switch to create-only so the existing `switchDatabase` command owns
  the explicit Connect transition.
- Performance passes with a bounded current-browse cache. Use a small LRU bound
  rather than retaining every visited page indefinitely.
- Rollback is code-only: remove the ephemeral store/orchestrator wiring and return
  to direct browse requests. No data migration or persisted cache cleanup exists.

---

## Dependencies

### Existing (to leverage)

- `zustand@5.0.14` — vanilla ephemeral browse state and deterministic store tests.
- React 19 — dialog and input state.
- Vitest 4 fake timers — the 300,000 ms and 12,000 ms boundaries and race tests.
- Existing `DragonIpc` methods — query execution, cancellation, disconnect/connect,
  row operations, database creation/switching, and catalog loading.

### New (proposed)

None.

A separate cache library is rejected because only the current table-browse session
is cached, while DragonDB already has injected Zustand stores and custom generation
semantics. A new server-state framework would still require custom IPC cancellation,
tab ownership, reconnect, and mutation partial-success coordination.

---

## Stories and Scenarios

### Story 1: Metadata-Aware Row Editing

> As a user browsing a PostgreSQL table, I want controls that respect column
> metadata and a resilient Save flow, so I can edit safely without losing a
> failed draft.

**Rule 1: Column metadata controls affordances**

- Primary keys are visible, badged, and read-only.
- Nullable fields expose a NULL toggle.
- Turning NULL off restores the field's last non-null draft value.
- `date`, `time without time zone`, and `timestamp without time zone` use native
  date/time controls.
- `timetz`/`time with time zone` and
  `timestamptz`/`timestamp with time zone` remain text inputs so their exact value
  and offset are preserved.
- Unsupported or unknown types fall back to text without implicit coercion.

```gherkin
Scenario: Open an editor with metadata-aware controls
  Given public.events row id=42 has occurred_on="2026-08-18" and note="launch"
  And id is a bigint primary key
  And occurred_on is a date
  And note is nullable text
  When Edit opens
  Then id is disabled and marked as a primary key
  And occurred_on uses a date control
  And note exposes a NULL toggle

Scenario: Preserve a timezone-bearing value
  Given happened_at is timestamptz with value "2026-08-18 10:00:00+07"
  When Edit opens and the field is not changed
  Then happened_at uses a text input containing the original offset-bearing value
  And Save does not strip or reinterpret the offset

Scenario: Restore a draft after toggling NULL
  Given nullable note has draft value "keep me"
  When NULL is enabled and then disabled
  Then note returns to draft value "keep me"
```

**Rule 2: Save is single-flight and failures preserve the draft**

```gherkin
Scenario: Block duplicate Save
  Given one updateRow request is in flight
  When the user clicks Save or presses Enter again
  Then no second updateRow request starts
  And the editable controls and dismissal actions remain disabled as required

Scenario: Preserve a failed row draft
  Given occurred_on="2026-08-19" and note="retry me" are edited
  When updateRow rejects with any existing RowOperationError kind
  Then the editor stays open
  And both draft values and NULL choices remain unchanged
  And an accessible human-readable error is shown
  And Save becomes available for retry

Scenario: Do not repeat a successful mutation when reload fails
  Given updateRow succeeds
  When the current-page reload fails
  Then the editor closes
  And all cached pages for that table remain invalidated
  And the results pane shows a reload error with a retry-load action
  And retry-load does not call updateRow again
```

The same partial-success rule applies to successful row deletion followed by a
failed page reload.

### Story 2: Safe Browse Reset on Context Change

> As a user changing connection or database, I want stale table-browse state
> removed so edits cannot target the wrong context.

**Rule: Only committed context changes invalidate browse state**

```gherkin
Scenario: Clear browse state after a database switch
  Given page 1 of Local/shop/public.orders is visible and cached
  When switchDatabase successfully changes the session to analytics
  Then table-browse raw and compact results are cleared
  And source-table and primary-key metadata are cleared
  And row selection, current page, and page cache are cleared
  And Edit and Delete are unavailable

Scenario: Preserve state when database switching fails before context changes
  Given page 1 of Local/shop/public.orders is visible and cached
  When switchDatabase rejects before changing the session database
  Then the existing browse result, page, metadata, and cache remain

Scenario: Clear state during connection teardown
  Given a table-browse result is visible
  When the existing session disconnects for an explicit disconnect or profile switch
  Then its browse result and cache are cleared
  And they stay cleared if connecting the replacement profile later fails

Scenario: Preserve ordinary query results
  Given the active tab shows an ordinary SQL or visual-canvas result
  When the active database changes
  Then this browse-reset rule does not clear that ordinary result

Scenario: Reject a response from the old context
  Given a Local/shop browse request is pending
  When the connection or database context changes before it resolves
  Then the late response cannot update the visible tab or any browse cache entry
```

### Story 3: Table-Browse Timeout and Recovery

> As a user whose table browse stalls, I want it cancelled before retry so
> overlapping queries cannot run.

**Rule 1: The first terminal event wins at 300 seconds**

```gherkin
Scenario: Browse resolves before timeout
  Given a browse request resolves at 299999 ms
  When time advances beyond 300000 ms
  Then no timeout state appears
  And cancelQuery is not called for that completed request

Scenario: Browse reaches timeout
  Given public.orders page 3 is still running at 300000 ms
  When the timeout wins the settlement race
  Then cancelQuery is requested once
  And Try Again is disabled until cancellation succeeds

Scenario: Resolve the exact-boundary race once
  Given query completion and the 300000 ms timer become ready together
  When the scheduler settles them
  Then exactly one terminal transition is applied
  And success and timeout cannot both update the UI
```

**Rule 2: Cancellation has a 12-second recovery boundary**

```gherkin
Scenario: Retry after successful cancellation
  Given the timed-out public.orders page 3 request is cancelled within 12000 ms
  When the user chooses Try Again
  Then the same table and page request is issued exactly once

Scenario: Offer explicit reconnect when cancellation is stuck
  Given cancellation fails or has not settled after 12000 ms
  When recovery UI is shown
  Then Try Again remains disabled
  And Reconnect is offered
  And no reconnect starts without the user's action

Scenario: Recover through reconnect
  Given cancellation is stuck and the user chooses Reconnect
  When reconnect succeeds
  Then stale browse state and cache are cleared
  And retry becomes available
  And repeated Reconnect clicks while pending start only one reconnect

Scenario: Reconnect fails
  Given cancellation is stuck
  When the explicit reconnect attempt fails
  Then the recovery alert remains open with an error
  And Reconnect can be tried again
  And no browse retry starts

Scenario: Ignore the timed-out response
  Given a timed-out browse eventually resolves after cancel or reconnect
  When the old response arrives
  Then it cannot modify visible results or cache
```

### Story 4: Create Database Enter and Connect

> As a connected user, I want Enter to create a database and an explicit
> success/Connect step, so creation feedback is clear before the session switches.

**Rule 1: Create is validated and single-flight**

```gherkin
Scenario: Submit a valid name with Enter
  Given database name is "shop"
  When Enter is pressed once
  Then createDatabase("shop") is called once
  And successful creation shows "Database created" and Connect
  And switchDatabase has not yet run

Scenario: Reject an empty name
  Given database name contains only whitespace
  When Enter is pressed
  Then createDatabase is not called
  And Create remains disabled

Scenario: Block duplicate creation
  Given creation is in flight or the database is already in the created state
  When Enter or Create is invoked again
  Then no second createDatabase request starts

Scenario: Preserve a failed create draft
  Given database name is "shop"
  When createDatabase fails
  Then the dialog remains in the editable create state
  And name "shop" remains
  And an accessible error is shown
```

**Rule 2: Created and connected are separate committed states**

```gherkin
Scenario: Connect to the created database
  Given database shop was created successfully
  When Connect successfully switches the session to shop
  Then the dialog closes
  And the session database is shop
  And tables for shop load

Scenario: Retry only the failed list refresh
  Given database shop was created successfully
  When refreshing the database list fails
  Then the dialog remains in the created state
  And Connect remains available
  And retrying does not call createDatabase again

Scenario: Retry only a failed Connect
  Given database shop exists and the dialog is in the created state
  When switching to shop fails
  Then the created state and dialog remain
  And an accessible error is shown
  And retry Connect does not call createDatabase again

Scenario: Do not repeat a successful switch when table load fails
  Given switching the session to shop succeeds
  When loading shop tables fails
  Then the session remains on shop
  And the dialog closes
  And retry reloads tables without repeating switchDatabase
```

### Story 5: Table-Browse Page Cache

> As a user paging through a table, I want previously fetched pages reused while
> mutations and context changes never expose stale data.

**Rule 1: Cache identity and display semantics are explicit**

- An entry is scoped by connection, database, schema, table, and zero-based page.
- A fetched page stores at most 100 visible rows plus `hasNext`, derived from the
  internal 101st row.
- Cache is limited to the current browse identity and bounded with an LRU policy.

```gherkin
Scenario: Reuse a visited page
  Given public.orders pages 0 and 1 have been fetched
  When Prev returns from page 1 to page 0 while page 0 remains cached
  Then cached page 0 renders
  And runQuery call count does not increase

Scenario: Fetch an uncached page once
  Given public.orders page 2 is not cached
  When Next requests page 2
  Then one LIMIT 101 OFFSET 200 query runs
  And no second request starts for the same pending page

Scenario: Do not replace the visible page with a background response
  Given a valid request for page 1 and a newer visible request for page 2 overlap
  When page 1 resolves after page 2
  Then page 1 may fill only its still-valid scoped cache entry
  And page 2 remains visible
```

**Rule 2: Every stale-data boundary invalidates the cache generation**

```gherkin
Scenario: Refresh invalidates old work
  Given public.orders has cached pages and a pending old request
  When Refresh is invoked
  Then all public.orders pages are invalidated
  And the current page is fetched under a new generation
  And the pre-refresh response cannot refill the cache

Scenario: Successful mutation invalidates and reloads
  Given public.orders page 2 is visible
  When row update or deletion succeeds
  Then all public.orders pages are invalidated
  And page 2 is refetched

Scenario: Failed mutation keeps valid cache
  Given public.orders pages are cached
  When updateRow or deleteRows fails before changing data
  Then the cache remains valid
  And the failed edit draft remains available where applicable

Scenario: Admin mutation invalidates browse state
  Given public.orders pages are cached
  When Truncate or Drop succeeds
  Then all affected browse pages are invalidated
  And Drop does not attempt to display the removed table

Scenario: Deleting the final row leaves navigable pagination
  Given page 2 contains the table's final row
  When that row is deleted and page 2 reloads empty
  Then the empty page is shown consistently
  And Prev remains available to return to page 1
```

Table change, successful database change, connection teardown, and reconnect also
invalidate the entire current browse cache as defined in Stories 2 and 3.

---

## Acceptance Criteria

```text
Rule: Metadata-aware RowEditor
  ✓ Given PK/date/nullable metadata, When Edit opens, Then PK is read-only, date is typed, and NULL is available
  ✓ Given timestamptz value with +07 offset, When unchanged and saved, Then the exact offset-bearing value is preserved
  ✓ Given NULL is toggled on then off, Then the previous non-null draft returns
  ✗ Given updateRow rejects, When Save settles, Then the dialog closes or the draft is lost

Rule: Single-flight row operations and partial success
  ✓ Given Save is pending, When Save/Enter repeats, Then only one updateRow request exists
  ✓ Given updateRow succeeds and reload fails, Then retry reloads only and never repeats updateRow
  ✓ Given deleteRows succeeds and reload fails, Then retry reloads only and never repeats deleteRows

Rule: Browse context reset
  ✓ Given a table browse, When database switch succeeds or the session disconnects, Then browse result/cache/metadata/page clear
  ✓ Given database switch fails before changing context, Then the existing browse state remains
  ✓ Given an ordinary SQL/canvas result, When database changes, Then this browse-only rule does not clear it
  ✗ Given an old browse resolves after context change, Then it updates results or cache

Rule: Browse timeout and cancellation recovery
  ✓ Given browse is running at 300000 ms, Then cancelQuery is requested and retry waits for cancellation
  ✓ Given cancellation is stuck for 12000 ms, Then Reconnect appears and retry remains disabled
  ✓ Given reconnect succeeds, Then stale browse state clears and retry becomes available
  ✗ Given cancel/reconnect is unresolved, When Try Again is invoked, Then a second browse starts

Rule: Create Database state machine
  ✓ Given name shop, When Enter is pressed, Then createDatabase runs once and success shows Connect
  ✓ Given created shop, When Connect succeeds, Then session switches, dialog closes, and tables load
  ✓ Given create succeeded but list refresh fails, Then created state remains and Create is not repeated
  ✗ Given blank input or a pending create/connect, When Enter repeats, Then another request starts

Rule: Table page cache
  ✓ Given cached pages 0 and 1, When returning to page 0, Then no refetch occurs
  ✓ Given an uncached page, When opened, Then LIMIT 101 fetches once and at most 100 rows render
  ✓ Given Refresh/mutation/admin/context change, Then the appropriate browse generation/cache invalidates
  ✓ Given deletion empties page N, Then Prev remains available when N > 0
  ✗ Given a stale/out-of-order response, Then it replaces the visible page or poisons a newer cache generation

Rule: Completion
  ✓ Given each packet is implemented, Then its focused tests and review pass before the next packet proceeds
  ✓ Given all five roots are complete, Then bun run check passes and only satisfied ledger rows are ticked
```

---

## Design Decision

**Chosen option:** Option B — dedicated browse-session controller using existing
Zustand infrastructure.

**Summary:** Keep tab results authoritative in `tabs-store`, and add a composed,
ephemeral browse boundary for cache identity, lifecycle generations, page state,
timeout/cancellation, and reconnect recovery. Dialog-specific workflows remain
small local state machines. The existing `createDatabase` command becomes
create-only; Connect performs the sole session switch through `switchDatabase`.

**Rejected options:**

- Option A, component-local state: rejected because invalidation, timeout, and
  out-of-order behavior would be spread across `App.tsx` and dialogs.
- Option C, a new server-state/cache dependency: rejected because it introduces a
  second state pattern without removing the need for custom IPC cancellation,
  reconnect, tab-result ownership, or partial-success handling.

**Key tradeoffs accepted:**

- A new store contract is justified, but it is intentionally browse-specific and
  must not become a general query manager.
- Page caching is in-memory and bounded; an evicted page can refetch.
- Context-mismatch help is intentionally replaced by clearing stale table-browse
  state on successful context change/teardown.

---

## Open Questions / Assumptions

All blocking questions were resolved during grinding.

| Question | Resolution | Risk if Wrong |
|----------|------------|---------------|
| Create success behavior | Show created state, then explicit Connect; successful Connect immediately switches/closes/reloads | Deliberate change from the previous auto-switch slice behavior |
| Failed row Save | Keep editor and full draft for retry | None beyond additional UI state |
| Context mismatch | Clear table-browse state on connection/database change | Deliberate deviation from Swift mismatch-help parity |
| Temporal timezone values | Preserve through text input; native controls only for no-timezone temporal types | Less picker convenience for safer data integrity |
| Browse cancellation recovery | Wait 12 seconds, then offer explicit Reconnect | Recovery takes longer but avoids premature concurrent work |
| Partial success | Never repeat a confirmed mutation/create/switch; retry only failed reads | Requires separate operation and refresh error states |

---

## Implementation Notes

- Plan and implement five separate packets. Shared browse infrastructure may be
  introduced in the earliest packet that needs it, but later packets must extend
  its published actions instead of reaching into internal maps/timers.
- Cache/timer handles and generation counters may be module-private; serializable
  snapshots exposed to React should contain only observable state.
- Timer and race tests must use fake timers and controllable promises.
- Human-facing errors follow the creative brief: what happened and how to recover,
  with `role="alert"`; internal codes are not shown.
- Do not hand-edit Pocket plan `log.json` files. Ledger documentation is updated
  only by the packet whose acceptance criteria actually pass.

---

## Rollback Plan

- Revert the five code packets independently in reverse order.
- Remove the browse store from `AppStores` composition and restore direct
  `runBrowseOnActiveTab` calls if the shared lifecycle boundary must be rolled back.
- Restore the existing Create Database auto-switch dialog behavior if its new
  state machine must be rolled back, including the former Rust create-and-switch
  behavior as one atomic rollback.
- No migration, persisted-cache deletion, or Rust data repair is required.
