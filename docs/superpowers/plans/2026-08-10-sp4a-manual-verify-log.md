# SP-4a Manual Verify Log

| OS | Device | Date | Tester | §11.2 1-9 | Notes |
|----|--------|------|--------|-----------|-------|
| macOS | Mac (agent CI env) | 2026-08-10 | agent | PENDING | Native GUI smoke (`bun run tauri dev`) not run. **Automated only (Vitest/jsdom):** items 1–7 behaviorally covered (canvas, clause-card, statement-root-card, app-wiring, generated-sql-preview suites); item 9 PASS via `scaffold-purge.test.ts`. **Not verified:** item 8 (focus ring visual) — requires native WebKit smoke; jsdom cannot assert rendered focus rings. Full macOS PASS requires human GUI walk of §11.2. |
| Linux | — | — | — | PENDING | Handoff required: Linux host with Tauri v2 WebKitGTK deps. Run `bun install && bun run tauri dev`, walk spec §11.2 items 1–9, update this row to PASS/FAIL. |
| Windows (optional) | | | | | |

Checklist reference: spec §11.2. Every required OS row must be PASS before SP-4a exit.
