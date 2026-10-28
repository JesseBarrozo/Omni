# Omni Documentation Index

Start with the audited state, then consult the product requirements and the relevant engineering guide.

## Core Guides
- [Project Overview](./project-overview.md)
- [Development Workflow](./development-workflow.md)
- [Testing Strategy](./testing-strategy.md)
- [Tooling & Productivity Guide](./tooling.md)

## Repository Snapshot
- `assets/` — product logo.
- `bin/` — Node CLI entry.
- `src/` — JavaScript ESM core and adapter contract.
- `test/` — Node built-in unit tests; no real integration suite yet.
- `Omni_PRD.md` — target requirements.
- `AUDIT.md` — verified starting point and limitations.

## Document Map
| Guide | File | Primary Inputs |
| --- | --- | --- |
| Project Overview | `project-overview.md` | `README.md`, `AUDIT.md`, `Omni_PRD.md` |
| Development Workflow | `development-workflow.md` | `AGENTS.md`, `package.json`, phase instructions |
| Testing Strategy | `testing-strategy.md` | `test/`, `package.json`, `AUDIT.md` |
| Tooling | `tooling.md` | `package.json`, `bin/omni.mjs` |
