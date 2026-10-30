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
