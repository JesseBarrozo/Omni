import { spawn, spawnSync } from "node:child_process";
import { redactSecrets } from "./core.mjs";

const abortError = () =>
  Object.assign(new Error("Execution interrompue"), { name: "AbortError" });
const safeError = (message) => new Error(redactSecrets(String(message)));

export function codexAuthStatus({ executable = "codex" } = {}) {
  const result = spawnSync(executable, ["login", "status"], {
    stdio: "ignore",
    timeout: 10_000,
  });
  return {
    provider: "codex",
    authenticated: !result.error && result.status === 0,
  };
}

export function startCodexLogin({
  executable = "codex",
  stdio = "inherit",
} = {}) {
  return spawnSync(executable, ["login"], { stdio });
}

class CodexAppServer {
  constructor({ executable = "codex", timeoutMs = 30_000 } = {}) {
    this.executable = executable;
    this.timeoutMs = timeoutMs;
    this.sequence = 1;
    this.pending = new Map();
    this.notifications = [];
    this.notificationWaiters = [];
    this.buffer = "";
  }

  async start() {
    this.child = spawn(
      this.executable,
      ["app-server", "--listen", "stdio://", "-c", "mcp_servers={}"],
      {
        stdio: ["pipe", "pipe", "ignore"],
      },
    );
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
      if (message.id !== undefined && pending) {
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        if (message.error)
          pending.reject(
            safeError(message.error.message ?? "Codex request failed"),
          );
        else pending.resolve(message.result);
      } else if (message.method) {
        const waiter = this.notificationWaiters.shift();
        if (waiter) waiter.resolve(message);
        else this.notifications.push(message);
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
  constructor({ store, executable = "codex", cwd = process.cwd() } = {}) {
    if (!store)
      throw new Error("CodexChat requires the Omni conversation store");
    this.store = store;
    this.executable = executable;
    this.cwd = cwd;
  }

  async listModels() {
    const server = await new CodexAppServer({
      executable: this.executable,
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

  async stream({ messages, conversationId, signal, onDelta }) {
    const server = await new CodexAppServer({
      executable: this.executable,
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
        });
        threadId = priorSession;
      } else {
        const started = await server.request("thread/start", {
          cwd: this.cwd,
          approvalPolicy: "on-request",
          sandbox: "read-only",
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
