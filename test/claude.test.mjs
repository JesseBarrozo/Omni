import test from "node:test";
import assert from "node:assert/strict";
import {
  ClaudeCodeHarness,
  ClaudeCodeChat,
  claudeAuthStatus,
} from "../src/claude-code.mjs";
import { assertHarnessAdapter } from "../src/adapters.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatStore } from "../src/chat-store.mjs";

test("Claude auth status hides CLI output and handles missing CLI", () => {
  assert.deepEqual(claudeAuthStatus({ executable: "/missing/omni-claude" }), {
    provider: "claude",
    authenticated: false,
  });
});

test("Claude harness satisfies the adapter contract and denies tools by default", async () => {
  const harness = new ClaudeCodeHarness({
    requestPermission: async () => false,
  });
  assert.equal(assertHarnessAdapter(harness), harness);
  assert.deepEqual(await harness.capabilities(), {
    tools: true,
    streaming: true,
    checkpoint: true,
    permissions: true,
    resume: true,
  });
  await harness.dispose();
});

test("Claude sessions are not recorded as started before the SDK initializes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omni-claude-session-"));
  const store = new ChatStore(join(dir, "omni.sqlite"));
  const project = store.createProject("Claude sessions", dir);
  const conversation = store.createConversation(
    project.id,
    "Session state",
    "claude",
  );
  const harness = new ClaudeCodeHarness({ store, cwd: dir });
  try {
    const created = await harness.createSession({
      conversationId: conversation.id,
    });
    assert.equal(created.newSession, true);
    assert.equal(
      store
        .listEvents(conversation.id)
        .filter((event) => event.type === "session.started").length,
      0,
    );
    const resumed = await harness.resumeSession(created.id, {
      conversationId: conversation.id,
    });
    assert.equal(resumed.newSession, false);
  } finally {
    await harness.dispose();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Claude model listing requires its official logged-in CLI account", async () => {
  const chat = new ClaudeCodeChat({
    store: {},
    executable: "/missing/omni-claude",
  });
  await assert.rejects(chat.listModels(), /omni auth login claude/);
});

test(
  "real Claude OAuth chat streams and resumes the same session after database restart",
  { skip: process.env.OMNI_LIVE_CLAUDE_TESTS !== "1" },
  async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { ChatStore } = await import("../src/chat-store.mjs");
    const { runChatTurn } = await import("../src/chat-runner.mjs");
    const dir = mkdtempSync(join(tmpdir(), "omni-claude-live-"));
    const dbPath = join(dir, "omni.sqlite");
    let store;
    try {
      store = new ChatStore(dbPath);
      const project = store.createProject("Claude OAuth integration", dir);
      const conversation = store.createConversation(
        project.id,
        "Claude OAuth",
        "claude",
      );
      const first = await runChatTurn({
        store,
        provider: new ClaudeCodeChat({ store, cwd: dir }),
        conversationId: conversation.id,
        model: "claude",
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
            event.payload.harnessId === "claude-code",
        )?.payload.sessionId;
      assert.ok(firstSession);
      store.close();

      store = new ChatStore(dbPath);
      const deltas = [];
      const second = await runChatTurn({
        store,
        provider: new ClaudeCodeChat({ store, cwd: dir }),
        conversationId: conversation.id,
        model: "claude",
        prompt:
          "What exact word did I ask you to remember? Reply with that word only.",
        signal: new AbortController().signal,
        onDelta: (delta) => deltas.push(delta),
      });
      assert.equal(second.status, "completed");
      assert.match(second.answer.toLowerCase(), /marigold/);
      assert.ok(deltas.length > 0);
      const sessions = store
        .listEvents(conversation.id)
        .filter(
          (event) =>
            event.type === "session.started" &&
            event.payload.harnessId === "claude-code",
        );
      assert.equal(sessions.length, 1);
      assert.equal(sessions[0].payload.sessionId, firstSession);
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

test(
  "real Claude harness requests approval before its first file write",
  { skip: process.env.OMNI_LIVE_CLAUDE_TESTS !== "1" },
  async () => {
    const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { ChatStore } = await import("../src/chat-store.mjs");
    const dir = mkdtempSync(join(tmpdir(), "omni-claude-harness-live-"));
    const file = join(dir, "approved-by-omni.txt");
    const store = new ChatStore(join(dir, "omni.sqlite"));
    const project = store.createProject("Claude harness integration", dir);
    const conversation = store.createConversation(
      project.id,
      "Permission test",
      "claude",
    );
    let approvedWrites = 0;
    const harness = new ClaudeCodeHarness({
      store,
      cwd: dir,
      requestPermission: async ({ toolName, input }) => {
        if (
          toolName !== "Write" ||
          input.file_path !== file ||
          approvedWrites > 0
        )
          return false;
        approvedWrites += 1;
        return true;
      },
    });
    try {
      await harness.initialize();
      const events = [];
      for await (const event of harness.run({
        conversationId: conversation.id,
        prompt: `Use the Write tool exactly once to create ${file} with the exact contents APPROVED. Do not call any other tools.`,
        signal: new AbortController().signal,
      }))
        events.push(event);
      assert.equal(approvedWrites, 1);
      assert.equal(readFileSync(file, "utf8"), "APPROVED");
      assert.equal(
        store
          .listEvents(conversation.id)
          .filter((event) => event.type === "permission.requested").length,
        1,
      );
      assert.equal(
        store
          .listEvents(conversation.id)
          .filter((event) => event.type === "permission.granted").length,
        1,
      );
      assert.equal(
        store
          .listEvents(conversation.id)
          .filter((event) => event.type === "tool.started").length,
        1,
      );
      assert.equal(
        store
          .listEvents(conversation.id)
          .filter((event) => event.type === "file.changed").length,
        1,
      );
      assert.ok(
        events.some(
          (event) =>
            event.type === "tool.started" && event.payload.toolName === "Write",
        ),
      );
      assert.ok(events.some((event) => event.type === "session.completed"));
    } finally {
      await harness.dispose();
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
