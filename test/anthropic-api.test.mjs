import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { after, test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { AnthropicApiAuth, AnthropicApiChat } from "../src/anthropic-api.mjs";

let server;
let origin;
let requests;

async function startFixture() {
  requests = [];
  server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");
    requests.push({
      method: request.method,
      url: request.url,
      authenticated:
        request.headers["x-api-key"] === "local-anthropic-contract-secret" ||
        request.headers.authorization ===
          "Bearer local-anthropic-contract-secret",
      version: request.headers["anthropic-version"],
      body,
    });
    if (request.url.startsWith("/v1/models")) {
      const laterPage = new URL(
        request.url,
        "http://localhost",
      ).searchParams.has("after_id");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          data: laterPage
            ? [
                {
                  id: "claude-model-z",
                  type: "model",
                  display_name: "Z",
                  created_at: "2026-01-01T00:00:00Z",
                },
              ]
            : [
                {
                  id: "claude-model-a",
                  type: "model",
                  display_name: "A",
                  created_at: "2026-01-01T00:00:00Z",
                },
                {
                  id: "claude-model-m",
                  type: "model",
                  display_name: "M",
                  created_at: "2026-01-01T00:00:00Z",
                },
              ],
          has_more: !laterPage,
          first_id: laterPage ? "claude-model-z" : "claude-model-a",
          last_id: laterPage ? "claude-model-z" : "claude-model-m",
        }),
      );
      return;
    }
    if (request.url === "/v1/messages") {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      response.write(
        'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_local","type":"message","role":"assistant","model":"claude-model-a","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":0}}}\n\n',
      );
      response.write(
        'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      );
      response.write(
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello "}}\n\n',
      );
      response.write(
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"world"}}\n\n',
      );
      response.write(
        'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      );
      response.write(
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"input_tokens":3,"output_tokens":2,"cache_read_input_tokens":2,"cache_creation_input_tokens":4,"output_tokens_details":{"reasoning_tokens":1}}}\n\n',
      );
      response.end('event: message_stop\ndata: {"type":"message_stop"}\n\n');
      return;
    }
    response.writeHead(404);
    response.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  origin = `http://127.0.0.1:${server.address().port}`;
}

after(async () => {
  if (server?.listening) server.close();
});

test("official Anthropic SDK lists paginated models and streams Messages API deltas locally", async () => {
  await startFixture();
  const apiKey = "local-anthropic-contract-secret";
  const provider = new AnthropicApiChat({
    apiKey,
    clientFactory: (key) =>
      new Anthropic({ apiKey: key, baseURL: origin, maxRetries: 0 }),
  });
  assert.deepEqual(await provider.listModels(), [
    "claude-model-a",
    "claude-model-m",
    "claude-model-z",
  ]);
  const deltas = [];
  const usageEvents = [];
  assert.equal(
    await provider.stream({
      model: "anthropic:claude-model-a",
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "second" },
      ],
      onDelta: (delta) => deltas.push(delta),
      onUsage: (usage) => usageEvents.push(usage),
    }),
    "hello world",
  );
  assert.deepEqual(deltas, ["hello ", "world"]);
  assert.deepEqual(usageEvents, [
    {
      providerId: "anthropic",
      tokens: {
        input: 3,
        output: 2,
        reasoning: 1,
        cache: { read: 2, write: 4 },
      },
    },
  ]);
  assert.equal(requests.length, 3);
  assert.ok(requests.every(({ authenticated }) => authenticated));
  assert.ok(requests.every(({ version }) => version));
  assert.ok(requests[1].url.includes("after_id=claude-model-m"));
  assert.deepEqual(JSON.parse(requests[2].body), {
    model: "claude-model-a",
    max_tokens: 4096,
    messages: [
      { role: "user", content: "first" },
      { role: "assistant", content: "second" },
    ],
    stream: true,
  });
});

test("Anthropic API credentials have an isolated keyring identity", () => {
  const entries = new Map();
  const secretStore = {
    get: (service, account) => entries.get(`${service}:${account}`) ?? null,
    set: (service, account, value) =>
      entries.set(`${service}:${account}`, value),
    delete: (service, account) => entries.delete(`${service}:${account}`),
  };
  const auth = new AnthropicApiAuth({ secretStore });
  auth.setApiKey("anthropic-test-secret");
  assert.deepEqual([...entries.keys()], ["Omni Anthropic API Key:default"]);
  assert.equal(auth.getApiKey(), "anthropic-test-secret");
  assert.throws(() => auth.setApiKey("bad\nkey"), /une seule ligne/);
  assert.equal(auth.deleteApiKey(), true);
  assert.equal(auth.hasApiKey(), false);
});

test("Anthropic API errors redact the configured key", async () => {
  const apiKey = "anthropic-error-secret";
  const provider = new AnthropicApiChat({
    apiKey,
    client: {
      models: {
        list: () => ({
          async *[Symbol.asyncIterator]() {
            throw new Error(`rejected ${apiKey}`);
          },
        }),
      },
    },
  });
  await assert.rejects(provider.listModels(), (error) => {
    assert.equal(error.message.includes(apiKey), false);
    assert.match(error.message, /\[REDACTED\]/);
    return true;
  });
});
