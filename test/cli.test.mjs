import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ChatStore } from "../src/chat-store.mjs";

const cli = fileURLToPath(new URL("../bin/omni.mjs", import.meta.url));

test("CLI persists projects and resumes with the saved or explicitly changed model", () => {
  const dir = mkdtempSync(join(tmpdir(), "omni-cli-"));
  const env = { ...process.env, OMNI_DATA_DIR: join(dir, "data") };
  const run = (...args) =>
    spawnSync(process.execPath, [cli, ...args], { env, encoding: "utf8" });
  try {
    const created = run("project", "create", "--name", "cli-test");
    assert.equal(created.status, 0, created.stderr);
    const project = JSON.parse(created.stdout);
    const status = run("status", "--json");
    assert.equal(status.status, 0, status.stderr);
    assert.equal(JSON.parse(status.stdout).projects[0].id, project.id);

    const store = new ChatStore(join(dir, "data", "omni.sqlite"));
    const conversation = store.createConversation(
      project.id,
      "resume",
      "saved-model",
    );
    store.addMessage(conversation.id, "user", "saved prompt");
    store.close();
    const exported = run("conversation", "export", conversation.id);
    assert.equal(exported.status, 0, exported.stderr);
    const record = JSON.parse(exported.stdout);
    assert.equal(record.conversation.messages[0].content, "saved prompt");
    assert.ok(
      record.events.some((event) => event.type === "conversation.created"),
    );
    const exportFile = join(dir, "export.json");
    writeFileSync(exportFile, exported.stdout);
    const imported = run(
      "conversation",
      "import",
      "--project",
      project.id,
      exportFile,
    );
    assert.equal(imported.status, 0, imported.stderr);
    const importedConversation = JSON.parse(imported.stdout);
    assert.notEqual(importedConversation.id, conversation.id);
    assert.equal(importedConversation.messages[0].content, "saved prompt");
    const importedEvents = run(
      "conversation",
      "export",
      importedConversation.id,
    );
    assert.equal(importedEvents.status, 0, importedEvents.stderr);
    assert.ok(
      JSON.parse(importedEvents.stdout).events.some(
        (event) => event.type === "conversation.imported",
      ),
    );
    const resumed = run("resume", conversation.id);
    assert.equal(resumed.status, 1);
    assert.match(resumed.stdout, /modèle saved-model/);
    assert.match(resumed.stderr, /OPENAI_API_KEY est requis/);
    assert.doesNotMatch(
      `${resumed.stdout}${resumed.stderr}`,
      /sk-[A-Za-z0-9_-]{12,}/,
    );

    const changed = run("resume", conversation.id, "--model", "new-model");
    assert.equal(changed.status, 1);
    const verify = new ChatStore(join(dir, "data", "omni.sqlite"));
    assert.equal(verify.conversation(conversation.id).modelId, "new-model");
    verify.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
