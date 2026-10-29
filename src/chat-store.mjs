import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { EVENT_TYPES, redactSecrets } from "./core.mjs";

export class ChatStore {
  constructor(file) {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    try {
      chmodSync(dirname(file), 0o700);
    } catch {}
    this.db = new Database(file);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
    );
    const version =
      this.db
        .prepare("SELECT MAX(version) AS version FROM schema_migrations")
        .get().version ?? 0;
    if (version < 1)
      this.db.transaction(() => {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, root_path TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), title TEXT NOT NULL, status TEXT NOT NULL, model_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id), role TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS conversation_events (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id), type TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS conversation_events_order ON conversation_events(conversation_id, created_at, id);
      CREATE TRIGGER IF NOT EXISTS conversation_events_no_update BEFORE UPDATE ON conversation_events BEGIN SELECT RAISE(ABORT, 'conversation events are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS conversation_events_no_delete BEFORE DELETE ON conversation_events BEGIN SELECT RAISE(ABORT, 'conversation events are append-only'); END;
    `);
        this.db
          .prepare(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)",
          )
          .run(new Date().toISOString());
      })();
    try {
      chmodSync(file, 0o600);
    } catch {}
  }
  createProject(name, rootPath = null) {
    const project = {
      id: randomUUID(),
      name,
      rootPath,
      createdAt: new Date().toISOString(),
    };
    this.db
      .prepare("INSERT INTO projects VALUES (?, ?, ?, ?)")
      .run(project.id, project.name, project.rootPath, project.createdAt);
    return project;
  }
  project(idOrPath) {
    const byId = this.db
      .prepare("SELECT * FROM projects WHERE id = ?")
      .get(idOrPath);
    const row =
      byId ??
      this.db
        .prepare("SELECT * FROM projects WHERE root_path = ?")
        .get(idOrPath);
    if (!row) throw new Error(`Projet introuvable: ${idOrPath}`);
    return {
      id: row.id,
      name: row.name,
      rootPath: row.root_path,
      createdAt: row.created_at,
    };
  }
  projects() {
    return this.db
      .prepare("SELECT * FROM projects ORDER BY created_at")
      .all()
      .map((r) => ({
        id: r.id,
        name: r.name,
        rootPath: r.root_path,
        createdAt: r.created_at,
      }));
  }
  createConversation(projectId, title, modelId) {
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db.transaction(() => {
      this.db
        .prepare("INSERT INTO conversations VALUES (?, ?, ?, 'idle', ?, ?, ?)")
        .run(id, projectId, title, modelId, now, now);
      this.appendEvent(id, "conversation.created", { title, modelId });
    })();
    return this.conversation(id);
  }
  appendEvent(conversationId, type, payload = {}) {
    if (!EVENT_TYPES.includes(type))
      throw new Error(`Unsupported Omni event: ${type}`);
    const event = {
      id: randomUUID(),
      conversationId,
      type,
      payload: redactSecrets(payload),
      createdAt: new Date().toISOString(),
    };
    this.db
      .prepare("INSERT INTO conversation_events VALUES (?, ?, ?, ?, ?)")
      .run(
        event.id,
        event.conversationId,
        event.type,
        JSON.stringify(event.payload),
        event.createdAt,
      );
    return event;
  }
  listEvents(conversationId) {
    return this.db
      .prepare(
        "SELECT id, conversation_id AS conversationId, type, payload_json, created_at AS createdAt FROM conversation_events WHERE conversation_id = ? ORDER BY created_at, rowid",
      )
      .all(conversationId)
      .map((row) => ({
        id: row.id,
        conversationId: row.conversationId,
        type: row.type,
        payload: JSON.parse(row.payload_json),
        createdAt: row.createdAt,
      }));
  }
  routingResults(limit = 200) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 10000)
      throw new Error(
        "La limite des résultats de routage doit être entre 1 et 10000",
      );
    return this.db
      .prepare(
        "SELECT id, conversation_id AS conversationId, type, payload_json, created_at AS createdAt FROM conversation_events WHERE type = 'routing.result' ORDER BY created_at DESC, rowid DESC LIMIT ?",
      )
      .all(limit)
      .map((row) => ({
        id: row.id,
        conversationId: row.conversationId,
        type: row.type,
        payload: JSON.parse(row.payload_json),
        createdAt: row.createdAt,
      }));
  }
  conversation(id) {
    const c = this.db
      .prepare("SELECT * FROM conversations WHERE id = ?")
      .get(id);
    if (!c) throw new Error(`Conversation introuvable: ${id}`);
    return {
      id: c.id,
      projectId: c.project_id,
      title: c.title,
      status: c.status,
      modelId: c.model_id,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
      messages: this.db
        .prepare(
          "SELECT id, role, content, status, created_at AS createdAt FROM messages WHERE conversation_id = ? ORDER BY rowid",
        )
        .all(id),
    };
  }
  conversations(projectId) {
    return this.db
      .prepare(
        "SELECT id, project_id AS projectId, title, status, model_id AS modelId, created_at AS createdAt, updated_at AS updatedAt FROM conversations WHERE project_id = ? ORDER BY created_at",
      )
      .all(projectId);
  }
  addMessage(conversationId, role, content, status = "completed") {
    if (!["user", "assistant"].includes(role) || typeof content !== "string")
      throw new Error("Rôle ou contenu de message Omni invalide");
    if (!["streaming", "completed", "interrupted", "failed"].includes(status))
      throw new Error(`Statut de message Omni invalide: ${status}`);
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const safeContent = redactSecrets(content);
    this.db.transaction(() => {
      this.db
        .prepare("INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, conversationId, role, safeContent, status, createdAt);
      this.appendEvent(conversationId, "message.created", {
        messageId: id,
        role,
        content: safeContent,
        status,
      });
      this.db
        .prepare("UPDATE conversations SET updated_at = ? WHERE id = ?")
        .run(createdAt, conversationId);
    })();
    return id;
  }
  appendMessageDelta(id, delta) {
    if (typeof delta !== "string")
      throw new Error("Un fragment streamé doit être une chaîne");
    const safeDelta = redactSecrets(delta);
    return this.db.transaction(() => {
      const message = this.db
        .prepare("SELECT conversation_id, content FROM messages WHERE id = ?")
        .get(id);
      if (!message) throw new Error(`Message introuvable: ${id}`);
      this.db
        .prepare(
          "UPDATE messages SET content = content || ?, status = 'streaming' WHERE id = ?",
        )
        .run(safeDelta, id);
      this.appendEvent(message.conversation_id, "message.delta", {
        messageId: id,
        delta: safeDelta,
      });
      return this.db
        .prepare("SELECT content FROM messages WHERE id = ?")
        .get(id).content;
    })();
  }
  setMessage(id, content, status) {
    if (typeof content !== "string")
      throw new Error("Le contenu d’un message Omni doit être une chaîne");
    if (!["streaming", "completed", "interrupted", "failed"].includes(status))
      throw new Error(`Statut de message Omni invalide: ${status}`);
    const safeContent = redactSecrets(content);
    this.db.transaction(() => {
      const message = this.db
        .prepare("SELECT conversation_id FROM messages WHERE id = ?")
        .get(id);
      if (!message) throw new Error(`Message introuvable: ${id}`);
      this.db
        .prepare("UPDATE messages SET content = ?, status = ? WHERE id = ?")
        .run(safeContent, status, id);
      if (message.content !== safeContent)
        this.appendEvent(message.conversation_id, "message.revised", {
          messageId: id,
          content: safeContent,
        });
      if (["completed", "interrupted", "failed"].includes(status))
        this.appendEvent(message.conversation_id, `message.${status}`, {
          messageId: id,
        });
    })();
  }
  setModel(id, modelId) {
    this.db.transaction(() => {
      const previousModel = this.conversation(id).modelId;
      this.db
        .prepare(
          "UPDATE conversations SET model_id = ?, updated_at = ? WHERE id = ?",
        )
        .run(modelId, new Date().toISOString(), id);
      if (previousModel !== modelId)
        this.appendEvent(id, "model.changed", {
          from: previousModel,
          to: modelId,
        });
    })();
    return this.conversation(id);
  }
  recoverConversation(id) {
    const transaction = this.db.transaction(() => {
      const streaming = this.db
        .prepare(
          "SELECT id FROM messages WHERE conversation_id = ? AND status = 'streaming'",
        )
        .all(id);
      const wasRunning = this.db
        .prepare(
          "SELECT 1 AS running FROM conversations WHERE id = ? AND status = 'running'",
        )
        .get(id);
      this.db
        .prepare(
          "UPDATE messages SET status = 'interrupted' WHERE conversation_id = ? AND status = 'streaming'",
        )
        .run(id);
      for (const message of streaming)
        this.appendEvent(id, "message.interrupted", {
          messageId: message.id,
          recoveredAfterRestart: true,
        });
      this.db
        .prepare(
          "UPDATE conversations SET status = 'interrupted', updated_at = ? WHERE id = ? AND status = 'running'",
        )
        .run(new Date().toISOString(), id);
      if (streaming.length || wasRunning)
        this.appendEvent(id, "session.interrupted", {
          recoveredAfterRestart: true,
        });
    });
    transaction();
    return this.conversation(id);
  }
  setStatus(id, status) {
    this.db.transaction(() => {
      this.db
        .prepare(
          "UPDATE conversations SET status = ?, updated_at = ? WHERE id = ?",
        )
        .run(status, new Date().toISOString(), id);
      const eventType = {
        running: "session.started",
        completed: "session.completed",
        interrupted: "session.interrupted",
        failed: "session.failed",
      }[status];
      if (eventType) this.appendEvent(id, eventType);
    })();
  }
  exportConversation(id) {
    return { conversation: this.conversation(id), events: this.listEvents(id) };
  }
  importConversation(document, { projectId } = {}) {
    const source = document?.conversation;
    const events = document?.events;
    if (
      !source?.id ||
      typeof source.title !== "string" ||
      !Array.isArray(events) ||
      !Array.isArray(source.messages) ||
      (source.createdAt && !Number.isFinite(Date.parse(source.createdAt)))
    )
      throw new Error(
        "Export Omni invalide: conversation et events sont requis",
      );
    const targetProject = projectId ?? source.projectId;
    this.project(targetProject);
    const messageIdMap = new Map();
    const messages = new Map();
    for (const event of events) {
      if (
        event.conversationId !== source.id ||
        typeof event.createdAt !== "string" ||
        !Number.isFinite(Date.parse(event.createdAt))
      )
        throw new Error(
          "Export Omni invalide: conversation ou date d’événement invalide",
        );
      if (!EVENT_TYPES.includes(event.type))
        throw new Error(`Type d’événement Omni inconnu: ${event.type}`);
      const payload = event.payload ?? {};
      if (typeof payload !== "object" || Array.isArray(payload))
        throw new Error("Export Omni invalide: payload d’événement invalide");
      if (event.type === "message.created") {
        if (
          typeof payload.messageId !== "string" ||
          messageIdMap.has(payload.messageId) ||
          !["user", "assistant"].includes(payload.role) ||
          typeof payload.content !== "string"
        )
          throw new Error(
            "Export Omni invalide: identifiant de message manquant ou dupliqué",
          );
        const id = randomUUID();
        messageIdMap.set(payload.messageId, id);
        const messageStatus =
          payload.status ??
          (payload.role === "assistant" ? "streaming" : "completed");
        if (
          !["streaming", "completed", "interrupted", "failed"].includes(
            messageStatus,
          )
        )
          throw new Error("Export Omni invalide: statut de message inconnu");
        messages.set(payload.messageId, {
          id,
          role: payload.role,
          content: redactSecrets(payload.content ?? ""),
          status: messageStatus,
          createdAt: event.createdAt ?? new Date().toISOString(),
        });
      } else if (event.type === "message.delta") {
        const message = messages.get(payload.messageId);
        if (
          !message ||
          message.role !== "assistant" ||
          typeof payload.delta !== "string"
        )
          throw new Error(
            "Export Omni invalide: fragment sans message assistant",
          );
        message.content += redactSecrets(payload.delta ?? "");
      } else if (event.type === "message.revised") {
        const message = messages.get(payload.messageId);
        if (!message || typeof payload.content !== "string")
          throw new Error("Export Omni invalide: révision sans contenu valide");
        message.content = redactSecrets(payload.content);
      } else if (
        ["message.completed", "message.interrupted", "message.failed"].includes(
          event.type,
        )
      ) {
        const message = messages.get(payload.messageId);
        if (!message)
          throw new Error("Export Omni invalide: statut sans message");
        message.status = event.type.slice("message.".length);
      }
    }
    if (messages.size !== source.messages.length)
      throw new Error(
        "Export Omni invalide: projection des messages incohérente",
      );
    const snapshot = [...messages.values()];
    for (let index = 0; index < snapshot.length; index += 1) {
      const rebuilt = snapshot[index];
      const stored = source.messages[index];
      const normalizedStatus =
        rebuilt.status === "streaming" ? "interrupted" : rebuilt.status;
      if (
        stored.role !== rebuilt.role ||
        redactSecrets(stored.content) !== rebuilt.content ||
        (stored.status === "streaming" ? "interrupted" : stored.status) !==
          normalizedStatus
      )
        throw new Error(
          "Export Omni invalide: projection des messages incohérente",
        );
    }
    const id = randomUUID();
    const createdAt = source.createdAt ?? new Date().toISOString();
    const importedStreamingIds = [];
    this.db.transaction(() => {
      this.db
        .prepare("INSERT INTO conversations VALUES (?, ?, ?, 'idle', ?, ?, ?)")
        .run(
          id,
          targetProject,
          source.title,
          source.modelId ?? null,
          createdAt,
          new Date().toISOString(),
        );
      for (const message of messages.values()) {
        const status =
          message.status === "streaming" ? "interrupted" : message.status;
        this.db
          .prepare("INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?)")
          .run(
            message.id,
            id,
            message.role,
            message.content,
            status,
            message.createdAt,
          );
        if (message.status === "streaming")
          importedStreamingIds.push(message.id);
      }
      for (const event of events) {
        const payload = { ...(event.payload ?? {}) };
        if (payload.messageId && messageIdMap.has(payload.messageId))
          payload.messageId = messageIdMap.get(payload.messageId);
        this.appendEvent(id, event.type, payload);
      }
      for (const messageId of importedStreamingIds)
        this.appendEvent(id, "message.interrupted", {
          messageId,
          recoveredAfterImport: true,
        });
      this.appendEvent(id, "conversation.imported", {
        sourceConversationId: source.id,
      });
    })();
    return this.conversation(id);
  }
  count() {
    return {
      projects: this.db.prepare("SELECT count(*) n FROM projects").get().n,
      conversations: this.db
        .prepare("SELECT count(*) n FROM conversations")
        .get().n,
      messages: this.db.prepare("SELECT count(*) n FROM messages").get().n,
      events: this.db
        .prepare("SELECT count(*) n FROM conversation_events")
        .get().n,
    };
  }
  close() {
    this.db.close();
  }
}
