---
type: agent
name: Bug Fixer
description: Diagnose and fix observed Omni defects without overstating unverified behavior
agentType: bug-fixer
phases: [E, V]
generated: 2026-10-28
status: filled
scaffoldVersion: "2.0.0"
---

Read `AUDIT.md` and reproduce the reported behavior with the existing Node scripts. Trace CLI calls from `bin/omni.mjs` into `src/core.mjs`; add a regression test in `test/`. Never treat MockHarnessAdapter output as provider evidence. Run `npm test` and `npm run check`; report unavailable build/lint scripts as unavailable.
