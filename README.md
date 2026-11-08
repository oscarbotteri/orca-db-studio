<p align="center">
  <img src="docs/assets/db-studio.png" alt="DB Studio logo" width="160">
</p>

<h1 align="center">DB Studio for Orca</h1>

<p align="center">
  Browse and query PostgreSQL, MySQL/MariaDB and SQLite without leaving <a href="https://github.com/stablyai/orca">Orca</a>.
</p>

<p align="center">
  <a href="https://github.com/oscarbotteri/orca-db-studio/actions/workflows/ci.yml"><img src="https://github.com/oscarbotteri/orca-db-studio/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/oscarbotteri/orca-db-studio" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?logo=node.js&logoColor=white" alt="Node 24+">
  <img src="https://img.shields.io/badge/orca-%3E%3D1.4.248-black" alt="Orca 1.4.248+">
  <img src="https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/code%20style-biome-60a5fa?logo=biome&logoColor=white" alt="Biome">
</p>

---

<p align="center">
  <img src="docs/assets/cover.png" alt="DB Studio in Orca: a query and its result grid">
</p>

## What is it?

DB Studio is an [Orca](https://github.com/stablyai/orca) plugin for looking at a database from the place you already work.

If you run several agents in parallel, each in its own worktree, you probably keep TablePlus, DBeaver or `psql` open next to Orca just to check what an agent left in a table. DB Studio replaces that window switch: connect, see the tables, click one, edit the query, run it.

It works the same on **PostgreSQL**, **MySQL/MariaDB** and **SQLite**.

## Why another database client?

- **It lives in Orca.** No second window, and no copying connection strings around.
- **It understands worktrees.** Each Orca workspace can point at its own database. If a workspace's `.env` (or `.env.local`) defines `DATABASE_URL`, DB Studio offers that database, grouped by workspace. Nothing to configure, and the URL is never copied: it is read from the `.env` every time you use it.
- **One model for three engines.** Same panel, same editor, same grid. Engine differences stay inside the drivers.
- **Safe by default.** Passwords live only in Orca's secrets store, never in logs or plain storage. Results are always cut off at a ceiling, so a careless query cannot flood the tab.

## How it works

1. Open the **DB Studio** panel in Orca's sidebar.
2. Pick a connection: one you saved, a SQLite file found in your workspaces, or a worktree connection read from a `.env`.
3. Expand it into databases, schemas, tables and views.
4. Click a table. A query document opens with `SELECT * FROM <table> LIMIT 100` and runs it.
5. Edit the SQL, run the statement under the cursor (or the selection) with <kbd>Cmd/Ctrl</kbd>+<kbd>Enter</kbd>, and read the result in the grid below.

Every tab is a plain `.sql` file whose first line names its connection:

```sql
-- db-studio: connection=<ref>
SELECT * FROM orders WHERE status = 'pending' LIMIT 100;
```

Keep a query by moving the file out of `.db-studio/` (a folder Git ignores on its own). Any `.sql` file in your repo opens in the same editor, with a "Choose connection" control when it has no connection line.

## Features (MVP)

**Connections**

- PostgreSQL, MySQL/MariaDB and SQLite, from a form or a pasted connection string (`postgres://`, `mysql://`).
- Test, edit and delete saved connections.
- SQLite files discovered in your workspaces, or any absolute path.
- Worktree connections read from each workspace's `.env` / `.env.local`.

**Explorer**

- One tree for every engine: connection → database → schema → tables and views.
- Clear errors when a connection fails.

**Query editor**

- SQL editor with dialect-aware highlighting ([CodeMirror 6](docs/adr/0001-sql-editor-codemirror.md)).
- Run the statement under the cursor or the selection.
- Cancel a running query. It stops in the database, not only in the UI.
- Configurable timeout (30 s by default, 110 s at most).

**Results**

- Grid with a visible notice when the row limit (100 by default) or the result ceiling (5000 rows or about 900 KB) cuts a result.
- Long text shortened, binary shown as `<blob 1.2 KB>`, large integers and decimals kept exact.
- Open any cell's full value (up to 1 MiB) in a side panel, with JSON formatted.
- Affected row count for statements without rows.

## Roadmap

A few of the things planned after the [MVP](https://github.com/oscarbotteri/orca-db-studio/milestone/1). Each version links to its GitHub milestone; requirement IDs refer to [`docs/PRD.md`](docs/PRD.md).

| Version                                                              | Highlights                                                                                                                                                                                                          |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[v1](https://github.com/oscarbotteri/orca-db-studio/milestone/2)** | Autocomplete from the live schema (`Q2`) · MCP server so agents can query read-only, with an activity log (`A1`, `A2`, `A4`) · copy results as CSV, JSON, Markdown or `INSERT` (`G4`) · schema page with DDL (`S1`) |
| **[v2](https://github.com/oscarbotteri/orca-db-studio/milestone/3)** | Edit cells and rows as a draft with SQL preview (`D1`, `D2`) · agent writes with explicit approval (`A3`) · sort, filter and export from the grid (`G2`, `G5`) · virtualized grid (`G6`)                            |
| **[v3](https://github.com/oscarbotteri/orca-db-studio/milestone/4)** | ER diagram (`S2`) · `EXPLAIN` visualizer (`S3`) · open `psql` / `mysql` in an Orca terminal (`X2`)                                                                                                                  |

## Getting started

You need Orca 1.4.248 or newer.

```bash
orca plugin install oscarbotteri/orca-db-studio
```

DB Studio runs its own code in a trusted worker, so Orca lists what it would be granted and asks you to approve it by re-running the command with the fingerprint it prints (`--approve <fingerprint>`). It asks for:

- **`secrets:own`**: to keep your saved passwords in Orca's encrypted secrets store.
- **`storage:own`** and **`settings:own`**: to keep your saved connections and settings.
- **`workspace:read`** and **`workspace:write`**: to find SQLite files and `.env` files in your workspaces, and to create query documents in `.db-studio/`.

Then open the **DB Studio** panel in Orca's sidebar.

### Settings

| Setting                 | Default        | What it does                                                                                    |
| ----------------------- | -------------- | ----------------------------------------------------------------------------------------------- |
| Connection variable     | `DATABASE_URL` | Variable read from each worktree's `.env` to offer its connection                               |
| Query timeout (seconds) | `30`           | The server ends a statement after this long (1 to 110)                                          |
| Row limit               | `100`          | Rows shown for a query without its own `LIMIT` (results never exceed 5000 rows or about 900 KB) |

### Run from source

To hack on DB Studio you need Node 24+ and the `orca` CLI.

```bash
git clone https://github.com/oscarbotteri/orca-db-studio.git
cd orca-db-studio
npm ci && npm run types
orca plugin dev watch .   # loads the plugin into Orca and reloads on save
```

### Useful commands

| Command                | What it does                                                         |
| ---------------------- | -------------------------------------------------------------------- |
| `npm run verify`       | Typecheck, `orca plugin validate`, lint and format check             |
| `orca plugin test .`   | Unit and component tests                                             |
| `orca plugin check .`  | Render checks for the panel and the editor                           |
| `npm run test:drivers` | Integration tests on real engines with Testcontainers (needs Docker) |
| `npm run build`        | Bundle the pure-JS drivers and CodeMirror into `vendor/`             |
| `npm run qa:up`        | Start the manual QA environment (see [`test/qa`](test/qa/README.md)) |

## Project layout

```
src/
  drivers/   one driver per engine behind a single interface
  worker/    connections, query engine and documents; the only code that talks to a database
  panel/     side panel: connections and explorer
  editor/    query document editor: SQL editor and result grid
build/       esbuild scripts that produce vendor/
vendor/      bundled pure-JS drivers, committed with their source
docs/        PRD, architecture and decision records (ADRs)
```

Every database call goes through the worker; UI code never touches a driver directly. Read [`docs/system-architecture.md`](docs/system-architecture.md) for the details and [`docs/adr/`](docs/adr/) for why the non-obvious choices were made.

## Contributing

Issues and pull requests are welcome. Before opening a PR, please:

- Read [`docs/PRD.md`](docs/PRD.md) and the architecture doc for the area you touch.
- Run `npm run verify`, and `npm run test:drivers` if you changed a driver.
- Use [Conventional Commits](https://www.conventionalcommits.org/) and reference the requirement ID (`C1`, `Q3`, ...) your change implements.

## License

[MIT](LICENSE) © Oscar Botteri. Bundled third-party code is listed in [`vendor/THIRD-PARTY-NOTICES.md`](vendor/THIRD-PARTY-NOTICES.md).
