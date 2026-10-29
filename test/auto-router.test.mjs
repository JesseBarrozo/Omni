import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ChatStore } from "../src/chat-store.mjs";
import { AutoRouter, ModelRegistry } from "../src/core.mjs";
import { ClaudeCodeChat, claudeAuthStatus } from "../src/claude-code.mjs";
import { CodexChat, codexAuthStatus } from "../src/codex-chat.mjs";

function registryFixture() {
  const registry = new ModelRegistry();
  registry.registerProvider({ id: "codex", name: "Codex" });
  registry.registerProvider({ id: "claude", name: "Claude" });
  registry.registerModel({ id: "codex-model", providerId: "codex" });
  registry.registerModel({ id: "claude-model", providerId: "claude" });
  registry.registerHarness({
    id: "codex-harness",
    providerIds: ["codex"],
    capabilities: { tools: true },
    privacyApproved: false,
  });
  registry.registerHarness({
    id: "claude-harness",
    providerIds: ["claude"],
    capabilities: { tools: true },
    privacyApproved: true,
  });
  registry.registerHarness({
    id: "codex-chat",
    providerIds: ["codex"],
    capabilities: { tools: "read-only" },
    privacyApproved: false,
  });
  registry.registerHarness({
    id: "claude-chat",
    providerIds: ["claude"],
    capabilities: { tools: false },
    privacyApproved: false,
  });
  return registry;
}

test("AutoRouter deterministically chooses only enabled, compatible, approved candidates", () => {
  const router = new AutoRouter(registryFixture(), {
    privacyMode: true,
    preferredProviders: ["claude", "codex"],
  });
  const first = router.select({
    prompt: "Implement a feature",
    needsTools: true,
  });
  const second = router.select({
    prompt: "Implement a feature",
    needsTools: true,
  });
  assert.equal(first.selected.providerId, "claude");
  assert.equal(first.selected.harnessId, "claude-harness");
  assert.deepEqual(first.selected, second.selected);
  assert.ok(
    first.evaluatedCandidates.some((candidate) =>
      candidate.exclusions.includes("privacy-not-approved"),
    ),
  );
  assert.ok(
    first.evaluatedCandidates.some(
      (candidate) =>
        candidate.key === "codex/codex-model/codex-chat" &&
        candidate.exclusions.includes("required-tools-unsupported"),
    ),
  );
  assert.ok(
    first.criteria.ranking.some((criterion) =>
      criterion.includes("stable tie-break"),
    ),
  );
  assert.equal("score" in first.candidates[0], false);
});

test("AutoRouter records the next real eligible candidate as fallback", () => {
  const decision = new AutoRouter(registryFixture()).select({
    prompt: "Answer",
    needsTools: true,
  });
  assert.ok(decision.fallback);
  assert.ok(
    decision.candidates.some(
      (candidate) =>
        candidate.providerId === decision.fallback.providerId &&
        candidate.modelId === decision.fallback.modelId &&
        candidate.harnessId === decision.fallback.harnessId,
    ),
  );
});

test("AutoRouter chooses the least-capability chat adapter when tools are unnecessary", () => {
  const registry = registryFixture();
  const leastPrivilegeDecision = new AutoRouter(registry).select({
    prompt: "What is two plus two?",
  });
  assert.equal(leastPrivilegeDecision.selected.harnessId, "claude-chat");

  const decision = new AutoRouter(registry, {
    preferredProviders: ["codex", "claude"],
  }).select({ prompt: "What is two plus two?" });
  assert.equal(decision.criteria.task.needsTools, false);
  assert.equal(decision.selected.providerId, "codex");
  assert.equal(decision.selected.harnessId, "codex-chat");
  assert.ok(
    decision.criteria.ranking.some((criterion) =>
      criterion.includes("least-privilege capability fit"),
    ),
  );
  const toolCandidate = decision.evaluatedCandidates.find(
    (candidate) => candidate.key === "codex/codex-model/codex-harness",
  );
  assert.equal(toolCandidate.eligible, true);
  const chatCandidate = decision.evaluatedCandidates.find(
    (candidate) => candidate.key === "codex/codex-model/codex-chat",
  );
  assert.equal(chatCandidate.eligible, true);
});

test("AutoRouter excludes unknown prices under a configured cost ceiling and records fallback", () => {
  const registry = registryFixture();
  [...registry.models.values()].find(
    (model) => model.id === "codex-model",
  ).pricing = { inputPerMillion: 1 };
  [...registry.models.values()].find(
    (model) => model.id === "claude-model",
  ).pricing = { inputPerMillion: 2 };
  const decision = new AutoRouter(registry, {
    maxInputPerMillion: 3,
    excludedProviders: ["claude"],
  }).select({ prompt: "Answer", needsTools: true });
  assert.equal(decision.selected.providerId, "codex");
  assert.equal(decision.fallback, null);
  assert.ok(
    decision.evaluatedCandidates.some((candidate) =>
      candidate.exclusions.includes("provider-excluded-by-policy"),
    ),
  );
  const noKnownPrice = new AutoRouter(registryFixture(), {
    maxInputPerMillion: 3,
  }).evaluate({ prompt: "Answer", needsTools: true });
  assert.ok(
    noKnownPrice.evaluated.some((candidate) =>
      candidate.exclusions.includes("input-price-unknown"),
    ),
  );
});

test("ModelRegistry preserves identical model IDs from different providers", () => {
  const registry = new ModelRegistry();
  registry.registerProvider({ id: "codex" });
  registry.registerProvider({ id: "openai" });
  registry.registerModel({ id: "gpt-shared", providerId: "codex" });
  registry.registerModel({ id: "gpt-shared", providerId: "openai" });
  registry.registerHarness({
    id: "codex-chat",
    providerIds: ["codex"],
    capabilities: { tools: false },
  });
  registry.registerHarness({
    id: "openai-chat",
    providerIds: ["openai"],
    capabilities: { tools: false },
  });

  const decision = new AutoRouter(registry, {
    preferredProviders: ["codex", "openai"],
  }).select({ prompt: "Reply with one word" });

  assert.equal(decision.selected.providerId, "codex");
  assert.deepEqual(
    decision.candidates.map(({ providerId, modelId }) => ({
      providerId,
      modelId,
    })),
    [
      { providerId: "codex", modelId: "gpt-shared" },
      { providerId: "openai", modelId: "gpt-shared" },
    ],
  );
  assert.throws(
    () => registry.setModelEnabled("gpt-shared", false),
    /ambiguous across providers/,
  );
});

test("previous real outcomes are used only when present and recorded in decision evidence", () => {
  const registry = registryFixture();
  const key = "codex/codex-model/codex-harness";
  const decision = new AutoRouter(registry, {
    previousResults: {
      [key]: { attempts: 2, successes: 2, averageLatencyMs: 100 },
    },
  }).select({ prompt: "Answer", needsTools: true });
  assert.equal(decision.selected.providerId, "codex");
  const candidate = decision.evaluatedCandidates.find(
    (item) => item.key === key,
  );
  assert.equal(candidate.previous.successes, 2);
  assert.equal(candidate.observedLatencyMs, 100);
});

test("routing results are queryable across conversations for future decisions", () => {
  const dir = mkdtempSync(join(tmpdir(), "omni-router-history-"));
  const store = new ChatStore(join(dir, "omni.sqlite"));
  try {
    const project = store.createProject("History", dir);
    const first = store.createConversation(project.id, "First", "codex");
    const second = store.createConversation(project.id, "Second", "claude");
    store.appendEvent(first.id, "routing.result", {
      candidateKey: "codex/model/codex",
      outcome: "completed",
      latencyMs: 80,
    });
    store.appendEvent(second.id, "routing.result", {
      candidateKey: "claude/model/claude-code",
      outcome: "failed",
      latencyMs: 120,
    });
    const results = store.routingResults();
    assert.deepEqual(
      new Set(results.map((event) => event.payload.candidateKey)),
      new Set(["codex/model/codex", "claude/model/claude-code"]),
    );
    assert.throws(() => store.routingResults(0), /entre 1 et 10000/);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test(
  "real omni run --auto queries authenticated catalogs, executes a real model, and persists its route and result",
  { skip: process.env.OMNI_LIVE_AUTO_TESTS !== "1" },
  async () => {
    assert.ok(
      codexAuthStatus().authenticated || claudeAuthStatus().authenticated,
      "At least one official OAuth account must be connected",
    );
    const dir = mkdtempSync(join(tmpdir(), "omni-live-auto-"));
    const dataDir = join(dir, "omni-data");
    const dbPath = join(dataDir, "omni.sqlite");
    let store;
    try {
      store = new ChatStore(dbPath);
      store.createProject("Live Auto", dir);
      const claudeModels = claudeAuthStatus().authenticated
        ? await new ClaudeCodeChat({ store, cwd: dir }).listModels()
        : [];
      const codexModels = codexAuthStatus().authenticated
        ? await new CodexChat({ store, cwd: dir }).listModels()
        : [];
      const claudeModel = claudeModels.find((model) =>
        /^claude-(?:haiku|sonnet|opus)-\d/.test(model),
      );
      const codexModel = codexModels.find((model) => model !== "default");
      const preferredProvider = codexModel ? "codex" : "claude";
      const routedModel = codexModel
        ? `codex:${codexModel}`
        : claudeModel
          ? `claude:${claudeModel}`
          : null;
      assert.ok(
        routedModel,
        "An authenticated real model catalog must be non-empty",
      );
      store.close();
      store = null;
      const cli = fileURLToPath(new URL("../bin/omni.mjs", import.meta.url));
      const result = spawnSync(
        process.execPath,
        [
          cli,
          "run",
          "--auto",
          "--project",
          dir,
          "Reply with AUTO_ROUTE_OK only.",
        ],
        {
          cwd: dir,
          encoding: "utf8",
          timeout: 120_000,
          env: {
            ...process.env,
            OMNI_DATA_DIR: dataDir,
            OMNI_AUTO_MODELS: routedModel,
            OMNI_AUTO_PREFERRED_PROVIDERS: preferredProvider,
          },
        },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /AUTO_ROUTE_OK/);
      assert.match(result.stdout, /Auto:/);
      assert.doesNotMatch(
        `${result.stdout}${result.stderr}`,
        /sk-[A-Za-z0-9_-]{12,}|Bearer\s+\S+/,
      );
      store = new ChatStore(dbPath);
      const conversation = store.conversations(store.projects()[0].id)[0];
      const events = store.listEvents(conversation.id);
      const decision = events.find(
        (event) => event.type === "routing.decision",
      );
      const outcome = events.find((event) => event.type === "routing.result");
      assert.ok(decision);
      assert.ok(
        decision.payload.checkedProviders.some(
          (provider) => provider.authenticated,
        ),
      );
      assert.ok(decision.payload.candidates.length > 0);
      assert.equal(decision.payload.selected.providerId, preferredProvider);
      assert.match(decision.payload.selected.harnessId, /-chat$/);
      assert.ok(
        decision.payload.evaluatedCandidates.length >=
          decision.payload.candidates.length,
      );
      assert.equal(outcome.payload.outcome, "completed");
      assert.equal(outcome.payload.automaticallyRetried, undefined);
    } finally {
      store?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "real omni run --auto falls back after a Codex preflight failure and executes Claude once",
  { skip: process.env.OMNI_LIVE_AUTO_FALLBACK_TESTS !== "1" },
  async () => {
    assert.equal(
      codexAuthStatus().authenticated,
      true,
      "The Codex OAuth account must be connected for this fallback test",
    );
    assert.equal(
      claudeAuthStatus().authenticated,
      true,
      "The Claude OAuth account must be connected for this fallback test",
    );
    const dir = mkdtempSync(join(tmpdir(), "omni-live-auto-fallback-"));
    const dataDir = join(dir, "omni-data");
    const dbPath = join(dataDir, "omni.sqlite");
    let store;
    try {
      store = new ChatStore(dbPath);
      store.createProject("Live Auto Fallback", dir);
      const claudeModels = await new ClaudeCodeChat({
        store,
        cwd: dir,
      }).listModels();
      const codexModels = await new CodexChat({ store, cwd: dir }).listModels();
      const claudeModel = claudeModels.find((model) =>
        /^claude-(?:haiku|sonnet|opus)-\d/.test(model),
      );
      const codexModel = codexModels.find((model) => model !== "default");
      assert.ok(claudeModel, "A concrete Claude model must be available");
      assert.ok(codexModel, "A concrete Codex model must be available");
      store.close();
      store = null;
      const cli = fileURLToPath(new URL("../bin/omni.mjs", import.meta.url));
      const result = spawnSync(
        process.execPath,
        [
          cli,
          "run",
          "--auto",
          "--project",
          dir,
          "Do not execute anything or use tools; reply with AUTO_PREFLIGHT_FALLBACK_OK only.",
        ],
        {
          cwd: dir,
          encoding: "utf8",
          timeout: 120_000,
          env: {
            ...process.env,
            OMNI_DATA_DIR: dataDir,
            OMNI_AUTO_MODELS: "codex:" + codexModel + ",claude:" + claudeModel,
            OMNI_AUTO_PREFERRED_PROVIDERS: "codex,claude",
            OMNI_CODEX_HARNESS_EXECUTABLE: join(dir, "missing-codex-cli"),
          },
        },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /choix de secours claude\//);
      assert.match(result.stdout, /AUTO_PREFLIGHT_FALLBACK_OK/);
      assert.doesNotMatch(
        result.stdout + result.stderr,
        /sk-[A-Za-z0-9_-]{12,}|Bearer\s+\S+/,
      );
      store = new ChatStore(dbPath);
      const conversation = store.conversations(store.projects()[0].id)[0];
      const events = store.listEvents(conversation.id);
      const decision = events.find(
        (event) => event.type === "routing.decision",
      );
      const fallback = events.find(
        (event) => event.type === "routing.fallback",
      );
      const outcome = events.find((event) => event.type === "routing.result");
      assert.equal(decision.payload.selected.providerId, "codex");
      assert.equal("prompt" in decision.payload, false);
      assert.equal(fallback.payload.from.providerId, "codex");
      assert.equal(fallback.payload.to.providerId, "claude");
      assert.match(
        fallback.payload.reason,
        /preflight-failed-before-turn-start/,
      );
      assert.equal(fallback.payload.promptPersisted, false);
      assert.equal(fallback.payload.taskStarted, false);
      assert.equal(fallback.payload.automaticallyRetried, false);
      assert.equal(outcome.payload.providerId, "claude");
      assert.equal(outcome.payload.outcome, "completed");
      assert.equal(
        events.filter((event) => event.type === "message.created").length,
        2,
      );
      assert.equal(
        events.filter((event) => event.type === "routing.fallback").length,
        1,
      );
      assert.equal(
        events.filter((event) => event.type === "tool.started").length,
        0,
      );
      const startedSessions = events.filter(
        (event) => event.type === "session.started" && event.payload.harnessId,
      );
      assert.ok(startedSessions.length > 0, "The Claude session must start");
      assert.ok(
        startedSessions.every(
          (event) => event.payload.harnessId === "claude-code",
        ),
        JSON.stringify(startedSessions),
      );
    } finally {
      store?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
