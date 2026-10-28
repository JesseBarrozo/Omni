---
type: skill
name: Bug Investigation
description: Investigate reproducible Omni defects using source and runtime evidence
skillSlug: bug-investigation
phases: [E, V]
generated: 2026-10-28
status: filled
scaffoldVersion: "2.0.0"
---

## Workflow

1. Record the exact command, input, expected behavior, and observed output.
2. Check `git status` and preserve unrelated changes.
3. Trace the CLI entry in `bin/omni.mjs` through the affected core module.
4. Reproduce with a focused test or isolated `OMNI_DATA_DIR`.
5. Separate mock-only evidence from real provider/harness execution.
6. Add a regression test, fix the cause, then run `npm test` and `npm run check`.
7. Report any unavailable command or external prerequisite plainly.
