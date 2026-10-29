import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { redactSecrets } from "./core.mjs";

function gitSnapshot(cwd) {
  try {
    return {
      available: true,
      branch: execFileSync("git", ["-C", cwd, "branch", "--show-current"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim(),
      head: execFileSync("git", ["-C", cwd, "rev-parse", "HEAD"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim(),
      status: execFileSync(
        "git",
        ["-C", cwd, "status", "--porcelain=v1", "--untracked-files=all"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ).trim(),
    };
  } catch {
    return { available: false, reason: "Git unavailable for this project" };
  }
}

function operationIndex(pending, payload, idKey, fields) {
  if (payload[idKey] !== undefined)
    return pending.findIndex((item) => item[idKey] === payload[idKey]);
  return pending.findIndex((item) =>
    fields.every((field) => item[field] === payload[field]),
  );
}

export function buildResumeSummary({ events, conversation, git }) {
  const messages = events
    .filter((event) => event.type === "message.created")
    .map(({ payload }) => ({ role: payload.role, content: payload.content }));
  const userMessages = messages.filter((message) => message.role === "user");
  const toolEvents = events.filter((event) =>
    ["tool.started", "tool.completed", "tool.failed"].includes(event.type),
  );
  const pendingTools = [];
  for (const event of toolEvents) {
    if (event.type === "tool.started") pendingTools.push(event.payload);
    else {
      const index = operationIndex(pendingTools, event.payload, "toolUseId", [
        "sessionId",
        "toolName",
      ]);
      if (index >= 0) pendingTools.splice(index, 1);
    }
  }
  const permissionEvents = events.filter((event) =>
    [
      "permission.requested",
      "permission.granted",
      "permission.denied",
    ].includes(event.type),
  );
  const pendingPermissions = [];
  for (const event of permissionEvents) {
    if (event.type === "permission.requested")
      pendingPermissions.push(event.payload);
    else {
      const index = operationIndex(
        pendingPermissions,
        event.payload,
        "requestId",
        ["sessionId", "toolName", "method"],
      );
      if (index >= 0) pendingPermissions.splice(index, 1);
    }
  }
  const commandEvents = events.filter((event) =>
    ["command.started", "command.completed"].includes(event.type),
  );
  const commands = [];
  const activeCommands = [];
  for (const event of commandEvents) {
    if (event.type === "command.started") {
      const command = {
        command: event.payload.command ?? "",
        status: "active",
        toolUseId: event.payload.toolUseId,
      };
      commands.push(command);
      activeCommands.push(command);
    } else {
      const index = operationIndex(activeCommands, event.payload, "toolUseId", [
        "command",
      ]);
      if (index >= 0) {
        activeCommands[index].status = "completed";
        activeCommands.splice(index, 1);
      }
    }
  }
  const files = events
    .filter((event) => event.type === "file.changed")
    .map((event) => event.payload);
  for (const event of toolEvents.filter(
    (item) => item.type === "tool.started",
  )) {
    const input = event.payload.input ?? {};
    const filePath = input.file_path ?? input.path;
    if (
      ["Write", "Edit", "fileChange"].includes(event.payload.toolName) &&
      filePath &&
      !files.some((item) => item.path === filePath)
    )
      files.push({ path: filePath, source: event.payload.toolName });
    for (const change of input.changes ?? [])
      if (change.path && !files.some((item) => item.path === change.path))
        files.push({ path: change.path, source: "Codex file change" });
    if (
      /Bash|command/i.test(event.payload.toolName ?? "") &&
      input.command &&
      !commands.some((item) => item.command === input.command)
    )
      commands.push({ command: input.command, status: "reported by harness" });
  }
  const tests = commands.filter((item) =>
    /\b(test|lint|check|build|vitest|jest|pytest)\b/i.test(item.command),
  );
  const failures = events
    .filter((event) =>
      ["tool.failed", "session.failed", "message.failed"].includes(event.type),
    )
    .map((event) => ({ type: event.type, ...event.payload }));
  const decisions = events
    .filter((event) =>
      ["routing.decision", "model.changed", "harness.changed"].includes(
        event.type,
      ),
    )
    .map((event) => ({ type: event.type, ...event.payload }));
  const latestCheckpoint = events
    .filter((event) => event.type === "session.checkpointed")
    .at(-1);

  return redactSecrets({
    objective: userMessages[0]?.content ?? conversation.title,
    conversationHistory: messages,
    decisions,
    filesModified: files,
    commandsExecuted: commands,
    testsPerformed: tests,
    errors: failures,
    tasksRemaining:
      userMessages.at(-1)?.content ?? "No remaining task recorded",
    git,
    permissions: {
      active: pendingPermissions,
      decisions: permissionEvents
        .filter((event) => event.type !== "permission.requested")
        .map((event) => ({ type: event.type, ...event.payload })),
    },
    activeOperations: {
      tools: pendingTools,
      commands: activeCommands,
    },
    previousCheckpointId: latestCheckpoint?.id ?? null,
  });
}

export class HarnessSwapService {
  constructor({ store, adapters, gitState = gitSnapshot } = {}) {
    if (!store) throw new Error("HarnessSwapService requires the Omni store");
    this.store = store;
    this.adapters = adapters ?? new Map();
    this.gitState = gitState;
  }

  async swap({
    conversationId,
    toHarnessId,
    model,
    reason = "user requested",
  }) {
    const conversation = this.store.conversation(conversationId);
    if (conversation.status === "running")
      throw new Error("Harness swap is deferred while an execution is active");
    const events = this.store.listEvents(conversationId);
    const project = this.store.project(conversation.projectId);
    const cwd = project.rootPath ?? process.cwd();
    const git = this.gitState(cwd);
    const summary = buildResumeSummary({ events, conversation, git });
    if (
      summary.activeOperations.tools.length ||
      summary.activeOperations.commands.length
    )
      throw new Error("Harness swap blocked while a tool or command is active");
    if (summary.permissions.active.length)
      throw new Error("Harness swap blocked while a permission is unresolved");
    const target = this.adapters.get(toHarnessId);
    if (!target) throw new Error(`Harness adapter unavailable: ${toHarnessId}`);
    const checkpoint = {
      id: randomUUID(),
      conversationId,
      createdAt: new Date().toISOString(),
      sourceHarnessId:
        [...events].reverse().find((event) => event.type === "harness.changed")
          ?.payload?.toHarnessId ??
        [...events].reverse().find((event) => event.type === "session.started")
          ?.payload?.harnessId ??
        null,
      targetHarnessId: toHarnessId,
      state: "safe-boundary",
      summary,
    };
    this.store.appendEvent(conversationId, "session.checkpointed", {
      harnessId: checkpoint.sourceHarnessId,
      ...checkpoint,
    });
    let session;
    try {
      await target.initialize();
      session = await target.createSession({
        conversationId,
        cwd,
        model,
        resumeSummary: summary,
      });
    } catch (error) {
      this.store.appendEvent(conversationId, "session.failed", {
        harnessId: toHarnessId,
        stage: "harness-swap",
        error: redactSecrets(error.message),
        checkpointId: checkpoint.id,
      });
      throw error;
    }
    this.store.appendEvent(conversationId, "harness.changed", {
      fromHarnessId: checkpoint.sourceHarnessId,
      toHarnessId,
      targetSessionId: session.id,
      targetModelId: model ?? null,
      reason,
      checkpointId: checkpoint.id,
      resumeSummary: summary,
      limitations: ["Harness-local hidden state is not transferred"],
    });
    if (model && model !== conversation.modelId)
      this.store.setModel(conversationId, model);
    return { checkpoint, session, summary };
  }
}
