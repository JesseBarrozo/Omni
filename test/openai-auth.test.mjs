import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Entry } from "@napi-rs/keyring";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { OpenAIAuth } from "../src/openai-auth.mjs";
import { OpenAIChat } from "../src/openai-chat.mjs";
import { SecretStore } from "../src/secret-store.mjs";

const issuer = "https://auth.openai.com";
const clientId = "oaiapp_omni_unit_test";
const scope =
  "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

class MemoryEntry {
  value = null;
  getPassword() {
    return this.value;
  }
  setPassword(value) {
    this.value = value;
  }
}

async function createFlow({ expiresIn = 3600, badState = false } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "omni-openai-auth-"));
  const entry = new MemoryEntry();
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "unit-test-key";
  jwk.alg = "RS256";
  jwk.use = "sig";
  let nonce;
  let refreshCount = 0;
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const target = String(url);
    calls.push({ url: target, options });
    if (target === `${issuer}/.well-known/openid-configuration`)
      return jsonResponse({
        issuer,
        authorization_endpoint: `${issuer}/api/accounts/authorize`,
        token_endpoint: `${issuer}/api/accounts/oauth/token`,
        jwks_uri: `${issuer}/.well-known/jwks.json`,
      });
    if (target === `${issuer}/.well-known/jwks.json`)
      return jsonResponse({ keys: [jwk] });
    if (target === `${issuer}/api/accounts/oauth/token`) {
      const body = new URLSearchParams(options.body);
      if (body.get("grant_type") === "refresh_token") {
        refreshCount += 1;
        return jsonResponse({
          access_token: "new-access-token-for-unit-test",
          refresh_token: "rotated-refresh-token-for-unit-test",
          expires_in: 3600,
        });
      }
      assert.equal(body.get("grant_type"), "authorization_code");
      assert.equal(body.get("client_id"), clientId);
      assert.equal(body.get("resource"), "https://api.openai.com/v1");
      assert.ok(body.get("code_verifier"));
      const now = Math.floor(Date.now() / 1000);
      const idToken = await new SignJWT({ nonce })
        .setProtectedHeader({ alg: "RS256", kid: jwk.kid })
        .setIssuer(issuer)
        .setAudience([clientId])
        .setSubject("omni-test-subject")
        .setIssuedAt(now)
        .setExpirationTime(now + 3600)
        .sign(privateKey);
      return jsonResponse({
        access_token: "unit-access-token-never-log",
        refresh_token: "unit-refresh-token-never-log",
        id_token: idToken,
        scope,
        expires_in: expiresIn,
      });
    }
    throw new Error("Unexpected URL in OAuth unit test");
  };
  const auth = new OpenAIAuth({
    dataDir,
    secretStore: new SecretStore({
      entryFactory: (service, account) => {
        assert.equal(service, "Omni OpenAI ChatGPT OAuth");
        assert.equal(account, "default");
        return entry;
      },
    }),
    fetchImpl,
    openBrowser: async (rawUrl) => {
      const authorization = new URL(rawUrl);
      nonce = authorization.searchParams.get("nonce");
      assert.equal(authorization.searchParams.get("scope"), scope);
      assert.equal(
        authorization.searchParams.get("code_challenge_method"),
        "S256",
      );
      assert.match(
        authorization.searchParams.get("code_challenge"),
        /^[\w-]+$/,
      );
      const callback = new URL(authorization.searchParams.get("redirect_uri"));
      callback.pathname = "/auth/callback";
      callback.searchParams.set(
        "state",
        badState ? "wrong-state" : authorization.searchParams.get("state"),
      );
      callback.searchParams.set("code", "single-use-code-unit-test");
      callback.searchParams.set("client_id", clientId);
      const response = await fetch(callback);
      assert.equal(response.status, badState ? 400 : 200);
    },
  });
  return { auth, dataDir, entry, calls, getRefreshCount: () => refreshCount };
}

test("OpenAI OAuth uses PKCE, validates array audience and stores tokens only through the keyring", async () => {
  const flow = await createFlow();
  try {
    const result = await flow.auth.login();
    assert.equal(result.connected, true);
    assert.deepEqual(result.scopes, scope.split(" "));
    assert.equal(flow.auth.hasCredentials(), true);
    assert.equal(
      await flow.auth.getAccessToken(),
      "unit-access-token-never-log",
    );
    const hostId = readFileSync(join(flow.dataDir, "openai-host-id"), "utf8");
    assert.match(hostId, /^urn:uuid:/);
    assert.doesNotMatch(hostId, /unit-access-token|unit-refresh-token/);
    assert.equal(
      flow.entry.value.includes("unit-access-token-never-log"),
      true,
    );
    assert.equal(
      flow.entry.value.includes("unit-refresh-token-never-log"),
      true,
    );
    assert.ok(
      flow.calls.some(({ url }) => url.endsWith("/.well-known/jwks.json")),
    );
  } finally {
    rmSync(flow.dataDir, { recursive: true, force: true });
  }
});

test("OpenAI OAuth refresh rotates credentials and avoids duplicate concurrent refreshes", async () => {
  const flow = await createFlow({ expiresIn: 1 });
  try {
    await flow.auth.login();
    const accessTokens = await Promise.all([
      flow.auth.getAccessToken(),
      flow.auth.getAccessToken(),
      flow.auth.getAccessToken(),
    ]);
    assert.deepEqual(
      accessTokens,
      Array(3).fill("new-access-token-for-unit-test"),
    );
    assert.equal(flow.getRefreshCount(), 1);
    assert.match(flow.entry.value, /rotated-refresh-token-for-unit-test/);
  } finally {
    rmSync(flow.dataDir, { recursive: true, force: true });
  }
});

test("OpenAI API key is isolated from OAuth and passed to the official client", () => {
  const values = new Map();
  const dataDir = mkdtempSync(join(tmpdir(), "omni-openai-api-key-"));
  const secretStore = {
    get: (service, account) => values.get(`${service}/${account}`) ?? null,
    set: (service, account, value) =>
      values.set(`${service}/${account}`, value),
    delete: (service, account) => values.delete(`${service}/${account}`),
  };
  const auth = new OpenAIAuth({ dataDir, secretStore });
  const apiKey = "unit-api-key-value-without-prefix";
  const clientFactory = (received) => ({ apiKey: received });
  try {
    auth.setApiKey(apiKey);
    assert.equal(auth.hasApiKey(), true);
    assert.equal(auth.getApiKey(), apiKey);
    assert.equal(auth.hasCredentials(), false);
    const chat = new OpenAIChat({ apiKey: auth.getApiKey(), clientFactory });
    assert.equal(chat.client.apiKey, apiKey);
    assert.throws(() => auth.setApiKey("two\nlines"), /une seule ligne/);
    assert.throws(() => auth.setApiKey(""), /une seule ligne/);
    assert.equal(auth.deleteApiKey(), true);
    assert.equal(auth.getApiKey(), null);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("OpenAI reauthorization reuses the registered client and stable host identifier", async () => {
  const flow = await createFlow();
  try {
    await flow.auth.login();
    const credentialBefore = JSON.parse(flow.entry.value);
    await flow.auth.login();
    const credentialAfter = JSON.parse(flow.entry.value);
    assert.equal(credentialAfter.clientId, clientId);
    assert.equal(credentialAfter.hostId, credentialBefore.hostId);
    assert.equal(Object.hasOwn(credentialAfter, "idToken"), false);
  } finally {
    rmSync(flow.dataDir, { recursive: true, force: true });
  }
});

test("OpenAI OAuth rejects a callback with a mismatched state without saving credentials", async () => {
  const flow = await createFlow({ badState: true });
  try {
    await assert.rejects(flow.auth.login(), /ne correspond pas/);
    assert.equal(flow.auth.hasCredentials(), false);
    assert.equal(
      flow.calls.some(({ url }) => url.endsWith("/oauth/token")),
      false,
    );
  } finally {
    rmSync(flow.dataDir, { recursive: true, force: true });
  }
});

test("legacy retained ID tokens are removed from the system-keyring profile", async () => {
  const flow = await createFlow();
  try {
    flow.entry.value = JSON.stringify({
      clientId,
      hostId: "urn:uuid:00000000-0000-4000-8000-000000000000",
      accessToken: "access-token-for-migration-test",
      refreshToken: "refresh-token-for-migration-test",
      idToken: "old-oidc-id-token-for-migration-test",
      expiresAt: Date.now() + 3600000,
      scopes: scope.split(" "),
    });
    assert.equal(flow.auth.hasCredentials(), true);
    const saved = JSON.parse(flow.entry.value);
    assert.equal(Object.hasOwn(saved, "idToken"), false);
    assert.equal(saved.accessToken, "access-token-for-migration-test");
  } finally {
    rmSync(flow.dataDir, { recursive: true, force: true });
  }
});

test("OpenAI OAuth chat requests the account model catalog and disables response storage", async () => {
  const requests = [];
  const oauth = { getAccessToken: async () => "access-token-unit-test" };
  const chat = new OpenAIChat({
    oauth,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return jsonResponse({
        models: [
          { slug: "gpt-visible", visibility: "list" },
          { slug: "gpt-hidden", visibility: "hidden" },
        ],
      });
    },
    clientFactory: () => ({
      responses: {
        create: async (input) => {
          requests.push({ input });
          return {
            controller: { abort() {} },
            async *[Symbol.asyncIterator]() {
              yield { type: "response.output_text.delta", delta: "réponse" };
              yield { type: "response.completed" };
            },
          };
        },
      },
    }),
  });
  assert.deepEqual(await chat.listModels(), ["gpt-visible"]);
  let streamed = "";
  assert.equal(
    await chat.stream({
      model: "gpt-visible",
      messages: [{ role: "user", content: "bonjour" }],
      onDelta: (delta) => (streamed += delta),
    }),
    "réponse",
  );
  assert.equal(streamed, "réponse");
  assert.equal(
    requests[0].options.headers.authorization,
    "Bearer access-token-unit-test",
  );
  assert.equal(requests[1].input.store, false);
  assert.equal(requests[1].input.stream, true);
});

test(
  "system keyring stores and removes a transient secret",
  { skip: process.env.OMNI_LIVE_KEYRING_TESTS !== "1" },
  () => {
    const account = `test-${process.pid}-${Date.now()}`;
    const entry = new Entry("Omni OAuth integration test", account);
    const secret = `transient-${randomUUID()}`;
    try {
      entry.setPassword(secret);
      assert.equal(entry.getPassword(), secret);
    } finally {
      entry.deletePassword();
    }
    assert.equal(entry.getPassword(), null);
  },
);
