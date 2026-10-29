import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ChatStore } from "../src/chat-store.mjs";

const cli = fileURLToPath(new URL("../bin/omni.mjs", import.meta.url));

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
    assert.match(resumed.stderr, /OPENAI_API_KEY est requis/);
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
