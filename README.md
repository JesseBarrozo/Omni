# Omni

Omni is being developed as an independent Universal AI Harness. The current code is an audited prototype, not yet a usable multi-model chat product: it has no real provider or harness integration, no chat UI, and no durable session recovery. See [`AUDIT.md`](AUDIT.md) for the verified starting state and [`Omni_PRD.md`](Omni_PRD.md) for the target product.

## Requirements

- Node.js 20 or newer
- npm

No external npm dependency is currently declared.

## Existing commands

```sh
npm test
npm run check
node ./bin/omni.mjs help
node ./bin/omni.mjs init
node ./bin/omni.mjs status --json
node ./bin/omni.mjs conversation create --title "Local record"
```

The CLI supports local initialization, status, conversation metadata creation, and event export. It does not yet support `chat`, `run`, or `resume`. `npm start` without a command prints help and exits.

Use `OMNI_DATA_DIR` to point local test data to a temporary directory. Current JSON data is not encrypted; do not put API credentials or sensitive project content in it.

## Project status

No real provider/harness path is currently wired to the CLI. The only harness implementation is a mock for unit tests. Do not interpret the local routing, permissions, or swap classes as completed product features until they are connected to real execution and validated with integration tests.
