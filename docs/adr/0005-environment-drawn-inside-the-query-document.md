# 0005. The environment is drawn inside the query document

Status: accepted

## Context

The PRD asks for an environment label (`local`, `dev`, `staging`, `prod`) shown as a colored tab (C5), so a person can tell at a glance that a query is about to run against prod.

Orca's plugin API offers no way to color, rename or decorate an editor tab, and a custom editor does not know its file's path (ADR 0003). The only thing DB Studio controls is the content of its own editor frame. Orca's theme also has no variable for success, warning or accent tones; it offers neutral text and a destructive color.

## Decision

- The label belongs to the saved connection: an environment and a tone, both stored explicitly, so changing a default later never recolors what the person chose. Worktree connections have none.
- The "colored tab" is drawn inside the query document: a 4 px band across its top and a `[env] Name` badge in its toolbar, both in the connection's tone. A connection without an environment shows its name in a neutral tone and no band.
- The label is informational. There is no confirmation, no read-only mode, and Run behaves the same for every environment; guard rails are a non-goal of the PRD.
- Neutral and danger use Orca's `--orca-muted-foreground` and `--orca-destructive`. Accent, success and warning use a palette per `light` / `dark` class on `<html>`, each at 4.5:1 or better on the backgrounds themes use, as the SQL syntax palette does.
- An open document follows the registry: it lists connections again on the worker's `connections.changed` event and on a write to the registry's storage key, and looks once more when its first line names a connection it does not know. Only the latest answer is applied.

## Alternatives considered

- **Decorate Orca's own tab.** Not possible with the current plugin API.
- **A color picker with free-form hex.** More freedom, but colors would no longer follow the light and dark themes.
- **Derive the color from the environment alone.** Loses the person's choice and makes a later change to the defaults recolor existing connections.

## Consequences

- The label is visible only once the document is open and focused; Orca's tab strip and the panel tree cannot carry a color. The panel marks the environment in the row's text instead.
- Neither the event nor the storage change is confirmed to reach editor frames. If neither does, an edited label reaches an open document on reopen.
- Reopen if Orca lets plugins decorate editor tabs.
