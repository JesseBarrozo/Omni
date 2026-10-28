import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const EVENT_TYPES = Object.freeze([
  "conversation.created", "conversation.imported", "message.created", "message.delta", "message.revised", "message.completed", "message.interrupted", "message.failed", "tool.started", "tool.completed", "tool.failed",
  "permission.requested", "permission.granted", "permission.denied", "model.changed", "harness.changed",
  "routing.decision", "routing.fallback", "usage.updated", "file.changed", "command.started", "command.completed",
  "session.started", "session.checkpointed", "session.interrupted", "session.completed", "session.failed"
]);

const now = () => new Date().toISOString();
const clone = (value) => JSON.parse(JSON.stringify(value));
const score01 = (value, fallback = 0.5) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;

export class EventStore {
  constructor(filePath = null, initial = []) { this.filePath = filePath; this.events = [...initial]; }
  append(input) {
    if (!EVENT_TYPES.includes(input.type)) throw new Error(`Unsupported Omni event: ${input.type}`);
    const event = { id: randomUUID(), version: 1, timestamp: now(), ...clone(input) };
    if (!event.conversationId) throw new Error("conversationId is required for an Omni event");
    this.events.push(event);
    return clone(event);
  }
  list(conversationId, type) { return this.events.filter((event) => event.conversationId === conversationId && (!type || event.type === type)).map(clone); }
  all() { return this.events.map(clone); }
  async save() { if (!this.filePath) return; await mkdir(dirname(this.filePath), { recursive: true }); await writeFile(this.filePath, JSON.stringify(this.events, null, 2) + "\n", "utf8"); }
  static async load(filePath) { try { return new EventStore(filePath, JSON.parse(await readFile(filePath, "utf8"))); } catch (error) { if (error.code === "ENOENT") return new EventStore(filePath); throw error; } }
}

export class JsonRepository {
  constructor(filePath, seed = {}) { this.filePath = filePath; this.state = { ...seed }; }
  async load() { try { this.state = JSON.parse(await readFile(this.filePath, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; } return clone(this.state); }
  async save() { await mkdir(dirname(this.filePath), { recursive: true }); await writeFile(this.filePath, JSON.stringify(this.state, null, 2) + "\n", "utf8"); return clone(this.state); }
}

export class ConversationManager {
  constructor({ events = new EventStore(), repository = null } = {}) { this.events = events; this.repository = repository; this.projects = new Map(); this.conversations = new Map(); }
  async initialize() { if (this.repository) { const state = await this.repository.load(); for (const project of state.projects ?? []) this.projects.set(project.id, project); for (const conversation of state.conversations ?? []) this.conversations.set(conversation.id, conversation); } return this; }
  async persist() { if (this.repository) { this.repository.state = { projects: [...this.projects.values()], conversations: [...this.conversations.values()] }; await this.repository.save(); } await this.events.save(); }
  createProject(name, rootPath = null) { const project = { id: randomUUID(), name, rootPath, createdAt: now() }; this.projects.set(project.id, project); return clone(project); }
  createConversation(projectId, title = "New conversation", routing = {}) { const conversation = { id: randomUUID(), projectId, title, status: "idle", activeHarnessId: routing.harnessId ?? null, activeModelId: routing.modelId ?? null, activeAccountId: routing.accountId ?? null, createdAt: now(), updatedAt: now() }; this.conversations.set(conversation.id, conversation); return clone(conversation); }
  get(id) { const conversation = this.conversations.get(id); if (!conversation) throw new Error(`Conversation not found: ${id}`); return clone(conversation); }
  setStatus(id, status) { const conversation = this.conversations.get(id); if (!conversation) throw new Error(`Conversation not found: ${id}`); conversation.status = status; conversation.updatedAt = now(); return clone(conversation); }
  addMessage(id, role, content, metadata = {}) { const conversation = this.get(id); const message = { id: randomUUID(), role, content, metadata, createdAt: now() }; this.events.append({ conversationId: id, type: "message.created", payload: message }); conversation.updatedAt = now(); this.conversations.set(id, conversation); return message; }
  exportConversation(id) { return { conversation: this.get(id), events: this.events.list(id) }; }
  search(query) { const term = query.toLowerCase(); return [...this.conversations.values()].filter((c) => c.title.toLowerCase().includes(term) || this.events.list(c.id).some((e) => JSON.stringify(e.payload ?? {}).toLowerCase().includes(term))).map(clone); }
}

export class PermissionManager {
  constructor({ events = new EventStore(), defaultTtlMs = 30 * 60 * 1000 } = {}) { this.events = events; this.defaultTtlMs = defaultTtlMs; this.decisions = new Map(); }
  key(input) { return [input.projectId, input.tool, input.action].join(":"); }
  request(input) { const request = { id: randomUUID(), ...input, expiresAt: new Date(Date.now() + (input.ttlMs ?? this.defaultTtlMs)).toISOString() }; this.events.append({ conversationId: input.conversationId, type: "permission.requested", payload: request }); return request; }
  decide(request, granted, reason = null) { const decision = { requestId: request.id, projectId: request.projectId, tool: request.tool, action: request.action, granted, reason, decidedAt: now(), expiresAt: request.expiresAt }; this.decisions.set(this.key(request), decision); this.events.append({ conversationId: request.conversationId, type: granted ? "permission.granted" : "permission.denied", payload: decision }); return decision; }
  can(input) { const decision = this.decisions.get(this.key(input)); return Boolean(decision?.granted && new Date(decision.expiresAt).getTime() > Date.now()); }
  revoke(input) { this.decisions.delete(this.key(input)); }
}

export class ModelRegistry {
  constructor() { this.providers = new Map(); this.models = new Map(); this.harnesses = new Map(); }
  registerProvider(provider) { this.providers.set(provider.id, { enabled: true, ...clone(provider) }); return this.providers.get(provider.id); }
  registerModel(model) { if (!this.providers.has(model.providerId)) throw new Error(`Unknown provider: ${model.providerId}`); const value = { enabled: true, enabledForAuto: true, ...clone(model) }; this.models.set(model.id, value); return value; }
  registerHarness(harness) { const value = { enabled: true, ...clone(harness) }; this.harnesses.set(harness.id, value); return value; }
  setProviderEnabled(id, enabled) { const provider = this.providers.get(id); if (!provider) throw new Error(`Unknown provider: ${id}`); provider.enabled = enabled; return provider; }
  setModelEnabled(id, enabled, enabledForAuto = this.models.get(id)?.enabledForAuto) { const model = this.models.get(id); if (!model) throw new Error(`Unknown model: ${id}`); model.enabled = enabled; model.enabledForAuto = enabledForAuto; return model; }
  listModels({ includeDisabled = false, autoOnly = false } = {}) { return [...this.models.values()].filter((m) => { const p = this.providers.get(m.providerId); return (includeDisabled || (m.enabled && p?.enabled)) && (!autoOnly || m.enabledForAuto) && Boolean(p?.enabled); }).map(clone); }
  listHarnesses() { return [...this.harnesses.values()].filter((h) => h.enabled).map(clone); }
}

export class AutoRouter {
  constructor(registry, { profile = "balance", excludedProviders = [], preferredProviders = [], budgetRemaining = Infinity, privacyMode = false } = {}) { this.registry = registry; this.profile = profile; this.excludedProviders = new Set(excludedProviders); this.preferredProviders = preferredProviders; this.budgetRemaining = budgetRemaining; this.privacyMode = privacyMode; }
  analyze(input) { const text = `${input.prompt ?? ""} ${input.projectLanguage ?? ""}`.toLowerCase(); const needsTools = input.needsTools ?? /\b(run|execute|terminal|file|debug|test|implement|write)\b/.test(text); const complexity = input.complexity ?? (text.length > 500 || /architecture|refactor|migration/.test(text) ? "high" : "medium"); return { type: needsTools ? "agentic" : "chat", needsTools, complexity, privacy: input.privacy ?? this.privacyMode }; }
  candidates(input) { const task = this.analyze(input); const harnesses = this.registry.listHarnesses(); return this.registry.listModels({ autoOnly: true }).filter((model) => !this.excludedProviders.has(model.providerId)).filter((model) => this.budgetRemaining === Infinity || (model.pricing?.inputPerMillion ?? 0) <= this.budgetRemaining).flatMap((model) => harnesses.filter((h) => !task.needsTools || h.capabilities?.tools !== false).filter((h) => !task.privacy || h.privacyApproved !== false).map((h) => { const capability = task.needsTools ? score01(model.capabilities?.tools ? 1 : 0, 0) : 1; const quality = score01(model.quality, 0.6); const latency = 1 - score01(model.latency, 0.5); const cost = 1 - Math.min(1, (model.pricing?.inputPerMillion ?? 0) / 100); const preferred = this.preferredProviders.includes(model.providerId) ? 0.15 : 0; const local = /local|ollama|lm studio|llama/i.test(model.providerId) ? 1 : 0; const profile = this.profile === "efficiency" ? cost * .45 + latency * .3 + quality * .1 : this.profile === "intelligence" ? quality * .55 + capability * .25 + cost * .05 : this.profile === "local-first" ? local * .6 + quality * .2 + latency * .1 : quality * .35 + capability * .25 + cost * .2 + latency * .2; return { model, harness: h, score: profile + preferred, reasons: { task: task.type, complexity: task.complexity, tools: task.needsTools, profile: this.profile } }; })); }
  select(input) { const candidates = this.candidates(input).sort((a, b) => b.score - a.score); if (!candidates.length) throw new Error("No compatible enabled model/harness candidate"); const selected = candidates[0]; return { id: randomUUID(), selected: { modelId: selected.model.id, providerId: selected.model.providerId, harnessId: selected.harness.id }, fallback: candidates[1] ? { modelId: candidates[1].model.id, providerId: candidates[1].model.providerId, harnessId: candidates[1].harness.id } : null, candidates: candidates.map((c) => ({ modelId: c.model.id, harnessId: c.harness.id, score: Number(c.score.toFixed(4)) })), explanation: `Mode Auto · ${selected.harness.name ?? selected.harness.id} · ${selected.model.name ?? selected.model.id} · tâche ${selected.reasons.task}, profil ${this.profile}${selected.reasons.tools ? ", outils requis" : ""}` }; }
}

export class SwapCoordinator {
  constructor({ events = new EventStore(), conversations, adapters = new Map() } = {}) { this.events = events; this.conversations = conversations; this.adapters = adapters; }
  async swap({ conversationId, fromHarnessId, toHarnessId, reason = "user requested" }) { const conversation = this.conversations.get(conversationId); if (conversation.status === "running") throw new Error("Harness swap is deferred while an execution is active"); const checkpoint = { id: randomUUID(), conversationId, createdAt: now(), sourceHarnessId: fromHarnessId, state: "safe-boundary", summary: this.resumeSummary(conversationId) }; this.events.append({ conversationId, type: "session.checkpointed", payload: checkpoint }); const target = this.adapters.get(toHarnessId); if (target?.createSession) await target.createSession({ conversationId, resumeSummary: checkpoint.summary }); conversation.activeHarnessId = toHarnessId; this.conversations.conversations.set(conversationId, conversation); this.events.append({ conversationId, type: "harness.changed", payload: { fromHarnessId, toHarnessId, reason, checkpointId: checkpoint.id, limitations: ["Harness-local hidden state is not transferred"] } }); await this.conversations.persist(); return checkpoint; }
  resumeSummary(conversationId) { const events = this.events.list(conversationId); return { objective: events.find((e) => e.type === "message.created" && e.payload.role === "user")?.payload.content ?? "", decisions: events.filter((e) => ["routing.decision", "permission.granted", "permission.denied"].includes(e.type)).map((e) => e.payload), files: events.filter((e) => e.type === "file.changed").map((e) => e.payload), commands: events.filter((e) => ["command.started", "command.completed"].includes(e.type)).map((e) => e.payload), errors: events.filter((e) => ["tool.failed", "session.failed"].includes(e.type)).map((e) => e.payload), tasksRemaining: "Continue from the latest checkpoint; do not repeat completed non-idempotent actions.", lastCheckpoint: events.filter((e) => e.type === "session.checkpointed").at(-1)?.id ?? null }; }
}

export class ExecutionCoordinator {
  constructor({ events = new EventStore(), conversations, permissions = null } = {}) { this.events = events; this.conversations = conversations; this.permissions = permissions; this.active = new Map(); }
  async run({ conversationId, adapter, prompt, sessionId = null, modelId = null, accountId = null }) {
    const conversation = this.conversations.get(conversationId); if (conversation.status === "running") throw new Error("Conversation is already running");
    this.conversations.setStatus(conversationId, "running"); const correlationId = randomUUID(); const session = sessionId ? { id: sessionId } : await adapter.createSession({ conversationId, modelId, accountId }); this.active.set(conversationId, { adapter, sessionId: session.id, correlationId });
    this.conversations.addMessage(conversationId, "user", prompt, { correlationId });
    try {
      for await (const event of adapter.run({ conversationId, sessionId: session.id, prompt, modelId, accountId, correlationId })) this.events.append({ ...event, correlationId });
      this.events.append({ conversationId, type: "session.completed", correlationId, payload: { sessionId: session.id } }); this.conversations.setStatus(conversationId, "idle"); return { sessionId: session.id, correlationId };
    } catch (error) { this.events.append({ conversationId, type: "session.failed", correlationId, payload: { sessionId: session.id, message: error.message } }); this.conversations.setStatus(conversationId, "failed"); throw error; } finally { this.active.delete(conversationId); await this.conversations.persist(); }
  }
  async interrupt(conversationId) { const active = this.active.get(conversationId); if (!active) return false; await active.adapter.interrupt(active.sessionId); this.events.append({ conversationId, type: "session.interrupted", correlationId: active.correlationId, payload: { sessionId: active.sessionId } }); this.conversations.setStatus(conversationId, "interrupted"); return true; }
}

export function redactSecrets(value) { const text = JSON.stringify(value).replace(/(sk-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._-]+)/g, "[REDACTED]"); return JSON.parse(text); }
