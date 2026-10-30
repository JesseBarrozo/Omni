#!/usr/bin/env node
import { homedir } from "node:os";
import { readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { ChatStore } from "../src/chat-store.mjs";
import { serializeJsonLine } from "../src/cli-output.mjs";
import { OpenAIChat } from "../src/openai-chat.mjs";
import { OpenAIAuth } from "../src/openai-auth.mjs";
import { OpenRouterAuth, OpenRouterChat } from "../src/openrouter-chat.mjs";
import { AnthropicApiAuth, AnthropicApiChat } from "../src/anthropic-api.mjs";
import { GeminiApiAuth, GeminiApiChat } from "../src/gemini-api.mjs";
import { OpenCodeHarness } from "../src/opencode-harness.mjs";
import { EveHarness } from "../src/eve-harness.mjs";
import { McpRegistry } from "../src/mcp-registry.mjs";
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
import { OAuthProfiles } from "../src/oauth-profiles.mjs";
import { HarnessSwapService } from "../src/harness-swap.mjs";
import { terminalLogo } from "../src/terminal-logo.mjs";
import { TerminalUI } from "../src/terminal-ui.mjs";
import { agentTerminal } from "../src/agent-terminal.mjs";
import { startWorkspaceServer } from "../src/workspace-server.mjs";
import {
  AutoRouter,
  ModelRegistry,
  redactSecrets,
  sumReportedUsageCost,
} from "../src/core.mjs";

const dataDir = process.env.OMNI_DATA_DIR || join(homedir(), ".omni");
const store = new ChatStore(join(dataDir, "omni.sqlite"));
const oauthProfiles = new OAuthProfiles({ dataDir });
const oauthEnv = (provider) => oauthProfiles.environment(provider);
const openAIAuth = () => new OpenAIAuth({ dataDir });
const openRouterAuth = () => new OpenRouterAuth();
const anthropicApiAuth = () => new AnthropicApiAuth();
const geminiApiAuth = () => new GeminiApiAuth();
const apiKeyAuthFor = (provider) =>
  ({
    openrouter: openRouterAuth,
    anthropic: anthropicApiAuth,
    google: geminiApiAuth,
  })[provider]?.();
const mcpRegistry = () => new McpRegistry({ store });
const redactError = (value) => {
  let safe = redactSecrets(value);
  try {
    const key = openAIAuth().getApiKey();
    if (key && typeof safe === "string")
      safe = safe.replaceAll(key, "[REDACTED]");
  } catch {}
  try {
    const key = process.env.OPENROUTER_API_KEY ?? openRouterAuth().getApiKey();
    if (key && typeof safe === "string")
      safe = safe.replaceAll(key, "[REDACTED]");
  } catch {}
  try {
    const key = process.env.ANTHROPIC_API_KEY ?? anthropicApiAuth().getApiKey();
    if (key && typeof safe === "string")
      safe = safe.replaceAll(key, "[REDACTED]");
  } catch {}
  try {
    const key = process.env.GEMINI_API_KEY ?? geminiApiAuth().getApiKey();
    if (key && typeof safe === "string")
      safe = safe.replaceAll(key, "[REDACTED]");
  } catch {}
  return safe;
};
const createOpenAIChat = () => {
  const auth = openAIAuth();
  if (auth.hasCredentials()) return new OpenAIChat({ oauth: auth });
  if (process.env.OPENAI_API_KEY) return new OpenAIChat();
  const apiKey = auth.getApiKey();
  return new OpenAIChat({ apiKey: apiKey ?? undefined });
};
const createOpenRouterChat = () =>
  new OpenRouterChat({
    apiKey: process.env.OPENROUTER_API_KEY ?? openRouterAuth().getApiKey(),
  });
const createAnthropicApiChat = () =>
  new AnthropicApiChat({
    apiKey: process.env.ANTHROPIC_API_KEY ?? anthropicApiAuth().getApiKey(),
  });
const createGeminiApiChat = () =>
  new GeminiApiChat({
    apiKey: process.env.GEMINI_API_KEY ?? geminiApiAuth().getApiKey(),
  });
async function readApiKeyFromStdin() {
  if (stdin.isTTY)
    throw new Error(
      "stdin est un terminal visible; redirigez une source sécurisée non interactive.",
    );
  const chunks = [];
  let size = 0;
  for await (const chunk of stdin) {
    size += chunk.length;
    if (size > 16384)
      throw new Error("Entrée trop volumineuse (limite 16 KiB).");
    chunks.push(chunk);
  }
  let value = Buffer.concat(chunks).toString("utf8");
  if (!Buffer.from(value, "utf8").equals(Buffer.concat(chunks)))
    throw new Error("L’entrée doit être du texte UTF-8 valide.");
  if (value.endsWith("\r\n")) value = value.slice(0, -2);
  else if (value.endsWith("\n")) value = value.slice(0, -1);
  if (!value.trim() || /[\r\n\0-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))
    throw new Error(
      "Fournissez une clé API non vide sur une seule ligne via stdin.",
    );
  return value;
}
const print = (value) =>
  stdout.write(
    `${typeof value === "string" ? value : JSON.stringify(value, null, 2)}\n`,
  );
const args = process.argv.slice(2);
const command =
  !args.length ||
  (args[0].startsWith("--") && !["--help", "--version"].includes(args[0]))
    ? stdin.isTTY
      ? "direct"
      : "help"
    : args.shift();
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
  print(`Omni Universal AI Harness

Commands:
  omni [--harness codex|claude|opencode|eve] [--model MODEL] [--project PATH]
  agent [--conversation ID] [--harness ID] [--model MODEL]
  gui [--port 4318] [--project PATH] [--no-open]
  logo
  init
  status [--json]
  auth status
  auth login openai|codex|claude|antigravity
  auth profile list|use|remove PROVIDER [--profile NAME]
  auth key set openai --stdin [--profile NAME]
  auth key set openrouter|anthropic|google --stdin [--profile NAME]
  auth key list openai|openrouter|anthropic|google [--json]
  auth key use|remove PROVIDER [--profile NAME]
  mcp add|list|tools|call|remove ...
  providers list|refresh|enable|disable ...
  harnesses list [--json]
  harnesses refresh [--harness codex|claude-code|opencode|eve] [--json]
  harnesses enable|disable --harness ID
  tools list --conversation ID|--project ID_OR_PATH [--json]
  permissions list --conversation ID|--project ID_OR_PATH [--json]
  usage report --conversation ID|--project ID_OR_PATH [--month YYYY-MM] [--json]
  project create --name NAME [--path PATH]
  models list [--provider PROVIDER] [--json]
  chat --project ID_OR_PATH --model MODEL [--conversation ID]
  auto plan --project ID_OR_PATH [--json] PROMPT
  run --project ID_OR_PATH [--model MODEL] [--harness claude|codex|opencode|eve|--auto] [--conversation ID] [--json] PROMPT
  cancel --conversation ID
  task list|get|cancel --conversation ID [--task TASK_ID] [--json]
  swap --conversation ID --harness claude|codex|opencode|eve [--model MODEL]
  resume CONVERSATION_ID [--model MODEL]
  conversation search|export|import ...`);

async function autoRoute(prompt, project, { requiredMcpServers = [] } = {}) {
  const registry = new ModelRegistry();
  const mcp = mcpRegistry();
  const availableMcpServers = mcp.listServers().map(({ name }) => name);
  const cwd = project.rootPath ?? process.cwd();
  const compatibleMcpServers = (providerId) =>
    requiredMcpServers.filter((name) => {
      if (!availableMcpServers.includes(name)) return false;
      try {
        if (providerId === "codex") mcp.codexServerConfig(name, { cwd });
        else if (providerId === "claude") mcp.claudeServerConfig(name, { cwd });
        else return false;
        return true;
      } catch {
        return false;
      }
    });
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
    const modelDescriptors = models.map((model) =>
      typeof model === "string" ? { id: model, name: model } : model,
    );
    store.saveProviderCatalog({
      providerId,
      name: providerId,
      authStatus: "connected",
      models: modelDescriptors.map((model) => model.id),
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
    const harnesses = [{ id: harnessId, name: harnessName, tools: true }];
    if (chatHarnessId)
      harnesses.push({
        id: chatHarnessId,
        name:
          providerId === "codex"
            ? "Codex chat (sandbox lecture seule)"
            : "Claude chat (sans outils)",
        tools: providerId === "codex" ? "read-only" : false,
      });
    for (const harness of harnesses)
      registry.registerHarness({
        id: harness.id,
        name: harness.name,
        enabled: true,
        available: true,
        providerIds: [providerId],
        capabilities: {
          tools: harness.tools,
          mcpServers:
            harness.tools === true ? compatibleMcpServers(providerId) : [],
        },
        privacyApproved: false,
        ...(storedHarnesses.has(harness.id)
          ? { enabled: storedHarnesses.get(harness.id).enabled }
          : {}),
      });
    for (const descriptor of modelDescriptors)
      registry.registerModel({
        ...descriptor,
        providerId,
        available: descriptor.available ?? true,
        enabled: storedModels.get(descriptor.id)?.enabled ?? true,
        enabledForAuto:
          (storedModels.get(descriptor.id)?.enabledForAuto ?? true) &&
          (!autoModelAllowlist ||
            autoModelAllowlist.has(`${providerId}:${descriptor.id}`)),
      });
    checkedProviders.push({
      providerId,
      authenticated: true,
      modelCount: models.length,
      enabled,
    });
  };

  if (
    !disabledProviders.has("codex") &&
    codexAuthStatus({ env: oauthEnv("codex") }).authenticated
  ) {
    try {
      const models = await new CodexChat({
        store,
        env: oauthEnv("codex"),
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
        error: redactError(error.message),
      });
    }
  } else
    checkedProviders.push({
      providerId: "codex",
      authenticated: false,
      disabled: disabledProviders.has("codex"),
    });

  if (
    !disabledProviders.has("claude") &&
    claudeAuthStatus({ env: oauthEnv("claude") }).authenticated
  ) {
    try {
      const models = await new ClaudeCodeChat({
        store,
        env: oauthEnv("claude"),
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
        error: redactError(error.message),
      });
    }
  } else
    checkedProviders.push({
      providerId: "claude",
      authenticated: false,
      disabled: disabledProviders.has("claude"),
    });

  if (
    !disabledProviders.has("openai") &&
    (process.env.OPENAI_API_KEY ||
      openAIAuth().hasCredentials() ||
      openAIAuth().hasApiKey())
  ) {
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
        error: redactError(error.message),
      });
    }
  } else
    checkedProviders.push({
      providerId: "openai",
      authenticated: false,
      disabled: disabledProviders.has("openai"),
    });

  if (
    !disabledProviders.has("openrouter") &&
    (process.env.OPENROUTER_API_KEY || openRouterAuth().hasApiKey())
  ) {
    try {
      const models = await createOpenRouterChat().listModels();
      if (models.length)
        addProvider(
          "openrouter",
          models,
          "openrouter-chat",
          "OpenRouter chat",
          "openrouter-chat",
        );
      checkedProviders.push({
        providerId: "openrouter",
        authenticated: true,
        modelCount: models.length,
      });
    } catch (error) {
      checkedProviders.push({
        providerId: "openrouter",
        authenticated: true,
        available: false,
        error: redactError(error.message),
      });
    }
  } else
    checkedProviders.push({
      providerId: "openrouter",
      authenticated: false,
      disabled: disabledProviders.has("openrouter"),
    });

  if (
    !disabledProviders.has("anthropic") &&
    (process.env.ANTHROPIC_API_KEY || anthropicApiAuth().hasApiKey())
  ) {
    try {
      const models = await createAnthropicApiChat().listModels();
      if (models.length)
        addProvider(
          "anthropic",
          models,
          "anthropic-chat",
          "Anthropic chat",
          "anthropic-chat",
        );
      checkedProviders.push({
        providerId: "anthropic",
        authenticated: true,
        modelCount: models.length,
      });
    } catch (error) {
      checkedProviders.push({
        providerId: "anthropic",
        authenticated: true,
        available: false,
        error: redactError(error.message),
      });
    }
  } else
    checkedProviders.push({
      providerId: "anthropic",
      authenticated: false,
      disabled: disabledProviders.has("anthropic"),
    });

  if (
    !disabledProviders.has("google") &&
    (process.env.GEMINI_API_KEY || geminiApiAuth().hasApiKey())
  ) {
    try {
      const models = await createGeminiApiChat().listModels();
      if (models.length)
        addProvider(
          "google",
          models,
          "google-chat",
          "Gemini chat",
          "google-chat",
        );
      checkedProviders.push({
        providerId: "google",
        authenticated: true,
        modelCount: models.length,
      });
    } catch (error) {
      checkedProviders.push({
        providerId: "google",
        authenticated: true,
        available: false,
        error: redactError(error.message),
      });
    }
  } else
    checkedProviders.push({
      providerId: "google",
      authenticated: false,
      disabled: disabledProviders.has("google"),
    });

  if (disabledProviders.has("opencode")) {
    checkedProviders.push({
      providerId: "opencode",
      authenticated: false,
      disabled: true,
    });
  } else {
    const openCode = new OpenCodeHarness({
      store,
      cwd,
      executable: process.env.OMNI_OPENCODE_EXECUTABLE ?? "opencode",
    });
    try {
      const models = await openCode.listModelCatalog();
      const capabilities = await openCode.capabilities();
      store.saveHarnessRegistry({
        id: openCode.id,
        name: openCode.name,
        providerId: "opencode",
        integration: "OpenCode local server via official SDK v2",
        status: "connected",
        available: true,
        capabilities,
      });
      if (models.length)
        addProvider("opencode", models, openCode.id, openCode.name, null);
      else
        store.saveProviderCatalog({
          providerId: "opencode",
          name: "OpenCode provider registry",
          authStatus: "connected",
          models: [],
        });
      checkedProviders.push({
        providerId: "opencode",
        authenticated: true,
        modelCount: models.length,
        enabled: store
          .providerRegistry()
          .find((provider) => provider.id === "opencode")?.enabled,
      });
    } catch (error) {
      checkedProviders.push({
        providerId: "opencode",
        authenticated: false,
        available: false,
        error: redactError(error.message),
      });
    } finally {
      await openCode.dispose();
    }
  }

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
  const maxOutputPerMillion = process.env.OMNI_AUTO_MAX_OUTPUT_PER_MILLION
    ? Number(process.env.OMNI_AUTO_MAX_OUTPUT_PER_MILLION)
    : null;
  if (
    maxOutputPerMillion !== null &&
    (!Number.isFinite(maxOutputPerMillion) || maxOutputPerMillion < 0)
  )
    throw new Error(
      "OMNI_AUTO_MAX_OUTPUT_PER_MILLION doit être un nombre positif ou nul",
    );
  const maxMonthlySpendUsd = process.env.OMNI_AUTO_MONTHLY_BUDGET_USD
    ? Number(process.env.OMNI_AUTO_MONTHLY_BUDGET_USD)
    : null;
  if (
    maxMonthlySpendUsd !== null &&
    (!Number.isFinite(maxMonthlySpendUsd) || maxMonthlySpendUsd < 0)
  )
    throw new Error(
      "OMNI_AUTO_MONTHLY_BUDGET_USD doit être un nombre USD positif ou nul",
    );
  const currentMonth = new Date().toISOString().slice(0, 7);
  const monthStart = `${currentMonth}-01T00:00:00.000Z`;
  const [year, month] = currentMonth.split("-").map(Number);
  const nextMonthStart = new Date(Date.UTC(year, month, 1)).toISOString();
  const monthlySpendUsd = sumReportedUsageCost(
    store.executionEvents("usage", {
      projectId: project.id,
      from: monthStart,
      until: nextMonthStart,
    }),
  );
  const privacyMode = process.env.OMNI_AUTO_PRIVACY === "strict";
  const router = new AutoRouter(registry, {
    profile: process.env.OMNI_AUTO_PROFILE ?? "balance",
    preferredProviders: (process.env.OMNI_AUTO_PREFERRED_PROVIDERS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    excludedProviders: [...disabledProviders],
    maxInputPerMillion,
    maxOutputPerMillion,
    maxMonthlySpendUsd,
    monthlySpendUsd,
    privacyMode,
    previousResults,
    availableMcpServers,
  });
  const decision = router.select({ prompt, requiredMcpServers });
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
          env: oauthEnv("claude"),
          cwd: project.rootPath ?? process.cwd(),
          model: modelId?.startsWith("claude:")
            ? modelId.slice("claude:".length)
            : modelId === "claude"
              ? undefined
              : modelId,
          requestPermission,
          mcpRegistry: mcpRegistry(),
        })
      : harnessId === "codex"
        ? new CodexHarness({
            store,
            env: oauthEnv("codex"),
            executable: process.env.OMNI_CODEX_HARNESS_EXECUTABLE ?? "codex",
            cwd: project.rootPath ?? process.cwd(),
            model: modelId === "codex" ? undefined : modelId,
            requestPermission,
            mcpRegistry: mcpRegistry(),
          })
        : harnessId === "opencode"
          ? new OpenCodeHarness({
              store,
              executable: process.env.OMNI_OPENCODE_EXECUTABLE ?? "opencode",
              cwd: project.rootPath ?? process.cwd(),
              model: modelId,
              requestPermission,
            })
          : harnessId === "eve"
            ? new EveHarness({ store, requestPermission })
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
      env: oauthEnv("claude"),
      cwd,
      model: candidate.modelId,
    });
  if (candidate.providerId === "codex")
    return new CodexChat({
      store,
      cwd,
      model: candidate.modelId,
      env: oauthEnv("codex"),
    });
  if (candidate.providerId === "openai") return createOpenAIChat();
  if (candidate.providerId === "openrouter") return createOpenRouterChat();
  if (candidate.providerId === "anthropic") return createAnthropicApiChat();
  if (candidate.providerId === "google") return createGeminiApiChat();
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
    authenticated = codexAuthStatus({ env: oauthEnv("codex") }).authenticated;
    if (authenticated)
      provider = new CodexChat({ store, env: oauthEnv("codex") });
  } else if (providerId === "claude") {
    name = "Claude Code OAuth";
    authenticated = claudeAuthStatus({ env: oauthEnv("claude") }).authenticated;
    if (authenticated)
      provider = new ClaudeCodeChat({ store, env: oauthEnv("claude") });
  } else if (providerId === "openai") {
    const auth = openAIAuth();
    const oauthConnected = auth.hasCredentials();
    name = oauthConnected ? "OpenAI ChatGPT OAuth" : "OpenAI API key";
    const storedApiKey = auth.hasApiKey();
    authenticated =
      oauthConnected || Boolean(process.env.OPENAI_API_KEY) || storedApiKey;
    if (authenticated) provider = createOpenAIChat();
  } else if (providerId === "openrouter") {
    name = "OpenRouter API";
    authenticated =
      Boolean(process.env.OPENROUTER_API_KEY) || openRouterAuth().hasApiKey();
    if (authenticated) provider = createOpenRouterChat();
  } else if (providerId === "anthropic") {
    name = "Anthropic API";
    authenticated =
      Boolean(process.env.ANTHROPIC_API_KEY) || anthropicApiAuth().hasApiKey();
    if (authenticated) provider = createAnthropicApiChat();
  } else if (providerId === "google") {
    name = "Gemini Developer API";
    authenticated =
      Boolean(process.env.GEMINI_API_KEY) || geminiApiAuth().hasApiKey();
    if (authenticated) provider = createGeminiApiChat();
  } else if (providerId === "opencode") {
    name = "OpenCode provider registry";
    authenticated = true;
    provider = new OpenCodeHarness({
      store,
      executable: process.env.OMNI_OPENCODE_EXECUTABLE ?? "opencode",
    });
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
      error: redactError(error.message),
    };
  } finally {
    await provider.dispose?.().catch(() => {});
  }
}

function assertManualSelectionEnabled(modelId, harness = null) {
  const providerId =
    harness ??
    (modelId === "codex" || modelId.startsWith("codex:")
      ? "codex"
      : modelId === "claude" || modelId.startsWith("claude:")
        ? "claude"
        : modelId.startsWith("openrouter:")
          ? "openrouter"
          : modelId.startsWith("anthropic:")
            ? "anthropic"
            : modelId.startsWith("opencode:")
              ? "opencode"
              : modelId.startsWith("google:")
                ? "google"
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
    authenticated = codexAuthStatus({ env: oauthEnv("codex") }).authenticated;
    adapter = new CodexHarness({ store, env: oauthEnv("codex") });
  } else if (harnessId === "claude-code") {
    providerId = "claude";
    integration = "Claude Agent SDK";
    authenticated = claudeAuthStatus({ env: oauthEnv("claude") }).authenticated;
    adapter = new ClaudeCodeHarness({ store, env: oauthEnv("claude") });
  } else if (harnessId === "opencode") {
    providerId = "opencode";
    integration = "OpenCode local server via official SDK v2";
    authenticated = true;
    adapter = new OpenCodeHarness({
      store,
      executable: process.env.OMNI_OPENCODE_EXECUTABLE ?? "opencode",
    });
  } else if (harnessId === "eve") {
    providerId = "eve";
    integration = "Eve durable HTTP channel";
    authenticated = Boolean(process.env.OMNI_EVE_URL);
    adapter = new EveHarness({
      store,
      baseUrl: process.env.OMNI_EVE_URL ?? "http://127.0.0.1:0",
    });
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
  const requiredMcpServers = decision.criteria.task.requiredMcpServers ?? [];
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
          error: redactError(error.message),
        });
        continue;
      }
    }
    const run = createHarnessRun(candidate.harnessId, conversation, modelId);
    try {
      await run.adapter.initialize({
        conversationId: conversation.id,
        requiredMcpServers,
      });
      const activeMcpServers =
        run.adapter.activeMcpServers?.({
          conversationId: conversation.id,
        }) ?? [];
      const missingMcpServers = requiredMcpServers.filter(
        (name) => !activeMcpServers.includes(name),
      );
      if (missingMcpServers.length)
        throw new Error(
          `Préflight MCP incomplet: ${missingMcpServers.join(", ")}`,
        );
      return { candidate, run, failures };
    } catch (error) {
      failures.push({
        candidate,
        error: redactError(error.message),
      });
      try {
        await run.adapter.dispose();
      } catch {}
      run.rl.close();
      if (error.code === "OMNI_REQUIRED_MCP_DENIED") throw error;
    }
  }
  const error = new Error(
    `Aucun candidat Auto n’a passé le préflight avant le démarrage du tour (${failures.map((failure) => failure.error).join("; ")})`,
  );
  error.preflightFailures = failures;
  throw error;
}

async function swapHarness(conversationId, harnessId, requestedModel) {
  if (
    !conversationId ||
    !["claude", "codex", "opencode", "eve"].includes(harnessId)
  )
    throw new Error(
      "Usage: omni swap --conversation ID --harness claude|codex|opencode [--model MODEL]",
    );
  const registryHarnessId =
    harnessId === "claude"
      ? "claude-code"
      : harnessId === "opencode"
        ? "opencode"
        : harnessId === "eve"
          ? "eve"
          : "codex";
  assertHarnessEnabled(registryHarnessId);
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
      : harnessId === "opencode"
        ? conversation.modelId?.startsWith("opencode:") ||
          conversation.modelId?.includes("/")
          ? conversation.modelId
          : "opencode"
        : "codex");
  assertManualSelectionEnabled(model, harnessId);
  const requestPermission = permissionPrompt(rl, registryHarnessId);
  const adapter =
    harnessId === "claude"
      ? new ClaudeCodeHarness({
          store,
          env: oauthEnv("claude"),
          cwd: project.rootPath ?? process.cwd(),
          model: model === "claude" ? undefined : model.replace(/^claude:/, ""),
          requestPermission,
          mcpRegistry: mcpRegistry(),
        })
      : harnessId === "opencode"
        ? new OpenCodeHarness({
            store,
            cwd: project.rootPath ?? process.cwd(),
            model,
            executable: process.env.OMNI_OPENCODE_EXECUTABLE ?? "opencode",
            requestPermission,
          })
        : harnessId === "eve"
          ? new EveHarness({ store, requestPermission })
          : new CodexHarness({
              store,
              env: oauthEnv("codex"),
              cwd: project.rootPath ?? process.cwd(),
              model: model === "codex" ? undefined : model,
              requestPermission,
              mcpRegistry: mcpRegistry(),
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
      ? new CodexChat({
          store,
          cwd: project.rootPath ?? process.cwd(),
          env: oauthEnv("codex"),
        })
      : model.startsWith("codex:")
        ? new CodexChat({
            store,
            env: oauthEnv("codex"),
            cwd: project.rootPath ?? process.cwd(),
            model: model.slice("codex:".length),
          })
        : model === "claude" || model.startsWith("claude:")
          ? new ClaudeCodeChat({
              store,
              env: oauthEnv("claude"),
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
            : model.startsWith("openrouter:")
              ? createOpenRouterChat()
              : model.startsWith("anthropic:")
                ? createAnthropicApiChat()
                : model.startsWith("google:")
                  ? createGeminiApiChat()
                  : createOpenAIChat());
  const ui =
    !initialPrompt && !jsonRunOutput && stdin.isTTY && stdout.isTTY
      ? new TerminalUI({ model, cwd: project.rootPath ?? process.cwd() })
      : null;
  const rl =
    ui ??
    createInterface({
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
    if (ui) ui.startAnswer(prompt);
    else if (!jsonRunOutput) stdout.write("\nOmni › ");
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
          else if (ui) ui.delta(delta);
          else stdout.write(delta);
        },
        onUsage: (usage) => emitRunEvent("usage.updated", usage),
      });
      if (ui) {
        if (result.status === "interrupted")
          ui.notice("Réponse interrompue · texte partiel conservé.");
      } else if (!initialPrompt || !jsonRunOutput)
        stdout.write(
          result.status === "interrupted"
            ? "\n[Réponse interrompue; le texte partiel est conservé.]\n"
            : "\n",
        );
      return result.status;
    } catch (error) {
      if (!ui) throw error;
      ui.notice(redactError(error.message));
    } finally {
      controller = null;
      ui?.finish();
    }
  };
  try {
    if (ui && conversation.messages?.length) {
      ui.messages = conversation.messages.map(({ role, content }) => ({
        role,
        text: content,
      }));
      ui.render();
    }
    if (initialPrompt) {
      return await send(initialPrompt);
    }
    if (!stdin.isTTY)
      throw new Error("La conversation interactive nécessite un terminal TTY");
    while (true) {
      const prompt = await rl.question("\x1b[1;37m›\x1b[0m ");
      if (prompt.trim() === "/help") {
        const text =
          "Commandes : /help · /clear · /status · /quit\nAlt+Entrée : nouvelle ligne · ↑/↓ : historique de saisie\nPgUp/PgDn : parcourir la conversation · Échap : interrompre la réponse";
        if (ui) ui.notice(text);
        else print(text);
        continue;
      }
      if (prompt.trim() === "/clear") {
        ui?.clear();
        continue;
      }
      if (prompt.trim() === "/status") {
        const text = `Modèle : ${model}\nProjet : ${project.rootPath ?? process.cwd()}\nConversation : ${conversation.id}\nMode : chat fournisseur`;
        if (ui) ui.notice(text);
        else print(text);
        continue;
      }
      if (["/quit", "/exit"].includes(prompt.trim())) break;
      if (prompt.trim().startsWith("/")) {
        if (ui)
          ui.notice(
            "Commande inconnue. /help affiche les commandes disponibles.",
          );
        continue;
      }
      await send(prompt);
    }
  } finally {
    process.off("SIGINT", interrupt);
    rl.off("SIGINT", interrupt);
    rl.close();
    if (ui) stdout.write(`Reprendre : omni resume ${conversation.id}\n`);
  }
}

async function launchDirectChat() {
  if (!stdin.isTTY) {
    help();
    return;
  }
  const requestedProject = process.env.OMNI_PROJECT;
  let project = null;
  if (requestedProject) project = store.project(requestedProject);
  else {
    try {
      project = store.project(process.cwd());
    } catch {
      project = store.createProject(basename(process.cwd()), process.cwd());
    }
  }
  let model = process.env.OMNI_DEFAULT_MODEL;
  if (!model) {
    try {
      await refreshProvider("openai");
    } catch {}
    model = store.modelRegistry("openai", { availableOnly: true })[0]?.id;
  }
  if (!model)
    throw new Error(
      "Aucun modèle disponible. Définissez OMNI_DEFAULT_MODEL ou lancez `omni models list --provider openai`.",
    );
  assertManualSelectionEnabled(model);
  const conversation = store.createConversation(
    project.id,
    "Nouvelle conversation",
    model,
  );
  await chat(conversation, model);
}

async function launchAgentWorkspace() {
  if (!stdin.isTTY || !stdout.isTTY)
    throw new Error(
      "Le mode Agent interactif nécessite un terminal. Utilisez omni run pour une exécution ponctuelle.",
    );
  const existingId = option("--conversation");
  let conversation = existingId ? store.recoverConversation(existingId) : null;
  const prior = conversation
    ? store
        .listEvents(conversation.id)
        .filter((e) => e.type === "session.started" && e.payload.harnessId)
        .at(-1)?.payload.harnessId
    : null;
  let harnessId = option(
    "--harness",
    process.env.OMNI_DEFAULT_HARNESS ?? prior ?? "codex",
  );
  if (harnessId === "claude") harnessId = "claude-code";
  const model = option(
    "--model",
    process.env.OMNI_DEFAULT_MODEL ??
      conversation?.modelId ??
      (harnessId === "claude-code" ? "claude" : harnessId),
  );
  if (!conversation) {
    const projectArg = option(
      "--project",
      process.env.OMNI_PROJECT ?? process.cwd(),
    );
    let project;
    try {
      project = store.project(projectArg);
    } catch {
      const cwd = resolve(projectArg);
      if (!statSync(cwd).isDirectory())
        throw new Error("Dossier projet invalide.");
      try {
        project = store.project(cwd);
      } catch {
        project = store.createProject(basename(cwd), cwd);
      }
    }
    conversation = store.createConversation(
      project.id,
      "Nouvelle session Agent",
      model,
    );
  }
  await agentTerminal({ store, dataDir, conversation, harnessId, model });
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
    await adapter.initialize({ conversationId: conversation.id });
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

async function runOpenCodeHarness(conversation, prompt, preparedRun = null) {
  const project = store.project(conversation.projectId);
  const cwd = project.rootPath ?? process.cwd();
  const { adapter, rl } =
    preparedRun ??
    createHarnessRun("opencode", conversation, conversation.modelId);
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
    await adapter.initialize({ cwd });
    const sessionRef = store
      .listEvents(conversation.id)
      .filter(
        (event) =>
          (event.type === "session.started" &&
            event.payload.harnessId === "opencode") ||
          (event.type === "harness.changed" &&
            event.payload.toHarnessId === "opencode"),
      )
      .at(-1);
    const sessionId =
      sessionRef?.payload.sessionId ?? sessionRef?.payload.targetSessionId;
    const session = sessionId
      ? await adapter.resumeSession(sessionId, {
          conversationId: conversation.id,
          cwd,
        })
      : await adapter.createSession({
          conversationId: conversation.id,
          cwd,
          model: conversation.modelId,
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
      } else if (event.type === "usage.updated") {
        emitRunEvent("usage.updated", event.payload);
      } else if (event.type === "session.completed") {
        completed = true;
      }
    }
    if (!interrupted && !completed)
      throw new Error("OpenCode a terminé sans confirmer le tour");
    if (!interrupted) {
      const checkpoint = await adapter.checkpoint(session.id);
      if (jsonRunOutput)
        emitRunEvent("session.checkpointed", { checkpointId: checkpoint.id });
      else stdout.write(`\nCheckpoint OpenCode: ${checkpoint.id}\n`);
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

async function runEveHarness(conversation, prompt, preparedRun = null) {
  const project = store.project(conversation.projectId);
  const { adapter, rl } =
    preparedRun ?? createHarnessRun("eve", conversation, conversation.modelId);
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
            event.payload.harnessId === "eve") ||
          (event.type === "harness.changed" &&
            event.payload.toHarnessId === "eve"),
      )
      .at(-1);
    const sessionId =
      sessionRef?.payload.sessionId ?? sessionRef?.payload.targetSessionId;
    const session = sessionId
      ? await adapter.resumeSession(sessionId, {
          conversationId: conversation.id,
        })
      : await adapter.createSession({
          conversationId: conversation.id,
          cwd: project.rootPath ?? process.cwd(),
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
        emitRunEvent("tool.started", { toolName: event.payload.toolName });
      } else if (event.type === "tool.completed") {
        emitRunEvent("tool.completed", { toolName: event.payload.toolName });
      } else if (event.type === "tool.failed") {
        emitRunEvent("tool.failed", { toolName: event.payload.toolName });
      } else if (event.type === "permission.requested") {
        emitRunEvent("permission.requested", {
          requestId: event.payload.requestId,
        });
      } else if (event.type === "session.interrupted") {
        interrupted = true;
      } else if (event.type === "session.failed") {
        throw new Error(event.payload.error ?? "Eve a échoué pendant le tour");
      } else if (event.type === "session.completed") {
        completed = true;
      } else if (event.type === "usage.updated") {
        emitRunEvent("usage.updated", event.payload);
      }
    }
    if (!interrupted && !completed)
      throw new Error("Eve a terminé sans confirmer le tour");
    if (!interrupted) {
      const checkpoint = await adapter.checkpoint(session.id);
      emitRunEvent("session.checkpointed", { checkpointId: checkpoint.id });
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
  if (command === "direct") {
    if (hasFlag("--chat")) await launchDirectChat();
    else await launchAgentWorkspace();
  } else if (command === "agent") await launchAgentWorkspace();
  else if (command === "gui") {
    const port = Number(option("--port", "4318"));
    if (!Number.isInteger(port) || port < 0 || port > 65535)
      throw new Error("Port invalide.");
    let app;
    try {
      app = await startWorkspaceServer({
        store,
        dataDir,
        cwd: resolve(option("--project", process.cwd())),
        port,
      });
    } catch (error) {
      if (error.code !== "EADDRINUSE" || !port) throw error;
      const url = `http://127.0.0.1:${port}`;
      const state = await fetch(`${url}/api/state`, {
        signal: AbortSignal.timeout(2000),
      })
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null);
      if (
        !state ||
        typeof state.version !== "string" ||
        !Array.isArray(state.projects) ||
        !Array.isArray(state.harnesses) ||
        !state.harnesses.some((h) => h.id === "codex")
      ) {
        throw new Error(
          `Le port ${port} est déjà utilisé par un autre service. Choisissez un autre port avec --port.`,
        );
      }
      app = { url, existing: true };
    }
    print(
      app.existing
        ? `Omni Workspace est déjà lancé · ${app.url}${hasFlag("--project") ? "\nSélectionnez le projet dans l’interface existante." : ""}`
        : `Omni Workspace · ${app.url}\nCtrl+C pour arrêter.`,
    );
    if (!hasFlag("--no-open")) {
      const { execFile } = await import("node:child_process");
      const opener =
        process.platform === "darwin"
          ? "open"
          : process.platform === "win32"
            ? "explorer"
            : "xdg-open";
      execFile(opener, [app.url], () => {}).unref();
    }
    if (!app.existing) {
      await new Promise((resolve) => {
        process.once("SIGINT", resolve);
        process.once("SIGTERM", resolve);
      });
      await app.close();
    }
  } else if (command === "logo")
    print(
      terminalLogo({
        color: Boolean(stdout.isTTY) && !Object.hasOwn(process.env, "NO_COLOR"),
      }),
    );
  else if (command === "help") help();
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
      {
        ...codexAuthStatus({ env: oauthEnv("codex") }),
        profile: oauthProfiles.active("codex"),
      },
      {
        ...claudeAuthStatus({ env: oauthEnv("claude") }),
        profile: oauthProfiles.active("claude"),
      },
      {
        provider: "openai",
        authenticated:
          oauthConnected ||
          Boolean(process.env.OPENAI_API_KEY) ||
          openAIAuth().hasApiKey(),
        source: oauthConnected
          ? "chatgpt-oauth"
          : process.env.OPENAI_API_KEY
            ? "api-key"
            : openAIAuth().hasApiKey()
              ? "keyring-api-key"
              : null,
      },
      {
        provider: "openrouter",
        authenticated:
          Boolean(process.env.OPENROUTER_API_KEY) ||
          openRouterAuth().hasApiKey(),
        source: process.env.OPENROUTER_API_KEY
          ? "api-key"
          : openRouterAuth().hasApiKey()
            ? "keyring-api-key"
            : null,
      },
      {
        provider: "anthropic-api",
        authenticated:
          Boolean(process.env.ANTHROPIC_API_KEY) ||
          anthropicApiAuth().hasApiKey(),
        source: process.env.ANTHROPIC_API_KEY
          ? "api-key"
          : anthropicApiAuth().hasApiKey()
            ? "keyring-api-key"
            : null,
      },
      {
        provider: "google-gemini",
        authenticated:
          Boolean(process.env.GEMINI_API_KEY) || geminiApiAuth().hasApiKey(),
        source: process.env.GEMINI_API_KEY
          ? "api-key"
          : geminiApiAuth().hasApiKey()
            ? "keyring-api-key"
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
  } else if (
    command === "auth" &&
    args[0] === "key" &&
    ["set", "list", "use", "remove"].includes(args[1]) &&
    ["openrouter", "anthropic", "google"].includes(args[2])
  ) {
    const auth = apiKeyAuthFor(args[2]);
    const providerName =
      args[2] === "google"
        ? "Gemini"
        : args[2] === "anthropic"
          ? "Anthropic"
          : "OpenRouter";
    if (args[1] === "set") {
      if (!hasFlag("--stdin"))
        throw new Error("Fournissez la clé uniquement avec --stdin.");
      const profile = option("--profile", "default");
      auth.setApiKey(await readApiKeyFromStdin(), profile);
      print(
        `Profil ${providerName} ${profile} enregistré dans le trousseau système.`,
      );
    } else if (args[1] === "list") {
      const profiles = auth.listApiKeyProfiles();
      if (hasFlag("--json")) print(profiles);
      else if (profiles.profiles.length === 0)
        print(`Aucun profil ${providerName} enregistré.`);
      else
        profiles.profiles.forEach((profile) =>
          print(`${profile}${profile === profiles.active ? " (actif)" : ""}`),
        );
    } else if (args[1] === "use") {
      const profile = option("--profile");
      if (!profile) throw new Error("Indiquez le profil avec --profile NAME.");
      auth.useApiKeyProfile(profile);
      print(`Profil ${providerName} ${profile} sélectionné.`);
    } else {
      if (!hasFlag("--yes"))
        throw new Error("Confirmez la suppression avec --yes.");
      const profile = option("--profile");
      print(
        auth.deleteApiKey(profile)
          ? `Profil ${providerName} ${profile ?? "actif"} supprimé.`
          : `Aucun profil ${providerName} à supprimer.`,
      );
    }
  } else if (
    command === "auth" &&
    args[0] === "key" &&
    args[1] === "set" &&
    args[2] === "openai"
  ) {
    if (!hasFlag("--stdin"))
      throw new Error("Fournissez la clé uniquement avec --stdin.");
    openAIAuth().setApiKey(
      await readApiKeyFromStdin(),
      option("--profile", "default"),
    );
    print(
      `Profil OpenAI ${option("--profile", "default")} enregistré dans le trousseau système.`,
    );
  } else if (
    command === "auth" &&
    args[0] === "key" &&
    args[1] === "list" &&
    args[2] === "openai"
  ) {
    const profiles = openAIAuth().listApiKeyProfiles();
    if (hasFlag("--json")) print(profiles);
    else if (profiles.profiles.length === 0)
      print("Aucun profil OpenAI enregistré.");
    else
      profiles.profiles.forEach((profile) =>
        print(`${profile}${profile === profiles.active ? " (actif)" : ""}`),
      );
  } else if (
    command === "auth" &&
    args[0] === "key" &&
    args[1] === "use" &&
    args[2] === "openai"
  ) {
    const profile = option("--profile");
    if (!profile) throw new Error("Indiquez le profil avec --profile NAME.");
    openAIAuth().useApiKeyProfile(profile);
    print(`Profil OpenAI ${profile} sélectionné.`);
  } else if (
    command === "auth" &&
    args[0] === "key" &&
    args[1] === "remove" &&
    args[2] === "openai"
  ) {
    if (!hasFlag("--yes")) {
      if (!stdin.isTTY || !stdout.isTTY)
        throw new Error(
          "Confirmez la suppression avec --yes en mode non interactif.",
        );
      const rl = createInterface({ input: stdin, output: stdout });
      const auth = openAIAuth();
      const profile = option(
        "--profile",
        auth.listApiKeyProfiles().active ?? "default",
      );
      auth.getApiKey(profile);
      const answer = await rl.question(
        `Supprimer le profil OpenAI ${profile} du trousseau ? [y/N] `,
      );
      rl.close();
      if (!/^y(es)?$/i.test(answer.trim())) {
        print("Suppression annulée.");
        process.exitCode = 1;
      } else {
        const removed = auth.deleteApiKey(profile);
        print(
          removed
            ? "Clé API OpenAI supprimée."
            : "Aucune clé API OpenAI enregistrée.",
        );
      }
    } else {
      const removed = openAIAuth().deleteApiKey(option("--profile"));
      print(
        removed
          ? "Clé API OpenAI supprimée."
          : "Aucune clé API OpenAI enregistrée.",
      );
    }
  } else if (
    command === "auth" &&
    args[0] === "profile" &&
    ["list", "use", "remove"].includes(args[1])
  ) {
    const provider = args[2];
    const profile = option("--profile");
    if (!["codex", "claude"].includes(provider))
      throw new Error("Indiquez codex ou claude comme fournisseur OAuth.");
    if (args[1] === "list") {
      const result = oauthProfiles.list(provider);
      if (hasFlag("--json")) print(result);
      else
        result.profiles.forEach((name) =>
          print(`${name}${name === result.active ? " (actif)" : ""}`),
        );
    } else if (args[1] === "use") {
      if (!profile) throw new Error("Indiquez le profil avec --profile NAME.");
      const profileEnv = oauthProfiles.environment(provider, profile);
      const authenticated =
        provider === "codex"
          ? codexAuthStatus({ env: profileEnv }).authenticated
          : claudeAuthStatus({ env: profileEnv }).authenticated;
      if (!authenticated)
        throw new Error(`Le profil ${provider} ${profile} n’est pas connecté.`);
      oauthProfiles.use(provider, profile);
      print(`Profil OAuth ${provider} ${profile} sélectionné.`);
    } else {
      if (!profile) throw new Error("Indiquez le profil avec --profile NAME.");
      if (!hasFlag("--yes"))
        throw new Error("Confirmez la suppression du profil OAuth avec --yes.");
      print(
        oauthProfiles.remove(provider, profile)
          ? `Profil OAuth ${provider} ${profile} supprimé.`
          : `Profil OAuth ${provider} ${profile} introuvable.`,
      );
    }
  } else if (command === "auth" && args[0] === "login" && args[1] === "codex") {
    const profile = option("--profile", "default");
    const result = startCodexLogin({
      env: oauthProfiles.environment("codex", profile),
    });
    if (result.error)
      throw new Error("Impossible de lancer la connexion Codex");
    if (result.status !== 0)
      throw new Error("La connexion Codex a échoué ou a été annulée");
    oauthProfiles.use("codex", profile);
    print("Connexion Codex terminée.");
  } else if (
    command === "auth" &&
    args[0] === "login" &&
    args[1] === "claude"
  ) {
    const profile = option("--profile", "default");
    const result = startClaudeLogin({
      env: oauthProfiles.environment("claude", profile),
    });
    if (result.error)
      throw new Error("Impossible de lancer la connexion Claude");
    if (result.status !== 0)
      throw new Error("La connexion Claude a échoué ou a été annulée");
    oauthProfiles.use("claude", profile);
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
  } else if (command === "mcp" && args[0] === "add") {
    const name = option("--name");
    const transport = option("--transport", "stdio");
    const commandPath = option("--command");
    const url = option("--url");
    if (
      !name ||
      (transport === "stdio" && !commandPath) ||
      (transport === "http" && !url)
    )
      throw new Error(
        "mcp add exige --name et --command (stdio) ou --url avec --transport http.",
      );
    if (!["stdio", "http"].includes(transport))
      throw new Error("--transport doit être stdio ou http.");
    let serverArgs;
    try {
      serverArgs = JSON.parse(option("--args-json", "[]"));
    } catch {
      throw new Error("--args-json doit contenir un tableau JSON valide.");
    }
    const envKeys = (option("--env-names", "") ?? "")
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean);
    const cwdOption = option("--cwd");
    const cwd = cwdOption ? resolve(cwdOption) : null;
    const headerEnv = {};
    for (const item of (option("--header-env", "") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)) {
      const separator = item.indexOf("=");
      if (separator < 1)
        throw new Error("--header-env attend HEADER=VARIABLE.");
      headerEnv[item.slice(0, separator)] = item.slice(separator + 1);
    }
    if (cwd && !statSync(cwd, { throwIfNoEntry: false })?.isDirectory())
      throw new Error("Le répertoire --cwd MCP est introuvable.");
    const server = mcpRegistry().addServer({
      name,
      transport,
      command: commandPath,
      args: serverArgs,
      cwd,
      url,
      headerEnv,
      envKeys,
    });
    print({
      name: server.name,
      configured: true,
      environmentNames: server.envKeys,
    });
  } else if (command === "mcp" && args[0] === "list") {
    const servers = mcpRegistry()
      .listServers()
      .map((server) => ({
        name: server.name,
        transport: server.transport,
        ...(server.transport === "stdio"
          ? { command: server.command, cwd: server.cwd }
          : {}),
        envKeys: server.envKeys,
        tools: server.tools.map(({ name: toolName }) => toolName),
      }));
    if (hasFlag("--json")) print(servers);
    else if (servers.length === 0) print("Aucun serveur MCP configuré.");
    else
      servers.forEach((server) =>
        print(
          `${server.name}: ${server.command} · ${server.tools.length} outils découverts`,
        ),
      );
  } else if (command === "mcp" && args[0] === "tools") {
    const name = option("--server");
    const conversationId = option("--conversation");
    if (!name || !conversationId)
      throw new Error("mcp tools exige --server NAME et --conversation ID.");
    const conversation = store.conversation(conversationId);
    const project = store.project(conversation.projectId);
    const permissionPayload = {
      projectId: project.id,
      tool: `mcp:${name}`,
      action: "discover-tools",
      server: name,
      toolName: "__discover__",
      scope: "once",
    };
    store.appendEvent(
      conversation.id,
      "permission.requested",
      permissionPayload,
    );
    if (!stdin.isTTY || !stdout.isTTY) {
      store.appendEvent(conversation.id, "permission.denied", {
        ...permissionPayload,
        granted: false,
        reason: "non-interactive-session",
      });
      throw new Error(
        "Découverte refusée : une approbation interactive est requise.",
      );
    }
    const rl = createInterface({ input: stdin, output: stdout });
    let answer;
    try {
      answer = await rl.question(
        `Autoriser le démarrage de ${name} pour découvrir ses outils dans ${project.name} ? [y/N] `,
      );
    } finally {
      rl.close();
    }
    if (!/^y(es)?$/i.test(answer.trim())) {
      store.appendEvent(conversation.id, "permission.denied", {
        ...permissionPayload,
        granted: false,
        reason: "user-denied",
      });
      throw new Error("Découverte MCP refusée par l’utilisateur.");
    }
    store.appendEvent(conversation.id, "permission.granted", {
      ...permissionPayload,
      granted: true,
    });
    print(
      await mcpRegistry().discoverTools(name, {
        requestPermission: async () => true,
      }),
    );
  } else if (command === "mcp" && args[0] === "call") {
    const name = option("--server");
    const toolName = option("--tool");
    const conversationId = option("--conversation");
    const inputFile = option("--input-file");
    if (!name || !toolName || !conversationId || !inputFile)
      throw new Error(
        "mcp call exige --server, --tool, --conversation et --input-file.",
      );
    const conversation = store.conversation(conversationId);
    const project = store.project(conversation.projectId);
    const server = store.mcpServer(name);
    if (!server) throw new Error("Serveur MCP introuvable.");
    if (!server.tools.some((tool) => tool.name === toolName))
      throw new Error(
        "Outil MCP absent du catalogue; lancez `omni mcp tools`.",
      );
    const file = resolve(inputFile);
    const stat = statSync(file, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.size > 1024 * 1024)
      throw new Error(
        "Le fichier d’arguments MCP est absent ou dépasse 1 MiB.",
      );
    let input;
    try {
      input = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      throw new Error(
        "Le fichier d’arguments MCP doit contenir du JSON valide.",
      );
    }
    if (!input || Array.isArray(input) || typeof input !== "object")
      throw new Error("Les arguments MCP doivent être un objet JSON.");
    const permissionPayload = {
      projectId: project.id,
      tool: `mcp:${name}`,
      action: "execute",
      server: name,
      toolName,
      scope: "once",
    };
    store.appendEvent(
      conversation.id,
      "permission.requested",
      permissionPayload,
    );
    if (!stdin.isTTY || !stdout.isTTY) {
      store.appendEvent(conversation.id, "permission.denied", {
        ...permissionPayload,
        granted: false,
        reason: "non-interactive-session",
      });
      throw new Error(
        "Appel MCP refusé : une approbation interactive est requise.",
      );
    }
    const rl = createInterface({ input: stdin, output: stdout });
    let answer;
    try {
      answer = await rl.question(
        `Autoriser une fois ${name}/${toolName} dans le projet ${project.name} ? [y/N] `,
      );
    } finally {
      rl.close();
    }
    if (!/^y(es)?$/i.test(answer.trim())) {
      store.appendEvent(conversation.id, "permission.denied", {
        ...permissionPayload,
        granted: false,
        reason: "user-denied",
      });
      throw new Error("Appel MCP refusé par l’utilisateur.");
    }
    store.appendEvent(conversation.id, "permission.granted", {
      ...permissionPayload,
      granted: true,
    });
    store.appendEvent(conversation.id, "tool.started", {
      server: name,
      toolName,
    });
    let result;
    try {
      result = await mcpRegistry().callTool(name, toolName, input, {
        requestPermission: async () => true,
      });
    } catch {
      store.appendEvent(conversation.id, "tool.failed", {
        server: name,
        toolName,
        errorCode: "mcp-call-failed",
      });
      throw new Error(
        "L’appel de l’outil MCP a échoué; détails exclus des journaux.",
      );
    }
    if (result.isError)
      store.appendEvent(conversation.id, "tool.failed", {
        server: name,
        toolName,
        isError: true,
      });
    else
      store.appendEvent(conversation.id, "tool.completed", {
        server: name,
        toolName,
        status: "completed",
      });
    print(result);
  } else if (command === "mcp" && args[0] === "remove") {
    const name = option("--server");
    if (!name) throw new Error("mcp remove exige --server NAME.");
    if (!hasFlag("--yes")) {
      if (!stdin.isTTY || !stdout.isTTY)
        throw new Error(
          "Confirmez la suppression avec --yes en mode non interactif.",
        );
      const rl = createInterface({ input: stdin, output: stdout });
      const answer = await rl.question(
        `Supprimer la configuration MCP ${name} ? [y/N] `,
      );
      rl.close();
      if (!/^y(es)?$/i.test(answer.trim())) {
        print("Suppression annulée.");
        process.exitCode = 1;
      } else print({ name, removed: mcpRegistry().removeServer(name) });
    } else print({ name, removed: mcpRegistry().removeServer(name) });
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
      : [
          "codex",
          "claude",
          "openai",
          "openrouter",
          "anthropic",
          "google",
          "antigravity",
          "opencode",
        ];
    const results = [];
    for (const providerId of providers)
      results.push(await refreshProvider(providerId));
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
    const harnesses = requested
      ? [requested]
      : ["codex", "claude-code", "opencode", "eve"];
    const results = [];
    for (const harnessId of harnesses)
      results.push(await refreshHarness(harnessId));
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
  } else if (command === "usage" && args[0] === "report") {
    const conversationId = option("--conversation");
    const projectId = option("--project");
    if (!conversationId && !projectId)
      throw new Error("usage report exige --conversation ou --project");
    const month = option("--month");
    let period = {};
    if (month) {
      if (!/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(month))
        throw new Error("--month doit respecter YYYY-MM (UTC)");
      const [year, monthNumber] = month.split("-").map(Number);
      period = {
        from: new Date(Date.UTC(year, monthNumber - 1, 1)).toISOString(),
        until: new Date(Date.UTC(year, monthNumber, 1)).toISOString(),
      };
    }
    const eventFilter = { conversationId, projectId, ...period };
    const events = store.executionEvents("usage", eventFilter);
    const routingEvents = store.executionEvents("routing", eventFilter);
    const totals = {
      input: null,
      output: null,
      reasoning: null,
      cacheRead: null,
      cacheWrite: null,
    };
    const tokenFieldReports = Object.fromEntries(
      Object.keys(totals).map((field) => [field, 0]),
    );
    let costUsd = 0;
    let costReports = 0;
    let tokenReports = 0;
    let latencyTotalMs = 0;
    let latencyReports = 0;
    const outcomes = { completed: 0, failed: 0, interrupted: 0, other: 0 };
    const routingRecords = routingEvents.map((event) => {
      const payload = event.payload;
      const latencyMs = payload.latencyMs;
      const validLatency = Number.isFinite(latencyMs) && latencyMs >= 0;
      if (validLatency) {
        latencyTotalMs += latencyMs;
        latencyReports += 1;
      }
      const outcome = Object.hasOwn(outcomes, payload.outcome)
        ? payload.outcome
        : "other";
      outcomes[outcome] += 1;
      return {
        conversationId: event.conversationId,
        createdAt: event.createdAt,
        providerId: payload.providerId ?? null,
        modelId: payload.modelId ?? null,
        harnessId: payload.harnessId ?? null,
        outcome,
        latencyMs: validLatency ? latencyMs : null,
      };
    });
    const records = events.map((event) => {
      const payload = event.payload;
      const reportedCost = payload.costUsd;
      const validCost = Number.isFinite(reportedCost) && reportedCost >= 0;
      if (validCost) {
        costUsd += reportedCost;
        costReports += 1;
      }
      const tokens = payload.tokens;
      const validCount = (value) => Number.isSafeInteger(value) && value >= 0;
      const normalizedTokens = {};
      for (const [field, value] of [
        ["input", tokens?.input],
        ["output", tokens?.output],
        ["reasoning", tokens?.reasoning],
        ["cacheRead", tokens?.cache?.read],
        ["cacheWrite", tokens?.cache?.write],
      ]) {
        if (!validCount(value)) continue;
        normalizedTokens[field] = value;
        totals[field] = (totals[field] ?? 0) + value;
        tokenFieldReports[field] += 1;
      }
      if (Object.keys(normalizedTokens).length) {
        tokenReports += 1;
      }
      return {
        conversationId: event.conversationId,
        createdAt: event.createdAt,
        providerId: payload.providerId ?? null,
        harnessId: payload.harnessId ?? null,
        costUsd: validCost ? reportedCost : null,
        tokens: Object.keys(normalizedTokens).length ? normalizedTokens : null,
      };
    });
    const report = {
      projectId: projectId ? store.project(projectId).id : null,
      conversationId,
      month: month ?? null,
      events: records,
      routing: routingRecords,
      summary: {
        eventCount: records.length,
        costReports,
        costUsd: costReports ? costUsd : null,
        tokenReports,
        tokenFieldReports,
        tokens: tokenReports ? totals : null,
        routingResultCount: routingRecords.length,
        routingOutcomes: outcomes,
        latencyReports,
        averageLatencyMs: latencyReports
          ? latencyTotalMs / latencyReports
          : null,
      },
    };
    if (hasFlag("--json")) print(report);
    else {
      if (report.month) print(`Période UTC: ${report.month}`);
      print(`Mesures: ${report.summary.eventCount}`);
      print(
        report.summary.costUsd === null
          ? "Coût USD: non rapporté"
          : `Coût USD: ${report.summary.costUsd}`,
      );
      print(
        report.summary.tokens
          ? `Tokens · entrée ${totals.input ?? "non rapportée"} · sortie ${totals.output ?? "non rapportée"} · raisonnement ${totals.reasoning ?? "non rapporté"} · cache lecture ${totals.cacheRead ?? "non rapporté"} · cache écriture ${totals.cacheWrite ?? "non rapportée"}`
          : "Tokens: non rapportés",
      );
      print(
        report.summary.averageLatencyMs === null
          ? "Latence Auto: non rapportée"
          : `Latence moyenne Auto: ${report.summary.averageLatencyMs.toFixed(1)} ms (${report.summary.latencyReports} mesure(s))`,
      );
      print(
        `Résultats Auto · terminés ${outcomes.completed} · échoués ${outcomes.failed} · interrompus ${outcomes.interrupted}`,
      );
      for (const record of records)
        print(
          `${record.createdAt} · ${record.providerId ?? record.harnessId ?? "provider inconnu"} · ${record.costUsd === null ? "coût inconnu" : `${record.costUsd} USD`}`,
        );
    }
  } else if (
    command === "task" &&
    ["list", "get", "cancel"].includes(args[0])
  ) {
    const conversationId = option("--conversation");
    if (!conversationId) throw new Error("task exige --conversation ID");
    const events = store.listEvents(conversationId);
    const tasks = new Map();
    for (const event of events) {
      if (!event.type.startsWith("task.")) continue;
      const payload = event.payload ?? {};
      const taskId = payload.taskId ?? payload.id ?? payload.sessionId;
      if (!taskId) continue;
      const previous = tasks.get(taskId) ?? {
        id: taskId,
        conversationId,
        harnessId: payload.harnessId ?? "eve",
        sessionId: payload.sessionId ?? null,
      };
      tasks.set(taskId, {
        ...previous,
        ...payload,
        id: taskId,
        state:
          event.type === "task.started"
            ? "running"
            : event.type === "task.completed"
              ? "completed"
              : event.type === "task.failed"
                ? "failed"
                : event.type === "task.cancelled"
                  ? "cancelled"
                  : (payload.state ?? previous.state ?? "unknown"),
        updatedAt: event.createdAt,
      });
    }
    const taskId = option("--task") ?? args[1];
    if (args[0] === "get" && !taskId)
      throw new Error("task get exige --task ID");
    if (args[0] === "cancel") {
      const task = tasks.get(taskId);
      if (!task) throw new Error(`Tâche inconnue: ${taskId}`);
      if (task.harnessId !== "eve" || !task.sessionId)
        throw new Error("Cette tâche ne peut pas être annulée par Eve");
      const adapter = new EveHarness({ store });
      await adapter.interrupt(task.sessionId);
      store.appendEvent(conversationId, "task.cancelled", {
        ...task,
        taskId,
        reason: "user requested",
      });
      print({ ...task, id: taskId, state: "cancelled" });
    } else {
      const result =
        args[0] === "get" ? tasks.get(taskId) : [...tasks.values()];
      hasFlag("--json")
        ? print(result ?? null)
        : (Array.isArray(result) ? result : [result]).forEach(
            (task) =>
              task &&
              print(
                `${task.id} · ${task.state} · ${task.sessionId ?? "sans session"}`,
              ),
          );
    }
  } else if (command === "cancel") {
    const conversationId = option("--conversation") ?? args[0];
    if (!conversationId) throw new Error("cancel exige --conversation ID");
    const conversation = store.conversation(conversationId);
    const session = store
      .listEvents(conversationId)
      .filter(
        (event) =>
          event.type === "session.started" &&
          event.payload?.harnessId === "eve",
      )
      .at(-1);
    if (!session?.payload?.sessionId)
      throw new Error("Aucune session Eve active pour cette conversation");
    const adapter = new EveHarness({ store });
    await adapter.interrupt(session.payload.sessionId);
    store.appendEvent(conversationId, "session.interrupted", {
      harnessId: "eve",
      sessionId: session.payload.sessionId,
      reason: "user requested",
    });
    if (conversation.status === "running")
      store.setStatus(conversationId, "interrupted");
    print({
      conversationId,
      sessionId: session.payload.sessionId,
      cancelled: true,
    });
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
  } else if (command === "auto" && args[0] === "plan") {
    args.shift();
    const requiredMcpValue = option("--require-mcp");
    const requiredMcpServers = requiredMcpValue
      ? [...new Set(requiredMcpValue.split(",").map((name) => name.trim()))]
      : [];
    if (
      requiredMcpServers.some(
        (name) => !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(name),
      )
    )
      throw new Error("Nom de serveur MCP requis invalide.");
    const consumedValueIndexes = ["--project", "--require-mcp"]
      .map((name) => args.indexOf(name) + 1)
      .filter((index) => index > 0);
    const prompt = args
      .filter(
        (value, index) =>
          !value.startsWith("--") && !consumedValueIndexes.includes(index),
      )
      .join(" ");
    if (!prompt)
      throw new Error(
        "Usage: omni auto plan --project ID_OR_PATH [--require-mcp SERVER[,SERVER]] [--json] PROMPT",
      );
    const project = store.project(option("--project") ?? "");
    print(await autoRoute(prompt, project, { requiredMcpServers }));
  } else if (command === "run") {
    jsonRunOutput = hasFlag("--json");
    let harness = option("--harness");
    const autoMode = hasFlag("--auto");
    const requiredMcpValue = option("--require-mcp");
    const requiredMcpServers = requiredMcpValue
      ? [...new Set(requiredMcpValue.split(",").map((name) => name.trim()))]
      : [];
    if (requiredMcpValue && !autoMode)
      throw new Error("--require-mcp nécessite `omni run --auto`.");
    if (
      requiredMcpServers.some(
        (name) => !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(name),
      )
    )
      throw new Error("Nom de serveur MCP requis invalide.");
    if (harness && !["claude", "codex", "opencode", "eve"].includes(harness))
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
          : harness === "opencode"
            ? (conversation?.modelId ?? "opencode")
            : harness === "eve"
              ? (conversation?.modelId ?? "eve")
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
      "--require-mcp",
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
        "Usage: omni run --project ID_OR_PATH [--model MODEL] [--harness claude|codex|opencode|--auto] [--json] PROMPT",
      );
    if (!autoMode && model?.startsWith("antigravity:"))
      throw new Error(
        "Antigravity est disponible en chat isolé uniquement; `omni run` exige un harness réel.",
      );
    let autoDecision = null;
    if (autoMode) {
      autoDecision = await autoRoute(prompt, project, { requiredMcpServers });
      const selected = autoDecision.selected;
      harness =
        selected.harnessId === "claude-code"
          ? "claude"
          : selected.harnessId === "codex"
            ? "codex"
            : selected.harnessId === "opencode"
              ? "opencode"
              : null;
      model =
        selected.providerId === "claude"
          ? `claude:${selected.modelId}`
          : selected.harnessId === "codex-chat"
            ? `codex:${selected.modelId}`
            : selected.harnessId === "opencode"
              ? `opencode:${selected.modelId}`
              : selected.modelId;
    }
    if (!autoMode) {
      assertManualSelectionEnabled(model, harness);
      if (harness)
        assertHarnessEnabled(
          harness === "claude"
            ? "claude-code"
            : harness === "opencode"
              ? "opencode"
              : harness === "eve"
                ? "eve"
                : "codex",
        );
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
                : to.harnessId === "opencode"
                  ? `opencode:${to.modelId}`
                  : to.modelId;
          harness =
            to.harnessId === "claude-code"
              ? "claude"
              : to.harnessId === "codex"
                ? "codex"
                : to.harnessId === "opencode"
                  ? "opencode"
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
      else if (harness === "opencode")
        runStatus = await runOpenCodeHarness(conversation, prompt, preparedRun);
      else if (harness === "eve")
        runStatus = await runEveHarness(conversation, prompt, preparedRun);
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
          error: redactError(error.message),
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
  let safe = redactError(error.message);
  if (process.env.OPENAI_API_KEY)
    safe = safe.replaceAll(process.env.OPENAI_API_KEY, "[REDACTED]");
  if (process.env.OPENROUTER_API_KEY)
    safe = safe.replaceAll(process.env.OPENROUTER_API_KEY, "[REDACTED]");
  if (process.env.ANTHROPIC_API_KEY)
    safe = safe.replaceAll(process.env.ANTHROPIC_API_KEY, "[REDACTED]");
  if (process.env.GEMINI_API_KEY)
    safe = safe.replaceAll(process.env.GEMINI_API_KEY, "[REDACTED]");
  safe = safe
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "[REDACTED]")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");
  if (jsonRunOutput) writeRunEvent("run.failed", { error: safe });
  else process.stderr.write(`omni: ${safe}\n`);
  if (process.exitCode !== 130) process.exitCode = 1;
} finally {
  store.close();
}
