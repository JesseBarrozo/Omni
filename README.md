# Omni

Omni is an independent Universal AI Harness under phased development. Its CLI now supports SQLite-backed conversations with OpenAI API-key chat and Codex OAuth chat through the official Codex app-server. See [`AUDIT.md`](AUDIT.md) for the verified repository baseline and [`Omni_PRD.md`](Omni_PRD.md) for the product requirements.

## Requirements

- Node.js 20 or newer
- npm
- the Codex CLI, logged in with `codex login`, for Codex OAuth chat; Omni delegates authentication to Codex and never reads its token
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
node ./bin/omni.mjs project create --name "My project" --path ./my-project
node ./bin/omni.mjs models list
node ./bin/omni.mjs models list --provider codex
node ./bin/omni.mjs run --project ./my-project --model codex "Explain this project"
node ./bin/omni.mjs chat --project ./my-project --model MODEL_ID
node ./bin/omni.mjs resume CONVERSATION_ID [--model MODEL_ID]
```

The CLI stores projects, conversations, messages, streamed partial responses and Codex thread IDs in `~/.omni/omni.sqlite` (or `OMNI_DATA_DIR`). Versioned SQLite migrations initialize the schema. An append-only event log records message creation, streamed deltas, model changes and session outcomes; credential-shaped strings are redacted before message and event persistence. `conversation export ID` exports the transcript with its event history. `models list` queries the OpenAI API-key account, while `models list --provider codex` queries the logged-in Codex app-server. Choose `codex` as the model selector to send chat through Codex OAuth. Codex runs in a read-only sandbox; write-capable agent actions are not enabled in this integration. `chat` is interactive (`/quit` exits), `run` submits one prompt, and `resume` continues a stored conversation after restarting Omni using its saved model by default; `--model` changes that choice. Set `OMNI_LIVE_TESTS=1` and `OMNI_TEST_MODEL` for the live OpenAI API-key test, or `OMNI_LIVE_CODEX_TESTS=1` to run the real Codex OAuth stream-and-resume test.

Import an export into a project with `node ./bin/omni.mjs conversation import --project PROJECT_ID_OR_PATH ./conversation.json`. Imported session events are historical records; Omni gives the imported conversation and its messages fresh IDs, preserves the transcript, and never replays an action.

Use `OMNI_DATA_DIR` to point local data to a different directory. SQLite data uses restrictive local file permissions but is not encrypted. API keys remain in the process environment and are not copied into the database or logs.

## Project status

The real Codex OAuth chat path has been exercised through the installed Codex app-server, including streamed deltas and session resumption after reopening Omni's database. OpenAI's direct API-key response remains unverified in this environment. Claude Code and Antigravity connections, write-capable tool permissions, general checkpoints, harness swap, orchestration and Orca integration remain unimplemented. The mock harness remains test-only.
