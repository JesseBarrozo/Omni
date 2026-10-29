import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { redactSecrets } from "./core.mjs";

const namePattern = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;
const toolNamePattern = /^[^\0-\x1f\x7f]{1,256}$/;
const envNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
const envReferencePattern = /\{\{env:([A-Za-z_][A-Za-z0-9_]*)\}\}/g;
const suspiciousArgPattern =
  /^(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+\S+|(?:api[-_]?key|access[-_]?token|refresh[-_]?token|password|client[-_]?secret)\s*[:=]\s*.+)$/i;
const credentialFlagPattern =
  /^--?(?:api[-_]?key|access[-_]?token|refresh[-_]?token|password|client[-_]?secret)$/i;
const reservedHttpHeaders = new Set([
  "accept",
  "connection",
  "content-length",
  "content-type",
  "host",
  "mcp-protocol-version",
  "mcp-session-id",
  "transfer-encoding",
]);

function validateDefinition({
  name,
  transport = "stdio",
  command,
  args = [],
  cwd = null,
  url,
  envKeys = [],
  headerEnv = {},
}) {
  if (typeof name !== "string" || !namePattern.test(name))
    throw new TypeError("Nom de serveur MCP invalide.");
  if (!["stdio", "http"].includes(transport))
    throw new TypeError("Transport MCP invalide.");
  if (
    transport === "stdio" &&
    (typeof command !== "string" ||
      command.length === 0 ||
      command.length > 4096 ||
      /[\0\r\n]/.test(command) ||
      suspiciousArgPattern.test(command))
  )
    throw new TypeError("Commande de serveur MCP invalide.");
  if (
    !Array.isArray(args) ||
    args.length > 128 ||
    args.some(
      (arg) =>
        typeof arg !== "string" || arg.length > 8192 || arg.includes("\0"),
    )
  )
    throw new TypeError("Arguments du serveur MCP invalides.");
  if (
    cwd !== null &&
    (typeof cwd !== "string" || cwd.length > 4096 || /[\0\r\n]/.test(cwd))
  )
    throw new TypeError("Répertoire de travail MCP invalide.");
  if (
    !Array.isArray(envKeys) ||
    envKeys.length > 128 ||
    envKeys.some(
      (key) => typeof key !== "string" || !envNamePattern.test(key),
    ) ||
    new Set(envKeys).size !== envKeys.length
  )
    throw new TypeError("Noms de variables d’environnement MCP invalides.");
  if (transport === "http") {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new TypeError("URL MCP invalide.");
    }
    const loopback = ["localhost", "127.0.0.1", "::1"].includes(
      parsed.hostname,
    );
    if (
      (parsed.protocol !== "https:" &&
        !(parsed.protocol === "http:" && loopback)) ||
      parsed.username ||
      parsed.password ||
      parsed.hash ||
      parsed.search
    )
      throw new TypeError(
        "Le MCP HTTP exige HTTPS; HTTP est permis uniquement sur localhost/loopback, sans identifiants intégrés, query ni fragment.",
      );
    if (cwd !== null || args.length)
      throw new TypeError(
        "cwd et arguments ne s’appliquent pas à un MCP HTTP.",
      );
    if (!headerEnv || Array.isArray(headerEnv) || typeof headerEnv !== "object")
      throw new TypeError("Références de variables d’en-tête MCP invalides.");
    const normalizedHeaders = new Set();
    for (const [header, key] of Object.entries(headerEnv)) {
      const normalizedHeader = header.toLowerCase();
      if (
        !/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(header) ||
        reservedHttpHeaders.has(normalizedHeader) ||
        normalizedHeaders.has(normalizedHeader) ||
        !envNamePattern.test(key) ||
        !envKeys.includes(key)
      )
        throw new TypeError(
          "Chaque en-tête HTTP doit être unique, non réservé et référencer un nom de variable autorisé via --env-names.",
        );
      normalizedHeaders.add(normalizedHeader);
    }
  } else if (url || Object.keys(headerEnv).length) {
    throw new TypeError(
      "URL et en-têtes ne s’appliquent qu’au transport HTTP.",
    );
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const references = [...arg.matchAll(envReferencePattern)].map(
      (match) => match[1],
    );
    const withoutReferences = arg.replace(envReferencePattern, "");
    if (
      suspiciousArgPattern.test(withoutReferences) ||
      (credentialFlagPattern.test(arg) &&
        (!args[index + 1] ||
          !args[index + 1].match(/^\{\{env:[A-Za-z_][A-Za-z0-9_]*\}\}$/)))
    )
      throw new TypeError(
        "Les valeurs sensibles doivent être référencées par une variable d’environnement, jamais enregistrées dans les arguments MCP.",
      );
    if (references.some((key) => !envKeys.includes(key)))
      throw new TypeError(
        "Chaque variable référencée dans les arguments MCP doit figurer dans --env-names.",
      );
  }
}

export class McpRegistry {
  constructor({ store, env = process.env, timeoutMs = 30000 } = {}) {
    if (!store) throw new TypeError("ChatStore est requis pour McpRegistry.");
    this.store = store;
    this.env = env;
    this.timeoutMs = timeoutMs;
  }

  addServer(definition) {
    validateDefinition(definition);
    return this.store.saveMcpServer(definition);
  }

  listServers() {
    return this.store.mcpServers();
  }

  claudeServerConfig(name, { cwd } = {}) {
    const server = this.store.mcpServer(name);
    if (!server) throw new Error("Serveur MCP introuvable.");
    if (server.transport === "http")
      return {
        type: "http",
        url: server.url,
        headers: this.#resolveHeaders(server),
      };
    if (server.cwd && cwd && server.cwd !== cwd)
      throw new Error(
        `Le SDK Claude ne permet pas de définir un cwd MCP distinct du projet (${name}).`,
      );
    const args = server.args.map((arg) => {
      for (const match of arg.matchAll(envReferencePattern)) {
        const key = match[1];
        if (!server.envKeys.includes(key) || typeof this.env[key] !== "string")
          throw new Error(
            "Une variable d’environnement MCP autorisée n’est pas définie.",
          );
      }
      return arg.replace(envReferencePattern, (_, key) => this.env[key]);
    });
    const env = Object.fromEntries(
      server.envKeys
        .filter((key) => typeof this.env[key] === "string")
        .map((key) => [key, this.env[key]]),
    );
    return {
      type: "stdio",
      command: server.command,
      args,
      env,
    };
  }

  codexServerConfig(name, { cwd } = {}) {
    const server = this.store.mcpServer(name);
    if (!server) throw new Error("Serveur MCP introuvable.");
    if (server.transport === "http") {
      if (server.name.includes("."))
        throw new Error(
          "Codex n’accepte pas les points dans les noms de clé MCP; renommez ce serveur avant de l’utiliser.",
        );
      for (const key of server.envKeys)
        if (typeof this.env[key] !== "string")
          throw new Error(
            `Une variable d’environnement MCP autorisée n’est pas définie (${key}).`,
          );
      return {
        name: server.name,
        url: server.url,
        env_http_headers: server.headerEnv,
        credential_env_vars: server.envKeys,
      };
    }
    if (server.name.includes("."))
      throw new Error(
        "Codex n’accepte pas les points dans les noms de clé MCP; renommez ce serveur avant de l’utiliser.",
      );
    if (server.args.some((arg) => envReferencePattern.test(arg))) {
      envReferencePattern.lastIndex = 0;
      throw new Error(
        "Codex ne peut pas résoudre de secrets dans les arguments MCP sans les exposer à la ligne de commande; transmettez-les par --env-names.",
      );
    }
    envReferencePattern.lastIndex = 0;
    for (const key of server.envKeys)
      if (typeof this.env[key] !== "string")
        throw new Error(
          `Une variable d’environnement MCP autorisée n’est pas définie (${key}).`,
        );
    return {
      name: server.name,
      command: server.command,
      args: server.args,
      cwd: server.cwd ?? cwd ?? process.cwd(),
      env_vars: server.envKeys,
    };
  }

  removeServer(name) {
    return this.store.removeMcpServer(name);
  }

  #resolveHeaders(server) {
    const headers = {};
    for (const [header, key] of Object.entries(server.headerEnv)) {
      const value = this.env[key];
      if (
        !server.envKeys.includes(key) ||
        typeof value !== "string" ||
        /[\r\n]/.test(value)
      )
        throw new Error(
          "Une variable d’environnement d’authentification MCP autorisée est absente ou invalide.",
        );
      headers[header] = value;
    }
    return headers;
  }

  async #withClient(name, operation) {
    const server = this.store.mcpServer(name);
    if (!server) throw new Error("Serveur MCP introuvable.");
    if (server.transport === "http") {
      const headers = this.#resolveHeaders(server);
      const transport = new StreamableHTTPClientTransport(new URL(server.url), {
        requestInit: { headers, redirect: "error" },
        redirectPolicy: "same-origin",
      });
      return this.#connectAndRun(transport, server, operation);
    }
    const args = server.args.map((arg) => {
      for (const match of arg.matchAll(envReferencePattern)) {
        const key = match[1];
        if (!server.envKeys.includes(key) || typeof this.env[key] !== "string")
          throw new Error(
            "Une variable d’environnement MCP autorisée n’est pas définie.",
          );
      }
      return arg.replace(envReferencePattern, (_, key) => this.env[key]);
    });
    const env = Object.fromEntries(
      server.envKeys
        .filter((key) => typeof this.env[key] === "string")
        .map((key) => [key, this.env[key]]),
    );
    const transport = new StdioClientTransport({
      command: server.command,
      args,
      cwd: server.cwd ?? undefined,
      env,
      stderr: "pipe",
    });
    transport.stderr?.resume();
    return this.#connectAndRun(transport, server, operation);
  }

  async #connectAndRun(transport, server, operation) {
    const client = new Client({ name: "omni", version: "0.1.0" });
    try {
      await client.connect(transport, { timeout: this.timeoutMs });
      return await operation(client, server);
    } catch {
      throw new Error("Échec de communication avec le serveur MCP.");
    } finally {
      await client.close().catch(() => {});
    }
  }

  async discoverTools(name, { requestPermission } = {}) {
    if (typeof requestPermission !== "function")
      throw new TypeError(
        "Une approbation explicite est requise pour lancer un serveur MCP.",
      );
    if (!(await requestPermission({ server: name, toolName: "__discover__" })))
      throw new Error("La découverte MCP a été refusée.");
    return this.#withClient(name, async (client, server) => {
      const tools = [];
      let cursor;
      do {
        const page = await client.listTools(cursor ? { cursor } : {}, {
          timeout: this.timeoutMs,
        });
        if (!Array.isArray(page.tools))
          throw new Error("Catalogue d’outils invalide.");
        tools.push(...page.tools);
        cursor = page.nextCursor;
        if (tools.length > 1000)
          throw new Error("Le catalogue MCP dépasse la limite autorisée.");
      } while (cursor);
      const safeTools = tools.map((tool) => {
        if (
          typeof tool.name !== "string" ||
          !toolNamePattern.test(tool.name) ||
          !tool.inputSchema ||
          typeof tool.inputSchema !== "object"
        )
          throw new Error(
            "Le serveur MCP a renvoyé une définition d’outil invalide.",
          );
        return redactSecrets({
          name: tool.name,
          description:
            typeof tool.description === "string" ? tool.description : "",
          inputSchema: tool.inputSchema,
        });
      });
      return this.store.saveMcpTools(server.name, safeTools).tools;
    });
  }

  async callTool(name, toolName, input, { requestPermission } = {}) {
    if (typeof toolName !== "string" || !toolNamePattern.test(toolName))
      throw new TypeError("Nom d’outil MCP invalide.");
    if (!input || Array.isArray(input) || typeof input !== "object")
      throw new TypeError("Les paramètres MCP doivent être un objet JSON.");
    if (typeof requestPermission !== "function")
      throw new TypeError("Un callback d’approbation MCP est obligatoire.");
    if (!(await requestPermission({ server: name, toolName })))
      throw new Error("L’appel MCP a été refusé.");
    return this.#withClient(name, async (client, server) => {
      if (!server.tools.some((tool) => tool.name === toolName))
        throw new Error(
          "Cet outil n’est pas dans le dernier catalogue MCP découvert.",
        );
      return client.callTool({ name: toolName, arguments: input }, undefined, {
        timeout: this.timeoutMs,
      });
    });
  }
}
