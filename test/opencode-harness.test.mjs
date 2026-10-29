import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { ChatStore } from "../src/chat-store.mjs";
import {
  OpenCodeHarness,
  parseOpenCodeModel,
} from "../src/opencode-harness.mjs";

const temporaryDirectories = new Set();

after(() => {
  for (const directory of temporaryDirectories)
    rmSync(directory, { recursive: true, force: true });
});

test("OpenCode model IDs use provider/model pairs", () => {
  assert.equal(parseOpenCodeModel("opencode"), undefined);
  assert.deepEqual(parseOpenCodeModel("opencode:google/gemini-test"), {
    providerID: "google",
    id: "gemini-test",
  });
  assert.throws(() => parseOpenCodeModel("gemini-test"), /provider\/model/);
});

test("OpenCode catalog keeps model tool capability and only marks explicit loopback provider URLs local", async () => {
  const directory = mkdtempSync(join(tmpdir(), "omni-opencode-model-catalog-"));
  temporaryDirectories.add(directory);
  const store = new ChatStore(join(directory, "omni.sqlite"));
  const client = {
    v2: {
      model: {
        list: async () => ({
          data: {
            data: [
              {
                id: "llama",
                providerID: "ollama-custom",
                name: "Llama local",
                enabled: true,
                status: "active",
                capabilities: {
                  tools: true,
                  input: ["text"],
                  output: ["text"],
                },
                cost: [
                  {
                    input: 0.2,
                    output: 0.8,
                    cache: { read: 0.02, write: 0.2 },
                  },
                  {
                    tier: { type: "context", size: 200_000 },
                    input: 0.5,
                    output: 1.5,
                    cache: { read: 0.05, write: 0.5 },
                  },
                ],
              },
              {
                id: "text-model",
                providerID: "remote",
                name: "Remote text model",
                enabled: true,
                status: "active",
                capabilities: {
                  tools: false,
                  input: ["text"],
                  output: ["text"],
                },
                cost: [],
              },
            ],
          },
        }),
      },
      provider: {
        list: async () => ({
          data: {
            data: [
              {
                id: "ollama-custom",
                api: { type: "native", url: "http://127.0.0.1:11434" },
              },
              {
                id: "remote",
                api: { type: "aisdk", url: "https://api.example.test/v1" },
              },
            ],
          },
        }),
      },
    },
  };
  const harness = new OpenCodeHarness({
    store,
    cwd: directory,
    serverFactory: async () => ({
      url: "http://127.0.0.1:9000",
      password: "catalog-test-password",
      close: async () => {},
    }),
    clientFactory: () => client,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          paths: {
            "/api/session/{sessionID}/permission/{requestID}/reply": {
              post: {
                requestBody: {
                  content: {
                    "application/json": {
                      schema: {
                        properties: {
                          decision: { enum: ["once", "always", "reject"] },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        }),
        { status: 200 },
      ),
  });
  try {
    const models = await harness.listModelCatalog();
    assert.deepEqual(
      models.map(({ id, local, capabilities, pricing }) => ({
        id,
        local,
        tools: capabilities.tools,
        pricing,
      })),
      [
        {
          id: "ollama-custom/llama",
          local: true,
          tools: true,
          pricing: { inputPerMillion: 0.5 },
        },
        {
          id: "remote/text-model",
          local: false,
          tools: false,
          pricing: undefined,
        },
      ],
    );
  } finally {
    await harness.dispose();
    store.close();
  }
});

test("OpenCode adapter fails closed when its permission reply is rejected", async () => {
  const directory = mkdtempSync(join(tmpdir(), "omni-opencode-contract-"));
  temporaryDirectories.add(directory);
  const store = new ChatStore(join(directory, "omni.sqlite"));
  const project = store.createProject("permission contract", directory);
  const conversation = store.createConversation(project.id, "test", "opencode");
  const session = { id: "session-local", location: { directory } };
  let interrupted = 0;
  const client = {
    v2: {
      health: { get: async () => ({ data: { ok: true } }) },
      session: {
        create: async () => ({ data: { data: session } }),
        get: async () => ({ data: { data: session } }),
        interrupt: async () => {
          interrupted += 1;
          return { data: {} };
        },
        prompt: async () => ({ data: {} }),
        permission: {
          reply: async () => ({
            error: { message: "permission endpoint unavailable" },
          }),
        },
      },
      event: {
        subscribe: async () => ({
          stream: (async function* () {
            yield {
              type: "permission.v2.asked",
              data: {
                id: "permission-local",
                sessionID: session.id,
                action: "file.write",
                resources: ["sample.txt"],
              },
            };
          })(),
        }),
      },
    },
  };
  const harness = new OpenCodeHarness({
    store,
    cwd: directory,
    serverFactory: async () => ({
      url: "http://127.0.0.1:9000",
      password: "temporary-test-password",
      close: async () => {},
    }),
    clientFactory: () => client,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          paths: {
            "/api/session/{sessionID}/permission/{requestID}/reply": {
              post: {
                requestBody: {
                  content: {
                    "application/json": {
                      schema: {
                        properties: {
                          decision: { enum: ["once", "always", "reject"] },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        }),
        { status: 200 },
      ),
    requestPermission: async () => true,
  });

  try {
    await harness.initialize();
    await harness.createSession({ conversationId: conversation.id });
    await assert.rejects(async () => {
      for await (const event of harness.run({
        conversationId: conversation.id,
        sessionId: session.id,
        prompt: "never invoke a model in this contract test",
      })) {
        assert.notEqual(event.type, "message.delta");
      }
    }, /permission endpoint unavailable/);
    assert.equal(interrupted, 1);
    assert.ok(
      store
        .listEvents(conversation.id)
        .some((event) => event.type === "permission.requested"),
    );
    assert.ok(
      !store
        .listEvents(conversation.id)
        .some((event) => event.type === "permission.granted"),
    );
  } finally {
    await harness.dispose();
    store.close();
  }
});

test("OpenCode usage events persist reported USD cost and token counts once per assistant message", async () => {
  const directory = mkdtempSync(join(tmpdir(), "omni-opencode-usage-"));
  temporaryDirectories.add(directory);
  const store = new ChatStore(join(directory, "omni.sqlite"));
  const project = store.createProject("usage contract", directory);
  const conversation = store.createConversation(
    project.id,
    "usage",
    "opencode",
  );
  const session = { id: "usage-session", location: { directory } };
  const stepEvent = {
    type: "session.next.step.ended",
    data: {
      sessionID: session.id,
      assistantMessageID: "assistant-message-1",
      cost: 0.0042,
      tokens: {
        input: 1000,
        output: 125,
        reasoning: 25,
        cache: { read: 20, write: 5 },
      },
    },
  };
  const client = {
    v2: {
      session: {
        create: async () => ({ data: { data: session } }),
        prompt: async () => ({ data: {} }),
        interrupt: async () => ({ data: {} }),
      },
      event: {
        subscribe: async () => ({
          stream: (async function* () {
            yield stepEvent;
            yield { ...stepEvent, id: "duplicate-event" };
            yield { type: "session.idle", data: { sessionID: session.id } };
          })(),
        }),
      },
    },
  };
  const harness = new OpenCodeHarness({
    store,
    cwd: directory,
    serverFactory: async () => ({
      url: "http://127.0.0.1:9000",
      password: "usage-test-password",
      close: async () => {},
    }),
    clientFactory: () => client,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          paths: {
            "/api/session/{sessionID}/permission/{requestID}/reply": {
              post: {
                requestBody: {
                  content: {
                    "application/json": {
                      schema: {
                        properties: {
                          decision: { enum: ["once", "always", "reject"] },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        }),
        { status: 200 },
      ),
  });
  try {
    const sessionRef = await harness.createSession({
      conversationId: conversation.id,
    });
    const emitted = [];
    for await (const event of harness.run({
      conversationId: conversation.id,
      sessionId: sessionRef.id,
      prompt: "test prompt",
    }))
      emitted.push(event);
    const usage = emitted.find((event) => event.type === "usage.updated");
    assert.deepEqual(usage.payload, {
      providerId: "opencode",
      harnessId: "opencode",
      sessionId: session.id,
      messageId: "assistant-message-1",
      costUsd: 0.0042,
      tokens: {
        input: 1000,
        output: 125,
        reasoning: 25,
        cache: { read: 20, write: 5 },
      },
    });
    assert.equal(
      store
        .listEvents(conversation.id)
        .filter((event) => event.type === "usage.updated").length,
      1,
    );
  } finally {
    await harness.dispose();
    store.close();
  }
});

test("OpenCode swap resume context is admitted once and survives process restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "omni-opencode-resume-"));
  temporaryDirectories.add(directory);
  const databaseFile = join(directory, "omni.sqlite");
  let store = new ChatStore(databaseFile);
  const project = store.createProject("resume context", directory);
  const conversation = store.createConversation(
    project.id,
    "swap context",
    "opencode",
  );
  const sessionId = "session-resume-context";
  const summary = { objective: "Update the project", filesModified: ["a.txt"] };
  store.appendEvent(conversation.id, "harness.changed", {
    fromHarnessId: "claude-code",
    toHarnessId: "opencode",
    targetSessionId: sessionId,
    resumeSummary: summary,
  });
  const sentPrompts = [];
  const session = { id: sessionId, location: { directory } };
  const client = {
    v2: {
      session: {
        get: async () => ({ data: { data: session } }),
        prompt: async ({ prompt }) => {
          sentPrompts.push(prompt.text);
          return { data: {} };
        },
        interrupt: async () => ({ data: {} }),
      },
      event: {
        subscribe: async () => ({
          stream: (async function* () {
            yield { type: "session.idle", data: { sessionID: sessionId } };
          })(),
        }),
      },
    },
  };
  const fetchImpl = async () =>
    new Response(
      JSON.stringify({
        paths: {
          "/api/session/{sessionID}/permission/{requestID}/reply": {
            post: {
              requestBody: {
                content: {
                  "application/json": {
                    schema: {
                      properties: {
                        decision: { enum: ["once", "always", "reject"] },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      { status: 200 },
    );
  const newHarness = () =>
    new OpenCodeHarness({
      store,
      cwd: directory,
      serverFactory: async () => ({
        url: "http://127.0.0.1:9000",
        password: "resume-test-password",
        close: async () => {},
      }),
      clientFactory: () => client,
      fetchImpl,
    });
  let first;
  let second;
  try {
    first = newHarness();
    const sessionRef = await first.resumeSession(sessionId, {
      conversationId: conversation.id,
    });
    for await (const event of first.run({
      conversationId: conversation.id,
      sessionId,
      prompt: "Continue the task",
    }))
      assert.equal(event.type, "session.completed");
    assert.match(sentPrompts[0], /Reprise de tâche Omni/);
    assert.match(sentPrompts[0], /Update the project/);
    assert.equal(sessionRef.resumeSummary, null);
    await first.dispose();
    store.close();
    store = new ChatStore(databaseFile);
    second = newHarness();
    const recovered = await second.resumeSession(sessionId, {
      conversationId: conversation.id,
    });
    assert.equal(recovered.resumeSummary, null);
    assert.equal(
      store
        .listEvents(conversation.id)
        .filter(
          (event) =>
            event.type === "harness.resume_context_consumed" &&
            event.payload.sessionId === sessionId,
        ).length,
      1,
    );
  } finally {
    await first?.dispose();
    await second?.dispose();
    store.close();
  }
});

test(
  "official OpenCode server accepts a safe swap and resumes it after an Omni store restart",
  { skip: process.env.OMNI_LIVE_OPENCODE_TESTS !== "1" },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "omni-opencode-live-"));
    temporaryDirectories.add(directory);
    const dataDirectory = join(directory, "data");
    const configDirectory = join(directory, "config");
    const cacheDirectory = join(directory, "cache");
    const projectDirectory = join(directory, "project");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(dataDirectory);
    mkdirSync(configDirectory);
    mkdirSync(cacheDirectory);
    mkdirSync(projectDirectory);
    const databaseFile = join(directory, "omni.sqlite");
    let store = new ChatStore(databaseFile);
    const project = store.createProject("OpenCode lifecycle", projectDirectory);
    const conversation = store.createConversation(
      project.id,
      "restart",
      "claude:configured-model",
    );
    store.addMessage(
      conversation.id,
      "user",
      "Continue after reviewing the change",
    );
    store.addMessage(
      conversation.id,
      "assistant",
      "The change is complete.",
      "completed",
    );
    store.appendEvent(conversation.id, "session.started", {
      harnessId: "claude-code",
      sessionId: "prior-claude-session",
    });
    store.appendEvent(conversation.id, "file.changed", {
      path: "src/changed.mjs",
      harnessId: "claude-code",
    });
    const env = {
      PATH: process.env.PATH,
      HOME: directory,
      XDG_CONFIG_HOME: configDirectory,
      XDG_DATA_HOME: dataDirectory,
      XDG_CACHE_HOME: cacheDirectory,
      TMPDIR: directory,
    };
    let second;
    try {
      store.close();
      const cliPath = new URL("../bin/omni.mjs", import.meta.url);
      const cliRun = spawnSync(
        process.execPath,
        [
          cliPath.pathname,
          "swap",
          "--conversation",
          conversation.id,
          "--harness",
          "opencode",
        ],
        {
          cwd: projectDirectory,
          env: { ...env, OMNI_DATA_DIR: directory },
          encoding: "utf8",
          timeout: 30_000,
        },
      );
      assert.equal(cliRun.status, 0, cliRun.stderr);
      assert.equal(JSON.parse(cliRun.stdout).harnessId, "opencode");
      store = new ChatStore(databaseFile);
      const swapEvent = store
        .listEvents(conversation.id)
        .filter(
          (event) =>
            event.type === "harness.changed" &&
            event.payload.toHarnessId === "opencode",
        )
        .at(-1);
      const createdSessionId = swapEvent.payload.targetSessionId;
      second = new OpenCodeHarness({ store, cwd: projectDirectory, env });
      const resumed = await second.resumeSession(createdSessionId, {
        conversationId: conversation.id,
      });
      assert.equal(resumed.id, createdSessionId);
      assert.equal(resumed.cwd, projectDirectory);
      assert.equal(
        resumed.resumeSummary.objective,
        "Continue after reviewing the change",
      );
      const checkpoint = await second.checkpoint(resumed.id);
      assert.equal(checkpoint.sessionId, createdSessionId);
      assert.equal((await second.listModels()).length >= 0, true);
      const permissionResult = await second.client.v2.session.permission.create(
        {
          sessionID: resumed.id,
          action: "file.write",
          resources: ["permission-contract.txt"],
        },
      );
      const permission = permissionResult.data?.data ?? permissionResult.data;
      assert.equal(permissionResult.response.status, 200);
      const rejected = await second.client.v2.session.permission.reply({
        sessionID: resumed.id,
        requestID: permission.id,
        reply: "reject",
      });
      assert.equal(rejected.error, undefined);
      assert.equal(rejected.response.status, 204);
    } finally {
      await second?.dispose();
      store.close();
    }
  },
);

test(
  "Auto plan reads a real OpenCode catalog without creating a conversation or generating a model response",
  { skip: process.env.OMNI_LIVE_OPENCODE_TESTS !== "1" },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "omni-auto-plan-live-"));
    temporaryDirectories.add(directory);
    const { mkdirSync } = await import("node:fs");
    const dataDirectory = join(directory, "data");
    const configDirectory = join(directory, "config");
    const cacheDirectory = join(directory, "cache");
    const projectDirectory = join(directory, "project");
    for (const path of [
      dataDirectory,
      configDirectory,
      cacheDirectory,
      projectDirectory,
    ])
      mkdirSync(path);
    const env = {
      PATH: process.env.PATH,
      HOME: directory,
      XDG_CONFIG_HOME: configDirectory,
      XDG_DATA_HOME: dataDirectory,
      XDG_CACHE_HOME: cacheDirectory,
      TMPDIR: directory,
      OMNI_DATA_DIR: dataDirectory,
      OMNI_DISABLED_PROVIDERS:
        "codex,claude,openai,openrouter,anthropic,google",
      OMNI_AUTO_PREFERRED_PROVIDERS: "opencode",
    };
    const cliPath = new URL("../bin/omni.mjs", import.meta.url);
    const createProject = spawnSync(
      process.execPath,
      [
        cliPath.pathname,
        "project",
        "create",
        "--name",
        "Auto preview",
        "--path",
        projectDirectory,
      ],
      { cwd: projectDirectory, env, encoding: "utf8", timeout: 15_000 },
    );
    assert.equal(createProject.status, 0, createProject.stderr);
    const catalogStore = new ChatStore(join(directory, "catalog.sqlite"));
    const catalogHarness = new OpenCodeHarness({
      store: catalogStore,
      cwd: projectDirectory,
      env,
    });
    let catalog;
    try {
      catalog = await catalogHarness.listModelCatalog();
    } finally {
      await catalogHarness.dispose();
      catalogStore.close();
    }
    const preview = spawnSync(
      process.execPath,
      [
        cliPath.pathname,
        "auto",
        "plan",
        "--project",
        projectDirectory,
        "--json",
        "Inspect the project",
      ],
      { cwd: projectDirectory, env, encoding: "utf8", timeout: 30_000 },
    );
    assert.equal(preview.status, 0, preview.stderr);
    const decision = JSON.parse(preview.stdout);
    assert.equal(decision.selected.providerId, "opencode");
    assert.equal(decision.selected.harnessId, "opencode");
    assert.match(decision.selected.modelId, /.+\/.+/);
    assert.ok(
      decision.checkedProviders.find(
        (provider) => provider.providerId === "opencode",
      ).modelCount > 0,
    );
    for (const model of catalog) {
      const evaluated = decision.evaluatedCandidates.find(
        (candidate) => candidate.key === `opencode/${model.id}/opencode`,
      );
      assert.ok(evaluated, `Auto omitted OpenCode model ${model.id}`);
      assert.equal(evaluated.local, model.local);
      assert.equal(
        evaluated.knownInputPricePerMillion,
        model.pricing?.inputPerMillion ?? null,
      );
    }
    const store = new ChatStore(join(dataDirectory, "omni.sqlite"));
    try {
      assert.equal(store.count().conversations, 0);
    } finally {
      store.close();
    }
  },
);
