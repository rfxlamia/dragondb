# Agent Instructions

## Codebase Navigation via Graphify

This repo has a knowledge graph built with graphify. Use it to answer codebase
questions faster than reading files linearly.

- **Before answering a codebase question**, check if `graphify-out/graph.json` exists.
  If it does, query the graph first: `graphify query "<question>"` (or
  `/graphify query "<question>"` inside Command Code). For tracing a specific
  path use `graphify query "<question>" --dfs`; for a short answer use
  `graphify query "<question>" --budget 500`.
- **Look up single concepts** with `graphify explain "<entity>"` and find paths
  between two concepts with `graphify path "<a>" "<b>"`.
- **Rebuild the graph after significant code changes**: run `/graphify --update`
  (incremental — re-extracts only new/changed files) or `/graphify .` for a full
  rebuild. A post-commit hook keeps the graph fresh automatically after commits.
- **Graph outputs** live in `graphify-out/`:
  - `graph.json` — raw graph (queryable, GraphRAG-ready)
  - `GRAPH_REPORT.md` — audit report with god nodes, communities, surprising connections
  - `graph.html` — interactive visualizer
- **Honesty note**: edges are tagged EXTRACTED (explicit in source), INFERRED
  (reasonable inference), or AMBIGUOUS (uncertain). Trust EXTRACTED edges most;
  verify INFERRED/AMBIGUOUS claims against source before citing them.

## Project Conventions

- **Design authority**: consult `docs/pocket/rule/creative-brief.md` before any
  UI/UX planning or development. No UI decision should be made without it.
- **Architecture boundaries**: `src/core/` stays pure (no UI, no Tauri imports).
  UI lives in `src/ui/**`. Rust I/O lives in `src-tauri/src/`.
- **Check**: run `bun run check` (typecheck + lint + tests) before considering
  work complete.
