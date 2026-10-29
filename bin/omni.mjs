#!/usr/bin/env node
import { homedir } from "node:os";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { ChatStore } from "../src/chat-store.mjs";
import { OpenAIChat } from "../src/openai-chat.mjs";
import {
  CodexHarness,
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
import { HarnessSwapService } from "../src/harness-swap.mjs";
import { AutoRouter, ModelRegistry, redactSecrets } from "../src/core.mjs";

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
    `Omni Universal AI Harness\n\nCommands:\n  init\n  status [--json]\n  auth status\n  auth login codex|claude\n  project create --name NAME [--path PATH]\n  models list [--provider codex|claude]\n  chat --project ID_OR_PATH --model MODEL [--conversation ID]\n  run --project ID_OR_PATH [--model MODEL] [--harness claude|codex|--auto] [--conversation ID] PROMPT\n  swap --conversation ID --harness claude|codex [--model MODEL]\n  resume CONVERSATION_ID [--model MODEL]\n  conversation export CONVERSATION_ID\n  conversation import --project ID_OR_PATH FILE`,
  );

async function autoRoute(prompt, project) {
  const registry = new ModelRegistry();
  const checkedProviders = [];
  const disabledProviders = new Set(
    (process.env.OMNI_DISABLED_PROVIDERS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const autoModelAllowlist = process.env.OMNI_AUTO_MODELS
    ? new Set(
        process.env.OMNI_AUTO_MODELS.split(",").map((value) => value.trim()),
      )
    : null;
  const addProvider = (providerId, models, harnessId, harnessName) => {
    const enabled = !disabledProviders.has(providerId);
    registry.registerProvider({ id: providerId, name: providerId, enabled });
    registry.registerHarness({
      id: harnessId,
      name: harnessName,
      enabled: true,
      available: true,
      providerIds: [providerId],
      capabilities: { tools: true },
      privacyApproved: false,
    });
    for (const modelId of models)
      registry.registerModel({
        id: modelId,
        providerId,
        name: modelId,
        available: true,
        enabled,
        enabledForAuto:
          !autoModelAllowlist ||
          autoModelAllowlist.has(`${providerId}:${modelId}`),
      });
    checkedProviders.push({
      providerId,
      authenticated: true,
      modelCount: models.length,
      enabled,
    });
  };

  if (codexAuthStatus().authenticated) {
    try {
      const models = await new CodexChat({
        store,
        cwd: project.rootPath ?? process.cwd(),
      }).listModels();
      if (models.length)
        addProvider("codex", models, "codex", "Codex app-server");
      else
        checkedProviders.push({
          providerId: "codex",
          authenticated: true,
          modelCount: 0,
        });
    } catch (error) {
      checkedProviders.push({
        providerId: "codex",
        authenticated: true,
        available: false,
        error: redactSecrets(error.message),
      });
    }
  } else checkedProviders.push({ providerId: "codex", authenticated: false });

  if (claudeAuthStatus().authenticated) {
    try {
      const models = await new ClaudeCodeChat({
        store,
        cwd: project.rootPath ?? process.cwd(),
      }).listModels();
      if (models.length)
        addProvider("claude", models, "claude-code", "Claude Code Agent SDK");
      else
        checkedProviders.push({
          providerId: "claude",
          authenticated: true,
          modelCount: 0,
        });
    } catch (error) {
      checkedProviders.push({
        providerId: "claude",
        authenticated: true,
        available: false,
        error: redactSecrets(error.message),
      });
    }
  } else checkedProviders.push({ providerId: "claude", authenticated: false });

  const previousResults = {};
  for (const event of store.routingResults(200)) {
    const { candidateKey, outcome, latencyMs } = event.payload;
    if (!candidateKey) continue;
    const result = (previousResults[candidateKey] ??= {
      attempts: 0,
      successes: 0,
      latencyTotalMs: 0,
      latencySamples: 0,
    });
    result.attempts += 1;
    if (outcome === "completed") result.successes += 1;
    if (Number.isFinite(latencyMs)) {
      result.latencyTotalMs += latencyMs;
      result.latencySamples += 1;
      result.averageLatencyMs = result.latencyTotalMs / result.latencySamples;
    }
  }
  const maxInputPerMillion = process.env.OMNI_AUTO_MAX_INPUT_PER_MILLION
    ? Number(process.env.OMNI_AUTO_MAX_INPUT_PER_MILLION)
    : null;
  if (maxInputPerMillion !== null && !Number.isFinite(maxInputPerMillion))
    throw new Error("OMNI_AUTO_MAX_INPUT_PER_MILLION doit être un nombre");
  const privacyMode = process.env.OMNI_AUTO_PRIVACY === "strict";
  const router = new AutoRouter(registry, {
    profile: process.env.OMNI_AUTO_PROFILE ?? "balance",
    preferredProviders: (process.env.OMNI_AUTO_PREFERRED_PROVIDERS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    excludedProviders: [...disabledProviders],
    maxInputPerMillion,
    privacyMode,
    previousResults,
  });
  const decision = router.select({ prompt, needsTools: true });
  return { ...decision, checkedProviders };
}

function permissionPrompt(rl, provider) {
  return async (request, signal) => {
    if (!stdin.isTTY) {
      stdout.write(
        `Permission ${provider} refusée (session non interactive).\n`,
      );
      return false;
    }
    if (signal?.aborted) return false;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (allowed) => {
        if (settled) return;
        settled = true;
        resolve(allowed);
      };
      const onAbort = () => finish(false);
      signal?.addEventListener("abort", onAbort, { once: true });
      rl.question(
        `${provider} demande une permission: ${JSON.stringify(request)}\nAutoriser cette action une fois ? [y/N] `,
      )
        .then((answer) => {
          signal?.removeEventListener("abort", onAbort);
          finish(answer.trim().toLowerCase() === "y");
        })
        .catch(() => finish(false));
    });
  };
}

function createHarnessRun(harnessId, conversation, modelId) {
  const project = store.project(conversation.projectId);
  const rl = createInterface({
    input: stdin,
    output: stdout,
    terminal: Boolean(stdin.isTTY),
  });
  const requestPermission = permissionPrompt(rl, harnessId);
  const adapter =
    harnessId === "claude-code"
      ? new ClaudeCodeHarness({
          store,
          cwd: project.rootPath ?? process.cwd(),
          model: modelId?.startsWith("claude:")
            ? modelId.slice("claude:".length)
            : modelId === "claude"
              ? undefined
              : modelId,
          requestPermission,
        })
      : harnessId === "codex"
        ? new CodexHarness({
            store,
            executable: process.env.OMNI_CODEX_HARNESS_EXECUTABLE ?? "codex",
            cwd: project.rootPath ?? process.cwd(),
            model: modelId === "codex" ? undefined : modelId,
            requestPermission,
          })
        : null;
  if (!adapter) {
    rl.close();
    throw new Error(`Harness Auto non pris en charge: ${harnessId}`);
  }
  return { adapter, rl };
}

async function prepareAutoCandidate(decision, conversation) {
  const failures = [];
  const checkedHarnesses = new Set();
  for (const candidate of decision.candidates) {
    if (checkedHarnesses.has(candidate.harnessId)) continue;
    checkedHarnesses.add(candidate.harnessId);
    const modelId =
      candidate.providerId === "claude"
        ? `claude:${candidate.modelId}`
        : candidate.modelId;
    const run = createHarnessRun(candidate.harnessId, conversation, modelId);
    try {
      await run.adapter.initialize();
      return { candidate, run, failures };
    } catch (error) {
      failures.push({
        candidate,
        error: redactSecrets(error.message),
      });
      try {
        await run.adapter.dispose();
      } catch {}
      run.rl.close();
    }
  }
  const error = new Error(
    `Aucun candidat Auto n’a passé le préflight avant le démarrage du tour (${failures.map((failure) => failure.error).join("; ")})`,
  );
  error.preflightFailures = failures;
  throw error;
}

async function swapHarness(conversationId, harnessId, requestedModel) {
  if (!conversationId || !["claude", "codex"].includes(harnessId))
    throw new Error(
      "Usage: omni swap --conversation ID --harness claude|codex [--model MODEL]",
    );
  const conversation = store.conversation(conversationId);
  const project = store.project(conversation.projectId);
  const rl = createInterface({
    input: stdin,
    output: stdout,
    terminal: Boolean(stdin.isTTY),
  });
  const model =
    requestedModel ??
    (harnessId === "claude"
      ? conversation.modelId?.startsWith("claude")
        ? conversation.modelId
        : "claude"
      : "codex");
  const requestPermission = permissionPrompt(rl, harnessId);
  const adapter =
    harnessId === "claude"
      ? new ClaudeCodeHarness({
          store,
          cwd: project.rootPath ?? process.cwd(),
          model: model === "claude" ? undefined : model.replace(/^claude:/, ""),
          requestPermission,
        })
      : new CodexHarness({
          store,
          cwd: project.rootPath ?? process.cwd(),
          model: model === "codex" ? undefined : model,
          requestPermission,
        });
  try {
    const service = new HarnessSwapService({
      store,
      adapters: new Map([[adapter.id, adapter]]),
    });
    const result = await service.swap({
      conversationId,
      toHarnessId: adapter.id,
      model,
    });
    print({
      conversationId,
      harnessId: adapter.id,
      sessionId: result.session.id,
      checkpointId: result.checkpoint.id,
      git: result.summary.git,
      resumeContextAttached: true,
    });
  } finally {
    rl.close();
    await adapter.dispose();
  }
}

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

async function runClaudeHarness(conversation, prompt, preparedRun = null) {
  const { adapter, rl } =
    preparedRun ??
    createHarnessRun("claude-code", conversation, conversation.modelId);
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
    const sessionRef = store
      .listEvents(conversation.id)
      .filter(
        (event) =>
          (event.type === "session.started" &&
            event.payload.harnessId === "claude-code") ||
          (event.type === "harness.changed" &&
            event.payload.toHarnessId === "claude-code"),
      )
      .at(-1);
    const sessionId =
      sessionRef?.payload.sessionId ?? sessionRef?.payload.targetSessionId;
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

async function runCodexHarness(conversation, prompt, preparedRun = null) {
  const project = store.project(conversation.projectId);
  const { adapter, rl } =
    preparedRun ??
    createHarnessRun("codex", conversation, conversation.modelId);
  const model =
    conversation.modelId === "codex" ? undefined : conversation.modelId;
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
  let completed = false;
  try {
    store.setStatus(conversation.id, "running");
    await adapter.initialize();
    const sessionRef = store
      .listEvents(conversation.id)
      .filter(
        (event) =>
          (event.type === "session.started" &&
            event.payload.harnessId === "codex") ||
          (event.type === "harness.changed" &&
            event.payload.toHarnessId === "codex"),
      )
      .at(-1);
    const sessionId =
      sessionRef?.payload.sessionId ?? sessionRef?.payload.targetSessionId;
    const session = sessionId
      ? await adapter.resumeSession(sessionId, {
          conversationId: conversation.id,
          cwd: project.rootPath ?? process.cwd(),
          model,
        })
      : await adapter.createSession({
          conversationId: conversation.id,
          cwd: project.rootPath ?? process.cwd(),
          model,
        });
    for await (const event of adapter.run({
      conversationId: conversation.id,
      sessionId: session.id,
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
      } else if (event.type === "message.completed") {
        completed = true;
      }
    }
    if (!interrupted && !completed)
      throw new Error("Codex a terminé sans confirmer le tour");
    const checkpoint = await adapter.checkpoint(session.id);
    if (checkpoint) stdout.write(`\nCheckpoint Codex: ${checkpoint.id}\n`);
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
    let harness = option("--harness");
    const autoMode = hasFlag("--auto");
    if (harness && !["claude", "codex"].includes(harness))
      throw new Error(`Harness non pris en charge: ${harness}`);
    if (autoMode && (harness || option("--model")))
      throw new Error("--auto choisit seul le modèle et le harness");
    const conversationArg = option("--conversation");
    let conversation = conversationArg
      ? store.recoverConversation(conversationArg)
      : null;
    const defaultModel =
      harness === "claude"
        ? conversation?.modelId?.startsWith("claude")
          ? conversation.modelId
          : "claude"
        : harness === "codex"
          ? (conversation?.modelId ?? "codex")
          : (conversation?.modelId ?? null);
    let model = option("--model", defaultModel);
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
    if ((!autoMode && !model) || !prompt)
      throw new Error(
        "Usage: omni run --project ID_OR_PATH [--model MODEL] [--harness claude|codex|--auto] PROMPT",
      );
    let autoDecision = null;
    if (autoMode) {
      autoDecision = await autoRoute(prompt, project);
      const selected = autoDecision.selected;
      harness = selected.harnessId === "claude-code" ? "claude" : "codex";
      model =
        selected.providerId === "claude"
          ? `claude:${selected.modelId}`
          : selected.modelId;
    }
    if (conversation) {
      conversation = store.setModel(conversation.id, model);
    } else {
      conversation = store.createConversation(
        project.id,
        autoDecision
          ? `Auto · ${autoDecision.selected.providerId}/${autoDecision.selected.modelId}`
          : prompt.slice(0, 80),
        model,
      );
    }
    if (autoDecision) {
      store.appendEvent(conversation.id, "routing.decision", {
        ...autoDecision,
      });
    }
    const routingStartedAt = Date.now();
    let executionCandidate = autoDecision?.selected ?? null;
    try {
      let preparedRun = null;
      if (autoDecision) {
        const prepared = await prepareAutoCandidate(autoDecision, conversation);
        executionCandidate = prepared.candidate;
        preparedRun = prepared.run;
        const usedFallback =
          prepared.candidate.providerId !== autoDecision.selected.providerId ||
          prepared.candidate.modelId !== autoDecision.selected.modelId ||
          prepared.candidate.harnessId !== autoDecision.selected.harnessId;
        if (usedFallback) {
          const from = autoDecision.selected;
          const to = prepared.candidate;
          model =
            to.providerId === "claude" ? `claude:${to.modelId}` : to.modelId;
          harness = to.harnessId === "claude-code" ? "claude" : "codex";
          conversation = store.setModel(conversation.id, model);
          store.appendEvent(conversation.id, "routing.fallback", {
            decisionId: autoDecision.id,
            from,
            to,
            reason: "selected-harness-preflight-failed-before-turn-start",
            failures: prepared.failures,
            promptPersisted: false,
            taskStarted: false,
            automaticallyRetried: false,
          });
          print(
            `Auto: préflight ${from.providerId}/${from.modelId} indisponible; choix de secours ${to.providerId}/${to.modelId} avant le démarrage du tour.`,
          );
        } else {
          print(
            `Auto: ${autoDecision.explanation} · secours ${autoDecision.fallback ? `${autoDecision.fallback.providerId}/${autoDecision.fallback.modelId}` : "aucun"}`,
          );
        }
      }
      if (harness === "claude")
        await runClaudeHarness(conversation, prompt, preparedRun);
      else if (harness === "codex")
        await runCodexHarness(conversation, prompt, preparedRun);
      else await chat(conversation, model, prompt);
      if (autoDecision)
        store.appendEvent(conversation.id, "routing.result", {
          decisionId: autoDecision.id,
          candidateKey: `${executionCandidate.providerId}/${executionCandidate.modelId}/${executionCandidate.harnessId}`,
          providerId: executionCandidate.providerId,
          modelId: executionCandidate.modelId,
          harnessId: executionCandidate.harnessId,
          outcome: "completed",
          latencyMs: Date.now() - routingStartedAt,
        });
    } catch (error) {
      if (autoDecision)
        store.appendEvent(conversation.id, "routing.result", {
          decisionId: autoDecision.id,
          candidateKey: `${executionCandidate.providerId}/${executionCandidate.modelId}/${executionCandidate.harnessId}`,
          providerId: executionCandidate.providerId,
          modelId: executionCandidate.modelId,
          harnessId: executionCandidate.harnessId,
          outcome: "failed",
          latencyMs: Date.now() - routingStartedAt,
          error: redactSecrets(error.message),
          preflightFailures: error.preflightFailures ?? [],
          automaticallyRetried: false,
        });
      throw error;
    }
  } else if (command === "swap") {
    await swapHarness(
      option("--conversation"),
      option("--harness"),
      option("--model"),
    );
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
