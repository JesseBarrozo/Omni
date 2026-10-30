import { randomUUID } from "node:crypto";
import { assertHarnessAdapter } from "./adapters.mjs";
import { redactSecrets } from "./core.mjs";

const terminalTurnOutcomes = new Set(["completed", "failed", "cancelled"]);

function safeError(error, token) {
  let message = error instanceof Error ? error.message : String(error);
  if (token) message = message.replaceAll(token, "[REDACTED]");
  return new Error(redactSecrets(message));
}

function jsonError(response, body, token) {
  const detail =
    body?.error?.message ??
    body?.message ??
    ("Eve HTTP " + response.status + " " + response.statusText).trim();
  return safeError(new Error(detail), token);
}

function factPayload(fact, sessionId) {
  return {
    harnessId: "eve",
    sessionId,
    ...(fact.scope ?? {}),
    ...(fact.data ?? {}),
  };
}

function mapFact(fact, sessionId, conversationId) {
  const payload = factPayload(fact, sessionId);
  if (fact.type === "task.started") return { type: "task.started", payload };
  if (fact.type === "task.ended") {
    const outcome = fact.data?.outcome ?? fact.data?.status;
    return {
      type:
        outcome === "cancelled"
          ? "task.cancelled"
          : outcome === "failed"
            ? "task.failed"
            : "task.completed",
      payload,
    };
  }
  if (fact.type === "child.opened")
    return {
      type: "subagent.started",
      payload: {
        ...payload,
        childSessionId: fact.data?.sessionId,
        name: fact.data?.name,
      },
    };
  if (fact.type === "child.closed") {
    const outcome = fact.data?.outcome ?? fact.data?.status;
    return {
      type: outcome === "failed" ? "subagent.failed" : "subagent.completed",
      payload: {
        ...payload,
        childSessionId: fact.data?.sessionId,
        name: fact.data?.name,
        outcome,
      },
    };
  }
  if (fact.type === "call.requested")
    return {
      type: "tool.started",
      payload: {
        ...payload,
        toolName: fact.data?.capability?.name ?? fact.data?.capability?.label,
      },
    };
  if (fact.type === "call.settled") {
    const failed = ["failed", "error"].includes(fact.data?.outcome);
    return { type: failed ? "tool.failed" : "tool.completed", payload };
  }
  if (fact.type === "interaction.opened")
    return {
      type: "permission.requested",
      payload: {
        ...payload,
        requestId: fact.data?.interactionId ?? fact.data?.id,
      },
    };
  if (fact.type === "interaction.settled") {
    const denied = ["denied", "rejected", "cancelled"].includes(
      fact.data?.outcome ?? fact.data?.status,
    );
    return {
      type: denied ? "permission.denied" : "permission.granted",
      payload,
    };
  }
  if (fact.type === "usage.recorded")
    return {
      type: "usage.updated",
      payload: { ...payload, providerId: "eve", usage: fact.data },
    };
  if (
    fact.type === "turn.settled" &&
    terminalTurnOutcomes.has(fact.data?.outcome)
  )
    return {
      type:
        fact.data.outcome === "cancelled"
          ? "session.interrupted"
          : fact.data.outcome === "failed"
            ? "session.failed"
            : "session.completed",
      payload: { ...payload, conversationId },
    };
  if (fact.type === "session.ended")
    return {
      type:
        fact.data?.outcome === "failed"
          ? "session.failed"
          : "session.completed",
      payload: { ...payload, conversationId },
    };
  return null;
}

function mapProgress(progress, sessionId, conversationId) {
  if (progress?.type === "content.delta" && progress.data?.delta)
    return {
      type: "message.delta",
      payload: {
        harnessId: "eve",
        sessionId,
        conversationId,
        partId: progress.data.partId,
        delta: progress.data.delta,
      },
    };
  return null;
}

export class EveHarness {
  constructor({
    store = null,
    baseUrl = process.env.OMNI_EVE_URL,
    authToken = process.env.OMNI_EVE_AUTH_TOKEN,
    fetchImpl = fetch,
    timeoutMs = 30_000,
    requestPermission = async () => false,
  } = {}) {
    if (!baseUrl)
      throw new Error("OMNI_EVE_URL est requis pour le Harness Eve");
    this.store = store;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.authToken = authToken ?? null;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.requestPermission = requestPermission;
    this.sessions = new Map();
    this.active = new Map();
    this.id = "eve";
    this.name = "Eve durable HTTP";
    assertHarnessAdapter(this);
  }

  headers() {
    return {
      accept: "application/json",
      "content-type": "application/json",
      ...(this.authToken ? { authorization: "Bearer " + this.authToken } : {}),
    };
  }

  async request(path, { method = "GET", body, signal } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await this.fetchImpl(this.baseUrl + path, {
        method,
        headers: this.headers(),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
      const text = await response.text();
      let parsed = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {}
      }
      if (!response.ok) throw jsonError(response, parsed, this.authToken);
      return parsed;
    } catch (error) {
      throw safeError(error, this.authToken);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  async initialize() {
    await this.request("/eve/v1/health");
  }

  async capabilities() {
    return {
      tools: true,
      streaming: true,
      checkpoint: true,
      permissions: true,
      resume: true,
      durable: true,
      sandbox: process.env.OMNI_EVE_SANDBOX === "true",
      computerUse: process.env.OMNI_EVE_COMPUTER_USE === "true",
      mcpTransports: ["http"],
    };
  }

  async listModels() {
    const path = process.env.OMNI_EVE_MODELS_PATH ?? "/eve/v1/models";
    const result = await this.request(path);
    const models = Array.isArray(result) ? result : result?.models;
    if (!Array.isArray(models))
      throw new Error("Le catalogue de modèles Eve est invalide");
    return models.map((model) =>
      typeof model === "string" ? { id: model } : model,
    );
  }

  async createSession({ conversationId, prompt, resumeSummary } = {}) {
    if (!conversationId) throw new Error("conversationId Omni requis pour Eve");
    const result = await this.request("/eve/v1/session", {
      method: "POST",
      body: prompt ? { message: prompt } : {},
    });
    if (!result?.sessionId)
      throw new Error("Eve n’a pas retourné d’identifiant de session");
    const session = {
      id: result.sessionId,
      harnessId: this.id,
      conversationId,
      resumeSummary: resumeSummary ?? null,
      cursor: 0,
      initialMessageSent: Boolean(prompt),
      emittedParts: new Set(),
    };
    this.sessions.set(session.id, session);
    this.store?.appendEvent(conversationId, "session.started", {
      harnessId: this.id,
      sessionId: session.id,
      durable: true,
    });
    return session;
  }

  async resumeSession(sessionId, { conversationId, cursor = null } = {}) {
    if (!sessionId) throw new Error("sessionId Eve requis pour la reprise");
    if (!conversationId) throw new Error("conversationId Omni requis pour Eve");
    const storedCursor =
      cursor === null
        ? this.store
            ?.listEvents(conversationId)
            .filter(
              (event) =>
                event.type === "session.cursor.updated" &&
                event.payload.sessionId === sessionId,
            )
            .at(-1)?.payload.cursor
        : cursor;
    const session = {
      id: sessionId,
      harnessId: this.id,
      conversationId,
      cursor: Math.max(0, Number(storedCursor) || 0),
      initialMessageSent: false,
      emittedParts: new Set(),
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  async interrupt(sessionId) {
    if (!sessionId) return;
    await this.request(
      "/eve/v1/session/" + encodeURIComponent(sessionId) + "/cancel",
      { method: "POST" },
    );
  }

  async checkpoint(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Session Eve inconnue; checkpoint refusé");
    if (this.active.has(sessionId))
      throw new Error("Checkpoint Eve refusé pendant un tour actif");
    const checkpoint = {
      id: randomUUID(),
      sessionId,
      cursor: session.cursor,
      createdAt: new Date().toISOString(),
      state: "eve-session-reference",
    };
    this.store?.appendEvent(session.conversationId, "session.checkpointed", {
      harnessId: this.id,
      ...checkpoint,
    });
    return checkpoint;
  }

  async *readStream(session, signal) {
    const path =
      "/eve/v1/session/" +
      encodeURIComponent(session.id) +
      "/stream?startIndex=" +
      session.cursor;
    const response = await this.fetchImpl(this.baseUrl + path, {
      headers: this.headers(),
      signal,
    });
    if (!response.ok) {
      let body = null;
      try {
        body = await response.json();
      } catch {}
      throw jsonError(response, body, this.authToken);
    }
    if (!response.body) throw new Error("Le flux Eve ne contient pas de body");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) yield JSON.parse(line);
      }
      buffer += decoder.decode();
      if (buffer.trim()) yield JSON.parse(buffer);
    } finally {
      await reader.cancel().catch(() => {});
    }
  }

  async *run({ sessionId, conversationId, prompt, signal } = {}) {
    if (!sessionId)
      throw new Error("sessionId Eve requis; créez ou reprenez une session");
    if (!conversationId) throw new Error("conversationId Omni requis pour Eve");
    const session =
      this.sessions.get(sessionId) ??
      (await this.resumeSession(sessionId, { conversationId }));
    if (this.active.has(sessionId))
      throw new Error("Une exécution Eve est déjà active pour cette session");
    const controller = new AbortController();
    const abort = () => {
      controller.abort();
      void this.interrupt(sessionId).catch(() => {});
    };
    signal?.addEventListener("abort", abort, { once: true });
    this.active.set(sessionId, { controller });
    try {
      if (prompt && !session.initialMessageSent)
        await this.request("/eve/v1/session/" + encodeURIComponent(sessionId), {
          method: "POST",
          body: { message: prompt },
          signal: controller.signal,
        });
      session.initialMessageSent = false;
      let settled = false;
      while (!settled && !controller.signal.aborted) {
        for await (const record of this.readStream(
          session,
          controller.signal,
        )) {
          if (record?.["$eve"] === "heartbeat") continue;
          if (record?.["$eve"] === "stream.lease-ended") break;
          if (record?.["$eve"] === "stream.ended") {
            settled = true;
            break;
          }
          const line = record?.meta?.position?.line;
          if (Number.isInteger(line)) {
            session.cursor = Math.max(session.cursor, line + 1);
            this.store?.appendEvent(conversationId, "session.cursor.updated", {
              harnessId: this.id,
              sessionId,
              cursor: session.cursor,
            });
          }
          const mapped = record?.progress
            ? mapProgress(record.progress, sessionId, conversationId)
            : null;
          if (mapped) {
            if (mapped.payload.partId)
              session.emittedParts.add(mapped.payload.partId);
            this.store?.appendEvent(
              conversationId,
              mapped.type,
              mapped.payload,
            );
            yield mapped;
          }
          for (const fact of record?.facts ?? []) {
            if (
              fact.type === "content.completed" &&
              fact.data?.kind === "text" &&
              fact.data?.phase === "reply" &&
              fact.data?.value &&
              !session.emittedParts.has(fact.data.partId)
            ) {
              const completedText = {
                conversationId,
                type: "message.delta",
                payload: {
                  harnessId: this.id,
                  sessionId,
                  partId: fact.data.partId,
                  delta: fact.data.value,
                },
              };
              session.emittedParts.add(fact.data.partId);
              this.store?.appendEvent(
                conversationId,
                completedText.type,
                completedText.payload,
              );
              yield completedText;
            }
            const event = mapFact(fact, sessionId, conversationId);
            if (!event) continue;
            this.store?.appendEvent(conversationId, event.type, event.payload);
            yield event;
            if (event.type === "permission.requested") {
              let allowed = false;
              try {
                allowed = Boolean(
                  await this.requestPermission(
                    { ...event.payload, conversationId, sessionId },
                    signal,
                  ),
                );
              } catch {}
              const response = {
                requestId: event.payload.requestId,
                optionId: allowed ? "approve" : "deny",
              };
              await this.request(
                "/eve/v1/session/" + encodeURIComponent(sessionId),
                {
                  method: "POST",
                  body: { inputResponses: [response] },
                  signal: controller.signal,
                },
              );
              const decisionEvent = {
                conversationId,
                type: allowed ? "permission.granted" : "permission.denied",
                payload: {
                  harnessId: this.id,
                  sessionId,
                  requestId: response.requestId,
                  optionId: response.optionId,
                },
              };
              this.store?.appendEvent(
                conversationId,
                decisionEvent.type,
                decisionEvent.payload,
              );
              yield decisionEvent;
            }
            if (
              event.type.startsWith("session.") &&
              event.type !== "session.checkpointed"
            )
              settled = true;
          }
          if (settled) break;
        }
        if (!settled && !controller.signal.aborted)
          await new Promise((resolve) => setTimeout(resolve, 10));
      }
      if (controller.signal.aborted)
        yield {
          conversationId,
          type: "session.interrupted",
          payload: { harnessId: this.id, sessionId },
        };
    } catch (error) {
      if (controller.signal.aborted || signal?.aborted) {
        yield {
          conversationId,
          type: "session.interrupted",
          payload: { harnessId: this.id, sessionId },
        };
        return;
      }
      throw safeError(error, this.authToken);
    } finally {
      signal?.removeEventListener("abort", abort);
      this.active.delete(sessionId);
    }
  }

  async dispose() {
    for (const sessionId of this.active.keys())
      await this.interrupt(sessionId).catch(() => {});
    this.active.clear();
    this.sessions.clear();
  }
}
