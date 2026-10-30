import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";

import { createEntry, deleteEntry, renameEntry } from "../src/file-operations.mjs";

const isHidden = (name) => /^(?:\.git|node_modules|dist|\.env(?:\..*)?|\.omni)$/i.test(name);
const scratch = [];
let root;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "file-ops-"));
  scratch.push(root);
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "main.ts"), "export {};\n");
  writeFileSync(join(root, "README.md"), "# demo\n");
});

after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

describe("createEntry", () => {
  it("creates an empty file or folder inside an existing directory", async () => {
    await createEntry({ root, parent: "src", name: "util.ts", directory: false, isHidden });
    await createEntry({ root, parent: "", name: "docs", directory: true, isHidden });
    assert.equal(readFileSync(join(root, "src", "util.ts"), "utf8"), "");
    assert.ok(existsSync(join(root, "docs")));
  });

  it("refuses to overwrite an existing entry", async () => {
    await assert.rejects(createEntry({ root, parent: "src", name: "main.ts", directory: false, isHidden }), /existe déjà/);
    assert.equal(readFileSync(join(root, "src", "main.ts"), "utf8"), "export {};\n");
  });

  it("refuses names that escape or hide the entry", async () => {
    for (const name of ["../x", "a/b", "..", ".", "", ".env", ".git"]) {
      await assert.rejects(createEntry({ root, parent: "", name, directory: false, isHidden }), undefined, name);
    }
  });

  it("refuses a parent outside the project", async () => {
    await assert.rejects(createEntry({ root, parent: "../elsewhere", name: "x", directory: false, isHidden }), /sort du projet/);
  });
});

describe("renameEntry", () => {
  it("renames a file inside its directory", async () => {
    await renameEntry({ root, from: "src/main.ts", to: "app.ts", isHidden });
    assert.ok(existsSync(join(root, "src", "app.ts")));
    assert.ok(!existsSync(join(root, "src", "main.ts")));
  });

  it("refuses to rename onto an existing entry or to rename the project root", async () => {
    await assert.rejects(renameEntry({ root, from: "README.md", to: "src", isHidden }), /existe déjà/);
    await assert.rejects(renameEntry({ root, from: "", to: "x", isHidden }), /racine/);
  });
});

describe("deleteEntry", () => {
  it("deletes a file and a folder with its content", async () => {
    assert.deepEqual(await deleteEntry({ root, path: "README.md", isHidden }), { path: "README.md" });
    await deleteEntry({ root, path: "src", isHidden });
    assert.ok(!existsSync(join(root, "README.md")));
    assert.ok(!existsSync(join(root, "src")));
  });

  it("refuses the project root and hidden paths", async () => {
    mkdirSync(join(root, ".git"));
    await assert.rejects(deleteEntry({ root, path: "", isHidden }), /racine/);
    await assert.rejects(deleteEntry({ root, path: ".git", isHidden }), /protégé/);
    assert.ok(existsSync(join(root, ".git")));
  });
});
