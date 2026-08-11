# SP-2 macOS Exit Checklist

Manual verification for SP-2 exit on **macOS only**. Linux/Windows are testable later and are **not** exit-blocking.

Characterization (automated): Connected `run_query` success/fail writes QueryHistory; disconnected never inserts. UI CREATE gate (T11) never calls `onRunQuery` / `runQuery` ⇒ no history row — do not re-test that path here; covered in `tests/ui/visual-query/canvas.test.tsx`.

Live environment required: local or reachable Postgres, SSH host for tunnel profiles, and macOS Keychain (keyring). Agent CI without keyring/Postgres cannot claim this checklist PASS.

## Connect (direct + SSH) → Run SELECT

1. **Save SSH profile** — Create a connection profile with SSH tunnel enabled (host, user, key or password). Confirm save succeeds and secrets are not visible in app-local sqlite.
2. **Connect** — Connect the saved SSH profile. Expect tunnel up, then DB via `127.0.0.1:ephemeral`, canvas unlocks.
3. **Canvas unlock** — Visual query canvas is interactive only while Connected.
4. **Build SELECT** — Add a SELECT query on canvas (simple `SELECT …` against a known table).
5. **Run** — Click Run. Expect status **OK** with row count and duration (status-only; no results grid in SP-2).
6. **History side effect** — After a successful Connected Run, a QueryHistory success row is stored (sql, duration_ms, row_count). Failed Connected execute stores a failed row. (No history browse UI in SP-2.)

## Disconnect + failure teardown

7. **Disconnect lock** — Disconnect. Canvas locks; subsequent Run/list without connect must fail without silent reconnect.
8. **Bad SSH → no orphan tunnel** — Attempt connect with invalid SSH credentials/host. Expect typed error and no leftover tunnel process after failure teardown.

## Keyring restart round-trip

9. **Quit / relaunch** — Quit the app fully, relaunch.
10. **Reconnect without retyping password** — `listProfiles` → `connectProfile` for the same profile. Password/SSH secrets come from keyring; do not re-enter them.
11. **CI note** — Keyring restart integration may be `#[ignore]` in CI environments without a keyring backend. **macOS exit must run this step locally**; ignoring in CI does not satisfy the exit gate.

## Non-migration + deferred scope

12. **No SwiftData import** — Confirm there is no importer UI or migration path from Swift app data. Profiles from the Swift app do not appear automatically.
13. **Create / delete database deferred** — Parent create/delete database capability remains explicitly deferred; not part of SP-2 exit.
14. **CREATE Run gate** — Building CREATE cards is allowed; clicking Run on CREATE does not call `onRunQuery` / `runQuery` and does not write QueryHistory (T11). Do not duplicate that canvas test here.
15. **Platform scope** — This checklist is macOS-only. Do **not** claim Linux/Windows exit complete.

## Sign-off

| Step | Result (PASS / FAIL / N/A) | Notes |
|------|----------------------------|-------|
| Save SSH profile | | |
| Connect + canvas unlock | | |
| Run SELECT → OK status | | |
| Disconnect lock | | |
| Bad SSH → no orphan tunnel | | |
| Keyring restart reconnect | | |
| No SwiftData import | | |
| Create/delete DB deferred noted | | |

**Exit verdict:** PASS only when all required rows above are PASS on a real macOS machine with Postgres + SSH + Keychain.
