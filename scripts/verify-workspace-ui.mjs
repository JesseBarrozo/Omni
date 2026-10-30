import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
process.chdir(fileURLToPath(new URL("../", import.meta.url)));
const url = process.env.OMNI_GUI_TEST_URL ?? "http://127.0.0.1:4318";
await mkdir(".context/previews", { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1512, height: 982 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto(url);
  await page
    .getByRole("heading", { name: "Une idée. Tous vos agents." })
    .waitFor();
  await page.getByText("Runtime local connecté", { exact: true }).waitFor();
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
  await page.getByRole("button", { name: /Reprendre avec dotcontext/ }).click();
  assert.match(
    await page.getByRole("textbox", { name: "Votre demande" }).inputValue(),
    /MCP dotcontext/,
  );
  await page.getByRole("textbox", { name: "Votre demande" }).fill("");
  await page.keyboard.press("Meta+k");
  await page.getByRole("dialog").waitFor();
  await page.getByRole("combobox").last().fill("Connexions");
  await page.getByRole("option", { name: "Connexions MCP" }).click();
  await page.getByRole("heading", { name: "Connexions et outils" }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Fichiers", exact: true }).click();
  await page.getByRole("button", { name: "AGENTS.md", exact: true }).click();
  await page.getByRole("tab", { name: "AGENTS.md", exact: true }).waitFor();
  await page.screenshot({
    path: ".context/previews/omni-workspace-file-review.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Fermer AGENTS.md" }).click();
  await page.getByRole("tab", { name: "Contexte", exact: true }).click();

  // Verify internal browser tab opening (Orca-inspired)
  await page
    .getByRole("button", { name: "Ouvrir le navigateur interne" })
    .first()
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
    .getByRole("heading", { name: "Une idée. Tous vos agents." })
    .waitFor();

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
}
