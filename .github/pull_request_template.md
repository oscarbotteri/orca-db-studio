<!--
PR title (it becomes the squash commit subject):
  <type>(<scope>): <imperative summary> (#<issue>)
  e.g. feat(drivers): add the SQLite driver (#13)
Rules and allowed types/scopes: .claude/skills/commit-pr/SKILL.md

Fill every section. Delete an optional section only when it is empty.
Do not delete checklist items: mark them [x] or write "N/A" next to them.
-->

Closes #<issue>

<!-- Use "Refs #<issue>" for partial work, or "No issue: <reason>" for a chore without one.
     Then list the PRD requirement IDs this PR implements or changes (C1, G1, A2, ...)
     and the ADRs it follows or adds; delete what does not apply. -->

PRD: <IDs from docs/PRD.md> · ADR: [nnnn](docs/adr/nnnn-name.md)

## Summary

<!-- One to three sentences: what this PR does and why. -->

## What changed

<!-- One bullet per meaningful change. Lead with the thing (`src/worker/query-engine.ts`, a command, a setting), then what it does. -->

-

## Acceptance criteria

<!-- Copied from the issue, or from the PRD requirement rows when there is no issue.
     [x] when met, with the test or evidence that shows it.
     When not met, leave [ ] and say why and where it will be done. -->

- [ ]

## Verification

<!-- Only what you actually ran, with its result. Say what was NOT verified. -->

- [ ] `npx tsc --noEmit`, `orca plugin validate .`
- [ ] `npm run lint`, `npm run format:check`
- [ ] `npm run test:drivers` against every affected engine (<n> files, <n> tests); N/A if no driver change
- [ ] `orca plugin test .` and `orca plugin check .` for UI changes; N/A otherwise

## Notes for review (optional)

<!-- Decisions and trade-offs, deliberate differences from the PRD or architecture, known limits,
     merge order with other PRs, expected conflicts, manual steps for the repo owner. -->

## Out of scope (optional)

<!-- What is deliberately not done here, and the issue that tracks it. -->

## Screenshots (optional)

<!-- UI changes: `orca plugin shot <key>` output, or a short video. -->

## Checklist

- [ ] Title and every commit follow Conventional Commits, with no AI references
- [ ] Tests added or updated; driver tests run against real databases, not mocks
- [ ] Docs updated (PRD, system architecture, ADR) when behavior or a decision changed
- [ ] Public contracts (`protocol.ts`, driver interface, manifest settings) are unchanged, or the change is called out in the notes
- [ ] Every query still goes through the worker; UI code never touches a driver
- [ ] No secrets, dotenv files, credentials or personal data; passwords only in `secrets:own`
- [ ] No native modules; anything the worker needs at runtime is bundled into `vendor/`
- [ ] Nothing from the PRD Non-goals
