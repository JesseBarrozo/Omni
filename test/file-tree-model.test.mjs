import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ROOT, navigate, parentOf, sortEntries, visibleRows } from "../web/src/lib/file-tree-model.ts";

const file = (path) => ({ name: path.split("/").at(-1), path, directory: false });
const dir = (path) => ({ name: path.split("/").at(-1), path, directory: true });

function fixture() {
  const nodes = new Map([
    [ROOT, { entries: sortEntries([file("README.md"), dir("src"), dir("docs")]), loading: false, error: null }],
    ["src", { entries: sortEntries([file("src/main.ts"), dir("src/lib")]), loading: false, error: null }],
    ["src/lib", { entries: sortEntries([file("src/lib/util.ts")]), loading: false, error: null }],
    ["docs", { entries: [], loading: false, error: null }],
  ]);
  return nodes;
}

describe("sortEntries", () => {
  it("lists folders first, then names, numerically aware and case-insensitive", () => {
    const sorted = sortEntries([file("b.ts"), file("A10.ts"), dir("zeta"), file("a2.ts"), dir("Alpha")]);
    assert.deepEqual(sorted.map((e) => e.name), ["Alpha", "zeta", "a2.ts", "A10.ts", "b.ts"]);
  });
});

describe("parentOf", () => {
  it("returns the containing directory, or the root for top-level entries", () => {
    assert.equal(parentOf("src/lib/util.ts"), "src/lib");
    assert.equal(parentOf("README.md"), ROOT);
  });
});

describe("visibleRows", () => {
  it("shows only the children of expanded directories, with their depth", () => {
    const rows = visibleRows(fixture(), new Set(["src"]));
    assert.deepEqual(rows.map((r) => [r.path, r.depth, r.expanded]), [
      ["docs", 0, false],
      ["src", 0, true],
      ["src/lib", 1, false],
      ["src/main.ts", 1, false],
      ["README.md", 0, false],
    ]);
  });
});

describe("navigate", () => {
  const rows = visibleRows(fixture(), new Set(["src"]));

  it("moves the selection with the arrow keys and Home/End", () => {
    assert.deepEqual(navigate(rows, "src", "ArrowDown"), { type: "select", path: "src/lib" });
    assert.deepEqual(navigate(rows, "README.md", "ArrowUp"), { type: "select", path: "src/main.ts" });
    assert.deepEqual(navigate(rows, "docs", "Home"), { type: "select", path: "docs" });
    assert.deepEqual(navigate(rows, "docs", "End"), { type: "select", path: "README.md" });
  });

  it("starts from the first row when nothing is selected", () => {
    assert.deepEqual(navigate(rows, null, "ArrowDown"), { type: "select", path: "docs" });
  });

  it("expands a collapsed directory with ArrowRight, then enters its first child", () => {
    assert.deepEqual(navigate(rows, "docs", "ArrowRight"), { type: "expand", path: "docs" });
    const closed = visibleRows(fixture(), new Set());
    assert.deepEqual(navigate(closed, "src", "ArrowRight"), { type: "expand", path: "src" });
    assert.deepEqual(navigate(rows, "src", "ArrowRight"), { type: "select", path: "src/lib" });
  });

  it("collapses an open directory with ArrowLeft, else moves to its parent", () => {
    assert.deepEqual(navigate(rows, "src", "ArrowLeft"), { type: "collapse", path: "src" });
    assert.deepEqual(navigate(rows, "src/main.ts", "ArrowLeft"), { type: "select", path: "src" });
    assert.deepEqual(navigate(rows, "README.md", "ArrowLeft"), { type: "none" });
  });
});
