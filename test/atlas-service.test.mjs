import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { atlasStatus, generateAtlas } from "../src/atlas-service.mjs";

const scratch = [];

function projectRoot(files = {}) {
  const root = mkdtempSync(join(tmpdir(), "atlas-service-"));
  scratch.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

after(() => {
  for (const root of scratch) rmSync(root, { recursive: true, force: true });
});

describe("atlasStatus", () => {
  it("reports no atlas when the project has none", () => {
    assert.deepEqual(atlasStatus(projectRoot({ "package.json": "{}" })), {
      present: false,
      path: "atlas",
    });
  });

  it("reports the atlas and its counts once it exists", () => {
    const root = projectRoot({
      "package.json": JSON.stringify({ name: "demo", workspaces: [] }),
    });
    generateAtlas(root);
    const status = atlasStatus(root);
    assert.equal(status.present, true);
    assert.equal(status.path, "atlas");
    assert.equal(status.capabilities, 0);
    assert.equal(status.tables, 0);
    assert.equal(typeof status.digest, "string");
  });
});

describe("generateAtlas", () => {
  it("writes the atlas into the project and returns the written files", () => {
    const root = projectRoot({ "package.json": "{}" });
    const written = generateAtlas(root);
    assert.ok(written.includes("atlas/index.json"));
    assert.equal(atlasStatus(root).present, true);
  });
});

import { atlasPages, readAtlasPage } from "../src/atlas-service.mjs";

describe("atlas pages", () => {
  it("lists the generated pages with their titles", () => {
    const root = projectRoot({ "pyproject.toml": "[project]\n", "src/main.py": "print(1)\n" });
    generateAtlas(root);
    const pages = atlasPages(root);
    assert.ok(pages.some((page) => page.name === "map.md" && page.title === "Map"));
    assert.ok(pages.every((page) => page.name.endsWith(".md")));
  });

  it("returns no pages when the project has no atlas", () => {
    assert.deepEqual(atlasPages(projectRoot({ "package.json": "{}" })), []);
  });

  it("reads a page without its generator header", () => {
    const root = projectRoot({ "pyproject.toml": "[project]\n" });
    generateAtlas(root);
    const text = readAtlasPage(root, "map.md");
    assert.equal(text.startsWith("<!--"), false);
    assert.match(text, /^# Map/m);
  });

  it("refuses page names that are not plain atlas pages", () => {
    const root = projectRoot({ "pyproject.toml": "[project]\n" });
    generateAtlas(root);
    for (const name of ["../package.json", "index.json", "sub/map.md", "map.md/..", ""]) {
      assert.throws(() => readAtlasPage(root, name), undefined, name);
    }
  });
});
