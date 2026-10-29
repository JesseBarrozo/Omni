# Omni

Omni is an independent Universal AI Harness under phased development. Its CLI supports persistent SQLite conversations, OpenAI ChatGPT OAuth and API-key chat, Codex OAuth chat through the official Codex app-server, and Claude Code Agent SDK sessions. OpenAI OAuth uses OpenAI’s documented Sign in with ChatGPT flow for open-source local apps; see [`VERIFICATION.md`](VERIFICATION.md) for the live validation state. See [`AUDIT.md`](AUDIT.md) for the verified repository baseline and [`Omni_PRD.md`](Omni_PRD.md) for the product requirements.

## Requirements

- Node.js 20 or newer
- npm
- the Codex CLI, logged in with `codex login`, for Codex OAuth chat; Omni delegates authentication to Codex and never reads its token
- Claude Code CLI, logged in with `claude auth login --claudeai`, for Claude Agent SDK chat and harness; Omni delegates authentication and never reads its token
- for ChatGPT plan usage, run `omni auth login openai`; OAuth credentials are stored in the operating system’s secure credential store, never SQLite
- optionally, an OpenAI API key in `OPENAI_API_KEY` for direct API billing, or store it with `omni auth key set openai --stdin`; the CLI reads one line without displaying it and stores it in the system credential store

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
node ./bin/omni.mjs auth key set openai --stdin --profile work < /secure/path/openai-key
node ./bin/omni.mjs auth key list openai --json
node ./bin/omni.mjs auth key use openai --profile work
node ./bin/omni.mjs auth key remove openai --profile work
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
node ./bin/omni.mjs run --project ./my-project --auto --require-mcp local-fs "Use the approved local-fs tool to inspect the project"
node ./bin/omni.mjs run --project ./my-project --auto --json "Inspect the project and propose changes"
node ./bin/omni.mjs run --harness claude --conversation CONVERSATION_ID "Continue the task"
node ./bin/omni.mjs swap --conversation CONVERSATION_ID --harness codex
node ./bin/omni.mjs swap --conversation CONVERSATION_ID --harness claude
node ./bin/omni.mjs chat --project ./my-project --model MODEL_ID
node ./bin/omni.mjs resume CONVERSATION_ID [--model MODEL_ID]
node ./bin/omni.mjs mcp add --name local-fs --command npx --args-json '["-y","@modelcontextprotocol/server-filesystem","./"]' --cwd ./my-project
node ./bin/omni.mjs mcp list --json
node ./bin/omni.mjs mcp tools --server local-fs --conversation CONVERSATION_ID
node ./bin/omni.mjs mcp call --server local-fs --tool TOOL_NAME --conversation CONVERSATION_ID --input-file ./tool-input.json
node ./bin/omni.mjs mcp remove --server local-fs
```

MCP utilise le SDK TypeScript officiel sur des serveurs locaux stdio. Omni persiste la commande, les modèles d’arguments, le répertoire de travail, les noms de variables d’environnement et les schémas d’outils dans SQLite; les valeurs d’environnement et arguments d’outils ne sont pas persistés. Le lancement pour découvrir le catalogue et chaque appel d’outil manuel exigent une approbation interactive ponctuelle liée à une conversation. Les harness Claude Code et Codex peuvent employer les serveurs MCP configurés : Omni demande l’autorisation de démarrer chaque serveur puis une permission distincte à chaque appel. Dans la version Codex testée, la requête d’approbation n’identifie pas le nom de l’outil avant la décision; l’invite précise le serveur et que l’accord porte sur un seul appel. Sans TTY, ces permissions sont refusées. Gardez les secrets dans l’environnement et référez-vous-y dans `--args-json` avec `{{env:NAME}}`, en ajoutant `NAME` à `--env-names`; Codex refuse les références secrètes dans les arguments de processus et transmet uniquement les noms `--env-names` au serveur. Les variables d’environnement sensibles du processus Omni ne sont pas héritées par Codex quand des serveurs MCP sont activés, sauf celles explicitement autorisées pour le serveur. Le SDK Claude ne permet pas de définir un dossier de travail différent par serveur; Omni refuse cette configuration dans le harness. Auto peut exiger explicitement un ou plusieurs serveurs configurés avec `--require-mcp`; le routeur déterministe exclut les fournisseurs et harnesses qui ne peuvent pas les lancer. La permission de démarrage est demandée avant l’enregistrement du prompt; si elle est refusée, l’exécution s’arrête sans fallback automatique. Ce parcours CLI a été vérifié en PTY avec OAuth : deux approbations ont été demandées (démarrage et appel), un refus au démarrage n’a déclenché ni tour ni fallback, et une panne technique de préflight Codex après approbation a basculé vers Claude avant tout tour; l’outil MCP a été approuvé à nouveau puis exécuté une seule fois. Le parcours live de swap Codex → Claude → Codex avec un outil MCP, consentements, checkpoints et vérification de non-répétition est validé par `OMNI_LIVE_HARNESS_SWAP_TESTS=1 node --test --test-name-pattern='real Codex to Claude to Codex swap preserves files, context, Git state, and does not repeat writes' test/harness-swap.test.mjs`. Le test interactif de swap dans un terminal avec opérateur humain n’a pas été conduit.

`omni run ... --json` writes versioned JSON Lines to stdout (`version: 1`): `routing.decision`/`routing.fallback`, `run.started`, streamed `message.delta`, sanitized tool and one-time permission events, then `run.completed`, `run.interrupted`, or `run.failed`. Prompts and raw tool inputs are not included. Interactive permission questions go to stderr; without a TTY, permissions remain denied. A successful run exits 0, failures 1, and an interrupted run 130. This is Omni’s process interface for ordinary terminals, including an Orca terminal; it is not Orca’s native Agent Session protocol.

`providers refresh` persists non-secret provider status and the latest models discovered through authenticated Codex/Claude CLIs, OpenAI ChatGPT OAuth, or `OPENAI_API_KEY`; `providers list` shows that local registry. For OpenAI, a saved ChatGPT OAuth profile takes precedence over `OPENAI_API_KEY`. `models list --provider ID` refreshes that provider’s real catalog, and `models enable|disable --provider ID --model ID` controls manual availability; add `--auto-only` to change only Auto eligibility. `providers enable|disable --provider ID` controls the provider globally. Preferences survive restarts. Omni's `SecretStore` wraps the operating system credential store; OAuth access and refresh tokens never enter SQLite, logs, or exports, and the validated ID token is discarded. Omni currently supports one OpenAI OAuth profile; signing in again reuses its issued client ID. Linux requires Secret Service (for example, GNOME Keyring or KWallet); Omni fails closed when a secure store is unavailable. Codex, Claude Code and Antigravity continue to own their own CLI credentials.

`harnesses refresh` safely initializes the installed Codex app-server and Claude Agent SDK adapters without creating a session or executing a task, then persists their declared capabilities and availability. Use `harnesses list` to inspect them and `harnesses enable|disable --harness ID` to control use. Disabled harnesses are excluded by Auto and refused by manual `run` and `swap`. A reported capability describes Omni’s adapter contract; it does not promise transfer of private harness state.

`tools list` and `permissions list` read the canonical event history for one conversation or project. They show tool names and permission outcomes while omitting raw tool inputs and parameters. These commands are read-only and do not grant, replay, or revoke permissions.

`conversation search --query TEXT` finds a literal substring in conversation titles or persisted messages; add `--project ID_OR_PATH` to scope results. JSON output includes the matching title/message excerpt and the conversation identifiers.

The CLI stores projects, conversations, messages, streamed partial responses and provider session IDs in `~/.omni/omni.sqlite` (or `OMNI_DATA_DIR`). Versioned SQLite migrations initialize the schema. An append-only event log records message creation, streamed deltas, model changes and session outcomes; credential-shaped strings are redacted before message and event persistence. `conversation export ID` exports the transcript with its event history. For OpenAI OAuth, `models list --provider openai` queries the signed-in account’s displayable model catalog and Responses requests stream with `store:false`; API-key mode continues to use the API account catalog. Codex and Claude model discovery use their authenticated official runtimes. Choose a listed OpenAI model ID, `codex`, or `claude:<model-id>` for provider chat. Codex harness tasks start in the app-server's `read-only` sandbox; command, file-change and permission-profile escalations require a one-time approval in an interactive terminal and are denied without a TTY. Codex checkpoints retain the app-server thread reference, and `--conversation` resumes that thread after an Omni restart. The Claude harness exposes Read, Grep, Glob, Bash, Edit and Write through the SDK permission callback; Omni asks for each tool approval in an interactive terminal and denies requests when no terminal is available. `chat` is interactive (`/quit` exits), `run` submits one prompt, and `resume` continues a stored chat conversation after restarting Omni using its saved model by default; `--model` changes that choice. Use `--conversation` with `omni run --harness claude|codex` to continue a harness task after restart. Set `OMNI_LIVE_TESTS=1` and `OMNI_TEST_MODEL` for the live OpenAI API-key test, `OMNI_LIVE_OPENAI_OAUTH_TESTS=1` for OpenAI ChatGPT OAuth model listing and stream testing, `OMNI_LIVE_KEYRING_TESTS=1` for a transient system-keyring check, `OMNI_LIVE_CODEX_TESTS=1` for the Codex OAuth provider stream-and-resume test, `OMNI_LIVE_CODEX_HARNESS_TESTS=1` for the real Codex harness permission/write/resume test, or `OMNI_LIVE_CLAUDE_TESTS=1` for Claude OAuth streaming/resume and the approved temporary-file write integration test. See [`VERIFICATION.md`](VERIFICATION.md) for the verification checklist and rerun commands.

Import an export into a project with `node ./bin/omni.mjs conversation import --project PROJECT_ID_OR_PATH ./conversation.json`. Imported session events are historical records; Omni gives the imported conversation and its messages fresh IDs, preserves the transcript, and never replays an action.

Use `OMNI_DATA_DIR` to point local data to a different directory. SQLite data uses restrictive local file permissions but is not encrypted. OpenAI credentials are resolved in this order: ChatGPT OAuth, `OPENAI_API_KEY`, then the active stored API-key profile. Manage profiles with `auth key set|list|use|remove openai`; set accepts a profile name and stdin only, list/status expose names and source but no key values, and remove asks for confirmation (use `--yes` in automation). The legacy `default` keyring identity remains supported. API keys are not copied into SQLite or logs.

## Project status

The OpenAI ChatGPT OAuth provider has been exercised through Omni: the real account catalog returned eight models, `gpt-6.1-sol` answered a prompt, and a new CLI process resumed the stored conversation. OAuth credentials remain in the system credential store. API-key storage and selection are covered locally; actual API-key model/catalog requests have not been exercised in this phase. Interactive rejection/interrupt paths, Antigravity Omni integration and native Orca Agent Session integration remain unverified. The real Codex OAuth chat and harness paths have been exercised through the installed Codex app-server. Claude OAuth streaming/resume and an approved tool write were exercised against the official Agent SDK. An opt-in integration test executes Codex → Claude → Codex on a temporary Git project, verifying permission, checkpoint summaries, file state and no duplicate write. Deterministic `--auto` queries authenticated provider accounts and their real model catalogs, persists evaluated candidates, exclusions, ranking, fallback and outcomes, and uses results across conversations; identical model IDs from different providers remain separate routing candidates. Use `OMNI_AUTO_MODELS=codex:MODEL,claude:MODEL` to allowlist exact models, `OMNI_DISABLED_PROVIDERS=claude` to disable a provider, `OMNI_AUTO_PREFERRED_PROVIDERS=codex,claude` to set deterministic preference, `OMNI_AUTO_PROFILE=balance|efficiency|intelligence`, `OMNI_AUTO_MAX_INPUT_PER_MILLION=N` to enforce a ceiling only where actual model pricing is known, and `OMNI_AUTO_PRIVACY=strict` to require explicit privacy approval. The current real harnesses do not provide verified price metadata or local/private approval metadata; cost ceilings therefore exclude candidates with unknown prices, and strict privacy excludes both cloud harnesses. Auto tries the next ranked candidate only when harness initialization fails before the user prompt is recorded or a turn starts; once execution begins it never retries, so non-idempotent tools are not replayed. `OMNI_CODEX_HARNESS_EXECUTABLE` can point to a Codex executable for the harness process; it does not change the Codex executable used for OAuth/catalog discovery. Run the real route test with `OMNI_LIVE_AUTO_TESTS=1 node --test test/auto-router.test.mjs`; run the real preflight fallback test with both Codex and Claude OAuth accounts connected using `OMNI_LIVE_AUTO_FALLBACK_TESTS=1 node --test test/auto-router.test.mjs`. Omni can run as a normal command in an existing Orca terminal, but the installed Orca CLI rejects `--agent omni` as an unknown TUI agent and exposes no custom-agent registration contract; see [`ORCA_COMPATIBILITY.md`](ORCA_COMPATIBILITY.md). The official Antigravity CLI itself answered a real model request using its local CLI authentication, but the active OAuth account was not confirmed separately; headless mode does not expose Omni's per-tool approval callback and permits workspace writes by default; details are in [`VERIFICATION.md`](VERIFICATION.md). The mock harness remains test-only. The installed Claude Agent SDK declares a proprietary license; review its terms before redistributing Omni with this dependency. The `@napi-rs/keyring` wrapper is MIT-licensed; its bundled Linux platform binary also embeds third-party components with additional license notices, which must be reviewed before redistribution.

For Auto chat requests classified as not needing tools, Omni prefers Claude's chat SDK with no tools or Codex's app-server in a read-only sandbox; candidates with full harness tools are ranked after those lower-capability adapters. Codex chat still has read-only project access, and the app-server declines permission escalations. Auto tasks classified as requiring tools continue to use the permission-gated Claude or Codex harness.

Antigravity is an experimental chat provider through Google's official `agy` CLI, not an Omni harness: run `omni auth login antigravity`, `omni providers refresh --provider antigravity`, then `omni chat --project ./project --model antigravity:MODEL`. The project path is used only for Omni's conversation record; Antigravity runs in a private `~/.omni/antigravity-workspaces/<conversation-id>` directory with `--sandbox` and `--mode plan`. Omni refuses to launch when global Antigravity permissions contain `allow` rules or a non-review `toolPermission`. Headless tools requiring approval are refused by Antigravity; scratch changes are never copied to the project. The account and model response path has not been revalidated in this Omni integration because the live API test was intentionally deferred. Antigravity remains excluded from `omni run`, Auto, Harness Registry and Harness Swap. See [`VERIFICATION.md`](VERIFICATION.md).
