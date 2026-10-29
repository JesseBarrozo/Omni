import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const EVENT_TYPES = Object.freeze([
  "conversation.created",
  "conversation.imported",
  "message.created",
  "message.delta",
  "message.revised",
  "message.completed",
  "message.interrupted",
  "message.failed",
  "tool.started",
  "tool.completed",
  "tool.failed",
  "permission.requested",
  "permission.granted",
  "permission.denied",
  "model.changed",
  "harness.changed",
  "harness.resume_context_consumed",
  "routing.decision",
  "routing.result",
  "routing.fallback",
  "usage.updated",
  "file.changed",
  "command.started",
  "command.completed",
  "session.started",
  "session.checkpointed",
  "session.interrupted",
  "session.completed",
  "session.failed",
]);

const now = () => new Date().toISOString();
const clone = (value) => JSON.parse(JSON.stringify(value));

export class EventStore {
  constructor(filePath = null, initial = []) {
    this.filePath = filePath;
    this.events = [...initial];
  }
  append(input) {
    if (!EVENT_TYPES.includes(input.type))
      throw new Error(`Unsupported Omni event: ${input.type}`);
    const event = {
      id: randomUUID(),
      version: 1,
      timestamp: now(),
      ...clone(input),
    };
    if (!event.conversationId)
      throw new Error("conversationId is required for an Omni event");
    this.events.push(event);
    return clone(event);
  }
  list(conversationId, type) {
    return this.events
      .filter(
        (event) =>
          event.conversationId === conversationId &&
          (!type || event.type === type),
      )
      .map(clone);
  }
  all() {
    return this.events.map(clone);
  }
  async save() {
    if (!this.filePath) return;
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(
      this.filePath,
      JSON.stringify(this.events, null, 2) + "\n",
      "utf8",
    );
  }
  static async load(filePath) {
    try {
      return new EventStore(
        filePath,
        JSON.parse(await readFile(filePath, "utf8")),
      );
    } catch (error) {
      if (error.code === "ENOENT") return new EventStore(filePath);
      throw error;
    }
  }
}

export class JsonRepository {
  constructor(filePath, seed = {}) {
    this.filePath = filePath;
    this.state = { ...seed };
  }
  async load() {
    try {
      this.state = JSON.parse(await readFile(this.filePath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return clone(this.state);
  }
  async save() {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(
      this.filePath,
      JSON.stringify(this.state, null, 2) + "\n",
      "utf8",
    );
    return clone(this.state);
  }
}

export class ConversationManager {
  constructor({ events = new EventStore(), repository = null } = {}) {
    this.events = events;
    this.repository = repository;
    this.projects = new Map();
    this.conversations = new Map();
  }
  async initialize() {
    if (this.repository) {
      const state = await this.repository.load();
      for (const project of state.projects ?? [])
        this.projects.set(project.id, project);
      for (const conversation of state.conversations ?? [])
        this.conversations.set(conversation.id, conversation);
    }
    return this;
  }
  async persist() {
    if (this.repository) {
      this.repository.state = {
        projects: [...this.projects.values()],
        conversations: [...this.conversations.values()],
      };
      await this.repository.save();
    }
    await this.events.save();
  }
  createProject(name, rootPath = null) {
    const project = { id: randomUUID(), name, rootPath, createdAt: now() };
    this.projects.set(project.id, project);
    return clone(project);
  }
  createConversation(projectId, title = "New conversation", routing = {}) {
    const conversation = {
      id: randomUUID(),
      projectId,
      title,
      status: "idle",
      activeHarnessId: routing.harnessId ?? null,
      activeModelId: routing.modelId ?? null,
      activeAccountId: routing.accountId ?? null,
      createdAt: now(),
      updatedAt: now(),
    };
    this.conversations.set(conversation.id, conversation);
    return clone(conversation);
  }
  get(id) {
    const conversation = this.conversations.get(id);
    if (!conversation) throw new Error(`Conversation not found: ${id}`);
    return clone(conversation);
  }
  setStatus(id, status) {
    const conversation = this.conversations.get(id);
    if (!conversation) throw new Error(`Conversation not found: ${id}`);
    conversation.status = status;
    conversation.updatedAt = now();
    return clone(conversation);
  }
  addMessage(id, role, content, metadata = {}) {
    const conversation = this.get(id);
    const message = {
      id: randomUUID(),
      role,
      content,
      metadata,
      createdAt: now(),
    };
    this.events.append({
      conversationId: id,
      type: "message.created",
      payload: message,
    });
    conversation.updatedAt = now();
    this.conversations.set(id, conversation);
    return message;
  }
  exportConversation(id) {
    return { conversation: this.get(id), events: this.events.list(id) };
  }
  search(query) {
    const term = query.toLowerCase();
    return [...this.conversations.values()]
      .filter(
        (c) =>
          c.title.toLowerCase().includes(term) ||
          this.events.list(c.id).some((e) =>
            JSON.stringify(e.payload ?? {})
              .toLowerCase()
              .includes(term),
          ),
      )
      .map(clone);
  }
}

export class PermissionManager {
  constructor({
    events = new EventStore(),
    defaultTtlMs = 30 * 60 * 1000,
  } = {}) {
    this.events = events;
    this.defaultTtlMs = defaultTtlMs;
    this.decisions = new Map();
  }
  key(input) {
    return [input.projectId, input.tool, input.action].join(":");
  }
  request(input) {
    const request = {
      id: randomUUID(),
      ...input,
      expiresAt: new Date(
        Date.now() + (input.ttlMs ?? this.defaultTtlMs),
      ).toISOString(),
    };
    this.events.append({
      conversationId: input.conversationId,
      type: "permission.requested",
      payload: request,
    });
    return request;
  }
  decide(request, granted, reason = null) {
    const decision = {
      requestId: request.id,
      projectId: request.projectId,
      tool: request.tool,
      action: request.action,
      granted,
      reason,
      decidedAt: now(),
      expiresAt: request.expiresAt,
    };
    this.decisions.set(this.key(request), decision);
    this.events.append({
      conversationId: request.conversationId,
      type: granted ? "permission.granted" : "permission.denied",
      payload: decision,
    });
    return decision;
  }
  can(input) {
    const decision = this.decisions.get(this.key(input));
    return Boolean(
      decision?.granted && new Date(decision.expiresAt).getTime() > Date.now(),
    );
  }
  revoke(input) {
    this.decisions.delete(this.key(input));
  }
}

export class ModelRegistry {
  constructor() {
    this.providers = new Map();
    this.models = new Map();
    this.harnesses = new Map();
  }
  registerProvider(provider) {
    this.providers.set(provider.id, { enabled: true, ...clone(provider) });
    return this.providers.get(provider.id);
  }
  registerModel(model) {
    if (!this.providers.has(model.providerId))
      throw new Error(`Unknown provider: ${model.providerId}`);
    const value = { enabled: true, enabledForAuto: true, ...clone(model) };
    this.models.set(`${model.providerId}\0${model.id}`, value);
    return value;
  }
  registerHarness(harness) {
    const value = { enabled: true, ...clone(harness) };
    this.harnesses.set(harness.id, value);
    return value;
  }
  setProviderEnabled(id, enabled) {
    const provider = this.providers.get(id);
    if (!provider) throw new Error(`Unknown provider: ${id}`);
    provider.enabled = enabled;
    return provider;
  }
  setModelEnabled(id, enabled, enabledForAuto) {
    const matches = [...this.models.values()].filter(
      (candidate) => candidate.id === id,
    );
    if (matches.length > 1)
      throw new Error(`Model ID is ambiguous across providers: ${id}`);
    const model = matches[0];
    if (!model) throw new Error(`Unknown model: ${id}`);
    model.enabled = enabled;
    model.enabledForAuto = enabledForAuto ?? model.enabledForAuto;
    return model;
  }
  listModels({ includeDisabled = false, autoOnly = false } = {}) {
    return [...this.models.values()]
      .filter((m) => {
        const p = this.providers.get(m.providerId);
        return (
          (includeDisabled || (m.enabled && p?.enabled)) &&
          (!autoOnly || m.enabledForAuto) &&
          Boolean(p?.enabled)
        );
      })
      .map(clone);
  }
  listHarnesses() {
    return [...this.harnesses.values()].filter((h) => h.enabled).map(clone);
  }
}

export class AutoRouter {
  constructor(
    registry,
    {
      profile = "balance",
      excludedProviders = [],
      preferredProviders = [],
      maxInputPerMillion = null,
      privacyMode = false,
      previousResults = {},
      availableMcpServers = [],
    } = {},
  ) {
    this.registry = registry;
    this.profile = profile;
    this.excludedProviders = new Set(excludedProviders);
    this.preferredProviders = preferredProviders;
    this.maxInputPerMillion = maxInputPerMillion;
    this.privacyMode = privacyMode;
    this.previousResults = previousResults;
    this.availableMcpServers = new Set(availableMcpServers);
  }
  analyze(input) {
    const text =
      `${input.prompt ?? ""} ${input.projectLanguage ?? ""}`.toLowerCase();
    const requiredMcpServers = [...new Set(input.requiredMcpServers ?? [])];
    if (
      requiredMcpServers.some(
        (name) =>
          typeof name !== "string" ||
          !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(name),
      )
    )
      throw new TypeError("Nom de serveur MCP requis invalide");
    const inferredTools =
      input.needsTools ??
      /\b(run|execute|terminal|file|debug|test|implement|write)\b/.test(text);
    const needsTools = inferredTools || requiredMcpServers.length > 0;
    const complexity =
      input.complexity ??
      (text.length > 500 || /architecture|refactor|migration/.test(text)
        ? "high"
        : "medium");
    return {
      type: needsTools ? "agentic" : "chat",
      needsTools,
      requiredMcpServers,
      complexity,
      privacy: input.privacy ?? this.privacyMode,
    };
  }
  evaluate(input) {
    const task = this.analyze(input);
    const evaluated = [];
    for (const model of this.registry.models.values()) {
      const provider = this.registry.providers.get(model.providerId);
      for (const harness of this.registry.harnesses.values()) {
        const exclusions = [];
        if (!provider?.enabled) exclusions.push("provider-disabled");
        if (!model.enabled) exclusions.push("model-disabled");
        if (!model.enabledForAuto)
          exclusions.push("model-not-enabled-for-auto");
        if (this.excludedProviders.has(model.providerId))
          exclusions.push("provider-excluded-by-policy");
        if (model.available === false) exclusions.push("model-unavailable");
        if (!harness.enabled) exclusions.push("harness-disabled");
        if (
          Array.isArray(harness.providerIds) &&
          !harness.providerIds.includes(model.providerId)
        )
          exclusions.push("provider-harness-incompatible");
        if (harness.available === false) exclusions.push("harness-unavailable");
        if (task.needsTools && harness.capabilities?.tools !== true)
          exclusions.push("required-tools-unsupported");
        if (
          task.requiredMcpServers.some(
            (name) => !this.availableMcpServers.has(name),
          )
        )
          exclusions.push("required-mcp-server-unavailable");
        if (
          task.requiredMcpServers.some(
            (name) => !harness.capabilities?.mcpServers?.includes(name),
          )
        )
          exclusions.push("required-mcp-unsupported");
        if (task.privacy && harness.privacyApproved !== true)
          exclusions.push("privacy-not-approved");
        const price = model.pricing?.inputPerMillion;
        if (
          this.maxInputPerMillion !== null &&
          (!Number.isFinite(price) || price > this.maxInputPerMillion)
        )
          exclusions.push(
            Number.isFinite(price)
              ? "input-price-over-limit"
              : "input-price-unknown",
          );
        const key = `${model.providerId}/${model.id}/${harness.id}`;
        evaluated.push({
          key,
          model,
          provider,
          harness,
          eligible: exclusions.length === 0,
          exclusions,
          preferredRank: this.preferredProviders.indexOf(model.providerId),
          previous: this.previousResults[key] ?? null,
          latencyMs: this.previousResults[key]?.averageLatencyMs ?? null,
          inputPerMillion: price ?? null,
          quality: Number.isFinite(model.quality) ? model.quality : null,
        });
      }
    }
    const eligible = evaluated.filter((item) => item.eligible);
    eligible.sort((a, b) => {
      const preferredA = a.preferredRank < 0 ? Infinity : a.preferredRank;
      const preferredB = b.preferredRank < 0 ? Infinity : b.preferredRank;
      if (preferredA !== preferredB) return preferredA - preferredB;
      const capabilityRank = (harness) => {
        const tools = harness.capabilities?.tools;
        if (task.needsTools) return tools === true ? 0 : 1;
        if (tools === false) return 0;
        if (tools === "read-only") return 1;
        return 2;
      };
      const capabilityFitA = capabilityRank(a.harness);
      const capabilityFitB = capabilityRank(b.harness);
      if (capabilityFitA !== capabilityFitB)
        return capabilityFitA - capabilityFitB;
      const successA = a.previous?.attempts
        ? a.previous.successes / a.previous.attempts
        : null;
      const successB = b.previous?.attempts
        ? b.previous.successes / b.previous.attempts
        : null;
      if (successA !== successB) {
        if (successA === null) return 1;
        if (successB === null) return -1;
        if (successA !== successB) return successB - successA;
      }
      if (this.profile === "intelligence" && a.quality !== b.quality) {
        if (a.quality === null) return 1;
        if (b.quality === null) return -1;
        return b.quality - a.quality;
      }
      if (this.profile === "efficiency") {
        if (a.inputPerMillion !== b.inputPerMillion) {
          if (a.inputPerMillion === null) return 1;
          if (b.inputPerMillion === null) return -1;
          return a.inputPerMillion - b.inputPerMillion;
        }
      }
      if (a.latencyMs !== b.latencyMs) {
        if (a.latencyMs === null) return 1;
        if (b.latencyMs === null) return -1;
        return a.latencyMs - b.latencyMs;
      }
      if (a.inputPerMillion !== b.inputPerMillion) {
        if (a.inputPerMillion === null) return 1;
        if (b.inputPerMillion === null) return -1;
        return a.inputPerMillion - b.inputPerMillion;
      }
      return a.key.localeCompare(b.key);
    });
    return { task, evaluated, eligible };
  }
  candidates(input) {
    return this.evaluate(input).eligible;
  }
  select(input) {
    const { task, evaluated, eligible } = this.evaluate(input);
    const candidates = eligible;
    if (!candidates.length) {
      if (task.requiredMcpServers.length)
        throw new Error(
          `No compatible enabled model/harness candidate supports required MCP server(s): ${task.requiredMcpServers.join(", ")}`,
        );
      throw new Error("No compatible enabled model/harness candidate");
    }
    const selected = candidates[0];
    const ranking = [
      "preferredProviders (configured order)",
      "least-privilege capability fit (tools only when required)",
      ...(task.requiredMcpServers.length
        ? ["registered MCP stdio servers required by the task"]
        : []),
      "recorded success rate (only when available)",
      ...(this.profile === "intelligence"
        ? ["explicit model quality (only when available)"]
        : []),
      ...(this.profile === "efficiency"
        ? ["known input price (only when available)"]
        : []),
      "recorded latency (only when available)",
      "known input price (only when available)",
      "provider/model/harness ID (stable tie-break)",
    ];
    return {
      id: randomUUID(),
      selected: {
        modelId: selected.model.id,
        providerId: selected.model.providerId,
        harnessId: selected.harness.id,
      },
      fallback: candidates[1]
        ? {
            modelId: candidates[1].model.id,
            providerId: candidates[1].model.providerId,
            harnessId: candidates[1].harness.id,
          }
        : null,
      evaluatedCandidates: evaluated.map((candidate) => ({
        key: candidate.key,
        eligible: candidate.eligible,
        exclusions: candidate.exclusions,
        previous: candidate.previous,
        observedLatencyMs: candidate.latencyMs,
        knownInputPricePerMillion: candidate.inputPerMillion,
      })),
      criteria: {
        task,
        profile: this.profile,
        privacyMode: task.privacy,
        maxInputPerMillion: this.maxInputPerMillion,
        preferredProviders: this.preferredProviders,
        ranking,
      },
      candidates: candidates.map((c) => ({
        modelId: c.model.id,
        providerId: c.model.providerId,
        harnessId: c.harness.id,
      })),
      explanation: `Mode Auto · ${selected.harness.name ?? selected.harness.id} · ${selected.model.name ?? selected.model.id} · tâche ${task.type}, profil ${this.profile}${task.needsTools ? ", outils requis" : ""}${task.requiredMcpServers.length ? `, MCP requis: ${task.requiredMcpServers.join(", ")}` : ""}`,
    };
  }
}

export class SwapCoordinator {
  constructor({
    events = new EventStore(),
    conversations,
    adapters = new Map(),
  } = {}) {
    this.events = events;
    this.conversations = conversations;
    this.adapters = adapters;
  }
  async swap({
    conversationId,
    fromHarnessId,
    toHarnessId,
    reason = "user requested",
  }) {
    const conversation = this.conversations.get(conversationId);
    if (conversation.status === "running")
      throw new Error("Harness swap is deferred while an execution is active");
    const checkpoint = {
      id: randomUUID(),
      conversationId,
      createdAt: now(),
      sourceHarnessId: fromHarnessId,
      state: "safe-boundary",
      summary: this.resumeSummary(conversationId),
    };
    this.events.append({
      conversationId,
      type: "session.checkpointed",
      payload: checkpoint,
    });
    const target = this.adapters.get(toHarnessId);
    if (target?.createSession)
      await target.createSession({
        conversationId,
        resumeSummary: checkpoint.summary,
      });
    conversation.activeHarnessId = toHarnessId;
    this.conversations.conversations.set(conversationId, conversation);
    this.events.append({
      conversationId,
      type: "harness.changed",
      payload: {
        fromHarnessId,
        toHarnessId,
        reason,
        checkpointId: checkpoint.id,
        limitations: ["Harness-local hidden state is not transferred"],
      },
    });
    await this.conversations.persist();
    return checkpoint;
  }
  resumeSummary(conversationId) {
    const events = this.events.list(conversationId);
    return {
      objective:
        events.find(
          (e) => e.type === "message.created" && e.payload.role === "user",
        )?.payload.content ?? "",
      decisions: events
        .filter((e) =>
          [
            "routing.decision",
            "permission.granted",
            "permission.denied",
          ].includes(e.type),
        )
        .map((e) => e.payload),
      files: events
        .filter((e) => e.type === "file.changed")
        .map((e) => e.payload),
      commands: events
        .filter((e) =>
          ["command.started", "command.completed"].includes(e.type),
        )
        .map((e) => e.payload),
      errors: events
        .filter((e) => ["tool.failed", "session.failed"].includes(e.type))
        .map((e) => e.payload),
      tasksRemaining:
        "Continue from the latest checkpoint; do not repeat completed non-idempotent actions.",
      lastCheckpoint:
        events.filter((e) => e.type === "session.checkpointed").at(-1)?.id ??
        null,
    };
  }
}

export class ExecutionCoordinator {
  constructor({
    events = new EventStore(),
    conversations,
    permissions = null,
  } = {}) {
    this.events = events;
    this.conversations = conversations;
    this.permissions = permissions;
    this.active = new Map();
  }
  async run({
    conversationId,
    adapter,
    prompt,
    sessionId = null,
    modelId = null,
    accountId = null,
  }) {
    const conversation = this.conversations.get(conversationId);
    if (conversation.status === "running")
      throw new Error("Conversation is already running");
    this.conversations.setStatus(conversationId, "running");
    const correlationId = randomUUID();
    const session = sessionId
      ? { id: sessionId }
      : await adapter.createSession({ conversationId, modelId, accountId });
    this.active.set(conversationId, {
      adapter,
      sessionId: session.id,
      correlationId,
    });
    this.conversations.addMessage(conversationId, "user", prompt, {
      correlationId,
    });
    try {
      for await (const event of adapter.run({
        conversationId,
        sessionId: session.id,
        prompt,
        modelId,
        accountId,
        correlationId,
      }))
        this.events.append({ ...event, correlationId });
      this.events.append({
        conversationId,
        type: "session.completed",
        correlationId,
        payload: { sessionId: session.id },
      });
      this.conversations.setStatus(conversationId, "idle");
      return { sessionId: session.id, correlationId };
    } catch (error) {
      this.events.append({
        conversationId,
        type: "session.failed",
        correlationId,
        payload: { sessionId: session.id, message: error.message },
      });
      this.conversations.setStatus(conversationId, "failed");
      throw error;
    } finally {
      this.active.delete(conversationId);
      await this.conversations.persist();
    }
  }
  async interrupt(conversationId) {
    const active = this.active.get(conversationId);
    if (!active) return false;
    await active.adapter.interrupt(active.sessionId);
    this.events.append({
      conversationId,
      type: "session.interrupted",
      correlationId: active.correlationId,
      payload: { sessionId: active.sessionId },
    });
    this.conversations.setStatus(conversationId, "interrupted");
    return true;
  }
}

export function redactSecrets(value) {
  const text = JSON.stringify(value)
    .replace(
      /(sk-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._-]+|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/g,
      "[REDACTED]",
    )
    .replace(
      /(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization)["']?\s*[:=]\s*["']?)[^"'\s,}]+/gi,
      "$1[REDACTED]",
    );
  return JSON.parse(text);
}
