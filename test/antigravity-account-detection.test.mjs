import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectAntigravityAccount } from "../src/account-detection.mjs";

test("detects the native Antigravity account without returning credentials", () => {
  const home = mkdtempSync(join(tmpdir(), "omni-antigravity-account-"));
  try {
    const dir = join(home, ".gemini", "antigravity-cli");
    mkdirSync(dir, { recursive: true });
    const claims = Buffer.from(JSON.stringify({ iss: "https://accounts.google.com", sub: "account-id", email: "user@example.test", email_verified: true })).toString("base64url");
    writeFileSync(join(dir, "antigravity-oauth-token"), JSON.stringify({ auth_method: "consumer", token: { access_token: "secret" }, id_token: `header.${claims}.signature` }));
    const account = detectAntigravityAccount({ home, env: { SSH_TTY: "1" } });
    assert.deepEqual(account, { id: "account-id", email: "user@example.test", authMode: "oauth" });
    assert.equal(JSON.stringify(account).includes("secret"), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
