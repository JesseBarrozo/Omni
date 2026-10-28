#!/usr/bin/env node
import { homedir } from "node:os";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { ChatStore } from "../src/chat-store.mjs";
import { OpenAIChat } from "../src/openai-chat.mjs";
import {
  CodexChat,
  codexAuthStatus,
  startCodexLogin,
} from "../src/codex-chat.mjs";
import {
  ClaudeCodeChat,
  ClaudeCodeHarness,
  claudeAuthStatus,
  startClaudeLogin,
} from "../src/claude-code.mjs";
import { runChatTurn } from "../src/chat-runner.mjs";
import { redactSecrets } from "../src/core.mjs";

const dataDir = process.env.OMNI_DATA_DIR || join(homedir(), ".omni");
const store = new ChatStore(join(dataDir, "omni.sqlite"));
const print = (value) =>
  stdout.write(
    `${typeof value === "string" ? value : JSON.stringify(value, null, 2)}\n`,
  );
const args = process.argv.slice(2);
const command = args.shift() || "help";
const option = (name, fallback = null) => {
  const index = args.indexOf(name);
  return index >= 0 ? (args[index + 1] ?? fallback) : fallback;
};
const hasFlag = (name) => args.includes(name);
const help = () =>
  print(
    `Omni Universal AI Harness\n\nCommands:\n  init\n  status [--json]\n  auth status\n  auth login codex|claude\n  project create --name NAME [--path PATH]\n  models list [--provider codex|claude]\n  chat --project ID_OR_PATH --model MODEL [--conversation ID]\n  run --project ID_OR_PATH [--model MODEL] [--harness claude] [--conversation ID] PROMPT\n  resume CONVERSATION_ID [--model MODEL]\n  conversation export CONVERSATION_ID\n  conversation import --project ID_OR_PATH FILE`,
  );

async function chat(conversation, model, initialPrompt = null) {
  const project = store.project(conversation.projectId);
  const provider =
    model === "codex"
      ? new CodexChat({ store, cwd: project.rootPath ?? process.cwd() })
      : model === "claude" || model.startsWith("claude:")
        ? new ClaudeCodeChat({
            store,
            cwd: project.rootPath ?? process.cwd(),
            model: model.startsWith("claude:")
              ? model.slice("claude:".length)
              : undefined,
          })
        : new OpenAIChat();
  const rl = createInterface({
    input: stdin,
    output: stdout,
    terminal: Boolean(stdin.isTTY),
  });
  let controller = null;
  const interrupt = () => controller?.abort();
  process.on("SIGINT", interrupt);
  rl.on("SIGINT", interrupt);
  const send = async (prompt) => {
    if (!prompt.trim()) return;
    controller = new AbortController();
    stdout.write("Omni: ");
    try {
      const result = await runChatTurn({
        store,
        model,
        provider,
        conversationId: conversation.id,
        prompt,
        signal: controller.signal,
        onDelta: (delta) => stdout.write(delta),
      });
      stdout.write(
        result.status === "interrupted"
          ? "\n[Réponse interrompue; le texte partiel est conservé.]\n"
          : "\n",
      );
    } catch (error) {
      throw error;
    } finally {
      controller = null;
    }
  };
  try {
    if (initialPrompt) {
      await send(initialPrompt);
      return;
    }
    while (true) {
      const prompt = await rl.question("Vous: ");
      if (["/quit", "/exit"].includes(prompt.trim())) break;
      await send(prompt);
    }
  } finally {
    process.off("SIGINT", interrupt);
    rl.off("SIGINT", interrupt);
    rl.close();
  }
}

async function runClaudeHarness(conversation, prompt) {
  const project = store.project(conversation.projectId);
  const rl = createInterface({
    input: stdin,
    output: stdout,
    terminal: Boolean(stdin.isTTY),
  });
  const adapter = new ClaudeCodeHarness({
    store,
    cwd: project.rootPath ?? process.cwd(),
    model:
      conversation.modelId === "claude"
        ? undefined
        : conversation.modelId.startsWith("claude:")
          ? conversation.modelId.slice("claude:".length)
          : conversation.modelId,
    requestPermission: async ({ toolName, input }, permissionSignal) => {
      if (!stdin.isTTY) {
        stdout.write(
          `Permission refusée (session non interactive): ${toolName}\n`,
        );
        return false;
      }
      return new Promise((resolve) => {
        if (permissionSignal?.aborted) return resolve(false);
        let settled = false;
        const finish = (allowed) => {
          if (settled) return;
          settled = true;
          resolve(allowed);
        };
        const onAbort = () => finish(false);
        permissionSignal?.addEventListener("abort", onAbort, { once: true });
        rl.question(
          `Claude demande ${toolName}: ${JSON.stringify(input)}\nAutoriser cette action une fois ? [y/N] `,
        )
          .then((answer) => {
            permissionSignal?.removeEventListener("abort", onAbort);
            finish(answer.trim().toLowerCase() === "y");
          })
          .catch(() => finish(false));
      });
    },
  });
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.on("SIGINT", interrupt);
  rl.on("SIGINT", interrupt);
  store.addMessage(conversation.id, "user", prompt);
  const assistantId = store.addMessage(
    conversation.id,
    "assistant",
    "",
    "streaming",
  );
  let answer = "";
  let interrupted = false;
  try {
    store.setStatus(conversation.id, "running");
    await adapter.initialize();
    const sessionId = store
      .listEvents(conversation.id)
      .filter(
        (event) =>
          event.type === "session.started" &&
          event.payload.harnessId === "claude-code",
      )
      .at(-1)?.payload.sessionId;
    for await (const event of adapter.run({
      conversationId: conversation.id,
      sessionId,
      prompt,
      signal: controller.signal,
    })) {
      if (event.type === "message.delta") {
        answer += event.payload.delta;
        store.appendMessageDelta(assistantId, event.payload.delta);
        stdout.write(event.payload.delta);
      } else if (event.type === "tool.started") {
        stdout.write(`\n[Outil ${event.payload.toolName}]\n`);
      } else if (event.type === "session.interrupted") {
        interrupted = true;
      } else if (event.type === "session.failed") {
        throw new Error(event.payload.error);
      }
    }
    store.setMessage(
      assistantId,
      answer,
      interrupted ? "interrupted" : "completed",
    );
    store.setStatus(conversation.id, interrupted ? "interrupted" : "completed");
    stdout.write(interrupted ? "\n[Exécution interrompue.]\n" : "\n");
  } catch (error) {
    store.setMessage(
      assistantId,
      answer,
      controller.signal.aborted ? "interrupted" : "failed",
    );
    store.setStatus(
      conversation.id,
      controller.signal.aborted ? "interrupted" : "failed",
    );
    throw error;
  } finally {
    process.off("SIGINT", interrupt);
    rl.off("SIGINT", interrupt);
    rl.close();
    await adapter.dispose();
  }
}

try {
  if (command === "help") help();
  else if (command === "init") print(`Initialisé: ${dataDir}`);
  else if (command === "status") {
    const status = { dataDir, ...store.count(), projects: store.projects() };
    hasFlag("--json")
      ? print(status)
      : print(
          `${status.projects.length} projets · ${status.conversations} conversations · ${status.messages} messages · ${dataDir}`,
        );
  } else if (command === "auth" && args[0] === "status") {
    const status = [codexAuthStatus(), claudeAuthStatus()];
    hasFlag("--json")
      ? print(status)
      : status.forEach(({ provider, authenticated }) =>
          print(`${provider}: ${authenticated ? "connecté" : "non connecté"}`),
        );
  } else if (command === "auth" && args[0] === "login" && args[1] === "codex") {
    const result = startCodexLogin();
    if (result.error)
      throw new Error("Impossible de lancer la connexion Codex");
    if (result.status !== 0)
      throw new Error("La connexion Codex a échoué ou a été annulée");
    print("Connexion Codex terminée.");
  } else if (
    command === "auth" &&
    args[0] === "login" &&
    args[1] === "claude"
  ) {
    const result = startClaudeLogin();
    if (result.error)
      throw new Error("Impossible de lancer la connexion Claude");
    if (result.status !== 0)
      throw new Error("La connexion Claude a échoué ou a été annulée");
    print("Connexion Claude terminée.");
  } else if (command === "project" && args[0] === "create") {
    const name = option("--name");
    if (!name) throw new Error("--name est requis");
    print(
      store.createProject(
        name,
        option("--path") ? resolve(option("--path")) : null,
      ),
    );
  } else if (command === "models" && args[0] === "list") {
    const providerName = option("--provider");
    const provider =
      providerName === "codex"
        ? new CodexChat({ store })
        : providerName === "claude" || providerName?.startsWith("claude:")
          ? new ClaudeCodeChat({
              store,
              model: providerName.startsWith("claude:")
                ? providerName.slice("claude:".length)
                : undefined,
            })
          : new OpenAIChat();
    for (const model of await provider.listModels()) print(model);
  } else if (command === "conversation" && args[0] === "export") {
    print(store.exportConversation(args[1]));
  } else if (command === "conversation" && args[0] === "import") {
    const project = store.project(option("--project") ?? "");
    const file = args.at(-1);
    if (!file || file === option("--project"))
      throw new Error(
        "Usage: omni conversation import --project ID_OR_PATH FILE",
      );
    const document = JSON.parse(readFileSync(resolve(file), "utf8"));
    print(store.importConversation(document, { projectId: project.id }));
  } else if (command === "chat" || command === "resume") {
    const existingId =
      command === "resume" ? args[0] : option("--conversation");
    let conversation = existingId
      ? store.recoverConversation(existingId)
      : null;
    const model = option("--model", conversation?.modelId ?? null);
    if (!model)
      throw new Error("--model est requis pour une nouvelle conversation");
    if (conversation) conversation = store.setModel(conversation.id, model);
    else
      conversation = store.createConversation(
        store.project(option("--project") ?? "").id,
        option("--title", "Nouvelle conversation"),
        model,
      );
    stdout.write(`Conversation ${conversation.id} · modèle ${model}\n`);
    await chat(conversation, model);
  } else if (command === "run") {
    const harness = option("--harness");
    if (harness && harness !== "claude")
      throw new Error(`Harness non pris en charge: ${harness}`);
    const conversationArg = option("--conversation");
    let conversation = conversationArg
      ? store.recoverConversation(conversationArg)
      : null;
    const defaultModel =
      harness === "claude"
        ? conversation?.modelId?.startsWith("claude")
          ? conversation.modelId
          : "claude"
        : (conversation?.modelId ?? null);
    const model = option("--model", defaultModel);
    const projectArg = option("--project");
    const project = conversation
      ? store.project(conversation.projectId)
      : store.project(projectArg ?? "");
    const consumedValueIndexes = [
      "--model",
      "--project",
      "--harness",
      "--conversation",
    ]
      .map((name) => args.indexOf(name) + 1)
      .filter((index) => index > 0);
    const prompt = args
      .filter(
        (a, index) =>
          !a.startsWith("--") && !consumedValueIndexes.includes(index),
      )
      .join(" ");
    if (!model || !prompt)
      throw new Error(
        "Usage: omni run --project ID_OR_PATH [--model MODEL] [--harness claude] PROMPT",
      );
    if (conversation) {
      conversation = store.setModel(conversation.id, model);
    } else {
      conversation = store.createConversation(
        project.id,
        prompt.slice(0, 80),
        model,
      );
    }
    if (harness === "claude") await runClaudeHarness(conversation, prompt);
    else await chat(conversation, model, prompt);
  } else help();
} catch (error) {
  let safe = redactSecrets(error.message);
  if (process.env.OPENAI_API_KEY)
    safe = safe.replaceAll(process.env.OPENAI_API_KEY, "[REDACTED]");
  safe = safe
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "[REDACTED]")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");
  process.stderr.write(`omni: ${safe}\n`);
  process.exitCode = 1;
} finally {
  store.close();
}
