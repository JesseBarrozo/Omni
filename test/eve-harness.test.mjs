import test from "node:test";
import assert from "node:assert/strict";
import { EveHarness } from "../src/eve-harness.mjs";

function streamResponse(lines, status = 200) {
  return new Response(lines.join("\n") + "\n", {
    status,
    headers: { "content-type": "application/x-ndjson" },
  });
}

test("EveHarness exposes durable capabilities and creates a session", async () => {
  const calls = [];
  const harness = new EveHarness({
    baseUrl: "https://eve.example",
    authToken: "Bearer-secret-token",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ sessionId: "sess_1" }), {
        status: 202,
        headers: { "content-type": "application/json" },
      });
    },
  });

  assert.deepEqual(await harness.capabilities(), {
    tools: true,
    streaming: true,
    checkpoint: true,
    permissions: true,
    resume: true,
    durable: true,
    sandbox: false,
    computerUse: false,
    mcpTransports: ["http"],
  });
  const session = await harness.createSession({
    conversationId: "conv_1",
    prompt: "Inspect the project",
  });
  assert.equal(session.id, "sess_1");
  assert.equal(calls[0].url, "https://eve.example/eve/v1/session");
  assert.equal(
    calls[0].init.headers.authorization,
    "Bearer Bearer-secret-token",
  );
  assert.equal(
    calls[0].init.body,
    JSON.stringify({ message: "Inspect the project" }),
  );
});

test("EveHarness maps NDJSON progress and facts to Omni events", async () => {
  const calls = [];
  const harness = new EveHarness({
    baseUrl: "https://eve.example/",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith("/session")) {
        return new Response(JSON.stringify({ sessionId: "sess_2" }), {
          status: 202,
        });
      }
      if (url.includes("/stream?"))
        return streamResponse([
          JSON.stringify({
            progress: {
              type: "content.delta",
              data: { partId: "part_1", delta: "Done" },
            },
            meta: { position: { line: 2, index: 0 } },
          }),
          JSON.stringify({
            facts: [
              {
                type: "turn.settled",
                data: { turnId: "turn_1", outcome: "completed" },
              },
            ],
            meta: { position: { line: 3, index: 0 } },
          }),
        ]);
      return new Response(JSON.stringify({ ok: true, status: "accepted" }));
    },
  });

  const session = await harness.createSession({ conversationId: "conv_2" });
  const events = [];
  for await (const event of harness.run({
    sessionId: session.id,
    conversationId: "conv_2",
    prompt: "Continue",
  }))
    events.push(event);

  assert.deepEqual(
    events.map((event) => event.type),
    ["message.delta", "session.completed"],
  );
  assert.equal(events[0].payload.delta, "Done");
  assert.match(
    calls.find((call) => call.url.includes("/stream?")).url,
    /startIndex=0$/,
  );
});

test("EveHarness resumes from a cursor and redacts auth errors", async () => {
  let streamUrl;
  const harness = new EveHarness({
    baseUrl: "https://eve.example",
    authToken: "secret-token",
    fetchImpl: async (url) => {
      streamUrl = url;
      return new Response(
        JSON.stringify({ message: "secret-token rejected" }),
        {
          status: 401,
        },
      );
    },
  });
  await harness.resumeSession("sess_3", {
    conversationId: "conv_3",
    cursor: 7,
  });
  await assert.rejects(
    async () => {
      for await (const _event of harness.run({
        sessionId: "sess_3",
        conversationId: "conv_3",
      })) {
        void _event;
      }
    },
    (error) => {
      assert.doesNotMatch(error.message, /secret-token/);
      assert.match(error.message, /REDACTED/);
      return true;
    },
  );
  assert.match(streamUrl, /startIndex=7$/);
});

test("EveHarness persists cursor, tasks, subagents and HITL decisions", async () => {
  const events = [];
  const store = {
    appendEvent: (conversationId, type, payload) =>
      events.push({ conversationId, type, payload }),
    listEvents: () => [],
  };
  const harness = new EveHarness({
    baseUrl: "https://eve.example",
    store,
    requestPermission: async () => true,
    fetchImpl: async (url, _init) => {
      if (url.endsWith("/session"))
        return new Response(JSON.stringify({ sessionId: "sess_4" }), {
          status: 202,
        });
      if (url.includes("/stream?"))
        return streamResponse([
          JSON.stringify({
            facts: [
              { type: "task.started", data: { taskId: "task_1" } },
              {
                type: "child.opened",
                data: { sessionId: "child_1", name: "research" },
              },
              {
                type: "interaction.opened",
                data: { interactionId: "request_1" },
              },
              {
                type: "content.completed",
                data: {
                  kind: "text",
                  phase: "reply",
                  partId: "part_2",
                  value: "authoritative",
                },
              },
            ],
            meta: { position: { line: 4, index: 0 } },
          }),
          JSON.stringify({
            facts: [
              {
                type: "task.ended",
                data: { taskId: "task_1", outcome: "completed" },
              },
              {
                type: "child.closed",
                data: { sessionId: "child_1", outcome: "completed" },
              },
              {
                type: "turn.settled",
                data: { outcome: "completed" },
              },
            ],
            meta: { position: { line: 5, index: 0 } },
          }),
        ]);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });
  const session = await harness.createSession({ conversationId: "conv_4" });
  const received = [];
  for await (const event of harness.run({
    sessionId: session.id,
    conversationId: "conv_4",
  }))
    received.push(event.type);
  assert.deepEqual(received, [
    "task.started",
    "subagent.started",
    "permission.requested",
    "permission.granted",
    "message.delta",
    "task.completed",
    "subagent.completed",
    "session.completed",
  ]);
  assert.equal(
    events.findLast((event) => event.type === "session.cursor.updated").payload
      .cursor,
    6,
  );
  assert.equal(
    events.find((event) => event.type === "permission.granted").payload
      .optionId,
    "approve",
  );
});
