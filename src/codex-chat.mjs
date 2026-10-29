import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { assertHarnessAdapter } from "./adapters.mjs";
import { redactSecrets } from "./core.mjs";

const abortError = () =>
  Object.assign(new Error("Execution interrompue"), { name: "AbortError" });
const safeError = (message) => new Error(redactSecrets(String(message)));
const tomlInlineTable = (value) =>
  `{ ${Object.entries(value)
    .map(([key, item]) => `${JSON.stringify(key)} = ${JSON.stringify(item)}`)
    .join(", ")} }`;

export function codexAuthStatus({
  executable = "codex",
  env = process.env,
} = {}) {
  const result = spawnSync(executable, ["login", "status"], {
    stdio: "ignore",
    timeout: 10_000,
    env,
  });
  return {
    provider: "codex",
    authenticated: !result.error && result.status === 0,
  };
}

export function startCodexLogin({
  executable = "codex",
  stdio = "inherit",
  env = process.env,
} = {}) {
  return spawnSync(executable, ["login"], { stdio, env });
}

class CodexAppServer {
  constructor({
    executable = "codex",
    timeoutMs = 30_000,
    mcpServers = [],
    env = process.env,
  } = {}) {
    this.executable = executable;
    this.timeoutMs = timeoutMs;
    this.mcpServers = mcpServers;
    this.env = env;
    this.sequence = 1;
    this.pending = new Map();
    this.notifications = [];
    this.notificationWaiters = [];
    this.buffer = "";
  }

  async start() {
    const args = ["app-server", "--listen", "stdio://", "-c", "mcp_servers={}"];
    for (const server of this.mcpServers) {
      const prefix = `mcp_servers.${server.name}`;
      if (server.url) {
        args.push("-c", `${prefix}.url=${JSON.stringify(server.url)}`);
        if (Object.keys(server.env_http_headers ?? {}).length)
          args.push(
            "-c",
            `${prefix}.env_http_headers=${tomlInlineTable(server.env_http_headers)}`,
          );
      } else {
        args.push(
          "-c",
          `${prefix}.command=${JSON.stringify(server.command)}`,
          "-c",
          `${prefix}.args=${JSON.stringify(server.args)}`,
          "-c",
          `${prefix}.cwd=${JSON.stringify(server.cwd)}`,
          "-c",
          `${prefix}.env_vars=${JSON.stringify(server.env_vars)}`,
        );
      }
      args.push("-c", `${prefix}.default_tools_approval_mode="prompt"`);
    }
    this.child = spawn(this.executable, args, {
      stdio: ["pipe", "pipe", "ignore"],
      env: this.env,
    });
    this.child.stdout.on("data", (chunk) => this.#read(chunk));
    this.child.on("error", (error) => this.#fail(safeError(error.message)));
    this.child.on("exit", (code) => {
      if (!this.closed)
        this.#fail(new Error(`Codex app-server arrêté (${code})`));
    });
    await this.request("initialize", {
      clientInfo: { name: "omni", title: "Omni", version: "0.1.0" },
      capabilities: null,
    });
    this.notify("initialized", {});
    return this;
  }

  #read(chunk) {
    this.buffer += chunk.toString("utf8");
    let newline;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      const pending = this.pending.get(message.id);
      if (typeof message.method === "string") {
        const waiter = this.notificationWaiters.shift();
        if (waiter) waiter.resolve(message);
        else this.notifications.push(message);
      } else if (message.id !== undefined && pending) {
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        if (message.error)
          pending.reject(
            safeError(message.error.message ?? "Codex request failed"),
          );
        else pending.resolve(message.result);
      }
    }
  }

  #fail(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const waiter of this.notificationWaiters.splice(0))
      waiter.reject(error);
  }

  request(method, params) {
    const id = this.sequence++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Délai dépassé pour Codex ${method}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
      );
    });
  }

  notify(method, params) {
    this.child.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  respond(id, result) {
    this.child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`,
    );
  }

  respondError(id, code, message) {
    this.child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`,
    );
  }

  denyServerRequest(message) {
    if (message.method === "item/commandExecution/requestApproval")
      this.respond(message.id, { decision: "decline" });
    else if (message.method === "item/fileChange/requestApproval")
      this.respond(message.id, { decision: "decline" });
    else if (message.method === "item/permissions/requestApproval")
      this.respond(message.id, { permissions: {}, scope: "turn" });
    else
      this.respondError(
        message.id,
        -32601,
        `Omni ne prend pas en charge la requête Codex: ${message.method}`,
      );
  }

  nextNotification(signal) {
    if (signal?.aborted) return Promise.reject(abortError());
    if (this.notifications.length)
      return Promise.resolve(this.notifications.shift());
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve: (value) => {
          signal?.removeEventListener("abort", onAbort);
          resolve(value);
        },
        reject: (error) => {
          signal?.removeEventListener("abort", onAbort);
          reject(error);
        },
      };
      const onAbort = () => {
        const index = this.notificationWaiters.indexOf(waiter);
        if (index >= 0) this.notificationWaiters.splice(index, 1);
        waiter.reject(abortError());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.notificationWaiters.push(waiter);
    });
  }

  async close() {
    if (!this.child || this.closed) return;
    this.closed = true;
    this.#fail(new Error("Codex app-server fermé"));
    const child = this.child;
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 2_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill("SIGTERM");
    });
  }
}

export class CodexChat {
  constructor({
    store,
    executable = "codex",
    cwd = process.cwd(),
    model = null,
    env = process.env,
  } = {}) {
    if (!store)
      throw new Error("CodexChat requires the Omni conversation store");
    this.store = store;
    this.executable = executable;
    this.cwd = cwd;
    this.model = model;
    this.env = env;
  }

  async listModels() {
    const server = await new CodexAppServer({
      executable: this.executable,
      env: this.env,
    }).start();
    try {
      const result = await server.request("model/list", {});
      return (result.data ?? result.models ?? [])
        .map((model) => model.id ?? model.model)
        .filter(Boolean)
        .sort();
    } finally {
      await server.close();
    }
  }

  async stream({
    messages,
    conversationId,
    model = this.model,
    signal,
    onDelta,
  }) {
    const selectedModel = model?.startsWith("codex:")
      ? model.slice("codex:".length)
      : model;
    const server = await new CodexAppServer({
      executable: this.executable,
      env: this.env,
    }).start();
    let threadId;
    let turnId;
    let response = "";
    try {
      const priorSession = this.store
        .listEvents(conversationId)
        .filter(
          (event) =>
            event.type === "session.started" &&
            event.payload.harnessId === "codex",
        )
        .at(-1)?.payload.sessionId;
      if (priorSession) {
        await server.request("thread/resume", {
          threadId: priorSession,
          cwd: this.cwd,
          approvalPolicy: "on-request",
          sandbox: "read-only",
          ...(selectedModel && selectedModel !== "codex"
            ? { model: selectedModel }
            : {}),
        });
        threadId = priorSession;
      } else {
        const started = await server.request("thread/start", {
          cwd: this.cwd,
          approvalPolicy: "on-request",
          sandbox: "read-only",
          ...(selectedModel && selectedModel !== "codex"
            ? { model: selectedModel }
            : {}),
        });
        threadId = started.thread.id;
        this.store.appendEvent(conversationId, "session.started", {
          harnessId: "codex",
          sessionId: threadId,
        });
      }

      const prompt = priorSession
        ? (messages.at(-1)?.content ?? "")
        : messages
            .map(
              ({ role, content }) =>
                `${role === "user" ? "User" : "Assistant"}:\n${content}`,
            )
            .join("\n\n");
      const startedTurn = await server.request("turn/start", {
        threadId,
        input: [{ type: "text", text: prompt, text_elements: [] }],
        approvalPolicy: "on-request",
      });
      turnId = startedTurn.turn.id;

      while (true) {
        const event = await server.nextNotification(signal);
        if (event.id !== undefined && event.method) {
          server.denyServerRequest(event);
          continue;
        }
        const params = event.params ?? {};
        if (
          event.method === "item/agentMessage/delta" &&
          params.threadId === threadId &&
          params.turnId === turnId
        ) {
          response += params.delta;
          onDelta(params.delta);
        }
        if (
          event.method === "turn/completed" &&
          params.threadId === threadId &&
          params.turn?.id === turnId
        ) {
          if (params.turn.status !== "completed")
            throw new Error(
              `Codex a terminé avec le statut ${params.turn.status}`,
            );
          return response;
        }
        if (event.method === "error" && params.threadId === threadId)
          throw safeError(
            params.error?.message ?? "Codex a échoué pendant le tour",
          );
      }
    } catch (error) {
      if (signal?.aborted) {
        if (threadId && turnId) {
          try {
            await server.request("turn/interrupt", { threadId, turnId });
          } catch {}
        }
        throw abortError();
      }
      throw safeError(error.message);
    } finally {
      await server.close();
    }
  }
}

const codexApprovalMethods = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
  "mcpServer/elicitation/request",
]);

const isCredentialEnv = (name) =>
  /(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|AUTHORIZATION|CREDENTIAL)/i.test(name);

function codexChildEnvironment(env, mcpServers) {
  if (mcpServers.length === 0) return env;
  const childEnv = Object.fromEntries(
    Object.entries(env).filter(([name]) => !isCredentialEnv(name)),
  );
  for (const server of mcpServers)
    for (const name of server.env_vars ?? server.credential_env_vars ?? [])
      if (typeof env[name] === "string") childEnv[name] = env[name];
  return childEnv;
}

function codexToolName(item) {
  if (item?.type === "commandExecution") return "Codex command";
  if (item?.type === "fileChange") return "Codex file change";
  if (item?.type === "mcpToolCall") return "Codex MCP tool";
  return null;
}

export class CodexHarness {
  constructor({
    store,
    executable = "codex",
    cwd = process.cwd(),
    model,
    requestPermission = async () => false,
    mcpRegistry = null,
    env = process.env,
  } = {}) {
    if (!store) throw new Error("CodexHarness requires the Omni event store");
    this.store = store;
    this.executable = executable;
    this.cwd = cwd;
    this.model = model;
    this.requestPermission = requestPermission;
    this.mcpRegistry = mcpRegistry;
    this.env = env;
    this.mcpServers = [];
    this.mcpConfigured = false;
    this.sessions = new Map();
    this.activeTurns = new Map();
    this.pendingFileChanges = new Map();
    this.id = "codex";
    this.name = "Codex app-server";
    assertHarnessAdapter(this);
  }

  async initialize({ conversationId, requiredMcpServers = [] } = {}) {
    if (this.server) return;
    if (!this.mcpConfigured) {
      const configured = [];
      const registeredServers = this.mcpRegistry?.listServers() ?? [];
      if (registeredServers.length > 0 && !conversationId)
        throw new Error(
          "conversationId Omni requis pour approuver le démarrage des serveurs MCP Codex",
        );
      for (const entry of registeredServers) {
        let config;
        try {
          config = this.mcpRegistry.codexServerConfig(entry.name, {
            cwd: this.cwd,
          });
        } catch (error) {
          if (conversationId)
            this.store.appendEvent(conversationId, "mcp.server.rejected", {
              harnessId: this.id,
              server: entry.name,
              reason: redactSecrets(error.message),
            });
          throw safeError(
            `Configuration du serveur MCP Codex refusée (${entry.name}): ${error.message}`,
          );
        }
        const request = {
          method: "mcpServer/start",
          server: entry.name,
          toolName: "démarrer le serveur MCP",
          conversationId,
        };
        this.store.appendEvent(conversationId, "permission.requested", request);
        let allowed = false;
        try {
          allowed = Boolean(await this.requestPermission(request));
        } catch {}
        this.store.appendEvent(
          conversationId,
          allowed ? "permission.granted" : "permission.denied",
          {
            method: request.method,
            server: entry.name,
            toolName: request.toolName,
            conversationId,
          },
        );
        if (allowed) configured.push(config);
      }
      const configuredNames = new Set(configured.map(({ name }) => name));
      const missingRequired = requiredMcpServers.filter(
        (name) => !configuredNames.has(name),
      );
      if (missingRequired.length) {
        const error = safeError(
          `Préflight MCP Codex refusé ou indisponible pour: ${missingRequired.join(", ")}`,
        );
        error.code = "OMNI_REQUIRED_MCP_DENIED";
        throw error;
      }
      this.mcpServers = configured;
      this.mcpConfigured = true;
    }
    const env = codexChildEnvironment(this.env, this.mcpServers);
    if (!this.server)
      this.server = await new CodexAppServer({
        executable: this.executable,
        mcpServers: this.mcpServers,
        env,
      }).start();
  }

  async capabilities() {
    return {
      tools: true,
      mcpTransports: ["stdio", "http"],
      streaming: true,
      checkpoint: true,
      permissions: true,
      resume: true,
    };
  }

  activeMcpServers() {
    return this.mcpServers.map(({ name }) => name);
  }

  async createSession({
    conversationId,
    cwd = this.cwd,
    model = this.model,
    resumeSummary = null,
  } = {}) {
    if (!conversationId)
      throw new Error("conversationId Omni requis pour une session Codex");
    await this.initialize({ conversationId });
    const response = await this.server.request("thread/start", {
      cwd,
      approvalPolicy: "on-request",
      sandbox: "read-only",
      ...(model && model !== "codex" ? { model } : {}),
    });
    const session = {
      id: response.thread.id,
      harnessId: this.id,
      conversationId,
      cwd,
      model: model ?? null,
      resumeSummary,
    };
    this.sessions.set(session.id, session);
    this.store.appendEvent(conversationId, "session.started", {
      harnessId: this.id,
      sessionId: session.id,
    });
    return session;
  }

  async resumeSession(
    sessionId,
    { conversationId, cwd = this.cwd, model = this.model } = {},
  ) {
    if (!sessionId) throw new Error("sessionId Codex requis pour la reprise");
    if (!conversationId)
      throw new Error(
        "conversationId Omni requis pour reprendre une session Codex",
      );
    await this.initialize({ conversationId });
    const resumeSummary = this.store
      .listEvents(conversationId)
      .filter(
        (event) =>
          event.type === "harness.changed" &&
          event.payload.toHarnessId === this.id &&
          event.payload.targetSessionId === sessionId,
      )
      .at(-1)?.payload.resumeSummary;
    await this.server.request("thread/resume", {
      threadId: sessionId,
      cwd,
      approvalPolicy: "on-request",
      sandbox: "read-only",
      ...(model && model !== "codex" ? { model } : {}),
    });
    const session = {
      id: sessionId,
      harnessId: this.id,
      conversationId,
      cwd,
      model: model ?? null,
      resumeSummary: resumeSummary ?? null,
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  async interrupt(sessionId) {
    const active = this.activeTurns.get(sessionId);
    if (!active || active.interruptSent) return;
    active.interruptSent = true;
    await this.server.request("turn/interrupt", {
      threadId: sessionId,
      turnId: active.turnId,
    });
  }

  async checkpoint(sessionId) {
    if (this.activeTurns.has(sessionId))
      throw new Error("Checkpoint Codex refusé pendant un tour actif");
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Session Codex inconnue; checkpoint refusé");
    const checkpoint = {
      id: randomUUID(),
      sessionId,
      createdAt: new Date().toISOString(),
      state: "codex-thread-reference",
    };
    this.store.appendEvent(session.conversationId, "session.checkpointed", {
      harnessId: this.id,
      ...checkpoint,
    });
    return checkpoint;
  }

  async #approval(request, session, signal) {
    const params = request.params ?? {};
    const mcpApproval = request.method === "mcpServer/elicitation/request";
    const meta = params._meta ?? {};
    let toolParams = meta.tool_params;
    if (typeof toolParams === "string") {
      try {
        toolParams = JSON.parse(toolParams);
      } catch {
        toolParams = null;
      }
    }
    const candidateToolName =
      (typeof meta.tool_name === "string" && meta.tool_name) ||
      (toolParams &&
      typeof toolParams === "object" &&
      typeof toolParams.name === "string"
        ? toolParams.name
        : null);
    const toolName =
      typeof candidateToolName === "string" &&
      /^[^\0-\x1f\x7f]{1,256}$/.test(candidateToolName)
        ? candidateToolName
        : null;
    const validMcpApproval =
      mcpApproval &&
      params.mode === "form" &&
      meta.codex_approval_kind === "mcp_tool_call" &&
      typeof params.serverName === "string";
    const payload = mcpApproval
      ? {
          method: request.method,
          requestId: request.id,
          server:
            typeof params.serverName === "string"
              ? params.serverName
              : "unknown",
          toolName:
            typeof toolName === "string"
              ? toolName
              : "outil MCP (nom non fourni par Codex)",
          action: "mcp-tool-call",
          conversationId: session.conversationId,
          sessionId: session.id,
        }
      : {
          method: request.method,
          requestId: request.id,
          params: redactSecrets({
            ...params,
            ...(request.method === "item/fileChange/requestApproval"
              ? {
                  changes: this.pendingFileChanges.get(params.itemId) ?? [],
                }
              : {}),
          }),
          conversationId: session.conversationId,
          sessionId: session.id,
        };
    this.store.appendEvent(
      session.conversationId,
      "permission.requested",
      payload,
    );
    let allowed = false;
    if (
      codexApprovalMethods.has(request.method) &&
      (!mcpApproval || validMcpApproval) &&
      !signal?.aborted
    ) {
      try {
        allowed = await this.requestPermission(payload, signal);
      } catch {
        allowed = false;
      }
    }

    const decisionType = allowed ? "permission.granted" : "permission.denied";
    this.store.appendEvent(session.conversationId, decisionType, {
      method: request.method,
      requestId: request.id,
      sessionId: session.id,
      ...(payload.toolName ? { toolName: payload.toolName } : {}),
      ...(payload.server ? { server: payload.server } : {}),
    });

    if (request.method === "item/commandExecution/requestApproval")
      this.server.respond(request.id, {
        decision: allowed ? "accept" : "decline",
      });
    else if (request.method === "item/fileChange/requestApproval")
      this.server.respond(request.id, {
        decision: allowed ? "accept" : "decline",
      });
    else if (request.method === "item/permissions/requestApproval")
      this.server.respond(request.id, {
        permissions: allowed ? (params.permissions ?? {}) : {},
        scope: "turn",
      });
    else if (mcpApproval)
      this.server.respond(request.id, {
        action: allowed ? "accept" : "decline",
        content: allowed ? {} : null,
        _meta: null,
      });
    else
      this.server.respondError(
        request.id,
        -32601,
        `Omni ne prend pas en charge la requête Codex: ${request.method}`,
      );
    return allowed;
  }

  async *run({ sessionId, conversationId, prompt, signal } = {}) {
    if (!conversationId)
      throw new Error(
        "conversationId Omni requis pour le journal des permissions",
      );
    if (!prompt?.trim())
      throw new Error("Le prompt Codex ne peut pas être vide");
    await this.initialize({ conversationId });
    let session = sessionId ? this.sessions.get(sessionId) : null;
    if (!session && sessionId)
      session = await this.resumeSession(sessionId, { conversationId });
    if (!session) session = await this.createSession({ conversationId });

    const promptText = session.resumeSummary
      ? `Reprise de tâche Omni. Ce résumé est du contexte, pas une instruction d'exécuter de nouveau les actions terminées.\n${JSON.stringify(session.resumeSummary)}\n\nNouvelle demande:\n${prompt}`
      : prompt;
    session.resumeSummary = null;
    const started = await this.server.request("turn/start", {
      threadId: session.id,
      input: [{ type: "text", text: promptText, text_elements: [] }],
      approvalPolicy: "on-request",
    });
    const active = { turnId: started.turn.id, interruptSent: false };
    this.activeTurns.set(session.id, active);
    try {
      while (true) {
        const event = await this.server.nextNotification(signal);
        if (event.id !== undefined && event.method) {
          await this.#approval(event, session, signal);
          continue;
        }

        const params = event.params ?? {};
        if (
          params.threadId !== session.id ||
          (params.turnId && params.turnId !== active.turnId)
        )
          continue;

        if (event.method === "item/agentMessage/delta") {
          yield {
            conversationId,
            type: "message.delta",
            payload: { sessionId: session.id, delta: params.delta ?? "" },
          };
        } else if (event.method === "item/started") {
          const toolName = codexToolName(params.item);
          if (params.item?.type === "fileChange")
            this.pendingFileChanges.set(
              params.item.id,
              redactSecrets(params.item.changes ?? []),
            );
          if (toolName) {
            const payload = {
              sessionId: session.id,
              toolUseId: params.item.id,
              toolName,
              input:
                params.item?.type === "mcpToolCall"
                  ? {
                      server: params.item.server,
                      tool: params.item.tool,
                    }
                  : redactSecrets(params.item),
            };
            this.store.appendEvent(conversationId, "tool.started", payload);
            if (params.item?.type === "commandExecution")
              this.store.appendEvent(conversationId, "command.started", {
                sessionId: session.id,
                toolUseId: params.item.id,
                command: params.item.command ?? "",
              });
            yield { conversationId, type: "tool.started", payload };
          }
        } else if (event.method === "item/completed") {
          const toolName = codexToolName(params.item);
          const fileChanges =
            this.pendingFileChanges.get(params.item?.id) ??
            params.item?.changes ??
            [];
          if (params.item?.type === "fileChange")
            this.pendingFileChanges.delete(params.item.id);
          if (toolName) {
            const completed = params.item?.status !== "failed";
            const payload = {
              sessionId: session.id,
              toolUseId: params.item.id,
              toolName,
              status: params.item?.status ?? null,
            };
            this.store.appendEvent(
              conversationId,
              completed ? "tool.completed" : "tool.failed",
              payload,
            );
            if (params.item?.type === "commandExecution")
              this.store.appendEvent(conversationId, "command.completed", {
                sessionId: session.id,
                toolUseId: params.item.id,
                command: params.item.command ?? "",
                status: params.item?.status ?? null,
              });
            if (params.item?.type === "fileChange" && completed)
              for (const change of fileChanges)
                this.store.appendEvent(conversationId, "file.changed", {
                  sessionId: session.id,
                  path: change.path,
                  kind: change.kind?.type ?? null,
                });
            yield {
              conversationId,
              type: completed ? "tool.completed" : "tool.failed",
              payload,
            };
          }
        } else if (event.method === "turn/completed") {
          const status = params.turn?.status;
          if (status === "interrupted") {
            this.store.appendEvent(conversationId, "session.interrupted", {
              harnessId: this.id,
              sessionId: session.id,
            });
            yield {
              conversationId,
              type: "session.interrupted",
              payload: { sessionId: session.id },
            };
            return;
          }
          if (status !== "completed")
            throw safeError(`Codex a terminé avec le statut ${status}`);
          this.store.appendEvent(conversationId, "session.completed", {
            harnessId: this.id,
            sessionId: session.id,
          });
          yield {
            conversationId,
            type: "message.completed",
            payload: { sessionId: session.id },
          };
          return;
        } else if (event.method === "error") {
          throw safeError(
            params.error?.message ?? "Codex a échoué pendant le tour",
          );
        }
      }
    } catch (error) {
      if (signal?.aborted) {
        try {
          await this.interrupt(session.id);
        } catch {}
        this.store.appendEvent(conversationId, "session.interrupted", {
          harnessId: this.id,
          sessionId: session.id,
        });
        yield {
          conversationId,
          type: "session.interrupted",
          payload: { sessionId: session.id },
        };
        return;
      }
      this.store.appendEvent(conversationId, "session.failed", {
        harnessId: this.id,
        sessionId: session.id,
        error: redactSecrets(error.message),
      });
      yield {
        conversationId,
        type: "session.failed",
        payload: { sessionId: session.id, error: redactSecrets(error.message) },
      };
    } finally {
      this.activeTurns.delete(session.id);
    }
  }

  async dispose() {
    for (const sessionId of this.activeTurns.keys()) {
      try {
        await this.interrupt(sessionId);
      } catch {}
    }
    await this.server?.close();
    this.server = null;
    this.sessions.clear();
  }
}
