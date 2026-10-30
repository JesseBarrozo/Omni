import { chromium } from "playwright";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { ChatStore } from "../src/chat-store.mjs";
import { startWorkspaceServer } from "../src/workspace-server.mjs";
if (process.env.OMNI_LIVE_WORKSPACE_TESTS !== "1")
  throw new Error(
    "Activez OMNI_LIVE_WORKSPACE_TESTS=1 pour lancer une génération réelle.",
  );
process.chdir(fileURLToPath(new URL("../", import.meta.url)));
const directory = await mkdtemp(join(tmpdir(), "omni-gui-live-"));
const project = join(directory, "project");
await mkdir(project);
await writeFile(
  join(project, "AGENTS.md"),
  "Utilise dotcontext pour vérifier le contexte. Cette validation doit rester en lecture seule.",
);
const store = new ChatStore(join(directory, "data/omni.sqlite"));
store.createProject("Validation Harness", project);
const app = await startWorkspaceServer({
  store,
  dataDir: join(directory, "data"),
  cwd: project,
  port: 0,
});
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const observed = [];
app.workspace.on("event", (e) => observed.push(e));
await mkdir(".context/previews", { recursive: true });
try {
  await page.goto(app.url);
  await page.getByText("Runtime local connecté", { exact: true }).waitFor();
  await page
    .getByRole("textbox", { name: "Votre demande" })
    .fill(
      `Vérification en lecture seule : utilise le MCP dotcontext pour appeler context avec action check et repoPath ${project}. Ne modifie aucun fichier. Explique brièvement en français ce qu’est dotcontext et termine par OMNI_GUI_VALIDATED.`,
    );
  await page.getByRole("button", { name: "Envoyer", exact: true }).click();
  const deadline = Date.now() + 120000;
  let approvalShot = false;
  while (Date.now() < deadline) {
    const approvals = app.workspace.snapshot().approvals;
    for (const approval of approvals) {
      await page
        .getByText("Autoriser cette action ?", { exact: true })
        .first()
        .waitFor({ timeout: 15000 });
      if (!approvalShot) {
        await page.screenshot({
          path: ".context/previews/omni-workspace-live-approval.png",
          fullPage: true,
        });
        approvalShot = true;
      }
      if (approval.request.server !== "dotcontext")
        throw new Error(
          "Demande inattendue : validation arrêtée sans approbation.",
        );
      await page
        .getByRole("button", { name: "Autoriser une fois", exact: true })
        .first()
        .click();
    }
    if (observed.some((e) => e.type === "run.finished")) break;
    await page.waitForTimeout(150);
  }
  assert.equal(
    observed.find((e) => e.type === "run.finished")?.payload.status,
    "completed",
  );
  await page
    .locator('[data-slot="message"][data-align="start"] .markdown')
    .last()
    .getByText(/OMNI_GUI_VALIDATED/)
    .waitFor({ timeout: 10000 });
  assert.ok(approvalShot);
  assert.ok(observed.some((e) => e.type === "tool.started"));
  assert.ok(
    observed.some((e) => e.type === "approval.resolved" && e.payload.allowed),
  );
  await page.screenshot({
    path: ".context/previews/omni-workspace-live-agent.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      status: "passed",
      approvalClicks: observed.filter((e) => e.type === "approval.resolved")
        .length,
      toolCalls: observed.filter((e) => e.type === "tool.started").length,
      assistant: store
        .conversation(store.conversations(store.projects()[0].id)[0].id)
        .messages.at(-1).content,
    }),
  );
} finally {
  await browser.close();
  await app.close();
  store.close();
  await rm(directory, { recursive: true, force: true });
}
