# 0003. Every tab is a `.sql` file; SQLite files open from the panel

Status: accepted

## Context

DB Studio needs editor tabs for running queries and opening tables, and the PRD asked for `.db`/`.sqlite` files to open as a file editor (C3).

Orca 1.4.251 (and the pinned source) allows neither directly:

- A custom editor is strictly file-backed. There is no API to open an editor tab that is not a file. `editor.open` takes a workspace id and a workspace-relative path, needs `workspace:write`, and runs from the worker only.
- A custom editor never learns which file it shows. The frame gets the content (`EditorDocument`: version, readOnly, content), with no path, name or workspace id, and the worker gets no event when one opens.
- A bytes editor receives the whole file as an `ArrayBuffer`, capped at 64 MiB, and saves by sending the whole file back.

So a `.db` custom editor cannot hand the file's path to the worker, and the only way to give a tab state is through its content.

## Decision

- A **query document** is a `.sql` file opened by DB Studio's custom editor at default priority. Its first line, `-- db-studio: connection=<ref>`, names the connection. A `.sql` file without it opens with a "Choose connection" control that writes the line.
- Opening a table creates a query document with `SELECT * FROM <table> LIMIT 100` in `.db-studio/` in the workspace, and the worker opens it with `editor.open`. There is no separate table view.
- `.db-studio/` contains its own `.gitignore` with `*`. DB Studio never edits the repo's `.gitignore`. Moving a document out of the folder is how you save a query.
- SQLite files open from the panel or the palette by path, as a connection like any other. There is no `.db` custom editor.

## Alternatives considered

- **Grid and editor inside the panel.** No files needed, but the panel is too narrow for a grid and an editor.
- **A `.db` bytes editor with SQLite in WASM in the frame.** It would be a second engine outside the driver interface, in memory, capped at 64 MiB, and saving rewrites the whole file over the one the worker may have open.
- **A `.dbtable` JSON file per table view.** Dropped once opening a table became a prefilled query.

## Consequences

- Tabs exist only inside a workspace. With no workspace open, opening a table fails.
- DB Studio becomes the default editor for every `.sql` file, including migrations. Other plugins that claim `.sql` may compete.
- A document's connection travels with the file, so moving or sharing it keeps the reference. A worktree connection reference also names its workspace, since the frame cannot find out.
- Reopen if Orca adds non-file editor tabs or gives custom editors their file's path.
