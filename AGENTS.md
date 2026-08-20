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

## Deferred Decisions → GitHub Issues

- **ALWAYS open a GitHub issue when a "proper" option is deferred** in favor of a simpler one during brainstorming, grinding, or planning. This is mandatory, non-negotiable, and holds even in long, bloated sessions — never skip it.
  
- Do not silently drop a deferred option. The issue must record: 
  
  (1) the proper option that was deferred, 
  
  (2) why it was deferred (scope, time, complexity, risk), and 
  
  (3) what adopting it later would involve. 
  
  Its purpose: when a future decision takes the proper path, a ready-made issue already exists as the next
  step.

## Teach While Building

- **Teach the user what you're doing while you work.** Whenever the task touches a technical concept the user may not know (e.g. async/await, concurrency, garbage collection, event loop, indexes, file I/O), give a short, beginner-friendly explanation — plain language with everyday analogies, no jargon, no implementation detail dumps. This applies in every session, no matter how long or bloated the context gets.
- The user is a non-technical learner building this project to understand engineering concepts. Explain in Bahasa Indonesia in a casual register, and tie each concept to the actual code being written so the learning happens as the work happens.
