# Omni

Omni is an independent Universal AI Harness under phased development. Its CLI provides persistent SQLite conversations, OpenAI ChatGPT OAuth, API-key providers for OpenAI and OpenRouter, Codex OAuth through the official app-server, and Claude Code Agent SDK sessions. OpenAI OAuth uses OpenAI’s documented Sign in with ChatGPT flow for open-source local apps; see [`VERIFICATION.md`](VERIFICATION.md) for the live validation state. OpenRouter uses its documented OpenAI-compatible Chat Completions API with the existing official OpenAI JavaScript SDK; no authenticated live request has been made. See [`AUDIT.md`](AUDIT.md) for the verified repository baseline and [`Omni_PRD.md`](Omni_PRD.md) for the product requirements.

## Requirements

- Node.js 20 or newer
- npm
- the Codex CLI, logged in with `codex login`, for Codex OAuth chat; Omni delegates authentication to Codex and never reads its token
- Claude Code CLI, logged in with `claude auth login --claudeai`, for Claude Agent SDK chat and harness; Omni delegates authentication and never reads its token
- for ChatGPT plan usage, run `omni auth login openai`; OAuth credentials are stored in the operating system’s secure credential store, never SQLite
- optionally, an OpenAI API key in `OPENAI_API_KEY` for direct API billing, or store it with `omni auth key set openai --stdin`; the CLI reads one line without displaying it and stores it in the system credential store
- optionally, an OpenRouter API key in `OPENROUTER_API_KEY`, or store it with `omni auth key set openrouter --stdin`; OpenRouter credentials use a distinct system credential-store entry

Install dependencies with `npm install`. `npm run build`, `npm run lint`, `npm run format:check` and `npm run check` validate the current CLI and core runtime.

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
node ./bin/omni.mjs auth key set openai --stdin --profile work < /secure/path/openai-key
node ./bin/omni.mjs auth key set openrouter --stdin < /secure/path/openrouter-key
node ./bin/omni.mjs auth key list openai --json
node ./bin/omni.mjs auth key use openai --profile work
node ./bin/omni.mjs auth key remove openai --profile work
node ./bin/omni.mjs auth login codex
node ./bin/omni.mjs auth login claude
node ./bin/omni.mjs project create --name "My project" --path ./my-project
node ./bin/omni.mjs models list
node ./bin/omni.mjs models list --provider codex
node ./bin/omni.mjs models list --provider claude
node ./bin/omni.mjs models list --provider openrouter
node ./bin/omni.mjs chat --project ./my-project --model openrouter:provider/model-id
node ./bin/omni.mjs run --project ./my-project --model codex "Explain this project"
node ./bin/omni.mjs run --project ./my-project --model claude:sonnet "Explain this project"
node ./bin/omni.mjs run --project ./my-project --harness claude "Inspect the project and propose changes"
node ./bin/omni.mjs run --project ./my-project --harness codex --model codex "Inspect the project and propose changes"
node ./bin/omni.mjs run --project ./my-project --auto "Inspect the project and propose changes"
node ./bin/omni.mjs run --project ./my-project --auto --require-mcp local-fs "Use the approved local-fs tool to inspect the project"
node ./bin/omni.mjs run --project ./my-project --auto --json "Inspect the project and propose changes"
node ./bin/omni.mjs run --harness claude --conversation CONVERSATION_ID "Continue the task"
node ./bin/omni.mjs swap --conversation CONVERSATION_ID --harness codex
node ./bin/omni.mjs swap --conversation CONVERSATION_ID --harness claude
node ./bin/omni.mjs chat --project ./my-project --model MODEL_ID
node ./bin/omni.mjs resume CONVERSATION_ID [--model MODEL_ID]
node ./bin/omni.mjs mcp add --name local-fs --command npx --args-json '["-y","@modelcontextprotocol/server-filesystem","./"]' --cwd ./my-project
node ./bin/omni.mjs mcp add --name remote-docs --transport http --url https://mcp.example.com/mcp --header-env 'Authorization=MCP_DOCS_AUTH' --env-names MCP_DOCS_AUTH
node ./bin/omni.mjs mcp list --json
node ./bin/omni.mjs mcp tools --server local-fs --conversation CONVERSATION_ID
node ./bin/omni.mjs mcp call --server local-fs --tool TOOL_NAME --conversation CONVERSATION_ID --input-file ./tool-input.json
node ./bin/omni.mjs mcp remove --server local-fs
```

MCP utilise le SDK TypeScript officiel pour stdio local et Streamable HTTP distant. Omni persiste la configuration et les noms de variables d’environnement, jamais les valeurs d’en-tête/secrets. HTTP exige HTTPS; HTTP simple n’est permis qu’en loopback. Les URL avec query ou identifiants intégrés sont refusées pour éviter de persister des secrets. Configurez les en-têtes avec `--header-env HEADER=VARIABLE` et inscrivez chaque nom dans `--env-names`. Le lancement pour découvrir le catalogue et chaque appel d’outil manuel exigent une approbation interactive ponctuelle liée à une conversation. Les harness Claude Code et Codex peuvent employer les serveurs MCP configurés : Omni demande l’autorisation de démarrer chaque serveur puis une permission distincte à chaque appel. Dans la version Codex testée, la requête d’approbation n’identifie pas le nom de l’outil avant la décision; l’invite précise le serveur et que l’accord porte sur un seul appel. Sans TTY, ces permissions sont refusées. Gardez les secrets dans l’environnement et référez-vous-y dans `--args-json` avec `{{env:NAME}}`, en ajoutant `NAME` à `--env-names`; Codex refuse les références secrètes dans les arguments de processus et transmet uniquement les noms `--env-names` au serveur. Les variables d’environnement sensibles du processus Omni ne sont pas héritées par Codex quand des serveurs MCP sont activés, sauf celles explicitement autorisées pour le serveur. Le SDK Claude ne permet pas de définir un dossier de travail différent par serveur; Omni refuse cette configuration dans le harness. Auto peut exiger explicitement un ou plusieurs serveurs configurés avec `--require-mcp`; le routeur déterministe exclut les fournisseurs et harnesses qui ne peuvent pas les lancer. La permission de démarrage est demandée avant l’enregistrement du prompt; si elle est refusée, l’exécution s’arrête sans fallback automatique. Ce parcours CLI a été vérifié en PTY avec OAuth : deux approbations ont été demandées (démarrage et appel), un refus au démarrage n’a déclenché ni tour ni fallback, et une panne technique de préflight Codex après approbation a basculé vers Claude avant tout tour; l’outil MCP a été approuvé à nouveau puis exécuté une seule fois. Le parcours live de swap Codex → Claude → Codex avec un outil MCP, consentements, checkpoints et vérification de non-répétition est validé par `OMNI_LIVE_HARNESS_SWAP_TESTS=1 node --test --test-name-pattern='real Codex to Claude to Codex swap preserves files, context, Git state, and does not repeat writes' test/harness-swap.test.mjs`. Le test interactif de swap dans un terminal avec opérateur humain n’a pas été conduit.

`omni run ... --json` writes versioned JSON Lines to stdout (`version: 1`): `routing.decision`/`routing.fallback`, `run.started`, streamed `message.delta`, sanitized tool and one-time permission events, then `run.completed`, `run.interrupted`, or `run.failed`. Prompts and raw tool inputs are not included. Interactive permission questions go to stderr; without a TTY, permissions remain denied. A successful run exits 0, failures 1, and an interrupted run 130. This is Omni’s process interface for ordinary terminals, including an Orca terminal; it is not Orca’s native Agent Session protocol.

`providers refresh` persists non-secret provider status and the latest models discovered through authenticated Codex/Claude CLIs, OpenAI ChatGPT OAuth, or `OPENAI_API_KEY`; `providers list` shows that local registry. For OpenAI, a saved ChatGPT OAuth profile takes precedence over `OPENAI_API_KEY`. `models list --provider ID` refreshes that provider’s real catalog, and `models enable|disable --provider ID --model ID` controls manual availability; add `--auto-only` to change only Auto eligibility. `providers enable|disable --provider ID` controls the provider globally. Preferences survive restarts. Omni's `SecretStore` wraps the operating system credential store; OAuth access and refresh tokens never enter SQLite, logs, or exports, and the validated ID token is discarded. Omni currently supports one OpenAI OAuth profile; signing in again reuses its issued client ID. Linux requires Secret Service (for example, GNOME Keyring or KWallet); Omni fails closed when a secure store is unavailable. Codex, Claude Code and Antigravity continue to own their own CLI credentials.

`harnesses refresh` safely initializes the installed Codex app-server and Claude Agent SDK adapters without creating a session or executing a task, then persists their declared capabilities and availability. Use `harnesses list` to inspect them and `harnesses enable|disable --harness ID` to control use. Disabled harnesses are excluded by Auto and refused by manual `run` and `swap`. A reported capability describes Omni’s adapter contract; it does not promise transfer of private harness state.

`tools list` and `permissions list` read the canonical event history for one conversation or project. They show tool names and permission outcomes while omitting raw tool inputs and parameters. These commands are read-only and do not grant, replay, or revoke permissions.

`conversation search --query TEXT` finds a literal substring in conversation titles or persisted messages; add `--project ID_OR_PATH` to scope results. JSON output includes the matching title/message excerpt and the conversation identifiers.

The CLI stores projects, conversations, messages, streamed partial responses and provider session IDs in `~/.omni/omni.sqlite` (or `OMNI_DATA_DIR`). Versioned SQLite migrations initialize the schema. An append-only event log records message creation, streamed deltas, model changes and session outcomes; credential-shaped strings are redacted before message and event persistence. `conversation export ID` exports the transcript with its event history. For OpenAI OAuth, `models list --provider openai` queries the signed-in account’s displayable model catalog and Responses requests stream with `store:false`; API-key mode continues to use the API account catalog. Codex and Claude model discovery use their authenticated official runtimes. Choose a listed OpenAI model ID, `codex`, or `claude:<model-id>` for provider chat. Codex harness tasks start in the app-server's `read-only` sandbox; command, file-change and permission-profile escalations require a one-time approval in an interactive terminal and are denied without a TTY. Codex checkpoints retain the app-server thread reference, and `--conversation` resumes that thread after an Omni restart. The Claude harness exposes Read, Grep, Glob, Bash, Edit and Write through the SDK permission callback; Omni asks for each tool approval in an interactive terminal and denies requests when no terminal is available. `chat` is interactive (`/quit` exits), `run` submits one prompt, and `resume` continues a stored chat conversation after restarting Omni using its saved model by default; `--model` changes that choice. Use `--conversation` with `omni run --harness claude|codex` to continue a harness task after restart. Set `OMNI_LIVE_TESTS=1` and `OMNI_TEST_MODEL` for the live OpenAI API-key test, `OMNI_LIVE_OPENAI_OAUTH_TESTS=1` for OpenAI ChatGPT OAuth model listing and stream testing, `OMNI_LIVE_KEYRING_TESTS=1` for a transient system-keyring check, `OMNI_LIVE_CODEX_TESTS=1` for the Codex OAuth provider stream-and-resume test, `OMNI_LIVE_CODEX_HARNESS_TESTS=1` for the real Codex harness permission/write/resume test, or `OMNI_LIVE_CLAUDE_TESTS=1` for Claude OAuth streaming/resume and the approved temporary-file write integration test. See [`VERIFICATION.md`](VERIFICATION.md) for the verification checklist and rerun commands.

Import an export into a project with `node ./bin/omni.mjs conversation import --project PROJECT_ID_OR_PATH ./conversation.json`. Imported session events are historical records; Omni gives the imported conversation and its messages fresh IDs, preserves the transcript, and never replays an action.

Use `OMNI_DATA_DIR` to point local data to a different directory. SQLite data uses restrictive local file permissions but is not encrypted. OpenAI credentials are resolved in this order: ChatGPT OAuth, `OPENAI_API_KEY`, then the active stored API-key profile. Manage profiles with `auth key set|list|use|remove openai`; set accepts a profile name and stdin only, list/status expose names and source but no key values, and remove asks for confirmation (use `--yes` in automation). The legacy `default` keyring identity remains supported. API keys are not copied into SQLite or logs.

## Project status

- Persistent chat, OAuth providers, model/harness registries, Codex and Claude harnesses, checkpoints, swap, deterministic Auto, and the standalone CLI are implemented in Omni. No Orca installation is required.
- MCP uses the official TypeScript SDK for local stdio and remote Streamable HTTP. HTTP servers require HTTPS (loopback is allowed for local servers); authorization headers resolve from environment variable references. Codex and Claude request approval before startup and before each tool call. Auto supports explicit requirements with `--require-mcp`; a denied permission stops before a turn, while a technical harness preflight failure can fall back before the turn. A real OAuth PTY run confirmed approval, denial without fallback, and Codex-to-Claude fallback with one MCP mutation. A real Codex → Claude → Codex swap preserved the checkpoint and project state without repeating that mutation. Live Claude OAuth + HTTP MCP and Codex OAuth + authenticated HTTP MCP both executed a tool once against local SDK servers; no OpenAI API key was used. Detailed evidence is in [`VERIFICATION.md`](VERIFICATION.md).
- The current regular suite passes 99 discovered tests: 74 passed, 0 failed, and 25 opt-in live tests skipped. Lint, formatting, syntax, build and dependency audit pass. Live tests that require OAuth sessions are documented individually.
- OpenAI ChatGPT OAuth has been exercised through Omni: the account catalog returned eight models, `gpt-6.1-sol` answered, and a new CLI process resumed the stored conversation. OpenAI API-key storage/profile selection is covered locally, but no API-key network request was made, in line with the current test scope.
- Antigravity’s official CLI and model catalog were inspected, and the CLI itself answered a real model request. Omni’s separate provider adapter has not completed a live response-and-resume run: global Antigravity hooks are active on the test machine, and Omni fails closed when its headless permission policy cannot be verified safely. Antigravity remains chat-only and excluded from Auto, Harness Registry and Harness Swap.
- Omni works as a regular CLI command in an existing Orca terminal. The installed Orca CLI rejects `--agent omni` and exposes no public custom-agent registration contract; no Orca code or settings were changed. Remote MCP Streamable HTTP is supported and live-tested with Codex and Claude OAuth against local SDK fixtures. See [`ORCA_COMPATIBILITY.md`](ORCA_COMPATIBILITY.md) and [`VERIFICATION.md`](VERIFICATION.md).

The installed Claude Agent SDK declares a proprietary license; review its terms before redistributing Omni with this dependency. The `@napi-rs/keyring` wrapper is MIT-licensed; its bundled Linux platform binary also embeds third-party components with additional license notices, which must be reviewed before redistribution.

For Auto chat requests classified as not needing tools, Omni prefers Claude's chat SDK with no tools or Codex's app-server in a read-only sandbox; candidates with full harness tools are ranked after those lower-capability adapters. Codex chat still has read-only project access, and the app-server declines permission escalations. Auto tasks classified as requiring tools continue to use the permission-gated Claude or Codex harness.

Antigravity is an experimental chat provider through Google's official `agy` CLI, not an Omni harness: run `omni auth login antigravity`, `omni providers refresh --provider antigravity`, then `omni chat --project ./project --model antigravity:MODEL`. The project path is used only for Omni's conversation record; Antigravity runs in a private `~/.omni/antigravity-workspaces/<conversation-id>` directory with `--sandbox` and `--mode plan`. Omni refuses to launch when global Antigravity permissions contain `allow` rules or a non-review `toolPermission`. Headless tools requiring approval are refused by Antigravity; scratch changes are never copied to the project. The Omni provider response-and-resume path has not been live-validated: global hooks on the current machine make Omni reject headless execution under its fail-closed permission policy. Antigravity remains excluded from `omni run`, Auto, Harness Registry and Harness Swap. See [`VERIFICATION.md`](VERIFICATION.md).
