# Release Notes Obligation — No Swift Data Migration (SP-2)

**Obligation:** Before SP-6 (and any public release that replaces the Swift app), release notes **must** state that **app-local data does not transfer from Swift**.

- Profiles, query history, and other SwiftData / local store content from `dragondb-swift` are **not** imported.
- SP-2 ships **no** SwiftData → rusqlite importer and **no** migration tooling.
- Users must re-create connection profiles in the Tauri app; secrets are stored only in the OS keyring for new saves.

This file records the obligation only. It is not user-facing release-notes copy.
