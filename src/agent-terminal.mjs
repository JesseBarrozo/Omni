import { AgentWorkspace, normalizeHarness } from "./agent-workspace.mjs";
import { TerminalUI } from "./terminal-ui.mjs";
import { redactSecrets } from "./core.mjs";

export async function agentTerminal({
  store,
  dataDir,
  conversation,
  harnessId = "codex",
  model,
}) {
  harnessId = normalizeHarness(harnessId);
  const project = store.project(conversation.projectId);
  const workspace = new AgentWorkspace({ store, dataDir });
  workspace.ensureDotcontext();
  const ui = new TerminalUI({
    model,
    cwd: project.rootPath ?? process.cwd(),
    mode: "Agent",
    harnessId,
  });
  ui.messages = conversation.messages.map(({ role, content }) => ({
    role,
    text: content,
  }));
  const interrupt = () => workspace.cancel(conversation.id);
  ui.on("SIGINT", interrupt);
  process.on("SIGINT", interrupt);
  ui.on("approval", ({ id, allowed }) => {
    try {
      workspace.approve(id, allowed);
    } catch (error) {
      ui.notice(error.message);
    }
  });
  workspace.on("event", (event) => {
    if (event.conversationId !== conversation.id) return;
    if (event.type === "message.delta" && event.payload.messageId)
      ui.delta(event.payload.delta);
    if (event.type === "approval.requested") {
      ui.approval = event.payload;
      ui.render();
    }
    if (event.type === "approval.resolved") {
      ui.approval = null;
      ui.render();
    }
    if (event.type === "tool.started")
      ui.activity = `Outil : ${event.payload.toolName ?? "en cours"}`;
    if (event.type === "tool.completed" || event.type === "tool.failed")
      ui.activity = "";
    if (event.type === "context.loaded")
      ui.activity = `Contexte chargé · ${event.payload.files.length} fichiers`;
  });
  try {
    while (true) {
      const prompt = (await ui.question()).trim();
      if (["/quit", "/exit"].includes(prompt)) break;
      if (prompt === "/clear") {
        ui.clear();
        continue;
      }
      if (prompt === "/help") {
        ui.notice(
          "Mode Agent : fichiers, terminal et MCP du Harness réel.\n/harness codex|claude|opencode · /model ID · /status · /clear · /quit\nLes permissions sont ponctuelles : y autorise, n refuse. Échap interrompt le tour.",
        );
        continue;
      }
      if (prompt.startsWith("/harness ")) {
        const next = normalizeHarness(prompt.slice(9).trim());
        if (!["codex", "claude-code", "opencode"].includes(next)) {
          ui.notice("Harness inconnu.");
          continue;
        }
        harnessId = next;
        model = next === "claude-code" ? "claude" : next;
        ui.harnessId = harnessId;
        ui.model = model;
        ui.notice(`Harness : ${harnessId}`);
        continue;
      }
      if (prompt.startsWith("/model ")) {
        model = prompt.slice(7).trim();
        ui.model = model;
        ui.notice(`Modèle : ${model}`);
        continue;
      }
      if (prompt === "/status") {
        ui.notice(
          `Agent : ${harnessId}\nModèle : ${model}\nProjet : ${project.rootPath}\nConversation : ${conversation.id}\nMCP : ${store
            .mcpServers()
            .map((s) => s.name)
            .join(", ")}`,
        );
        continue;
      }
      if (prompt.startsWith("/")) {
        ui.notice("Commande inconnue. Utilisez /help.");
        continue;
      }
      ui.startAnswer(prompt);
      try {
        const result = await workspace.run({
          conversationId: conversation.id,
          harnessId,
          model,
          prompt,
        });
        if (result.status === "interrupted")
          ui.notice("Exécution interrompue. Le texte partiel est conservé.");
      } catch (error) {
        ui.notice(redactSecrets(error.message));
      } finally {
        ui.activity = "";
        ui.approval = null;
        ui.finish();
      }
    }
  } finally {
    process.off("SIGINT", interrupt);
    ui.close();
    await workspace.close();
    process.stdout.write(
      `Reprendre : omni agent --conversation ${conversation.id}\n`,
    );
  }
}
