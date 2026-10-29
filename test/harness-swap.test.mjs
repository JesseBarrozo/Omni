import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ChatStore } from "../src/chat-store.mjs";
import { CodexHarness, codexAuthStatus } from "../src/codex-chat.mjs";
import { ClaudeCodeHarness, claudeAuthStatus } from "../src/claude-code.mjs";
import {
  HarnessSwapService,
  buildResumeSummary,
} from "../src/harness-swap.mjs";

test("resume summary captures the persistent history, decisions, and Git state", () => {
  const summary = buildResumeSummary({
    conversation: { title: "task" },
    git: { available: true, branch: "main", head: "abc", status: " M x" },
    events: [
      { type: "message.created", payload: { role: "user", content: "Fix it" } },
      { type: "routing.decision", payload: { selected: "codex" } },
      {
        type: "tool.started",
        payload: {
          sessionId: "s1",
          toolName: "Codex file change",
          input: { changes: [{ path: "src/a.mjs" }] },
        },
      },
      { type: "file.changed", payload: { path: "src/a.mjs" } },
      {
        type: "tool.completed",
        payload: { sessionId: "s1", toolName: "Codex file change" },
      },
      {
        type: "tool.started",
        payload: {
          sessionId: "s1",
          toolName: "Codex command",
          input: { command: "npm test" },
        },
      },
      { type: "command.started", payload: { command: "npm test" } },
      { type: "command.completed", payload: { command: "npm test" } },
      { type: "session.failed", payload: { error: "failed" } },
    ],
  });
  assert.equal(summary.objective, "Fix it");
  assert.equal(summary.testsPerformed[0].command, "npm test");
  assert.equal(summary.filesModified[0].path, "src/a.mjs");
  assert.equal(summary.git.head, "abc");
  assert.equal(summary.errors[0].error, "failed");
});

test("resume summary keeps concurrent operations active until each ID resolves", () => {
  const summary = buildResumeSummary({
    conversation: { title: "task" },
    git: { available: false },
    events: [
      {
        type: "tool.started",
        payload: { sessionId: "s", toolUseId: "t1", toolName: "Bash" },
      },
      {
        type: "tool.started",
        payload: { sessionId: "s", toolUseId: "t2", toolName: "Bash" },
      },
      {
        type: "tool.completed",
        payload: { sessionId: "s", toolUseId: "t1", toolName: "Bash" },
      },
      {
        type: "permission.requested",
        payload: {
          sessionId: "s",
          requestId: "p1",
          toolName: "Bash",
          method: "approval",
        },
      },
      {
        type: "permission.requested",
        payload: {
          sessionId: "s",
          requestId: "p2",
          toolName: "Bash",
          method: "approval",
        },
      },
      {
        type: "permission.granted",
        payload: {
          sessionId: "s",
          requestId: "p1",
          toolName: "Bash",
          method: "approval",
        },
      },
      {
        type: "command.started",
        payload: { toolUseId: "c1", command: "npm test" },
      },
      {
        type: "command.started",
        payload: { toolUseId: "c2", command: "npm test" },
      },
      {
        type: "command.completed",
        payload: { toolUseId: "c1", command: "npm test" },
      },
    ],
  });
  assert.equal(summary.activeOperations.tools.length, 1);
  assert.equal(summary.permissions.active.length, 1);
  assert.equal(summary.activeOperations.commands.length, 1);
});

test("persistent swap checkpoints before creating the real target adapter session", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omni-swap-unit-"));
  const store = new ChatStore(join(dir, "omni.sqlite"));
  const project = store.createProject("swap", dir);
  const conversation = store.createConversation(project.id, "swap", "codex");
  store.addMessage(conversation.id, "user", "Continue safely");
  const calls = [];
  const adapter = {
    id: "target",
    async initialize() {
      calls.push("initialize");
    },
    async createSession(input) {
      calls.push({ kind: "createSession", input });
      return { id: "target-session", harnessId: "target" };
    },
  };
  try {
    const result = await new HarnessSwapService({
      store,
      adapters: new Map([["target", adapter]]),
      gitState: () => ({
        available: true,
        branch: "main",
        head: "abc",
        status: "",
      }),
    }).swap({
      conversationId: conversation.id,
      toHarnessId: "target",
      model: "target-model",
    });
    assert.equal(calls[0], "initialize");
    assert.equal(calls[1].kind, "createSession");
    assert.equal(calls[1].input.resumeSummary.objective, "Continue safely");
    const events = store.listEvents(conversation.id);
    assert.ok(events.find((event) => event.type === "session.checkpointed"));
    assert.equal(events.at(-2).type, "harness.changed");
    assert.equal(events.at(-1).type, "model.changed");
    assert.equal(result.session.id, "target-session");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("swap refuses running turns, unresolved permissions, and unfinished tools", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omni-swap-boundary-"));
  const store = new ChatStore(join(dir, "omni.sqlite"));
  const project = store.createProject("swap", dir);
  const conversation = store.createConversation(project.id, "swap", "codex");
  const adapter = {
    async initialize() {},
    async createSession() {
      throw new Error("must not initialize a target for an unsafe swap");
    },
  };
  const service = new HarnessSwapService({
    store,
    adapters: new Map([["target", adapter]]),
    gitState: () => ({ available: false }),
  });
  try {
    store.setStatus(conversation.id, "running");
    await assert.rejects(
      service.swap({ conversationId: conversation.id, toHarnessId: "target" }),
      /active/,
    );
    store.setStatus(conversation.id, "interrupted");
    store.appendEvent(conversation.id, "tool.started", {
      sessionId: "s1",
      toolName: "Write",
      input: { file_path: "unsafe.txt" },
    });
    await assert.rejects(
      service.swap({ conversationId: conversation.id, toHarnessId: "target" }),
      /tool or command is active/,
    );
    store.appendEvent(conversation.id, "tool.completed", {
      sessionId: "s1",
      toolName: "Write",
    });
    store.appendEvent(conversation.id, "permission.requested", {
      sessionId: "s1",
      toolName: "Write",
    });
    await assert.rejects(
      service.swap({ conversationId: conversation.id, toHarnessId: "target" }),
      /permission is unresolved/,
    );
    assert.equal(
      store
        .listEvents(conversation.id)
        .filter((event) => event.type === "harness.changed").length,
      0,
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test(
  "real Codex to Claude to Codex swap preserves files, context, Git state, and does not repeat writes",
  { skip: process.env.OMNI_LIVE_HARNESS_SWAP_TESTS !== "1" },
  async () => {
    assert.equal(
      codexAuthStatus().authenticated,
      true,
      "Codex OAuth must be connected",
    );
    assert.equal(
      claudeAuthStatus().authenticated,
      true,
      "Claude OAuth must be connected",
    );
    const dir = mkdtempSync(join(tmpdir(), "omni-live-swap-"));
    const dbPath = join(dir, "omni.sqlite");
    const file = join(dir, "swap-proof.txt");
    execFileSync("git", ["init", "-q", dir]);
    execFileSync("git", ["-C", dir, "config", "user.name", "Omni Test"]);
    execFileSync("git", [
      "-C",
      dir,
      "config",
      "user.email",
      "omni-test@example.invalid",
    ]);
    execFileSync("git", [
      "-C",
      dir,
      "commit",
      "--allow-empty",
      "-qm",
      "initial",
    ]);
    let store;
    let codex;
    let claude;
    try {
      store = new ChatStore(dbPath);
      const project = store.createProject("Live harness swap", dir);
      const conversation = store.createConversation(
        project.id,
        "Swap proof",
        "codex",
      );
      codex = new CodexHarness({
        store,
        cwd: dir,
        requestPermission: async ({ method, params }) =>
          method === "item/fileChange/requestApproval" &&
          params?.changes?.length === 1 &&
          params.changes[0].path === file,
      });
      claude = new ClaudeCodeHarness({
        store,
        cwd: dir,
        requestPermission: async ({ toolName, input }) =>
          toolName === "Read" && input.file_path === file,
      });
      await codex.initialize();
      const initialSession = await codex.createSession({
        conversationId: conversation.id,
        cwd: dir,
      });
      store.addMessage(conversation.id, "user", "Create the proof file once.");
      store.setStatus(conversation.id, "running");
      const firstEvents = [];
      for await (const event of codex.run({
        conversationId: conversation.id,
        sessionId: initialSession.id,
        prompt: `Use the file change tool once to create ${file} with exactly SWAP_ONCE. Do not run commands.`,
        signal: new AbortController().signal,
      }))
        firstEvents.push(event);
      store.setStatus(conversation.id, "completed");
      const firstCheckpoint = await codex.checkpoint(initialSession.id);
      assert.ok(firstCheckpoint);
      assert.ok(
        existsSync(file),
        JSON.stringify({
          events: firstEvents.map((event) => ({
            type: event.type,
            payload: event.payload,
          })),
          permissions: store
            .listEvents(conversation.id)
            .filter((event) => event.type.startsWith("permission.")),
        }),
      );
      assert.equal(readFileSync(file, "utf8").trim(), "SWAP_ONCE");

      const toClaude = await new HarnessSwapService({
        store,
        adapters: new Map([[claude.id, claude]]),
      }).swap({
        conversationId: conversation.id,
        toHarnessId: claude.id,
        model: "claude",
      });
      store.addMessage(
        conversation.id,
        "user",
        "Read the proof file and report its exact contents; do not modify it.",
      );
      store.setStatus(conversation.id, "running");
      let claudeText = "";
      for await (const event of claude.run({
        conversationId: conversation.id,
        sessionId: toClaude.session.id,
        prompt:
          "Read the proof file and report its exact contents; do not modify it.",
        signal: new AbortController().signal,
      })) {
        if (event.type === "message.delta") claudeText += event.payload.delta;
        if (event.type === "session.failed")
          throw new Error(event.payload.error);
      }
      store.setStatus(conversation.id, "completed");
      assert.match(claudeText, /SWAP_ONCE/);
      assert.equal(readFileSync(file, "utf8").trim(), "SWAP_ONCE");
      await claude.checkpoint(toClaude.session.id);

      const toCodex = await new HarnessSwapService({
        store,
        adapters: new Map([[codex.id, codex]]),
      }).swap({
        conversationId: conversation.id,
        toHarnessId: codex.id,
        model: "codex",
      });
      store.addMessage(
        conversation.id,
        "user",
        "Read the proof file and report its exact contents; do not modify it.",
      );
      store.setStatus(conversation.id, "running");
      let codexText = "";
      for await (const event of codex.run({
        conversationId: conversation.id,
        sessionId: toCodex.session.id,
        prompt:
          "Read the proof file and report its exact contents; do not modify it.",
        signal: new AbortController().signal,
      })) {
        if (event.type === "message.delta") codexText += event.payload.delta;
        if (event.type === "session.failed")
          throw new Error(event.payload.error);
      }
      store.setStatus(conversation.id, "completed");
      assert.match(codexText, /SWAP_ONCE/);
      assert.equal(readFileSync(file, "utf8").trim(), "SWAP_ONCE");
      const events = store.listEvents(conversation.id);
      assert.equal(
        events.filter((event) => event.type === "harness.changed").length,
        2,
      );
      assert.equal(
        events.filter((event) => event.type === "permission.granted").length,
        1,
      );
      assert.equal(
        events.filter((event) => event.type === "file.changed").length,
        1,
      );
      assert.ok(events.some((event) => event.type === "tool.started"));
      assert.ok(events.some((event) => event.type === "tool.completed"));
      assert.equal(
        events.filter((event) => event.type === "session.checkpointed")
          .length >= 3,
        true,
      );
      assert.match(
        events.find((event) => event.type === "harness.changed").payload
          .resumeSummary.git.status,
        /swap-proof.txt/,
      );
      assert.doesNotMatch(
        JSON.stringify(store.exportConversation(conversation.id)),
        /sk-[A-Za-z0-9_-]{12,}|Bearer\s+\S+/,
      );
      assert.ok(firstEvents.some((event) => event.type === "tool.started"));
    } finally {
      await codex?.dispose();
      await claude?.dispose();
      store?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "real omni swap CLI persists a Claude session and resumes it in a new process",
  { skip: process.env.OMNI_LIVE_HARNESS_SWAP_TESTS !== "1" },
  () => {
    assert.equal(
      claudeAuthStatus().authenticated,
      true,
      "Claude OAuth must be connected",
    );
    const dir = mkdtempSync(join(tmpdir(), "omni-live-swap-cli-"));
    const dataDir = join(dir, "omni-data");
    const dbPath = join(dataDir, "omni.sqlite");
    execFileSync("git", ["init", "-q", dir]);
    let store;
    try {
      store = new ChatStore(dbPath);
      const project = store.createProject("Live swap CLI", dir);
      const conversation = store.createConversation(
        project.id,
        "CLI swap",
        "codex",
      );
      store.addMessage(
        conversation.id,
        "user",
        "The handoff token is octarine.",
      );
      store.close();
      store = null;
      const cli = fileURLToPath(new URL("../bin/omni.mjs", import.meta.url));
      const env = { ...process.env, OMNI_DATA_DIR: dataDir };
      const swapped = spawnSync(
        process.execPath,
        [cli, "swap", "--conversation", conversation.id, "--harness", "claude"],
        { cwd: dir, env, encoding: "utf8", timeout: 60_000 },
      );
      assert.equal(swapped.status, 0, swapped.stderr);
      const swapResult = JSON.parse(swapped.stdout);
      assert.equal(swapResult.harnessId, "claude-code");
      assert.equal(swapResult.resumeContextAttached, true);
      const resumed = spawnSync(
        process.execPath,
        [
          cli,
          "run",
          "--conversation",
          conversation.id,
          "--harness",
          "claude",
          "What is the handoff token? Reply with the token only.",
        ],
        { cwd: dir, env, encoding: "utf8", timeout: 120_000 },
      );
      assert.equal(resumed.status, 0, resumed.stderr);
      assert.match(resumed.stdout.toLowerCase(), /octarine/);
      assert.doesNotMatch(
        `${swapped.stdout}${swapped.stderr}${resumed.stdout}${resumed.stderr}`,
        /sk-[A-Za-z0-9_-]{12,}|Bearer\s+\S+/,
      );
      store = new ChatStore(dbPath);
      const events = store.listEvents(conversation.id);
      assert.ok(events.some((event) => event.type === "session.checkpointed"));
      assert.ok(events.some((event) => event.type === "harness.changed"));
      assert.ok(
        events.some(
          (event) =>
            event.type === "session.started" &&
            event.payload.harnessId === "claude-code",
        ),
      );
    } finally {
      store?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
