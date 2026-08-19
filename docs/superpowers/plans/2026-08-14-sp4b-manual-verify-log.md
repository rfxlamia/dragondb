# SP-4b first slice — split manual verification log

**Date:** 2026-08-14
**Spec:** docs/pocket/spec/2026-08-14-sp4b-remaining-ui/first-slice-shell-results.md
**Automated gate:** `bun run check` PASS (359 tests; six pre-existing Biome warnings unchanged)
**Installed library:** `react-resizable-panels@4.12.2` (`Group`, `Panel`, `Separator`)
**Owner for blocked rows:** rfxlamia (repo user)

No row is PENDING. GUI drag and short-window scroll cannot be proven in jsdom.

## macOS (Darwin)

**Environment:** agent session on Darwin 25.6.0; `DISPLAY` unset; `TERM=dumb`; no interactive GUI; no live Postgres session.

| Check | Command / build | Observed | Status |
|-------|-----------------|----------|--------|
| Drag divider, record position, switch profiles, divider unchanged | `bun run tauri dev` then drag + successful profile switch | Not executed. Prerequisite: interactive macOS GUI session with a live DB profile pair so the native WebView can be dragged. Owner: rfxlamia. | BLOCKED |
| Default ratio after fresh launch; no saved layout restored | Fresh `bun run tauri dev`; confirm ~60/40 and no localStorage layout key | Not executed. Same GUI prerequisite. Automated: `workspace-split.test.tsx` asserts no `localStorage` / `onLayoutChanged`. Owner: rfxlamia. | BLOCKED |
| empty → loading → grid | Connect, runnable SELECT, Run | Not executed in native app. Automated: app-wiring idle-cache, deferred Run → loading → grid. Owner: rfxlamia. | BLOCKED |
| Start over while loading | Run, Start over before IPC returns | Not executed in native app. Automated: deferred Start-over race + second-run race in `app-wiring.test.tsx`. Owner: rfxlamia. | BLOCKED |
| Window shorter than 550px scrolls; panes stay ≥ 250 / 300 | Shrink window below 550px | Not executed. Prerequisite: resizable native window. Automated: `.app-shell { overflow: auto }` and `.app-main-column { min-height: 550px }` without `height: 100vh` / `overflow: hidden`. Owner: rfxlamia. | BLOCKED |

## Linux / WebKitGTK

**Environment:** unavailable on this Darwin host.

| Check | Command / build | Observed | Status |
|-------|-----------------|----------|--------|
| Drag divider, record position, switch profiles, divider unchanged | Linux host with Tauri v2 WebKitGTK deps; `bun install && bun run tauri dev` | Not executed. Prerequisite: Linux/WebKitGTK host. Owner: rfxlamia. | BLOCKED |
| Default ratio after fresh launch; no saved layout restored | Same as above, fresh launch | Not executed. Prerequisite: Linux/WebKitGTK host. Owner: rfxlamia. | BLOCKED |
| empty → loading → grid | Same as above | Not executed. Prerequisite: Linux/WebKitGTK host. Owner: rfxlamia. | BLOCKED |
| Start over while loading | Same as above | Not executed. Prerequisite: Linux/WebKitGTK host. Owner: rfxlamia. | BLOCKED |
| Window shorter than 550px scrolls; panes stay ≥ 250 / 300 | Same as above | Not executed. Prerequisite: Linux/WebKitGTK host. Owner: rfxlamia. | BLOCKED |

## Handoff

On a GUI host, walk the five checks above, replace BLOCKED with PASS or FAIL plus evidence (divider pixel/ratio before and after profile switch; launch default; short-window screenshot).
