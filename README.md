# Omni

Omni is being developed as an independent Universal AI Harness. Phase 2 is in progress: the CLI now has SQLite-backed projects and conversations and an OpenAI Responses streaming path. A live provider call is still required before this vertical slice can be called validated. See [`AUDIT.md`](AUDIT.md) for the verified starting state and [`Omni_PRD.md`](Omni_PRD.md) for the target product.

## Requirements

- Node.js 20 or newer
- npm
- an OpenAI API key in `OPENAI_API_KEY` for live chat; Omni never stores it

Install dependencies with `npm install`. `npm run build`, `npm run lint` and `npm run format:check` are available for the current chat slice.

## Existing commands

```sh
npm test
npm run check
node ./bin/omni.mjs help
node ./bin/omni.mjs init
node ./bin/omni.mjs status --json
node ./bin/omni.mjs project create --name "My project" --path ./my-project
node ./bin/omni.mjs models list
node ./bin/omni.mjs chat --project ./my-project --model MODEL_ID
node ./bin/omni.mjs resume CONVERSATION_ID [--model MODEL_ID]
```

The CLI stores projects, conversations, messages and interrupted partial responses in `~/.omni/omni.sqlite` (or `OMNI_DATA_DIR`). Versioned SQLite migrations initialize the schema. An append-only event log records message creation, streamed deltas, model changes and session outcomes; credential-shaped strings are redacted before message and event persistence. `conversation export ID` exports the transcript with its event history. It queries the authenticated OpenAI account for available model IDs; choose a listed model explicitly. `chat` is interactive (`/quit` exits), `run` submits one prompt, and `resume` continues a stored conversation after restarting the process using its saved model by default; `--model` changes that choice. Set `OMNI_LIVE_TESTS=1` and `OMNI_TEST_MODEL` to a Responses compatible model ID listed for that account to enable the real provider integration test.

Import an export into a project with `node ./bin/omni.mjs conversation import --project PROJECT_ID_OR_PATH ./conversation.json`. Imported session events are historical records; Omni gives the imported conversation and its messages fresh IDs, preserves the transcript, and never replays an action.

Use `OMNI_DATA_DIR` to point local data to a different directory. SQLite data uses restrictive local file permissions but is not encrypted. API keys remain in the process environment and are not copied into the database or logs.

## Project status

The OpenAI SDK integration and local persistence are implemented, but a real response has not yet been verified because no API credential is configured in this environment. Harness execution, tool permissions, checkpoints, swap, orchestration and Orca integration remain unimplemented. The existing mock harness remains test-only.
