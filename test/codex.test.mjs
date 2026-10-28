import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatStore } from "../src/chat-store.mjs";
import { runChatTurn } from "../src/chat-runner.mjs";
import { CodexChat, codexAuthStatus } from "../src/codex-chat.mjs";

test("Codex auth status never exposes CLI output and handles a missing CLI", () => {
  assert.deepEqual(codexAuthStatus({ executable: "/missing/omni-codex" }), {
    provider: "codex",
    authenticated: false,
  });
});

test(
  "real Codex OAuth chat streams and resumes the same session after database restart",
  {
    skip: process.env.OMNI_LIVE_CODEX_TESTS !== "1",
  },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "omni-codex-live-"));
    const dbPath = join(dir, "omni.sqlite");
    let store;
    try {
      store = new ChatStore(dbPath);
      const project = store.createProject("Codex OAuth integration", dir);
      const conversation = store.createConversation(
        project.id,
        "Codex OAuth",
        "codex",
      );
      const first = await runChatTurn({
        store,
        provider: new CodexChat({ store, cwd: dir }),
        conversationId: conversation.id,
        model: "codex",
        prompt: "Remember the exact word: marigold. Reply only READY.",
        signal: new AbortController().signal,
      });
      assert.equal(first.status, "completed");
      assert.match(first.answer, /READY/i);
      const firstSession = store
        .listEvents(conversation.id)
        .find(
          (event) =>
            event.type === "session.started" &&
            event.payload.harnessId === "codex",
        )?.payload.sessionId;
      assert.ok(firstSession);
      store.close();

      store = new ChatStore(dbPath);
      const deltas = [];
      const second = await runChatTurn({
        store,
        provider: new CodexChat({ store, cwd: dir }),
        conversationId: conversation.id,
        model: "codex",
        prompt:
          "What exact word did I ask you to remember? Reply with that word only.",
        signal: new AbortController().signal,
        onDelta: (delta) => deltas.push(delta),
      });
      assert.equal(second.status, "completed");
      assert.match(second.answer.toLowerCase(), /marigold/);
      assert.ok(deltas.length > 0, "Codex response should stream deltas");
      const sessions = store
        .listEvents(conversation.id)
        .filter(
          (event) =>
            event.type === "session.started" &&
            event.payload.harnessId === "codex",
        );
      assert.equal(
        sessions.length,
        1,
        "resuming must keep the original Codex thread",
      );
      assert.equal(sessions[0].payload.sessionId, firstSession);
      const persisted = store
        .conversation(conversation.id)
        .messages.at(-1).content;
      assert.match(persisted.toLowerCase(), /marigold/);
      assert.doesNotMatch(
        JSON.stringify(store.exportConversation(conversation.id)),
        /sk-[A-Za-z0-9_-]{12,}|Bearer\s+\S+/,
      );
    } finally {
      store?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
