import assert from "node:assert/strict";
import test from "node:test";
import { ApiKeyProfiles } from "../src/api-key-profiles.mjs";

function memorySecretStore(entries = new Map()) {
  return {
    entries,
    get: (service, account) => entries.get(`${service}:${account}`) ?? null,
    set: (service, account, value) =>
      entries.set(`${service}:${account}`, value),
    delete: (service, account) => entries.delete(`${service}:${account}`),
  };
}

test("named API key profiles preserve the legacy default key identity", () => {
  const secretStore = memorySecretStore(
    new Map([["Omni Provider API Key:default", "legacy-secret-value"]]),
  );
  const profiles = new ApiKeyProfiles({
    serviceName: "Omni Provider API Key",
    providerName: "Provider",
    secretStore,
  });

  assert.deepEqual(profiles.listApiKeyProfiles(), {
    profiles: ["default"],
    active: "default",
  });
  assert.equal(profiles.getApiKey(), "legacy-secret-value");

  profiles.setApiKey("workspace-secret-value", "workspace");
  profiles.setApiKey("billing-secret-value", "billing");
  assert.deepEqual(profiles.listApiKeyProfiles(), {
    profiles: ["default", "workspace", "billing"],
    active: "default",
  });
  assert.equal(profiles.useApiKeyProfile("workspace"), "workspace");
  assert.equal(profiles.getApiKey(), "workspace-secret-value");
  assert.equal(profiles.deleteApiKey(), true);
  assert.deepEqual(profiles.listApiKeyProfiles(), {
    profiles: ["default", "billing"],
    active: "default",
  });
  assert.equal(profiles.getApiKey(), "legacy-secret-value");

  const registry = secretStore.get(
    "Omni Provider API Key Profiles",
    "registry",
  );
  assert.equal(registry.includes("secret-value"), false);
  assert.equal(profiles.deleteApiKey("default"), true);
  assert.deepEqual(profiles.listApiKeyProfiles(), {
    profiles: ["billing"],
    active: "billing",
  });
});

test("API key profiles validate names and reject missing active profiles", () => {
  const profiles = new ApiKeyProfiles({
    serviceName: "Omni Provider API Key",
    providerName: "Provider",
    secretStore: memorySecretStore(),
  });
  assert.equal(profiles.hasApiKey(), false);
  assert.throws(
    () => profiles.setApiKey("secret", "../escape"),
    /profil Provider/i,
  );
  assert.throws(() => profiles.setApiKey("bad\nsecret"), /une seule ligne/);
  assert.throws(() => profiles.useApiKeyProfile("missing"), /n’existe pas/);
  assert.equal(profiles.deleteApiKey(), false);
});

test("API key profiles refuse malformed private indexes", () => {
  const secretStore = memorySecretStore(
    new Map([
      [
        "Omni Provider API Key Profiles:registry",
        JSON.stringify({
          version: 1,
          profiles: ["valid", "valid"],
          active: "valid",
        }),
      ],
    ]),
  );
  const profiles = new ApiKeyProfiles({
    serviceName: "Omni Provider API Key",
    providerName: "Provider",
    secretStore,
  });
  assert.throws(() => profiles.listApiKeyProfiles(), /registre.*invalide/i);
});
