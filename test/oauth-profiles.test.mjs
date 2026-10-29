import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { OAuthProfiles } from "../src/oauth-profiles.mjs";
import { codexAuthStatus, startCodexLogin } from "../src/codex-chat.mjs";
import { claudeAuthStatus, startClaudeLogin } from "../src/claude-code.mjs";

test("OAuth profiles isolate Codex and Claude homes and persist only profile names", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "omni-oauth-profiles-"));
  try {
    const profiles = new OAuthProfiles({ dataDir });
    assert.equal(profiles.active("codex"), "default");
    const codexEnv = profiles.environment("codex", "work");
    const claudeEnv = profiles.environment("claude", "work");
    assert.equal(codexEnv.CODEX_HOME, join(dataDir, "oauth", "codex", "work"));
    assert.equal(
      claudeEnv.CLAUDE_CONFIG_DIR,
      join(dataDir, "oauth", "claude", "work"),
    );
    profiles.use("codex", "work");
    assert.deepEqual(profiles.list("codex"), {
      profiles: ["default", "work"],
      active: "work",
    });
    assert.equal(
      JSON.stringify(
        JSON.parse(readFileSync(join(dataDir, "oauth-profiles.json"))),
      ),
      '{"version":1,"active":{"codex":"work"},"profiles":{"codex":["default","work"]}}',
    );
    assert.equal(
      statSync(join(dataDir, "oauth-profiles.json")).mode & 0o777,
      0o600,
    );
    assert.equal(statSync(codexEnv.CODEX_HOME).mode & 0o777, 0o700);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("OAuth profile names and providers are strictly validated", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "omni-oauth-profile-validation-"));
  try {
    const profiles = new OAuthProfiles({ dataDir });
    assert.throws(
      () => profiles.use("codex", "../outside"),
      /profil OAuth invalide/i,
    );
    assert.throws(
      () => profiles.use("antigravity", "work"),
      /Fournisseur OAuth invalide/i,
    );
    assert.throws(
      () => profiles.environment("claude", "Work Profile"),
      /profil OAuth invalide/i,
    );
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("Codex and Claude login/status commands receive the isolated profile environment", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "omni-oauth-profile-env-"));
  try {
    const executable = join(dataDir, "provider-cli");
    const trace = join(dataDir, "received-env.txt");
    writeFileSync(
      executable,
      '#!/bin/sh\nprintf "%s|%s" "$CODEX_HOME" "$CLAUDE_CONFIG_DIR" > "$TRACE"\n',
      { mode: 0o700 },
    );
    chmodSync(executable, 0o700);
    const profiles = new OAuthProfiles({ dataDir: join(dataDir, "omni") });
    const codexEnv = {
      ...profiles.environment("codex", "work"),
      TRACE: trace,
    };
    assert.equal(
      codexAuthStatus({ executable, env: codexEnv }).authenticated,
      true,
    );
    assert.equal(readFileSync(trace, "utf8"), `${codexEnv.CODEX_HOME}|`);
    assert.equal(
      startCodexLogin({ executable, env: codexEnv, stdio: "ignore" }).status,
      0,
    );
    assert.equal(readFileSync(trace, "utf8"), `${codexEnv.CODEX_HOME}|`);

    const claudeEnv = {
      ...profiles.environment("claude", "work"),
      TRACE: trace,
    };
    assert.equal(
      claudeAuthStatus({ executable, env: claudeEnv }).authenticated,
      true,
    );
    assert.equal(
      readFileSync(trace, "utf8"),
      `|${claudeEnv.CLAUDE_CONFIG_DIR}`,
    );
    assert.equal(
      startClaudeLogin({ executable, env: claudeEnv, stdio: "ignore" }).status,
      0,
    );
    assert.equal(
      readFileSync(trace, "utf8"),
      `|${claudeEnv.CLAUDE_CONFIG_DIR}`,
    );
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("removing a named OAuth profile deletes only its Omni directory and selects default", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "omni-oauth-profile-remove-"));
  try {
    const profiles = new OAuthProfiles({ dataDir });
    const env = profiles.environment("codex", "work");
    profiles.use("codex", "work");
    assert.equal(profiles.remove("codex", "work"), true);
    assert.equal(profiles.active("codex"), "default");
    assert.deepEqual(profiles.list("codex").profiles, ["default"]);
    assert.equal(
      statSync(env.CODEX_HOME, { throwIfNoEntry: false }),
      undefined,
    );
    assert.throws(
      () => profiles.remove("codex", "default"),
      /ne peut pas être supprimé/i,
    );
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
