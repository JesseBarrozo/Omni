import { chromium } from "playwright";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { ChatStore } from "../src/chat-store.mjs";
import { startWorkspaceServer } from "../src/workspace-server.mjs";

const dir = await mkdtemp(join(tmpdir(), "omni-editor-ui-"));
const root = join(dir, "project");
await mkdir(root);
await writeFile(join(root, "hello.js"), 'const message = "hello";\n');
execFileSync("git", ["init", "-q"], { cwd: root });
execFileSync("git", ["config", "user.name", "Omni test"], { cwd: root });
execFileSync("git", ["config", "user.email", "test@example.invalid"], {
  cwd: root,
});
execFileSync("git", ["add", "hello.js"], { cwd: root });
execFileSync("git", ["commit", "-qm", "Initial"], { cwd: root });
await mkdir(join(dir, "data"));
const store = new ChatStore(join(dir, "data", "omni.sqlite"));
const app = await startWorkspaceServer({
  store,
  dataDir: join(dir, "data"),
  cwd: root,
  port: 0,
});
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1500, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(app.url);
  await page.getByRole("tab", { name: "Fichiers", exact: true }).click();
  await page.getByRole("button", { name: "hello.js", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator(".monaco-editor").waitFor({ timeout: 30000 });
  await dialog.locator(".monaco-editor textarea").focus();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText("// édité dans Omni\n");
  await dialog
    .getByRole("button", { name: "Enregistrer", exact: true })
    .click();
  await page.getByText("Enregistré", { exact: true }).waitFor();
  assert.match(
    await readFile(join(root, "hello.js"), "utf8"),
    /édité dans Omni/,
  );
  await page.screenshot({
    path: ".context/previews/omni-editor.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  assert.equal(await page.getByLabel("Branche Git").count(), 0);
  await page.getByRole("tab", { name: "Git", exact: true }).click();
  await page.getByLabel("Branche Git").waitFor();
  await page.route(/\/github-tasks\?/, (route) =>
    route.fulfill({
      json: {
        rows: [
          {
            number: 42,
            title: "Corriger le test",
            url: "https://github.com/example/example/issues/42",
            updatedAt: "2026-10-30T00:00:00Z",
            author: { login: "test" },
          },
        ],
      },
    }),
  );
  await page.getByRole("button", { name: "Tâches", exact: true }).click();
  await page.getByRole("heading", { name: "Tâches" }).waitFor();
  await page.getByText("Corriger le test", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Confier à Omni" }).click();
  assert.match(
    await page.getByRole("textbox", { name: "Votre demande" }).inputValue(),
    /issues\/42/,
  );
  await page.getByRole("button", { name: "Tâches", exact: true }).click();
  await page
    .getByRole("button", { name: "Pull requests", exact: true })
    .click();
  await page.getByRole("button", { name: "En attente de relecture" }).waitFor();
  await page.getByRole("button", { name: "Paramètres", exact: true }).click();
  await page.getByRole("heading", { name: "Général" }).waitFor();
  await page.getByRole("button", { name: "MCP", exact: true }).click();
  await page.getByRole("heading", { name: "Serveurs MCP" }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Monaco chargé localement, édition et sauvegarde réelles, panneau Git et absence d’erreurs navigateur : OK",
  );
} finally {
  await browser.close();
  await app.close();
  store.close();
  await rm(dir, { recursive: true, force: true });
}
