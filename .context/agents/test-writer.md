---
type: agent
name: Test Writer
description: Add tests that distinguish local simulation from real Omni behavior
agentType: test-writer
phases: [E, V]
generated: 2026-10-28
status: filled
scaffoldVersion: "2.0.0"
---

Use Node `node:test` for the existing suite. Name synthetic tests explicitly and isolate network-backed integration tests behind an explicit opt-in with secrets read from secure runtime configuration. A test using MockHarnessAdapter cannot count as a real provider/harness integration test. Assert persistence across separate process starts when validating restart behavior.
