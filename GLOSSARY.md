# DB Studio

An Orca plugin for browsing and querying PostgreSQL, MySQL/MariaDB and SQLite databases without leaving Orca.

## Language

**Engine**:
The database product behind a connection: PostgreSQL, MySQL/MariaDB or SQLite.
_Avoid_: Dialect, database type, provider

**Connection**:
A saved, named way to reach one database, created by the person in DB Studio.
_Avoid_: Datasource, profile, server

**Worktree connection**:
A connection read from a worktree's `.env` each time it is used and never saved by DB Studio; the worktree's `.env` stays its only source.
_Avoid_: Per-worktree connection, detected connection, env connection

**SQLite file**:
A `.db`/`.sqlite` file on disk that the person opens as a connection.
_Avoid_: Local database, embedded database

**Query document**:
A `.sql` file opened in DB Studio's editor that names the connection it runs against.
_Avoid_: Query tab, scratch, console

**Query result**:
The rows a query document returns, cut off at the row limit unless the query sets its own, and never beyond the result ceiling.
_Avoid_: Result set, output
