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
    if (version < 2)
      this.db.transaction(() => {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS providers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
            auth_status TEXT NOT NULL DEFAULT 'unknown' CHECK (auth_status IN ('connected', 'disconnected', 'unavailable', 'unknown')),
            catalog_checked_at TEXT
          );
          CREATE TABLE IF NOT EXISTS models (
            provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
            id TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
            enabled_for_auto INTEGER NOT NULL DEFAULT 1 CHECK (enabled_for_auto IN (0, 1)),
            available INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0, 1)),
            PRIMARY KEY (provider_id, id)
          );
          CREATE INDEX IF NOT EXISTS models_available ON models(provider_id, available, enabled);
        `);
        this.db
          .prepare(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (2, ?)",
          )
          .run(new Date().toISOString());
      })();
    if (version < 3)
      this.db.transaction(() => {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS harnesses (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            provider_id TEXT NOT NULL,
            integration TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('connected', 'disconnected', 'unavailable', 'unknown')),
            enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
            available INTEGER NOT NULL DEFAULT 0 CHECK (available IN (0, 1)),
            capabilities_json TEXT NOT NULL,
            checked_at TEXT
          );
        `);
        this.db
          .prepare(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (3, ?)",
          )
          .run(new Date().toISOString());
      })();
    if (version < 4)
      this.db.transaction(() => {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS mcp_servers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            command TEXT NOT NULL,
            args_json TEXT NOT NULL,
            cwd TEXT,
            env_keys_json TEXT NOT NULL,
            tools_json TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
        `);
        this.db
          .prepare(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (4, ?)",
          )
          .run(new Date().toISOString());
      })();
    if (version < 5)
      this.db.transaction(() => {
        this.db.exec(`
          ALTER TABLE mcp_servers RENAME TO mcp_servers_v4;
          CREATE TABLE mcp_servers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            transport TEXT NOT NULL DEFAULT 'stdio' CHECK (transport IN ('stdio', 'http')),
            command TEXT,
            args_json TEXT NOT NULL DEFAULT '[]',
            cwd TEXT,
            url TEXT,
            env_keys_json TEXT NOT NULL DEFAULT '[]',
            header_env_json TEXT NOT NULL DEFAULT '{}',
            tools_json TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            CHECK ((transport = 'stdio' AND command IS NOT NULL AND url IS NULL) OR (transport = 'http' AND command IS NULL AND url IS NOT NULL))
          );
          INSERT INTO mcp_servers (id, name, transport, command, args_json, cwd, env_keys_json, tools_json, created_at, updated_at)
            SELECT id, name, 'stdio', command, args_json, cwd, env_keys_json, tools_json, created_at, updated_at FROM mcp_servers_v4;
          DROP TABLE mcp_servers_v4;
        `);
        this.db
          .prepare(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (5, ?)",
          )
          .run(new Date().toISOString());
      })();
    if (version < 6)
      this.db.transaction(() => {
        this.db.exec(
          `CREATE TABLE IF NOT EXISTS archived_projects (project_id TEXT PRIMARY KEY REFERENCES projects(id), archived_at TEXT NOT NULL)`,
        );
        this.db
          .prepare(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (6, ?)",
          )
          .run(new Date().toISOString());
      })();
    if (version < 7)
      this.db.transaction(() => {
        this.db.exec(
          `CREATE TABLE IF NOT EXISTS archived_conversations (conversation_id TEXT PRIMARY KEY REFERENCES conversations(id), archived_at TEXT NOT NULL)`,
        );
        this.db
          .prepare(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (7, ?)",
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
  saveProviderCatalog({ providerId, name = providerId, authStatus, models }) {
    if (!providerId || !Array.isArray(models))
      throw new TypeError(
        "providerId et models sont requis pour enregistrer un catalogue",
      );
    if (
      !["connected", "disconnected", "unavailable", "unknown"].includes(
        authStatus,
      )
    )
      throw new TypeError(`Statut provider invalide: ${authStatus}`);
    const timestamp = new Date().toISOString();
    const save = this.db.transaction(() => {
      this.db
        .prepare(
          `
        INSERT INTO providers (id, name, auth_status, catalog_checked_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, auth_status = excluded.auth_status, catalog_checked_at = excluded.catalog_checked_at
      `,
        )
        .run(providerId, name, authStatus, timestamp);
      this.db
        .prepare("UPDATE models SET available = 0 WHERE provider_id = ?")
        .run(providerId);
      const upsert = this.db.prepare(`
        INSERT INTO models (provider_id, id, available) VALUES (?, ?, 1)
        ON CONFLICT(provider_id, id) DO UPDATE SET available = 1
      `);
      for (const modelId of new Set(models)) {
        if (typeof modelId !== "string" || !modelId.trim())
          throw new TypeError("Identifiant de modèle invalide");
        upsert.run(providerId, modelId);
      }
    });
    save();
    return this.providerRegistry();
  }
  saveMcpServer({
    name,
    transport = "stdio",
    command = null,
    args = [],
    cwd = null,
    url = null,
    envKeys = [],
    headerEnv = {},
  }) {
    const now = new Date().toISOString();
    const current = this.db
      .prepare("SELECT id FROM mcp_servers WHERE name = ?")
      .get(name);
    const id = current?.id ?? randomUUID();
    this.db
      .prepare(
        `INSERT INTO mcp_servers
         (id, name, transport, command, args_json, cwd, url, env_keys_json, header_env_json, tools_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)
         ON CONFLICT(name) DO UPDATE SET transport = excluded.transport, command = excluded.command,
         args_json = excluded.args_json, cwd = excluded.cwd,
         url = excluded.url, env_keys_json = excluded.env_keys_json, header_env_json = excluded.header_env_json, tools_json = '[]', updated_at = excluded.updated_at`,
      )
      .run(
        id,
        name,
        transport,
        command,
        JSON.stringify(args),
        cwd,
        url,
        JSON.stringify(envKeys),
        JSON.stringify(headerEnv),
        now,
        now,
      );
    return this.mcpServer(name);
  }
  mcpServer(name) {
    const row = this.db
      .prepare(
        `SELECT id, name, transport, command, args_json AS args, cwd, url,
                env_keys_json AS envKeys, header_env_json AS headerEnv, tools_json AS tools,
                created_at AS createdAt, updated_at AS updatedAt
         FROM mcp_servers WHERE name = ?`,
      )
      .get(name);
    return row
      ? {
          ...row,
          args: JSON.parse(row.args),
          envKeys: JSON.parse(row.envKeys),
          headerEnv: JSON.parse(row.headerEnv),
          tools: JSON.parse(row.tools),
        }
      : null;
  }
  mcpServers() {
    return this.db
      .prepare("SELECT name FROM mcp_servers ORDER BY name")
      .all()
      .map(({ name }) => this.mcpServer(name));
  }
  saveMcpTools(name, tools) {
    const result = this.db
      .prepare(
        "UPDATE mcp_servers SET tools_json = ?, updated_at = ? WHERE name = ?",
      )
      .run(JSON.stringify(tools), new Date().toISOString(), name);
    if (!result.changes) throw new Error(`Serveur MCP inconnu: ${name}`);
    return this.mcpServer(name);
  }
  removeMcpServer(name) {
    return Boolean(
      this.db.prepare("DELETE FROM mcp_servers WHERE name = ?").run(name)
        .changes,
    );
  }
  providerRegistry() {
    return this.db
      .prepare(
        `
      SELECT p.id, p.name, p.enabled, p.auth_status AS authStatus,
        p.catalog_checked_at AS catalogCheckedAt,
        (SELECT count(*) FROM models m WHERE m.provider_id = p.id AND m.available = 1) AS modelCount
      FROM providers p ORDER BY p.id
    `,
      )
      .all()
      .map((row) => ({ ...row, enabled: Boolean(row.enabled) }));
  }
  modelRegistry(providerId = null, { availableOnly = false } = {}) {
    const clauses = [];
    const params = [];
    if (providerId) {
      clauses.push("m.provider_id = ?");
      params.push(providerId);
    }
    if (availableOnly) clauses.push("m.available = 1");
    return this.db
      .prepare(
        `
      SELECT m.provider_id AS providerId, m.id, m.enabled, m.enabled_for_auto AS enabledForAuto,
        m.available, p.auth_status AS authStatus
      FROM models m JOIN providers p ON p.id = m.provider_id
      ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
      ORDER BY m.provider_id, m.id
    `,
      )
      .all(...params)
      .map((row) => ({
        ...row,
        enabled: Boolean(row.enabled),
        enabledForAuto: Boolean(row.enabledForAuto),
        available: Boolean(row.available),
      }));
  }
  setProviderEnabled(providerId, enabled) {
    const result = this.db
      .prepare("UPDATE providers SET enabled = ? WHERE id = ?")
      .run(Number(Boolean(enabled)), providerId);
    if (!result.changes) throw new Error(`Fournisseur inconnu: ${providerId}`);
    return this.providerRegistry().find(
      (provider) => provider.id === providerId,
    );
  }
  setModelEnabled(providerId, modelId, enabled, { autoOnly = false } = {}) {
    const field = autoOnly ? "enabled_for_auto" : "enabled";
    const result = this.db
      .prepare(
        `UPDATE models SET ${field} = ? WHERE provider_id = ? AND id = ?`,
      )
      .run(Number(Boolean(enabled)), providerId, modelId);
    if (!result.changes)
      throw new Error(`Modèle inconnu: ${providerId}/${modelId}`);
    return this.modelRegistry(providerId).find((model) => model.id === modelId);
  }
  saveHarnessRegistry({
    id,
    name,
    providerId,
    integration,
    status,
    available,
    capabilities,
  }) {
    if (!id || !name || !providerId || !integration || !capabilities)
      throw new TypeError("Les métadonnées du harness sont incomplètes");
    if (
      !["connected", "disconnected", "unavailable", "unknown"].includes(status)
    )
      throw new TypeError(`Statut harness invalide: ${status}`);
    this.db
      .prepare(
        `
      INSERT INTO harnesses (id, name, provider_id, integration, status, available, capabilities_json, checked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, provider_id = excluded.provider_id,
        integration = excluded.integration, status = excluded.status, available = excluded.available,
        capabilities_json = excluded.capabilities_json, checked_at = excluded.checked_at
    `,
      )
      .run(
        id,
        name,
        providerId,
        integration,
        status,
        Number(Boolean(available)),
        JSON.stringify(capabilities),
        new Date().toISOString(),
      );
    return this.harnessRegistry().find((harness) => harness.id === id);
  }
  harnessRegistry() {
    return this.db
      .prepare(
        `
      SELECT id, name, provider_id AS providerId, integration, status, enabled, available,
        capabilities_json AS capabilitiesJson, checked_at AS checkedAt
      FROM harnesses ORDER BY id
    `,
      )
      .all()
      .map((row) => ({
        ...row,
        enabled: Boolean(row.enabled),
        available: Boolean(row.available),
        capabilities: JSON.parse(row.capabilitiesJson),
        capabilitiesJson: undefined,
      }));
  }
  setHarnessEnabled(harnessId, enabled) {
    const result = this.db
      .prepare("UPDATE harnesses SET enabled = ? WHERE id = ?")
      .run(Number(Boolean(enabled)), harnessId);
    if (!result.changes) throw new Error(`Harness inconnu: ${harnessId}`);
    return this.harnessRegistry().find((harness) => harness.id === harnessId);
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
      .prepare(
        "SELECT * FROM projects WHERE id NOT IN (SELECT project_id FROM archived_projects) ORDER BY created_at",
      )
      .all()
      .map((r) => ({
        id: r.id,
        name: r.name,
        rootPath: r.root_path,
        createdAt: r.created_at,
      }));
  }
  archivedProjects() {
    return this.db
      .prepare(
        "SELECT p.id, p.name, p.root_path AS rootPath, p.created_at AS createdAt, a.archived_at AS archivedAt FROM projects p JOIN archived_projects a ON a.project_id = p.id ORDER BY a.archived_at DESC",
      )
      .all();
  }
  updateProject(id, { name, rootPath }) {
    const project = this.project(id);
    if (project.id !== id) throw new Error("Identifiant de projet invalide.");
    if (typeof name !== "string" || !name.trim() || name.trim().length > 120)
      throw new Error("Le nom doit contenir entre 1 et 120 caractères.");
    const running = this.db
      .prepare(
        "SELECT 1 FROM conversations WHERE project_id = ? AND status = 'running' LIMIT 1",
      )
      .get(id);
    if (rootPath !== project.rootPath && running)
      throw new Error(
        "Arrêtez les agents actifs avant de modifier le dossier.",
      );
    const duplicate = this.db
      .prepare("SELECT id FROM projects WHERE root_path = ? AND id <> ?")
      .get(rootPath, id);
    if (duplicate)
      throw new Error(
        "Ce dossier est déjà associé à un autre projet, y compris archivé.",
      );
    this.db
      .prepare("UPDATE projects SET name = ?, root_path = ? WHERE id = ?")
      .run(name.trim(), rootPath, id);
    return this.project(id);
  }
  archiveProject(id) {
    const project = this.project(id);
    if (project.id !== id) throw new Error("Identifiant de projet invalide.");
    if (
      this.db
        .prepare(
          "SELECT 1 FROM conversations WHERE project_id = ? AND status = 'running' LIMIT 1",
        )
        .get(id)
    )
      throw new Error("Arrêtez les agents actifs avant d’archiver le projet.");
    this.db
      .prepare("INSERT OR IGNORE INTO archived_projects VALUES (?, ?)")
      .run(id, new Date().toISOString());
    return project;
  }
  restoreProject(id) {
    const project = this.project(id);
    if (project.id !== id) throw new Error("Identifiant de projet invalide.");
    this.db
      .prepare("DELETE FROM archived_projects WHERE project_id = ?")
      .run(id);
    return project;
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
  executionEvents(
    kind,
    { conversationId = null, projectId = null, from = null, until = null } = {},
  ) {
    const eventTypes = {
      tools: ["tool.started", "tool.completed", "tool.failed"],
      permissions: [
        "permission.requested",
        "permission.granted",
        "permission.denied",
      ],
      usage: ["usage.updated"],
      routing: ["routing.result"],
    }[kind];
    if (!eventTypes) throw new Error(`Historique inconnu: ${kind}`);
    if (!conversationId && !projectId)
      throw new Error("Un filtre --conversation ou --project est requis");
    for (const boundary of [from, until])
      if (boundary !== null && !Number.isFinite(Date.parse(boundary)))
        throw new TypeError("Borne temporelle invalide");
    if (from && until && from >= until)
      throw new RangeError("La période de l’historique est vide ou inversée");
    if (conversationId) {
      const conversation = this.conversation(conversationId);
      if (projectId && this.project(projectId).id !== conversation.projectId)
        throw new Error("La conversation n’appartient pas au projet indiqué");
    }
    const clauses = [`type IN (${eventTypes.map(() => "?").join(", ")})`];
    const parameters = [...eventTypes];
    if (conversationId) {
      clauses.push("conversation_id = ?");
      parameters.push(conversationId);
    } else if (projectId) {
      clauses.push(
        "conversation_id IN (SELECT id FROM conversations WHERE project_id = ?)",
      );
      parameters.push(this.project(projectId).id);
    }
    if (from) {
      clauses.push("created_at >= ?");
      parameters.push(from);
    }
    if (until) {
      clauses.push("created_at < ?");
      parameters.push(until);
    }
    return this.db
      .prepare(
        `
        SELECT id, conversation_id AS conversationId, type, payload_json, created_at AS createdAt
        FROM conversation_events WHERE ${clauses.join(" AND ")} ORDER BY created_at, rowid
      `,
      )
      .all(...parameters)
      .map((row) => ({
        id: row.id,
        conversationId: row.conversationId,
        type: row.type,
        payload: JSON.parse(row.payload_json),
        createdAt: row.createdAt,
      }));
  }
  searchConversations(query, projectId = null) {
    if (typeof query !== "string" || !query.trim() || query.length > 500)
      throw new TypeError("La recherche exige un texte de 1 à 500 caractères");
    const project = projectId ? this.project(projectId) : null;
    const normalizedQuery = query.trim();
    const rows = this.db
      .prepare(
        `
        SELECT c.id, c.project_id AS projectId, c.title, c.status, c.model_id AS modelId,
          c.created_at AS createdAt, c.updated_at AS updatedAt,
          instr(lower(c.title), lower(?)) > 0 AS titleMatch,
          (SELECT m.content FROM messages m
           WHERE m.conversation_id = c.id AND instr(lower(m.content), lower(?)) > 0
           ORDER BY m.rowid LIMIT 1) AS matchingContent
        FROM conversations c
        WHERE (instr(lower(c.title), lower(?)) > 0 OR EXISTS (
          SELECT 1 FROM messages m
          WHERE m.conversation_id = c.id AND instr(lower(m.content), lower(?)) > 0
        ))
        AND NOT EXISTS (SELECT 1 FROM archived_conversations a WHERE a.conversation_id = c.id)
        ${project ? "AND c.project_id = ?" : ""}
        ORDER BY c.updated_at DESC, c.id
      `,
      )
      .all(
        normalizedQuery,
        normalizedQuery,
        normalizedQuery,
        normalizedQuery,
        ...(project ? [project.id] : []),
      );
    return rows.map((row) => {
      const text = row.titleMatch ? row.title : row.matchingContent;
      const matchIndex = text
        .toLowerCase()
        .indexOf(normalizedQuery.toLowerCase());
      const start = Math.max(0, matchIndex - 70);
      const end = Math.min(
        text.length,
        matchIndex + normalizedQuery.length + 110,
      );
      return {
        id: row.id,
        projectId: row.projectId,
        title: row.title,
        status: row.status,
        modelId: row.modelId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        match: row.titleMatch ? "title" : "message",
        excerpt: `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`,
      };
    });
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
      archived: Boolean(
        this.db
          .prepare(
            "SELECT 1 FROM archived_conversations WHERE conversation_id = ?",
          )
          .get(id),
      ),
      messages: this.db
        .prepare(
          "SELECT id, role, content, status, created_at AS createdAt FROM messages WHERE conversation_id = ? ORDER BY rowid",
        )
        .all(id),
    };
  }
  conversations(projectId, { archived = false } = {}) {
    return this.db
      .prepare(
        `SELECT id, project_id AS projectId, title, status, model_id AS modelId, created_at AS createdAt, updated_at AS updatedAt FROM conversations WHERE project_id = ? AND ${archived ? "EXISTS" : "NOT EXISTS"} (SELECT 1 FROM archived_conversations a WHERE a.conversation_id = conversations.id) ORDER BY updated_at`,
      )
      .all(projectId);
  }
  renameConversation(id, title) {
    this.conversation(id);
    if (typeof title !== "string" || !title.trim() || title.trim().length > 120)
      throw new Error("Le titre doit contenir entre 1 et 120 caractères.");
    this.db
      .prepare(
        "UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?",
      )
      .run(title.trim(), new Date().toISOString(), id);
    this.appendEvent(id, "conversation.renamed", { title: title.trim() });
    return this.conversation(id);
  }
  archiveConversation(id) {
    const conversation = this.conversation(id);
    if (conversation.status === "running")
      throw new Error("Arrêtez l’agent avant d’archiver la conversation.");
    this.db
      .prepare("INSERT OR IGNORE INTO archived_conversations VALUES (?, ?)")
      .run(id, new Date().toISOString());
    return this.conversation(id);
  }
  restoreConversation(id) {
    this.conversation(id);
    this.db
      .prepare("DELETE FROM archived_conversations WHERE conversation_id = ?")
      .run(id);
    return this.conversation(id);
  }
  deleteConversation(id) {
    const conversation = this.conversation(id);
    if (conversation.status === "running")
      throw new Error("Arrêtez l’agent avant de supprimer la conversation.");
    // The event log stays append-only except for an explicitly requested whole-conversation deletion.
    this.db.transaction(() => {
      this.db.exec("DROP TRIGGER conversation_events_no_delete");
      this.db
        .prepare("DELETE FROM conversation_events WHERE conversation_id = ?")
        .run(id);
      this.db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(id);
      this.db
        .prepare("DELETE FROM archived_conversations WHERE conversation_id = ?")
        .run(id);
      this.db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
      this.db.exec(
        "CREATE TRIGGER conversation_events_no_delete BEFORE DELETE ON conversation_events BEGIN SELECT RAISE(ABORT, 'conversation events are append-only'); END",
      );
    })();
    return { id, deleted: true };
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
