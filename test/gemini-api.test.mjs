import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { after, test } from "node:test";
import { GoogleGenAI } from "@google/genai";
import { GeminiApiAuth, GeminiApiChat } from "../src/gemini-api.mjs";

let server;
let origin;
let requests;
let abortSignalObserved;
let resolveAbortSignal;

async function startFixture() {
  requests = [];
  abortSignalObserved = new Promise((resolve) => {
    resolveAbortSignal = resolve;
  });
  server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");
    const url = new URL(request.url, "http://localhost");
    requests.push({
      method: request.method,
      pathname: url.pathname,
      pageToken: url.searchParams.get("pageToken"),
      authenticated:
        request.headers["x-goog-api-key"] === "local-gemini-contract-secret" ||
        url.searchParams.get("key") === "local-gemini-contract-secret",
      body,
    });
    if (request.method === "GET" && url.pathname.endsWith("/models")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify(
          url.searchParams.has("pageToken")
            ? {
                models: [
                  {
                    name: "models/gemini-model-z",
                    supportedGenerationMethods: ["generateContent"],
                  },
                  {
                    name: "models/embedding-model",
                    supportedGenerationMethods: ["embedContent"],
                  },
                ],
              }
            : {
                models: [
                  {
                    name: "models/gemini-model-a",
                    supportedGenerationMethods: ["generateContent"],
                  },
                ],
                nextPageToken: "cursor-2",
              },
        ),
      );
      return;
    }
    if (
      request.method === "POST" &&
      url.pathname.endsWith(":streamGenerateContent")
    ) {
      if (url.pathname.includes("gemini-fail")) {
        response.writeHead(503, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            error: { message: "rejected local-gemini-contract-secret" },
          }),
        );
        return;
      }
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      if (url.pathname.includes("gemini-slow")) {
        response.on("close", () => resolveAbortSignal(!response.writableEnded));
        response.write(
          'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"partial"}]}}]}\n\n',
        );
        return;
      }
      response.write(
        'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"hello "}]}}]}\n\n',
      );
      response.write(
        'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"gemini"}]},"finishReason":"STOP"}]}\n\n',
      );
      response.end();
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(
      JSON.stringify({ error: { message: "unexpected local fixture path" } }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  origin = `http://127.0.0.1:${server.address().port}`;
}

after(async () => {
  if (server?.listening) server.close();
});

test("official Gemini SDK paginates models and streams GenerateContent locally", async () => {
  await startFixture();
  const apiKey = "local-gemini-contract-secret";
  const provider = new GeminiApiChat({
    apiKey,
    clientFactory: (key) =>
      new GoogleGenAI({
        apiKey: key,
        httpOptions: { baseUrl: origin, retryOptions: { attempts: 1 } },
      }),
  });
  assert.deepEqual(await provider.listModels(), [
    "models/gemini-model-a",
    "models/gemini-model-z",
  ]);
  const deltas = [];
  assert.equal(
    await provider.stream({
      model: "google:models/gemini-model-a",
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "second" },
      ],
      onDelta: (delta) => deltas.push(delta),
    }),
    "hello gemini",
  );
  assert.deepEqual(deltas, ["hello ", "gemini"]);
  assert.equal(requests.length, 3);
  assert.ok(requests.every(({ authenticated }) => authenticated));
  assert.ok(requests.some(({ pageToken }) => pageToken === "cursor-2"));
  assert.deepEqual(JSON.parse(requests[2].body), {
    contents: [
      { role: "user", parts: [{ text: "first" }] },
      { role: "model", parts: [{ text: "second" }] },
    ],
    generationConfig: { maxOutputTokens: 4096 },
  });
  const controller = new AbortController();
  await assert.rejects(
    provider.stream({
      model: "google:models/gemini-slow",
      messages: [{ role: "user", content: "stop me" }],
      signal: controller.signal,
      onDelta: () => controller.abort(),
    }),
  );
  assert.equal(await abortSignalObserved, true);
  assert.equal(requests.length, 4);
  await assert.rejects(
    provider.stream({
      model: "google:models/gemini-fail",
      messages: [{ role: "user", content: "do not retry" }],
      onDelta: () => assert.fail("A failed generation must not yield deltas"),
    }),
    (error) => {
      assert.equal(error.message.includes(apiKey), false);
      return true;
    },
  );
  assert.equal(requests.length, 5);
});

test("Gemini API credentials use an isolated keyring identity", () => {
  const entries = new Map();
  const secretStore = {
    get: (service, account) => entries.get(`${service}:${account}`) ?? null,
    set: (service, account, value) =>
      entries.set(`${service}:${account}`, value),
    delete: (service, account) => entries.delete(`${service}:${account}`),
  };
  const auth = new GeminiApiAuth({ secretStore });
  auth.setApiKey("gemini-test-secret");
  assert.deepEqual([...entries.keys()], ["Omni Gemini API Key:default"]);
  assert.equal(auth.getApiKey(), "gemini-test-secret");
  assert.throws(() => auth.setApiKey("bad\nkey"), /une seule ligne/);
  assert.equal(auth.deleteApiKey(), true);
  assert.equal(auth.hasApiKey(), false);
});

test("Gemini SDK errors redact the configured API key", async () => {
  const apiKey = "gemini-error-secret";
  const provider = new GeminiApiChat({
    apiKey,
    client: {
      models: {
        list: async () => ({
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
