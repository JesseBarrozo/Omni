---
type: skill
name: Refactoring
description: Refactor Omni code with tests protecting the behavior already proven
skillSlug: refactoring
phases: [E]
generated: 2026-10-28
status: filled
scaffoldVersion: "2.0.0"
---

## Workflow

1. Identify callers and behavior covered by current tests.
2. Keep the change within the authorized phase.
3. Change one structural concern at a time; do not add placeholder adapters or unused layers.
4. Run `npm test` and `npm run check` after the change.
5. Record behavior that remains unimplemented; do not improve status claims through naming alone.
