import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PREVIEW_HEADERS, isPreviewablePath } from "../src/artifact-preview.mjs";

describe("isPreviewablePath", () => {
  it("accepts HTML files inside the artifact directories", () => {
    assert.equal(isPreviewablePath(".context/artifacts/plan.html"), true);
    assert.equal(isPreviewablePath("artifacts/report.htm"), true);
    assert.equal(isPreviewablePath("outputs/deck/index.HTML"), true);
  });

  it("rejects HTML outside the artifact directories", () => {
    assert.equal(isPreviewablePath("src/app.html"), false);
    assert.equal(isPreviewablePath("index.html"), false);
  });

  it("rejects other file types and traversal", () => {
    assert.equal(isPreviewablePath("artifacts/notes.md"), false);
    assert.equal(isPreviewablePath("artifacts/../secret.html"), false);
    assert.equal(isPreviewablePath("/artifacts/x.html"), false);
    assert.equal(isPreviewablePath("artifacts\\..\\secret.html"), false);
  });
});

describe("PREVIEW_HEADERS", () => {
  it("sandboxes the document without same-origin access to the workspace API", () => {
    const csp = PREVIEW_HEADERS["content-security-policy"];
    assert.match(csp, /^sandbox /);
    assert.doesNotMatch(csp, /allow-same-origin/);
    assert.equal(PREVIEW_HEADERS["content-type"], "text/html; charset=utf-8");
  });
});
