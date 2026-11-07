# DB Studio for Orca — Agent Instructions

## Role & Responsibilities

Your role is to analyze user requirements, delegate tasks to appropriate sub-agents, and ensure cohesive delivery of features that meet the PRD and the system architecture.

## Project Overview

DB Studio is an Orca plugin for browsing and querying PostgreSQL, MySQL/MariaDB and SQLite without leaving Orca. The current target is the MVP in `docs/PRD.md`. Build only requirements marked `MVP` unless the task says otherwise.

**Every database call goes through the worker** — UI code never touches a driver directly.

## Conventions worth knowing

- `src/drivers/` is the only place that knows which engine is behind a connection. Code outside it must not branch on engine type — add a method to the driver interface instead.
- Every tab is a `.sql` query document whose first line names its connection. There is no table view and no `.db` custom editor.
- UI code lives in `src/editor/` (query document editor: SQL editor, grid) and `src/panel/` (connections, explorer). Promote to a shared folder only when both actually need it.

## Global conventions

- Prefer named function declarations over arrow function assignments
- Prefer `interface` for object shapes and component props
- Use `type` for unions, intersections, and utility types
- Never use `any`; use `unknown` when the type cannot be determined
- **Biome** is the single tool for formatting and linting — do not use ESLint or Prettier
- Follow project docs in `docs/` and existing local patterns.
- Prefer YAGNI, KISS, and DRY in that order.
- Implement real behavior. Do not add fake data, mocks, or temporary shortcuts just to satisfy a check.
- Keep changes scoped to the request and the affected contracts.
- Use descriptive kebab-case file names for new files.
- Split code only when it reduces real complexity or matches existing module boundaries.

## Global Rules

- After completing any task, run `npm run verify` (typecheck, `orca plugin validate .`, lint, format check; fix formatting with `npm run format`).
- No native modules or binaries — the Orca directory rejects them. Drivers must be pure JS, bundled into `vendor/`; SQLite uses `node:sqlite`.
- An installed plugin cannot carry `node_modules`. Anything the worker needs at runtime must be bundled.
- Every plugin file must be 1 MiB or less, and `vendor/` bundles are committed with the `build/` source that produces them. No `eval` or `new Function` in anything loaded by a frame.
- Saved passwords live only in `secrets:own`. Never log them, never write them to `storage:own`, never pass them to agents through env vars or prompts. Worktree connections are read from the worktree's `.env` / `.env.local` on use and never copied anywhere.
- Never load a full result set into memory — read through the driver's cursor and stop at the row limit (or the query's own `LIMIT`) and always at the result ceiling. A worker answer is at most 1 MiB.
- Reference requirement IDs from `docs/PRD.md` (`C1`, `G1`, `A2`, ...) in PR descriptions when a change implements or changes one.
- Keep commits focused and use conventional commit format without AI references.
- Never commit secrets, dotenv files, tokens, private keys, database credentials, or personal data.

## Quality Gates

- Run the narrowest useful test first, then broaden when shared behavior or public contracts changed.
- Driver changes run `npm run test:drivers` (integration tests on real engines, Testcontainers) against all affected engines, not just one. It needs Docker and takes minutes on the first run while images pull, so run it in the background and read its log. `orca plugin test .` does not run it.
- UI changes run `orca plugin test .` and `orca plugin check .`; use `orca plugin shot <key>` to look at the result.
- Do not hide failing tests, lint, type, build, validation, or syntax errors.
- Preserve public contracts (`protocol.ts`, the driver interface, manifest settings) unless the change intentionally updates them and the user accepted that scope.

## Dev loop

```
npm ci && npm run types    # a fresh worktree needs both before tsc or tests work
orca plugin dev watch .     # load as dev plugin, reload on save
orca plugin types .         # regenerate .orca/types
orca plugin test .          # *.test.ts(x) with orca/testing
orca plugin check .         # render check scenarios
orca plugin validate .      # manifest and entries, same check as the directory
```

## Agent skills

### Issue tracker

Issues live in GitHub Issues (`oscarbotteri/orca-db-studio`), via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Documentation

The `docs/` folder contains the product scope, the architecture, and decisions that explain the **why** behind non-obvious choices. Read relevant docs before working on a related area, and add an ADR when you make a decision that would otherwise surprise a future reader.

| File                          | Topic                                                                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `docs/PRD.md`                 | What DB Studio is, who it is for, use cases, functional requirements (`C-`, `E-`, `Q-`, `G-`, `D-`, `S-`, `A-`, `X-`), non-functional requirements, open questions |
| `docs/system-architecture.md` | Components, key decisions, driver interface, security model, repo layout, testing                                                                                  |
| `docs/adr/`                   | One file per decision (`NNNN-kebab-case-title.md`)                                                                                                                 |