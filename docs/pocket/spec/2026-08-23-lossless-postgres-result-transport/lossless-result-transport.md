# Lossless PostgreSQL Result Transport

**Date:** 2026-08-23
**Status:** approved
**Author:** pocket-grinding session
**Spec path:** docs/pocket/spec/2026-08-23-lossless-postgres-result-transport/lossless-result-transport.md
**GitHub issue:** #15

---

## Summary

DragonDB decodes PostgreSQL result cells with a hand-written seven-type switch and falls
back to decoding everything else as a Rust `String`. When that fallback fails, the error is
discarded and the cell becomes `Value::Null` — so a non-NULL database value is presented as
NULL. This spec replaces the result boundary with a text-first transport that carries
PostgreSQL's own rendering of every value, carries column type metadata alongside it, and
makes a read failure a distinct, visible state that can never be mistaken for SQL NULL.

The bug is not display-only. Because the row editor writes back every non-primary-key
column, a column that decoded to a fake NULL is written back as a real NULL — silent data
loss in the user's database. This spec closes that path too.

---

## Context

### Current State

- `src-tauri/src/postgres/query.rs:cell_value()` handles `BOOL`, `INT2/4/8`, `FLOAT4/8`,
  and `TEXT/VARCHAR/NAME/BPCHAR`. Every other type hits
  `row.try_get::<_, Option<String>>(idx).ok().flatten().map(Value::Text).unwrap_or(Value::Null)`.
- `Value` is `#[serde(untagged)]`, so `Int(i64)` and `Float(f64)` reach JavaScript as JSON
  numbers. Values above `Number.MAX_SAFE_INTEGER` (9007199254740991) lose precision
  silently.
- `looks_like_select()` gates row-returning behaviour on the first keyword being `SELECT` or
  `WITH`. Everything else goes to `client.execute()` and shows no grid.
- `run_query()` splits statements via `split_sql_statements()`, may wrap them in
  `BEGIN`/`COMMIT` via `should_wrap_transaction()`, and returns only the last row-producing
  result.
- `src/ui/results/row-editor.tsx:62-65` builds the update patch from **every** non-primary-
  key column, not only the ones the user changed.
- `src/ui/results/format-result-cell.ts` runs `formatQueryDate` on every string cell, and
  `format-query-date.ts:5` decides whether a value is a date from a regex on its **content**.
- `src/stores/tabs-store.ts:463` persists the full untruncated result grid to sqlite as
  `cachedResultsData` on every successful run.

### Problem / Motivation

Three distinct states are conflated into one:

```
the database returned SQL NULL
DragonDB does not support this type
decoding failed for another reason
```

Only the first may become NULL in the UI. Observed in practice: `DATE` and timestamp
columns that hold values in DBeaver appear as NULL in DragonDB.

Two further correctness risks follow from the same boundary: `int8` and `numeric` lose
precision crossing IPC as JavaScript numbers, and the fake-NULL cells are written back to
the database by the row editor.

### Related Areas

| Area | Files |
|---|---|
| Rust transport | `src-tauri/src/postgres/query.rs`, `postgres/mod.rs`, `session/mod.rs`, `commands.rs` |
| IPC contract | `src/ipc/contract.ts` |
| Result UI | `src/ui/results/query-results-pane.tsx`, `format-result-cell.ts`, `json-viewer.tsx`, `row-editor.tsx`, `results-copy.ts` |
| Shared libs | `src/lib/csv-exporter.ts`, `src/lib/result-compactor.ts`, `src/lib/format-query-date.ts` |
| State | `src/stores/tabs-store.ts` |
| Tests | 20 files (~9,486 lines) touch result shape |

---

## Scope

### In-Scope

1. Text-first, lossless display-value transport — `int8` and `numeric` never pass through a
   JavaScript number.
2. A four-state cell invariant: value, SQL NULL, unreadable, truncated. A read failure is
   never laundered into NULL at any layer.
3. Column type metadata (PostgreSQL type name + type OID) carried separately from raw
   values, as an index-aligned parallel array.
4. Statement framing from the protocol rather than keyword matching — `SHOW`, `EXPLAIN`,
   `VALUES`, `TABLE`, and `RETURNING` all display their rows.
5. Multi-statement scripts: last row-producing result displayed, plus a statement counter,
   plus partial-failure reporting (how many succeeded, rolled back or committed).
6. Per-cell markers in the grid for unreadable and truncated cells.
7. Date formatting driven by column type, applied to exactly `date`, `timestamp`,
   `timestamptz`.
8. Sorting driven by column type, numerically correct and precision-safe for `int8` /
   `numeric`.
9. Copy JSON: natural JSON types where lossless, JSON strings for `int8` / `numeric`.
10. Row editor sends only the columns the user actually changed; unreadable and truncated
    cells are read-only.
11. Old cached result blobs discarded and cleared from sqlite on upgrade.
12. A local PostgreSQL integration test suite covering the type matrix.

### Out-of-Scope

- **`json_to_text_sql` rejecting JSON arrays/objects, and schema-aware type identity for
  mutation casts** (`row_ops.rs:203`, `row_ops.rs:220`) — issue S4, tracked as #16. Text-first transport
  makes every patch and PK value a JSON string, so nothing in this scope reaches the
  rejecting branch. Deferred because it is a *write*-path type-identity problem, separable
  from the *read*-path fidelity problem, and better done after this lands.
- **PostgreSQL service container in GitHub Actions CI** — issue S5, tracked as #17. Infrastructure work
  that should not gate a P0 correctness fix. The suite itself ships here; only its
  automation is deferred.
- **Rich per-type editors** (JSON tree, enum dropdown, array editor, PostGIS viewer) — the
  issue's own non-goals. Correctness and faithful display first.
- **Multi-result-set UI** — showing every statement's result needs a UI pattern the creative
  brief does not define.
- **"Save full value to file" for truncated cells** — every comparable client offers it; a
  reasonable follow-up, not required for correctness.
- **Replacing bind parameters with SQL string interpolation** — explicitly forbidden.

---

## Architecture Constraints

- **May touch:** `src-tauri/src/postgres/**`, `src-tauri/src/session/`, `src-tauri/src/commands.rs`,
  `src/ipc/contract.ts`, `src/ui/results/**`, `src/lib/{csv-exporter,result-compactor,format-query-date}.ts`,
  `src/stores/**`
- **Must NOT touch:** `src/core/**` stays pure — no UI imports, no Tauri imports
- **Patterns that must be followed:**
  - `src/ipc/contract.ts` is the single source of IPC shape
  - Mutations stay parameterized; no value interpolation
  - `split_sql_statements()` and `should_wrap_transaction()` keep their current behaviour
  - Test-first, per repo convention
  - `bun run check` and `bun run tauri:check` must pass
  - UI decisions follow `docs/pocket/rule/creative-brief.md`
- **Architecture validation result: PASS** — with two accepted consequences: the IPC shape
  changes (handled explicitly by Story 9, not silently), and each statement costs two round
  trips (prepare + execute).

---

## Dependencies

### Existing (to leverage)

- `tokio-postgres` 0.7.18 — `Client::prepare` for column metadata and type OIDs;
  `Client::simple_query` for PostgreSQL's own text rendering; `DECLARE CURSOR` bound
  through the extended protocol for parameterized display queries.
- `serde_json` — IPC payload shaping.

### New (proposed)

**None.** Text rendering is delegated to PostgreSQL's own output functions rather than
re-implemented in Rust. Hand-rolling per-type text rendering was evaluated as Option C and
rejected — see Design Decision.

---

## Verified Facts

Everything below was verified against live PostgreSQL 16.14 and the pinned crate source
during discovery. The design rests on these, so they are recorded rather than assumed.

| Fact | Evidence |
|---|---|
| `::text` is structurally total | Every type must have an output function; when no cast is registered, `::text` uses it |
| `::text` **loses data** for `char(n)` | `'ab'::char(6)` renders `ab␣␣␣␣` (6 bytes) but `'ab'::char(6)::text` renders `ab` (2 bytes) |
| `::text` diverges for exactly three types | `bool` (`t`→`true`), `bpchar` (padding stripped), `inet` (`192.168.1.1`→`192.168.1.1/32`). All others identical |
| Array text is unambiguous | real NULL → `{a,NULL,c}`; literal "NULL" → `{a,"NULL",c}` |
| `SHOW` / `EXPLAIN` return `text` columns | `\gdesc` reports `text`; `EXPLAIN (FORMAT JSON)` reports `json`, `(FORMAT XML)` reports `xml` |
| Extended protocol works on utility statements | `SHOW`, `EXPLAIN`, `TABLE` all succeed via `\bind` |
| `SHOW` cannot be wrapped | `SELECT * FROM (SHOW timezone) q` → syntax error |
| `INSERT … RETURNING` cannot be a subquery | valid only as a data-modifying CTE |
| Parameterized cursor + simple fetch is faithful | `DECLARE … CURSOR FOR SELECT $1::char(6)` then `FETCH ALL` returns `ab␣␣␣␣` with padding intact |
| tokio-postgres hardcodes binary results | `Some(1)` result format in `src/query.rs:324` — the extended protocol never yields PG text on its own |
| `SimpleColumn` carries only a name | `simple_query` provides no type OIDs and accepts no parameters |
| Text sort regresses numeric columns | `["-5","3","-10"]` with `localeCompare(…,{numeric:true})` → `-5, -10, 3` |
| `timestamptz` parse is broken two ways | PG renders `+07`; `HAS_EXPLICIT_OFFSET` requires `+HH:MM`, so whole-hour values never parse. Half-hour zones parse but format through `getUTC*`, showing the wrong day |

---

## Cell States

Four states. Every consumer path handles all four.

| State | Meaning | Origin |
|---|---|---|
| `value` | A rendered PostgreSQL value | normal path |
| `null` | The database holds SQL NULL | normal path |
| `unreadable` | DragonDB could not render the value | non-UTF-8 server encoding |
| `truncated` | Value exceeded the per-cell transport cap | oversized value |

`unreadable` is deliberately rare. Because PostgreSQL's output function is structurally
guaranteed, the only real producer is a database whose server encoding is not UTF-8. It
exists as proof that a read failure is never laundered into `null`, not as an everyday
state.

### Copy (creative brief: sentence case, no internal codes, never blames the user)

- `unreadable` badge, error tint: **Can't display**
  Accessible name: *DragonDB couldn't read this `<pg_type_name>` value. The row is unchanged
  in the database.*
- `truncated` badge, warning tint: reuses the existing `... [truncated]` convention
  (`result-compactor.ts:6`).

### Export representation

Exports are never blocked by these states, and never emit an empty field for them.

| State | CSV field | Copy JSON |
|---|---|---|
| `null` | empty | `null` |
| `unreadable` | `[unreadable]` | `"[unreadable]"` |
| `truncated` | value + `... [truncated]` | value + `... [truncated]` |

---

## Stories + Scenarios

### Story 1: Lossless value display

> As an analyst, I want every value PostgreSQL can render to appear exactly as PostgreSQL
> renders it, so that I can trust what the grid shows.

**Rule 1.1: A non-NULL database value is never displayed as NULL**

| Input | Expected raw cell |
|---|---|
| `DATE '2026-08-03'` | `2026-08-03` |
| `TIMESTAMPTZ '2026-08-03 12:34:56+07'` | `2026-08-03 12:34:56+07` |
| `INTERVAL '1 year 2 mons 3 days 04:05:06'` | identical string |
| `E'\\x00ff10'::bytea` | `\x00ff10` |
| `ARRAY['a',NULL,'c']::text[]` | `{a,NULL,c}` |
| `ARRAY['a','NULL','c']::text[]` | `{a,"NULL",c}` |
| `'{"a":1,"b":[true,null]}'::jsonb` | `{"a": 1, "b": [true, null]}` |
| `'ab'::char(6)` | `ab␣␣␣␣` — padding preserved |
| enum `RELEASE` | `RELEASE` |
| domain over int, value 5 | `5` |
| `ROW(1,'hi')` | `(1,hi)` |
| `'192.168.1.1/24'::inet` | `192.168.1.1/24` |
| `'[1,10)'::int4range` | `[1,10)` |

**Rule 1.2: Exact-precision values never pass through a JavaScript number**

- `9223372036854775807::int8` → `"9223372036854775807"`
- `-9223372036854775808::int8` → `"-9223372036854775808"`
- `12345678901234567890.1234567890123456789::numeric` → identical digits

**Rule 1.3: Float special values survive as text** — `NaN`, `Infinity`, `-Infinity`

**Rule 1.4: A value above the per-cell cap becomes `truncated`**, not a silent partial value
and not an error.

```gherkin
Scenario: A bigint at the signed 64-bit maximum keeps every digit
  Given a column of type int8 holding 9223372036854775807
  When the user runs SELECT on that column
  Then the raw cell value is the string "9223372036854775807"
  And no cell in the IPC payload is a JSON number

Scenario: A high-precision numeric is not rounded
  Given a numeric column holding 12345678901234567890.1234567890123456789
  When the user runs SELECT on that column
  Then the raw cell value equals that digit sequence exactly

Scenario: A DATE column displays instead of becoming NULL
  Given a date column holding DATE '2026-08-03'
  When the user runs SELECT on that column
  Then the raw cell value is "2026-08-03"
  And the cell is not the null state

Scenario: A char(6) column keeps its padding
  Given a char(6) column holding 'ab'
  When the user runs SELECT on that column
  Then the raw cell value is "ab    " with all six characters

Scenario: An array containing a real NULL is distinguishable from the string "NULL"
  Given col_a is ARRAY['a',NULL,'c']::text[] and col_b is ARRAY['a','NULL','c']::text[]
  When the user runs SELECT on both columns
  Then col_a's raw value is "{a,NULL,c}"
  And col_b's raw value is "{a,\"NULL\",c}"

Scenario: A user-defined type unknown to DragonDB still displays
  Given a column of a user-defined type with no registered cast to text
  When the user runs SELECT on that column
  Then the raw cell value is the type's output-function rendering
  And the cell is neither the null nor the unreadable state

Scenario: An oversized value becomes the truncated state
  Given a bytea column holding a value larger than the per-cell transport cap
  When the user runs SELECT on that column
  Then the cell carries the truncated state
  And the cell is neither the null nor the unreadable state
  And the transported payload for that cell does not exceed the cap
```

---

### Story 2: Cell-state invariant

> As an analyst, I want to tell "the database holds NULL" apart from "DragonDB could not
> read this", so that I never draw a conclusion from a value the client invented.

**Rule 2.1:** SQL NULL is its own state and renders as the existing `NULL` token.
**Rule 2.2:** An unreadable value is its own state, marked per cell; the rest of the grid
renders normally.
**Rule 2.3:** A read failure is never converted into another state, at any layer.
**Rule 2.4:** Every consumer of raw cells — grid, filter, sort, CSV, Copy JSON, result cache
— handles all four states explicitly. None may stringify a marker into `[object Object]` or
coerce it to null.

```gherkin
Scenario: A real SQL NULL renders as NULL
  Given a nullable column whose value is SQL NULL
  When the user runs SELECT on that column
  Then the raw cell value is null
  And the grid renders the NULL token

Scenario: An unreadable value is visibly distinct from NULL
  Given a database whose server encoding is not UTF-8
  And a column value whose bytes are not valid UTF-8
  When the user runs SELECT on that column
  Then the cell carries the unreadable state, not null
  And the grid renders the "Can't display" badge in that cell only
  And every other cell in the row renders normally

Scenario: A read failure never fabricates NULL
  Given the result path fails to read one cell for any reason
  When the result is mapped for IPC
  Then that cell carries the unreadable state
  And no code path maps a read failure to null

Scenario: State markers never leak as object text
  Given a result containing one unreadable cell and one truncated cell
  When the row is exported to CSV and copied as JSON
  Then no output field contains "[object Object]"
  And the unreadable field is the documented sentinel, not an empty field
```

---

### Story 3: Column type metadata

> As the results UI, I want each column's PostgreSQL type, so that I format, sort, and
> compare values without inspecting their text.

**Rule 3.1:** Every result column carries its PostgreSQL type name and type OID.
**Rule 3.2:** Raw values and type metadata are separate fields in the IPC contract.
**Rule 3.3:** An empty result set still exposes full column metadata.
**Rule 3.4:** Column metadata is an array positionally aligned with `columns`, never a map
keyed by column name — result column names are not unique.

```gherkin
Scenario: Column metadata accompanies the result
  Given a SELECT returning columns of types int8 and timestamptz
  When the result reaches the frontend
  Then each column exposes its name, its PostgreSQL type name, and its type OID

Scenario: A query returning zero rows still describes its columns
  Given SELECT id, created_at FROM users WHERE false
  When the result reaches the frontend
  Then columns are ["id", "created_at"] with their type metadata
  And rows is empty

Scenario: Duplicate column names keep distinct metadata
  Given SELECT a.id, b.id FROM a JOIN b ON a.id = b.a_id
  And a.id is int4 while b.id is uuid
  When the result reaches the frontend
  Then the metadata entry at index 0 is int4 and at index 1 is uuid
  And sorting or formatting column 1 does not use column 0's type
```

---

### Story 4: Statement framing from the protocol

> As a user, I want every statement that produces rows to show its rows, so that DragonDB
> does not swallow results based on the statement's first keyword.

**Rule 4.1:** Whether a statement produces rows is determined by the prepared statement's
column set, not by keyword matching.
**Rule 4.2:** A statement with no result columns reports rowsAffected and shows no grid.
**Rule 4.3:** `rowsAffected` and the statement counter are carried on the `ok` variant of
`TabRunStatus`. A no-column statement must not render as a zero-row grid with "No rows
found".
**Rule 4.4:** If `prepare()` fails for a statement, the statement still executes; columns
come from the protocol's row description and the type metadata is marked unknown. This is a
designed fallback, not an error.

```gherkin
Scenario: SHOW displays its row
  Given a connected session
  When the user runs SHOW timezone
  Then the grid shows one column named TimeZone with one row

Scenario: EXPLAIN displays the plan
  Given a connected session
  When the user runs EXPLAIN SELECT 1
  Then the grid shows the QUERY PLAN column with at least one row

Scenario: EXPLAIN in JSON format displays its json value
  Given a connected session
  When the user runs EXPLAIN (FORMAT JSON) SELECT 1
  Then the grid shows one row whose raw value is the plan's JSON text
  And the cell is not the unreadable state

Scenario: INSERT with RETURNING shows the inserted row
  Given a table users(id serial, name text)
  When the user runs INSERT INTO users(name) VALUES ('ada') RETURNING *
  Then the grid shows the inserted row including its generated id

Scenario: A statement with no result columns reports affected rows
  Given a table users with 3 matching rows
  When the user runs UPDATE users SET name = 'x' WHERE ...
  Then no grid is shown
  And the run status reports 3 rows affected
  And the pane does not render the "No rows found" empty state

Scenario: A utility statement with no columns reports success
  Given a connected session
  When the user runs SET search_path TO public
  Then no grid is shown
  And the run reports success without a fabricated zero-row result set
```

---

### Story 5: Multi-statement scripts

> As a user running a script, I want to know that more than one statement ran and what
> happened to each, so that I never mistake the last result for the only result — or assume
> nothing was written when something was.

**Rule 5.1:** The displayed grid is the last row-producing statement's result (unchanged).
**Rule 5.2:** The run status reports how many statements ran and which one is displayed.
**Rule 5.3:** Transaction wrapping behaviour is unchanged.
**Rule 5.4:** When a statement fails partway through a script, the error reports how many
statements had already succeeded and whether they were rolled back or committed.
**Rule 5.5:** The statement counter is status text only. It is never a selector between
results — that would be the excluded multi-result-set UI.

```gherkin
Scenario: A two-statement script reports both ran
  Given a connected session
  When the user runs "SELECT 1 AS a; SELECT 2 AS b"
  Then the grid shows column b with value "2"
  And the run status reports 2 statements ran, showing statement 2

Scenario: A single statement reports no statement counter
  Given a connected session
  When the user runs "SELECT 1"
  Then the run status reports the row count and duration with no statement counter

Scenario: A wrapped script that fails partway reports the rollback
  Given a three-statement script eligible for transaction wrapping
  And statement 2 raises a database error
  When the user runs the script
  Then the error reports that statement 2 of 3 failed
  And the error states that statement 1 was rolled back
  And no grid from statement 1 is shown

Scenario: An unwrapped script that fails partway reports the commit
  Given a three-statement script containing VACUUM, so wrapping is suppressed
  And statement 2 raises a database error
  When the user runs the script
  Then the error reports that statement 2 of 3 failed
  And the error states that statement 1 was already committed

Scenario: Transaction wrapping is unchanged by this work
  Given a script containing VACUUM
  When the user runs it
  Then the script is not wrapped in BEGIN/COMMIT
```

---

### Story 6: Type-driven presentation

> As an analyst, I want formatting driven by the column's type, so that a text column shows
> exactly what it contains and a date column shows the day PostgreSQL meant.

**Rule 6.1:** The date-format setting applies to exactly `date`, `timestamp`, `timestamptz`.
`time`, `timetz`, `interval`, arrays of date/time types, and domains over them display
verbatim.
**Rule 6.2:** A text/varchar column is displayed verbatim regardless of its content.
**Rule 6.3:** Boolean columns display as `true` / `false`.
**Rule 6.4:** A formatted `timestamptz` denotes the same instant and calendar day
PostgreSQL rendered. The parser accepts PostgreSQL's whole-hour offset form (`+07`), and
formatting uses that offset rather than normalising to UTC.
**Rule 6.5:** Sorting uses the column's type: numeric types compare numerically, and
`int8`/`numeric` compare without passing through a JavaScript number. Date/time types
compare chronologically. Everything else compares as text.
**Rule 6.6:** The grid filter matches against both the raw value and the displayed value, so
type-driven formatting never makes a previously matching needle stop matching.

```gherkin
Scenario: A varchar holding a date-like code is not reformatted
  Given a varchar column holding the string "2024-01-15"
  And the date format setting is "us"
  When the grid renders that cell
  Then it displays "2024-01-15"

Scenario: A real date column honours the date format setting
  Given a date column holding DATE '2024-01-15'
  And the date format setting is "us"
  When the grid renders that cell
  Then it displays "1/15/2024"

Scenario: An interval is never reformatted
  Given an interval column holding '1 year 2 mons 3 days 04:05:06'
  And the date format setting is "us"
  When the grid renders that cell
  Then it displays "1 year 2 mons 3 days 04:05:06"

Scenario: A whole-hour timestamptz honours the setting
  Given a timestamptz column whose PostgreSQL rendering is "2026-08-03 01:00:00+07"
  And the date format setting is "us"
  When the grid renders that cell
  Then it displays "8/3/2026"

Scenario: A half-hour-offset timestamptz shows PostgreSQL's day
  Given a timestamptz column whose PostgreSQL rendering is "2026-08-03 01:00:00+05:30"
  And the date format setting is "us"
  When the grid renders that cell
  Then it displays "8/3/2026"

Scenario: A boolean column displays true/false
  Given a bool column holding true
  When the grid renders that cell
  Then it displays "true"

Scenario: A numeric column sorts numerically
  Given an int4 column holding the values -5, 3, -10
  When the user sorts that column ascending
  Then the row order is -10, -5, 3

Scenario: A bigint column sorts without precision loss
  Given an int8 column holding 9223372036854775806 and 9223372036854775807
  When the user sorts that column ascending
  Then 9223372036854775806 precedes 9223372036854775807
  And neither value passes through a JavaScript number during comparison

Scenario: A filter needle matching the raw value still matches
  Given a date column holding DATE '2024-01-15'
  And the date format setting is "us"
  When the user filters on "2024-01"
  Then the row matches
  When the user filters on "1/15"
  Then the row also matches
```

---

### Story 7: Export paths

> As an analyst, I want exports to carry exact values and to be honest about what could not
> be read, so that downstream tools receive what the database holds.

**Rule 7.1:** CSV export uses raw values.
**Rule 7.2:** JSON export uses natural JSON types where lossless, and JSON strings for
`int8` / `numeric`. This is a display/clipboard rule only — it is never reused as the row
editor's outbound value shape.
**Rule 7.3:** SQL NULL exports as JSON null and as an empty CSV field.
**Rule 7.4:** `unreadable` exports as the documented sentinel `[unreadable]`, never as an
empty field or JSON null. Export is never blocked by its presence.
**Rule 7.5:** `truncated` exports as the transported value plus the existing
`... [truncated]` suffix.

```gherkin
Scenario: JSON export keeps a bigint exact
  Given a row with id int8 = 9223372036854775807, qty int4 = 42, active bool = true
  When the user copies the row as JSON
  Then id is the JSON string "9223372036854775807"
  And qty is the JSON number 42
  And active is the JSON boolean true

Scenario: JSON export keeps a numeric exact
  Given a numeric column holding 12345678901234567890.1234567890123456789
  When the user copies the row as JSON
  Then that field is a JSON string with the identical digits

Scenario: NULL survives both exports
  Given a row whose note column is SQL NULL
  When the user copies the row as JSON
  Then note is JSON null
  When the user downloads the row as CSV
  Then the note field is empty

Scenario: An unreadable cell exports as a sentinel, not as empty
  Given a row with one unreadable cell
  When the user downloads the row as CSV
  Then that field is "[unreadable]"
  When the user copies the row as JSON
  Then that field is the JSON string "[unreadable]"
  And the export completes rather than being refused
```

---

### Story 8: Row editing safety

> As a user editing one field, I want untouched columns left alone, so that saving never
> overwrites data I never saw or changed.

**Rule 8.1:** A column is "changed" when its current field text differs from the value
prefilled when the editor opened. A NULL toggle switched on and back off is not a change.
**Rule 8.2:** The update patch contains only changed columns.
**Rule 8.3:** `unreadable` and `truncated` cells are read-only in the editor, so an edit to
them can never be silently discarded.
**Rule 8.4:** Primary-key values used to identify the row are the raw lossless values.
**Rule 8.5:** Explicitly setting a column to NULL is still possible and still sends NULL.
**Rule 8.6:** Row update stays parameterized; no value interpolation.

```gherkin
Scenario: Editing one field does not rewrite the others
  Given a row with name "ada" and created_at DATE '2026-08-03'
  When the user opens the row editor, changes name to "grace", and saves
  Then the UPDATE sets only the name column
  And created_at is not present in the patch

Scenario: A NULL toggle switched on and back off is not a change
  Given a row with note "hello"
  When the user marks note as NULL, unmarks it, and saves without other edits
  Then note is not present in the patch

Scenario: Saving with no changes performs no write
  Given a row editor opened with no field edited
  When the user saves
  Then no UPDATE is issued
  And the UI reports that nothing changed rather than reporting a successful save

Scenario: An unreadable column cannot be edited
  Given a row with one column in the unreadable state
  When the user opens the row editor
  Then that column's field is read-only
  And when the user changes an unrelated column and saves
  Then the unreadable column is not present in the patch

Scenario: Explicit NULL is still writable
  Given a row with note "hello"
  When the user marks note as NULL and saves
  Then the UPDATE sets note to SQL NULL

Scenario: A bigint primary key identifies the row exactly
  Given a table whose primary key is int8 with value 9223372036854775807
  When the user edits a non-key column of that row and saves
  Then the WHERE clause carries the exact value 9223372036854775807
  And exactly one row is updated

Scenario: Row update stays parameterized
  Given any row update
  When the SQL is built
  Then values are bound as parameters
  And no value is interpolated into the SQL string
```

> **Scope boundary:** these scenarios deliberately do not assert update correctness for
> array or domain columns. Those depend on `typed_eq` casting to a schema-qualified type
> rather than a bare `udt_name` (`row_ops.rs:220`), which is issue S4 (#16). Asserting them here
> would encode S4's fix as an acceptance criterion of this work.

---

### Story 9: Upgrade path

> As an existing user, I want the upgrade not to show me stale results in the wrong shape.

**Rule 9.1:** Cached result blobs written by the previous shape are discarded on load.
**Rule 9.2:** A tab with a discarded cache shows the existing idle empty state.
**Rule 9.3:** A discarded blob is deleted from sqlite rather than re-parsed and re-discarded
on every launch, and `cachedColumnNames` is cleared with it.

```gherkin
Scenario: An old cached result is discarded
  Given a persisted tab whose cachedResultsData was written in the previous cell shape
  When the app hydrates that tab
  Then no grid is restored
  And the tab shows "Run a query to see results"

Scenario: A discarded blob is cleared from storage
  Given a persisted tab whose cache was written in the previous cell shape
  When the app hydrates that tab and the user never re-runs the query
  Then cachedResultsData and cachedColumnNames are cleared in sqlite
  And a second launch does not re-parse the same stale blob

Scenario: A cache written by the new shape restores normally
  Given a persisted tab whose cache was written in the new shape
  When the app hydrates that tab
  Then the grid is restored with its column metadata
```

---

## Acceptance Criteria

```
ACCEPTANCE CRITERIA — Lossless PostgreSQL result transport
Date: 2026-08-23 | Scope confirmed: yes | GitHub issue: #15

Rule: Lossless value transport
  ✓ Given int8 = 9223372036854775807, When SELECTed, Then the raw cell is that exact string
  ✓ Given numeric with 39 significant digits, When SELECTed, Then no digit is lost
  ✓ Given char(6) holding 'ab', When SELECTed, Then the raw cell keeps all six characters
  ✓ Given DATE '2026-08-03', When SELECTed, Then it displays rather than becoming NULL
  ✓ Given a user-defined type with no text cast, When SELECTed, Then it displays faithfully
  ✗ Given any non-NULL value, When decoding fails, Then the cell is NEVER null

Rule: Cell-state invariant
  ✓ Given SQL NULL, When SELECTed, Then the cell is null and renders the NULL token
  ✓ Given an unreadable value, When SELECTed, Then the cell is visibly distinct from NULL
  ✓ Given a value over the cap, When SELECTed, Then the cell is truncated, not null
  ✗ Given a state marker, When exported, Then output NEVER contains "[object Object]"

Rule: Column type metadata
  ✓ Given any result, When it reaches the frontend, Then each column carries type name + OID
  ✓ Given zero rows, When the result arrives, Then column metadata is still complete
  ✓ Given duplicate column names, When metadata is read, Then each index keeps its own type

Rule: Statement framing
  ✓ Given SHOW timezone, When run, Then one row is displayed
  ✓ Given EXPLAIN SELECT 1, When run, Then the plan is displayed
  ✓ Given INSERT ... RETURNING *, When run, Then the inserted row is displayed
  ✓ Given UPDATE without RETURNING, When run, Then rowsAffected is reported and no grid shows
  ✗ Given a no-column statement, When run, Then it NEVER renders "No rows found"

Rule: Multi-statement reporting
  ✓ Given a 2-statement script, When run, Then the status reports 2 ran, showing statement 2
  ✓ Given statement 2 of 3 fails in a wrapped script, Then the error says statement 1 rolled back
  ✓ Given statement 2 of 3 fails unwrapped, Then the error says statement 1 was committed
  ✓ Given a script containing VACUUM, When run, Then it is not wrapped in BEGIN/COMMIT

Rule: Type-driven presentation
  ✓ Given varchar "2024-01-15" with format "us", When rendered, Then it shows "2024-01-15"
  ✓ Given date 2024-01-15 with format "us", When rendered, Then it shows "1/15/2024"
  ✓ Given timestamptz "2026-08-03 01:00:00+07" with format "us", Then it shows "8/3/2026"
  ✓ Given int4 values -5, 3, -10, When sorted ascending, Then the order is -10, -5, 3
  ✓ Given int8 values differing in the last digit, When sorted, Then the order is correct
  ✓ Given a date column and needle "2024-01", When filtered, Then the row still matches

Rule: Export fidelity
  ✓ Given int8 = 9223372036854775807, When copied as JSON, Then it is a JSON string
  ✓ Given int4 = 42, When copied as JSON, Then it is the JSON number 42
  ✓ Given SQL NULL, When copied as JSON, Then it is JSON null; as CSV, an empty field
  ✓ Given an unreadable cell, When exported, Then it is "[unreadable]" and export completes

Rule: Row editing safety
  ✓ Given a row editor with only `name` changed, When saved, Then the patch contains only name
  ✓ Given a NULL toggle switched on and off, When saved, Then that column is not in the patch
  ✓ Given no field edited, When saved, Then no UPDATE is issued
  ✓ Given an unreadable cell, When the editor opens, Then that field is read-only
  ✓ Given an int8 primary key, When the row is updated, Then the WHERE value is exact
  ✗ Given any row update, When SQL is built, Then values are NEVER interpolated

Rule: Upgrade path
  ✓ Given an old-shape cache blob, When hydrated, Then no grid is restored
  ✓ Given an old-shape cache blob, When hydrated, Then it is cleared from sqlite
  ✓ Given a new-shape cache blob, When hydrated, Then the grid restores with metadata

OPEN QUESTIONS (risks if unresolved):
  - Exact badge copy → assumed: "Can't display" / "... [truncated]" as proposed above
  - Integration suite gating → assumed: env var DRAGONDB_TEST_PG_URL; suite skips when unset
  - Per-cell cap value → assumed: proposed by pocket-planning alongside the transport task
  - Copy JSON with duplicate column names → assumed: last-wins, unchanged from today
  - Statement counter for scripts with no row results → assumed: shown whenever >1 statement ran
  - Raw boolean rendering → assumed: normalised in Rust to "true"/"false" using the type OID

OUT-OF-SCOPE (reminder for pocket-planning):
  - json_to_text_sql arrays/objects; schema-aware mutation type identity → issue S4 (#16)
  - PostgreSQL service container in CI → issue S5 (#17)
  - Rich per-type editors; multi-result-set UI; "save full value to file"
  - Replacing bind parameters with string interpolation — forbidden
```

---

## Design Decision

**Chosen option: Option B — `simple_query` for values, `prepare()` for metadata,
`DECLARE CURSOR` for parameterized display queries.**

**Summary:** Each statement is prepared (not executed) to obtain column names and type
OIDs. Values are then read through PostgreSQL's simple query protocol, which renders every
value with the type's own output function. Display queries that carry bind parameters —
only the visual query canvas produces these — bind through `DECLARE … CURSOR FOR <sql>` on
the extended protocol and are read back with `FETCH ALL` through the simple protocol, which
was verified to return byte-identical text to the unparameterized path.

**Rejected options:**

- **Option A — wrap the user's SQL in `::text` casts.** Rejected on a verified scenario, not
  a preference: `'ab'::char(6)::text` returns `ab`, dropping the padding that
  `'ab'::char(6)` renders as `ab␣␣␣␣`. It fixes one class of silent value corruption by
  introducing another. It also fails Story 4 outright — `SELECT * FROM (SHOW timezone) q`
  is a syntax error — requires rewriting `RETURNING` statements as CTEs, and places row
  order on a guarantee PostgreSQL does not give (a subquery's `ORDER BY` is not guaranteed
  to be preserved by the outer query).
- **Option C — decode raw binary and render text in Rust.** Rejected because it is exactly
  the per-type decoder treadmill the issue exists to escape, and because
  `tokio-postgres/src/query.rs:324` hardcodes the binary result format, so the extended
  protocol can never hand back PostgreSQL's text rendering on its own.

**Key tradeoffs accepted:**

- Two round trips per statement (prepare for metadata, then execute for values).
- Two sub-paths inside one transport — plain simple query, and the cursor path for the
  canvas — with the cursor path requiring correct transaction handling.
- Raw `bool` arrives as `t`/`f` from the output function. Assumed resolution: normalise to
  `true`/`false` in Rust using the type OID, so raw values are uniform across every consumer
  including CSV. The mapping is bijective, so no information is lost. `bool` is one of only
  three types whose two renderings differ at all.
- A per-cell transport cap means losslessness is bounded rather than absolute, matching what
  DBeaver, DataGrip, pgAdmin, and TablePlus all do.

---

## Open Questions / Assumptions

| Question | Resolution | Risk if Wrong |
|---|---|---|
| Exact badge copy for unreadable / truncated | assumed: "Can't display" and the existing `... [truncated]` | Cosmetic; a copy change, no structural rework |
| How the local PG suite is gated | assumed: `DRAGONDB_TEST_PG_URL`, suite skips when unset | Contributors without PostgreSQL see skipped tests instead of failures |
| Numeric value of the per-cell cap | assumed: proposed by pocket-planning with the transport task | Too low truncates ordinary values; too high reintroduces the payload risk |
| Copy JSON with duplicate column names | assumed: last-wins, unchanged from today | A JOIN copied as JSON silently drops one column — pre-existing, not a regression |
| Statement counter for scripts with no row results | assumed: shown whenever more than one statement ran | Minor status-text noise |
| Raw boolean rendering | assumed: normalised in Rust to `true`/`false` via the type OID | If left as `t`/`f`, CSV exports carry `t` and diverge from the grid |

---

## Implementation Notes

- Keep `split_sql_statements()` and `should_wrap_transaction()` exactly as they are, and
  call the transport once per split statement. `simple_query` performs its own implicit
  transaction handling when given multiple statements, which would otherwise collide with
  the existing wrapper and its ~200 lines of tests.
- `prepare()` is a Parse, not an execution, so preparing a mutation has no side effects.
  Rule 4.4's fallback exists for any statement PostgreSQL will not Parse.
- The visual query canvas is the only display-path caller producing non-empty bind params
  (`src/core/sql-generator.ts:90`). The SQL editor and table browse always send `params: []`.
- 20 test files touch result shape. Expect the bulk of the work to be updating them, not
  writing the transport.
- The integration suite needs `TimeZone` and `DateStyle` pinned so text assertions are
  deterministic across machines.

---

## Rollback Plan

- No database schema migration is involved — this changes a read path and an IPC shape only.
- Revert is a code revert. The one persisted artefact touched is `cachedResultsData`, which
  this work clears rather than rewrites; a reverted build simply finds an empty cache and
  shows the idle empty state until the user re-runs a query.
- The work is phaseable: the Rust transport plus contract can land before the frontend
  consumers, provided both ship in the same release, since the IPC shape change is not
  backward compatible.
