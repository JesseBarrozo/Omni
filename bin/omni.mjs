#!/usr/bin/env node
import { homedir } from "node:os";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { ChatStore } from "../src/chat-store.mjs";
import { serializeJsonLine } from "../src/cli-output.mjs";
import { OpenAIChat } from "../src/openai-chat.mjs";
import { OpenAIAuth } from "../src/openai-auth.mjs";
import {
  AntigravityCliChat,
  antigravityCliStatus,
  startAntigravityLogin,
} from "../src/antigravity-cli.mjs";
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
const openAIAuth = () => new OpenAIAuth({ dataDir });
const createOpenAIChat = () => {
  const auth = openAIAuth();
  return auth.hasCredentials()
    ? new OpenAIChat({ oauth: auth })
    : new OpenAIChat();
};
const print = (value) =>
  stdout.write(
    `${typeof value === "string" ? value : JSON.stringify(value, null, 2)}\n`,
  );
const args = process.argv.slice(2);
const command = args.shift() || "help";
let jsonRunOutput = false;
const option = (name, fallback = null) => {
  const index = args.indexOf(name);
  return index >= 0 ? (args[index + 1] ?? fallback) : fallback;
};
const hasFlag = (name) => args.includes(name);
const writeRunEvent = (type, payload = {}) =>
  stdout.write(`${serializeJsonLine(type, payload)}\n`);
const emitRunEvent = (type, payload = {}) => {
  if (jsonRunOutput) writeRunEvent(type, payload);
};
const help = () =>
  print(
    `Omni Universal AI Harness\n\nCommands:\n  init\n  status [--json]\n  auth status\n  auth login openai|codex|claude|antigravity\n  providers list [--json]\n  providers refresh [--provider codex|claude|openai|antigravity] [--json]\n  providers enable|disable --provider ID\n  harnesses list [--json]\n  harnesses refresh [--harness codex|claude-code] [--json]\n  harnesses enable|disable --harness ID\n  tools list --conversation ID|--project ID_OR_PATH [--json]\n  permissions list --conversation ID|--project ID_OR_PATH [--json]\n  project create --name NAME [--path PATH]\n  models list [--provider codex|claude|openai|antigravity] [--json]\n  models enable|disable --provider ID --model ID [--auto-only]\n  chat --project ID_OR_PATH --model MODEL [--conversation ID]\n  run --project ID_OR_PATH [--model MODEL] [--harness claude|codex|--auto] [--conversation ID] [--json] PROMPT\n  swap --conversation ID --harness claude|codex [--model MODEL]\n  resume CONVERSATION_ID [--model MODEL]\n  conversation search --query TEXT [--project ID_OR_PATH] [--json]\n  conversation export CONVERSATION_ID\n  conversation import --project ID_OR_PATH FILE`,
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
  const addProvider = (
    providerId,
    models,
    harnessId,
    harnessName,
    chatHarnessId,
  ) => {
    store.saveProviderCatalog({
      providerId,
      name: providerId,
      authStatus: "connected",
      models,
    });
    const storedProvider = store
      .providerRegistry()
      .find((entry) => entry.id === providerId);
    const storedModels = new Map(
      store.modelRegistry(providerId).map((entry) => [entry.id, entry]),
    );
    const storedHarnesses = new Map(
      store.harnessRegistry().map((entry) => [entry.id, entry]),
    );
    const enabled =
      storedProvider.enabled && !disabledProviders.has(providerId);
    registry.registerProvider({ id: providerId, name: providerId, enabled });
    for (const harness of [
      {
        id: harnessId,
        name: harnessName,
        tools: true,
      },
      {
        id: chatHarnessId,
        name:
          providerId === "codex"
            ? "Codex chat (sandbox lecture seule)"
            : "Claude chat (sans outils)",
        tools: providerId === "codex" ? "read-only" : false,
      },
    ])
      registry.registerHarness({
        id: harness.id,
        name: harness.name,
        enabled: true,
        available: true,
        providerIds: [providerId],
        capabilities: { tools: harness.tools },
        privacyApproved: false,
        ...(storedHarnesses.has(harness.id)
          ? { enabled: storedHarnesses.get(harness.id).enabled }
          : {}),
      });
    for (const modelId of models)
      registry.registerModel({
        id: modelId,
        providerId,
        name: modelId,
        available: true,
        enabled: storedModels.get(modelId)?.enabled ?? true,
        enabledForAuto:
          (storedModels.get(modelId)?.enabledForAuto ?? true) &&
          (!autoModelAllowlist ||
            autoModelAllowlist.has(`${providerId}:${modelId}`)),
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
        addProvider("codex", models, "codex", "Codex app-server", "codex-chat");
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
        addProvider(
          "claude",
          models,
          "claude-code",
          "Claude Code Agent SDK",
          "claude-chat",
        );
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

  if (process.env.OPENAI_API_KEY || openAIAuth().hasCredentials()) {
    try {
      const models = await createOpenAIChat().listModels();
      if (models.length)
        addProvider(
          "openai",
          models,
          "openai-chat",
          "OpenAI Responses API",
          "openai-chat",
        );
      checkedProviders.push({
        providerId: "openai",
        authenticated: true,
        modelCount: models.length,
      });
    } catch (error) {
      checkedProviders.push({
        providerId: "openai",
        authenticated: true,
        available: false,
        error: redactSecrets(error.message),
      });
    }
  } else checkedProviders.push({ providerId: "openai", authenticated: false });

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
  const decision = router.select({ prompt });
  return { ...decision, checkedProviders };
}

function permissionPrompt(rl, provider) {
  return async (request, signal) => {
    emitRunEvent("permission.requested", {
      provider,
      toolName: request.toolName ?? "tool",
      scope: "once",
    });
    if (!stdin.isTTY) {
      if (jsonRunOutput)
        writeRunEvent("permission.denied", {
          provider,
          reason: "non-interactive-session",
        });
      else
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
          const granted = answer.trim().toLowerCase() === "y";
          emitRunEvent(granted ? "permission.granted" : "permission.denied", {
            provider,
            toolName: request.toolName ?? "tool",
            scope: "once",
          });
          finish(granted);
        })
        .catch(() => finish(false));
    });
  };
}

function createHarnessRun(harnessId, conversation, modelId) {
  const project = store.project(conversation.projectId);
  const rl = createInterface({
    input: stdin,
    output: jsonRunOutput ? process.stderr : stdout,
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

function createAutoChatProvider(candidate, conversation) {
  const project = store.project(conversation.projectId);
  const cwd = project.rootPath ?? process.cwd();
  if (candidate.providerId === "claude")
    return new ClaudeCodeChat({
      store,
      cwd,
      model: candidate.modelId,
    });
  if (candidate.providerId === "codex")
    return new CodexChat({ store, cwd, model: candidate.modelId });
  if (candidate.providerId === "openai") return createOpenAIChat();
  throw new Error(
    `Fournisseur de chat Auto non pris en charge: ${candidate.providerId}`,
  );
}

async function refreshProvider(providerId) {
  let name = providerId;
  let authenticated = false;
  let provider;
  if (providerId === "codex") {
    name = "Codex OAuth";
    authenticated = codexAuthStatus().authenticated;
    if (authenticated) provider = new CodexChat({ store });
  } else if (providerId === "claude") {
    name = "Claude Code OAuth";
    authenticated = claudeAuthStatus().authenticated;
    if (authenticated) provider = new ClaudeCodeChat({ store });
  } else if (providerId === "openai") {
    const auth = openAIAuth();
    const oauthConnected = auth.hasCredentials();
    name = oauthConnected ? "OpenAI ChatGPT OAuth" : "OpenAI API key";
    authenticated = oauthConnected || Boolean(process.env.OPENAI_API_KEY);
    if (authenticated)
      provider = oauthConnected
        ? new OpenAIChat({ oauth: auth })
        : new OpenAIChat();
  } else if (providerId === "antigravity") {
    name = "Google Antigravity CLI OAuth";
    authenticated = antigravityCliStatus().cliInstalled;
    if (authenticated) provider = new AntigravityCliChat({ store, dataDir });
  } else throw new Error(`Fournisseur non pris en charge: ${providerId}`);
  if (!authenticated) {
    store.saveProviderCatalog({
      providerId,
      name,
      authStatus: "disconnected",
      models: [],
    });
    return { providerId, name, authStatus: "disconnected", modelCount: 0 };
  }
  try {
    const models = await provider.listModels();
    store.saveProviderCatalog({
      providerId,
      name,
      authStatus: "connected",
      models,
    });
    return {
      providerId,
      name,
      authStatus: "connected",
      modelCount: models.length,
    };
  } catch (error) {
    store.saveProviderCatalog({
      providerId,
      name,
      authStatus: "unavailable",
      models: [],
    });
    return {
      providerId,
      name,
      authStatus: "unavailable",
      modelCount: 0,
      error: redactSecrets(error.message),
    };
  }
}

function assertManualSelectionEnabled(modelId, harness = null) {
  const providerId =
    harness ??
    (modelId === "codex" || modelId.startsWith("codex:")
      ? "codex"
      : modelId === "claude" || modelId.startsWith("claude:")
        ? "claude"
        : modelId.startsWith("antigravity:")
          ? "antigravity"
          : "openai");
  const provider = store
    .providerRegistry()
    .find((entry) => entry.id === providerId);
  if (provider && !provider.enabled)
    throw new Error(`Fournisseur désactivé: ${providerId}`);
  const modelName = modelId.includes(":")
    ? modelId.slice(modelId.indexOf(":") + 1)
    : modelId;
  if (modelName === providerId) return;
  const registered = store
    .modelRegistry(providerId)
    .find((model) => model.id === modelName);
  if (providerId === "antigravity" && !registered)
    throw new Error(
      "Modèle Antigravity absent du catalogue Omni; lancez `omni models list --provider antigravity`",
    );
  if (registered && (!registered.enabled || !registered.available))
    throw new Error(
      `Modèle désactivé ou indisponible: ${providerId}/${modelName}`,
    );
}

function assertHarnessEnabled(harnessId) {
  const registered = store
    .harnessRegistry()
    .find((harness) => harness.id === harnessId);
  if (registered && !registered.enabled)
    throw new Error(`Harness désactivé: ${harnessId}`);
}

async function refreshHarness(harnessId) {
  let adapter;
  let providerId;
  let integration;
  let authenticated;
  if (harnessId === "codex") {
    providerId = "codex";
    integration = "Codex app-server JSON-RPC";
    authenticated = codexAuthStatus().authenticated;
    adapter = new CodexHarness({ store });
  } else if (harnessId === "claude-code") {
    providerId = "claude";
    integration = "Claude Agent SDK";
    authenticated = claudeAuthStatus().authenticated;
    adapter = new ClaudeCodeHarness({ store });
  } else throw new Error(`Harness non pris en charge: ${harnessId}`);
  const capabilities = await adapter.capabilities();
  let status = authenticated ? "unavailable" : "disconnected";
  let available = false;
  try {
    if (authenticated) {
      await adapter.initialize();
      status = "connected";
      available = true;
    }
  } catch {
    status = "unavailable";
  } finally {
    await adapter.dispose().catch(() => {});
  }
  return store.saveHarnessRegistry({
    id: adapter.id,
    name: adapter.name,
    providerId,
    integration,
    status,
    available,
    capabilities,
  });
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
    if (candidate.harnessId.endsWith("-chat")) {
      try {
        const provider = createAutoChatProvider(candidate, conversation);
        const models = await provider.listModels();
        if (!models.includes(candidate.modelId))
          throw new Error(
            `Modèle Auto indisponible au préflight: ${candidate.modelId}`,
          );
        return { candidate, run: { provider }, failures };
      } catch (error) {
        failures.push({
          candidate,
          error: redactSecrets(error.message),
        });
        continue;
      }
    }
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
  assertHarnessEnabled(harnessId === "claude" ? "claude-code" : "codex");
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
  assertManualSelectionEnabled(model, harnessId);
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

async function chat(
  conversation,
  model,
  initialPrompt = null,
  preparedProvider = null,
) {
  const project = store.project(conversation.projectId);
  const provider =
    preparedProvider ??
    (model === "codex"
      ? new CodexChat({ store, cwd: project.rootPath ?? process.cwd() })
      : model.startsWith("codex:")
        ? new CodexChat({
            store,
            cwd: project.rootPath ?? process.cwd(),
            model: model.slice("codex:".length),
          })
        : model === "claude" || model.startsWith("claude:")
          ? new ClaudeCodeChat({
              store,
              cwd: project.rootPath ?? process.cwd(),
              model: model.startsWith("claude:")
                ? model.slice("claude:".length)
                : undefined,
            })
          : model.startsWith("antigravity:")
            ? new AntigravityCliChat({
                store,
                dataDir,
                model: model.slice("antigravity:".length),
              })
            : createOpenAIChat());
  const rl = createInterface({
    input: stdin,
    output: jsonRunOutput ? process.stderr : stdout,
    terminal: Boolean(stdin.isTTY),
  });
  let controller = null;
  const interrupt = () => controller?.abort();
  process.on("SIGINT", interrupt);
  rl.on("SIGINT", interrupt);
  const send = async (prompt) => {
    if (!prompt.trim()) return;
    controller = new AbortController();
    if (!jsonRunOutput) stdout.write("Omni: ");
    try {
      const result = await runChatTurn({
        store,
        model,
        provider,
        conversationId: conversation.id,
        prompt,
        signal: controller.signal,
        onDelta: (delta) => {
          if (jsonRunOutput) writeRunEvent("message.delta", { delta });
          else stdout.write(delta);
        },
      });
      if (!initialPrompt || !jsonRunOutput)
        stdout.write(
          result.status === "interrupted"
            ? "\n[Réponse interrompue; le texte partiel est conservé.]\n"
            : "\n",
        );
      return result.status;
    } catch (error) {
      throw error;
    } finally {
      controller = null;
    }
  };
  try {
    if (initialPrompt) {
      return await send(initialPrompt);
    }
    if (!stdin.isTTY)
      throw new Error("La conversation interactive nécessite un terminal TTY");
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
        if (jsonRunOutput)
          writeRunEvent("message.delta", { delta: event.payload.delta });
        else stdout.write(event.payload.delta);
      } else if (event.type === "tool.started") {
        if (jsonRunOutput)
          writeRunEvent("tool.started", { toolName: event.payload.toolName });
        else stdout.write(`\n[Outil ${event.payload.toolName}]\n`);
      } else if (event.type === "tool.completed") {
        emitRunEvent("tool.completed", { toolName: event.payload.toolName });
      } else if (event.type === "tool.failed") {
        emitRunEvent("tool.failed", { toolName: event.payload.toolName });
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
    if (!jsonRunOutput)
      stdout.write(interrupted ? "\n[Exécution interrompue.]\n" : "\n");
    return interrupted ? "interrupted" : "completed";
  } catch (error) {
    const wasInterrupted = controller.signal.aborted;
    store.setMessage(
      assistantId,
      answer,
      wasInterrupted ? "interrupted" : "failed",
    );
    store.setStatus(conversation.id, wasInterrupted ? "interrupted" : "failed");
    if (wasInterrupted) return "interrupted";
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
        if (jsonRunOutput)
          writeRunEvent("message.delta", { delta: event.payload.delta });
        else stdout.write(event.payload.delta);
      } else if (event.type === "tool.started") {
        if (jsonRunOutput)
          writeRunEvent("tool.started", { toolName: event.payload.toolName });
        else stdout.write(`\n[Outil ${event.payload.toolName}]\n`);
      } else if (event.type === "tool.completed") {
        emitRunEvent("tool.completed", { toolName: event.payload.toolName });
      } else if (event.type === "tool.failed") {
        emitRunEvent("tool.failed", { toolName: event.payload.toolName });
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
    if (checkpoint) {
      if (jsonRunOutput)
        emitRunEvent("session.checkpointed", { checkpointId: checkpoint.id });
      else stdout.write(`\nCheckpoint Codex: ${checkpoint.id}\n`);
    }
    store.setMessage(
      assistantId,
      answer,
      interrupted ? "interrupted" : "completed",
    );
    store.setStatus(conversation.id, interrupted ? "interrupted" : "completed");
    if (!jsonRunOutput)
      stdout.write(interrupted ? "\n[Exécution interrompue.]\n" : "\n");
    return interrupted ? "interrupted" : "completed";
  } catch (error) {
    const wasInterrupted = controller.signal.aborted;
    store.setMessage(
      assistantId,
      answer,
      wasInterrupted ? "interrupted" : "failed",
    );
    store.setStatus(conversation.id, wasInterrupted ? "interrupted" : "failed");
    if (wasInterrupted) return "interrupted";
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
    const oauthConnected = openAIAuth().hasCredentials();
    const status = [
      codexAuthStatus(),
      claudeAuthStatus(),
      {
        provider: "openai",
        authenticated: oauthConnected || Boolean(process.env.OPENAI_API_KEY),
        source: oauthConnected
          ? "chatgpt-oauth"
          : process.env.OPENAI_API_KEY
            ? "api-key"
            : null,
      },
      antigravityCliStatus(),
    ];
    hasFlag("--json")
      ? print(status)
      : status.forEach(({ provider, authenticated, cliInstalled }) =>
          print(
            `${provider}: ${authenticated === null ? (cliInstalled ? "CLI présent; compte non vérifié" : "CLI absent") : authenticated ? "connecté" : "non connecté"}`,
          ),
        );
  } else if (
    command === "auth" &&
    args[0] === "login" &&
    args[1] === "openai"
  ) {
    await openAIAuth().login();
    print(
      "Connexion ChatGPT OpenAI vérifiée et enregistrée dans le trousseau système.",
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
  } else if (
    command === "auth" &&
    args[0] === "login" &&
    args[1] === "antigravity"
  ) {
    const result = startAntigravityLogin();
    if (result.error) throw new Error("Impossible de lancer Antigravity CLI");
    if (result.status !== 0)
      throw new Error("La connexion Antigravity a échoué ou a été annulée");
    print(
      "Antigravity CLI fermé. Validez le compte avec `omni providers refresh --provider antigravity`.",
    );
  } else if (command === "providers" && args[0] === "list") {
    const result = store.providerRegistry();
    hasFlag("--json")
      ? print(result)
      : result.forEach((provider) =>
          print(
            `${provider.id}: ${provider.authStatus}, ${provider.enabled ? "activé" : "désactivé"}, ${provider.modelCount} modèles`,
          ),
        );
  } else if (command === "providers" && args[0] === "refresh") {
    const requested = option("--provider");
    const providers = requested
      ? [requested]
      : ["codex", "claude", "openai", "antigravity"];
    const results = await Promise.all(providers.map(refreshProvider));
    hasFlag("--json")
      ? print(results)
      : results.forEach((result) =>
          print(
            `${result.providerId}: ${result.authStatus}, ${result.modelCount} modèles${result.error ? ` · ${result.error}` : ""}`,
          ),
        );
  } else if (
    command === "providers" &&
    ["enable", "disable"].includes(args[0])
  ) {
    const result = store.setProviderEnabled(
      option("--provider"),
      args[0] === "enable",
    );
    print(result);
  } else if (command === "harnesses" && args[0] === "list") {
    const result = store.harnessRegistry();
    hasFlag("--json")
      ? print(result)
      : result.forEach((harness) =>
          print(
            `${harness.id}: ${harness.status}, ${harness.enabled ? "activé" : "désactivé"}, ${harness.integration}`,
          ),
        );
  } else if (command === "harnesses" && args[0] === "refresh") {
    const requested = option("--harness");
    const harnesses = requested ? [requested] : ["codex", "claude-code"];
    const results = await Promise.all(harnesses.map(refreshHarness));
    hasFlag("--json")
      ? print(results)
      : results.forEach((harness) =>
          print(
            `${harness.id}: ${harness.status}, ${harness.available ? "disponible" : "indisponible"}`,
          ),
        );
  } else if (
    command === "harnesses" &&
    ["enable", "disable"].includes(args[0])
  ) {
    print(store.setHarnessEnabled(option("--harness"), args[0] === "enable"));
  } else if (["tools", "permissions"].includes(command) && args[0] === "list") {
    const kind = command;
    const events = store.executionEvents(kind, {
      conversationId: option("--conversation"),
      projectId: option("--project"),
    });
    const history = events.map((event) => {
      const payload = event.payload;
      return kind === "tools"
        ? {
            id: event.id,
            conversationId: event.conversationId,
            event: event.type,
            toolName:
              payload.toolName ??
              payload.method ??
              payload.itemType ??
              "unknown",
            harnessId: payload.harnessId ?? null,
            sessionId: payload.sessionId ?? null,
            toolUseId: payload.toolUseId ?? null,
            createdAt: event.createdAt,
          }
        : {
            id: event.id,
            conversationId: event.conversationId,
            event: event.type,
            toolName: payload.toolName ?? payload.tool ?? null,
            action: payload.action ?? payload.method ?? null,
            granted:
              event.type === "permission.granted"
                ? true
                : event.type === "permission.denied"
                  ? false
                  : null,
            reason: payload.reason ?? null,
            scope: payload.scope ?? null,
            requestId: payload.id ?? payload.requestId ?? null,
            expiresAt: payload.expiresAt ?? null,
            createdAt: event.createdAt,
          };
    });
    hasFlag("--json")
      ? print(history)
      : history.forEach((entry) =>
          print(
            kind === "tools"
              ? `${entry.event}: ${entry.toolName}${entry.harnessId ? ` · ${entry.harnessId}` : ""}`
              : `${entry.event}: ${entry.toolName ?? entry.action ?? "permission"}${entry.granted === null ? " · en attente" : entry.granted ? " · accordée" : " · refusée"}`,
          ),
        );
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
    const providerId = (option("--provider") ?? "openai").split(":")[0];
    const result = await refreshProvider(providerId);
    const models = store.modelRegistry(providerId, { availableOnly: true });
    if (result.authStatus !== "connected")
      throw new Error(
        `${providerId} indisponible: ${result.authStatus}${result.error ? ` · ${result.error}` : ""}`,
      );
    hasFlag("--json")
      ? print(models)
      : models.forEach((model) => print(model.id));
  } else if (command === "models" && ["enable", "disable"].includes(args[0])) {
    const providerId = option("--provider");
    const modelId = option("--model");
    if (!providerId || !modelId)
      throw new Error("--provider et --model sont requis");
    print(
      store.setModelEnabled(providerId, modelId, args[0] === "enable", {
        autoOnly: hasFlag("--auto-only"),
      }),
    );
  } else if (command === "conversation" && args[0] === "search") {
    const query = option("--query");
    if (!query)
      throw new Error(
        "Usage: omni conversation search --query TEXT [--project ID_OR_PATH] [--json]",
      );
    const results = store.searchConversations(query, option("--project"));
    hasFlag("--json")
      ? print(results)
      : results.forEach((result) =>
          print(
            `${result.id} · ${result.title} · ${result.match}: ${result.excerpt}`,
          ),
        );
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
    assertManualSelectionEnabled(model);
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
    jsonRunOutput = hasFlag("--json");
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
        "Usage: omni run --project ID_OR_PATH [--model MODEL] [--harness claude|codex|--auto] [--json] PROMPT",
      );
    if (!autoMode && model?.startsWith("antigravity:"))
      throw new Error(
        "Antigravity est disponible en chat isolé uniquement; `omni run` exige un harness réel.",
      );
    let autoDecision = null;
    if (autoMode) {
      autoDecision = await autoRoute(prompt, project);
      const selected = autoDecision.selected;
      harness =
        selected.harnessId === "claude-code"
          ? "claude"
          : selected.harnessId === "codex"
            ? "codex"
            : null;
      model =
        selected.providerId === "claude"
          ? `claude:${selected.modelId}`
          : selected.harnessId === "codex-chat"
            ? `codex:${selected.modelId}`
            : selected.modelId;
    }
    if (!autoMode) {
      assertManualSelectionEnabled(model, harness);
      if (harness)
        assertHarnessEnabled(harness === "claude" ? "claude-code" : "codex");
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
        emitRunEvent("routing.decision", {
          selected: autoDecision.selected,
          fallback: autoDecision.fallback,
          criteria: autoDecision.criteria,
        });
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
            to.providerId === "claude"
              ? `claude:${to.modelId}`
              : to.harnessId === "codex-chat"
                ? `codex:${to.modelId}`
                : to.modelId;
          harness =
            to.harnessId === "claude-code"
              ? "claude"
              : to.harnessId === "codex"
                ? "codex"
                : null;
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
          if (jsonRunOutput)
            emitRunEvent("routing.fallback", {
              from,
              to,
              reason: "selected-harness-preflight-failed-before-turn-start",
            });
          else
            print(
              `Auto: préflight ${from.providerId}/${from.modelId} indisponible; choix de secours ${to.providerId}/${to.modelId} avant le démarrage du tour.`,
            );
        } else {
          if (!jsonRunOutput)
            print(
              `Auto: ${autoDecision.explanation} · secours ${autoDecision.fallback ? `${autoDecision.fallback.providerId}/${autoDecision.fallback.modelId}` : "aucun"}`,
            );
        }
      }
      const selectedHarnessId =
        executionCandidate?.harnessId ??
        (harness === "claude" ? "claude-code" : harness);
      emitRunEvent("run.started", {
        conversationId: conversation.id,
        projectId: project.id,
        model,
        harnessId: selectedHarnessId,
      });
      let runStatus;
      if (harness === "claude")
        runStatus = await runClaudeHarness(conversation, prompt, preparedRun);
      else if (harness === "codex")
        runStatus = await runCodexHarness(conversation, prompt, preparedRun);
      else
        runStatus = await chat(
          conversation,
          model,
          prompt,
          preparedRun?.provider,
        );
      if (autoDecision)
        store.appendEvent(conversation.id, "routing.result", {
          decisionId: autoDecision.id,
          candidateKey: `${executionCandidate.providerId}/${executionCandidate.modelId}/${executionCandidate.harnessId}`,
          providerId: executionCandidate.providerId,
          modelId: executionCandidate.modelId,
          harnessId: executionCandidate.harnessId,
          outcome: runStatus === "interrupted" ? "interrupted" : "completed",
          latencyMs: Date.now() - routingStartedAt,
        });
      if (runStatus === "interrupted") {
        emitRunEvent("run.interrupted", {
          conversationId: conversation.id,
          status: "interrupted",
        });
        process.exitCode = 130;
      } else
        emitRunEvent("run.completed", {
          conversationId: conversation.id,
          status: "completed",
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
  if (jsonRunOutput) writeRunEvent("run.failed", { error: safe });
  else process.stderr.write(`omni: ${safe}\n`);
  if (process.exitCode !== 130) process.exitCode = 1;
} finally {
  store.close();
}
