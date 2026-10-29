import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ChatStore } from "../src/chat-store.mjs";
import { CodexHarness, codexAuthStatus } from "../src/codex-chat.mjs";
import { McpRegistry } from "../src/mcp-registry.mjs";
import { assertHarnessAdapter } from "../src/adapters.mjs";

const cli = fileURLToPath(new URL("../bin/omni.mjs", import.meta.url));
const sdkServerPath = new URL(
  "../node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js",
  import.meta.url,
).href;
const sdkStdioPath = new URL(
  "../node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js",
  import.meta.url,
).href;

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

test("Codex MCP approval accepts one call while event storage omits its parameters", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omni-codex-mcp-protocol-"));
  const dbPath = join(dir, "omni.sqlite");
  const executable = join(dir, "codex-fixture");
  writeFileSync(
    executable,
    `#!/usr/bin/env node
import readline from 'node:readline';
const out = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') out({ jsonrpc: '2.0', id: message.id, result: {} });
  else if (message.method === 'thread/start') out({ jsonrpc: '2.0', id: message.id, result: { thread: { id: 'fixture-thread' } } });
  else if (message.method === 'turn/start') {
    out({ jsonrpc: '2.0', id: message.id, result: { turn: { id: 'fixture-turn' } } });
    setTimeout(() => out({ jsonrpc: '2.0', id: 'approval-1', method: 'mcpServer/elicitation/request', params: { threadId: 'fixture-thread', turnId: 'fixture-turn', serverName: 'fixture-mcp', mode: 'form', message: 'Approve a fixture MCP call', requestedSchema: { type: 'object', properties: {} }, _meta: { codex_approval_kind: 'mcp_tool_call', tool_params: { arguments: { private_value: 'never-persist-this' } } } } }), 0);
  } else if (message.id === 'approval-1') {
    if (message.result?.action !== 'accept') process.exitCode = 2;
    out({ jsonrpc: '2.0', method: 'item/started', params: { threadId: 'fixture-thread', turnId: 'fixture-turn', item: { type: 'mcpToolCall', id: 'fixture-tool', server: 'fixture-mcp', tool: 'write-marker', status: 'inProgress', arguments: { private_value: 'never-persist-this' } } } });
    out({ jsonrpc: '2.0', method: 'item/completed', params: { threadId: 'fixture-thread', turnId: 'fixture-turn', item: { type: 'mcpToolCall', id: 'fixture-tool', server: 'fixture-mcp', tool: 'write-marker', status: 'completed', arguments: { private_value: 'never-persist-this' } } } });
    out({ jsonrpc: '2.0', method: 'turn/completed', params: { threadId: 'fixture-thread', turn: { id: 'fixture-turn', status: 'completed' } } });
  }
});
`,
    { mode: 0o700 },
  );
  chmodSync(executable, 0o700);
  const store = new ChatStore(dbPath);
  let harness;
  try {
    const project = store.createProject("Codex MCP protocol", dir);
    const conversation = store.createConversation(
      project.id,
      "approval",
      "codex",
    );
    const approvals = [];
    harness = new CodexHarness({
      store,
      executable,
      cwd: dir,
      requestPermission: async (request) => {
        approvals.push(request);
        return request.method === "mcpServer/elicitation/request";
      },
    });
    const events = [];
    for await (const event of harness.run({
      conversationId: conversation.id,
      prompt: "Use the fixture MCP tool once",
      signal: new AbortController().signal,
    }))
      events.push(event);
    assert.equal(approvals.length, 1);
    assert.equal(approvals[0].server, "fixture-mcp");
    assert.equal(approvals[0].toolName, "outil MCP (nom non fourni par Codex)");
    assert.ok(events.some((event) => event.type === "tool.completed"));
    assert.doesNotMatch(
      JSON.stringify(store.listEvents(conversation.id)),
      /never-persist-this|arguments|private_value/,
    );
  } finally {
    await harness?.dispose();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
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
      store.close();
      store = null;
      const historyEnv = { ...process.env, OMNI_DATA_DIR: dir };
      const toolHistory = spawnSync(
        process.execPath,
        [cli, "tools", "list", "--conversation", conversation.id, "--json"],
        { env: historyEnv, encoding: "utf8" },
      );
      assert.equal(toolHistory.status, 0, toolHistory.stderr);
      assert.ok(JSON.parse(toolHistory.stdout).length > 0);
      assert.doesNotMatch(toolHistory.stdout, /approved-by-omni\.txt/);
      const permissionHistory = spawnSync(
        process.execPath,
        [
          cli,
          "permissions",
          "list",
          "--conversation",
          conversation.id,
          "--json",
        ],
        { env: historyEnv, encoding: "utf8" },
      );
      assert.equal(permissionHistory.status, 0, permissionHistory.stderr);
      assert.ok(
        JSON.parse(permissionHistory.stdout).some(
          (entry) => entry.granted === true,
        ),
      );
    } finally {
      await harness?.dispose();
      store?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "real Codex OAuth app-server approves and executes a registered MCP tool once without logging its payload",
  {
    skip:
      process.env.OMNI_LIVE_CODEX_MCP_TESTS !== "1" ||
      !codexAuthStatus().authenticated,
  },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "omni-codex-mcp-live-"));
    const dbPath = join(dir, "omni.sqlite");
    const marker = join(dir, "mcp-marker.txt");
    const fixture = `
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { McpServer } from '${sdkServerPath}';
import { StdioServerTransport } from '${sdkStdioPath}';
const server = new McpServer({ name: 'omni-codex-mcp-live', version: '1.0.0' });
server.registerTool('write-marker', { description: 'Write exactly one approved marker file' }, async () => {
  const old = existsSync(process.env.MCP_OUTPUT_FILE) ? Number(readFileSync(process.env.MCP_OUTPUT_FILE, 'utf8')) : 0;
  writeFileSync(process.env.MCP_OUTPUT_FILE, String(old + 1));
  return { content: [{ type: 'text', text: 'marker written' }] };
});
await server.connect(new StdioServerTransport());
`;
    let store;
    let harness;
    try {
      execFileSync("git", ["init", "--quiet"], { cwd: dir });
      store = new ChatStore(dbPath);
      const project = store.createProject("Codex MCP live", dir);
      const conversation = store.createConversation(
        project.id,
        "Codex MCP approval",
        "codex",
      );
      const env = {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        CODEX_HOME: process.env.CODEX_HOME ?? "",
        MCP_OUTPUT_FILE: marker,
      };
      const registry = new McpRegistry({ store, env });
      registry.addServer({
        name: "live-codex-mcp",
        command: process.execPath,
        args: ["--input-type=module", "-e", fixture],
        cwd: dir,
        envKeys: ["MCP_OUTPUT_FILE"],
      });
      const permissions = [];
      harness = new CodexHarness({
        store,
        cwd: dir,
        mcpRegistry: registry,
        env,
        requestPermission: async (request) => {
          permissions.push(request);
          return (
            (request.method === "mcpServer/start" &&
              request.server === "live-codex-mcp") ||
            (request.method === "mcpServer/elicitation/request" &&
              request.server === "live-codex-mcp" &&
              request.toolName === "outil MCP (nom non fourni par Codex)")
          );
        },
      });
      const events = [];
      for await (const event of harness.run({
        conversationId: conversation.id,
        prompt:
          "Use the live-codex-mcp write-marker tool exactly once, then report that it completed. Do not use shell commands.",
        signal: new AbortController().signal,
      }))
        events.push(event);
      assert.ok(
        events.some((event) => event.type === "message.completed"),
        `Codex did not complete the MCP turn: ${JSON.stringify(events)}`,
      );
      assert.ok(
        existsSync(marker),
        `MCP tool was not executed; events=${JSON.stringify(events.map(({ type, payload }) => ({ type, toolName: payload?.toolName, error: payload?.error })))} approvals=${JSON.stringify(permissions.map(({ method, server, toolName }) => ({ method, server, toolName })))}`,
      );
      assert.equal(readFileSync(marker, "utf8"), "1");
      assert.ok(
        permissions.some((entry) => entry.method === "mcpServer/start"),
      );
      assert.ok(
        permissions.some(
          (entry) =>
            entry.method === "mcpServer/elicitation/request" &&
            entry.toolName === "outil MCP (nom non fourni par Codex)",
        ),
      );
      const toolEvents = store
        .listEvents(conversation.id)
        .filter((event) => event.type.startsWith("tool."));
      assert.ok(toolEvents.some((event) => event.type === "tool.completed"));
      assert.equal(
        JSON.stringify(toolEvents).includes("arguments"),
        false,
        "MCP tool arguments must not be persisted in tool events",
      );
      assert.equal(
        JSON.stringify(store.listEvents(conversation.id)).includes(marker),
        false,
        "MCP server configuration paths must not appear in conversation events",
      );
    } finally {
      await harness?.dispose();
      store?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
