# Omni

Omni is an independent Universal AI Harness under phased development. Its CLI supports persistent SQLite conversations, OpenAI API-key chat, Codex OAuth chat through the official Codex app-server, and Claude Code Agent SDK sessions. Claude OAuth streaming/session resumption and an approved temporary-file write have been exercised against a real logged-in account. See [`AUDIT.md`](AUDIT.md) for the verified repository baseline and [`Omni_PRD.md`](Omni_PRD.md) for the product requirements.

## Requirements

- Node.js 20 or newer
- npm
- the Codex CLI, logged in with `codex login`, for Codex OAuth chat; Omni delegates authentication to Codex and never reads its token
- Claude Code CLI, logged in with `claude auth login --claudeai`, for Claude Agent SDK chat and harness; Omni delegates authentication and never reads its token
- optionally, an OpenAI API key in `OPENAI_API_KEY` for direct OpenAI API chat; Omni never stores it

Install dependencies with `npm install`. `npm run build`, `npm run lint` and `npm run format:check` are available for the current chat slice.

## Existing commands

```sh
npm test
npm run check
node ./bin/omni.mjs help
node ./bin/omni.mjs init
node ./bin/omni.mjs status --json
node ./bin/omni.mjs auth status --json
node ./bin/omni.mjs auth login codex
node ./bin/omni.mjs auth login claude
node ./bin/omni.mjs project create --name "My project" --path ./my-project
node ./bin/omni.mjs models list
node ./bin/omni.mjs models list --provider codex
node ./bin/omni.mjs models list --provider claude
node ./bin/omni.mjs run --project ./my-project --model codex "Explain this project"
node ./bin/omni.mjs run --project ./my-project --model claude:sonnet "Explain this project"
node ./bin/omni.mjs run --project ./my-project --harness claude "Inspect the project and propose changes"
node ./bin/omni.mjs run --project ./my-project --harness codex --model codex "Inspect the project and propose changes"
node ./bin/omni.mjs run --project ./my-project --auto "Inspect the project and propose changes"
node ./bin/omni.mjs run --harness claude --conversation CONVERSATION_ID "Continue the task"
node ./bin/omni.mjs swap --conversation CONVERSATION_ID --harness codex
node ./bin/omni.mjs swap --conversation CONVERSATION_ID --harness claude
node ./bin/omni.mjs chat --project ./my-project --model MODEL_ID
node ./bin/omni.mjs resume CONVERSATION_ID [--model MODEL_ID]
```

The CLI stores projects, conversations, messages, streamed partial responses and provider session IDs in `~/.omni/omni.sqlite` (or `OMNI_DATA_DIR`). Versioned SQLite migrations initialize the schema. An append-only event log records message creation, streamed deltas, model changes and session outcomes; credential-shaped strings are redacted before message and event persistence. `conversation export ID` exports the transcript with its event history. `models list` queries the OpenAI API-key account, while `models list --provider codex` queries the logged-in Codex app-server and `models list --provider claude` asks the logged-in Claude SDK session for its supported model identifiers. Choose `codex` or `claude:<model-id>` for provider chat. Codex harness tasks start in the app-server's `read-only` sandbox; command, file-change and permission-profile escalations require a one-time approval in an interactive terminal and are denied without a TTY. Codex checkpoints retain the app-server thread reference, and `--conversation` resumes that thread after an Omni restart. The Claude harness exposes Read, Grep, Glob, Bash, Edit and Write through the SDK permission callback; Omni asks for each tool approval in an interactive terminal and denies requests when no terminal is available. `chat` is interactive (`/quit` exits), `run` submits one prompt, and `resume` continues a stored chat conversation after restarting Omni using its saved model by default; `--model` changes that choice. Use `--conversation` with `omni run --harness claude|codex` to continue a harness task after restart. Set `OMNI_LIVE_TESTS=1` and `OMNI_TEST_MODEL` for the live OpenAI API-key test, `OMNI_LIVE_CODEX_TESTS=1` for the Codex OAuth provider stream-and-resume test, `OMNI_LIVE_CODEX_HARNESS_TESTS=1` for the real Codex harness permission/write/resume test, or `OMNI_LIVE_CLAUDE_TESTS=1` for Claude OAuth streaming/resume and the approved temporary-file write integration test. See [`VERIFICATION.md`](VERIFICATION.md) for the verification checklist and rerun commands.

Import an export into a project with `node ./bin/omni.mjs conversation import --project PROJECT_ID_OR_PATH ./conversation.json`. Imported session events are historical records; Omni gives the imported conversation and its messages fresh IDs, preserves the transcript, and never replays an action.

Use `OMNI_DATA_DIR` to point local data to a different directory. SQLite data uses restrictive local file permissions but is not encrypted. API keys remain in the process environment and are not copied into the database or logs.

## Project status

The real Codex OAuth chat and harness paths have been exercised through the installed Codex app-server. Claude OAuth streaming/resume and an approved tool write were exercised against the official Agent SDK. An opt-in integration test executes Codex → Claude → Codex on a temporary Git project, verifying permission, checkpoint summaries, file state and no duplicate write. Deterministic `--auto` queries authenticated Codex/Claude accounts and their real model catalogs, persists evaluated candidates, exclusions, ranking, fallback and outcomes, and uses results across conversations. Use `OMNI_AUTO_MODELS=codex:MODEL,claude:MODEL` to allowlist exact models, `OMNI_DISABLED_PROVIDERS=claude` to disable a provider, `OMNI_AUTO_PREFERRED_PROVIDERS=codex,claude` to set deterministic preference, `OMNI_AUTO_PROFILE=balance|efficiency|intelligence`, `OMNI_AUTO_MAX_INPUT_PER_MILLION=N` to enforce a ceiling only where actual model pricing is known, and `OMNI_AUTO_PRIVACY=strict` to require explicit privacy approval. The current real harnesses do not provide verified price metadata or local/private approval metadata; cost ceilings therefore exclude candidates with unknown prices, and strict privacy excludes both cloud harnesses. A selected run is never automatically retried after execution begins; the recorded fallback is informational so non-idempotent tools are not replayed. Run the real route test with `OMNI_LIVE_AUTO_TESTS=1 node --test test/auto-router.test.mjs`. Omni can run as a normal command in an existing Orca terminal, but the installed Orca CLI rejects `--agent omni` as an unknown TUI agent and exposes no custom-agent registration contract; see [`ORCA_COMPATIBILITY.md`](ORCA_COMPATIBILITY.md). OpenAI direct API-key live chat, interactive rejection/interrupt paths, Antigravity Omni integration and native Orca Agent Session integration remain unverified. The official Antigravity CLI itself was tested with a real OAuth-backed model request, but headless mode does not expose Omni's per-tool approval callback and permits workspace writes by default; details are in [`VERIFICATION.md`](VERIFICATION.md). The mock harness remains test-only. The installed Claude Agent SDK declares a proprietary license; review its terms before redistributing Omni with this dependency.
