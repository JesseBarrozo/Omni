import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { SecretStore } from "../src/secret-store.mjs";

class MemoryEntry {
  value = null;
  getPassword() {
    return this.value;
  }
  setPassword(value) {
    this.value = value;
  }
  deletePassword() {
    if (this.value === null) return false;
    this.value = null;
    return true;
  }
}

test("SecretStore validates identities and provides get/set/replace/delete", () => {
  const entry = new MemoryEntry();
  const calls = [];
  const store = new SecretStore({
    entryFactory: (service, account) => {
      calls.push([service, account]);
      return entry;
    },
  });
  assert.equal(store.get("Omni OpenAI ChatGPT OAuth", "default"), null);
  store.set("Omni OpenAI ChatGPT OAuth", "default", "first-secret");
  assert.equal(
    store.get("Omni OpenAI ChatGPT OAuth", "default"),
    "first-secret",
  );
  store.set("Omni OpenAI ChatGPT OAuth", "default", "replacement-secret");
  assert.equal(
    store.get("Omni OpenAI ChatGPT OAuth", "default"),
    "replacement-secret",
  );
  assert.equal(store.delete("Omni OpenAI ChatGPT OAuth", "default"), true);
  assert.equal(store.delete("Omni OpenAI ChatGPT OAuth", "default"), false);
  assert.ok(
    calls.every(
      ([service, account]) =>
        service === "Omni OpenAI ChatGPT OAuth" && account === "default",
    ),
  );
  assert.throws(
    () => store.get("../invalid", "account"),
    /Identifiant.*invalide/,
  );
  assert.throws(() => store.set("service", "account", ""), /non vide/);
});

test("SecretStore never exposes native keyring errors or secret contents", () => {
  const secret = "native-error-must-not-leak";
  const store = new SecretStore({
    entryFactory: () => {
      throw new Error(secret);
    },
  });
  assert.throws(
    () => store.get("service", "account"),
    (error) => {
      assert.match(error.message, /trousseau système est inaccessible/);
      assert.doesNotMatch(error.message, new RegExp(secret));
      assert.equal(error.cause, undefined);
      return true;
    },
  );
});

test(
  "system SecretStore persists and deletes a transient secret",
  { skip: process.env.OMNI_LIVE_KEYRING_TESTS !== "1", timeout: 30_000 },
  () => {
    const service = "Omni SecretStore integration test";
    const account = `test-${process.pid}-${randomUUID()}`;
    const store = new SecretStore();
    const secret = `transient-${randomUUID()}`;
    try {
      store.set(service, account, secret);
      assert.equal(store.get(service, account), secret);
    } finally {
      store.delete(service, account);
    }
    assert.equal(store.get(service, account), null);
  },
);
