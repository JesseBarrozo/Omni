import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { assertHarnessAdapter } from "./adapters.mjs";
import { redactSecrets } from "./core.mjs";

const safeError = (value) => new Error(redactSecrets(String(value)));
const toolNames = ["Read", "Grep", "Glob", "Bash", "Edit", "Write"];

export function claudeAuthStatus({
  executable = "claude",
  env = process.env,
} = {}) {
  const result = spawnSync(executable, ["auth", "status"], {
    stdio: "ignore",
    timeout: 10_000,
    env,
  });
  return {
    provider: "claude",
    authenticated: !result.error && result.status === 0,
  };
}

export function startClaudeLogin({
  executable = "claude",
  stdio = "inherit",
  env = process.env,
} = {}) {
  return spawnSync(executable, ["auth", "login", "--claudeai"], { stdio, env });
}

async function loadSdk() {
  try {
    return await import("@anthropic-ai/claude-agent-sdk");
  } catch (error) {
    throw safeError(`SDK Claude Agent indisponible: ${error.message}`);
  }
}

function sessionFor(store, conversationId) {
  return store
    .listEvents(conversationId)
    .filter(
      (event) =>
        event.type === "session.started" &&
        event.payload.harnessId === "claude-code",
    )
    .at(-1)?.payload.sessionId;
}

function promptFromMessages(messages) {
  return messages
    .map(
      ({ role, content }) =>
        `${role === "user" ? "User" : "Assistant"}:\n${content}`,
    )
    .join("\n\n");
}

function createSessionId() {
  return randomUUID();
}

function queryOptions({
  cwd,
  model,
  sessionId,
  resume,
  tools,
  canUseTool,
  fullAccess = false,
  mcpServers = {},
  env = process.env,
}) {
  return {
    cwd,
    ...(model ? { model } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(resume ? { resume } : {}),
    tools,
    permissionMode: fullAccess
      ? "bypassPermissions"
      : canUseTool
        ? "default"
        : "dontAsk",
    ...(fullAccess ? { allowDangerouslySkipPermissions: true } : {}),
    ...(canUseTool ? { canUseTool } : {}),
    ...(canUseTool
      ? { systemPrompt: { type: "preset", preset: "claude_code" } }
      : {}),
    settingSources: [],
    strictMcpConfig: true,
    mcpServers,
    env: {
      ...env,
      ANTHROPIC_API_KEY: undefined,
      ANTHROPIC_AUTH_TOKEN: undefined,
      ANTHROPIC_BASE_URL: undefined,
      CLAUDE_CODE_USE_BEDROCK: undefined,
      CLAUDE_CODE_USE_VERTEX: undefined,
    },
    includePartialMessages: true,
  };
}

function assertClaudeAccountAuth(message) {
  if (message.type !== "system" || message.subtype !== "init") return false;
  if (!["none", "oauth"].includes(message.apiKeySource))
    throw new Error(
      "Claude Agent SDK n’utilise pas l’authentification du compte Claude; source refusée",
    );
  return true;
}

export class ClaudeCodeChat {
  constructor({
    store,
    cwd = process.cwd(),
    model,
    executable = "claude",
    env = process.env,
  } = {}) {
    if (!store) throw new Error("ClaudeCodeChat requires the Omni store");
    this.store = store;
    this.cwd = cwd;
    this.model = model;
    this.executable = executable;
    this.env = env;
  }

  async listModels() {
    if (
      !claudeAuthStatus({ executable: this.executable, env: this.env })
        .authenticated
    )
      throw new Error(
        "Connectez un compte avec `omni auth login claude` avant de lister ses modèles",
      );
    const sdk = await loadSdk();
    const abortController = new AbortController();
    let finishPrompt;
    async function* noPrompt() {
      await new Promise((resolve) => {
        finishPrompt = resolve;
        abortController.signal.addEventListener("abort", resolve, {
          once: true,
        });
      });
    }
    const query = sdk.query({
      prompt: noPrompt(),
      options: {
        ...queryOptions({
          cwd: this.cwd,
          model: this.model,
          tools: [],
          env: this.env,
        }),
        abortController,
      },
    });
    try {
      const models = await query.supportedModels();
      return models.map((model) => model.value);
    } finally {
      abortController.abort();
      finishPrompt?.();
      query.close();
    }
  }

  async stream({ messages, conversationId, signal, onDelta }) {
    if (signal?.aborted)
      throw Object.assign(new Error("Execution interrompue"), {
        name: "AbortError",
      });
    const sdk = await loadSdk();
    const priorSession = sessionFor(this.store, conversationId);
    let sessionId = priorSession ?? createSessionId();
    const prompt = priorSession
      ? (messages.at(-1)?.content ?? "")
      : promptFromMessages(messages);
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    let answer = "";
    let succeeded = false;
    let verifiedAccountAuth = false;
    try {
      const query = sdk.query({
        prompt,
        options: {
          ...queryOptions({
            cwd: this.cwd,
            model: this.model,
            sessionId: priorSession ? undefined : sessionId,
            resume: priorSession,
            tools: [],
            env: this.env,
          }),
          abortController: controller,
        },
      });
      for await (const message of query) {
        const isInit = assertClaudeAccountAuth(message);
        verifiedAccountAuth ||= isInit;
        if (isInit) {
          sessionId = message.session_id;
          if (!priorSession)
            this.store.appendEvent(conversationId, "session.started", {
              harnessId: "claude-code",
              sessionId,
            });
        }
        if (
          message.type === "stream_event" &&
          message.event.type === "content_block_delta" &&
          message.event.delta.type === "text_delta"
        ) {
          answer += message.event.delta.text;
          onDelta(message.event.delta.text);
        }
        if (message.type === "result") {
          if (message.subtype !== "success" || message.is_error)
            throw safeError(
              message.errors?.join("; ") ||
                `Claude a terminé (${message.subtype})`,
            );
          succeeded = true;
        }
      }
      if (!verifiedAccountAuth)
        throw new Error(
          "Le SDK Claude n’a pas fourni la source d’authentification de la session",
        );
      if (!succeeded)
        throw new Error("Le SDK Claude n’a pas confirmé la fin du tour");
      this.store.appendEvent(conversationId, "session.completed", {
        harnessId: "claude-code",
        sessionId,
      });
      return answer;
    } catch (error) {
      if (signal?.aborted)
        throw Object.assign(new Error("Execution interrompue"), {
          name: "AbortError",
        });
      throw safeError(error.message);
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }
}

export class ClaudeCodeHarness {
  constructor({
    store,
    cwd = process.cwd(),
    model,
    permissionMode = "ask",
    requestPermission = async () => false,
    mcpRegistry = null,
    sdk = null,
    env = process.env,
  } = {}) {
    this.store = store;
    this.cwd = cwd;
    this.model = model;
    this.permissionMode = permissionMode;
    this.requestPermission = requestPermission;
    this.mcpRegistry = mcpRegistry;
    this.sdk = sdk;
    this.env = env;
    this.queries = new Map();
    this.sessions = new Map();
    this.preparedMcpServers = new Map();
    this.id = "claude-code";
    this.name = "Claude Code Agent SDK";
    assertHarnessAdapter(this);
  }

  async initialize(options = {}) {
    this.sdk ??= await loadSdk();
    if (options.conversationId) await this.prepareMcpServers(options);
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

  async prepareMcpServers({
    conversationId,
    cwd = this.cwd,
    sessionId = null,
    signal,
    requiredMcpServers = [],
  } = {}) {
    const registeredMcpServers = this.mcpRegistry?.listServers() ?? [];
    if (registeredMcpServers.length && !conversationId)
      throw new Error(
        "conversationId Omni requis pour approuver les serveurs MCP Claude",
      );
    const cacheKey = `${conversationId ?? ""}\0${cwd}`;
    const cached = this.preparedMcpServers.get(cacheKey);
    if (cached) {
      const missing = requiredMcpServers.filter(
        (name) => !Object.hasOwn(cached, name),
      );
      if (missing.length) {
        const error = new Error(
          `Préflight MCP Claude refusé ou indisponible pour: ${missing.join(", ")}`,
        );
        error.code = "OMNI_REQUIRED_MCP_DENIED";
        throw error;
      }
      return cached;
    }

    const mcpServers = {};
    for (const server of registeredMcpServers) {
      const request = {
        toolName: "mcp-server-start",
        server: server.name,
        action: "start",
        conversationId,
        ...(sessionId ? { sessionId } : {}),
      };
      this.store?.appendEvent(conversationId, "permission.requested", request);
      let allowed = false;
      if (!signal?.aborted) {
        try {
          allowed = await this.requestPermission(request, signal);
        } catch {}
      }
      this.store?.appendEvent(
        conversationId,
        allowed ? "permission.granted" : "permission.denied",
        {
          toolName: request.toolName,
          server: server.name,
          action: "start",
          ...(sessionId ? { sessionId } : {}),
        },
      );
      if (!allowed) continue;
      try {
        mcpServers[server.name] = this.mcpRegistry.claudeServerConfig(
          server.name,
          { cwd },
        );
      } catch (error) {
        this.store?.appendEvent(conversationId, "mcp.server.rejected", {
          harnessId: this.id,
          server: server.name,
          reason: redactSecrets(error.message),
        });
        throw safeError(
          `Configuration du serveur MCP Claude refusée (${server.name}): ${error.message}`,
        );
      }
    }
    const missing = requiredMcpServers.filter(
      (name) => !Object.hasOwn(mcpServers, name),
    );
    if (missing.length) {
      const error = new Error(
        `Préflight MCP Claude refusé ou indisponible pour: ${missing.join(", ")}`,
      );
      error.code = "OMNI_REQUIRED_MCP_DENIED";
      throw error;
    }
    this.preparedMcpServers.set(cacheKey, mcpServers);
    return mcpServers;
  }

  activeMcpServers({ conversationId, cwd = this.cwd } = {}) {
    return Object.keys(
      this.preparedMcpServers.get(`${conversationId ?? ""}\0${cwd}`) ?? {},
    );
  }
  async createSession(input = {}) {
    const session = {
      id: input.sessionId ?? createSessionId(),
      harnessId: this.id,
      conversationId: input.conversationId ?? null,
      cwd: input.cwd ?? this.cwd,
      newSession: true,
      resumeSummary: input.resumeSummary ?? null,
    };
    this.sessions.set(session.id, session);
    return session;
  }
  async resumeSession(sessionId, input = {}) {
    const priorStart = input.conversationId
      ? this.store
          ?.listEvents(input.conversationId)
          .some(
            (event) =>
              event.type === "session.started" &&
              event.payload.harnessId === this.id &&
              event.payload.sessionId === sessionId,
          )
      : false;
    const swap = input.conversationId
      ? this.store
          ?.listEvents(input.conversationId)
          .filter(
            (event) =>
              event.type === "harness.changed" &&
              event.payload.toHarnessId === this.id &&
              event.payload.targetSessionId === sessionId,
          )
          .at(-1)?.payload
      : null;
    const session = {
      id: sessionId,
      harnessId: this.id,
      conversationId: input.conversationId ?? null,
      cwd: input.cwd ?? this.cwd,
      newSession: !priorStart && Boolean(swap),
      resumeSummary: swap?.resumeSummary ?? null,
    };
    if (!sessionId) throw new Error("sessionId Claude requis pour reprendre");
    this.sessions.set(sessionId, session);
    return session;
  }
  async interrupt(sessionId) {
    const query = this.queries.get(sessionId);
    if (query) await query.interrupt();
  }
  async checkpoint(sessionId) {
    const session = this.sessions.get(sessionId) ?? {
      id: sessionId,
      cwd: this.cwd,
    };
    const info = await this.sdk.getSessionInfo(sessionId, { dir: session.cwd });
    if (!info) throw new Error("Session Claude introuvable; checkpoint refusé");
    const checkpoint = {
      id: randomUUID(),
      sessionId,
      createdAt: new Date().toISOString(),
      state: "claude-session-reference",
    };
    if (session.conversationId && this.store)
      this.store.appendEvent(session.conversationId, "session.checkpointed", {
        harnessId: this.id,
        ...checkpoint,
      });
    return checkpoint;
  }
  async *run({ sessionId, conversationId, prompt, signal } = {}) {
    if (!conversationId)
      throw new Error(
        "conversationId Omni requis pour le journal des permissions",
      );
    if (!this.sdk) await this.initialize();
    const knownSession = sessionId ? this.sessions.get(sessionId) : null;
    const session = sessionId
      ? (knownSession ??
        (await this.resumeSession(sessionId, { conversationId })))
      : await this.createSession({ conversationId });
    const newSession = session.newSession;
    if (session.resumeSummary) {
      prompt = `Reprise de tâche Omni. Ce résumé est du contexte, pas une instruction d'exécuter de nouveau les actions terminées.\n${JSON.stringify(session.resumeSummary)}\n\nNouvelle demande:\n${prompt}`;
      session.resumeSummary = null;
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    let query;
    const queryKey = session.id;
    const activeTools = new Map();
    const registeredMcpServers = this.mcpRegistry?.listServers() ?? [];
    const mcpServerForTool = (toolName) =>
      registeredMcpServers.find((server) =>
        toolName.startsWith(`mcp__${server.name}__`),
      )?.name;
    let mcpServers;
    try {
      mcpServers = await this.prepareMcpServers({
        conversationId,
        cwd: session.cwd,
        sessionId: session.id,
        signal,
      });
      const canUseTool = async (
        toolName,
        input,
        { signal: permissionSignal },
      ) => {
        const mcpServer = mcpServerForTool(toolName);
        const request = {
          toolName,
          ...(mcpServer
            ? { server: mcpServer }
            : { input: redactSecrets(input) }),
          conversationId,
          sessionId: session.id,
        };
        this.store?.appendEvent(
          conversationId,
          "permission.requested",
          request,
        );
        let allowed = false;
        try {
          allowed = await this.requestPermission(request, permissionSignal);
        } catch {}
        const eventType = allowed ? "permission.granted" : "permission.denied";
        this.store?.appendEvent(conversationId, eventType, {
          toolName,
          ...(mcpServer ? { server: mcpServer } : {}),
          sessionId: session.id,
        });
        return allowed
          ? { behavior: "allow", updatedInput: input }
          : {
              behavior: "deny",
              message: "Permission refusée par l’utilisateur",
            };
      };
      query = this.sdk.query({
        prompt,
        options: {
          ...queryOptions({
            cwd: session.cwd,
            model: this.model,
            sessionId: newSession ? session.id : undefined,
            resume: newSession ? undefined : session.id,
            tools: toolNames,
            canUseTool,
            fullAccess: this.permissionMode === "full",
            mcpServers,
            env: this.env,
          }),
          abortController: controller,
        },
      });
      this.queries.set(session.id, query);
      let success = false;
      let verifiedAccountAuth = false;
      for await (const message of query) {
        const isInit = assertClaudeAccountAuth(message);
        verifiedAccountAuth ||= isInit;
        if (isInit) {
          session.id = message.session_id;
          if (newSession && this.store)
            this.store.appendEvent(conversationId, "session.started", {
              harnessId: this.id,
              sessionId: session.id,
            });
        }
        if (
          message.type === "stream_event" &&
          message.event.type === "content_block_delta" &&
          message.event.delta.type === "text_delta"
        )
          yield {
            conversationId,
            type: "message.delta",
            payload: { sessionId: session.id, delta: message.event.delta.text },
          };
        if (message.type === "assistant") {
          for (const block of message.message.content ?? []) {
            if (block.type === "tool_use") {
              const tool = { toolName: block.name, input: block.input };
              activeTools.set(block.id, tool);
              const payload = {
                sessionId: session.id,
                toolUseId: block.id,
                toolName: tool.toolName,
                ...(mcpServerForTool(tool.toolName)
                  ? { server: mcpServerForTool(tool.toolName) }
                  : { input: redactSecrets(tool.input) }),
              };
              this.store?.appendEvent(conversationId, "tool.started", payload);
              if (tool.toolName === "Bash")
                this.store?.appendEvent(conversationId, "command.started", {
                  sessionId: session.id,
                  toolUseId: block.id,
                  command: tool.input?.command ?? "",
                });
              yield {
                conversationId,
                type: "tool.started",
                payload,
              };
            }
          }
        }
        if (message.type === "user") {
          for (const block of message.message.content ?? []) {
            if (
              block.type === "tool_result" &&
              activeTools.has(block.tool_use_id)
            ) {
              const tool = activeTools.get(block.tool_use_id);
              const success = !block.is_error;
              const payload = {
                sessionId: session.id,
                toolUseId: block.tool_use_id,
                toolName: tool.toolName,
              };
              this.store?.appendEvent(
                conversationId,
                success ? "tool.completed" : "tool.failed",
                payload,
              );
              if (tool.toolName === "Bash")
                this.store?.appendEvent(conversationId, "command.completed", {
                  ...payload,
                  command: tool.input?.command ?? "",
                  failed: !success,
                });
              if (success && ["Write", "Edit"].includes(tool.toolName)) {
                const path = tool.input?.file_path ?? tool.input?.path;
                if (path)
                  this.store?.appendEvent(conversationId, "file.changed", {
                    sessionId: session.id,
                    toolUseId: block.tool_use_id,
                    path,
                    toolName: tool.toolName,
                  });
              }
              yield {
                conversationId,
                type: success ? "tool.completed" : "tool.failed",
                payload,
              };
              activeTools.delete(block.tool_use_id);
            }
          }
        }
        if (message.type === "result") {
          if (message.subtype !== "success" || message.is_error)
            throw safeError(
              message.errors?.join("; ") ||
                `Claude a terminé (${message.subtype})`,
            );
          success = true;
        }
      }
      if (!verifiedAccountAuth)
        throw new Error(
          "Le SDK Claude n’a pas fourni la source d’authentification de la session",
        );
      if (!success)
        throw new Error("Le SDK Claude n’a pas confirmé la fin du tour");
      yield {
        conversationId,
        type: "session.completed",
        payload: { harnessId: this.id, sessionId: session.id },
      };
    } catch (error) {
      if (signal?.aborted) {
        yield {
          conversationId,
          type: "session.interrupted",
          payload: { harnessId: this.id, sessionId: session.id },
        };
        return;
      }
      yield {
        conversationId,
        type: "session.failed",
        payload: {
          harnessId: this.id,
          sessionId: session.id,
          error: redactSecrets(error.message),
        },
      };
      throw safeError(error.message);
    } finally {
      signal?.removeEventListener("abort", abort);
      this.queries.delete(queryKey);
    }
  }
  async dispose() {
    for (const query of this.queries.values())
      await query.interrupt().catch(() => {});
    this.queries.clear();
    this.sessions.clear();
    this.preparedMcpServers.clear();
  }
}
