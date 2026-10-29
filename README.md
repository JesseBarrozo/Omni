# Omni

Omni is an independent Universal AI Harness under phased development. Its CLI supports persistent SQLite conversations, OpenAI ChatGPT OAuth and API-key chat, Codex OAuth chat through the official Codex app-server, and Claude Code Agent SDK sessions. OpenAI OAuth uses OpenAI’s documented Sign in with ChatGPT flow for open-source local apps; see [`VERIFICATION.md`](VERIFICATION.md) for the live validation state. See [`AUDIT.md`](AUDIT.md) for the verified repository baseline and [`Omni_PRD.md`](Omni_PRD.md) for the product requirements.

## Requirements

- Node.js 20 or newer
- npm
- the Codex CLI, logged in with `codex login`, for Codex OAuth chat; Omni delegates authentication to Codex and never reads its token
- Claude Code CLI, logged in with `claude auth login --claudeai`, for Claude Agent SDK chat and harness; Omni delegates authentication and never reads its token
- for ChatGPT plan usage, run `omni auth login openai`; OAuth credentials are stored in the operating system’s secure credential store, never SQLite
- optionally, an OpenAI API key in `OPENAI_API_KEY` for direct API billing; Omni never stores it

Install dependencies with `npm install`. `npm run build`, `npm run lint` and `npm run format:check` are available for the current chat slice.

## Existing commands

```sh
npm test
npm run check
node ./bin/omni.mjs help
node ./bin/omni.mjs init
node ./bin/omni.mjs status --json
node ./bin/omni.mjs providers refresh --json
node ./bin/omni.mjs providers list --json
node ./bin/omni.mjs providers disable --provider openai
node ./bin/omni.mjs harnesses refresh --json
node ./bin/omni.mjs harnesses disable --harness codex
node ./bin/omni.mjs tools list --conversation CONVERSATION_ID --json
node ./bin/omni.mjs permissions list --project ./my-project --json
node ./bin/omni.mjs conversation search --query "permission denied" --project ./my-project --json
node ./bin/omni.mjs models disable --provider codex --model MODEL_ID --auto-only
node ./bin/omni.mjs auth status --json
node ./bin/omni.mjs auth login openai
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
node ./bin/omni.mjs run --project ./my-project --auto --json "Inspect the project and propose changes"
node ./bin/omni.mjs run --harness claude --conversation CONVERSATION_ID "Continue the task"
node ./bin/omni.mjs swap --conversation CONVERSATION_ID --harness codex
node ./bin/omni.mjs swap --conversation CONVERSATION_ID --harness claude
node ./bin/omni.mjs chat --project ./my-project --model MODEL_ID
node ./bin/omni.mjs resume CONVERSATION_ID [--model MODEL_ID]
```

`omni run ... --json` writes versioned JSON Lines to stdout (`version: 1`): `routing.decision`/`routing.fallback`, `run.started`, streamed `message.delta`, sanitized tool and one-time permission events, then `run.completed`, `run.interrupted`, or `run.failed`. Prompts and raw tool inputs are not included. Interactive permission questions go to stderr; without a TTY, permissions remain denied. A successful run exits 0, failures 1, and an interrupted run 130. This is Omni’s process interface for ordinary terminals, including an Orca terminal; it is not Orca’s native Agent Session protocol.

`providers refresh` persists non-secret provider status and the latest models discovered through authenticated Codex/Claude CLIs, OpenAI ChatGPT OAuth, or `OPENAI_API_KEY`; `providers list` shows that local registry. For OpenAI, a saved ChatGPT OAuth profile takes precedence over `OPENAI_API_KEY`. `models list --provider ID` refreshes that provider’s real catalog, and `models enable|disable --provider ID --model ID` controls manual availability; add `--auto-only` to change only Auto eligibility. `providers enable|disable --provider ID` controls the provider globally. Preferences survive restarts. Omni's `SecretStore` wraps the operating system credential store; OAuth access and refresh tokens never enter SQLite, logs, or exports, and the validated ID token is discarded. Omni currently supports one OpenAI OAuth profile; signing in again reuses its issued client ID. Linux requires Secret Service (for example, GNOME Keyring or KWallet); Omni fails closed when a secure store is unavailable. Codex, Claude Code and Antigravity continue to own their own CLI credentials.

`harnesses refresh` safely initializes the installed Codex app-server and Claude Agent SDK adapters without creating a session or executing a task, then persists their declared capabilities and availability. Use `harnesses list` to inspect them and `harnesses enable|disable --harness ID` to control use. Disabled harnesses are excluded by Auto and refused by manual `run` and `swap`. A reported capability describes Omni’s adapter contract; it does not promise transfer of private harness state.

`tools list` and `permissions list` read the canonical event history for one conversation or project. They show tool names and permission outcomes while omitting raw tool inputs and parameters. These commands are read-only and do not grant, replay, or revoke permissions.

`conversation search --query TEXT` finds a literal substring in conversation titles or persisted messages; add `--project ID_OR_PATH` to scope results. JSON output includes the matching title/message excerpt and the conversation identifiers.

The CLI stores projects, conversations, messages, streamed partial responses and provider session IDs in `~/.omni/omni.sqlite` (or `OMNI_DATA_DIR`). Versioned SQLite migrations initialize the schema. An append-only event log records message creation, streamed deltas, model changes and session outcomes; credential-shaped strings are redacted before message and event persistence. `conversation export ID` exports the transcript with its event history. For OpenAI OAuth, `models list --provider openai` queries the signed-in account’s displayable model catalog and Responses requests stream with `store:false`; API-key mode continues to use the API account catalog. Codex and Claude model discovery use their authenticated official runtimes. Choose a listed OpenAI model ID, `codex`, or `claude:<model-id>` for provider chat. Codex harness tasks start in the app-server's `read-only` sandbox; command, file-change and permission-profile escalations require a one-time approval in an interactive terminal and are denied without a TTY. Codex checkpoints retain the app-server thread reference, and `--conversation` resumes that thread after an Omni restart. The Claude harness exposes Read, Grep, Glob, Bash, Edit and Write through the SDK permission callback; Omni asks for each tool approval in an interactive terminal and denies requests when no terminal is available. `chat` is interactive (`/quit` exits), `run` submits one prompt, and `resume` continues a stored chat conversation after restarting Omni using its saved model by default; `--model` changes that choice. Use `--conversation` with `omni run --harness claude|codex` to continue a harness task after restart. Set `OMNI_LIVE_TESTS=1` and `OMNI_TEST_MODEL` for the live OpenAI API-key test, `OMNI_LIVE_OPENAI_OAUTH_TESTS=1` for OpenAI ChatGPT OAuth model listing and stream testing, `OMNI_LIVE_KEYRING_TESTS=1` for a transient system-keyring check, `OMNI_LIVE_CODEX_TESTS=1` for the Codex OAuth provider stream-and-resume test, `OMNI_LIVE_CODEX_HARNESS_TESTS=1` for the real Codex harness permission/write/resume test, or `OMNI_LIVE_CLAUDE_TESTS=1` for Claude OAuth streaming/resume and the approved temporary-file write integration test. See [`VERIFICATION.md`](VERIFICATION.md) for the verification checklist and rerun commands.

Import an export into a project with `node ./bin/omni.mjs conversation import --project PROJECT_ID_OR_PATH ./conversation.json`. Imported session events are historical records; Omni gives the imported conversation and its messages fresh IDs, preserves the transcript, and never replays an action.

Use `OMNI_DATA_DIR` to point local data to a different directory. SQLite data uses restrictive local file permissions but is not encrypted. API keys remain in the process environment and are not copied into the database or logs.

## Project status

The OpenAI ChatGPT OAuth provider has been exercised through Omni: the real account catalog returned eight models, `gpt-6.1-sol` answered a prompt, and a new CLI process resumed the stored conversation. OAuth credentials remain in the system credential store. The separate OpenAI API-key billing path, interactive rejection/interrupt paths, Antigravity Omni integration and native Orca Agent Session integration remain unverified. The real Codex OAuth chat and harness paths have been exercised through the installed Codex app-server. Claude OAuth streaming/resume and an approved tool write were exercised against the official Agent SDK. An opt-in integration test executes Codex → Claude → Codex on a temporary Git project, verifying permission, checkpoint summaries, file state and no duplicate write. Deterministic `--auto` queries authenticated provider accounts and their real model catalogs, persists evaluated candidates, exclusions, ranking, fallback and outcomes, and uses results across conversations; identical model IDs from different providers remain separate routing candidates. Use `OMNI_AUTO_MODELS=codex:MODEL,claude:MODEL` to allowlist exact models, `OMNI_DISABLED_PROVIDERS=claude` to disable a provider, `OMNI_AUTO_PREFERRED_PROVIDERS=codex,claude` to set deterministic preference, `OMNI_AUTO_PROFILE=balance|efficiency|intelligence`, `OMNI_AUTO_MAX_INPUT_PER_MILLION=N` to enforce a ceiling only where actual model pricing is known, and `OMNI_AUTO_PRIVACY=strict` to require explicit privacy approval. The current real harnesses do not provide verified price metadata or local/private approval metadata; cost ceilings therefore exclude candidates with unknown prices, and strict privacy excludes both cloud harnesses. Auto tries the next ranked candidate only when harness initialization fails before the user prompt is recorded or a turn starts; once execution begins it never retries, so non-idempotent tools are not replayed. `OMNI_CODEX_HARNESS_EXECUTABLE` can point to a Codex executable for the harness process; it does not change the Codex executable used for OAuth/catalog discovery. Run the real route test with `OMNI_LIVE_AUTO_TESTS=1 node --test test/auto-router.test.mjs`; run the real preflight fallback test with both Codex and Claude OAuth accounts connected using `OMNI_LIVE_AUTO_FALLBACK_TESTS=1 node --test test/auto-router.test.mjs`. Omni can run as a normal command in an existing Orca terminal, but the installed Orca CLI rejects `--agent omni` as an unknown TUI agent and exposes no custom-agent registration contract; see [`ORCA_COMPATIBILITY.md`](ORCA_COMPATIBILITY.md). The official Antigravity CLI itself answered a real model request using its local CLI authentication, but the active OAuth account was not confirmed separately; headless mode does not expose Omni's per-tool approval callback and permits workspace writes by default; details are in [`VERIFICATION.md`](VERIFICATION.md). The mock harness remains test-only. The installed Claude Agent SDK declares a proprietary license; review its terms before redistributing Omni with this dependency. The `@napi-rs/keyring` wrapper is MIT-licensed; its bundled Linux platform binary also embeds third-party components with additional license notices, which must be reviewed before redistribution.

For Auto chat requests classified as not needing tools, Omni prefers Claude's chat SDK with no tools or Codex's app-server in a read-only sandbox; candidates with full harness tools are ranked after those lower-capability adapters. Codex chat still has read-only project access, and the app-server declines permission escalations. Auto tasks classified as requiring tools continue to use the permission-gated Claude or Codex harness.

Antigravity is an experimental chat provider through Google's official `agy` CLI, not an Omni harness: run `omni auth login antigravity`, `omni providers refresh --provider antigravity`, then `omni chat --project ./project --model antigravity:MODEL`. The project path is used only for Omni's conversation record; Antigravity runs in a private `~/.omni/antigravity-workspaces/<conversation-id>` directory with `--sandbox` and `--mode plan`. Omni refuses to launch when global Antigravity permissions contain `allow` rules or a non-review `toolPermission`. Headless tools requiring approval are refused by Antigravity; scratch changes are never copied to the project. The account and model response path has not been revalidated in this Omni integration because the live API test was intentionally deferred. Antigravity remains excluded from `omni run`, Auto, Harness Registry and Harness Swap. See [`VERIFICATION.md`](VERIFICATION.md).
