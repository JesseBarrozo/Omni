---
type: skill
name: Commit Message
description: Write one explicit conventional commit for a validated Omni phase
skillSlug: commit-message
phases: [E, C]
generated: 2026-10-28
status: filled
scaffoldVersion: "2.0.0"
---

## Workflow

1. Check `git status` and inspect the staged diff.
2. Confirm the phase acceptance criteria and relevant checks passed.
3. Stage only files belonging to that phase; exclude secrets and unrelated changes.
4. Use the requested conventional form, for example `docs(audit): add initial repository audit` or `feat(harness): integrate first real harness`.
5. After commit, report hash, files, checks, failed checks and limits. Never commit an unvalidated feature or combine phases.
