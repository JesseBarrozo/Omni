import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  addArtifact,
  checkArtifacts,
  listArtifacts,
  refreshArtifact,
  slugify,
} from "../scripts/artifacts.mjs";

const now = new Date("2026-10-30T12:00:00.000Z");

let root;
let source;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "artifacts-test-"));
  source = join(root, "input.html");
  writeFileSync(source, "<!doctype html><title>Plan</title>\n");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function artifactsDir() {
  return join(root, ".context", "artifacts");
}

function indexOf() {
  return JSON.parse(readFileSync(join(artifactsDir(), "index.json"), "utf8"));
}

describe("slugify", () => {
  it("turns a title into a lowercase ASCII identifier", () => {
    assert.equal(slugify("Plan d'amélioration du harness"), "plan-d-amelioration-du-harness");
  });

  it("falls back to a fixed name when nothing usable remains", () => {
    assert.equal(slugify("!!!"), "artifact");
  });
});

describe("addArtifact", () => {
  it("copies the file and records it in the index with its hash", () => {
    const entry = addArtifact({
      root,
      source,
      title: "Harness plan",
      kind: "plan",
      description: "Plan for the harness.",
      author: "tester",
      now,
    });

    assert.equal(entry.id, "harness-plan");
    assert.equal(entry.file, "harness-plan.html");
    assert.equal(entry.kind, "plan");
    assert.equal(entry.createdAt, "2026-10-30T12:00:00.000Z");
    assert.equal(entry.sha256.length, 64);
    assert.equal(readFileSync(join(artifactsDir(), "harness-plan.html"), "utf8"), readFileSync(source, "utf8"));
    assert.equal(indexOf().artifacts.length, 1);
  });

  it("rejects an unknown kind", () => {
    assert.throws(
      () => addArtifact({ root, source, title: "X", kind: "video", description: "d", now }),
      /kind must be one of/,
    );
  });

  it("rejects a missing description", () => {
    assert.throws(
      () => addArtifact({ root, source, title: "X", kind: "plan", description: "", now }),
      /description is required/,
    );
  });

  it("refuses to overwrite an existing id unless forced", () => {
    addArtifact({ root, source, title: "Same", kind: "plan", description: "d", now });
    assert.throws(
      () => addArtifact({ root, source, title: "Same", kind: "plan", description: "d", now }),
      /already exists/,
    );
    addArtifact({ root, source, title: "Same", kind: "report", description: "d2", now, force: true });
    const { artifacts } = indexOf();
    assert.equal(artifacts.length, 1);
    assert.equal(artifacts[0].kind, "report");
  });
});

describe("checkArtifacts", () => {
  it("passes on a consistent store", () => {
    addArtifact({ root, source, title: "Plan", kind: "plan", description: "d", now });
    assert.deepEqual(checkArtifacts(root), []);
  });

  it("passes when there is no store yet", () => {
    assert.deepEqual(checkArtifacts(root), []);
  });

  it("detects a file changed after it was registered, and refresh fixes it", () => {
    addArtifact({ root, source, title: "Plan", kind: "plan", description: "d", now });
    writeFileSync(join(artifactsDir(), "plan.html"), "changed");

    const errors = checkArtifacts(root);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /sha256 mismatch for plan/);

    refreshArtifact({ root, id: "plan", now });
    assert.deepEqual(checkArtifacts(root), []);
  });

  it("detects a file that is not registered", () => {
    addArtifact({ root, source, title: "Plan", kind: "plan", description: "d", now });
    writeFileSync(join(artifactsDir(), "orphan.html"), "x");
    assert.match(checkArtifacts(root)[0], /not in the index: orphan.html/);
  });

  it("detects a registered file that is missing", () => {
    addArtifact({ root, source, title: "Plan", kind: "plan", description: "d", now });
    rmSync(join(artifactsDir(), "plan.html"));
    assert.match(checkArtifacts(root)[0], /missing file for plan/);
  });

  it("rejects a file field that points outside the artifacts directory", () => {
    mkdirSync(artifactsDir(), { recursive: true });
    writeFileSync(
      join(artifactsDir(), "index.json"),
      JSON.stringify({
        schemaVersion: 1,
        artifacts: [
          { id: "bad", title: "Bad", kind: "other", description: "d", file: "../secret.txt", sha256: "0", bytes: 0 },
        ],
      }),
    );
    assert.match(checkArtifacts(root)[0], /file must be a plain file name/);
  });
});

describe("listArtifacts", () => {
  it("lists the newest artifact first", () => {
    addArtifact({ root, source, title: "Old", kind: "plan", description: "d", now: new Date("2026-01-01T00:00:00Z") });
    addArtifact({ root, source, title: "New", kind: "plan", description: "d", now });
    assert.deepEqual(
      listArtifacts(root).map((entry) => entry.id),
      ["new", "old"],
    );
  });
});

describe("store location", () => {
  it("keeps the index inside .context/artifacts", () => {
    addArtifact({ root, source, title: "Plan", kind: "plan", description: "d", now });
    assert.equal(existsSync(join(artifactsDir(), "index.json")), true);
  });
});
