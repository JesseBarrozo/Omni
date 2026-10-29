import { spawn, spawnSync } from "node:child_process";
import { chmod, lstat, mkdir, realpath, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { redactSecrets } from "./core.mjs";

const safeError = (message) => new Error(redactSecrets(String(message)));
const sessionIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseAntigravityModels(output) {
  return [
    ...new Set(
      String(output)
        .split(/\r?\n/)
        .map((line) => {
          const [id, label] = line.trim().split(/\t+/, 2);
          return label ? id : null;
        })
        .filter(
          (id) =>
            id &&
            !["name", "model", "id"].includes(id.toLowerCase()) &&
            /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(id),
        ),
    ),
  ];
}

export function antigravityCliStatus({ executable = "agy" } = {}) {
  const result = spawnSync(executable, ["--help"], {
    stdio: "ignore",
    timeout: 10_000,
  });
  return {
    provider: "antigravity",
    cliInstalled: !result.error && result.status === 0,
    authenticated: null,
  };
}

export function startAntigravityLogin({ executable = "agy" } = {}) {
  return spawnSync(executable, [], { stdio: "inherit" });
}

function childEnvironment(source) {
  const env = { ...source };
  for (const key of Object.keys(env)) {
    if (
      /(?:API_KEY|ACCESS_TOKEN|REFRESH_TOKEN|CLIENT_SECRET|AUTH_TOKEN)$/i.test(
        key,
      ) ||
      ["GOOGLE_APPLICATION_CREDENTIALS", "CLOUDSDK_AUTH_ACCESS_TOKEN"].includes(
        key,
      )
    )
      delete env[key];
  }
  return env;
}

export async function assertAntigravityHeadlessPolicy({
  settingsPath = join(homedir(), ".gemini", "antigravity-cli", "settings.json"),
  hooksPath = join(homedir(), ".gemini", "config", "hooks.json"),
} = {}) {
  let settings;
  try {
    settings = JSON.parse(await readFile(settingsPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw safeError(
      `Impossible de vérifier les permissions Antigravity: ${error.message}`,
    );
  }
  const allow = settings.permissions?.allow ?? [];
  if (!Array.isArray(allow))
    throw new Error(
      "Permissions Antigravity non vérifiables; exécution refusée",
    );
  if (allow.length)
    throw new Error(
      "Antigravity désactivé dans Omni: des règles globales allow contournent les permissions headless",
    );
  if (
    settings.toolPermission !== undefined &&
    settings.toolPermission !== "request-review"
  )
    throw new Error(
      "Antigravity désactivé dans Omni: toolPermission doit être request-review",
    );

  let hooks;
  try {
    hooks = JSON.parse(await readFile(hooksPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT")
      throw safeError(
        `Impossible de vérifier les hooks Antigravity: ${error.message}`,
      );
  }
  const hasCommand = (value) => {
    if (Array.isArray(value)) return value.some(hasCommand);
    if (!value || typeof value !== "object") return false;
    if (typeof value.command === "string" && value.command.trim()) return true;
    return Object.values(value).some(hasCommand);
  };
  if (hasCommand(hooks))
    throw new Error(
      "Antigravity désactivé dans Omni: des hooks globaux peuvent exécuter des commandes hors de l'espace isolé",
    );
}

async function privateWorkspace(dataDir, conversationId) {
  if (!sessionIdPattern.test(conversationId ?? ""))
    throw new Error("Identifiant de conversation Omni invalide");
  const root = resolve(dataDir, "antigravity-workspaces");
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
    throw new Error("Espace Antigravity privé invalide");
  const path = join(root, conversationId);
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("Espace de session Antigravity privé invalide");
  const [realRoot, realPath] = await Promise.all([
    realpath(root),
    realpath(path),
  ]);
  if (!realPath.startsWith(`${realRoot}/`))
    throw new Error("Espace Antigravity hors de sa racine privée");
  return realPath;
}

function parseEvent(line) {
  try {
    const event = JSON.parse(line);
    if (!event || typeof event.event !== "string") throw new Error();
    return event;
  } catch {
    throw new Error("Antigravity a émis un événement JSONL invalide");
  }
}

export class AntigravityCliChat {
  constructor({
    store,
    dataDir = join(homedir(), ".omni"),
    executable = "agy",
    model,
    settingsPath,
    env = process.env,
    spawnProcess = spawn,
  } = {}) {
    if (!store) throw new Error("AntigravityCliChat requires the Omni store");
    this.store = store;
    this.dataDir = dataDir;
    this.executable = executable;
    this.model = model;
    this.settingsPath = settingsPath;
    this.env = env;
    this.spawnProcess = spawnProcess;
    this.processes = new Map();
  }

  async listModels() {
    await assertAntigravityHeadlessPolicy({ settingsPath: this.settingsPath });
    const result = spawnSync(this.executable, ["models"], {
      encoding: "utf8",
      timeout: 30_000,
      env: childEnvironment(this.env),
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error || result.status !== 0)
      throw safeError(
        `Catalogue Antigravity indisponible: ${result.error?.message ?? result.stderr ?? "échec du CLI"}`,
      );
    const models = parseAntigravityModels(result.stdout);
    if (!models.length)
      throw new Error("Catalogue Antigravity vide ou invalide");
    return models;
  }

  async stream({ messages, conversationId, signal, onDelta = () => {} }) {
    if (!conversationId) throw new Error("conversationId Omni requis");
    if (signal?.aborted)
      throw Object.assign(new Error("Exécution interrompue"), {
        name: "AbortError",
      });
    await assertAntigravityHeadlessPolicy({ settingsPath: this.settingsPath });
    const cwd = await privateWorkspace(this.dataDir, conversationId);
    const events = this.store.listEvents(conversationId);
    const previous = events
      .filter(
        (event) =>
          event.type === "session.started" &&
          event.payload.providerId === "antigravity" &&
          typeof event.payload.sessionId === "string",
      )
      .at(-1)?.payload.sessionId;
    const prompt = previous
      ? (messages.at(-1)?.content ?? "")
      : messages
          .map(
            ({ role, content }) =>
              `${role === "user" ? "User" : "Assistant"}:\n${content}`,
          )
          .join("\n\n");
    if (!prompt.trim()) throw new Error("Message Antigravity vide");
    const args = [
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--mode",
      "plan",
      "--sandbox",
      ...(this.model ? ["--model", this.model] : []),
      ...(previous ? ["--conversation", previous] : []),
    ];
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const child = this.spawnProcess(this.executable, args, {
      cwd,
      env: childEnvironment(this.env),
      signal: controller.signal,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdin.on("error", () => {});
    child.stdin.end(
      `${JSON.stringify({ event: "user", message: { content: prompt } })}\n`,
    );
    this.processes.set(conversationId, { child, controller });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-8192);
    });
    let initialized = false;
    let sessionId = previous ?? null;
    let finalResult = null;
    let streamed = "";
    let streamError = null;
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    const consume = (async () => {
      for await (const line of lines) {
        const event = parseEvent(line);
        if (event.event === "init") {
          if (initialized || typeof event.conversation_id !== "string")
            throw new Error("Initialisation Antigravity invalide");
          initialized = true;
          if (event.init?.permission_mode !== "request-review")
            throw new Error(
              "Mode de permission Antigravity inattendu; exécution arrêtée",
            );
          if ((await realpath(event.init?.cwd ?? "")) !== cwd)
            throw new Error("Antigravity a démarré hors de son espace privé");
          sessionId = event.conversation_id;
          if (!previous)
            this.store.appendEvent(conversationId, "session.started", {
              providerId: "antigravity",
              sessionId,
            });
        } else if (event.event === "step_update") {
          if (!initialized)
            throw new Error("Événement Antigravity reçu avant init");
          const step = event.step_update;
          if (typeof step?.text_delta === "string" && step.text_delta) {
            streamed += step.text_delta;
            onDelta(step.text_delta);
          }
          if (step?.step_type === "tool" && step.state === "DONE") {
            const payload = {
              providerId: "antigravity",
              sessionId,
              toolName: String(step.tool_name ?? "unknown").slice(0, 120),
              failed: Boolean(step.tool_info?.error),
            };
            this.store.appendEvent(
              conversationId,
              payload.failed ? "tool.failed" : "tool.completed",
              payload,
            );
          }
        } else if (event.event === "result") {
          if (!initialized || finalResult)
            throw new Error("Résultat Antigravity inattendu");
          finalResult = event.result;
          if (finalResult.conversation_id !== sessionId)
            throw new Error("ID de conversation Antigravity incohérent");
        } else {
          throw new Error(
            `Événement Antigravity non pris en charge: ${event.event}`,
          );
        }
      }
    })().catch((error) => {
      streamError = error;
      controller.abort();
    });
    try {
      const [code] = await new Promise((resolveExit, rejectExit) => {
        child.once("error", rejectExit);
        child.once("close", (exitCode, exitSignal) =>
          resolveExit([exitCode, exitSignal]),
        );
      });
      await consume;
      if (streamError) throw streamError;
      if (signal?.aborted)
        throw Object.assign(new Error("Exécution interrompue"), {
          name: "AbortError",
        });
      if (code !== 0)
        throw safeError(
          `Antigravity a échoué (${code ?? "signal"}): ${stderr || "aucun détail fourni"}`,
        );
      if (!initialized || !finalResult)
        throw new Error("Antigravity s'est fermé sans résultat final");
      if (finalResult.status !== "SUCCESS")
        throw safeError(
          finalResult.error ?? `Antigravity a terminé (${finalResult.status})`,
        );
      const response = String(finalResult.response ?? streamed);
      if (!response && !streamed) throw new Error("Réponse Antigravity vide");
      if (!streamed && response) onDelta(response);
      if (finalResult.usage)
        this.store.appendEvent(conversationId, "usage.updated", {
          providerId: "antigravity",
          sessionId,
          usage: finalResult.usage,
        });
      this.store.appendEvent(conversationId, "session.checkpointed", {
        providerId: "antigravity",
        sessionId,
      });
      return response || streamed;
    } catch (error) {
      if (
        signal?.aborted ||
        controller.signal.aborted ||
        error.name === "AbortError"
      ) {
        this.store.appendEvent(conversationId, "session.interrupted", {
          providerId: "antigravity",
          sessionId,
        });
        throw Object.assign(new Error("Exécution interrompue"), {
          name: "AbortError",
        });
      }
      throw safeError(error.message);
    } finally {
      signal?.removeEventListener("abort", abort);
      this.processes.delete(conversationId);
    }
  }

  async interrupt(conversationId) {
    const active = this.processes.get(conversationId);
    if (!active) return false;
    active.controller.abort();
    return true;
  }

  async dispose() {
    for (const active of this.processes.values()) active.controller.abort();
    this.processes.clear();
  }
}
