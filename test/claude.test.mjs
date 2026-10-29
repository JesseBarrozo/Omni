import test from "node:test";
import assert from "node:assert/strict";
import {
  ClaudeCodeHarness,
  ClaudeCodeChat,
  claudeAuthStatus,
} from "../src/claude-code.mjs";
import { assertHarnessAdapter } from "../src/adapters.mjs";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { ChatStore } from "../src/chat-store.mjs";
import { McpRegistry } from "../src/mcp-registry.mjs";

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
    mcpTransports: ["stdio", "http"],
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

test("Claude harness passes approved MCP servers to the SDK and omits tool inputs from events", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omni-claude-mcp-"));
  const store = new ChatStore(join(dir, "omni.sqlite"));
  const project = store.createProject("Claude MCP", dir);
  const conversation = store.createConversation(
    project.id,
    "MCP tools",
    "claude",
  );
  const registry = new McpRegistry({
    store,
    env: {
      PATH: process.env.PATH ?? "",
      MCP_TEST_SECRET: "transient-claude-secret",
    },
  });
  registry.addServer({
    name: "local-fs",
    command: process.execPath,
    args: ["--version"],
    cwd: dir,
    envKeys: ["MCP_TEST_SECRET"],
  });
  let queryOptions;
  const sdk = {
    query({ options }) {
      queryOptions = options;
      return {
        async *[Symbol.asyncIterator]() {
          const permission = await options.canUseTool(
            "mcp__local-fs__mutate-file",
            { secretArgument: "transient-tool-input" },
            { signal: new AbortController().signal },
          );
          assert.equal(permission.behavior, "allow");
          yield {
            type: "system",
            subtype: "init",
            session_id: "claude-mcp-session",
            apiKeySource: "oauth",
          };
          yield {
            type: "assistant",
            message: {
              content: [
                {
                  type: "tool_use",
                  id: "mcp-tool-use-1",
                  name: "mcp__local-fs__mutate-file",
                  input: { secretArgument: "transient-tool-input" },
                },
              ],
            },
          };
          yield {
            type: "user",
            message: {
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "mcp-tool-use-1",
                  content: "secret-tool-result",
                },
              ],
            },
          };
          yield { type: "result", subtype: "success", is_error: false };
        },
        async close() {},
      };
    },
  };
  const permissionRequests = [];
  const harness = new ClaudeCodeHarness({
    store,
    cwd: dir,
    mcpRegistry: registry,
    sdk,
    requestPermission: async (request) => {
      permissionRequests.push(request);
      return true;
    },
  });
  try {
    const output = [];
    for await (const event of harness.run({
      conversationId: conversation.id,
      prompt: "Use the configured tool",
    }))
      output.push(event);
    assert.deepEqual(Object.keys(queryOptions.mcpServers), ["local-fs"]);
    assert.equal(
      queryOptions.mcpServers["local-fs"].env.MCP_TEST_SECRET,
      "transient-claude-secret",
    );
    assert.equal(permissionRequests[0].action, "start");
    assert.equal(permissionRequests[1].toolName, "mcp__local-fs__mutate-file");
    assert.equal("input" in permissionRequests[1], false);
    assert.ok(output.some((event) => event.type === "tool.started"));
    const events = store.listEvents(conversation.id);
    assert.equal(
      JSON.stringify(events).includes("transient-tool-input"),
      false,
    );
    assert.equal(JSON.stringify(events).includes("secret-tool-result"), false);
    assert.equal(
      JSON.stringify(events).includes("transient-claude-secret"),
      false,
    );
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

test(
  "real Claude OAuth harness starts an approved MCP server and executes its tool once",
  { skip: process.env.OMNI_LIVE_CLAUDE_MCP_TESTS !== "1" },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "omni-claude-mcp-live-"));
    const store = new ChatStore(join(dir, "omni.sqlite"));
    const project = store.createProject("Claude MCP integration", dir);
    const conversation = store.createConversation(
      project.id,
      "Approved MCP call",
      "claude",
    );
    const marker = join(dir, "mcp-tool-called.txt");
    const mcpModule = new URL(
      "../node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js",
      import.meta.url,
    ).href;
    const stdioModule = new URL(
      "../node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js",
      import.meta.url,
    ).href;
    const serverSource = `
      import { writeFileSync } from 'node:fs';
      import { McpServer } from '${mcpModule}';
      import { StdioServerTransport } from '${stdioModule}';
      const server = new McpServer({ name: 'omni-live-claude-mcp', version: '1.0.0' });
      server.registerTool('write_marker', { description: 'Write the temporary integration marker exactly once' }, async () => {
        writeFileSync(process.env.OMNI_TEST_MARKER, 'called');
        return { content: [{ type: 'text', text: 'marker written' }] };
      });
      await server.connect(new StdioServerTransport());
    `;
    const registry = new McpRegistry({
      store,
      env: { ...process.env, OMNI_TEST_MARKER: marker },
    });
    registry.addServer({
      name: "live-fs",
      command: process.execPath,
      args: ["--input-type=module", "-e", serverSource],
      cwd: dir,
      envKeys: ["OMNI_TEST_MARKER"],
    });
    const approvals = [];
    const harness = new ClaudeCodeHarness({
      store,
      cwd: dir,
      mcpRegistry: registry,
      requestPermission: async (request) => {
        approvals.push(request);
        return (
          request.action === "start" ||
          request.toolName === "mcp__live-fs__write_marker"
        );
      },
    });
    try {
      await harness.initialize();
      const events = [];
      for await (const event of harness.run({
        conversationId: conversation.id,
        prompt:
          "Call mcp__live-fs__write_marker exactly once, then confirm it is done. Do not use any other tool.",
        signal: new AbortController().signal,
      }))
        events.push(event);
      assert.equal(approvals.length, 2);
      assert.equal(approvals[0].action, "start");
      assert.equal(approvals[1].toolName, "mcp__live-fs__write_marker");
      assert.equal(existsSync(marker), true);
      assert.equal(readFileSync(marker, "utf8"), "called");
      const persistedEvents = store.listEvents(conversation.id);
      assert.equal(
        persistedEvents.filter((event) => event.type === "tool.started").length,
        1,
      );
      assert.equal(
        JSON.stringify(persistedEvents).includes(serverSource),
        false,
      );
      assert.ok(events.some((event) => event.type === "session.completed"));
    } finally {
      await harness.dispose();
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "real Claude OAuth harness executes a permission-approved Streamable HTTP MCP tool",
  {
    skip:
      process.env.OMNI_LIVE_CLAUDE_HTTP_MCP_TESTS !== "1" ||
      !claudeAuthStatus().authenticated,
  },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "omni-claude-http-mcp-live-"));
    const store = new ChatStore(join(dir, "omni.sqlite"));
    const project = store.createProject("Claude HTTP MCP", dir);
    const conversation = store.createConversation(
      project.id,
      "HTTP tool",
      "claude",
    );
    const marker = join(dir, "http-marker.txt");
    const { McpServer } =
      await import("@modelcontextprotocol/sdk/server/mcp.js");
    const { StreamableHTTPServerTransport } =
      await import("@modelcontextprotocol/sdk/server/streamableHttp.js");
    const httpTrace = [];
    const httpMethods = [];
    let toolInvocations = 0;
    const httpServer = createServer(async (req, res) => {
      res.on("finish", () => httpTrace.push(`${req.method}:${res.statusCode}`));
      let body;
      if (req.method === "POST") {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        httpMethods.push(body.method);
      }
      const server = new McpServer({
        name: "omni-claude-http-live",
        version: "1",
      });
      server.registerTool(
        "write_marker",
        { description: "Write exactly one temporary marker", inputSchema: {} },
        async () => {
          toolInvocations += 1;
          const count = existsSync(marker)
            ? Number(readFileSync(marker, "utf8"))
            : 0;
          writeFileSync(marker, String(count + 1));
          return { content: [{ type: "text", text: "written" }] };
        },
      );
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    });
    await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const registry = new McpRegistry({ store, env: process.env });
    registry.addServer({
      name: "live-http",
      transport: "http",
      url: `http://127.0.0.1:${httpServer.address().port}/mcp`,
    });
    const approvals = [];
    const harness = new ClaudeCodeHarness({
      store,
      cwd: dir,
      mcpRegistry: registry,
      requestPermission: async (request) => {
        approvals.push(request);
        return (
          request.action === "start" ||
          request.toolName === "mcp__live-http__write_marker"
        );
      },
    });
    try {
      await harness.initialize();
      const events = [];
      for await (const event of harness.run({
        conversationId: conversation.id,
        prompt:
          "Call mcp__live-http__write_marker exactly once and then confirm. Do not use other tools.",
        signal: new AbortController().signal,
      }))
        events.push(event);
      assert.equal(approvals.length, 2);
      assert.equal(approvals[0].action, "start");
      assert.equal(approvals[1].toolName, "mcp__live-http__write_marker");
      assert.equal(
        existsSync(marker),
        true,
        `HTTP=${httpTrace.join(",")} methods=${httpMethods.join(",")} toolInvocations=${toolInvocations} approvals=${JSON.stringify(approvals.map(({ action, toolName }) => ({ action, toolName })))} failed=${JSON.stringify(
          store
            .listEvents(conversation.id)
            .filter(({ type }) => type === "tool.failed")
            .map(({ payload }) => payload),
        )}`,
      );
      assert.equal(readFileSync(marker, "utf8"), "1");
      assert.ok(events.some(({ type }) => type === "session.completed"));
    } finally {
      await harness.dispose();
      await new Promise((resolve) => httpServer.close(resolve));
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
