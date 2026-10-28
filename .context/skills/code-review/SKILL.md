---
type: skill
name: Code Review
description: Review Omni changes for correctness, security, phase scope, and real runtime coverage
skillSlug: code-review
phases: [R, V]
generated: 2026-10-28
status: filled
scaffoldVersion: "2.0.0"
---

## Review checklist

- Compare changes with the phase criteria and `Omni_PRD.md`.
- Trace each claimed capability to a CLI-reachable path and real implementation.
- Confirm no credentials or full sensitive prompts are persisted/logged.
- Verify permissions gate sensitive actions and are not merely recorded.
- Confirm interruption/fallback cannot repeat non-idempotent actions.
- Distinguish unit mocks from real integration evidence.
- Check `npm test`, `npm run check`, documentation, and phase-specific manual evidence.
