# DragonDB

**Build SQL visually. Understand what it generates.**

A cross-platform PostgreSQL client with a visual SQL builder, for people who are
still learning SQL. Connects directly to your databases — connection details,
queries, and results never pass through a DragonDB server.

Runs on macOS, Windows, and Linux.

## Status

Early development. The macOS-only SwiftUI predecessor lives at
[rfxlamia/dragondb-swift](https://github.com/rfxlamia/dragondb-swift) and is maintained for
bug fixes only.

## Acknowledgments

DragonDB is a fork of [O'Saasy](https://github.com/PostgresGUI/app) by Fikri Ghazi,
built on the shoulders of giants. Special thanks to:

- The [PostgresNIO](https://github.com/vapor/postgres-nio) team, whose PostgreSQL
  client library powered the original macOS application
- The [Swift NIO](https://github.com/apple/swift-nio) project for the networking foundation
- The [Tauri](https://tauri.app) project, which makes the cross-platform build possible
