import { createServer } from "node:http";
import { readFile, stat, readdir, open, writeFile } from "node:fs/promises";
import { accessSync, constants } from "node:fs";
import { createHash } from "node:crypto";
import { join, extname, relative, resolve, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, exec as execShell, spawn } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import {
  AgentWorkspace,
  harnessChoices,
  normalizeHarness,
} from "./agent-workspace.mjs";
import {
  projectRoot,
  readProjectContext,
  containedFile,
  ensureProject,
  isEphemeralPath,
} from "./project-context.mjs";
import { redactSecrets } from "./core.mjs";
import { atlasPages, atlasStatus, generateAtlas, readAtlasPage } from "./atlas-service.mjs";
import { PREVIEW_HEADERS, isPreviewablePath } from "./artifact-preview.mjs";
import { createEntry, deleteEntry, renameEntry } from "./file-operations.mjs";
import { collectUsageSnapshot } from "./usage.mjs";
import { collectAccounts } from "./account-detection.mjs";
import { CodexChat } from "./codex-chat.mjs";
import { ClaudeCodeChat } from "./claude-code.mjs";
import { AntigravityCliChat } from "./antigravity-cli.mjs";
import { OpenCodeHarness } from "./opencode-harness.mjs";
import { OAuthProfiles } from "./oauth-profiles.mjs";
import { McpRegistry } from "./mcp-registry.mjs";
import { ApiKeyProfiles } from "./api-key-profiles.mjs";
import { AwakeController } from "./awake-controller.mjs";
import {
  deriveGeneratedTabTitle,
  isDefaultConversationTitle,
} from "./agent-tab-title.mjs";

const exec = promisify(execFile);
const shellExec = promisify(execShell);
const root = fileURLToPath(new URL("../", import.meta.url));
const hidden = (name) =>
  /^(?:\.git|node_modules|dist|\.env(?:\..*)?|credentials.*|secrets?.*|\.ssh|\.aws|\.codex|\.omni)$/i.test(
    name,
  ) || /\.(?:pem|key|p12|sqlite\d?|db)$/i.test(name);
const validGitPath = (path) =>
  typeof path === "string" &&
  path.length > 0 &&
  !isAbsolute(path) &&
  !path.includes("\0") &&
  !path
    .split(/[\\/]/)
    .some((part) => hidden(part) || part === ".." || part === "");
function parseGitStatus(output) {
  const records = output.split("\0"),
    changes = [];
  for (let i = 0; i < records.length; i++) {
    const row = records[i];
    if (!row) continue;
    const code = row.slice(0, 2),
      path = row.slice(3);
    const oldPath =
      code.includes("R") || code.includes("C") ? records[++i] : undefined;
    changes.push({ code, path, ...(oldPath ? { oldPath } : {}) });
  }
  return changes;
}
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};
const revision = (value) => createHash("sha256").update(value).digest("hex");
function executableInstalled(name) {
  const candidates = name.includes(sep) ? [name] : (process.env.PATH ?? "").split(process.platform === "win32" ? ";" : ":").filter(Boolean).map((directory) => join(directory, name));
  return candidates.some((candidate) => { try { accessSync(candidate, constants.X_OK); return true; } catch { return false; } });
}
const keyProviders = {
  openai: ["Omni OpenAI API Key", "OpenAI"],
  openrouter: ["Omni OpenRouter API Key", "OpenRouter"],
  anthropic: ["Omni Anthropic API Key", "Anthropic"],
  google: ["Omni Gemini API Key", "Google"],
};
async function gitWorktrees(cwd) {
  const { stdout } = await exec(
    "git",
    ["worktree", "list", "--porcelain", "-z"],
    {
      cwd,
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    },
  );
  return stdout
    .split("\0\0")
    .filter(Boolean)
    .map((record, index) => {
      const fields = record.split("\0");
      const path = fields
        .find((line) => line.startsWith("worktree "))
        ?.slice(9);
      const branch = fields
        .find((line) => line.startsWith("branch refs/heads/"))
        ?.slice(18);
      return {
        path,
        branch: branch || "HEAD détachée",
        mainWorktree: index === 0,
        locked: fields.some(
          (line) => line === "locked" || line.startsWith("locked "),
        ),
        prunable: fields.some(
          (line) => line === "prunable" || line.startsWith("prunable "),
        ),
      };
    })
    .filter((entry) => entry.path);
}
async function jsonBody(request, limit = 256000) {
  let data = "";
  for await (const chunk of request) {
    data += chunk;
    if (Buffer.byteLength(data) > limit)
      throw new Error("Requête trop volumineuse.");
  }
  const body = JSON.parse(data || "{}");
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new Error("Objet JSON requis.");
  return body;
}
function send(response, status, data) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(data));
}
export async function startWorkspaceServer({
  store,
  dataDir,
  cwd = process.cwd(),
  port = 4318,
  workspace = new AgentWorkspace({ store, dataDir }),
  webDir = join(root, "web/dist"),
} = {}) {
  const projectPath = await projectRoot(cwd);
  const initialProject = await ensureProject(store, projectPath);
  workspace.ensureDotcontext();
  const awake = new AwakeController({ dataDir });
  await awake.init();
  const clients = new Set();
  const savingFiles = new Set();
  let catalogRefresh = null;
  const broadcast = (event) => {
    for (const client of clients) {
      if (client.writableLength > 1024 * 1024) {
        client.destroy();
        clients.delete(client);
      } else client.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  };
  awake.onChange = (status) =>
    broadcast({ type: "awake.status", payload: status });
  const onWorkspaceEvent = (event) => {
    awake.setActiveRuns(workspace.active.size);
    broadcast(event);
    broadcast({ type: "awake.status", payload: awake.status() });
  };
  workspace.on("event", onWorkspaceEvent);
  const server = createServer(async (request, response) => {
    try {
      const hostname = request.headers.host ?? "";
      const address = server.address();
      const allowedHosts = new Set([
        `127.0.0.1:${address.port}`,
        `localhost:${address.port}`,
      ]);
      if (!allowedHosts.has(hostname)) {
        send(response, 403, { error: "Host refusé." });
        return;
      }
      const origin = `http://${hostname}`;
      if (request.headers.origin && request.headers.origin !== origin) {
        send(response, 403, { error: "Origin refusée." });
        return;
      }
      if (
        !["GET", "HEAD"].includes(request.method) &&
        request.headers["x-omni-request"] !== "1"
      ) {
        send(response, 403, { error: "En-tête de requête Omni requis." });
        return;
      }
      const url = new URL(request.url, origin),
        path = url.pathname;
      if (path === "/api/events" && request.method === "GET") {
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "x-content-type-options": "nosniff",
        });
        response.write(
          `data: ${JSON.stringify({ type: "workspace.snapshot", payload: workspace.snapshot() })}\n\n`,
        );
        clients.add(response);
        const heartbeat = setInterval(
          () => response.write(": heartbeat\n\n"),
          20000,
        );
        request.on("close", () => {
          clearInterval(heartbeat);
          clients.delete(response);
        });
        return;
      }
      if (path === "/api/state" && request.method === "GET") {
        const projects = store
          .projects()
          .filter((project) => !isEphemeralPath(project.rootPath));
        send(response, 200, {
          version: "0.1.0",
          defaultProjectId: projects.some(
            (project) => project.id === initialProject.id,
          )
            ? initialProject.id
            : (projects[0]?.id ?? ""),
          projects,
          archivedProjects: store
            .archivedProjects()
            .filter((project) => !isEphemeralPath(project.rootPath)),
          harnesses: harnessChoices.map((h) => ({
            ...h,
            ...store.harnessRegistry().find((r) => r.id === h.id),
          })),
          installedAgents: { antigravity: executableInstalled(process.env.OMNI_ANTIGRAVITY_EXECUTABLE ?? "agy") },
          models: store
            .modelRegistry(null, { availableOnly: true })
            .filter((m) => m.enabled),
          providers: store.providerRegistry(),
          mcpServers: store
            .mcpServers()
            .map(({ name, transport, command, args, tools }) => ({
              name,
              transport,
              command,
              args,
              toolCount: tools.length,
            })),
          awake: awake.status(),
          ...workspace.snapshot(),
        });
        return;
      }
      if (path === "/api/models" && request.method === "GET") {
        // Full available-model registry (enabled and disabled), for the Agents
        // models pane. State only carries enabled models, so this exposes the
        // rest so they can be toggled.
        send(response, 200, {
          models: store.modelRegistry(null, { availableOnly: true }),
          providers: store.providerRegistry(),
        });
        return;
      }
      if (path === "/api/models/refresh" && request.method === "POST") {
        if (!catalogRefresh) {
          const profiles = new OAuthProfiles({ dataDir });
          const providers = [
            { id: "codex", name: "Codex OAuth", Chat: CodexChat },
            { id: "claude", name: "Claude Code OAuth", Chat: ClaudeCodeChat },
            { id: "antigravity", name: "Antigravity", Chat: AntigravityCliChat },
            { id: "opencode", name: "OpenCode", Chat: OpenCodeHarness },
          ];
          catalogRefresh = Promise.all(providers.map(async ({ id, name, Chat }) => {
            let chat;
            try {
              chat = new Chat({ store, dataDir, cwd: projectPath, env: id === "antigravity" || id === "opencode" ? process.env : profiles.environment(id), ...(id === "opencode" ? { executable: process.env.OMNI_OPENCODE_EXECUTABLE ?? "opencode" } : {}), ...(id === "antigravity" ? { executable: process.env.OMNI_ANTIGRAVITY_EXECUTABLE ?? "agy" } : {}) });
              const models = await chat.listModels();
              if (!models.length) throw new Error("Catalogue vide");
              store.saveProviderCatalog({ providerId: id, name, authStatus: "connected", models });
              return { providerId: id, modelCount: models.length };
            } catch (error) {
              return { providerId: id, error: redactSecrets(String(error.message)) };
            } finally {
              if (id === "opencode" && chat) await chat.dispose().catch(() => {});
            }
          })).finally(() => { catalogRefresh = null; });
        }
        const results = await catalogRefresh;
        broadcast({ type: "models.updated", payload: {} });
        send(response, 200, { results, models: store.modelRegistry(null, { availableOnly: true }), providers: store.providerRegistry() });
        return;
      }
      if (path === "/api/settings/awake" && request.method === "GET") {
        send(response, 200, awake.status());
        return;
      }
      if (path === "/api/settings/awake" && request.method === "POST") {
        const body = await jsonBody(request);
        const result = await awake.setMode(body.mode);
        send(response, 200, result);
        broadcast({ type: "awake.status", payload: result });
        return;
      }
      if (path === "/api/browser/proxy" && request.method === "GET") {
        const target = url.searchParams.get("url");
        if (!target) {
          send(response, 400, { error: "Paramètre url manquant." });
          return;
        }
        let targetUrl;
        try {
          targetUrl = new URL(target);
          if (!["http:", "https:"].includes(targetUrl.protocol)) {
            throw new Error("Protocole non pris en charge.");
          }
        } catch (err) {
          send(response, 400, { error: `URL invalide: ${err.message}` });
          return;
        }
        try {
          const fetchResponse = await fetch(targetUrl.href, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Omni/1.0",
              Accept:
                "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
              "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
            },
            redirect: "follow",
            signal: AbortSignal.timeout(10000),
          });
          const contentType =
            fetchResponse.headers.get("content-type") || "text/html";
          if (contentType.includes("text/html")) {
            let html = await fetchResponse.text();
            const baseTag = `<base href="${targetUrl.href}">`;
            if (html.includes("<head>")) {
              html = html.replace("<head>", `<head>${baseTag}`);
            } else if (html.includes("<head ")) {
              html = html.replace(/<head[^>]*>/, `$&${baseTag}`);
            } else {
              html = `${baseTag}${html}`;
            }
            response.writeHead(fetchResponse.status, {
              "content-type": "text/html; charset=utf-8",
              "x-content-type-options": "nosniff",
              "access-control-allow-origin": "*",
            });
            response.end(html);
          } else {
            const buffer = Buffer.from(await fetchResponse.arrayBuffer());
            response.writeHead(fetchResponse.status, {
              "content-type": contentType,
              "access-control-allow-origin": "*",
            });
            response.end(buffer);
          }
        } catch (err) {
          send(response, 502, {
            error: `Échec du chargement proxy: ${err.message}`,
          });
        }
        return;
      }
      if (path === "/api/accounts" && request.method === "GET") {
        send(response, 200, collectAccounts());
        return;
      }
      if (path === "/api/accounts/login" && request.method === "POST") {
        // Launch the real OAuth login in the background; it opens the system
        // browser. The GUI re-detects once the user completes it. Only the
        // browser-based OAuth providers are allowed here.
        const body = await jsonBody(request);
        if (!["codex", "claude"].includes(body.provider))
          throw new Error("Fournisseur OAuth inconnu.");
        const cli = fileURLToPath(new URL("../bin/omni.mjs", import.meta.url));
        const child = spawn(
          process.execPath,
          [cli, "auth", "login", body.provider],
          { detached: true, stdio: "ignore" },
        );
        child.unref();
        send(response, 200, { started: true, provider: body.provider });
        return;
      }
      if (path === "/api/usage" && request.method === "GET") {
        send(response, 200, collectUsageSnapshot({ dataDir }));
        return;
      }
      if (path === "/api/usage/overview" && request.method === "GET") {
        const rows = store.db
          .prepare(
            "SELECT type, payload_json AS payload, created_at AS createdAt FROM conversation_events ORDER BY created_at",
          )
          .all()
          .map((row) => ({
            ...row,
            payload: JSON.parse(row.payload),
          }));
        const usage = rows.filter((row) => row.type === "usage.updated");
        const runs = rows.filter((row) => ["run.started", "run.finished"].includes(row.type));
        const tokens = usage.reduce(
          (result, row) => {
            const values = row.payload?.tokens ?? {};
            for (const key of ["input", "output", "reasoning"]) {
              result[key] += Number.isFinite(values[key]) ? values[key] : 0;
            }
            result.cacheRead += Number.isFinite(values.cache?.read) ? values.cache.read : 0;
            result.cacheWrite += Number.isFinite(values.cache?.write) ? values.cache.write : 0;
            result.cost += Number.isFinite(row.payload?.costUsd) ? row.payload.costUsd : 0;
            return result;
          },
          { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
        );
        const daily = new Map();
        for (const row of usage) {
          const day = row.createdAt.slice(0, 10);
          const values = row.payload?.tokens ?? {};
          const total = [values.input, values.output, values.reasoning, values.cache?.read, values.cache?.write]
            .filter(Number.isFinite)
            .reduce((sum, value) => sum + value, 0);
          daily.set(day, (daily.get(day) ?? 0) + total);
        }
        const runStarts = new Map();
        let workMs = 0;
        for (const row of runs) {
          const runId = row.payload?.runId;
          if (!runId) continue;
          if (row.type === "run.started") runStarts.set(runId, Date.parse(row.createdAt));
          else if (runStarts.has(runId)) {
            workMs += Math.max(0, Date.parse(row.createdAt) - runStarts.get(runId));
            runStarts.delete(runId);
          }
        }
        const totalTokens = tokens.input + tokens.output + tokens.reasoning + tokens.cacheRead + tokens.cacheWrite;
        const activeDays = daily.size;
        const lastUpdatedAt = rows.at(-1)?.createdAt ?? null;
        const providerTokens = {};
        for (const row of usage) {
          const provider = row.payload?.providerId || "unknown";
          const values = row.payload?.tokens ?? {};
          providerTokens[provider] = (providerTokens[provider] ?? 0) + [values.input, values.output, values.reasoning, values.cache?.read, values.cache?.write]
            .filter(Number.isFinite)
            .reduce((sum, value) => sum + value, 0);
        }
        send(response, 200, {
          agentsLaunched: runs.filter((row) => row.type === "run.started").length,
          workMs,
          prsCreated: rows.filter((row) => row.type === "pull_request.created").length,
          totalTokens,
          estimatedCostUsd: tokens.cost,
          activeDays,
          cacheShare: totalTokens ? (tokens.cacheRead + tokens.cacheWrite) / totalTokens : null,
          daily: [...daily.entries()].map(([date, value]) => ({ date, value })),
          providerTokens,
          lastUpdatedAt,
        });
        return;
      }
      if (path === "/api/skills" && request.method === "GET") {
        const projectId = url.searchParams.get("projectId");
        const project = projectId ? store.project(projectId) : null;
        const roots = [
          ...(project?.rootPath
            ? [
                {
                  path: join(project.rootPath, ".agents", "skills"),
                  source: "Projet · .agents",
                },
                {
                  path: join(project.rootPath, ".claude", "skills"),
                  source: "Projet · .claude",
                },
              ]
            : []),
          {
            path: join(homedir(), ".agents", "skills"),
            source: "Utilisateur · Agents",
          },
          {
            path: join(homedir(), ".codex", "skills"),
            source: "Utilisateur · Codex",
          },
          {
            path: join(homedir(), ".claude", "skills"),
            source: "Utilisateur · Claude",
          },
        ];
        const skills = [];
        for (const rootEntry of roots) {
          try {
            const entries = await readdir(rootEntry.path, {
              withFileTypes: true,
            });
            for (const entry of entries) {
              if (!entry.isDirectory() || hidden(entry.name)) continue;
              const skillFile = join(rootEntry.path, entry.name, "SKILL.md");
              try {
                const info = await stat(skillFile);
                if (!info.isFile() || info.size > 128000) continue;
                const content = redactSecrets(
                  await readFile(skillFile, "utf8"),
                );
                const description =
                  content
                    .match(/^description:\s*[>-]*\s*([^\n]+)/m)?.[1]
                    ?.trim() ?? "Skill installé";
                skills.push({
                  id: `${rootEntry.source}:${entry.name}`,
                  name: entry.name,
                  source: rootEntry.source,
                  description,
                  content,
                });
              } catch {}
            }
          } catch {}
        }
        send(response, 200, { skills });
        return;
      }
      if (path === "/api/artifacts" && request.method === "GET") {
        const projectId = url.searchParams.get("projectId");
        if (!projectId) throw new Error("Projet requis.");
        const project = store.project(projectId);
        const directories = [
          "artifacts",
          "outputs",
          "output",
          ".context/artifacts",
        ];
        const artifacts = [];
        async function collect(directory, depth = 0) {
          if (depth > 3 || artifacts.length >= 250) return;
          let entries;
          try {
            entries = await readdir(directory, { withFileTypes: true });
          } catch {
            return;
          }
          for (const entry of entries) {
            if (hidden(entry.name) || entry.isSymbolicLink()) continue;
            const absolute = join(directory, entry.name);
            if (entry.isDirectory()) await collect(absolute, depth + 1);
            else if (
              /\.(md|mdx|pdf|png|jpe?g|gif|svg|html?|csv|json|txt|docx|xlsx)$/i.test(
                entry.name,
              )
            ) {
              const info = await stat(absolute).catch(() => null);
              if (info?.isFile())
                artifacts.push({
                  path: relative(project.rootPath, absolute),
                  name: entry.name,
                  size: info.size,
                  updatedAt: info.mtime.toISOString(),
                });
            }
          }
        }
        for (const directory of directories)
          await collect(join(project.rootPath, directory));
        send(response, 200, {
          artifacts: artifacts.sort((a, b) =>
            b.updatedAt.localeCompare(a.updatedAt),
          ),
        });
        return;
      }
      if (path === "/api/terminal/exec" && request.method === "POST") {
        const body = await jsonBody(request, 100000);
        if (typeof body.command !== "string" || !body.command.trim()) {
          throw new Error("Commande manquante.");
        }
        let projectCwd;
        if (body.projectId) {
          try {
            const p = store.project(body.projectId);
            projectCwd = p?.rootPath
              ? await projectRoot(p.rootPath)
              : process.cwd();
          } catch {
            projectCwd = process.cwd();
          }
        } else {
          projectCwd = projectPath || process.cwd();
        }
        const effectiveCwd =
          body.cwd && typeof body.cwd === "string"
            ? resolve(projectCwd, body.cwd)
            : projectCwd;
        try {
          const { stdout, stderr } = await shellExec(body.command, {
            cwd: effectiveCwd,
            timeout: 60000,
            maxBuffer: 4 * 1024 * 1024,
            env: {
              ...process.env,
              TERM: "xterm-256color",
            },
          });
          send(response, 200, {
            stdout: stdout || "",
            stderr: stderr || "",
            exitCode: 0,
            cwd: effectiveCwd,
          });
        } catch (error) {
          send(response, 200, {
            stdout: error.stdout || "",
            stderr: error.stderr || error.message || "",
            exitCode: typeof error.code === "number" ? error.code : 1,
            cwd: effectiveCwd,
          });
        }
        return;
      }
      if (path === "/api/projects" && request.method === "POST") {
        const body = await jsonBody(request),
          path = await projectRoot(body.path);
        const project = await ensureProject(store, path, body.name);
        store.restoreProject(project.id);
        send(response, 201, project);
        return;
      }
      const projectAction = path.match(
        /^\/api\/projects\/([^/]+)\/(update|archive|restore|remove)$/,
      );
      if (projectAction && request.method === "POST") {
        const id = projectAction[1],
          body = await jsonBody(request);
        const project = store.project(id);
        if (project.id !== id)
          throw new Error("Identifiant de projet invalide.");
        if (projectAction[2] === "remove") {
          let paths = [project.rootPath];
          try {
            const cwd = await projectRoot(project.rootPath);
            const worktrees = await gitWorktrees(cwd);
            // Retirer le projet principal masque aussi ses espaces enregistrés.
            if (worktrees[0] && resolve(worktrees[0].path) === resolve(cwd))
              paths = worktrees.map((item) => item.path);
          } catch {
            // Un dossier supprimé ou sans Git reste retirable.
          }
          const removed = store
            .projects()
            .filter(
              (item) =>
                item.rootPath &&
                paths.some(
                  (path) => path && resolve(path) === resolve(item.rootPath),
                ),
            );
          if (!removed.some((item) => item.id === project.id))
            removed.push(project);
          store.db.transaction(() => {
            for (const item of removed) store.archiveProject(item.id);
          })();
          send(response, 200, { removedIds: removed.map((item) => item.id) });
        } else if (projectAction[2] === "archive")
          send(response, 200, store.archiveProject(id));
        else if (projectAction[2] === "restore")
          send(response, 200, store.restoreProject(id));
        else {
          if (typeof body.path !== "string" || !body.path.trim())
            throw new Error("Chemin du projet requis.");
          const rootPath =
            body.path === project.rootPath
              ? project.rootPath
              : await projectRoot(body.path);
          if (rootPath !== project.rootPath) {
            for (const other of [
              ...store.projects(),
              ...store.archivedProjects(),
            ]) {
              if (other.id === id || !other.rootPath) continue;
              try {
                if ((await projectRoot(other.rootPath)) === rootPath)
                  throw new Error(
                    "Ce dossier est déjà associé à un autre projet, y compris archivé.",
                  );
              } catch (error) {
                if (!error.message.includes("introuvable")) throw error;
              }
            }
          }
          send(
            response,
            200,
            store.updateProject(id, { name: body.name, rootPath }),
          );
        }
        return;
      }
      if (path === "/api/settings/registry" && request.method === "POST") {
        const body = await jsonBody(request);
        if (typeof body.id !== "string" || typeof body.enabled !== "boolean")
          throw new Error("Paramètres invalides.");
        if (body.type === "harness")
          send(response, 200, store.setHarnessEnabled(body.id, body.enabled));
        else if (body.type === "provider")
          send(response, 200, store.setProviderEnabled(body.id, body.enabled));
        else if (body.type === "model") {
          if (typeof body.providerId !== "string")
            throw new Error("Fournisseur de modèle requis.");
          send(
            response,
            200,
            store.setModelEnabled(body.providerId, body.id, body.enabled, {
              autoOnly: body.autoOnly === true,
            }),
          );
        } else throw new Error("Registre inconnu.");
        return;
      }
      if (path === "/api/settings/accounts" && request.method === "GET") {
        const provider = url.searchParams.get("provider");
        if (!Object.hasOwn(keyProviders, provider))
          throw new Error("Fournisseur de clé inconnu.");
        const [serviceName, providerName] = keyProviders[provider];
        send(
          response,
          200,
          new ApiKeyProfiles({
            serviceName,
            providerName,
          }).listApiKeyProfiles(),
        );
        return;
      }
      if (path === "/api/settings/accounts" && request.method === "POST") {
        const body = await jsonBody(request);
        if (
          !Object.hasOwn(keyProviders, body.provider) ||
          !["set", "use", "remove"].includes(body.action) ||
          typeof body.profile !== "string"
        )
          throw new Error("Compte invalide.");
        const [serviceName, providerName] = keyProviders[body.provider];
        const profiles = new ApiKeyProfiles({ serviceName, providerName });
        if (body.action === "set") profiles.setApiKey(body.key, body.profile);
        else if (body.action === "use") profiles.useApiKeyProfile(body.profile);
        else profiles.deleteApiKey(body.profile);
        send(response, 200, profiles.listApiKeyProfiles());
        return;
      }
      if (path === "/api/settings/mcp/remove" && request.method === "POST") {
        const body = await jsonBody(request);
        if (typeof body.name !== "string" || !body.name)
          throw new Error("Serveur MCP invalide.");
        send(response, 200, {
          removed: new McpRegistry({ store }).removeServer(body.name),
        });
        return;
      }
      const worktreeAction = path.match(
        /^\/api\/projects\/([^/]+)\/worktree-(open|create|remove)$/,
      );
      if (worktreeAction && request.method === "POST") {
        const project = store.project(worktreeAction[1]);
        const cwd = await projectRoot(project.rootPath);
        const body = await jsonBody(request);
        if (
          typeof body.path !== "string" ||
          !isAbsolute(body.path) ||
          body.path.includes("\0")
        )
          throw new Error(
            "Un chemin absolu est requis pour l’espace de travail.",
          );
        const target = resolve(body.path);
        if (worktreeAction[2] === "create") {
          if (typeof body.branch !== "string" || !body.branch.trim())
            throw new Error("Le nom de la nouvelle branche est requis.");
          await exec("git", ["check-ref-format", "--branch", body.branch], {
            cwd,
            timeout: 3000,
          });
          const exists = await stat(target).then(
            () => true,
            (error) => {
              if (error.code === "ENOENT") return false;
              throw error;
            },
          );
          if (exists) throw new Error("Le dossier cible existe déjà.");
          await exec(
            "git",
            ["worktree", "add", "-b", body.branch, "--", target, "HEAD"],
            { cwd, timeout: 120000 },
          );
          const added = await ensureProject(store, target);
          store.restoreProject(added.id);
          send(response, 201, added);
          return;
        }
        const worktree = (await gitWorktrees(cwd)).find(
          (item) => resolve(item.path) === target,
        );
        if (!worktree)
          throw new Error(
            "Cet espace n’appartient pas au dépôt Git du projet.",
          );
        if (worktreeAction[2] === "open") {
          const opened = await ensureProject(store, target);
          store.restoreProject(opened.id);
          send(response, 200, opened);
          return;
        }
        if (worktree.mainWorktree || worktree.locked || target === resolve(cwd))
          throw new Error(
            "Cet espace de travail ne peut pas être supprimé depuis ce projet.",
          );
        const registered = store
          .projects()
          .find((item) => item.rootPath && resolve(item.rootPath) === target);
        if (
          registered &&
          [...workspace.active.keys()].some(
            (id) => store.conversation(id).projectId === registered.id,
          )
        )
          throw new Error(
            "Arrêtez les agents actifs dans cet espace avant de le supprimer.",
          );
        await exec("git", ["worktree", "remove", "--", target], {
          cwd,
          timeout: 120000,
        });
        if (registered) store.archiveProject(registered.id);
        send(response, 200, {
          removed: true,
          projectId: registered?.id ?? null,
        });
        return;
      }
      const projectMatch = path.match(
        /^\/api\/projects\/([^/]+)\/(conversations|context|atlas|atlas-generate|atlas-page|artifact-raw|file-create|file-rename|file-delete|files|file|git|git-branch|git-stage|git-unstage|git-stage-all|git-unstage-all|git-commit|git-generate-message|git-file-diff|git-fetch|git-pull|git-push|git-commit-detail|github-prs|github-tasks|summary)$/,
      );
      if (
        projectMatch &&
        ["file-create", "file-rename", "file-delete"].includes(projectMatch[2]) &&
        request.method === "POST"
      ) {
        const project = store.project(projectMatch[1]);
        const body = await jsonBody(request, 10000);
        const root = project.rootPath;
        const result =
          projectMatch[2] === "file-create"
            ? await createEntry({ root, parent: body.parent ?? "", name: body.name, directory: Boolean(body.directory), isHidden: hidden })
            : projectMatch[2] === "file-rename"
              ? await renameEntry({ root, from: body.from, to: body.to, isHidden: hidden })
              : await deleteEntry({ root, path: body.path, isHidden: hidden });
        send(response, 200, result);
        return;
      }
      if (
        projectMatch &&
        projectMatch[2] === "artifact-raw" &&
        request.method === "GET"
      ) {
        const project = store.project(projectMatch[1]);
        const relativePath = url.searchParams.get("path") ?? "";
        if (!isPreviewablePath(relativePath))
          throw new Error("Seuls les artéfacts HTML du projet s'ouvrent ici.");
        const file = await containedFile(project.rootPath, relativePath);
        const content = await readFile(file);
        response.writeHead(200, PREVIEW_HEADERS);
        response.end(content);
        return;
      }
      if (
        projectMatch &&
        projectMatch[2] === "atlas" &&
        request.method === "GET"
      ) {
        const project = store.project(projectMatch[1]);
        send(response, 200, { ...atlasStatus(project.rootPath), pages: atlasPages(project.rootPath) });
        return;
      }
      if (
        projectMatch &&
        projectMatch[2] === "atlas-page" &&
        request.method === "GET"
      ) {
        const project = store.project(projectMatch[1]);
        const name = url.searchParams.get("name") ?? "";
        send(response, 200, { name, text: readAtlasPage(project.rootPath, name) });
        return;
      }
      if (
        projectMatch &&
        projectMatch[2] === "atlas-generate" &&
        request.method === "POST"
      ) {
        await jsonBody(request, 1000);
        const project = store.project(projectMatch[1]);
        const written = generateAtlas(project.rootPath);
        send(response, 200, { ...atlasStatus(project.rootPath), pages: atlasPages(project.rootPath), written });
        return;
      }
      if (
        projectMatch &&
        projectMatch[2] === "summary" &&
        request.method === "GET"
      ) {
        const project = store.project(projectMatch[1]);
        try {
          const cwd = await projectRoot(project.rootPath);
          const result = await exec("git", ["branch", "--show-current"], {
            cwd,
            timeout: 3000,
          });
          const [gitDir, commonDir] = await Promise.all([
            exec("git", ["rev-parse", "--absolute-git-dir"], {
              cwd,
              timeout: 3000,
            }),
            exec("git", ["rev-parse", "--git-common-dir"], {
              cwd,
              timeout: 3000,
            }),
          ]);
          const worktrees = await gitWorktrees(cwd);
          const registeredProjects = store.projects();
          send(response, 200, {
            available: true,
            branch: result.stdout.trim() || "HEAD détachée",
            mainWorktree:
              resolve(gitDir.stdout.trim()) ===
              resolve(cwd, commonDir.stdout.trim()),
            worktrees: worktrees.map((item) => ({
              ...item,
              projectId:
                registeredProjects.find(
                  (p) =>
                    p.rootPath && resolve(p.rootPath) === resolve(item.path),
                )?.id ?? null,
            })),
          });
        } catch {
          send(response, 200, { available: false, branch: null });
        }
        return;
      }
      if (
        projectMatch &&
        projectMatch[2] === "github-tasks" &&
        request.method === "GET"
      ) {
        const kind = url.searchParams.get("kind") || "issues";
        const filter = url.searchParams.get("filter") || "open";
        if (
          !["issues", "prs"].includes(kind) ||
          !["open", "mine", "review"].includes(filter) ||
          (kind === "issues" && filter === "review")
        )
          throw new Error("Filtre de tâches invalide.");
        const project = store.project(projectMatch[1]);
        const cwd = await projectRoot(project.rootPath);
        const fields =
          kind === "prs"
            ? "number,title,url,updatedAt,author,headRefName,reviewDecision,reviewRequests,statusCheckRollup,mergeStateStatus,isDraft"
            : "number,title,url,updatedAt,author,assignees,labels";
        const args = [
          kind === "prs" ? "pr" : "issue",
          "list",
          "--state",
          "open",
          "--limit",
          "50",
          "--json",
          fields,
        ];
        if (filter === "mine")
          args.push(kind === "prs" ? "--author" : "--assignee", "@me");
        if (filter === "review") args.push("--search", "review-requested:@me");
        try {
          const result = await exec("gh", args, {
            cwd,
            timeout: 20000,
            maxBuffer: 1000000,
            env: { ...process.env, GH_PROMPT_DISABLED: "1" },
          });
          const rows = JSON.parse(result.stdout).map((row) => ({
            ...row,
            title: redactSecrets(row.title),
            url: /^https:\/\/github\.com\//.test(row.url) ? row.url : null,
          }));
          send(response, 200, { rows, limit: 50 });
        } catch {
          send(response, 400, {
            error:
              "GitHub indisponible pour ce projet : vérifiez le remote et gh auth login.",
          });
        }
        return;
      }
      if (
        projectMatch &&
        projectMatch[2] === "github-prs" &&
        request.method === "GET"
      ) {
        const project = store.project(projectMatch[1]);
        const cwd = await projectRoot(project.rootPath);
        try {
          const result = await exec(
            "gh",
            [
              "pr",
              "list",
              "--limit",
              "20",
              "--json",
              "number,title,url,headRefName",
            ],
            {
              cwd,
              timeout: 15000,
              maxBuffer: 100000,
              env: { ...process.env, GH_PROMPT_DISABLED: "1" },
            },
          );
          const prs = JSON.parse(result.stdout).map((pr) => ({
            number: pr.number,
            title: redactSecrets(pr.title),
            url: /^https:\/\/github\.com\//.test(pr.url) ? pr.url : null,
            branch: pr.headRefName,
          }));
          send(response, 200, { prs });
        } catch {
          send(response, 400, {
            error:
              "Impossible de charger les pull requests. Vérifiez gh auth login et le dépôt GitHub associé.",
          });
        }
        return;
      }
      if (
        projectMatch &&
        request.method === "POST" &&
        [
          "git-branch",
          "git-stage",
          "git-unstage",
          "git-stage-all",
          "git-unstage-all",
          "git-commit",
          "git-generate-message",
          "git-fetch",
          "git-pull",
          "git-push",
        ].includes(projectMatch[2])
      ) {
        const body = await jsonBody(request);
        const project = store.project(projectMatch[1]);
        const cwd = await projectRoot(project.rootPath);
        const gitExec = (args) =>
          exec("git", args, {
            cwd,
            timeout: 120000,
            maxBuffer: 2000000,
            env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
          });
        if (projectMatch[2] === "git-branch") {
          if (
            typeof body.name !== "string" ||
            body.name.startsWith("-") ||
            body.name.length > 200
          )
            throw new Error("Nom de branche invalide.");
          if (
            [...workspace.active.values()].some(
              (run) =>
                store.conversation(run.conversationId).projectId === project.id,
            )
          )
            throw new Error("Arrêtez l’agent avant de changer de branche.");
          await gitExec(["check-ref-format", "--branch", body.name]);
          await gitExec(
            body.create === true
              ? ["switch", "-c", body.name]
              : ["switch", "--", body.name],
          );
        } else if (
          ["git-fetch", "git-pull", "git-push"].includes(projectMatch[2])
        ) {
          const command = projectMatch[2].slice(4);
          await gitExec(command === "pull" ? ["pull", "--ff-only"] : [command]);
        } else if (projectMatch[2] === "git-generate-message") {
          const names = (
            await gitExec(["diff", "--cached", "--name-only", "-z"])
          ).stdout
            .split("\0")
            .filter(Boolean);
          if (names.some((name) => !validGitPath(name)))
            throw new Error(
              "Des fichiers privés sont indexés ; retirez-les de l’index avant la génération.",
            );
          const snapshot = async () => {
            if (names.length)
              return (
                await gitExec([
                  "diff",
                  "--cached",
                  "--no-ext-diff",
                  "--no-color",
                  "--",
                  ...names.map((name) => `:(literal)${name}`),
                ])
              ).stdout;
            const changes = parseGitStatus(
              (
                await gitExec([
                  "status",
                  "--porcelain=v1",
                  "-z",
                  "--untracked-files=all",
                ])
              ).stdout,
            );
            const eligible = changes
              .filter(
                (change) =>
                  validGitPath(change.path) &&
                  (change.code === "??" || change.code[1] !== " "),
              )
              .slice(0, 50);
            const tracked = eligible.filter((change) => change.code !== "??");
            let output = tracked.length
              ? (
                  await gitExec([
                    "diff",
                    "--no-ext-diff",
                    "--no-color",
                    "--",
                    ...tracked.map((change) => `:(literal)${change.path}`),
                  ])
                ).stdout
              : "";
            for (const change of eligible.filter(
              (entry) => entry.code === "??",
            )) {
              const target = await containedFile(cwd, change.path);
              if (
                relative(cwd, target).split(/[\\/]/).some(hidden) ||
                !(await stat(target)).isFile()
              )
                continue;
              try {
                output += (
                  await gitExec([
                    "diff",
                    "--no-index",
                    "--no-color",
                    "--",
                    "/dev/null",
                    target,
                  ])
                ).stdout;
              } catch (error) {
                if (error.code === 1 && typeof error.stdout === "string")
                  output += error.stdout;
                else throw error;
              }
              if (output.length > 100000) break;
            }
            return output;
          };
          const diff = await snapshot();
          if (!diff.trim())
            throw new Error(
              "Aucun changement texte accessible pour la génération.",
            );
          const result = await workspace.generateCommitMessage({
            projectId: project.id,
            cwd,
            diff: redactSecrets(diff).slice(0, 100000),
            harnessId: body.harnessId,
            model: body.model,
          });
          const currentNames = (
            await gitExec(["diff", "--cached", "--name-only", "-z"])
          ).stdout
            .split("\0")
            .filter(Boolean);
          if (
            currentNames.join("\0") !== names.join("\0") ||
            (await snapshot()) !== diff
          )
            throw new Error(
              "Les changements ont changé pendant la génération. Relancez-la.",
            );
          send(response, 200, result);
          return;
        } else if (
          [
            "git-stage",
            "git-unstage",
            "git-stage-all",
            "git-unstage-all",
          ].includes(projectMatch[2])
        ) {
          const stage = ["git-stage", "git-stage-all"].includes(
            projectMatch[2],
          );
          const all = projectMatch[2].endsWith("-all");
          let paths;
          if (all) {
            const changes = parseGitStatus(
              (
                await gitExec([
                  "status",
                  "--porcelain=v1",
                  "-z",
                  "--untracked-files=all",
                ])
              ).stdout,
            );
            paths = changes
              .filter((change) =>
                stage
                  ? change.code === "??" || change.code[1] !== " "
                  : change.code !== "??" && change.code[0] !== " ",
              )
              .flatMap((change) => [
                change.path,
                ...(change.oldPath ? [change.oldPath] : []),
              ])
              .filter(validGitPath);
          } else {
            if (!validGitPath(body.path))
              throw new Error("Chemin invalide ou privé.");
            paths = [body.path];
            if (!stage) {
              const changes = parseGitStatus(
                (
                  await gitExec([
                    "status",
                    "--porcelain=v1",
                    "-z",
                    "--untracked-files=all",
                  ])
                ).stdout,
              );
              const previous = changes.find(
                (change) => change.path === body.path,
              )?.oldPath;
              if (previous && validGitPath(previous)) paths.push(previous);
            }
          }
          paths = [...new Set(paths)];
          if (paths.length) {
            const pathspecs = paths.map((path) => `:(literal)${path}`);
            if (stage) await gitExec(["add", "--", ...pathspecs]);
            else {
              const hasHead = await gitExec([
                "rev-parse",
                "--verify",
                "HEAD",
              ]).then(
                () => true,
                () => false,
              );
              await gitExec(
                hasHead
                  ? ["reset", "-q", "HEAD", "--", ...pathspecs]
                  : [
                      "rm",
                      "--cached",
                      "-f",
                      "-r",
                      "--ignore-unmatch",
                      "--",
                      ...pathspecs,
                    ],
              );
            }
          }
        } else {
          if (
            typeof body.message !== "string" ||
            !body.message.trim() ||
            body.message.length > 1000
          )
            throw new Error("Message de commit invalide.");
          await gitExec(["commit", "-m", body.message.trim()]);
        }
        send(response, 200, { ok: true });
        return;
      }
      if (
        projectMatch &&
        projectMatch[2] === "file" &&
        request.method === "POST"
      ) {
        const body = await jsonBody(request, 2000000);
        const isDraft =
          body.revision === "draft" ||
          body.revision === "new" ||
          body.create === true;
        if (
          typeof body.path !== "string" ||
          typeof body.content !== "string" ||
          (!isDraft && !/^[a-f0-9]{64}$/.test(body.revision ?? "")) ||
          Buffer.byteLength(body.content) > 512000 ||
          body.content.includes("\0")
        )
          throw new Error("Contenu ou version de fichier invalide.");
        if (body.path.split(/[\\/]/).some(hidden))
          throw new Error(
            "Ce fichier est privé ou exclu du navigateur de fichiers.",
          );
        const project = store.project(projectMatch[1]);
        const cwd = await projectRoot(project.rootPath);
        let target;
        try {
          target = await containedFile(cwd, body.path);
        } catch (err) {
          if (isDraft) {
            const resolved = resolve(cwd, body.path);
            const rel = relative(cwd, resolved);
            if (
              rel === ".." ||
              rel.startsWith(".." + sep) ||
              isAbsolute(body.path) ||
              rel.split(/[\\/]/).some(hidden)
            ) {
              throw new Error("Ce chemin sort du projet ou est privé.");
            }
            target = resolved;
          } else {
            throw err;
          }
        }
        if (relative(cwd, target).split(/[\\/]/).some(hidden))
          throw new Error(
            "Ce fichier est privé ou exclu du navigateur de fichiers.",
          );
        if (savingFiles.has(target)) {
          send(response, 409, {
            error: "Une sauvegarde de ce fichier est déjà en cours.",
          });
          return;
        }
        savingFiles.add(target);
        if (isDraft) {
          try {
            await writeFile(target, Buffer.from(body.content, "utf8"));
            send(response, 200, {
              path: body.path,
              revision: revision(body.content),
            });
          } finally {
            savingFiles.delete(target);
          }
          return;
        }
        let file;
        try {
          file = await open(target, "r+");
          const info = await file.stat();
          if (!info.isFile() || info.size > 512000)
            throw new Error(
              "Seuls les fichiers texte de moins de 512 Ko sont modifiables.",
            );
          const currentBytes = await file.readFile();
          const current = currentBytes.toString("utf8");
          if (!Buffer.from(current, "utf8").equals(currentBytes))
            throw new Error("Ce fichier n’est pas encodé en UTF-8.");
          if (current.includes("\0") || redactSecrets(current) !== current)
            throw new Error(
              "Ce fichier ne peut pas être modifié dans l’éditeur.",
            );
          if (revision(current) !== body.revision) {
            send(response, 409, {
              error:
                "Le fichier a été modifié ailleurs. Copiez vos changements puis rechargez le fichier avant de sauvegarder.",
            });
            return;
          }
          const content = Buffer.from(body.content, "utf8");
          let offset = 0;
          while (offset < content.length) {
            const { bytesWritten } = await file.write(
              content,
              offset,
              content.length - offset,
              offset,
            );
            if (!bytesWritten)
              throw new Error("Écriture du fichier interrompue.");
            offset += bytesWritten;
          }
          await file.truncate(content.length);
          send(response, 200, { path: body.path, revision: revision(content) });
        } finally {
          if (file) await file.close();
          savingFiles.delete(target);
        }
        return;
      }
      if (projectMatch && request.method === "GET") {
        const project = store.project(projectMatch[1]);
        const action = projectMatch[2];
        if (action === "conversations") {
          send(
            response,
            200,
            store
              .conversations(project.id, {
                archived: url.searchParams.get("archived") === "true",
              })
              .reverse(),
          );
          return;
        }
        const cwd = await projectRoot(project.rootPath);
        if (action === "git-file-diff") {
          const filePath = url.searchParams.get("path"),
            staged = url.searchParams.get("staged") === "true",
            untracked = url.searchParams.get("untracked") === "true";
          if (!validGitPath(filePath))
            throw new Error("Chemin invalide ou privé.");
          let result;
          if (untracked) {
            const target = await containedFile(cwd, filePath);
            if (relative(cwd, target).split(/[\\/]/).some(hidden))
              throw new Error("Ce fichier est privé.");
            if (!(await stat(target)).isFile())
              throw new Error("Ce fichier ne peut pas être affiché.");
            try {
              result = await exec(
                "git",
                ["diff", "--no-index", "--no-color", "--", "/dev/null", target],
                { cwd, timeout: 10000, maxBuffer: 1000000 },
              );
            } catch (error) {
              if (error.code === 1 && typeof error.stdout === "string")
                result = error;
              else throw error;
            }
          } else {
            result = await exec(
              "git",
              [
                "diff",
                ...(staged ? ["--cached"] : []),
                "--no-ext-diff",
                "--no-color",
                "--",
                `:(literal)${filePath}`,
              ],
              { cwd, timeout: 10000, maxBuffer: 1000000 },
            );
          }
          send(response, 200, {
            path: filePath,
            content: redactSecrets(result.stdout),
          });
          return;
        }
        if (action === "git-commit-detail") {
          const hash = url.searchParams.get("hash") ?? "";
          if (!/^[0-9a-f]{40,64}$/i.test(hash))
            throw new Error("Identifiant de commit invalide.");
          const result = await exec(
            "git",
            [
              "show",
              "--format=fuller",
              "--no-ext-diff",
              "--no-color",
              "--stat",
              "--patch",
              hash,
              "--",
            ],
            { cwd, timeout: 10000, maxBuffer: 2000000 },
          );
          send(response, 200, { hash, content: redactSecrets(result.stdout) });
          return;
        }
        if (action === "context") {
          const ctx = await readProjectContext(cwd);
          send(response, 200, { files: ctx.files, root: ctx.root });
          return;
        }
        if (action === "git") {
          try {
            const [
              branch,
              status,
              diff,
              branches,
              history,
              remote,
              gh,
              porcelain,
            ] = await Promise.all([
              exec("git", ["branch", "--show-current"], {
                cwd,
                timeout: 5000,
                maxBuffer: 100000,
              }),
              exec("git", ["status", "--short"], {
                cwd,
                timeout: 5000,
                maxBuffer: 100000,
              }),
              exec(
                "git",
                ["diff", "--no-ext-diff", "--no-color", "HEAD", "--"],
                { cwd, timeout: 5000, maxBuffer: 1000000 },
              ),
              exec("git", ["branch", "--format=%(refname:short)"], {
                cwd,
                timeout: 5000,
              }).catch(() => ({ stdout: "" })),
              exec(
                "git",
                [
                  "log",
                  "-50",
                  "--topo-order",
                  "--format=%H%x00%P%x00%h%x00%s%x00%an%x00%cr%x00%D",
                  "--all",
                ],
                {
                  cwd,
                  timeout: 5000,
                },
              ).catch(() => ({ stdout: "" })),
              exec("git", ["remote", "get-url", "origin"], {
                cwd,
                timeout: 5000,
              }).catch(() => ({ stdout: "" })),
              exec("gh", ["auth", "status", "-h", "github.com"], {
                cwd,
                timeout: 5000,
              }).then(
                () => true,
                () => false,
              ),
              exec(
                "git",
                ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
                {
                  cwd,
                  timeout: 5000,
                  maxBuffer: 1000000,
                },
              ),
            ]);
            const remoteName = remote.stdout
              .trim()
              .match(
                /^(?:https?:\/\/(?:[^/@]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/i,
              )?.[1];
            const changes = parseGitStatus(porcelain.stdout);
            send(response, 200, {
              available: true,
              branch: branch.stdout.trim(),
              status: status.stdout,
              diff: redactSecrets(diff.stdout),
              branches: branches.stdout.trim().split("\n").filter(Boolean),
              history: history.stdout
                .trim()
                .split("\n")
                .filter(Boolean)
                .map((line) => {
                  const [id, parents, hash, subject, author, age, refs] =
                    line.split("\0");
                  return {
                    id,
                    parents: parents ? parents.split(" ") : [],
                    hash,
                    subject: redactSecrets(subject),
                    author: redactSecrets(author),
                    age,
                    refs: refs
                      ? refs
                          .split(", ")
                          .map((ref) => ref.replace(/^HEAD -> /, ""))
                      : [],
                  };
                }),
              github: {
                connected: gh,
                url: remoteName ? `https://github.com/${remoteName}` : null,
              },
              changes,
            });
          } catch {
            send(response, 200, {
              available: false,
              branch: null,
              status: "",
              diff: "",
            });
          }
          return;
        }
        const rel = url.searchParams.get("path") ?? ".";
        if (rel.split(/[\\/]/).some(hidden))
          throw new Error(
            "Ce fichier est privé ou exclu du navigateur de fichiers.",
          );
        const target = await containedFile(cwd, rel);
        if (relative(cwd, target).split(/[\\/]/).some(hidden))
          throw new Error(
            "Ce fichier est privé ou exclu du navigateur de fichiers.",
          );
        if (action === "files") {
          const entries = (await readdir(target, { withFileTypes: true }))
            .filter((e) => !hidden(e.name) && !e.isSymbolicLink())
            .map((e) => ({
              name: e.name,
              path: rel === "." ? e.name : `${rel}/${e.name}`,
              directory: e.isDirectory(),
            }))
            .sort(
              (a, b) =>
                Number(b.directory) - Number(a.directory) ||
                a.name.localeCompare(b.name),
            )
            .slice(0, 300);
          send(response, 200, entries);
          return;
        }
        const info = await stat(target);
        if (!info.isFile() || info.size > 512000)
          throw new Error(
            "Seuls les fichiers texte de moins de 512 Ko sont affichables.",
          );
        const bytes = await readFile(target);
        const value = bytes.toString("utf8");
        if (!Buffer.from(value, "utf8").equals(bytes))
          throw new Error("Ce fichier n’est pas encodé en UTF-8.");
        if (value.includes("\0"))
          throw new Error("Ce fichier binaire ne peut pas être affiché.");
        const safe = redactSecrets(value);
        send(response, 200, {
          path: rel,
          content: safe,
          revision: revision(value),
          readOnly: safe !== value,
        });
        return;
      }
      if (path === "/api/conversations" && request.method === "POST") {
        const body = await jsonBody(request);
        const project = store.project(body.projectId);
        const model = typeof body.model === "string" ? body.model : "codex";
        const rawTitle = typeof body.title === "string" ? body.title.trim() : "";
        const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
        const generated = deriveGeneratedTabTitle(prompt || rawTitle);
        const title =
          (isDefaultConversationTitle(rawTitle) ? generated : null) ||
          generated ||
          (rawTitle ? rawTitle.slice(0, 120) : "Nouvelle conversation");
        send(
          response,
          201,
          store.createConversation(
            project.id,
            title,
            model,
          ),
        );
        return;
      }
      const conversationMatch = path.match(
        /^\/api\/conversations\/([^/]+)(?:\/(events|cancel|recover|rename|generate-title|archive|restore|delete))?$/,
      );
      if (conversationMatch) {
        const id = conversationMatch[1];
        store.conversation(id);
        if (
          request.method === "GET" &&
          (!conversationMatch[2] || conversationMatch[2] === "events")
        ) {
          send(
            response,
            200,
            conversationMatch[2] === "events"
              ? store.listEvents(id)
              : store.conversation(id),
          );
          return;
        }
        if (
          request.method === "POST" &&
          [
            "rename",
            "generate-title",
            "archive",
            "restore",
            "delete",
          ].includes(conversationMatch[2])
        ) {
          const action = conversationMatch[2];
          const body = await jsonBody(request);
          if (
            ["archive", "delete"].includes(action) &&
            workspace.active.has(id)
          ) {
            send(response, 409, {
              error: "Arrêtez l’agent avant de modifier cette conversation.",
            });
            return;
          }
          let result;
          if (action === "generate-title") {
            const conv = store.conversation(id);
            const firstUser = conv.messages.find((m) => m.role === "user");
            const prompt = firstUser ? firstUser.content : "";
            const generated =
              deriveGeneratedTabTitle(prompt) || "Nouvelle conversation";
            result = store.renameConversation(id, generated);
            workspace.publish(
              "conversation.renamed",
              { id, conversationId: id, title: generated },
              id,
            );
          } else if (action === "rename") {
            result = store.renameConversation(id, body.title);
            workspace.publish(
              "conversation.renamed",
              { id, conversationId: id, title: result.title },
              id,
            );
          } else if (action === "archive") {
            result = store.archiveConversation(id);
          } else if (action === "restore") {
            result = store.restoreConversation(id);
          } else {
            result = store.deleteConversation(id);
          }
          send(response, 200, result);
          return;
        }
        if (request.method === "POST" && conversationMatch[2] === "cancel") {
          send(response, 200, { cancelled: workspace.cancel(id) });
          return;
        }
        if (request.method === "POST" && conversationMatch[2] === "recover") {
          if (workspace.active.has(id)) {
            send(response, 409, {
              error:
                "Annulez le tour actif avant de reprendre cette conversation.",
            });
            return;
          }
          send(response, 200, store.recoverConversation(id));
          return;
        }
      }
      if (path === "/api/runs" && request.method === "POST") {
        const body = await jsonBody(request);
        if (store.conversation(body.conversationId).archived)
          throw new Error(
            "Restaurez cette conversation avant de lancer un agent.",
          );
        if (
          body.permissionMode === "accept-edits" ||
          body.permissionMode === "auto"
        ) {
          body.permissionMode = "allow";
        }
        if (body.permissionMode === "full-access") {
          body.permissionMode = "full";
        }
        if (
          typeof body.prompt !== "string" ||
          !body.prompt.trim() ||
          body.prompt.length > 128000 ||
          !["auto", ...harnessChoices.map((h) => h.id)].includes(
            normalizeHarness(body.harnessId ?? "auto"),
          ) ||
          (body.model !== undefined && typeof body.model !== "string") ||
          (body.permissionMode !== undefined &&
            !["ask", "allow", "deny", "full"].includes(body.permissionMode))
        ) {
          send(response, 400, { error: "Prompt ou Harness invalide." });
          return;
        }
        if (workspace.active.has(body.conversationId)) {
          send(response, 409, { error: "Une exécution est déjà active." });
          return;
        }
        const { runId } = workspace.start({
          conversationId: body.conversationId,
          prompt: body.prompt,
          harnessId: body.harnessId,
          model: body.model,
          permissionMode: body.permissionMode,
        });
        send(response, 202, { runId });
        return;
      }
      const approvalMatch = path.match(/^\/api\/approvals\/([^/]+)$/);
      if (approvalMatch && request.method === "POST") {
        const body = await jsonBody(request);
        send(response, 200, workspace.approve(approvalMatch[1], body.allowed));
        return;
      }
      if (path === "/api/mcp" && request.method === "POST") {
        const body = await jsonBody(request);
        const registry = new McpRegistry({ store });
        const added = registry.addServer(body);
        send(response, 201, { name: added.name, transport: added.transport });
        return;
      }
      if (path.startsWith("/api/")) {
        send(response, 404, { error: "Route introuvable." });
        return;
      }
      if (request.method !== "GET") {
        send(response, 405, { error: "Méthode refusée." });
        return;
      }
      let file;
      if (path === "/assets/omni.svg") file = join(root, "assets/omni.svg");
      else {
        const rel = decodeURIComponent(path).replace(/^\/+/, "");
        file = await containedFile(webDir, rel || "index.html").catch(() =>
          join(webDir, "index.html"),
        );
      }
      const content = await readFile(file).catch(() => null);
      if (!content) {
        send(response, 503, {
          error: "GUI non compilée. Lancez npm run gui:build.",
        });
        return;
      }
      response.writeHead(200, {
        "content-type":
          contentTypes[extname(file)] ?? "application/octet-stream",
        "x-content-type-options": "nosniff",
        "content-security-policy":
          "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http:; font-src 'self' data:; connect-src 'self' http: https: ws: wss:; frame-src 'self' http: https: data: blob:; frame-ancestors 'none'; base-uri 'self'",
        "cache-control": "no-cache",
      });
      response.end(content);
    } catch (error) {
      if (!response.headersSent)
        send(response, 400, { error: redactSecrets(error.message) });
      else response.end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return {
    server,
    workspace,
    url: `http://127.0.0.1:${server.address().port}`,
    async close() {
      workspace.off("event", onWorkspaceEvent);
      for (const client of clients) client.end();
      await workspace.close();
      awake.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
