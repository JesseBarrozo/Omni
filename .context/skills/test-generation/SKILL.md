---
type: skill
name: Test Generation
description: Write deterministic tests for Omni contracts and real integration acceptance journeys
skillSlug: test-generation
phases: [E, V]
generated: 2026-10-28
status: filled
scaffoldVersion: "2.0.0"
---

## Workflow

1. State the observable requirement and whether it is unit or integration evidence.
2. Use `node:test` for the current suite; keep unit cases deterministic.
3. Mark any mock/fake explicitly and never count it as a real harness/provider run.
4. For external integrations, require explicit opt-in credentials and redact output.
5. Cover failures, interruption, persistence across process restart, and non-idempotent action behavior where relevant.
6. Run `npm test` and `npm run check`; report missing build/lint tooling accurately.
