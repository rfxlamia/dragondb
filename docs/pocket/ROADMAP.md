# DragonDB Visual SQL Roadmap

**Status:** Draft  
**Product direction:** Visual SQL learning + query building  
**Primary database:** PostgreSQL first  
**Roadmap principle:** Expand capability only when each new SQL concept can remain understandable in the visual model.

---

## Brand Line

> **Build SQL visually. Understand what it generates.**

DragonDB should not position Visual mode as a way to avoid SQL forever. The goal is to help people become capable with SQL by letting them manipulate familiar concepts visually, see the SQL those actions generate, run it, and observe the result.

The core learning loop is:

```text
Build visually
      ↓
See generated SQL
      ↓
Run query
      ↓
See result
      ↓
Change something
      ↓
Understand what changed
```

A successful roadmap should make this loop deeper over time without turning the product into a visual representation of every possible SQL grammar rule.

---

# Product Principles

## 1. Visual concepts should represent user intent

Do not require a strict 1:1 mapping between every SQL keyword and a visual block.

Simple concepts can stay close to SQL:

```text
SELECT
FROM
WHERE
ORDER BY
LIMIT
```

More advanced concepts may be expressed in beginner-friendly language first and compiled to SQL underneath.

Example:

```text
SUMMARIZE
Group by: customer_id
Calculate: SUM(amount)
```

may generate:

```sql
SELECT customer_id, SUM(amount)
FROM orders
GROUP BY customer_id;
```

The UI should teach SQL terminology through use, not require users to know the terminology before using the feature.

## 2. Visual and SQL are two representations of one query

The long-term mental model is:

```text
Visual representation  ↔  SQL representation
                    ↓
                  Result
```

Visual mode helps construct and understand. SQL mode remains the direct text-editing environment.

## 3. Prefer progressive complexity

Do not expose the full SQL language at once.

Each phase should unlock a meaningful class of real queries while keeping the interface understandable.

## 4. Do not chase complete SQL coverage

The product does not need to visually represent every PostgreSQL feature.

Advanced SQL should eventually have escape hatches rather than forcing increasingly complicated node UI.

## 5. Preserve a reusable query model

Visual cards should mutate a query model / intermediate representation, not concatenate SQL strings directly.

```text
Visual blocks
      ↓
Query model / IR
      ↓
Validation
      ↓
SQL generator
      ↓
Postgres
```

This keeps the logic reusable if the visual chrome changes later.

---

# Phase 0 — Thin Slice / Core Execution Loop

## Goal

Prove that a beginner can construct a useful query visually, generate safe SQL, execute it, and understand the connection between the blocks and the result.

## Includes

- Visual / SQL editor mode
- Linear block chain
- `SELECT`
- `FROM`
- Single-condition `WHERE`
- `ORDER BY`
- `LIMIT`
- All columns vs specific columns
- Generated SQL preview
- Query execution
- Existing results grid
- PostgreSQL only
- Simple `CREATE TABLE` path already defined by v1

## Why this phase exists

The first risk is not whether DragonDB can eventually model JOINs, subqueries, or CTEs.

The first risk is whether this interaction feels useful at all:

```text
block → SQL → result
```

A narrow but polished loop gives a much better signal than broad SQL support with weak interaction design.

## User benefit

A beginner can answer simple questions about one table without remembering SQL syntax.

Examples:

```sql
SELECT *
FROM users;
```

```sql
SELECT name, email
FROM users
WHERE name LIKE '%Agus%'
ORDER BY created_at DESC
LIMIT 20;
```

## Exit criteria

Phase 0 is complete when:

- the normal SELECT path feels reliable;
- specific-column selection is comfortable;
- `WHERE`, `ORDER BY`, and `LIMIT` are understandable without documentation;
- generated SQL always matches what will execute;
- validation failures explain how to fix the query;
- builder sits above the results area with a usable split layout.

---

# Phase 1 — Make “Understand What It Generates” Real

## Goal

Turn generated SQL from a utility preview into a first-class learning surface.

## Includes

### Collapsible Generated SQL Inspector

Add an optional, read-only inspector on the right side of the visual workspace.

```text
┌───────────────────────────────┬──────────────────────┐
│ Visual Builder                │ Generated SQL        │
│                               │                      │
│ [SELECT] → [FROM] → [WHERE]  │ SELECT ...           │
│                               │ FROM ...             │
│                               │ WHERE ...            │
└───────────────────────────────┴──────────────────────┘
                 ↓
             Query Results
```

Recommended behavior:

- closed by default;
- opened from `View generated SQL`;
- approximately 300–350 px initial width;
- resizable if practical;
- read-only;
- copy action available;
- updates immediately when visual state changes.

### SQL change feedback

When a meaningful visual action changes the generated SQL, optionally highlight or emphasize the affected fragment.

Example:

```diff
 SELECT *
 FROM users
+WHERE name LIKE '%Agus%';
```

This can start simple. It does not need a full semantic diff engine in the first implementation.

## Why this phase exists

The brand promise is not only:

> Build SQL visually.

It is:

> **Build SQL visually. Understand what it generates.**

If generated SQL is hidden behind an occasional modal, the second half of that promise is weak.

The user should be able to connect:

```text
name contains Agus
```

with:

```sql
WHERE name LIKE '%Agus%'
```

and then connect both with the resulting rows.

## User benefit

Users begin recognizing SQL while using the product.

The learning progression becomes:

```text
I do not know this syntax
        ↓
I recognize this syntax
        ↓
I understand why it appeared
        ↓
I can predict what SQL will be generated
```

## Exit criteria

- Generated SQL can remain visible while editing visually.
- Changes in blocks update SQL immediately.
- Opening the inspector does not make the builder unusably cramped.
- The result panel remains below the editor.
- Visual mode and SQL mode still have clearly different purposes.

---

# Phase 2 — Everyday Single-Table Queries

## Goal

Make Visual mode sufficient for most normal questions against one table.

## Includes

### Better projection

- specific column multi-select;
- `SELECT *`;
- `DISTINCT`.

### Richer filters

Expand `WHERE` beyond one simple condition.

Useful operators may include:

- equals;
- not equal;
- greater than;
- less than;
- greater than or equal;
- less than or equal;
- contains;
- starts with;
- ends with;
- is empty / is null;
- is not empty / is not null.

Operator availability should eventually consider column type.

### Multiple conditions

Keep a single conceptual `WHERE` block with multiple conditions rather than creating multiple independent WHERE cards.

Example:

```text
WHERE

name        contains       Agus
AND
created_at  after          2026-01-01

+ Add condition
```

Generated SQL:

```sql
WHERE name LIKE '%Agus%'
  AND created_at > '2026-01-01';
```

Start with a simple flat `AND` / `OR` model. Nested Boolean groups can wait.

### Sorting

Allow multiple sort fields only if there is a clear user need. One-column sorting is enough initially.

## Why this phase exists

A query builder becomes genuinely useful when users can answer normal filtering questions without leaving the visual model.

This phase should maximize usefulness before introducing relational complexity.

## User benefit

Users can answer questions such as:

- “Show active users created this year.”
- “Find products containing this word.”
- “Show the newest 50 records.”
- “Return only these three columns.”
- “Show unique countries.”

## Exit criteria

A user can build a broad set of single-table SELECT queries without switching to handwritten SQL.

---

# Phase 3 — Relational SQL / JOIN

## Goal

Let users answer questions involving more than one table.

JOIN is the first major complexity jump and should be treated as its own product milestone.

## Includes

Start with:

- `INNER JOIN`;
- `LEFT JOIN`.

Do not begin by exposing every PostgreSQL join type.

### Beginner-facing JOIN UI

Prefer intent-oriented choices.

Example:

```text
JOIN
Combine this table with another table

Table
orders

Match
users.id = orders.user_id

Rows to keep
● Only matching rows
○ Keep every users row
```

The generated SQL may be:

```sql
SELECT *
FROM users
INNER JOIN orders
    ON users.id = orders.user_id;
```

### Schema-aware assistance

Where possible:

- show columns from both tables;
- use foreign-key metadata to suggest likely relationships;
- disambiguate duplicate column names;
- handle table aliases internally when necessary.

Automatic suggestions should assist, not prevent manual configuration.

## Why this phase exists

JOIN is where SQL becomes meaningfully relational.

It is also where beginner confusion rises sharply, so the visual UI can provide substantial value beyond syntax completion.

## User benefit

Users can answer questions such as:

- “Show each user with their orders.”
- “Find customers that have payments.”
- “Show products with their category names.”

At the same time, users learn what JOIN conditions mean and how `INNER JOIN` differs conceptually from `LEFT JOIN`.

## Exit criteria

- a two-table JOIN can be configured without SQL knowledge;
- generated SQL remains readable;
- column pickers understand both sources;
- ambiguous columns are handled safely;
- visual complexity remains manageable.

---

# Phase 4 — Summaries and Analytics

## Goal

Support the most common analytical SQL workflows without forcing beginners to reason directly about `GROUP BY` grammar.

## Includes

### Aggregate functions

Start with:

- `COUNT`;
- `SUM`;
- `AVG`;
- `MIN`;
- `MAX`.

### SUMMARIZE experience

Consider presenting aggregation as a user-intent block such as `SUMMARIZE`.

Example:

```text
SUMMARIZE

Group rows by
customer_id

Calculate
SUM(amount)
```

Generated SQL:

```sql
SELECT customer_id, SUM(amount)
FROM orders
GROUP BY customer_id;
```

### GROUP BY

Expose the SQL term where useful, but do not require the user to understand it before constructing the summary.

### HAVING

Add filtering of aggregate results after the basic aggregation model is stable.

Example:

```text
Only keep groups where
SUM(amount) > 1000000
```

Generated SQL:

```sql
HAVING SUM(amount) > 1000000;
```

## Why this phase exists

Many users query databases not merely to retrieve rows but to answer questions:

- how many;
- how much;
- average;
- highest;
- lowest;
- per customer / per month / per category.

This is where DragonDB can become useful for analysts rather than only SQL beginners inspecting records.

## User benefit

Users can build queries such as:

- “How many users are in each country?”
- “What is total revenue per customer?”
- “What is the average order value?”
- “Which customers spent more than one million?”

Users learn the connection between aggregation and `GROUP BY` through direct manipulation.

## Exit criteria

Common aggregation queries can be built visually without exposing confusing invalid SQL states.

---

# Phase 5 — Power-User Bridge

## Goal

Prevent users from immediately outgrowing Visual mode as their SQL skills improve.

This phase is not about visually representing every advanced SQL feature.

It is about providing a controlled path from visual construction into more expressive SQL.

## Possible capabilities

Introduce gradually based on observed demand:

- aliases;
- expressions;
- calculated columns;
- `CASE`;
- `UNION`;
- subqueries;
- CTEs;
- advanced filter grouping;
- selected PostgreSQL functions.

### Custom SQL escape hatch

For concepts that are expensive or confusing to represent visually, allow an advanced escape hatch rather than expanding the node grammar indefinitely.

The exact design should be validated before implementation.

## Why this phase exists

Visual programming has a complexity cliff.

At some point:

```sql
WITH ...
SELECT ...
```

may be easier for an experienced user than manipulating a large visual graph.

DragonDB should not turn a simple query builder into an unreadable visual programming language just to claim complete SQL coverage.

## User benefit

Intermediate users can remain in DragonDB while gradually moving toward direct SQL.

The product becomes a bridge instead of a beginner-only dead end.

## Exit criteria

Users can leave the supported visual subset gracefully without losing access to normal SQL workflows.

---

# Phase 6 — Visual ↔ SQL Learning Bridge

## Goal

Make the transition between visual query building and handwritten SQL increasingly fluid.

This is deliberately later because round-trip conversion is substantially harder than one-way visual → SQL generation.

## Possible capabilities

### Explain existing SQL

Given a supported SQL query, show a readable structural explanation.

Example:

```sql
SELECT name
FROM users
WHERE active = true;
```

could be explained as:

```text
Read from users
Return name
Keep rows where active equals true
```

### SQL → visual reconstruction

For a supported subset of SQL, reconstruct the visual representation.

This should only be attempted when the mapping is predictable enough to avoid surprising users.

### Learning annotations

Help users understand relationships such as:

```text
contains
→ LIKE '%value%'
```

```text
Only matching rows
→ INNER JOIN
```

```text
Keep every row from the first table
→ LEFT JOIN
```

## Why this phase exists

The long-term product story is progression:

```text
I cannot write SQL
      ↓
I can build SQL visually
      ↓
I recognize SQL
      ↓
I understand SQL
      ↓
I can edit and write SQL
```

Round-trip capabilities become much more valuable after the visual query model itself has stabilized.

## User benefit

DragonDB becomes not only a query builder, but an environment for becoming more fluent in SQL.

---

# Later / Research Track

These should not block the main roadmap.

Potential areas:

- nested Boolean expression groups;
- more JOIN types;
- window functions;
- advanced CTE support;
- PostgreSQL-specific expressions;
- schema relationship visualization;
- freeform canvas;
- reusable query fragments;
- saved visual templates;
- query explanation / learning hints;
- multi-database dialect support;
- AI-assisted query construction.

Each should be justified by real user demand rather than added simply because PostgreSQL supports it.

---

# What Is Explicitly Not the Goal

DragonDB Visual mode is **not** trying to become:

- a visual representation of the entire PostgreSQL grammar;
- an n8n clone;
- a replacement for the SQL editor;
- a system that hides SQL forever;
- an AI text-to-SQL wrapper;
- a full ETL/workflow automation product.

The visual builder should remain focused on one job:

> Help users construct useful SQL while gradually understanding the SQL they are constructing.

---

# Roadmap Summary

```text
PHASE 0
Thin Slice
SELECT / FROM / WHERE / ORDER / LIMIT
        ↓
PHASE 1
Live Generated SQL
Make the learning loop visible
        ↓
PHASE 2
Everyday Single-Table Queries
Columns / DISTINCT / richer filters / AND-OR
        ↓
PHASE 3
Relational SQL
JOIN
        ↓
PHASE 4
Analytics
COUNT / SUM / AVG / GROUP BY / HAVING
        ↓
PHASE 5
Power-User Bridge
Expressions / advanced constructs / escape hatch
        ↓
PHASE 6
Visual ↔ SQL Learning Bridge
Explain SQL / supported round-trip
```

---

# Product North Star

The product should feel successful when a user starts with:

> “I don't remember SQL syntax.”

and eventually reaches:

> “I know what this SQL is doing.”

DragonDB does not win by keeping users dependent on blocks.

It wins when visual interaction gives users enough confidence and understanding that SQL stops feeling inaccessible.

> **Build SQL visually. Understand what it generates.**
