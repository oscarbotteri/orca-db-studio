# Manual QA

A seeded "shop" database on all three engines, and a checklist to run by hand in Orca. Every item names the requirement from `docs/PRD.md` it verifies and the result you should see.

## Environment

You need Node 24+ and Docker. SQLite needs no service.

| Command            | What it does                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `npm ci`           | Install dependencies (first time only).                                                                                              |
| `npm run qa:up`    | Create `test/qa/.env` with random passwords on first use, generate the seed files, start PostgreSQL and MariaDB, wait until healthy. |
| `npm run qa:reset` | Delete the database volumes and the generated data, seed again, start again. Use it after a run that changed data.                   |
| `npm run qa:down`  | Stop the services. Data survives until `qa:reset`.                                                                                   |

`qa:up` is safe to run again. The first run pulls the images, so it takes a minute or two.

What you get, from `test/qa/.env`:

| Engine     | Where                                          | Credentials                                  |
| ---------- | ---------------------------------------------- | -------------------------------------------- |
| SQLite     | `test/qa/data/shop.db` (inside this workspace) | none                                         |
| PostgreSQL | `127.0.0.1:54329`, database `shop`             | user `shop`, `POSTGRES_PASSWORD` from `.env` |
| MariaDB    | `127.0.0.1:33306`, database `shop`             | user `shop`, `MARIADB_PASSWORD` from `.env`  |

`test/qa/.env` and `test/qa/data/` are gitignored. Read a password with `grep PASSWORD test/qa/.env`. The Compose project is named `db-studio-qa` in every checkout, so volumes left by an earlier `qa:up` (for instance from another worktree) keep their old passwords. If a login fails with "Access denied" right after a first `qa:up`, run `npm run qa:reset`. If a port is taken, change `POSTGRES_PORT` or `MARIADB_PORT` in `.env` and run `npm run qa:reset`.

### Start the plugin

```
npm run types            # a fresh worktree needs this once
orca plugin dev watch .
```

Open the **DB Studio** panel.

## The data

The same rows on every engine.

| Object         | Rows   | Notes                                                                                                                                                    |
| -------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `categories`   | 5      |                                                                                                                                                          |
| `products`     | 12     | foreign key to `categories`                                                                                                                              |
| `customers`    | 40     | every 7th has a `NULL` phone                                                                                                                             |
| `orders`       | 120    | foreign key to `customers`                                                                                                                               |
| `order_items`  | 300    | foreign keys to `orders` and `products`                                                                                                                  |
| `order_totals` | 120    | view over `orders` and `order_items`                                                                                                                     |
| `events`       | 50,000 | big enough to hit the row limit and the result ceiling                                                                                                   |
| `type_samples` | 9      | one row per edge case: `null`, empty string, very long text, unicode and emoji, bigint above 2^53, bigint min and max, json, timestamp with zone, binary |

A QA run is a pass when every item below behaves as written on every engine it lists. Note the engine, the item and what you saw for each failure.

## Checklist

Run the checks in order: later ones reuse the connections created in section 1. "Run" means open a query document on the connection and press Run (Cmd/Ctrl+Enter). The SQL below is plain SQL and works on all three engines unless it says otherwise.

### 1. Connections

| #    | Req | Engine              | Steps                                                                                                                                                    | Expected                                                                                                                                           |
| ---- | --- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1  | C3  | SQLite              | In the panel press **+** (New connection), choose engine **SQLite** and press **Find in workspaces**.                                                    | `test/qa/data/shop.db` is in the list of files found in the workspaces.                                                                            |
| 1.2  | C3  | SQLite              | Select it and save.                                                                                                                                      | Path and name are filled in; it appears in **Connections** with the database icon and expands into its tables and the view.                        |
| 1.3  | C3  | SQLite              | Create another SQLite connection by pasting the absolute path of `shop.db`.                                                                              | Saving fails with "This file is already saved as shop.db"; nothing is duplicated.                                                                  |
| 1.4  | C3  | SQLite              | Paste a path that does not exist and save.                                                                                                               | A clear error; the form stays open and nothing is added.                                                                                           |
| 1.5  | C1  | PostgreSQL          | **New connection**: engine PostgreSQL, host `127.0.0.1`, port `54329`, database `shop`, user `shop`, the password from `.env`. Press **Test**.           | The test succeeds.                                                                                                                                 |
| 1.6  | C1  | PostgreSQL          | Save it.                                                                                                                                                 | It appears in **Connections**, between the saved connections sorted by name.                                                                       |
| 1.7  | C1  | PostgreSQL          | Repeat 1.5 with a wrong password.                                                                                                                        | The test fails with an error and nothing is saved.                                                                                                 |
| 1.8  | C1  | MariaDB             | **New connection**: engine MySQL / MariaDB, host `127.0.0.1`, port `33306`, database `shop`, user `shop`, the password from `.env`. Test, then save.     | The test succeeds and the connection appears under **Connections**.                                                                                |
| 1.9  | C2  | PostgreSQL, MariaDB | In a new connection form paste a connection string (see [Connection strings](#connection-strings)).                                                      | Engine, host, port, database and user are prefilled.                                                                                               |
| 1.10 | C1  | PostgreSQL          | Edit the connection, change only its name, leave the password field empty, save, then run `SELECT 1`.                                                    | The password field shows "Unchanged" and the query still connects.                                                                                 |
| 1.11 | C1  | PostgreSQL, MariaDB | Delete the connection, then create it again as in 1.5 (1.8 for MariaDB).                                                                                 | It disappears from the panel, then comes back working.                                                                                             |
| 1.12 | C1  | all                 | Search the workspace for the passwords: `grep -rlF "$(sed -n 's/^POSTGRES_PASSWORD=//p' test/qa/.env)" . --exclude-dir=node_modules --exclude-dir=.git`. | The only hit is `test/qa/.env` (plus a worktree `.env` or `.env.local` if you already did section 7); no `.db-studio/` file contains the password. |
| 1.13 | C4  | PostgreSQL, MariaDB | Follow [Worktree connection](#7-worktree-connection-c4).                                                                                                 | A worktree connection is listed and runs queries.                                                                                                  |

### 2. Explorer

| #   | Req | Engine     | Steps                                              | Expected                                                                                                                                                  |
| --- | --- | ---------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1 | E1  | SQLite     | Expand the file.                                   | Tables `categories`, `customers`, `events`, `order_items`, `orders`, `products`, `type_samples` and the view `order_totals`.                              |
| 2.2 | E1  | PostgreSQL | Expand the connection, then `shop`, then `public`. | The same seven tables and the view.                                                                                                                       |
| 2.3 | E1  | MariaDB    | Expand the connection, then `shop`.                | The same seven tables and the view.                                                                                                                       |
| 2.4 | E1  | all        | Click `customers`.                                 | A `.sql` document opens in `.db-studio/` of the workspace, first line names the connection, with a `SELECT` on `customers`. Running it shows all 40 rows. |
| 2.5 | E1  | all        | Click the view `order_totals`.                     | It opens the same way and runs.                                                                                                                           |
| 2.6 | E1  | all        | Close and reopen the document from disk.           | The first line still names the connection and Run works without choosing one again.                                                                       |
| 2.7 | Q1  | all        | Open a query document with no connection line.     | A "Choose connection" control is shown; choosing one writes the first line.                                                                               |

### 3. Running statements

| #   | Req | Engine | SQL                                                                                                  | Expected                                                      |
| --- | --- | ------ | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 3.1 | Q1  | all    | Put the cursor in the second of two statements: `SELECT 1;` then `SELECT 2;` on separate lines. Run. | Only the statement under the cursor runs: the grid shows `2`. |
| 3.2 | Q1  | all    | Select both statements. Run.                                                                         | An error asks you to select a single statement.               |
| 3.3 | Q1  | all    | Select only `SELECT 1`. Run.                                                                         | Only the selection runs.                                      |
| 3.4 | Q1  | all    | Run `SELEC 1`.                                                                                       | The database error is shown; the editor stays usable.         |
| 3.5 | G1  | all    | `UPDATE customers SET phone = phone WHERE id <= 3`                                                   | No grid rows; the notice says `3 rows affected.`              |
| 3.6 | G1  | all    | `SELECT count(*) AS n FROM order_items`                                                              | `300`.                                                        |

### 4. Row limit and result ceiling

Default settings: `rowLimit` 100.

| #   | Req | Engine | SQL                                                                                                          | Expected                                                                                                                                                                                            |
| --- | --- | ------ | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.1 | G1  | all    | `SELECT * FROM events`                                                                                       | Exactly 100 rows and a notice that the row limit cut the result off.                                                                                                                                |
| 4.2 | G1  | all    | `SELECT * FROM customers`                                                                                    | All 40 rows, no notice.                                                                                                                                                                             |
| 4.3 | G1  | all    | `SELECT * FROM events LIMIT 150`                                                                             | 150 rows, no notice: the query's own `LIMIT` replaces the row limit.                                                                                                                                |
| 4.4 | G1  | all    | Set the `rowLimit` setting to `10`, then run `SELECT * FROM events`.                                         | 10 rows and the notice. Set it back to `100`.                                                                                                                                                       |
| 4.5 | G1  | all    | `SELECT * FROM events LIMIT 50000`                                                                           | 5000 rows and a visible cut-off notice: the result ceiling applies even with its own `LIMIT`. The notice text says "The row limit cut the result off" for the ceiling too. The UI stays responsive. |
| 4.6 | G1  | all    | `SELECT t.text_value FROM type_samples t JOIN events e ON 1 = 1 WHERE t.label = 'very long text' LIMIT 5000` | Fewer than 5000 rows (the ~900 KB ceiling is reached first) and the cut-off notice.                                                                                                                 |
| 4.7 | G1  | all    | `SELECT * FROM events LIMIT 4999`                                                                            | 4999 rows and no notice: under the ceiling, so nothing is cut off.                                                                                                                                  |
| 4.8 | G1  | all    | `SELECT id FROM events ORDER BY id`                                                                          | Rows with ids 1 to 100 in order, and the notice.                                                                                                                                                    |

### 5. Exact cell values

Run `SELECT * FROM type_samples ORDER BY id` on each engine, then check the rows.

| #    | Req    | Engine              | Row (`label`)           | Expected                                                                                                                                       |
| ---- | ------ | ------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 5.1  | G1     | all                 | `null`                  | `NULL` is shown as such, distinct from an empty string.                                                                                        |
| 5.2  | G1     | all                 | `empty string`          | An empty cell, not `NULL`; `big_number` is `0`; `json_value` is `{}`.                                                                          |
| 5.3  | G1, G3 | all                 | `very long text`        | The cell is cut short in the grid. Opening the cell shows the full value: 22,500 characters, ending in `lazy dog. `.                           |
| 5.4  | G1     | all                 | `unicode and emoji`     | `Zażółć gęślą jaźń · 日本語のテキスト · مرحبا · 🐙🚀👩‍👩‍👧‍👦` exactly, with the family emoji intact.                                                 |
| 5.5  | G1     | all                 | `bigint above 2^53`     | `big_number` is exactly `9007199254740993`, not `9007199254740992`.                                                                            |
| 5.6  | G1     | all                 | `bigint min and max`    | `big_number` is exactly `9223372036854775807`; `text_value` shows both limits.                                                                 |
| 5.7  | G1, G3 | all                 | `json`                  | `json_value` keeps `"big":9007199254740993` exact. Opening the cell shows it formatted (G3). On PostgreSQL the key order may differ (`jsonb`). |
| 5.8  | G1     | PostgreSQL          | `timestamp with zone`   | `zoned_at` is the instant `2024-03-15` `08:30:00.123` UTC, whichever offset the grid shows it in.                                              |
| 5.9  | G1     | MariaDB             | `timestamp with zone`   | `2024-03-15 08:30:00.123` (stored as the UTC instant, no offset).                                                                              |
| 5.10 | G1     | SQLite              | `timestamp with zone`   | `2024-03-15T10:30:00.123+02:00`, as the stored text.                                                                                           |
| 5.11 | G1     | all                 | `binary`                | A placeholder with the size (6 bytes), not garbled text.                                                                                       |
| 5.12 | G1     | all                 | `SELECT 1 AS a, 2 AS a` | Both columns shown, with their own values (`1` and `2`).                                                                                       |
| 5.13 | G1     | PostgreSQL, MariaDB | `SELECT 1.10 AS price`  | `1.10`, trailing zero kept.                                                                                                                    |

### 6. Cancel and timeout

Slow statements per engine:

| Engine     | Slow statement                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------- |
| PostgreSQL | `SELECT pg_sleep(60)`                                                                                         |
| MariaDB    | `SELECT SLEEP(60)`                                                                                            |
| SQLite     | `WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 1000000000) SELECT count(*) FROM c` |

| #   | Req | Engine     | Steps                                                                                                                                                                                                                                                                                | Expected                                                                                 |
| --- | --- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| 6.1 | Q3  | all        | Run the slow statement, wait 3 s, cancel it.                                                                                                                                                                                                                                         | The run stops within a few seconds with a cancelled message. The editor is usable again. |
| 6.2 | Q3  | all        | Right after 6.1 run `SELECT 1`.                                                                                                                                                                                                                                                      | It answers at once: the connection survived the cancel (SQLite starts a new session).    |
| 6.3 | Q3  | PostgreSQL | While the slow statement runs, in another connection run `SELECT state FROM pg_stat_activity WHERE query LIKE '%pg_sleep%' AND pid <> pg_backend_pid()`. Then cancel.                                                                                                                | Before the cancel one `active` row; after it, no `active` row for it.                    |
| 6.4 | Q3  | MariaDB    | While the slow statement runs, from a terminal: `docker compose -f test/qa/compose.yaml --env-file test/qa/.env exec mariadb sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" -e "SHOW PROCESSLIST"'` (the password is read inside the container, not from your shell). Then cancel. | Before the cancel the `SLEEP` query is listed; after it, it is gone.                     |
| 6.5 | Q3  | all        | While a slow statement runs, work in the panel and in another query document.                                                                                                                                                                                                        | The UI never blocks, SQLite included.                                                    |
| 6.6 | Q3  | all        | Run the slow statement and do not cancel it.                                                                                                                                                                                                                                         | After the `queryTimeoutSeconds` setting (30 s by default) it stops with a timeout error. |
| 6.7 | Q3  | all        | Set `queryTimeoutSeconds` to `5`, run the slow statement.                                                                                                                                                                                                                            | The timeout error arrives after about 5 s. Set it back to `30`.                          |
| 6.8 | Q3  | all        | Try to set `queryTimeoutSeconds` to `111`.                                                                                                                                                                                                                                           | The setting is rejected: the maximum is 110.                                             |

## Connection strings

Replace the placeholders with the values in `test/qa/.env` (`POSTGRES_PASSWORD`, `MARIADB_PASSWORD`). The passwords are hex, so they need no URL encoding.

```
postgres://shop:<POSTGRES_PASSWORD>@127.0.0.1:54329/shop
postgresql://shop:<POSTGRES_PASSWORD>@127.0.0.1:54329/shop
mysql://shop:<MARIADB_PASSWORD>@127.0.0.1:33306/shop
```

Paste one into the **Connection string** field (C2) or into a worktree's `.env` (C4).

## 7. Worktree connection (C4)

DB Studio reads `<worktree>/.env` and `<worktree>/.env.local` on use, takes the variable named by the `envVariable` setting (default `DATABASE_URL`) and lists a connection for that worktree. Only local workspaces are read, and only `postgres://`, `postgresql://` and `mysql://` URLs count. `.env.local` wins when both define the variable. The URL is never stored.

The `.env` files are gitignored, so you can write them in this worktree without touching the repo. Do each step with a fresh look at the panel.

| #   | Req    | Engine              | Steps                                                                                                                                                                                                    | Expected                                                                                                   |
| --- | ------ | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 7.1 | C4     | PostgreSQL          | Add `DATABASE_URL=postgres://shop:<POSTGRES_PASSWORD>@127.0.0.1:54329/shop` to this worktree's `.env`. Reopen the panel.                                                                                 | A worktree connection for this workspace is listed, with no password prompt.                               |
| 7.2 | C4, E1 | PostgreSQL          | Expand it and run `SELECT count(*) FROM customers`.                                                                                                                                                      | The tree shows the shop; the query returns `40`.                                                           |
| 7.3 | C4     | MariaDB             | Replace the line with `DATABASE_URL=mysql://shop:<MARIADB_PASSWORD>@127.0.0.1:33306/shop`.                                                                                                               | The connection now points at MariaDB and the same query returns `40`.                                      |
| 7.4 | C4     | PostgreSQL          | Put the PostgreSQL URL in `.env.local` and keep the MariaDB one in `.env`.                                                                                                                               | The connection uses PostgreSQL: `.env.local` wins.                                                         |
| 7.5 | C4     | PostgreSQL, MariaDB | Set the `envVariable` setting to `SHOP_URL` and put `SHOP_URL=<a QA URL>` in `.env`.                                                                                                                     | The connection comes from `SHOP_URL`; a `DATABASE_URL` line is now ignored. Set it back to `DATABASE_URL`. |
| 7.6 | C4     | PostgreSQL, MariaDB | Set `DATABASE_URL=sqlite:///tmp/x.db`.                                                                                                                                                                   | No worktree connection is listed: only `postgres://`, `postgresql://` and `mysql://` count.                |
| 7.7 | C4     | PostgreSQL, MariaDB | Remove the line from both files.                                                                                                                                                                         | The worktree connection disappears.                                                                        |
| 7.8 | C4     | all                 | With a worktree connection open, grep `.db-studio/` and the worktree for the password (`grep -rlF "$(sed -n 's/^POSTGRES_PASSWORD=//p' test/qa/.env)" . --exclude-dir=node_modules --exclude-dir=.git`). | Only `.env` or `.env.local` and `test/qa/.env` match: the URL is read on use and never copied anywhere.    |

Delete the `.env` and `.env.local` lines you added when you are done.

## Reset and clean up

```
npm run qa:reset   # fresh data on all three engines, e.g. after you changed data while testing
npm run qa:down    # stop the services when you are finished
```

`qa:reset` removes the Docker volumes. To also remove the generated files and the passwords, delete `test/qa/data/` and `test/qa/.env`; the next `qa:up` recreates both with new passwords, so run `qa:reset` as well, or the old volumes keep the old passwords.
