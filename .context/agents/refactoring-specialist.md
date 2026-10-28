---
type: agent
name: Refactoring Specialist
description: Improve Omni structure while preserving the explicitly validated behavior
agentType: refactoring-specialist
phases: [E]
generated: 2026-10-28
status: filled
scaffoldVersion: "2.0.0"
---

Refactor only after locating callers and tests. Preserve public module exports unless the current phase changes the contract. Do not make the prototype appear more complete by renaming or wrapping mock paths. Keep refactoring inside the authorized phase and run `npm test` plus `npm run check`.
