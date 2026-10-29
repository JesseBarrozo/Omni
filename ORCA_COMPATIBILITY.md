# Orca compatibility status

## Verified interface

Discovery was performed with the installed Orca CLI `1.4.242` on 2026-10-29. Its version-matched `orca-cli` guide and machine-readable `orca agent-context --json` schema describe:

- `orca agent launch --agent <id>` as launching a **known TUI agent**;
- `orca worktree create --agent <id>` as creating a worktree and launching one of those known agents;
- `orca terminal create --worktree <selector> --command <text>` as a separate way to start a normal command in a terminal belonging to an existing Orca workspace.

`orca agent launch --agent omni ...` was exercised against a ready Orca runtime. It returned `invalid_argument: Unknown TUI agent "omni"` before launching anything. The machine-readable schema exposes no command for registering an external agent or custom TUI executable. The Omni checkout itself is not an Orca-managed worktree (`worktree current` reports no managed worktree contains this directory).

## Supported use today

Omni remains an independent CLI. In a terminal opened inside an existing Orca workspace, install/link Omni by the user's normal package workflow, create its project record once, then use a real Omni command:

```sh
omni project create --name "My project" --path "$PWD"
omni run --project "$PWD" --auto "Inspect this project and summarize its state"
```

The `omni run` command makes a single model request; for an interactive Omni conversation, use `omni chat --project "$PWD" --model MODEL_ID`. Omni stores its own history under `~/.omni` (or `OMNI_DATA_DIR`). This is ordinary terminal interoperability. Orca does not own the Omni session, display it as a native Agent Session, or provide Orca-managed session resume/permission UI for Omni.

For native Orca Agent Sessions, use an agent ID Orca itself recognizes. Omni cannot currently be selected as that agent through the installed Orca CLI.

## Why native agent integration is not implemented

There is no verified public custom-agent registration or process protocol in the installed Orca CLI guide, help, or command schema. Guessing an undocumented `agent` identifier or inventing a JSON protocol would not create a real integration. Registering Omni by changing Orca source/settings is outside this repository's permitted scope. A native adapter therefore requires Orca to expose a supported external-agent contract or add Omni to its known TUI agent catalog.

## Checks and limits

- `orca status --json`: runtime ready; CLI and runtime versions matched.
- `orca agent-context --json`: inspected the registered command schema.
- `orca agent launch --help` and `orca terminal create --help`: verified native-agent versus ordinary-terminal entry points.
- `orca agent launch --agent omni ...`: rejected as unknown agent; no launch occurred.
- `orca worktree current --json`: this Omni checkout is not currently registered as an Orca-managed workspace.
- Omni's real `omni run --auto` path was independently exercised against an authenticated real model, but this does not constitute an Orca Agent Session integration test.

No Orca source, agent registration, workspace settings, or user data were modified. The Orca app was opened to satisfy the installed CLI's runtime requirement for status/schema checks.
