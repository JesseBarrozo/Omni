---
type: skill
name: PR Review
description: Review an Omni change set against its phase acceptance criteria and evidence
skillSlug: pr-review
phases: [R, V]
generated: 2026-10-28
status: filled
scaffoldVersion: "2.0.0"
---

## Workflow

1. Read the change request and declared phase.
2. Inspect branch status, commits, and the complete diff.
3. Check runtime wiring, error handling, secrets, permission gates and retry behavior.
4. Run the relevant automated checks and real acceptance journey.
5. Reject claims supported only by mocks when the requirement calls for a real integration.
6. Summarize blockers and evidence before any phase commit.
