import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { ChatStore } from "../src/chat-store.mjs";
import { AgentWorkspace } from "../src/agent-workspace.mjs";
import { startWorkspaceServer } from "../src/workspace-server.mjs";

process.chdir(fileURLToPath(new URL("../", import.meta.url)));

let serverInstance = null;
let tempDir = null;
let url = process.env.OMNI_GUI_TEST_URL;
if (!url) {
  tempDir = mkdtempSync(join(tmpdir(), "omni-gui-verify-"));
  const store = new ChatStore(join(tempDir, "verify.sqlite"));
  const workspace = new AgentWorkspace({
    store,
    cwd: process.cwd(),
    dataDir: join(tempDir, "data"),
  });
  serverInstance = await startWorkspaceServer({
    store,
    workspace,
    cwd: process.cwd(),
    dataDir: join(tempDir, "data"),
    port: 0,
  });
  url = serverInstance.url;
}

await mkdir(".context/previews", { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1512, height: 982 },
  deviceScaleFactor: 1,
  locale: "fr-FR",
});
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto(url);
  await page
    .getByLabel("Statistiques et usage")
    .waitFor();
  await page.getByText(/Runtime local connecté|Local runtime connected/).waitFor();
  await page.getByText("AGENTS.md", { exact: true }).first().waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: ".context/previews/omni-workspace-desktop.png",
    fullPage: true,
  });
  await page.getByRole("textbox", { name: "Votre demande" }).fill("");
  await page.keyboard.press("Meta+k");
  await page.getByRole("dialog").waitFor();
  await page.getByRole("combobox").last().fill("Connexions");
  await page.getByRole("option", { name: "Connexions MCP" }).click();
  await page.getByRole("heading", { name: "Connexions et outils" }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Fichiers", exact: true }).click();
  await page
    .locator('[data-path="AGENTS.md"]')
    .or(page.getByRole("treeitem", { name: "AGENTS.md" }))
    .or(page.getByRole("button", { name: "AGENTS.md" }))
    .click();
  await page.getByRole("tab", { name: "AGENTS.md", exact: true }).waitFor();
  await page.screenshot({
    path: ".context/previews/omni-workspace-file-review.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Fermer AGENTS.md" }).click();
  await page.getByRole("tab", { name: "Contexte", exact: true }).click();

  // Verify Atlas documents open in the editor/viewer tab instead of inside the right panel
  const atlasDocumentsBtn = page.getByRole("button", { name: /Documents.*atlas\/documents\.md/i });
  if ((await atlasDocumentsBtn.count()) > 0) {
    await atlasDocumentsBtn.first().click();
    await page.locator('.workspace-tab:has-text("documents.md")').waitFor();
    await page.locator(".markdown-file-preview").waitFor();
    // Verify citation inside documents.md opens referenced file
    const citationBtn = page.locator(".markdown-file-preview button", { hasText: "AGENTS.md:1" });
    if ((await citationBtn.count()) > 0) {
      await citationBtn.first().click();
      await page.locator('.workspace-tab:has-text("AGENTS.md")').waitFor();
      await page.locator('.workspace-tab:has-text("AGENTS.md") .workspace-tab-close').click();
    }
    await page.locator('.workspace-tab:has-text("documents.md") .workspace-tab-close').click();
  }

  // Verify tab create dropdown (Orca-inspired)
  await page.getByRole("button", { name: "Créer un nouvel onglet" }).click();
  await page.getByRole("menuitem", { name: /Nouveau terminal/ }).waitFor();
  await page
    .getByRole("menuitem", { name: /Nouvel onglet de navigateur/ })
    .waitFor();
  await page.getByRole("menuitem", { name: /Nouveau Markdown/ }).waitFor();
  await page
    .getByRole("menuitem", { name: /Lancer un nouveau chat/ })
    .waitFor();
  await page.screenshot({
    path: ".context/previews/omni-workspace-tab-dropdown.png",
    fullPage: true,
  });

  // Open browser tab via dropdown
  await page
    .getByRole("menuitem", { name: /Nouvel onglet de navigateur/ })
    .click();
  await page
    .getByRole("heading", { name: "Navigateur Interne Omni" })
    .waitFor();
  await page.getByText("Serveurs Locaux").waitFor();
  await page.getByText("Vite Dev Server").waitFor();
  assert.equal(
    await page.getByRole("tab", { name: /Nouvel onglet/ }).isVisible(),
    true,
  );
  await page.screenshot({
    path: ".context/previews/omni-workspace-browser.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: /Fermer l'onglet/ }).click();
  await page
    .getByLabel("Statistiques et usage")
    .waitFor();

  // Open terminal tab via dropdown
  await page.getByRole("button", { name: "Créer un nouvel onglet" }).click();
  await page.getByRole("menuitem", { name: /Nouveau terminal/ }).click();
  await page.getByText(/Omni Terminal/).waitFor();
  await page.screenshot({
    path: ".context/previews/omni-workspace-terminal.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: /Fermer Terminal/ }).click();
  await page
    .getByLabel("Statistiques et usage")
    .waitFor();

  // Verify multi-chat tabs: "Lancer un nouveau chat" opens a new tab without overwriting current chat
  await page.getByRole("button", { name: "Créer un nouvel onglet" }).click();
  await page.getByRole("menuitem", { name: /Lancer un nouveau chat/ }).click();
  await page.getByRole("tab", { name: "Chat 1" }).waitFor();
  await page.getByRole("textbox", { name: "Votre demande" }).fill("Message dans Chat 1");
  await page.getByRole("button", { name: "Créer un nouvel onglet" }).click();
  await page.getByRole("menuitem", { name: /Lancer un nouveau chat/ }).click();
  await page.getByRole("tab", { name: "Chat 2" }).waitFor();
  assert.equal(
    await page.getByRole("textbox", { name: "Votre demande" }).inputValue(),
    "",
  );
  // Switch back to first chat tab
  await page.getByRole("tab", { name: "Chat 1", exact: true }).click();
  assert.equal(
    await page.getByRole("textbox", { name: "Votre demande" }).inputValue(),
    "Message dans Chat 1",
  );
  // Switch back to Chat 2 and close it
  await page.getByRole("tab", { name: "Chat 2" }).click();
  await page.getByRole("button", { name: /Fermer Chat 2/ }).click();
  assert.equal(
    await page.getByRole("tab", { name: "Chat 2" }).count(),
    0,
  );
  assert.equal(
    await page.getByRole("textbox", { name: "Votre demande" }).inputValue(),
    "Message dans Chat 1",
  );

  // Verify simplified permissions menu (Orca-inspired)
  const permissionsBtn = page.getByRole("button", { name: /Mode d'autorisation/ });
  await permissionsBtn.click();
  await page.getByRole("menuitemradio", { name: /Demander l’approbation/ }).waitFor();
  await page.getByRole("menuitemradio", { name: /Accepter les modifications/ }).waitFor();
  await page.getByRole("menuitemradio", { name: /Approuver pour moi/ }).waitFor();
  await page.getByRole("menuitemradio", { name: /Accès complet/ }).waitFor();
  await page.screenshot({
    path: ".context/previews/omni-workspace-permissions.png",
    fullPage: true,
  });
  // Select "Accès complet"
  await page.getByRole("menuitemradio", { name: /Accès complet/ }).click();
  assert.match(await permissionsBtn.innerText(), /Accès complet/);
  assert.match(await page.locator(".composer-footnote").innerText(), /Accès complet activé/);
  // Switch back to "Demander l'approbation"
  await permissionsBtn.click();
  await page.getByRole("menuitemradio", { name: /Demander l’approbation/ }).click();
  assert.match(await permissionsBtn.innerText(), /Demander l’approbation/);

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: ".context/previews/omni-workspace-mobile.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "GUI verified: real API, context, composer, command palette, MCP settings, file reader, desktop/mobile layout; no browser errors.",
  );
} finally {
  await browser.close();
  if (serverInstance) {
    serverInstance.close();
  }
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
