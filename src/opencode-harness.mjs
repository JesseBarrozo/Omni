import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";
import { assertHarnessAdapter } from "./adapters.mjs";
import { redactSecrets } from "./core.mjs";

const safeError = (error, password) => {
  let message = error instanceof Error ? error.message : String(error);
  if (password) message = message.replaceAll(password, "[REDACTED]");
  return new Error(redactSecrets(message));
};

const resultData = (result, action, password) => {
  if (!result || result.error)
    throw safeError(
      new Error(
        result?.error?.message ??
          `OpenCode ${action} failed${result?.response?.status ? ` (HTTP ${result.response.status})` : ""}`,
      ),
      password,
    );
  return result.data?.data ?? result.data;
};

async function permissionReplyField(
  url,
  authorization,
  timeoutMs,
  password,
  fetchImpl,
) {
  try {
    const response = await fetchImpl(new URL("/openapi.json", url), {
      headers: { authorization },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const schema = await response.json();
    const fields =
      schema.paths?.["/api/session/{sessionID}/permission/{requestID}/reply"]
        ?.post?.requestBody?.content?.["application/json"]?.schema;
    const name = ["decision", "reply"].find((field) => {
      const property = fields?.properties?.[field];
      const reference = property?.$ref?.split("/").at(-1);
      const values =
        property?.enum ?? schema.components?.schemas?.[reference]?.enum;
      return (
        Array.isArray(values) &&
        ["once", "always", "reject"].every((value) => values.includes(value))
      );
    });
    if (!name)
      throw new Error("OpenCode permission reply schema is unsupported");
    return name;
  } catch (error) {
    throw safeError(
      new Error(
        "Impossible de vérifier le schéma officiel des permissions OpenCode: " +
          error.message,
      ),
      password,
    );
  }
}

function permissionCompatibleFetch(field, fetchImpl) {
  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (
      request.method !== "POST" ||
      !/\/api\/session\/[^/]+\/permission\/[^/]+\/reply$/.test(url.pathname)
    )
      return fetchImpl(request);
    const body = await request.clone().json();
    const value = body.reply ?? body.decision;
    if (!["once", "always", "reject"].includes(value))
      throw new Error("OpenCode permission decision is invalid");
    delete body.reply;
    delete body.decision;
    body[field] = value;
    return fetchImpl(new Request(request, { body: JSON.stringify(body) }));
  };
}

export function parseOpenCodeModel(value) {
  if (!value || value === "opencode") return undefined;
  const raw = value.startsWith("opencode:")
    ? value.slice("opencode:".length)
    : value;
  const separator = raw.indexOf("/");
  if (separator < 1 || separator === raw.length - 1)
    throw new TypeError(
      "Modèle OpenCode attendu au format opencode:provider/model.",
    );
  return {
    id: raw.slice(separator + 1),
    providerID: raw.slice(0, separator),
  };
}

function childEnvironment(env, password) {
  const childEnv = Object.fromEntries(
    Object.entries(env).filter(
      ([name]) =>
        !/(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|AUTHORIZATION|CREDENTIAL)/i.test(
          name,
        ),
    ),
  );
  childEnv.OPENCODE_PASSWORD = password;
  childEnv.OPENCODE_CONFIG_PROJECT_DISABLE = "true";
  childEnv.OPENCODE_CONFIG_CONTENT = JSON.stringify({
    logLevel: "error",
    permissions: [{ action: "*", resource: "*", effect: "ask" }],
    plugins: [],
    share: "disabled",
  });
  return childEnv;
}

async function launchServer({ executable, env, timeoutMs, spawnProcess }) {
  const password = randomBytes(32).toString("base64url");
  const child = spawnProcess(
    executable,
    ["serve", "--hostname=127.0.0.1", "--port=0", "--log-level=error"],
    {
      env: childEnvironment(env, password),
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  let buffer = "";
  let settled = false;
  let timer;
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    await Promise.race([
      once(child, "exit").catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  };
  try {
    const url = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("startup timeout")), timeoutMs);
      child.stdout.on("data", (chunk) => {
        if (settled) return;
        buffer = (buffer + chunk.toString("utf8")).slice(-8192);
        const match = buffer.match(
          /(?:opencode )?server listening on (https?:\/\/[^\s]+)/,
        );
        if (match) {
          settled = true;
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
      child.once("error", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error("OpenCode server process could not start"));
      });
      child.once("exit", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error("OpenCode server exited before becoming ready"));
      });
    });
    return { url, password, child, close: stop };
  } catch {
    clearTimeout(timer);
    await stop();
    throw new Error(
      "Impossible de démarrer le serveur OpenCode. Vérifiez que le CLI officiel est installé et accessible dans PATH.",
    );
  }
}

export class OpenCodeHarness {
  constructor({
    store,
    cwd = process.cwd(),
    model,
    executable = "opencode",
    requestPermission = async () => false,
    env = process.env,
    serverFactory = launchServer,
    clientFactory = createOpencodeClient,
    spawnProcess = spawn,
    fetchImpl = fetch,
    timeoutMs = 15_000,
  } = {}) {
    if (!store)
      throw new Error("OpenCodeHarness requires the Omni event store");
    this.store = store;
    this.cwd = cwd;
    this.model = model;
    this.executable = executable;
    this.requestPermission = requestPermission;
    this.env = env;
    this.serverFactory = (options) =>
      serverFactory({ ...options, spawnProcess });
    this.clientFactory = clientFactory;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.server = null;
    this.client = null;
    this.password = null;
    this.sessions = new Map();
    this.activeRuns = new Map();
    this.id = "opencode";
    this.name = "OpenCode server SDK";
    assertHarnessAdapter(this);
  }

  async initialize({ cwd = this.cwd } = {}) {
    this.cwd = cwd;
    if (this.client) return;
    this.server = await this.serverFactory({
      executable: this.executable,
      env: this.env,
      timeoutMs: this.timeoutMs,
    });
    this.password = this.server.password;
    const authorization = `Basic ${Buffer.from(`opencode:${this.password}`).toString("base64")}`;
    const replyField = await permissionReplyField(
      this.server.url,
      authorization,
      this.timeoutMs,
      this.password,
      this.fetchImpl,
    );
    this.client = this.clientFactory({
      baseUrl: this.server.url,
      directory: this.cwd,
      headers: { authorization },
      fetch: permissionCompatibleFetch(replyField, this.fetchImpl),
      timeout: this.timeoutMs,
    });
  }

  async capabilities() {
    return {
      tools: true,
      streaming: true,
      checkpoint: true,
      permissions: true,
      resume: true,
      mcpTransports: [],
    };
  }

  async listModels() {
    await this.initialize();
    try {
      const models = resultData(
        await this.client.v2.model.list({
          location: { directory: this.cwd },
        }),
        "model registry",
        this.password,
      );
      return (models ?? [])
        .filter((entry) => entry.enabled && entry.status === "active")
        .map((entry) => `${entry.providerID}/${entry.id}`)
        .sort();
    } catch (error) {
      throw safeError(error, this.password);
    }
  }

  async createSession({
    conversationId,
    cwd = this.cwd,
    model = this.model,
  } = {}) {
    if (!conversationId)
      throw new Error("conversationId Omni requis pour une session OpenCode");
    await this.initialize({ cwd });
    const requestedModel = parseOpenCodeModel(model);
    try {
      const created = resultData(
        await this.client.v2.session.create({
          location: { directory: cwd },
          ...(requestedModel ? { model: requestedModel } : {}),
        }),
        "session creation",
        this.password,
      );
      if (!created?.id)
        throw new Error("OpenCode n’a pas retourné d’identifiant de session");
      const session = {
        id: created.id,
        harnessId: this.id,
        conversationId,
        cwd,
        model: requestedModel ?? null,
      };
      this.sessions.set(session.id, session);
      this.store.appendEvent(conversationId, "session.started", {
        harnessId: this.id,
        sessionId: session.id,
      });
      return session;
    } catch (error) {
      throw safeError(error, this.password);
    }
  }

  async resumeSession(sessionId, { conversationId, cwd = this.cwd } = {}) {
    if (!sessionId)
      throw new Error("sessionId OpenCode requis pour la reprise");
    if (!conversationId)
      throw new Error("conversationId Omni requis pour reprendre OpenCode");
    await this.initialize({ cwd });
    try {
      const session = resultData(
        await this.client.v2.session.get({ sessionID: sessionId }),
        "session resume",
        this.password,
      );
      if (!session?.id)
        throw new Error("Session OpenCode introuvable; reprise refusée");
      if (session.location?.directory !== cwd)
        throw new Error(
          "Le dossier de la session OpenCode ne correspond pas au projet",
        );
      const resumed = {
        id: sessionId,
        harnessId: this.id,
        conversationId,
        cwd,
        model: session.model ?? null,
      };
      this.sessions.set(sessionId, resumed);
      return resumed;
    } catch (error) {
      throw safeError(error, this.password);
    }
  }

  async interrupt(sessionId) {
    const active = this.activeRuns.get(sessionId);
    if (!active || active.interruptSent) return;
    active.interruptSent = true;
    try {
      await this.client.v2.session.interrupt({ sessionID: sessionId });
    } catch (error) {
      throw safeError(error, this.password);
    }
  }

  async checkpoint(sessionId) {
    if (this.activeRuns.has(sessionId))
      throw new Error("Checkpoint OpenCode refusé pendant un tour actif");
    const session = this.sessions.get(sessionId);
    if (!session)
      throw new Error("Session OpenCode inconnue; checkpoint refusé");
    resultData(
      await this.client.v2.session.get({ sessionID: sessionId }),
      "checkpoint",
      this.password,
    );
    const checkpoint = {
      id: randomUUID(),
      sessionId,
      createdAt: new Date().toISOString(),
      state: "opencode-session-reference",
    };
    this.store.appendEvent(session.conversationId, "session.checkpointed", {
      harnessId: this.id,
      ...checkpoint,
    });
    return checkpoint;
  }

  async *run({ sessionId, conversationId, prompt, signal } = {}) {
    if (!conversationId)
      throw new Error("conversationId Omni requis pour journaliser OpenCode");
    if (!sessionId)
      throw new Error(
        "sessionId OpenCode requis; créez ou reprenez une session",
      );
    if (!this.sessions.has(sessionId))
      await this.resumeSession(sessionId, { conversationId });
    if (this.activeRuns.has(sessionId))
      throw new Error(
        "Une exécution OpenCode est déjà active pour cette session",
      );
    const controller = new AbortController();
    const abort = () => {
      controller.abort();
      void this.interrupt(sessionId).catch(() => {});
    };
    signal?.addEventListener("abort", abort, { once: true });
    const active = { controller, interruptSent: false };
    this.activeRuns.set(sessionId, active);
    let stream;
    let iterator;
    let completed = false;
    let interrupted = false;
    try {
      const subscription = await this.client.v2.event.subscribe({
        signal: controller.signal,
        sseMaxRetryAttempts: 0,
      });
      stream = subscription.stream;
      iterator = stream[Symbol.asyncIterator]();
      resultData(
        await this.client.v2.session.prompt({
          sessionID: sessionId,
          prompt: { text: prompt },
          resume: true,
        }),
        "prompt admission",
        this.password,
      );
      while (!completed) {
        if (signal?.aborted) {
          await this.interrupt(sessionId);
          interrupted = true;
          break;
        }
        const { value: event, done } = await iterator.next();
        if (done) {
          if (controller.signal.aborted) {
            interrupted = true;
            break;
          }
          throw new Error(
            "Le flux d’événements OpenCode s’est terminé sans session.idle",
          );
        }
        const data = event?.data;
        if (event?.type === "permission.v2.asked") {
          if (data.sessionID !== sessionId) continue;
          const request = {
            toolName: data.action,
            action: data.action,
            resources: Array.isArray(data.resources) ? data.resources : [],
            conversationId,
            sessionId,
          };
          this.store.appendEvent(conversationId, "permission.requested", {
            harnessId: this.id,
            sessionId,
            requestId: data.id,
            action: data.action,
            resourceCount: request.resources.length,
          });
          let allowed = false;
          try {
            if (!signal?.aborted)
              allowed = Boolean(await this.requestPermission(request, signal));
          } catch {}
          const reply = allowed ? "once" : "reject";
          try {
            resultData(
              await this.client.v2.session.permission.reply({
                sessionID: sessionId,
                requestID: data.id,
                reply,
              }),
              "permission reply",
              this.password,
            );
          } catch (error) {
            await this.interrupt(sessionId).catch(() => {});
            throw safeError(error, this.password);
          }
          this.store.appendEvent(
            conversationId,
            allowed ? "permission.granted" : "permission.denied",
            {
              harnessId: this.id,
              sessionId,
              requestId: data.id,
              action: data.action,
              scope: "once",
            },
          );
          continue;
        }
        if (event?.type === "session.next.text.delta") {
          if (data.sessionID === sessionId && data.delta)
            yield {
              conversationId,
              type: "message.delta",
              payload: { sessionId, delta: data.delta },
            };
          continue;
        }
        if (event?.type === "session.next.tool.called") {
          if (data.sessionID !== sessionId) continue;
          const payload = {
            harnessId: this.id,
            sessionId,
            toolUseId: data.callID,
            toolName: data.tool,
          };
          this.store.appendEvent(conversationId, "tool.started", payload);
          yield { conversationId, type: "tool.started", payload };
          continue;
        }
        if (
          event?.type === "session.next.tool.success" ||
          event?.type === "session.next.tool.failed"
        ) {
          if (data.sessionID !== sessionId) continue;
          const success = event.type === "session.next.tool.success";
          const payload = {
            harnessId: this.id,
            sessionId,
            toolUseId: data.callID,
          };
          this.store.appendEvent(
            conversationId,
            success ? "tool.completed" : "tool.failed",
            payload,
          );
          yield {
            conversationId,
            type: success ? "tool.completed" : "tool.failed",
            payload,
          };
          continue;
        }
        if (event?.type === "session.error" && data.sessionID === sessionId)
          throw safeError(
            new Error(data.error?.message ?? "Erreur OpenCode pendant le tour"),
            this.password,
          );
        if (event?.type === "session.idle" && data.sessionID === sessionId)
          completed = true;
      }
      if (interrupted)
        yield {
          conversationId,
          type: "session.interrupted",
          payload: { sessionId },
        };
      else
        yield {
          conversationId,
          type: "session.completed",
          payload: { sessionId },
        };
    } catch (error) {
      if (signal?.aborted || controller.signal.aborted) {
        interrupted = true;
        yield {
          conversationId,
          type: "session.interrupted",
          payload: { sessionId },
        };
        return;
      }
      throw safeError(error, this.password);
    } finally {
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted && !active.interruptSent)
        await this.interrupt(sessionId).catch(() => {});
      controller.abort();
      await iterator?.return?.().catch(() => {});
      this.activeRuns.delete(sessionId);
    }
  }

  async dispose() {
    for (const [sessionId, active] of this.activeRuns) {
      active.controller.abort();
      await this.interrupt(sessionId).catch(() => {});
    }
    this.activeRuns.clear();
    this.client = null;
    this.password = null;
    const server = this.server;
    this.server = null;
    if (server) await server.close();
    this.sessions.clear();
  }
}
