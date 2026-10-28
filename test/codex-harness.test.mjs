import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ChatStore } from "../src/chat-store.mjs";
import { CodexHarness } from "../src/codex-chat.mjs";
import { assertHarnessAdapter } from "../src/adapters.mjs";

test("CodexHarness satisfies the adapter contract and reports real capabilities", async () => {
  const harness = new CodexHarness({ store: {} });
  assert.equal(assertHarnessAdapter(harness), harness);
  assert.deepEqual(await harness.capabilities(), {
    tools: true,
    streaming: true,
    checkpoint: true,
    permissions: true,
    resume: true,
  });
  await assert.rejects(harness.checkpoint("missing"), /Session Codex inconnue/);
  await harness.dispose();
});

test(
  "real Codex app-server requests approval for a temporary write and resumes after database restart",
  { skip: process.env.OMNI_LIVE_CODEX_HARNESS_TESTS !== "1" },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "omni-codex-harness-live-"));
    const dbPath = join(dir, "omni.sqlite");
    const file = join(dir, "approved-by-omni.txt");
    execFileSync("git", ["init", "--quiet"], { cwd: dir });
    let store;
    let harness;
    try {
      store = new ChatStore(dbPath);
      const project = store.createProject("Codex real harness", dir);
      const conversation = store.createConversation(
        project.id,
        "Codex permission and resume",
        "codex",
      );
      let approved = 0;
      const requestPermission = async ({ method, params }) => {
        if (method === "item/fileChange/requestApproval") {
          const paths = (params.changes ?? []).map((change) =>
            resolve(change.path),
          );
          if (paths.length === 1 && paths[0] === file) {
            approved += 1;
            return true;
          }
        }
        if (method === "item/permissions/requestApproval") {
          const requestedWrites = params.permissions?.fileSystem?.write ?? [];
          const normalized = requestedWrites.map((path) => resolve(path));
          if (
            normalized.length > 0 &&
            normalized.every((path) => path === dir || path === file)
          ) {
            approved += 1;
            return true;
          }
        }
        return false;
      };
      harness = new CodexHarness({ store, cwd: dir, requestPermission });
      await harness.initialize();
      const session = await harness.createSession({
        conversationId: conversation.id,
      });
      const firstEvents = [];
      for await (const event of harness.run({
        conversationId: conversation.id,
        sessionId: session.id,
        prompt:
          "Create exactly one file named approved-by-omni.txt in this project containing the exact text omni-codex-write-ok. Do not run other commands or modify other files.",
        signal: new AbortController().signal,
      }))
        firstEvents.push(event);
      assert.ok(
        firstEvents.some((event) => event.type === "message.completed"),
        `Codex did not complete the write turn: ${JSON.stringify(firstEvents)}`,
      );
      await harness.checkpoint(session.id);
      assert.ok(
        existsSync(file),
        `Codex did not create the requested temporary file: ${JSON.stringify(firstEvents)}`,
      );
      assert.equal(readFileSync(file, "utf8").trim(), "omni-codex-write-ok");
      assert.ok(approved > 0, "Codex should ask Omni before write permission");
      assert.ok(
        firstEvents.some((event) => event.type === "message.completed"),
      );
      await harness.dispose();
      harness = null;
      store.close();
      store = new ChatStore(dbPath);

      harness = new CodexHarness({ store, cwd: dir, requestPermission });
      await harness.initialize();
      const resumedEvents = [];
      for await (const event of harness.run({
        conversationId: conversation.id,
        sessionId: session.id,
        prompt:
          "Read approved-by-omni.txt and reply with its exact contents only.",
        signal: new AbortController().signal,
      }))
        resumedEvents.push(event);
      const answer = resumedEvents
        .filter((event) => event.type === "message.delta")
        .map((event) => event.payload.delta)
        .join("");
      assert.match(answer, /omni-codex-write-ok/);
      assert.ok(
        resumedEvents.some((event) => event.type === "message.completed"),
      );
      const permissionEvents = store
        .listEvents(conversation.id)
        .filter((event) => event.type.startsWith("permission."));
      assert.ok(
        permissionEvents.some((event) => event.type === "permission.requested"),
      );
      assert.ok(
        permissionEvents.some((event) => event.type === "permission.granted"),
      );
      assert.equal(
        store
          .listEvents(conversation.id)
          .filter(
            (event) =>
              event.type === "session.started" &&
              event.payload.harnessId === "codex",
          ).length,
        1,
      );
      assert.doesNotMatch(
        JSON.stringify(store.exportConversation(conversation.id)),
        /Bearer\s+\S+|sk-[A-Za-z0-9_-]{12,}/,
      );
    } finally {
      await harness?.dispose();
      store?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
