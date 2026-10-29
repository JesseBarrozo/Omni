import test from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  readdirSync,
  statSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatStore } from "../src/chat-store.mjs";
import {
  AntigravityCliChat,
  assertAntigravityHeadlessPolicy,
  parseAntigravityModels,
} from "../src/antigravity-cli.mjs";

test("Antigravity model parsing only accepts tabular model rows", () => {
  assert.deepEqual(
    parseAntigravityModels(
      "Fetching available models...\nname\tlabel\ngemini-4-argon\tGemini 4\ngemini-4-argon\tDuplicate\n",
    ),
    ["gemini-4-argon"],
  );
  assert.deepEqual(parseAntigravityModels("authentication required\n"), []);
});

test("headless policy fails closed on global allow rules and unsafe mode", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omni-antigravity-policy-"));
  const settingsPath = join(dir, "settings.json");
  const hooksPath = join(dir, "hooks.json");
  try {
    await assertAntigravityHeadlessPolicy({ settingsPath, hooksPath });
    writeFileSync(
      settingsPath,
      JSON.stringify({ permissions: { allow: ["mcp(*)"] } }),
    );
    await assert.rejects(
      assertAntigravityHeadlessPolicy({ settingsPath, hooksPath }),
      /règles globales allow/,
    );
    writeFileSync(
      settingsPath,
      JSON.stringify({ toolPermission: "always-proceed" }),
    );
    await assert.rejects(
      assertAntigravityHeadlessPolicy({ settingsPath, hooksPath }),
      /toolPermission/,
    );
    writeFileSync(settingsPath, "not-json");
    await assert.rejects(
      assertAntigravityHeadlessPolicy({ settingsPath, hooksPath }),
      /permissions Antigravity/,
    );
    writeFileSync(settingsPath, "{}");
    writeFileSync(
      hooksPath,
      JSON.stringify({ Stop: [{ type: "command", command: "unsafe" }] }),
    );
    await assert.rejects(
      assertAntigravityHeadlessPolicy({ settingsPath, hooksPath }),
      /hooks globaux/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("official CLI JSONL contract persists conversation IDs and resumes after process restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omni-antigravity-chat-"));
  const dataDir = join(dir, "data");
  const sourceProject = join(dir, "source-project");
  const fixture = join(dir, "agy-fixture.mjs");
  mkdirSync(sourceProject);
  const id = "2eb5f356-e38a-44b7-b08b-e949eb49e121";
  writeFileSync(
    fixture,
    `#!/usr/bin/env node
const resumed = process.argv.includes("--conversation");
const conversationId = ${JSON.stringify(id)};
if (process.argv.includes("hang")) {
  console.log(JSON.stringify({event:"init",conversation_id:conversationId,init:{cwd:process.cwd(),permission_mode:"request-review",tools:[]}}));
  console.log(JSON.stringify({event:"step_update",step_update:{step_type:"agent_response",state:"ACTIVE",text_delta:"partial"}}));
  setInterval(() => {}, 1000);
} else {
const response = resumed ? "second turn" : "first turn";
console.log(JSON.stringify({event:"init",conversation_id:conversationId,init:{cwd:process.cwd(),permission_mode:"request-review",tools:["write_to_file"]}}));
console.log(JSON.stringify({event:"step_update",step_update:{step_type:"agent_response",state:"ACTIVE",text_delta:response}}));
console.log(JSON.stringify({event:"result",result:{conversation_id:conversationId,status:"SUCCESS",response}}));
}
`,
    { mode: 0o700 },
  );
  chmodSync(fixture, 0o700);
  const store = new ChatStore(join(dataDir, "omni.sqlite"));
  try {
    const project = store.createProject("source", sourceProject);
    const conversation = store.createConversation(
      project.id,
      "Antigravity",
      "antigravity:gemini-4-argon",
    );
    const chat = new AntigravityCliChat({
      store,
      dataDir,
      executable: fixture,
      model: "gemini-4-argon",
      settingsPath: join(dir, "missing-settings.json"),
      env: { ...process.env, GEMINI_API_KEY: "must-not-be-forwarded" },
    });
    const firstDeltas = [];
    assert.equal(
      await chat.stream({
        conversationId: conversation.id,
        messages: [{ role: "user", content: "first" }],
        onDelta: (delta) => firstDeltas.push(delta),
      }),
      "first turn",
    );
    assert.deepEqual(firstDeltas, ["first turn"]);
    const secondDeltas = [];
    assert.equal(
      await chat.stream({
        conversationId: conversation.id,
        messages: [
          { role: "user", content: "first" },
          { role: "assistant", content: "first turn" },
          { role: "user", content: "continue" },
        ],
        onDelta: (delta) => secondDeltas.push(delta),
      }),
      "second turn",
    );
    assert.deepEqual(secondDeltas, ["second turn"]);
    const workspace = join(dataDir, "antigravity-workspaces", conversation.id);
    assert.equal(statSync(workspace).mode & 0o777, 0o700);
    assert.notEqual(workspace, sourceProject);
    assert.deepEqual(readdirSync(sourceProject), []);
    const sessionEvents = store
      .listEvents(conversation.id)
      .filter((event) => event.type === "session.started");
    assert.equal(sessionEvents.length, 1);
    assert.equal(sessionEvents[0].payload.sessionId, id);
    assert.equal(
      store
        .listEvents(conversation.id)
        .filter((event) => event.type === "session.checkpointed").length,
      2,
    );
    const interruptedConversation = store.createConversation(
      project.id,
      "Interrupted",
      "antigravity:hang",
    );
    const interruptedChat = new AntigravityCliChat({
      store,
      dataDir,
      executable: fixture,
      model: "hang",
      settingsPath: join(dir, "missing-settings.json"),
    });
    const partial = [];
    await assert.rejects(
      interruptedChat.stream({
        conversationId: interruptedConversation.id,
        messages: [{ role: "user", content: "interrupt me" }],
        onDelta: (delta) => {
          partial.push(delta);
          void interruptedChat.interrupt(interruptedConversation.id);
        },
      }),
      { name: "AbortError" },
    );
    assert.deepEqual(partial, ["partial"]);
    assert.equal(
      store
        .listEvents(interruptedConversation.id)
        .filter((event) => event.type === "session.interrupted").length,
      1,
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test(
  "real Antigravity CLI OAuth streams and resumes after Omni store restart",
  {
    skip: process.env.OMNI_LIVE_ANTIGRAVITY_TESTS !== "1",
    timeout: 180_000,
  },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "omni-antigravity-live-"));
    const dataDir = join(dir, "data");
    let store = new ChatStore(join(dataDir, "omni.sqlite"));
    try {
      const project = store.createProject("antigravity-live", null);
      const conversation = store.createConversation(
        project.id,
        "Antigravity live OAuth",
        "antigravity:catalog",
      );
      let chat = new AntigravityCliChat({ store, dataDir });
      const models = await chat.listModels();
      assert.ok(
        models.length > 0,
        "AGY account model catalog must be non-empty",
      );
      const model = process.env.OMNI_ANTIGRAVITY_TEST_MODEL ?? models[0];
      assert.ok(
        models.includes(model),
        "test model must come from AGY catalog",
      );
      chat.model = model;
      const firstDeltas = [];
      await chat.stream({
        conversationId: conversation.id,
        messages: [
          {
            role: "user",
            content:
              "Mémorise exactement le code OMNI_AGY_RESUME_4831. Réponds uniquement par OK. N'utilise aucun outil.",
          },
        ],
        onDelta: (delta) => firstDeltas.push(delta),
      });
      assert.ok(firstDeltas.length > 0, "AGY must stream answer deltas");
      const sessionId = store
        .listEvents(conversation.id)
        .find(
          (event) =>
            event.type === "session.started" &&
            event.payload.providerId === "antigravity",
        )?.payload.sessionId;
      assert.ok(sessionId, "AGY must expose a resumable conversation ID");
      store.close();
      store = null;
      store = new ChatStore(join(dataDir, "omni.sqlite"));
      chat = new AntigravityCliChat({ store, dataDir, model });
      let secondAnswer = "";
      await chat.stream({
        conversationId: conversation.id,
        messages: [
          { role: "user", content: "Remember this code." },
          { role: "assistant", content: "OK" },
          {
            role: "user",
            content:
              "Quel code exact t'ai-je demandé de mémoriser? Réponds uniquement par le code. N'utilise aucun outil.",
          },
        ],
        onDelta: (delta) => (secondAnswer += delta),
      });
      assert.match(secondAnswer, /OMNI_AGY_RESUME_4831/);
      assert.equal(
        store
          .listEvents(conversation.id)
          .filter(
            (event) =>
              event.type === "session.started" &&
              event.payload.providerId === "antigravity",
          ).length,
        1,
      );
    } finally {
      store?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
