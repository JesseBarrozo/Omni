import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { after, test } from "node:test";
import OpenAI from "openai";
import { OpenRouterAuth, OpenRouterChat } from "../src/openrouter-chat.mjs";

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
      authorization: request.headers.authorization,
      title: request.headers["x-openrouter-title"],
      body,
    });
    if (request.url === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          data: [{ id: "vendor/model-z" }, { id: "vendor/model-a" }],
        }),
      );
      return;
    }
    if (request.url === "/v1/chat/completions") {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      response.write('data: {"choices":[{"delta":{"content":"real "}}]}\n\n');
      response.write('data: {"choices":[{"delta":{"content":"stream"}}]}\n\n');
      response.end("data: [DONE]\n\n");
      return;
    }
    response.writeHead(404);
    response.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  origin = `http://127.0.0.1:${server.address().port}/v1`;
}

after(async () => {
  if (server?.listening) server.close();
});

test("OpenRouter SDK-compatible catalog and streaming request use local API contract", async () => {
  await startFixture();
  const apiKey = "local-contract-secret";
  const provider = new OpenRouterChat({
    apiKey,
    clientFactory: (key) =>
      new OpenAI({
        apiKey: key,
        baseURL: origin,
        maxRetries: 0,
        defaultHeaders: { "X-OpenRouter-Title": "Omni" },
      }),
  });
  assert.deepEqual(await provider.listModels(), [
    "vendor/model-a",
    "vendor/model-z",
  ]);
  const deltas = [];
  assert.equal(
    await provider.stream({
      model: "openrouter:vendor/model-z",
      messages: [{ role: "user", content: "hello" }],
      onDelta: (delta) => deltas.push(delta),
    }),
    "real stream",
  );
  assert.deepEqual(deltas, ["real ", "stream"]);
  assert.equal(requests.length, 2);
  assert.ok(
    requests.every(({ authorization }) => authorization === `Bearer ${apiKey}`),
  );
  assert.equal(requests[1].title, "Omni");
  assert.deepEqual(JSON.parse(requests[1].body), {
    model: "vendor/model-z",
    messages: [{ role: "user", content: "hello" }],
    stream: true,
  });
});

test("OpenRouter credentials use a dedicated keyring identity and validate input", () => {
  const entries = new Map();
  const secretStore = {
    get: (service, account) => entries.get(`${service}:${account}`) ?? null,
    set: (service, account, value) =>
      entries.set(`${service}:${account}`, value),
    delete: (service, account) => entries.delete(`${service}:${account}`),
  };
  const auth = new OpenRouterAuth({ secretStore });
  assert.equal(auth.hasApiKey(), false);
  auth.setApiKey("openrouter-test-secret");
  assert.equal(auth.getApiKey(), "openrouter-test-secret");
  assert.deepEqual([...entries.keys()], ["Omni OpenRouter API Key:default"]);
  assert.throws(() => auth.setApiKey("invalid\nsecret"), /une seule ligne/);
  assert.equal(auth.deleteApiKey(), true);
  assert.equal(auth.hasApiKey(), false);
});

test("OpenRouter SDK errors redact the API key before reaching callers", async () => {
  const apiKey = "openrouter-error-secret";
  const provider = new OpenRouterChat({
    apiKey,
    client: {
      models: {
        list: async () => {
          throw new Error(`Rejected credential ${apiKey}`);
        },
      },
    },
  });
  await assert.rejects(provider.listModels(), (error) => {
    assert.equal(error.message.includes(apiKey), false);
    assert.match(error.message, /\[REDACTED\]/);
    return true;
  });
});
