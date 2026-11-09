# PRD: DB Studio for Orca (PostgreSQL · MySQL · SQLite)

## Summary

DB Studio is an Orca plugin for working with PostgreSQL, MySQL/MariaDB and SQLite without leaving Orca: browse a database's tables, open one, and run SQL against it from an editor tab. Later versions give Orca's agents safe, visible access to the database.

Terms in this document follow `GLOSSARY.md`.

## Problem

Today there is no good way to work with a server database inside Orca.

- **The official plugin only covers SQLite.** The official SQLite Browser opens `.db`/`.sqlite` files in an editor tab and is read-only. It cannot connect to a database server.
- **Other plugins are early.** Community attempts exist, but they live in a small side panel, cap results at a few hundred rows, and lack basics like autocomplete or cell editing.
- **The good experience lives on other platforms.** Mature database tooling exists in other editors and standalone clients, but it is usually tied to a single engine or a single cloud, and it knows nothing about Orca's agents or worktrees.

The result: Orca users keep TablePlus, DBeaver or `psql` open on the side, and agents work against the database with no visibility or control for the person.

## Goals

1. **Look at a database without leaving Orca:** connect, see its tables, open one, run a query. This is the MVP.
2. **One model for three engines:** same UI and features everywhere; engine differences stay inside the driver.
3. **Per-worktree databases:** each worktree's own database, read from its `.env`, with nothing to configure.
4. **Safe agent access (v1):** Orca's agents query the database over MCP, read-only by default. The activity log of what they ran follows in v2 (A4).
5. **Publishable in the Orca plugin directory**, as a public project (`oscarbotteri/orca-db-studio`) once the MVP works.

## Non-goals (for now)

- Server administration: creating instances, users, backups, replicas.
- Cloud console integrations (Azure, AWS RDS, etc.) beyond reading credentials.
- Schema migrations or diffs between databases.
- Non-relational engines (MongoDB, Redis) and other SQL engines (SQL Server, Oracle).
- A built-in "chat with your database": Orca's agents cover that through MCP.
- Guard rails for the person in the MVP: no read-only mode, environment labels or write confirmations. Whoever uses the plugin is responsible for what they run.

## Users and use cases

The primary user is a developer who runs several agents in parallel in Orca, each in its own worktree, and needs to see what is happening in the database while they work.

| Use case                                                                | What they need                                                    | Version |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------- | ------- |
| Check what an agent left in the database after a migration or seed      | Open the table instantly, edit the query to filter it             | MVP     |
| Each worktree points at its own database (Docker, Neon/Supabase branch) | Worktree connection read from the worktree's `.env`               | MVP     |
| Debug an issue with real data in dev or staging                         | Fast queries with autocomplete, edit a single row, copy results   | v1, v2  |
| Let Claude Code query the database to write a query or an endpoint      | Read-only MCP access, no credentials pasted into prompts          | v1      |
| Let an agent fix data in dev                                            | Writes with explicit approval and a log of what ran               | v2      |
| Investigate a slow query                                                | Readable `EXPLAIN ANALYZE` without leaving Orca                   | v3      |

Worktree connections are the key differentiator: no existing tool understands that each Orca workspace can have its own database.

## MVP

The MVP is done when, on all three engines, a person can:

1. Create a connection (form or pasted connection string) to a server or a SQLite file, or pick a worktree connection, all from the panel.
2. Expand it in the panel and see its tables and views.
3. Click a table: a query document opens with `SELECT * FROM <table> LIMIT 100` and runs it.
4. Edit and run any SQL in a query document, see the first rows of the query result in a grid, open a long cell value in full, and cancel a slow query.

Opening a table is not a separate view: it is a query document prefilled with a query the person can edit, page or sort by hand.

## Functional requirements

`MVP` is the first release; `v1`, `v2` and `v3` follow in that order. Every requirement applies to all three engines unless stated otherwise.

| ID  | Area         | Requirement                                                                                                               | Version |
| --- | ------------ | ------------------------------------------------------------------------------------------------------------------------- | ------- |
| C1  | Connections  | Create, edit, test and delete PostgreSQL, MySQL/MariaDB and SQLite connections; passwords only in Orca's secrets store    | MVP     |
| C2  | Connections  | Paste a connection string (`postgres://`, `mysql://`) and prefill the form                                                | MVP     |
| C3  | Connections  | Save a SQLite file as a connection from the connection form: pick one found in the workspaces or paste a path            | MVP     |
| C4  | Connections  | Worktree connection: read `DATABASE_URL` (or a configurable variable) from each worktree's `.env` / `.env.local` and list it in the panel | MVP     |
| C5  | Connections  | Environment label (`local`, `dev`, `staging`, `prod`) shown as a colored tab                                              | v1      |
| C6  | Connections  | SSL/TLS modes and certificates; SSH tunnel                                                                                | v2      |
| C7  | Connections  | Credentials from AWS Secrets Manager / RDS IAM auth                                                                       | v3      |
| E1  | Explorer     | Tree in the panel: connection → database → schema → tables and views                                                      | MVP     |
| E2  | Explorer     | Search objects by name and type without expanding the tree                                                                | v2      |
| E3  | Explorer     | Refresh schema; notify when an agent changes the schema (DDL in the activity log)                                         | v2      |
| E4  | Explorer     | Functions, indexes, triggers and sequences in the tree                                                                    | v1      |
| Q1  | SQL editor   | Query document with dialect-aware highlighting; run the statement under the cursor or the selection                       | MVP     |
| Q2  | SQL editor   | Autocomplete for tables, columns and keywords from the live schema                                                        | v1      |
| Q3  | SQL editor   | Cancel a running query, on all three engines; configurable timeout up to 110 s                                            | MVP     |
| Q4  | SQL editor   | Per-connection query history; saved queries as `.sql` files in the repo                                                   | v2      |
| Q5  | SQL editor   | Multiple query results when running several statements                                                                   | v2      |
| G1  | Grid         | Query result in a grid, cut off at the row limit (default 100) unless the query has its own `LIMIT`, and always at the result ceiling (5000 rows or ~900 KB), with a visible notice; long cells are shortened; statements without rows show the affected row count | MVP |
| G2  | Grid         | Sort and filter by column from the grid, applied on the server                                                            | v2      |
| G3  | Grid         | Panel with the full cell value (up to 1 MiB); formatted JSON/JSONB                                                        | MVP     |
| G4  | Grid         | Copy cells, rows or results as CSV, JSON, Markdown or `INSERT`                                                            | v1      |
| G5  | Grid         | Export the full result to CSV/JSON via streaming                                                                          | v2      |
| G6  | Grid         | Virtualized grid paged against the server, with no row limit                                                              | v2      |
| D1  | Data editing | Edit cells, add and delete rows on tables with a primary key; changes stay as a draft until "Apply"                       | v2      |
| D2  | Data editing | Preview the SQL to be executed; run it inside a transaction                                                               | v2      |
| S1  | Schema       | Schema page with the DDL of every object                                                                                  | v1      |
| S2  | Schema       | ER diagram with foreign keys                                                                                              | v3      |
| S3  | Schema       | `EXPLAIN` / `EXPLAIN ANALYZE` visualizer (tree with costs and timings)                                                    | v3      |
| A1  | Agents       | MCP server with `list_connections`, `describe_schema`, `run_query`, injected when Orca launches agents; `run_query` returns 100 rows by default, 1000 at most | v1 |
| A2  | Agents       | Agent access per connection: `off` or `read-only` (default)                                                               | v1      |
| A3  | Agents       | `read-write` agent access; agent writes wait for approval in the UI, with a notification                                  | v2      |
| A4  | Agents       | Activity log: SQL, origin (person or agent, and worktree), duration, rows, outcome                                        | v2      |
| A5  | Agents       | Open the result of an agent's query in the grid                                                                           | v2      |
| X1  | General      | Commands in Orca's palette: new query, open table, switch connection                                                      | v1      |
| X2  | General      | Open `psql` / `mysql` in an Orca terminal with the active connection                                                      | v3      |
| X3  | General      | "Open SQLite file" command in Orca's palette                                                                              | MVP     |

## Non-functional requirements

**Performance**

- First rows of a table in under 500 ms against a local database.
- Never load a full result into memory: read through a cursor and stop at the row limit (or the query's own `LIMIT`) and always at the result ceiling.
- The UI never blocks during a query, including on SQLite.

**Packaging**

- Every file in the plugin is 1 MiB or less; bundled code is committed with its source and build script, and third-party notices are generated.

**Security**

- Passwords only in Orca's secrets store; never in logs or plain storage. When the secrets store is unavailable (Linux without a keyring), saving a connection with a password fails with a clear error.
- Worktree connections are read from the worktree's `.env` / `.env.local` when used and never copied into DB Studio's storage.
- From v1: agent read-only mode is enforced by the database session, not only by parsing SQL; credentials never reach agents.

**Compatibility**

- PostgreSQL 13+, MySQL 8+, MariaDB 10.6+, SQLite 3.40+.
- macOS, Windows and Linux, same as Orca.

**Quality**

- Driver tests against real databases in CI.
- MIT license, with third-party notices for bundled drivers.
