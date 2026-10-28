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
import { runChatTurn } from "../src/chat-runner.mjs";

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
    `Omni Universal AI Harness\n\nCommands:\n  init\n  status [--json]\n  auth status\n  auth login codex\n  project create --name NAME [--path PATH]\n  models list [--provider codex]\n  chat --project ID_OR_PATH --model MODEL [--conversation ID]\n  run --project ID_OR_PATH --model MODEL PROMPT\n  resume CONVERSATION_ID [--model MODEL]\n  conversation export CONVERSATION_ID\n  conversation import --project ID_OR_PATH FILE`,
  );

async function chat(conversation, model, initialPrompt = null) {
  const provider =
    model === "codex" ? new CodexChat({ store }) : new OpenAIChat();
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
    const status = [codexAuthStatus()];
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
    const provider =
      option("--provider") === "codex"
        ? new CodexChat({ store })
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
    const model = option("--model");
    const projectArg = option("--project");
    const project = store.project(projectArg ?? "");
    const prompt = args
      .filter((a) => !a.startsWith("--") && a !== model && a !== projectArg)
      .join(" ");
    if (!model || !prompt)
      throw new Error(
        "Usage: omni run --project ID_OR_PATH --model MODEL PROMPT",
      );
    const conversation = store.createConversation(
      project.id,
      prompt.slice(0, 80),
      model,
    );
    await chat(conversation, model, prompt);
  } else help();
} catch (error) {
  let safe = error.message;
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
