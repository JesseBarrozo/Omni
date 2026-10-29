import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatStore } from "../src/chat-store.mjs";
import { OpenAIChat } from "../src/openai-chat.mjs";
import { runChatTurn } from "../src/chat-runner.mjs";
import { redactSecrets } from "../src/core.mjs";

test("projects and partial/completed conversation messages survive database reopen", () => {
  const dir = mkdtempSync(join(tmpdir(), "omni-chat-"));
  const file = join(dir, "db.sqlite");
  let db = new ChatStore(file);
  const project = db.createProject("demo", dir);
  const conversation = db.createConversation(
    project.id,
    "Persistent",
    "model-listed-by-user",
  );
  db.addMessage(conversation.id, "user", "hello");
  const assistantId = db.addMessage(
    conversation.id,
    "assistant",
    "part",
    "interrupted",
  );
  db.close();
  db = new ChatStore(file);
  assert.equal(
    db.db
      .prepare(
        "SELECT count(*) AS count FROM schema_migrations WHERE version = 1",
      )
      .get().count,
    1,
  );
  assert.equal(db.project(dir).id, project.id);
  assert.equal(db.conversation(conversation.id).messages[1].content, "part");
  assert.equal(
    db.conversation(conversation.id).modelId,
    "model-listed-by-user",
  );
  db.setModel(conversation.id, "model-selected-for-resume");
  assert.equal(
    db.conversation(conversation.id).modelId,
    "model-selected-for-resume",
  );
  db.setMessage(assistantId, "answer", "completed");
  assert.equal(db.count().messages, 2);
  const exported = db.exportConversation(conversation.id);
  assert.ok(
    exported.events.some((event) => event.type === "message.completed"),
  );
  assert.ok(exported.events.some((event) => event.type === "message.revised"));
  assert.ok(exported.events.some((event) => event.type === "model.changed"));
  const imported = db.importConversation(exported, { projectId: project.id });
  assert.notEqual(imported.id, conversation.id);
  assert.deepEqual(
    imported.messages.map(({ role, content, status }) => ({
      role,
      content,
      status,
    })),
    db
      .conversation(conversation.id)
      .messages.map(({ role, content, status }) => ({ role, content, status })),
  );
  assert.throws(
    () =>
      db.importConversation(
        {
          ...exported,
          events: [
            ...exported.events,
            {
              ...exported.events[0],
              id: "unexpected",
              type: "unregistered.event",
            },
          ],
        },
        { projectId: project.id },
      ),
    /Type d’événement Omni inconnu/,
  );
  assert.equal(db.count().conversations, 2);
  assert.throws(
    () =>
      db.db
        .prepare(
          "UPDATE conversation_events SET type = 'rewritten' WHERE id = ?",
        )
        .run(exported.events[0].id),
    /append-only/,
  );
  assert.throws(
    () =>
      db.db
        .prepare("DELETE FROM conversation_events WHERE id = ?")
        .run(exported.events[0].id),
    /append-only/,
  );
  db.close();
  db = new ChatStore(file);
  assert.equal(
    db.db.prepare("SELECT count(*) AS count FROM schema_migrations").get()
      .count,
    3,
  );
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("provider and model catalogs persist preferences and mark stale models unavailable", () => {
  const dir = mkdtempSync(join(tmpdir(), "omni-registry-"));
  const file = join(dir, "db.sqlite");
  let store = new ChatStore(file);
  assert.equal(
    store.db.prepare("SELECT max(version) version FROM schema_migrations").get()
      .version,
    3,
  );
  assert.deepEqual(
    store.db
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all()
      .map(({ version }) => version),
    [1, 2, 3],
  );
  store.saveProviderCatalog({
    providerId: "codex",
    name: "Codex OAuth",
    authStatus: "connected",
    models: ["model-a", "model-b"],
  });
  store.setProviderEnabled("codex", false);
  store.setModelEnabled("codex", "model-a", false, { autoOnly: true });
  store.close();

  store = new ChatStore(file);
  assert.equal(store.providerRegistry()[0].enabled, false);
  assert.equal(store.modelRegistry("codex")[0].enabledForAuto, false);
  store.saveProviderCatalog({
    providerId: "codex",
    name: "Codex OAuth",
    authStatus: "connected",
    models: ["model-a"],
  });
  const models = store.modelRegistry("codex");
  assert.equal(models.find((model) => model.id === "model-a").available, true);
  assert.equal(
    models.find((model) => model.id === "model-a").enabledForAuto,
    false,
  );
  assert.equal(models.find((model) => model.id === "model-b").available, false);
  assert.throws(
    () => store.setProviderEnabled("unknown", false),
    /Fournisseur inconnu/,
  );
  assert.throws(
    () => store.setModelEnabled("codex", "unknown", false),
    /Modèle inconnu/,
  );
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

test("harness registry persists real adapter metadata and enabled state", () => {
  const dir = mkdtempSync(join(tmpdir(), "omni-harness-registry-"));
  const file = join(dir, "db.sqlite");
  let store = new ChatStore(file);
  store.saveHarnessRegistry({
    id: "codex",
    name: "Codex app-server",
    providerId: "codex",
    integration: "Codex app-server JSON-RPC",
    status: "connected",
    available: true,
    capabilities: { streaming: true, tools: true, permissions: true },
  });
  store.setHarnessEnabled("codex", false);
  store.close();

  store = new ChatStore(file);
  const [harness] = store.harnessRegistry();
  assert.equal(harness.status, "connected");
  assert.equal(harness.available, true);
  assert.equal(harness.enabled, false);
  assert.deepEqual(harness.capabilities, {
    streaming: true,
    tools: true,
    permissions: true,
  });
  store.saveHarnessRegistry({
    id: "codex",
    name: "Codex app-server",
    providerId: "codex",
    integration: "Codex app-server JSON-RPC",
    status: "disconnected",
    available: false,
    capabilities: { streaming: true, tools: true, permissions: true },
  });
  assert.equal(store.harnessRegistry()[0].enabled, false);
  assert.throws(
    () => store.setHarnessEnabled("unknown", false),
    /Harness inconnu/,
  );
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

test("execution history filters canonical tool and permission events by project or conversation", () => {
  const dir = mkdtempSync(join(tmpdir(), "omni-execution-history-"));
  const store = new ChatStore(join(dir, "db.sqlite"));
  const project = store.createProject("history", dir);
  const conversation = store.createConversation(project.id, "one", "codex");
  const otherConversation = store.createConversation(
    project.id,
    "two",
    "claude",
  );
  const otherProject = store.createProject("other");
  const unrelated = store.createConversation(otherProject.id, "other", "codex");
  store.appendEvent(conversation.id, "tool.started", {
    toolName: "Write",
    harnessId: "claude-code",
  });
  store.appendEvent(conversation.id, "permission.requested", {
    id: "request-1",
    toolName: "Write",
    action: "file-write",
  });
  store.appendEvent(otherConversation.id, "tool.failed", { toolName: "Bash" });
  store.appendEvent(unrelated.id, "tool.started", { toolName: "Read" });

  assert.deepEqual(
    store
      .executionEvents("tools", { conversationId: conversation.id })
      .map((event) => event.payload.toolName),
    ["Write"],
  );
  assert.deepEqual(
    store
      .executionEvents("tools", { projectId: dir })
      .map((event) => event.payload.toolName),
    ["Write", "Bash"],
  );
  assert.deepEqual(
    store
      .executionEvents("permissions", { conversationId: conversation.id })
      .map((event) => event.payload.id),
    ["request-1"],
  );
  assert.throws(
    () => store.executionEvents("tools"),
    /filtre --conversation ou --project/,
  );
  assert.throws(
    () =>
      store.executionEvents("tools", {
        conversationId: conversation.id,
        projectId: otherProject.id,
      }),
    /n’appartient pas au projet/,
  );
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

test("conversation search reads persisted titles/messages and treats SQL wildcards literally", () => {
  const dir = mkdtempSync(join(tmpdir(), "omni-search-"));
  const file = join(dir, "db.sqlite");
  let store = new ChatStore(file);
  const project = store.createProject("searchable", dir);
  const conversation = store.createConversation(
    project.id,
    "Literal 100%_match",
    "codex",
  );
  store.addMessage(conversation.id, "user", "needle from persistent history");
  const otherProject = store.createProject("separate");
  const other = store.createConversation(otherProject.id, "separate", "claude");
  store.addMessage(other.id, "user", "needle from another project");
  store.close();

  store = new ChatStore(file);
  assert.deepEqual(
    store.searchConversations("needle", dir).map((result) => result.id),
    [conversation.id],
  );
  assert.equal(store.searchConversations("%_match", dir)[0].match, "title");
  assert.equal(
    store.searchConversations("PERSISTENT", dir)[0].match,
    "message",
  );
  assert.deepEqual(store.searchConversations("absent", dir), []);
  assert.throws(() => store.searchConversations("  "), /1 à 500 caractères/);
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

test("SQLite event store rejects non-canonical Omni event types", () => {
  const dir = mkdtempSync(join(tmpdir(), "omni-event-types-"));
  const store = new ChatStore(join(dir, "db.sqlite"));
  const project = store.createProject("events");
  const conversation = store.createConversation(project.id, "events", "m");
  assert.throws(
    () => store.appendEvent(conversation.id, "unregistered.fake-event"),
    /Unsupported Omni event/,
  );
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

test("OpenAI client streams real Responses event shape and lists accessible models", async () => {
  const deltas = [];
  const client = {
    models: {
      list: async () => ({ data: [{ id: "model-b" }, { id: "model-a" }] }),
    },
    responses: {
      create: async () => ({
        controller: new AbortController(),
        async *[Symbol.asyncIterator]() {
          yield { type: "response.output_text.delta", delta: "hello" };
          yield { type: "response.completed" };
        },
      }),
    },
  };
  const provider = new OpenAIChat({ client });
  assert.deepEqual(await provider.listModels(), ["model-a", "model-b"]);
  assert.equal(
    await provider.stream({
      model: "model-a",
      messages: [{ role: "user", content: "hi" }],
      onDelta: (v) => deltas.push(v),
    }),
    "hello",
  );
  assert.deepEqual(deltas, ["hello"]);
});

test("OpenAI stream failure and incomplete responses are never reported as success", async () => {
  for (const event of [
    {
      type: "response.failed",
      response: { error: { message: "provider failed" } },
    },
    { type: "response.incomplete", response: { status: "incomplete" } },
  ]) {
    const client = {
      responses: {
        create: async () => ({
          controller: new AbortController(),
          async *[Symbol.asyncIterator]() {
            yield { type: "response.output_text.delta", delta: "partial" };
            yield event;
          },
        }),
      },
    };
    await assert.rejects(
      new OpenAIChat({ client }).stream({
        model: "listed-model",
        messages: [{ role: "user", content: "hello" }],
        onDelta() {},
      }),
    );
  }
  const client = {
    responses: {
      create: async () => ({
        controller: new AbortController(),
        async *[Symbol.asyncIterator]() {
          yield { type: "response.output_text.delta", delta: "partial" };
        },
      }),
    },
  };
  await assert.rejects(
    new OpenAIChat({ client }).stream({
      model: "listed-model",
      messages: [{ role: "user", content: "hello" }],
      onDelta() {},
    }),
    /sans réponse complète/,
  );
});

test("OpenAI API errors redact the configured key before reaching callers", async () => {
  const apiKey = "arbitrary-private-key-value";
  const provider = new OpenAIChat({
    apiKey,
    clientFactory: (key) => ({
      apiKey: key,
      models: {
        list: async () => {
          throw new Error(`rejected ${key}`);
        },
      },
      responses: {
        create: async () => {
          throw new Error(`rejected ${key}`);
        },
      },
    }),
  });
  await assert.rejects(provider.listModels(), (error) => {
    assert.equal(error.message, "rejected [REDACTED]");
    return true;
  });
  await assert.rejects(
    provider.stream({
      model: "model",
      messages: [{ role: "user", content: "prompt" }],
      onDelta() {},
    }),
    /rejected \[REDACTED\]/,
  );
});

test("restart recovery marks streaming turns interrupted and keeps partial text", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omni-recover-"));
  const file = join(dir, "db.sqlite");
  let db = new ChatStore(file);
  const project = db.createProject("recover");
  const conversation = db.createConversation(project.id, "in progress", "m");
  db.addMessage(conversation.id, "user", "prompt");
  const streamingMessageId = db.addMessage(
    conversation.id,
    "assistant",
    "",
    "streaming",
  );
  db.appendMessageDelta(streamingMessageId, "partial delta");
  db.setStatus(conversation.id, "running");
  db.close();
  db = new ChatStore(file);
  const resumed = db.recoverConversation(conversation.id);
  assert.equal(resumed.status, "interrupted");
  assert.equal(resumed.messages[1].status, "interrupted");
  assert.equal(resumed.messages[1].content, "partial delta");
  const canonicalExport = db.exportConversation(conversation.id);
  const assistantMessageId = canonicalExport.events.find(
    (event) =>
      event.type === "message.created" && event.payload.role === "assistant",
  ).payload.messageId;
  const reconstructedPartial = canonicalExport.events
    .filter(
      (event) =>
        event.type === "message.delta" &&
        event.payload.messageId === assistantMessageId,
    )
    .map((event) => event.payload.delta)
    .join("");
  assert.equal(reconstructedPartial, "partial delta");
  let continuationHistory;
  const continuation = await runChatTurn({
    store: db,
    provider: {
      async stream({ messages, onDelta }) {
        continuationHistory = messages;
        onDelta("continued");
        return "continued";
      },
    },
    conversationId: conversation.id,
    model: "m",
    prompt: "continue from the partial response",
    signal: new AbortController().signal,
  });
  assert.equal(continuation.status, "completed");
  assert.ok(
    continuationHistory.some(
      (message) =>
        message.role === "assistant" && message.content === "partial delta",
    ),
  );
  assert.equal(
    db.conversation(conversation.id).messages.filter((m) => m.role === "user")
      .length,
    2,
  );
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("chat turn saves every streamed delta before interrupt and never retries", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omni-turn-"));
  const file = join(dir, "db.sqlite");
  const store = new ChatStore(file);
  const project = store.createProject("turn");
  const conversation = store.createConversation(project.id, "turn", "model");
  const controller = new AbortController();
  let calls = 0;
  const provider = {
    async stream({ onDelta, signal }) {
      calls += 1;
      onDelta("persisted fragment");
      controller.abort();
      assert.equal(signal.aborted, true);
      throw new Error("aborted by caller");
    },
  };
  const result = await runChatTurn({
    store,
    provider,
    conversationId: conversation.id,
    model: "model",
    prompt: "do not replay me",
    signal: controller.signal,
  });
  assert.deepEqual(result, {
    status: "interrupted",
    answer: "persisted fragment",
  });
  assert.equal(calls, 1);
  store.close();
  const reopened = new ChatStore(file);
  const resumed = reopened.recoverConversation(conversation.id);
  assert.equal(resumed.messages[1].content, "persisted fragment");
  assert.equal(resumed.messages[1].status, "interrupted");
  assert.equal(resumed.messages.filter((m) => m.role === "user").length, 1);
  assert.ok(
    reopened
      .listEvents(conversation.id)
      .some(
        (event) =>
          event.type === "message.delta" &&
          event.payload.delta === "persisted fragment",
      ),
  );
  reopened.close();
  rmSync(dir, { recursive: true, force: true });
});

test("OpenAI key is not persisted in the conversation database", () => {
  const dir = mkdtempSync(join(tmpdir(), "omni-secret-"));
  const key = "sk-test-secret-that-must-never-persist";
  const db = new ChatStore(join(dir, "db.sqlite"));
  const project = db.createProject("safe");
  db.createConversation(project.id, "safe", "model");
  db.close();
  assert.equal(readFileSync(join(dir, "db.sqlite")).includes(key), false);
  rmSync(dir, { recursive: true, force: true });
});

test("credential patterns are redacted from prompts, events, and exports", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omni-redact-"));
  const store = new ChatStore(join(dir, "db.sqlite"));
  const project = store.createProject("redact");
  const conversation = store.createConversation(project.id, "redact", "m");
  const secret = "sk-test-secret-that-must-never-persist";
  let providerInput;
  await runChatTurn({
    store,
    provider: {
      async stream({ messages, onDelta }) {
        providerInput = messages;
        onDelta("safe reply");
        return "safe reply";
      },
    },
    conversationId: conversation.id,
    model: "m",
    prompt: `Please use ${secret}`,
    signal: new AbortController().signal,
  });
  const exported = JSON.stringify(store.exportConversation(conversation.id));
  assert.doesNotMatch(providerInput[0].content, /sk-test-secret/);
  assert.doesNotMatch(exported, /sk-test-secret/);
  assert.match(exported, /REDACTED/);
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

test("named credential fields and JWT access tokens are redacted", () => {
  const jwt = [
    "eyJhbGciOiJIUzI1NiJ9",
    "eyJzdWIiOiIxMjM0NTYifQ",
    "signature-token-value",
  ].join(".");
  const safe = redactSecrets({
    api_key: "sensitive-value-123",
    accessToken: jwt,
  });
  assert.deepEqual(safe, {
    api_key: "[REDACTED]",
    accessToken: "[REDACTED]",
  });
});

test("SQLite conversation storage uses private directory and file permissions", (t) => {
  if (process.platform === "win32")
    return t.skip("POSIX permission bits are unavailable");
  const dir = mkdtempSync(join(tmpdir(), "omni-modes-"));
  const privateDir = join(dir, "private");
  const file = join(privateDir, "db.sqlite");
  const db = new ChatStore(file);
  db.close();
  assert.equal(statSync(privateDir).mode & 0o777, 0o700);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  rmSync(dir, { recursive: true, force: true });
});

test(
  "real provider integration streams a response when explicitly enabled",
  {
    skip: !(
      process.env.OMNI_LIVE_TESTS === "1" &&
      process.env.OPENAI_API_KEY &&
      process.env.OMNI_TEST_MODEL
    ),
  },
  async () => {
    const provider = new OpenAIChat();
    const models = await provider.listModels();
    const model = process.env.OMNI_TEST_MODEL;
    assert.ok(
      models.includes(model),
      "OMNI_TEST_MODEL must be listed for the authenticated account",
    );
    let received = "";
    const answer = await provider.stream({
      model,
      messages: [{ role: "user", content: "Reply with exactly: omni-live-ok" }],
      onDelta: (delta) => {
        received += delta;
      },
    });
    assert.ok(answer.length > 0);
    assert.equal(answer, received);
  },
);
