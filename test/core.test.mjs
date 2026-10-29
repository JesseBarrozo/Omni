import test from "node:test";
import assert from "node:assert/strict";
import {
  EventStore,
  ConversationManager,
  PermissionManager,
  ModelRegistry,
  AutoRouter,
  SwapCoordinator,
  ExecutionCoordinator,
  redactSecrets,
} from "../src/core.mjs";
import { assertHarnessAdapter } from "../src/adapters.mjs";
import { MockHarnessAdapter } from "../test-fixtures/mock-harness-adapter.mjs";
import * as productionAdapters from "../src/adapters.mjs";

test("conversation events are append-only and exportable", async () => {
  const events = new EventStore();
  const conversations = new ConversationManager({ events });
  const conversation = conversations.createConversation("project-1", "Test");
  conversations.addMessage(conversation.id, "user", "Implement the feature");
  assert.equal(
    conversations.exportConversation(conversation.id).events.length,
    1,
  );
  assert.equal(events.all()[0].type, "message.created");
});

test("permissions expire and are logged", () => {
  const events = new EventStore();
  const permissions = new PermissionManager({ events, defaultTtlMs: 1000 });
  const request = permissions.request({
    conversationId: "c",
    projectId: "p",
    tool: "terminal",
    action: "execute",
  });
  permissions.decide(request, true);
  assert.equal(permissions.can(request), true);
  assert.equal(
    events
      .all()
      .map((event) => event.type)
      .join(","),
    "permission.requested,permission.granted",
  );
});

test("Auto Router only selects enabled compatible candidates and explains choice", () => {
  const registry = new ModelRegistry();
  registry.registerProvider({ id: "local", name: "Local" });
  registry.registerProvider({ id: "cloud", name: "Cloud" });
  registry.registerModel({
    id: "local-small",
    providerId: "local",
    name: "Local Small",
    quality: 0.55,
    latency: 0.2,
    capabilities: { tools: true },
    pricing: { inputPerMillion: 0 },
  });
  registry.registerModel({
    id: "cloud-large",
    providerId: "cloud",
    name: "Cloud Large",
    quality: 0.95,
    latency: 0.6,
    capabilities: { tools: true },
    pricing: { inputPerMillion: 5 },
  });
  registry.registerHarness({
    id: "agent",
    name: "Agent",
    capabilities: { tools: true },
    privacyApproved: true,
  });
  registry.setModelEnabled("cloud-large", false);
  const decision = new AutoRouter(registry, {
    profile: "local-first",
    privacyMode: true,
  }).select({ prompt: "run tests" });
  assert.equal(decision.selected.modelId, "local-small");
  assert.match(decision.explanation, /Mode Auto/);
});

test("swap creates a checkpoint and refuses an active run", async () => {
  const events = new EventStore();
  const conversations = new ConversationManager({ events });
  const c = conversations.createConversation("p");
  conversations.addMessage(c.id, "user", "Continue task");
  const adapter = new MockHarnessAdapter({ id: "next", events });
  const swap = new SwapCoordinator({
    events,
    conversations,
    adapters: new Map([["next", adapter]]),
  });
  const checkpoint = await swap.swap({
    conversationId: c.id,
    fromHarnessId: "first",
    toHarnessId: "next",
  });
  assert.equal(checkpoint.state, "safe-boundary");
  assert.equal(events.all().at(-1).type, "harness.changed");
  conversations.setStatus(c.id, "running");
  await assert.rejects(
    () =>
      swap.swap({
        conversationId: c.id,
        fromHarnessId: "next",
        toHarnessId: "first",
      }),
    /active/,
  );
});

test("adapter contract and secret redaction are safe defaults", () => {
  assert.equal("MockHarnessAdapter" in productionAdapters, false);
  assertHarnessAdapter(new MockHarnessAdapter());
  assert.deepEqual(redactSecrets({ key: "sk-12345678901234567890" }), {
    key: "[REDACTED]",
  });
});

test("execution coordinator persists a streamed run", async () => {
  const events = new EventStore();
  const conversations = new ConversationManager({ events });
  const c = conversations.createConversation("p");
  const adapter = new MockHarnessAdapter({ events });
  const execution = new ExecutionCoordinator({ events, conversations });
  await execution.run({ conversationId: c.id, adapter, prompt: "say hello" });
  assert.equal(conversations.get(c.id).status, "idle");
  assert.equal(events.list(c.id, "session.completed").length, 1);
  assert.equal(events.list(c.id, "message.delta").length > 0, true);
});
