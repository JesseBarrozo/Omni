import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { ChatStore } from "../src/chat-store.mjs";
import { McpRegistry } from "../src/mcp-registry.mjs";

const cli = fileURLToPath(new URL("../bin/omni.mjs", import.meta.url));
const sdkServerPath = new URL(
  "../node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js",
  import.meta.url,
).href;
const sdkStdioPath = new URL(
  "../node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js",
  import.meta.url,
).href;
const mcpServer = `
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { McpServer } from '${sdkServerPath}';
import { StdioServerTransport } from '${sdkStdioPath}';
const startupFile = process.env.MCP_START_FILE;
if (startupFile) {
  const count = existsSync(startupFile) ? Number(readFileSync(startupFile, 'utf8')) : 0;
  writeFileSync(startupFile, String(count + 1));
}
const server = new McpServer({ name: 'omni-test-mcp', version: '1.0.0' });
server.registerTool('mutate-file', { description: 'Create a marker after invocation' }, async () => {
  if (!process.env.MCP_TEST_SECRET) throw new Error('missing test environment');
  writeFileSync(process.env.MCP_OUTPUT_FILE, 'executed');
  return { content: [{ type: 'text', text: 'tool executed' }] };
});
await server.connect(new StdioServerTransport());
`;

function createRegistry({ store, dir, startupFile, outputFile }) {
  const registry = new McpRegistry({
    store,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      MCP_TEST_SECRET: "transient-test-only-value",
      MCP_OUTPUT_FILE: outputFile,
      MCP_START_FILE: startupFile,
    },
  });
  registry.addServer({
    name: "local-fixture",
    command: process.execPath,
    args: ["--input-type=module", "-e", mcpServer],
    cwd: dir,
    envKeys: ["MCP_TEST_SECRET", "MCP_OUTPUT_FILE", "MCP_START_FILE"],
  });
  return registry;
}

test("SQLite v4 MCP registrations migrate to v5 stdio transport without losing data", () => {
  const dir = mkdtempSync(join(tmpdir(), "omni-mcp-v4-migration-"));
  const file = join(dir, "omni.sqlite");
  const legacy = new Database(file);
  legacy.exec(`
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    INSERT INTO schema_migrations VALUES (4, '2026-01-01T00:00:00.000Z');
    CREATE TABLE mcp_servers (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, command TEXT NOT NULL,
      args_json TEXT NOT NULL, cwd TEXT, env_keys_json TEXT NOT NULL,
      tools_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    INSERT INTO mcp_servers VALUES ('old-id', 'old-server', 'node', '["server.mjs"]', '/tmp', '["TOKEN"]', '[{"name":"old-tool"}]', 'created', 'updated');
  `);
  legacy.close();
  const migrated = new ChatStore(file);
  try {
    const server = migrated.mcpServer("old-server");
    assert.equal(server.transport, "stdio");
    assert.equal(server.command, "node");
    assert.deepEqual(server.args, ["server.mjs"]);
    assert.deepEqual(server.envKeys, ["TOKEN"]);
    assert.deepEqual(server.tools, [{ name: "old-tool" }]);
    assert.equal(
      migrated.db
        .prepare("SELECT max(version) version FROM schema_migrations")
        .get().version,
      5,
    );
  } finally {
    migrated.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("MCP stdio discovery and approved tool call use the official SDK lifecycle", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omni-mcp-sdk-"));
  const store = new ChatStore(join(dir, "omni.sqlite"));
  const outputFile = join(dir, "tool-output.txt");
  const startupFile = join(dir, "server-starts.txt");
  try {
    const registry = createRegistry({ store, dir, startupFile, outputFile });
    await assert.rejects(
      registry.discoverTools("local-fixture"),
      /approbation explicite est requise/,
    );
    assert.equal(existsSync(startupFile), false);
    const tools = await registry.discoverTools("local-fixture", {
      requestPermission: async () => true,
    });
    assert.deepEqual(
      tools.map(({ name }) => name),
      ["mutate-file"],
    );
    assert.throws(
      () =>
        registry.claudeServerConfig("local-fixture", {
          cwd: join(dir, "other"),
        }),
      /ne permet pas de définir un cwd MCP distinct/,
    );
    const claudeConfig = registry.claudeServerConfig("local-fixture", {
      cwd: dir,
    });
    assert.equal(claudeConfig.type, "stdio");
    assert.equal(claudeConfig.env.MCP_TEST_SECRET, "transient-test-only-value");
    const codexConfig = registry.codexServerConfig("local-fixture", {
      cwd: dir,
    });
    assert.deepEqual(codexConfig.env_vars, [
      "MCP_TEST_SECRET",
      "MCP_OUTPUT_FILE",
      "MCP_START_FILE",
    ]);
    assert.equal(
      JSON.stringify(codexConfig).includes("transient-test-only-value"),
      false,
    );
    assert.equal(JSON.stringify(codexConfig).includes(outputFile), false);
    const rawConfig = store.db.prepare("SELECT * FROM mcp_servers").get();
    assert.equal(
      JSON.stringify(rawConfig).includes("transient-test-only-value"),
      false,
    );
    assert.equal(JSON.stringify(rawConfig).includes(outputFile), false);
    await assert.rejects(
      registry.callTool("local-fixture", "mutate-file", {}),
      /callback d’approbation MCP est obligatoire/,
    );
    assert.equal(existsSync(outputFile), false);
    let approvalCount = 0;
    const result = await registry.callTool(
      "local-fixture",
      "mutate-file",
      {},
      {
        requestPermission: async ({ server, toolName }) => {
          approvalCount += 1;
          assert.equal(server, "local-fixture");
          assert.equal(toolName, "mutate-file");
          return true;
        },
      },
    );
    assert.notEqual(result.isError, true);
    assert.equal(result.content[0].text, "tool executed");
    assert.equal(approvalCount, 1);
    assert.equal(readFileSync(outputFile, "utf8"), "executed");
    assert.equal(readFileSync(startupFile, "utf8"), "2");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Codex MCP configuration refuses secret interpolation into process arguments", () => {
  const dir = mkdtempSync(join(tmpdir(), "omni-codex-mcp-config-"));
  const store = new ChatStore(join(dir, "omni.sqlite"));
  try {
    const registry = new McpRegistry({
      store,
      env: { PATH: process.env.PATH ?? "", MCP_SECRET: "do-not-expose" },
    });
    registry.addServer({
      name: "unsafe-arg",
      command: process.execPath,
      args: ["{{env:MCP_SECRET}}"],
      cwd: dir,
      envKeys: ["MCP_SECRET"],
    });
    assert.throws(
      () => registry.codexServerConfig("unsafe-arg", { cwd: dir }),
      /sans les exposer à la ligne de commande/,
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("MCP Streamable HTTP uses env-only auth, permissions, and the official SDK", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omni-mcp-http-"));
  const store = new ChatStore(join(dir, "omni.sqlite"));
  const marker = join(dir, "called.txt");
  const token = "transient-http-token-must-not-persist";
  const { McpServer: Server } =
    await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { StreamableHTTPServerTransport: ServerTransport } =
    await import("@modelcontextprotocol/sdk/server/streamableHttp.js");
  const httpTrace = [];
  const authTrace = [];
  const transports = new Set();
  const httpServer = createServer(async (req, res) => {
    res.on("finish", () => httpTrace.push(`${req.method}:${res.statusCode}`));
    authTrace.push(req.headers.authorization === token);
    if (req.headers.authorization !== token) {
      res.writeHead(401).end();
      return;
    }
    let body;
    if (req.method === "POST") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    }
    const mcpServer = new Server({ name: "omni-http-fixture", version: "1" });
    mcpServer.registerTool("write-marker", { inputSchema: {} }, async () => {
      writeFileSync(marker, "called");
      return { content: [{ type: "text", text: "written" }] };
    });
    const mcpTransport = new ServerTransport({ sessionIdGenerator: undefined });
    transports.add(mcpTransport);
    await mcpServer.connect(mcpTransport);
    await mcpTransport.handleRequest(req, res, body);
  });
  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${httpServer.address().port}/mcp`;
  try {
    const registry = new McpRegistry({ store, env: { MCP_HTTP_TOKEN: token } });
    const configured = registry.addServer({
      name: "remote-local-fixture",
      transport: "http",
      url,
      headerEnv: { Authorization: "MCP_HTTP_TOKEN" },
      envKeys: ["MCP_HTTP_TOKEN"],
    });
    assert.equal(configured.transport, "http");
    assert.equal(configured.url, url);
    const raw = store.db.prepare("SELECT * FROM mcp_servers").get();
    assert.equal(JSON.stringify(raw).includes(token), false);
    assert.equal(JSON.stringify(raw).includes(url), true);
    assert.deepEqual(registry.claudeServerConfig(configured.name), {
      type: "http",
      url,
      headers: { Authorization: token },
    });
    const codex = registry.codexServerConfig(configured.name);
    assert.deepEqual(codex.env_http_headers, {
      Authorization: "MCP_HTTP_TOKEN",
    });
    assert.equal(JSON.stringify(codex).includes(token), false);
    await assert.rejects(
      registry.discoverTools(configured.name),
      /approbation explicite est requise/,
    );
    assert.equal(existsSync(marker), false);
    let tools;
    try {
      tools = await registry.discoverTools(configured.name, {
        requestPermission: async () => true,
      });
    } catch (error) {
      error.message += ` (${httpTrace.join(",")}; auth=${authTrace.join(",")})`;
      throw error;
    }
    assert.deepEqual(
      tools.map(({ name }) => name),
      ["write-marker"],
    );
    let approvals = 0;
    const result = await registry.callTool(
      configured.name,
      "write-marker",
      {},
      {
        requestPermission: async ({ server: requested, toolName }) => {
          approvals += 1;
          assert.equal(requested, configured.name);
          assert.equal(toolName, "write-marker");
          return true;
        },
      },
    );
    assert.equal(result.content[0].text, "written");
    assert.equal(approvals, 1);
    assert.equal(readFileSync(marker, "utf8"), "called");
    assert.throws(
      () =>
        registry.addServer({
          name: "unsafe-http",
          transport: "http",
          url: "http://example.com/mcp",
        }),
      /exige HTTPS/,
    );
    assert.throws(
      () =>
        registry.addServer({
          name: "query-secret",
          transport: "http",
          url: "https://mcp.example.test/mcp?token=must-not-persist",
        }),
      /sans identifiants intégrés, query ni fragment/,
    );
    assert.throws(
      () =>
        registry.addServer({
          name: "reserved-header",
          transport: "http",
          url: "https://mcp.example.test/mcp",
          headerEnv: { "mcp-session-id": "MCP_HTTP_TOKEN" },
          envKeys: ["MCP_HTTP_TOKEN"],
        }),
      /unique, non réservé/,
    );
  } finally {
    await new Promise((resolve) => httpServer.close(resolve));
    await Promise.all([...transports].map((item) => item.close()));
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("MCP CLI records and denies noninteractive calls before spawning the server", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omni-mcp-denied-"));
  const dataDir = join(dir, "data");
  const env = {
    ...process.env,
    OMNI_DATA_DIR: dataDir,
    MCP_TEST_SECRET: "transient-cli-test-value",
    MCP_OUTPUT_FILE: join(dir, "tool-output.txt"),
    MCP_START_FILE: join(dir, "server-starts.txt"),
  };
  const run = (...args) =>
    spawnSync(process.execPath, [cli, ...args], {
      cwd: dir,
      env,
      encoding: "utf8",
    });
  let store;
  try {
    const projectPath = join(dir, "project");
    const project = run(
      "project",
      "create",
      "--name",
      "mcp-denial",
      "--path",
      projectPath,
    );
    assert.equal(project.status, 0, project.stderr);
    const projectId = JSON.parse(project.stdout).id;
    store = new ChatStore(join(dataDir, "omni.sqlite"));
    const conversation = store.createConversation(
      projectId,
      "MCP permission",
      "local",
    );
    const outputFile = env.MCP_OUTPUT_FILE;
    const startupFile = env.MCP_START_FILE;
    const registry = createRegistry({ store, dir, startupFile, outputFile });
    await registry.discoverTools("local-fixture", {
      requestPermission: async () => true,
    });
    const discovery = run(
      "mcp",
      "tools",
      "--server",
      "local-fixture",
      "--conversation",
      conversation.id,
    );
    assert.equal(discovery.status, 1);
    assert.match(discovery.stderr, /approbation interactive est requise/);
    assert.equal(readFileSync(startupFile, "utf8"), "1");
    const inputFile = join(dir, "input.json");
    writeFileSync(inputFile, "{}");
    const result = run(
      "mcp",
      "call",
      "--server",
      "local-fixture",
      "--tool",
      "mutate-file",
      "--conversation",
      conversation.id,
      "--input-file",
      inputFile,
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /approbation interactive est requise/);
    assert.equal(existsSync(outputFile), false);
    assert.equal(readFileSync(startupFile, "utf8"), "1");
    const events = store.listEvents(conversation.id);
    assert.deepEqual(
      events
        .map(({ type }) => type)
        .filter((type) => type.startsWith("permission.")),
      [
        "permission.requested",
        "permission.denied",
        "permission.requested",
        "permission.denied",
      ],
    );
    assert.equal(
      events.some(({ type }) => type === "tool.started"),
      false,
    );
    assert.ok(events.every(({ payload }) => !("input" in payload)));
    assert.equal(
      JSON.stringify(events).includes("transient-cli-test-value"),
      false,
    );
  } finally {
    store?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
