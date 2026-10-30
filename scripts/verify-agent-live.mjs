import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { ChatStore } from "../src/chat-store.mjs";
import { AgentWorkspace } from "../src/agent-workspace.mjs";

if (process.env.OMNI_LIVE_WORKSPACE_TESTS !== "1")
  throw new Error(
    "Activez explicitement OMNI_LIVE_WORKSPACE_TESTS=1 pour cette génération réelle.",
  );
const directory = await mkdtemp(join(tmpdir(), "omni-agent-live-"));
const project = join(directory, "project");
await mkdir(project);
await writeFile(
  join(project, "AGENTS.md"),
  "Utilise toujours dotcontext pour vérifier le contexte de ce dossier. Cette validation est en lecture seule.",
);
const store = new ChatStore(join(directory, "data/omni.sqlite"));
const entry = store.createProject("Isolated live agent validation", project);
const conversation = store.createConversation(
  entry.id,
  "Real dotcontext validation",
  "codex",
);
const workspace = new AgentWorkspace({
  store,
  dataDir: join(directory, "data"),
});
workspace.ensureDotcontext();
const events = [];
workspace.on("event", (event) => {
  events.push(event);
  if (event.type === "approval.requested") {
    const request = event.payload.request;
    const allowed = request.server === "dotcontext";
    console.log(
      JSON.stringify({
        type: event.type,
        method: request.method,
        server: request.server,
        allowed,
      }),
    );
    workspace.approve(event.payload.id, allowed);
  }
  if (event.type === "tool.started" || event.type === "run.error")
    console.log(
      JSON.stringify({
        type: event.type,
        toolName: event.payload.toolName,
        error: event.payload.error,
      }),
    );
});
try {
  const result = await workspace.run({
    conversationId: conversation.id,
    harnessId: "codex",
    model: process.env.OMNI_TEST_CODEX_MODEL ?? "codex",
    prompt: `Validation de l’intégration Omni, lecture seule. Utilise le MCP dotcontext et appelle réellement son outil context avec action check et repoPath exactement ${project}. Ne modifie aucun fichier. Réponds ensuite en français : explique en une phrase ce qu’est dotcontext, puis termine par OMNI_AGENT_VALIDATED. Tu dois effectuer l’appel MCP avant la réponse.`,
    signal: AbortSignal.timeout(120000),
  });
  const final = store.conversation(conversation.id);
  assert.equal(result.status, "completed");
  assert.ok(
    events.some(
      (e) =>
        e.type === "tool.started" &&
        (/MCP/i.test(e.payload.toolName ?? "") ||
          e.payload.itemType === "mcpToolCall"),
    ),
  );
  assert.match(final.messages.at(-1).content, /OMNI_AGENT_VALIDATED/);
  console.log(
    JSON.stringify({
      status: result.status,
      toolCalls: events.filter((e) => e.type === "tool.started").length,
      answer: final.messages.at(-1).content,
    }),
  );
} finally {
  await workspace.close();
  store.close();
  await rm(directory, { recursive: true, force: true });
}
