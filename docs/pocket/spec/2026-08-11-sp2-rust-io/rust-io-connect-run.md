# SP-2 — Rust I/O + rough Connect UI + canvas Run (SELECT)

**Date:** 2026-08-11
**Status:** draft
**Author:** brainstorm session (pocket-grinding)
**Spec path:** docs/pocket/spec/2026-08-11-sp2-rust-io/rust-io-connect-run.md
**Amended:** 2026-08-11 — closed spec-review FAIL [C1] (IPC contract delta) and warnings W1/W2/W3/W4/W5/W6/W7/W8

---

## Summary

SP-2 replaces the Tauri Rust stub with real Postgres / SSH / keyring / rusqlite I/O, expands **`DragonIpc` with an explicit contract delta** (below), wires a **real** IPC implementation (no runtime mocks), and adds a **rough** connection UI so a Mac user can Save → Connect (including SSH), unlock the visual canvas, and **Run SELECT** against a live database. Success is status-only (`OK / N rows / X ms`); the results grid stays SP-4b. This expands the parent design’s “Rust-only” SP-2 so the author can manually verify “it works like the spec” before SP-3/SP-4b polish.

---

## Context

### Current State

- `dragondb` on `main`: SP-0 scaffold, SP-1 visual-query IR (`src/core/`), SP-4a canvas UI against **mocked** `DragonIpc`.
- Today’s `DragonIpc` (`src/ipc/contract.ts`) exposes only `listTables` / `listColumns` / `runQuery`.
- `App.tsx` always mounts the canvas with `isConnected={true}` and `createMockDragonIpc` + `FIXTURE_CONNECTION_ID`.
- Canvas has **no Run button** yet (copy/a11y ids exist); `canRun` only drives a help status strip; `mutate` stays enabled while “connected.”
- `src-tauri` is still a Tauri bootstrap only (no postgres/ssh/secrets/storage modules).
- Swift reference (`dragondb-swift`) has full ConnectionService, PostgresNIO stack, Citadel SSH, Keychain, and SwiftData models.

### Problem / Motivation

Without real I/O, the canvas cannot prove the product learning loop (build → see SQL → run → understand). Parent sequencing put wiring in SP-3; grinding chose to pull a thin end-to-end path into SP-2 for earlier proof, especially SSH-heavy workflows.

### Related Areas

- `src/ipc/contract.ts`, `src/ipc/mock.ts` — contract **expanded** in this SP; mock removed from runtime app path (tests may keep fakes)
- `src/ui/visual-query/*` — interaction lock, **net-new Run control**, status strip success/failure/gated states
- `src-tauri/` — new Rust modules
- `docs/superpowers/specs/2026-08-10-cross-platform-design.md` — parent SP map; keyring §11 snippet is **stale** (use keyring 4.x); parent §4 IPC is the **base** this delta extends
- Swift: `Services/Postgres/*`, `Services/SSH/*`, `Services/KeychainService.swift`, `Models/ConnectionProfile.swift` (+ SavedQuery, QueryFolder, QueryHistory, TabState)

---

## Scope

### In-Scope

- Rust thin I/O: `postgres/`, `ssh/`, `secrets/`, `storage/`
- Rough connection UI: create/edit/save/delete profile, Save-then-Connect, Disconnect, switch-with-confirm
- SSL modes (6) per table below; when `sshEnabled`, UI hides/disables verify-ca and verify-full
- SSH tunnel mandatory for exit: tunnel before DB; DB via `127.0.0.1:ephemeral`; teardown on disconnect/failure; dead-socket while Connected → re-establish **tunnel + DB once** then retry (**inside** Rust `runQuery` / metadata ops — opaque to UI)
- Explicit Disconnect clears session params (no silent reconnect); canvas locks; cards preserved as read-only snapshot; SQL preview readable
- Successful profile switch A→B: confirm → teardown A → connect B → **reset canvas empty** for B (remount canvas or equivalent `startOver` — not merely unlock)
- Real IPC per **IPC Contract Delta**; auto `listTables` on Connect success; `listColumns` on FROM commit; **no runtime mock/fixtures**
- Canvas fully locked until Connect: disable add/edit/remove cards, statement picker, and Run — not only `canRun` eligibility; preview OK
- **Net-new Run control** on canvas toolbar/chrome; SELECT-only execute path for SP-2 exit
- CREATE cards remain buildable; Run CREATE gated in the **Run handler** (do not require changing core `canRun(CREATE)` to non-runnable); clear human message; no Postgres execute; no QueryHistory
- Success status: `OK / {rows.length} rows / {durationMs} ms` (SELECT row count from `QueryResult.rows.length`, not `rowsAffected`); no results grid
- Silent `QueryHistory` insert as a **side effect of successful IPC `runQuery` path after execute** (success or fail) — not a separate UI call; gated CREATE never calls `runQuery`
- Storage: full rusqlite **schema** for five Swift models; **IPC-visible** profile CRUD + connect lifecycle + history write via `runQuery`; SavedQuery / QueryFolder / TabState = **Rust-internal schema + CRUD helpers only** (no IPC methods, no UI) until SP-3/SP-4b
- Secrets **only** in keyring (no password column in sqlite)
- keyring restart-round-trip integration test
- macOS exit gate: Connect (incl. SSH) + Run SELECT; Linux/Windows testable later, not blocking
- Document release-notes obligation: no SwiftData → rusqlite importer

### Out-of-Scope

- SwiftData importer / data migration tooling
- Results grid, row editing, CSV export UI
- Saved query / history / tab **browse UI** and any IPC for SavedQuery / QueryFolder / TabState
- Polished 3-pane shell (SP-4b)
- Full SP-3 store architecture (thin App session only — Option A)
- Run CREATE / DDL maturity path (deferred intentionally vs Swift)
- **Create / delete database** (parent §12.2 lists `DatabaseManagementService` as SP-2 + SP-4b) — **deferred**: no Rust API and no UI in this SP-2 exit; revisit with SP-4b database-management cluster or a later SP-2.x if needed
- Continuous background keep-alive reconnect
- SSH host-key pinning redesign (accept-anything like Swift)
- Distribution (SP-5), archive Swift (SP-6), dark mode
- Redesign SSH key model (file pick → store **contents** in keyring)

---

## Architecture Constraints

- Layers this work may touch: `src-tauri/**`, `src/ipc/**` (contract delta + real impl), minimal `src/ui/**` (connection panel, canvas lock/Run/status), `Cargo.toml` / Tauri config as needed (e.g. dialog plugin for key file)
- Layers this work must NOT touch carelessly: `src/core/` must stay DOM/Tauri/store-free; do not grow a full `src/stores/` SP-3 facade inside SP-2; SELECT-only gate lives in UI Run handler (core `canRun` may still mark CREATE runnable for card-building fidelity)
- Patterns: Rust = thin I/O; IR stays TypeScript; single connection + one-shot reconnect; privacy-local; mirror Swift when an example exists (recorded exceptions: Run CREATE deferred; create/delete database deferred)
- Architecture validation result: **PASS** (conditional note accepted: thin session in `App` is proto-store debt for SP-3)

### Phase 6 checklist

- [x] Respects layer boundaries (Option A thin session)
- [x] Follows existing three-layer + Swift mirror patterns
- [x] New deps are established crates (not hand-rolled crypto/SSH/SQL)
- [x] Build-vs-buy considered
- [x] Rollback: revert feature branch / do not ship; no production user data migration
- [x] No silent importer; release notes required before SP-6
- [x] Performance: single-conn OK for desktop client
- [x] Security: secrets in keyring only; typed IPC errors

---

## Dependencies

### Existing (to leverage)

- `@tauri-apps/api` — invoke bridge
- `src/core` — `generateSQL`, validation, `QueryDocument`
- Vitest / Biome / `bun run check` — gates
- Creative brief — copy tone for human errors

### New (proposed)

- `tokio-postgres` ^0.7 (+ `postgres-native-tls`) — async Postgres client; rejected `sqlx` (pool/macros heavier than single-conn thin I/O)
- `russh` ^0.62 — async SSH + direct-tcpip; rejected `ssh2` (C/libssh2 friction)
- `keyring` ^4 (default `v1` feature) — OS credential stores; **do not copy** parent design’s keyring 3.6 feature snippet (stale)
- `rusqlite` ^0.40 with `bundled` — local app DB; rejected sqlx-sqlite for sync CRUD
- Likely `tauri-plugin-dialog` — native key file picker (parity with NSOpenPanel)

---

## IPC Contract Delta

Parent design §4 remains the base. SP-2 **must** extend `src/ipc/contract.ts` before/with implementation. Pocket-planning treats this section as the IPC task packet source.

### Error transport

- Methods that can fail **reject** the Promise with a structured `IpcError` payload (serialize across Tauri invoke as a known error shape — planning picks exact Tauri mapping, but UI must read `kind` + `message`, never parse free-form strings).
- Existing `IpcError` kinds remain. Connect/SSH failures use `connection` or `auth` as appropriate; unknown mapped to `unknown`.

### DTOs (add)

```ts
export type ProfileId = string; // UUID string; same id used for keyring account prefix
export type SslMode =
  | "disable"
  | "allow"
  | "prefer"
  | "require"
  | "verify-ca"
  | "verify-full";

export type SshAuthMethod = "password" | "privateKey";

/** Persisted profile fields — never includes password or key material. */
export interface ConnectionProfileDto {
  id: ProfileId;
  name: string | null;
  host: string;
  port: number;
  username: string;
  database: string;
  isFavorite: boolean;
  sslMode: SslMode;
  sshEnabled: boolean;
  sshHost: string | null;
  sshPort: number | null;
  sshUsername: string | null;
  sshAuthMethod: SshAuthMethod | null;
  /** Path hint only; private key contents live in keyring. */
  sshPrivateKeyPath: string | null;
}

/** Secrets accepted on save/connect forms — written only to keyring, never sqlite. */
export interface ProfileSecretsInput {
  password?: string | null;
  sshPassword?: string | null;
  sshPassphrase?: string | null;
  /** Full PEM/OpenSSH private key text after file pick. */
  sshPrivateKey?: string | null;
}

export interface SaveProfileInput {
  /** Omit id to create; include id to update. */
  id?: ProfileId;
  profile: Omit<ConnectionProfileDto, "id"> | ConnectionProfileDto;
  secrets: ProfileSecretsInput;
}

export interface ConnectResult {
  connectionId: ConnectionId;
  profileId: ProfileId;
}
```

### SSL mode table (UI + Rust collapse)

| UI `sslMode` | Effective TLS (Swift parity) | When `sshEnabled` |
|---|---|---|
| `disable` | no TLS | allowed |
| `allow` | treat as **disable** | allowed |
| `prefer` | treat as **disable** | allowed |
| `require` | TLS, no cert verify | allowed |
| `verify-ca` | TLS + CA verify | **hidden/disabled in UI** |
| `verify-full` | TLS + full verify | **hidden/disabled in UI** |

### `DragonIpc` methods

**Keep (parent §4):**

- `listTables(c: ConnectionId): Promise<TableRef[]>`
- `listColumns(c: ConnectionId, table: TableRef): Promise<ColumnInfo[]>`
- `runQuery(c: ConnectionId, sql: ExecutableSQL): Promise<QueryResult>`
  - On SELECT execute (success or DB error after attempt): Rust **also** inserts `QueryHistory` (silent).
  - One-shot reconnect (SSH: tunnel+DB; direct: DB only) happens **inside** these live-session methods when UI session is Connected — opaque to caller.
  - After explicit `disconnect`, these must fail with `connection` / not-connected — **no** silent reconnect.

**Add (SP-2):**

- `listProfiles(): Promise<ConnectionProfileDto[]>`
- `getProfile(id: ProfileId): Promise<ConnectionProfileDto | null>`
- `saveProfile(input: SaveProfileInput): Promise<ConnectionProfileDto>`
  - Atomic wrt secrets: if keyring write fails, do not leave a half-saved sqlite row (or roll back). Never persist secrets to sqlite.
- `deleteProfile(id: ProfileId): Promise<void>`
  - Deletes sqlite row + all keyring accounts for that id. If this profile is the active Connected session, disconnect/clear session first (Swift parity — confirm VM details in planning).
- `connectProfile(id: ProfileId): Promise<ConnectResult>`
  - Requires profile already saved. Loads secrets from keyring. Establishes SSH (if enabled) then DB. Returns `connectionId` for subsequent list/run calls.
  - Does **not** accept unsaved form blobs (Save-then-Connect).
- `disconnect(): Promise<void>`
  - Tears down DB + tunnel; clears in-memory session params so later list/run cannot silent-reconnect.

**Not in SP-2 IPC** (schema may exist in rusqlite only):

- SavedQuery / QueryFolder / TabState APIs
- createDatabase / deleteDatabase
- listHistory / any history UI API (writes only via `runQuery` side effect)

### ConnectionId lifecycle

1. `connectProfile` → issues `connectionId` (opaque string; may equal `profileId` or a session token — pick one in planning and keep stable).
2. UI stores `{ connectionId, profileId, isConnected: true }`.
3. `disconnect` → invalidate; UI sets `isConnected: false` and must not call list/run with the old id.
4. Switch A→B: UI confirms → `disconnect` → `connectProfile(B)` → on success remount/reset canvas; on failure leave disconnected with prior cards snapshot.

### Runtime wiring changes (required)

- Remove default `createMockDragonIpc` / `FIXTURE_CONNECTION_ID` from production `App`.
- `isConnected` starts `false`; canvas locked until `connectProfile` succeeds.
- Unit/component tests may inject a fake `DragonIpc`; the shipped app path must use the Tauri-backed impl.

---

## Stories + Scenarios

### Story: Connect & persist

> As a Mac developer who reaches Postgres mostly over SSH, I want to save profiles and connect (direct or SSH) with real I/O, so I can trust DragonDB like the Swift app.

**Rule 1: Save-then-Connect**
- Example: Fill form → `saveProfile` → `connectProfile` succeeds; Connect without Save is unavailable.
- Example: Quit/relaunch → `listProfiles` → `connectProfile` without retyping password (keyring).

**Rule 2: SSH tunnel lifecycle**
- Example: sshEnabled → tunnel then DB on localhost ephemeral → `disconnect` tears down both.
- Example: Wrong SSH creds → human error, canvas locked, no orphan tunnel.
- Example: Dead socket while Connected over SSH + Run → rebuild tunnel+DB once, retry once (inside Rust).

**Rule 3: Secrets & schema**
- Example: Password/SSH secrets only in keyring; sqlite has no password column.
- Example: Five model tables exist; QueryHistory rows appear after SELECT `runQuery`.

```gherkin
Scenario: Save then Connect unlocks canvas
  Given a filled connection form that has been Saved via saveProfile
  When the user connectProfile succeeds (direct or SSH)
  Then the canvas unlocks for editing
  And listTables loads from real Postgres
  And no mock fixture tables appear

Scenario: Connect without Save
  Given a filled form that has not been Saved
  When the user attempts Connect
  Then Connect is not available or is rejected
  And the canvas stays locked

Scenario: SSH failure leaves no orphan tunnel
  Given a saved sshEnabled profile with bad SSH credentials
  When the user connectProfile fails
  Then the status strip shows a short human error
  And the canvas stays locked
  And no local forward remains

Scenario: Disconnect clears session
  Given a Connected session with clause cards
  When the user disconnects
  Then the canvas locks as a read-only snapshot (preview OK; no mutate/statement/Run)
  And session params are cleared so list/run cannot silent-reconnect
  And cards remain visible

Scenario: Switch profile resets canvas
  Given Connected to profile A with cards built
  When the user confirms switch to profile B and connectProfile(B) succeeds
  Then A is torn down (including SSH)
  And the canvas remounts or startOver to empty for B
  And listTables reflects B

Scenario: Switch fails after teardown
  Given Connected to A and user confirms switch to B
  When A is disconnected and connectProfile(B) fails
  Then session is cleared (no silent restore of A)
  And canvas is locked with A’s cards preserved read-only
  And a human error is shown
  And no orphan SSH remains
```

### Story: Canvas Run (SELECT)

> As the same user, I want a Run control on the visual canvas against real Postgres with status-only feedback, so I can verify end-to-end without waiting for the results grid.

**Rule 4: SELECT-only Run for SP-2 exit**
- Example: Valid SELECT → click Run → `runQuery` → status `OK / {rows.length} rows / {durationMs} ms` + QueryHistory row.
- Example: 0-row SELECT → `OK / 0 rows / X ms` + history.
- Example: CREATE on canvas + Run → UI gate message; **no** `runQuery`; no history.

**Rule 5: Failures are human-readable**
- Example: SQL/permission/network failure → short status strip from `IpcError.message` (not raw driver codes).

**Rule 6: Net-new Run UI + full interaction lock**
- Example: Disconnected → Run control disabled/hidden and mutate controls disabled.
- Example: Connected SELECT eligible → Run enabled; success/failure/gated messages share the status strip (not a mini grid).

```gherkin
Scenario: Run SELECT success status only
  Given a Connected session and a valid SELECT visual query
  When the user clicks the Run control
  Then ipc.runQuery executes generateSQL(doc).exec
  And the status strip shows OK, rows.length, and durationMs
  And no results grid is shown
  And a QueryHistory row is stored as a runQuery side effect

Scenario: Run SELECT failure
  Given a Connected session and a query that fails at Postgres
  When the user clicks Run
  Then the status strip shows a short human error from IpcError
  And a QueryHistory failed row is stored
  And the canvas stays unlocked

Scenario: Run CREATE gated in UI handler
  Given a Connected session with a CREATE visual query
  When the user clicks Run
  Then runQuery is not called
  And the status strip explains SELECT-only for now
  And no QueryHistory row is written

Scenario: Dead SSH socket one-shot recovery
  Given UI Connected over SSH but the tunnel/DB socket died
  When the user clicks Run
  Then Rust re-establishes SSH tunnel and DB once and retries once inside runQuery
  And either shows OK status or a human IpcError after retry failure

Scenario: Full lock while disconnected
  Given isConnected is false with prior cards visible
  When the user tries to add/edit/remove a card or change statement
  Then those interactions are disabled
  And SQL preview remains readable
```

### Story: No app-data migration

> As a release owner, I want an explicit non-migration decision, so Mac upgraders are not surprised when profiles do not appear.

```gherkin
Scenario: No importer
  Given Swift app local data exists on the same Mac
  When the user opens the Tauri app
  Then profiles/queries/history/tabs are not imported
  And release notes will state that app-local data does not transfer
```

---

## Acceptance Criteria

```
ACCEPTANCE CRITERIA — SP-2 Rust I/O + Connect + canvas Run
Date: 2026-08-11 | Scope confirmed: yes | Spec review C1 closed via IPC delta

Rule: IPC contract delta
  ✓ Given src/ipc/contract.ts after SP-2, When inspected, Then profile CRUD + connectProfile/disconnect + existing three query methods exist with DTOs above
  ✗ Given production App, When launched, Then mock IPC / FIXTURE_CONNECTION_ID are not the default path

Rule: Save-then-Connect + real metadata
  ✓ Given saved profile, When connectProfile succeeds, Then canvas unlocks and listTables is real (no fixtures)
  ✗ Given unsaved form, When Connect attempted, Then rejected/unavailable; canvas locked

Rule: SSH lifecycle
  ✓ Given sshEnabled profile, When connectProfile, Then tunnel then DB; disconnect tears down both
  ✗ Given bad SSH creds, When connectProfile, Then human IpcError, locked, no orphan tunnel
  ✓ Given dead SSH socket while Connected, When runQuery, Then tunnel+DB once + retry once (Rust-internal)

Rule: Session / lock / switch
  ✓ Given Connected with cards, When disconnect, Then full interaction lock + snapshot, session cleared, no silent reconnect
  ✓ Given Connected A, When confirm switch to B succeeds, Then A torn down, canvas empty (remount/startOver) for B
  ✗ Given switch confirmed and B fails after A teardown, Then locked snapshot, human error, no orphan SSH

Rule: SELECT Run + status
  ✓ Given Connected SELECT, When Run clicked, Then runQuery + OK/{rows.length}/durationMs + QueryHistory; no grid
  ✗ Given Connected CREATE, When Run clicked, Then UI gate only; no runQuery; no history
  ✗ Given Run failure, When completed, Then human status error + failed history row

Rule: Secrets + storage boundary
  ✓ Given saveProfile, When persisted, Then secrets in keyring only; no sqlite password column
  ✓ Given schema inspect, When opened, Then five model tables exist; SavedQuery/Folder/TabState have no IPC in SP-2
  ✓ Given parent create/delete database capability, When SP-2 exits, Then it is explicitly deferred (not silently missing)

Rule: Exit + non-migration
  ✓ Given macOS, When SP-2 exit checklist run, Then Connect(SSH)+Run SELECT pass
  ✓ Given release prep, When notes written, Then app-local data non-transfer is stated
```

---

## Design Decision

**Chosen option:** Option A — Thin session + expand `DragonIpc`

**Summary:** Implement Rust I/O modules and the IPC delta above; keep React wiring to a rough connection panel plus a thin connected-session flag/status in `App` (or equivalent), without a full SP-3 store layer. Delete runtime mock usage. Add net-new Run control and full interaction lock.

**Rejected options:**
- Option B (full stores now): delays proof; pulls SP-3 into SP-2
- Option C (debug harness only): fails no-mock + canvas Run scenarios

**Key tradeoffs accepted:**
- Rough connection UI now vs polished SP-4b shell later
- Thin App session may need SP-3 cleanup (explicit debt)
- Run CREATE deferred while CREATE cards remain (recorded vs Swift)
- Create/delete database deferred vs parent §12.2 SP-2 tag (recorded)

---

## Open Questions / Assumptions

| Question | Resolution | Risk if Wrong |
|----------|------------|---------------|
| SSH host-key policy | assumed: accept-anything like Swift | MITM risk accepted until product revisits |
| CREATE Run history | assumed: no history row when gated (no `runQuery`) | Easy to change later |
| Direct (non-SSH) dead socket | assumed: one DB reconnect+retry inside Rust | Must not invent tunnel rebuild |
| listTables fails after handshake | assumed: Connected + unlocked, empty tables, human metadata error | UX may want fail-closed Connect — revisit if painful |
| Delete/edit active profile while Connected | assumed: mirror Swift (disconnect/clear on delete or critical field change) | Confirm in planning against Swift VMs |
| `connectionId` vs `profileId` | assumed: planning picks one stable scheme | Call sites must not mix ids |
| Linux/Windows | assumed: buildable, not exit-blocking | Platform bugs found late |

---

## Implementation Notes

- Parent design §11 keyring Cargo snippet targets 3.x features — **replace** with keyring 4.x default `v1` (restart-round-trip test still mandatory).
- Parent §4 IPC is incomplete for SP-2 grinding scope — **this document’s IPC Contract Delta is authoritative** for SP-2 planning.
- Remove runtime wiring to `src/ipc/mock.ts`; keep fakes for unit tests only.
- Run control is **net-new UI** (SP-4a deferred Run); wire `VisualQueryCopy.runQueryTitle` / a11y `runQuery` ids.
- Full lock ≠ flipping `canRun` only: disable mutate/menus while disconnected.
- SELECT-only gate in Run handler; leave core `canRun(CREATE)` behavior unless planning finds a cleaner pure change that doesn’t break card UX.
- Status `N rows` = `QueryResult.rows.length` for SELECT.
- Switch success must remount canvas or call the same reset as Start Over.
- Do not expand status-only success into a mini results grid.
- Prefer explicit pathspecs for commits (project culture from SP-4a).
- Swift reference LOC hotspots: `PostgresConnectionManager`, `PostgresQueryExecutor`, `SSHTunnelManager`, `SSHKeyParser`, `KeychainService`, five `@Model`s; form flow `ConnectionFormView` Save → Connect now.

---

## Rollback Plan

- Land on a feature branch; if unstable, do not merge / revert merge — app remains on mock-IPC SP-4a behavior.
- No user data migration to roll back (no importer).
- Keyring entries created during testing may need manual cleanup on failure; document test account naming.
