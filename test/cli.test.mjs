import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ChatStore } from "../src/chat-store.mjs";

const cli = fileURLToPath(new URL("../bin/omni.mjs", import.meta.url));

test("CLI refuses to present Antigravity chat as an Omni harness run", () => {
  const dir = mkdtempSync(join(tmpdir(), "omni-antigravity-run-"));
  const env = { ...process.env, OMNI_DATA_DIR: join(dir, "data") };
  const run = (...args) =>
    spawnSync(process.execPath, [cli, ...args], { env, encoding: "utf8" });
  try {
    const project = run("project", "create", "--name", "isolated-chat");
    assert.equal(project.status, 0, project.stderr);
    const result = run(
      "run",
      "--project",
      JSON.parse(project.stdout).id,
      "--model",
      "antigravity:gemini-4-argon-medium",
      "Hello",
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /chat isolé uniquement/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI only accepts required MCP capabilities with Auto routing", () => {
  const dir = mkdtempSync(join(tmpdir(), "omni-required-mcp-cli-"));
  const env = { ...process.env, OMNI_DATA_DIR: join(dir, "data") };
  try {
    const result = spawnSync(
      process.execPath,
      [
        cli,
        "run",
        "--project",
        dir,
        "--model",
        "codex",
        "--require-mcp",
        "local-fs",
        "Inspect files",
      ],
      { env, encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /--require-mcp nécessite/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI registers Streamable HTTP MCP without persisting or printing header secrets", () => {
  const dir = mkdtempSync(join(tmpdir(), "omni-http-mcp-cli-"));
  const secret = "temporary-cli-header-secret";
  const env = {
    ...process.env,
    OMNI_DATA_DIR: join(dir, "data"),
    OMNI_TEST_REMOTE_MCP: secret,
  };
  const run = (...args) =>
    spawnSync(process.execPath, [cli, ...args], { env, encoding: "utf8" });
  try {
    const added = run(
      "mcp",
      "add",
      "--name",
      "remote-docs",
      "--transport",
      "http",
      "--url",
      "https://mcp.example.test/mcp",
      "--header-env",
      "Authorization=OMNI_TEST_REMOTE_MCP",
      "--env-names",
      "OMNI_TEST_REMOTE_MCP",
    );
    assert.equal(added.status, 0, added.stderr);
    assert.equal(added.stdout.includes(secret), false);
    assert.equal(added.stderr.includes(secret), false);
    const listed = run("mcp", "list", "--json");
    assert.equal(listed.status, 0, listed.stderr);
    assert.equal(listed.stdout.includes(secret), false);
    assert.equal(JSON.parse(listed.stdout)[0].transport, "http");
    const store = new ChatStore(join(dir, "data", "omni.sqlite"));
    try {
      assert.equal(
        JSON.stringify(
          store.db.prepare("SELECT * FROM mcp_servers").get(),
        ).includes(secret),
        false,
      );
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI rejects malformed API-key stdin without echoing it", () => {
  const dir = mkdtempSync(join(tmpdir(), "omni-api-key-cli-"));
  const env = { ...process.env, OMNI_DATA_DIR: join(dir, "data") };
  const run = (input, ...args) =>
    spawnSync(process.execPath, [cli, ...args], {
      env,
      input,
      encoding: "utf8",
    });
  try {
    const key = "test-key-must-not-appear-in-output";
    const result = run(
      `${key}\nsecond-line`,
      "auth",
      "key",
      "set",
      "openai",
      "--stdin",
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /une seule ligne/);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(key));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI rejects API keys in arguments and requires explicit noninteractive removal", () => {
  const dir = mkdtempSync(join(tmpdir(), "omni-api-key-cli-"));
  const env = { ...process.env, OMNI_DATA_DIR: join(dir, "data") };
  const run = (...args) =>
    spawnSync(process.execPath, [cli, ...args], { env, encoding: "utf8" });
  try {
    const argumentKey = run("auth", "key", "set", "openai", "unsafe-key");
    assert.equal(argumentKey.status, 1);
    assert.match(argumentKey.stderr, /uniquement avec --stdin/);
    assert.doesNotMatch(argumentKey.stderr, /unsafe-key/);
    const removal = run("auth", "key", "remove", "openai");
    assert.equal(removal.status, 1);
    assert.match(removal.stderr, /Confirmez la suppression avec --yes/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI advertises named API-key profiles and requires stdin for new provider profiles", () => {
  const dir = mkdtempSync(join(tmpdir(), "omni-api-key-profiles-help-"));
  const env = { ...process.env, OMNI_DATA_DIR: join(dir, "data") };
  const run = (...args) =>
    spawnSync(process.execPath, [cli, ...args], { env, encoding: "utf8" });
  try {
    const help = run("help");
    assert.equal(help.status, 0, help.stderr);
    assert.match(
      help.stdout,
      /auth key set openrouter\|anthropic\|google --stdin \[--profile NAME\]/,
    );
    assert.match(
      help.stdout,
      /auth key list openai\|openrouter\|anthropic\|google/,
    );

    const missingStdin = run(
      "auth",
      "key",
      "set",
      "anthropic",
      "--profile",
      "work",
    );
    assert.equal(missingStdin.status, 1);
    assert.match(missingStdin.stderr, /uniquement avec --stdin/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test(
  "CLI manages temporary named OpenAI key profiles using the real system keyring",
  { skip: process.env.OMNI_LIVE_KEYRING_TESTS !== "1", timeout: 30_000 },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "omni-key-profiles-cli-"));
    const env = { ...process.env, OMNI_DATA_DIR: join(dir, "data") };
    const run = (input, ...args) =>
      spawnSync(process.execPath, [cli, ...args], {
        env,
        ...(input === null ? {} : { input }),
        encoding: "utf8",
      });
    const suffix = `${process.pid}-${Date.now()}`;
    const profiles = [`omni-test-a-${suffix}`, `omni-test-b-${suffix}`];
    const original = run(null, "auth", "key", "list", "openai", "--json");
    assert.equal(original.status, 0, original.stderr);
    const originalActive = JSON.parse(original.stdout).active;
    try {
      for (const [index, profile] of profiles.entries()) {
        const key = `temporary-profile-secret-${index}-${suffix}`;
        const saved = run(
          `${key}\n`,
          "auth",
          "key",
          "set",
          "openai",
          "--stdin",
          "--profile",
          profile,
        );
        assert.equal(saved.status, 0, saved.stderr);
        assert.doesNotMatch(`${saved.stdout}${saved.stderr}`, new RegExp(key));
      }
      const listed = run(null, "auth", "key", "list", "openai", "--json");
      assert.deepEqual(JSON.parse(listed.stdout).profiles.slice(-2), profiles);
      const selected = run(
        null,
        "auth",
        "key",
        "use",
        "openai",
        "--profile",
        profiles[0],
      );
      assert.equal(selected.status, 0, selected.stderr);
      const status = run(null, "auth", "status", "--json");
      assert.equal(status.status, 0, status.stderr);
      assert.doesNotMatch(status.stdout, /temporary-profile-secret/);
    } finally {
      for (const profile of profiles)
        run(
          null,
          "auth",
          "key",
          "remove",
          "openai",
          "--profile",
          profile,
          "--yes",
        );
      if (originalActive)
        run(null, "auth", "key", "use", "openai", "--profile", originalActive);
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test("CLI persists projects and resumes with the saved or explicitly changed model", () => {
  const dir = mkdtempSync(join(tmpdir(), "omni-cli-"));
  const env = { ...process.env, OMNI_DATA_DIR: join(dir, "data") };
  const run = (...args) =>
    spawnSync(process.execPath, [cli, ...args], { env, encoding: "utf8" });
  try {
    const created = run("project", "create", "--name", "cli-test");
    assert.equal(created.status, 0, created.stderr);
    const project = JSON.parse(created.stdout);
    const status = run("status", "--json");
    assert.equal(status.status, 0, status.stderr);
    assert.equal(JSON.parse(status.stdout).projects[0].id, project.id);

    const store = new ChatStore(join(dir, "data", "omni.sqlite"));
    const conversation = store.createConversation(
      project.id,
      "resume",
      "saved-model",
    );
    store.addMessage(conversation.id, "user", "saved prompt");
    store.close();
    const exported = run("conversation", "export", conversation.id);
    assert.equal(exported.status, 0, exported.stderr);
    const record = JSON.parse(exported.stdout);
    assert.equal(record.conversation.messages[0].content, "saved prompt");
    assert.ok(
      record.events.some((event) => event.type === "conversation.created"),
    );
    const exportFile = join(dir, "export.json");
    writeFileSync(exportFile, exported.stdout);
    const imported = run(
      "conversation",
      "import",
      "--project",
      project.id,
      exportFile,
    );
    assert.equal(imported.status, 0, imported.stderr);
    const importedConversation = JSON.parse(imported.stdout);
    assert.notEqual(importedConversation.id, conversation.id);
    assert.equal(importedConversation.messages[0].content, "saved prompt");
    const importedEvents = run(
      "conversation",
      "export",
      importedConversation.id,
    );
    assert.equal(importedEvents.status, 0, importedEvents.stderr);
    assert.ok(
      JSON.parse(importedEvents.stdout).events.some(
        (event) => event.type === "conversation.imported",
      ),
    );
    const resumed = run("resume", conversation.id);
    assert.equal(resumed.status, 1);
    assert.match(resumed.stdout, /modèle saved-model/);
    assert.match(
      resumed.stderr,
      /conversation interactive nécessite un terminal TTY/,
    );
    assert.doesNotMatch(
      `${resumed.stdout}${resumed.stderr}`,
      /sk-[A-Za-z0-9_-]{12,}/,
    );

    const changed = run("resume", conversation.id, "--model", "new-model");
    assert.equal(changed.status, 1);
    const verify = new ChatStore(join(dir, "data", "omni.sqlite"));
    assert.equal(verify.conversation(conversation.id).modelId, "new-model");
    verify.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI --json reports run validation errors as a single JSONL event", () => {
  const dir = mkdtempSync(join(tmpdir(), "omni-cli-json-error-"));
  const env = { ...process.env, OMNI_DATA_DIR: join(dir, "data") };
  const run = (...args) =>
    spawnSync(process.execPath, [cli, ...args], { env, encoding: "utf8" });
  try {
    const project = run(
      "project",
      "create",
      "--name",
      "json-errors",
      "--path",
      dir,
    );
    assert.equal(project.status, 0, project.stderr);
    const result = run("run", "--project", dir, "--json");
    assert.equal(result.status, 1);
    assert.equal(result.stderr, "");
    const lines = result.stdout.trim().split("\n");
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]).type, "run.failed");
    assert.match(JSON.parse(lines[0]).error, /Usage: omni run/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI lists providers and persists global and Auto model activation", () => {
  const dir = mkdtempSync(join(tmpdir(), "omni-provider-cli-"));
  const env = { ...process.env, OMNI_DATA_DIR: join(dir, "data") };
  const run = (...args) =>
    spawnSync(process.execPath, [cli, ...args], { env, encoding: "utf8" });
  try {
    const store = new ChatStore(join(dir, "data", "omni.sqlite"));
    store.saveProviderCatalog({
      providerId: "codex",
      name: "Codex OAuth",
      authStatus: "connected",
      models: ["model-a"],
    });
    store.close();
    const providers = run("providers", "list", "--json");
    assert.equal(providers.status, 0, providers.stderr);
    assert.equal(JSON.parse(providers.stdout)[0].id, "codex");
    const providerDisabled = run("providers", "disable", "--provider", "codex");
    assert.equal(providerDisabled.status, 0, providerDisabled.stderr);
    assert.equal(JSON.parse(providerDisabled.stdout).enabled, false);
    const providerEnabled = run("providers", "enable", "--provider", "codex");
    assert.equal(providerEnabled.status, 0, providerEnabled.stderr);
    assert.equal(JSON.parse(providerEnabled.stdout).enabled, true);
    const project = run(
      "project",
      "create",
      "--name",
      "provider-disable-test",
      "--path",
      dir,
    );
    assert.equal(project.status, 0, project.stderr);
    const globallyDisabled = run(
      "models",
      "disable",
      "--provider",
      "codex",
      "--model",
      "model-a",
    );
    assert.equal(globallyDisabled.status, 0, globallyDisabled.stderr);
    const refused = run("chat", "--project", dir, "--model", "codex:model-a");
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /Modèle désactivé ou indisponible/);
    const globallyEnabled = run(
      "models",
      "enable",
      "--provider",
      "codex",
      "--model",
      "model-a",
    );
    assert.equal(globallyEnabled.status, 0, globallyEnabled.stderr);
    const disabled = run(
      "models",
      "disable",
      "--provider",
      "codex",
      "--model",
      "model-a",
      "--auto-only",
    );
    assert.equal(disabled.status, 0, disabled.stderr);
    assert.equal(JSON.parse(disabled.stdout).enabledForAuto, false);
    const verify = new ChatStore(join(dir, "data", "omni.sqlite"));
    assert.equal(verify.modelRegistry("codex")[0].enabledForAuto, false);
    verify.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI registry blocks disabled harnesses for run and harness swap", () => {
  const dir = mkdtempSync(join(tmpdir(), "omni-harness-cli-"));
  const env = { ...process.env, OMNI_DATA_DIR: join(dir, "data") };
  const run = (...args) =>
    spawnSync(process.execPath, [cli, ...args], { env, encoding: "utf8" });
  try {
    const store = new ChatStore(join(dir, "data", "omni.sqlite"));
    const project = store.createProject("harness-disabled", dir);
    store.saveHarnessRegistry({
      id: "codex",
      name: "Codex app-server",
      providerId: "codex",
      integration: "Codex app-server JSON-RPC",
      status: "connected",
      available: true,
      capabilities: { tools: true, streaming: true, checkpoint: true },
    });
    store.setHarnessEnabled("codex", false);
    store.saveHarnessRegistry({
      id: "opencode",
      name: "OpenCode server SDK",
      providerId: "opencode",
      integration: "OpenCode local server via official SDK v2",
      status: "connected",
      available: true,
      capabilities: { tools: true, streaming: true, checkpoint: true },
    });
    store.setHarnessEnabled("opencode", false);
    const conversation = store.createConversation(
      project.id,
      "existing",
      "codex",
    );
    store.close();
    const listed = run("harnesses", "list", "--json");
    assert.equal(listed.status, 0, listed.stderr);
    assert.equal(JSON.parse(listed.stdout)[0].enabled, false);
    const task = run(
      "run",
      "--project",
      dir,
      "--harness",
      "codex",
      "--model",
      "codex",
      "Do nothing",
    );
    assert.notEqual(task.status, 0);
    assert.match(task.stderr, /Harness désactivé: codex/);
    const swap = run(
      "swap",
      "--conversation",
      conversation.id,
      "--harness",
      "codex",
    );
    assert.notEqual(swap.status, 0);
    assert.match(swap.stderr, /Harness désactivé: codex/);
    const disabledOpenCodeSwap = run(
      "swap",
      "--conversation",
      conversation.id,
      "--harness",
      "opencode",
    );
    assert.notEqual(disabledOpenCodeSwap.status, 0);
    assert.match(disabledOpenCodeSwap.stderr, /Harness désactivé: opencode/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI exposes persisted tool and permission history without raw tool inputs", () => {
  const dir = mkdtempSync(join(tmpdir(), "omni-execution-history-cli-"));
  const env = { ...process.env, OMNI_DATA_DIR: join(dir, "data") };
  const run = (...args) =>
    spawnSync(process.execPath, [cli, ...args], { env, encoding: "utf8" });
  try {
    const store = new ChatStore(join(dir, "data", "omni.sqlite"));
    const project = store.createProject("execution-history", dir);
    const conversation = store.createConversation(
      project.id,
      "history",
      "claude",
    );
    store.appendEvent(conversation.id, "tool.started", {
      toolName: "Write",
      harnessId: "claude-code",
      input: { file_path: "/private/path", content: "hidden-tool-input" },
    });
    store.appendEvent(conversation.id, "permission.requested", {
      id: "permission-1",
      toolName: "Write",
      action: "file-write",
      input: { content: "hidden-permission-input" },
    });
    store.appendEvent(conversation.id, "permission.granted", {
      id: "permission-1",
      toolName: "Write",
      reason: "approved once",
      scope: "turn",
    });
    store.close();

    const tools = run("tools", "list", "--project", dir, "--json");
    assert.equal(tools.status, 0, tools.stderr);
    assert.equal(JSON.parse(tools.stdout)[0].toolName, "Write");
    assert.doesNotMatch(tools.stdout, /hidden-tool-input|\/private\/path/);
    const permissions = run(
      "permissions",
      "list",
      "--conversation",
      conversation.id,
      "--json",
    );
    assert.equal(permissions.status, 0, permissions.stderr);
    const records = JSON.parse(permissions.stdout);
    assert.deepEqual(
      records.map((record) => record.event),
      ["permission.requested", "permission.granted"],
    );
    assert.equal(records[1].granted, true);
    assert.equal(records[1].scope, "turn");
    assert.doesNotMatch(permissions.stdout, /hidden-permission-input/);
    const missingScope = run("tools", "list", "--json");
    assert.notEqual(missingScope.status, 0);
    assert.match(missingScope.stderr, /filtre --conversation ou --project/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI reports only persisted provider usage for a project or conversation", () => {
  const dir = mkdtempSync(join(tmpdir(), "omni-usage-report-cli-"));
  const env = { ...process.env, OMNI_DATA_DIR: join(dir, "data") };
  const run = (...args) =>
    spawnSync(process.execPath, [cli, ...args], { env, encoding: "utf8" });
  try {
    const store = new ChatStore(join(dir, "data", "omni.sqlite"));
    const project = store.createProject("usage-report", dir);
    const conversation = store.createConversation(project.id, "first", "codex");
    store.appendEvent(conversation.id, "usage.updated", {
      providerId: "opencode",
      harnessId: "opencode",
      costUsd: 0.0042,
      tokens: {
        input: 1000,
        output: 120,
        reasoning: 20,
        cache: { read: 30, write: 5 },
      },
    });
    store.appendEvent(conversation.id, "usage.updated", {
      providerId: "opencode",
      costUsd: 0.001,
      tokens: {
        input: 200,
        output: 40,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
    });
    store.appendEvent(conversation.id, "routing.result", {
      providerId: "opencode",
      modelId: "provider/model-one",
      harnessId: "opencode",
      outcome: "completed",
      latencyMs: 80,
    });
    const noUsage = store.createConversation(project.id, "no usage", "codex");
    store.appendEvent(noUsage.id, "usage.updated", { providerId: "unknown" });
    store.appendEvent(noUsage.id, "routing.result", {
      providerId: "codex",
      modelId: "codex-model",
      harnessId: "codex",
      outcome: "failed",
      latencyMs: 120,
    });
    const partial = store.createConversation(
      project.id,
      "partial usage",
      "openai",
    );
    store.appendEvent(partial.id, "usage.updated", {
      providerId: "openai",
      tokens: { input: 9, output: 2 },
    });
    store.appendEvent(partial.id, "routing.result", {
      outcome: "interrupted",
    });
    store.close();

    const report = run("usage", "report", "--project", dir, "--json");
    assert.equal(report.status, 0, report.stderr);
    const result = JSON.parse(report.stdout);
    assert.equal(result.summary.eventCount, 4);
    assert.equal(result.summary.costReports, 2);
    assert.ok(Math.abs(result.summary.costUsd - 0.0052) < 1e-12);
    assert.equal(result.summary.tokenReports, 3);
    assert.deepEqual(result.summary.tokens, {
      input: 1209,
      output: 162,
      reasoning: 20,
      cacheRead: 30,
      cacheWrite: 5,
    });
    assert.deepEqual(result.summary.tokenFieldReports, {
      input: 3,
      output: 3,
      reasoning: 2,
      cacheRead: 2,
      cacheWrite: 2,
    });
    assert.equal(result.summary.routingResultCount, 3);
    assert.deepEqual(result.summary.routingOutcomes, {
      completed: 1,
      failed: 1,
      interrupted: 1,
      other: 0,
    });
    assert.equal(result.summary.latencyReports, 2);
    assert.equal(result.summary.averageLatencyMs, 100);
    assert.equal(result.events[2].costUsd, null);
    assert.equal(result.events[2].tokens, null);

    const scoped = run(
      "usage",
      "report",
      "--conversation",
      conversation.id,
      "--json",
    );
    assert.equal(scoped.status, 0, scoped.stderr);
    assert.equal(JSON.parse(scoped.stdout).summary.eventCount, 2);
    assert.equal(JSON.parse(scoped.stdout).summary.routingResultCount, 1);
    assert.equal(JSON.parse(scoped.stdout).summary.averageLatencyMs, 80);
    const partialReport = run(
      "usage",
      "report",
      "--conversation",
      partial.id,
      "--json",
    );
    assert.equal(partialReport.status, 0, partialReport.stderr);
    assert.deepEqual(JSON.parse(partialReport.stdout).summary.tokens, {
      input: 9,
      output: 2,
      reasoning: null,
      cacheRead: null,
      cacheWrite: null,
    });
    const readable = run("usage", "report", "--conversation", noUsage.id);
    assert.equal(readable.status, 0, readable.stderr);
    assert.match(readable.stdout, /Coût USD: non rapporté/);
    assert.match(readable.stdout, /Tokens: non rapportés/);
    const missingFilter = run("usage", "report");
    assert.notEqual(missingFilter.status, 0);
    assert.match(missingFilter.stderr, /--conversation ou --project/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI usage report filters usage and Auto measurements by UTC month", () => {
  const dir = mkdtempSync(join(tmpdir(), "omni-usage-month-cli-"));
  const env = { ...process.env, OMNI_DATA_DIR: join(dir, "data") };
  const run = (...args) =>
    spawnSync(process.execPath, [cli, ...args], { env, encoding: "utf8" });
  try {
    const store = new ChatStore(join(dir, "data", "omni.sqlite"));
    const project = store.createProject("monthly-usage", dir);
    const conversation = store.createConversation(
      project.id,
      "monthly",
      "openai",
    );
    const insertEvent = store.db.prepare(
      "INSERT INTO conversation_events VALUES (?, ?, ?, ?, ?)",
    );
    insertEvent.run(
      "usage-january",
      conversation.id,
      "usage.updated",
      JSON.stringify({
        providerId: "openai",
        costUsd: 0.25,
        tokens: { input: 10, output: 4 },
      }),
      "2025-01-31T23:59:59.999Z",
    );
    insertEvent.run(
      "routing-january",
      conversation.id,
      "routing.result",
      JSON.stringify({ outcome: "completed", latencyMs: 25 }),
      "2025-01-31T23:59:59.999Z",
    );
    insertEvent.run(
      "usage-february",
      conversation.id,
      "usage.updated",
      JSON.stringify({
        providerId: "openai",
        costUsd: 0.5,
        tokens: { input: 20, output: 8 },
      }),
      "2025-02-01T00:00:00.000Z",
    );
    insertEvent.run(
      "routing-february",
      conversation.id,
      "routing.result",
      JSON.stringify({ outcome: "failed", latencyMs: 100 }),
      "2025-02-01T00:00:00.000Z",
    );
    store.close();

    const january = run(
      "usage",
      "report",
      "--project",
      dir,
      "--month",
      "2025-01",
      "--json",
    );
    assert.equal(january.status, 0, january.stderr);
    const report = JSON.parse(january.stdout);
    assert.equal(report.month, "2025-01");
    assert.equal(report.summary.eventCount, 1);
    assert.equal(report.summary.costUsd, 0.25);
    assert.deepEqual(report.summary.tokens, {
      input: 10,
      output: 4,
      reasoning: null,
      cacheRead: null,
      cacheWrite: null,
    });
    assert.equal(report.summary.routingResultCount, 1);
    assert.equal(report.summary.routingOutcomes.completed, 1);
    assert.equal(report.summary.averageLatencyMs, 25);
    assert.equal(report.routing[0].createdAt, "2025-01-31T23:59:59.999Z");

    const invalid = run(
      "usage",
      "report",
      "--conversation",
      conversation.id,
      "--month",
      "2025-13",
    );
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /--month doit respecter YYYY-MM/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI searches persisted conversation titles and messages with project filtering", () => {
  const dir = mkdtempSync(join(tmpdir(), "omni-search-cli-"));
  const env = { ...process.env, OMNI_DATA_DIR: join(dir, "data") };
  const run = (...args) =>
    spawnSync(process.execPath, [cli, ...args], { env, encoding: "utf8" });
  try {
    const store = new ChatStore(join(dir, "data", "omni.sqlite"));
    const project = store.createProject("search-cli", dir);
    const conversation = store.createConversation(
      project.id,
      "title with a 100%_ token",
      "codex",
    );
    store.addMessage(conversation.id, "user", "Persisted unique phrase");
    const otherProject = store.createProject("other-project");
    const other = store.createConversation(
      otherProject.id,
      "elsewhere",
      "codex",
    );
    store.addMessage(other.id, "user", "Persisted unique phrase");
    store.close();

    const results = run(
      "conversation",
      "search",
      "--query",
      "unique phrase",
      "--project",
      dir,
      "--json",
    );
    assert.equal(results.status, 0, results.stderr);
    assert.deepEqual(
      JSON.parse(results.stdout).map((result) => result.id),
      [conversation.id],
    );
    assert.equal(JSON.parse(results.stdout)[0].match, "message");
    const literalWildcard = run(
      "conversation",
      "search",
      "--query",
      "%_ token",
      "--project",
      dir,
      "--json",
    );
    assert.equal(literalWildcard.status, 0, literalWildcard.stderr);
    assert.equal(JSON.parse(literalWildcard.stdout)[0].id, conversation.id);
    const missingQuery = run("conversation", "search", "--project", dir);
    assert.notEqual(missingQuery.status, 0);
    assert.match(missingQuery.stderr, /--query TEXT/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test(
  "real provider registry refreshes OAuth catalogs and Auto excludes a disabled model",
  { skip: process.env.OMNI_LIVE_PROVIDER_REGISTRY_TESTS !== "1" },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "omni-live-provider-cli-"));
    const env = { ...process.env, OMNI_DATA_DIR: join(dir, "data") };
    const run = (args, overrides = {}) =>
      spawnSync(process.execPath, [cli, ...args], {
        env: { ...env, ...overrides },
        encoding: "utf8",
      });
    try {
      const refreshed = run(["providers", "refresh", "--json"]);
      assert.equal(refreshed.status, 0, refreshed.stderr);
      const providers = JSON.parse(refreshed.stdout);
      const codex = providers.find(
        (provider) =>
          provider.providerId === "codex" &&
          provider.authStatus === "connected" &&
          provider.modelCount > 0,
      );
      assert.ok(codex, "A real Codex OAuth catalog must be available");
      const listed = run(["models", "list", "--provider", "codex"]);
      assert.equal(listed.status, 0, listed.stderr);
      const model = listed.stdout.trim().split("\n")[0];
      assert.ok(model);
      const disabled = run([
        "models",
        "disable",
        "--provider",
        "codex",
        "--model",
        model,
        "--auto-only",
      ]);
      assert.equal(disabled.status, 0, disabled.stderr);
      const projectPath = join(dir, "project");
      const project = run([
        "project",
        "create",
        "--name",
        "registry-live",
        "--path",
        projectPath,
      ]);
      assert.equal(project.status, 0, project.stderr);
      const attempted = run(
        [
          "run",
          "--project",
          projectPath,
          "--auto",
          "Reply with ROUTER_SHOULD_NOT_RUN only.",
        ],
        { OMNI_AUTO_MODELS: `codex:${model}` },
      );
      assert.notEqual(attempted.status, 0);
      assert.match(
        attempted.stderr,
        /No compatible enabled model\/harness candidate/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "real harness registry initializes OAuth harnesses without running a task and Auto excludes a disabled harness",
  { skip: process.env.OMNI_LIVE_HARNESS_REGISTRY_TESTS !== "1" },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "omni-live-harness-cli-"));
    const env = { ...process.env, OMNI_DATA_DIR: join(dir, "data") };
    const run = (args, overrides = {}) =>
      spawnSync(process.execPath, [cli, ...args], {
        env: { ...env, ...overrides },
        encoding: "utf8",
      });
    try {
      const refreshedProviders = run(["providers", "refresh", "--json"]);
      assert.equal(refreshedProviders.status, 0, refreshedProviders.stderr);
      const refreshed = run(["harnesses", "refresh", "--json"]);
      assert.equal(refreshed.status, 0, refreshed.stderr);
      const harnesses = JSON.parse(refreshed.stdout);
      for (const id of ["codex", "claude-code"]) {
        const harness = harnesses.find((entry) => entry.id === id);
        assert.ok(harness, `${id} should be registered from its real adapter`);
        assert.equal(harness.status, "connected");
        assert.equal(harness.available, true);
        assert.equal(harness.capabilities.streaming, true);
        assert.equal(harness.capabilities.permissions, true);
      }
      const codexModels = run(["models", "list", "--provider", "codex"]);
      assert.equal(codexModels.status, 0, codexModels.stderr);
      const model = codexModels.stdout.trim().split("\n")[0];
      const disabled = run(["harnesses", "disable", "--harness", "codex"]);
      assert.equal(disabled.status, 0, disabled.stderr);
      const projectPath = join(dir, "project");
      const project = run([
        "project",
        "create",
        "--name",
        "harness-live",
        "--path",
        projectPath,
      ]);
      assert.equal(project.status, 0, project.stderr);
      const routed = run(
        [
          "run",
          "--project",
          projectPath,
          "--auto",
          "Write a file in this project.",
        ],
        { OMNI_AUTO_MODELS: `codex:${model}` },
      );
      assert.notEqual(routed.status, 0);
      assert.match(
        routed.stderr,
        /No compatible enabled model\/harness candidate/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "real Omni run --json streams versioned events and persists the completed conversation",
  { skip: process.env.OMNI_LIVE_CLI_JSON_TESTS !== "1", timeout: 90000 },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "omni-live-cli-json-"));
    const dataDir = join(dir, "omni-data");
    const env = { ...process.env, OMNI_DATA_DIR: dataDir };
    const run = (...args) =>
      spawnSync(process.execPath, [cli, ...args], {
        cwd: dir,
        env,
        encoding: "utf8",
        timeout: 80000,
      });
    let store;
    try {
      const projectPath = join(dir, "project");
      mkdirSync(projectPath);
      const project = run(
        "project",
        "create",
        "--name",
        "JSONL live",
        "--path",
        projectPath,
      );
      assert.equal(project.status, 0, project.stderr);
      const result = run(
        "run",
        "--project",
        projectPath,
        "--model",
        process.env.OMNI_LIVE_CLI_JSON_MODEL ?? "codex",
        "--json",
        "Reply with exactly: OMNI_JSONL_REAL_OK",
      );
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.doesNotMatch(result.stdout, /sk-[A-Za-z0-9_-]{12,}|Bearer\s+\S+/);
      const events = result.stdout
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      assert.ok(events.every((event) => event.version === 1));
      assert.equal(events[0].type, "run.started");
      assert.ok(events.some((event) => event.type === "message.delta"));
      assert.equal(events.at(-1).type, "run.completed");
      assert.match(
        events
          .filter((event) => event.type === "message.delta")
          .map((event) => event.delta)
          .join(""),
        /OMNI_JSONL_REAL_OK/,
      );
      store = new ChatStore(join(dataDir, "omni.sqlite"));
      const conversation = store.conversation(events[0].conversationId);
      assert.equal(conversation.status, "completed");
      assert.match(conversation.messages.at(-1).content, /OMNI_JSONL_REAL_OK/);
    } finally {
      store?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "real Omni run --json preserves partial output and exits 130 after SIGINT",
  { skip: process.env.OMNI_LIVE_CLI_JSON_TESTS !== "1", timeout: 90000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "omni-live-cli-json-interrupt-"));
    const dataDir = join(dir, "omni-data");
    const env = { ...process.env, OMNI_DATA_DIR: dataDir };
    const run = (...args) =>
      spawnSync(process.execPath, [cli, ...args], {
        cwd: dir,
        env,
        encoding: "utf8",
        timeout: 10000,
      });
    let store;
    let child;
    try {
      const projectPath = join(dir, "project");
      const project = run(
        "project",
        "create",
        "--name",
        "JSONL interrupt",
        "--path",
        projectPath,
      );
      assert.equal(project.status, 0, project.stderr);
      child = spawn(
        process.execPath,
        [
          cli,
          "run",
          "--project",
          projectPath,
          "--model",
          process.env.OMNI_LIVE_CLI_JSON_MODEL ?? "codex",
          "--json",
          "Write a detailed 700-word explanation of photosynthesis.",
        ],
        { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] },
      );
      let stdoutText = "";
      let stderrText = "";
      let sentInterrupt = false;
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdoutText += chunk;
        if (!sentInterrupt) {
          const lines = stdoutText.split("\n");
          if (
            lines.some((line) => {
              try {
                return JSON.parse(line).type === "message.delta";
              } catch {
                return false;
              }
            })
          ) {
            sentInterrupt = true;
            child.kill("SIGINT");
          }
        }
      });
      child.stderr.on("data", (chunk) => (stderrText += chunk));
      const exit = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error("JSONL interrupt test timed out"));
        }, 70000);
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once("close", (code, signal) => {
          clearTimeout(timer);
          resolve({ code, signal });
        });
      });
      child = null;
      assert.equal(
        sentInterrupt,
        true,
        "a streamed delta should precede SIGINT",
      );
      assert.equal(exit.code, 130, stderrText);
      assert.equal(exit.signal, null);
      assert.equal(stderrText, "");
      const events = stdoutText
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      assert.equal(events.at(-1).type, "run.interrupted");
      assert.ok(events.some((event) => event.type === "message.delta"));
      store = new ChatStore(join(dataDir, "omni.sqlite"));
      const conversation = store.conversation(
        events.find((event) => event.type === "run.started").conversationId,
      );
      assert.equal(conversation.status, "interrupted");
      assert.equal(conversation.messages.at(-1).status, "interrupted");
      assert.ok(conversation.messages.at(-1).content.length > 0);
    } finally {
      if (child && !child.killed) child.kill("SIGKILL");
      store?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "real Omni run --json records a denied tool permission without writing the file",
  { skip: process.env.OMNI_LIVE_CLI_JSON_TESTS !== "1", timeout: 90000 },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "omni-live-cli-json-permission-"));
    const dataDir = join(dir, "omni-data");
    const env = { ...process.env, OMNI_DATA_DIR: dataDir };
    const run = (...args) =>
      spawnSync(process.execPath, [cli, ...args], {
        cwd: dir,
        env,
        encoding: "utf8",
        timeout: 80000,
      });
    let store;
    try {
      const projectPath = join(dir, "project");
      mkdirSync(projectPath);
      const project = run(
        "project",
        "create",
        "--name",
        "JSONL permission",
        "--path",
        projectPath,
      );
      assert.equal(project.status, 0, project.stderr);
      const filePath = join(projectPath, "must-not-exist.txt");
      const result = run(
        "run",
        "--project",
        projectPath,
        "--model",
        "codex",
        "--harness",
        "codex",
        "--json",
        `Create ${filePath} with the exact text DENIED. Do not use any other tool.`,
      );
      assert.equal(result.status, 0, result.stderr);
      const events = result.stdout
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const requestedIndex = events.findIndex(
        (event) => event.type === "permission.requested",
      );
      const deniedIndex = events.findIndex(
        (event) => event.type === "permission.denied",
      );
      assert.ok(requestedIndex >= 0);
      assert.ok(deniedIndex > requestedIndex);
      assert.equal(
        events.some((event) => event.type === "permission.granted"),
        false,
      );
      assert.equal(existsSync(filePath), false);
      assert.ok(events.every((event) => !("input" in event)));
      assert.doesNotMatch(result.stdout, /sk-[A-Za-z0-9_-]{12,}|Bearer\s+\S+/);
      store = new ChatStore(join(dataDir, "omni.sqlite"));
      const conversation = store.conversation(
        events.find((event) => event.type === "run.started").conversationId,
      );
      assert.ok(
        store
          .listEvents(conversation.id)
          .some((event) => event.type === "permission.denied"),
      );
    } finally {
      store?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
