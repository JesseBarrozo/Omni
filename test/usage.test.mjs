import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { USAGE_PROVIDERS, buildUsageSnapshot } from "../src/usage.mjs";

describe("USAGE_PROVIDERS", () => {
  it("covers the providers Omni can authenticate", () => {
    const ids = USAGE_PROVIDERS.map((p) => p.id);
    assert.deepEqual(ids, ["claude", "openai", "gemini", "openrouter"]);
    for (const p of USAGE_PROVIDERS) assert.ok(p.label && Array.isArray(p.authKinds));
  });
});

describe("buildUsageSnapshot", () => {
  const at = new Date("2026-10-30T12:00:00Z");

  it("marks a provider configured when any credential is present, else not-configured", () => {
    const snapshot = buildUsageSnapshot(
      {
        claude: { apiKey: false, oauth: true },
        openai: { apiKey: true, oauth: false },
        gemini: { apiKey: false, oauth: false },
        openrouter: { apiKey: false, oauth: false },
      },
      at,
    );
    const byId = Object.fromEntries(snapshot.providers.map((p) => [p.id, p]));
    assert.equal(byId.claude.configured, true);
    assert.deepEqual(byId.claude.authKinds, ["oauth"]);
    assert.equal(byId.claude.status, "unavailable");
    assert.equal(byId.openai.configured, true);
    assert.deepEqual(byId.openai.authKinds, ["api-key"]);
    assert.equal(byId.gemini.configured, false);
    assert.equal(byId.gemini.status, "not-configured");
    assert.deepEqual(byId.gemini.windows, []);
  });

  it("never invents usage windows in phase A", () => {
    const snapshot = buildUsageSnapshot(
      { claude: { apiKey: true, oauth: true } },
      at,
    );
    for (const provider of snapshot.providers) assert.deepEqual(provider.windows, []);
    assert.equal(snapshot.updatedAt, at.toISOString());
  });

  it("lists both auth kinds when present, oauth first", () => {
    const snapshot = buildUsageSnapshot({ claude: { apiKey: true, oauth: true } }, at);
    assert.deepEqual(snapshot.providers.find((p) => p.id === "claude").authKinds, ["oauth", "api-key"]);
  });
});
