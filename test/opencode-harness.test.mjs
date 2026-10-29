import assert from "node:assert/strict";
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

test(
  "official OpenCode server creates and resumes a persisted session without a model call",
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
      "opencode",
    );
    const env = {
      PATH: process.env.PATH,
      HOME: directory,
      XDG_CONFIG_HOME: configDirectory,
      XDG_DATA_HOME: dataDirectory,
      XDG_CACHE_HOME: cacheDirectory,
      TMPDIR: directory,
    };
    let first;
    let second;
    try {
      first = new OpenCodeHarness({ store, cwd: projectDirectory, env });
      await first.initialize();
      const created = await first.createSession({
        conversationId: conversation.id,
      });
      await first.dispose();
      store.close();
      store = new ChatStore(databaseFile);
      const savedSessionId = store
        .listEvents(conversation.id)
        .filter(
          (event) =>
            event.type === "session.started" &&
            event.payload.harnessId === "opencode",
        )
        .at(-1)?.payload.sessionId;
      assert.equal(savedSessionId, created.id);
      second = new OpenCodeHarness({ store, cwd: projectDirectory, env });
      const resumed = await second.resumeSession(savedSessionId, {
        conversationId: conversation.id,
      });
      assert.equal(resumed.id, created.id);
      assert.equal(resumed.cwd, projectDirectory);
      const checkpoint = await second.checkpoint(resumed.id);
      assert.equal(checkpoint.sessionId, created.id);
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
      await first?.dispose();
      await second?.dispose();
      store.close();
    }
  },
);
