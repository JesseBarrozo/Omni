import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ChatStore } from "../src/chat-store.mjs";
import { AgentWorkspace } from "../src/agent-workspace.mjs";
import { startWorkspaceServer } from "../src/workspace-server.mjs";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "omni-browser-"));
  const root = join(dir, "project");
  mkdirSync(root);
  writeFileSync(join(root, "AGENTS.md"), "Project instruction");
  mkdirSync(join(dir, "data"), { recursive: true });
  const store = new ChatStore(join(dir, "data/omni.sqlite"));
  const project = store.createProject("Browser Test", root);
  return { dir, root, store, project };
}

test("internal browser proxy endpoint validates URLs and serves HTML with base tag", async () => {
  const f = fixture();
  // Create a mock target HTTP server to proxy
  let targetHits = 0;
  const mockTarget = createServer((req, res) => {
    targetHits++;
    if (req.url === "/style.css") {
      res.writeHead(200, { "content-type": "text/css" });
      res.end("body { color: red; }");
      return;
    }
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "x-frame-options": "DENY",
      "content-security-policy": "frame-ancestors 'none'",
    });
    res.end(
      "<!DOCTYPE html><html><head><title>Mock Page</title></head><body><h1>Hello</h1></body></html>",
    );
  });
  await new Promise((resolve) => mockTarget.listen(0, "127.0.0.1", resolve));
  const targetPort = mockTarget.address().port;
  const targetUrl = `http://127.0.0.1:${targetPort}/page`;

  const workspace = new AgentWorkspace({
    store: f.store,
    cwd: f.root,
    dataDir: join(f.dir, "data"),
  });
  const app = await startWorkspaceServer({
    store: f.store,
    dataDir: join(f.dir, "data"),
    cwd: f.root,
    port: 0,
    workspace,
  });

  try {
    // 1. Missing URL
    let res = await fetch(app.url + "/api/browser/proxy");
    assert.equal(res.status, 400);
    let json = await res.json();
    assert.match(json.error, /manquant/i);

    // 2. Unsupported protocol
    res = await fetch(app.url + "/api/browser/proxy?url=javascript:alert(1)");
    assert.equal(res.status, 400);
    json = await res.json();
    assert.match(json.error, /invalide/i);

    // 3. Valid proxy request
    res = await fetch(
      app.url + `/api/browser/proxy?url=${encodeURIComponent(targetUrl)}`,
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-frame-options"), null); // Stripped!
    assert.equal(res.headers.get("content-security-policy"), null); // Stripped!
    const html = await res.text();
    assert.match(html, new RegExp(`<base href="${targetUrl}">`));
    assert.match(html, /Hello/);
    assert.equal(targetHits, 1);

    // 4. Proxied asset request
    const assetUrl = `http://127.0.0.1:${targetPort}/style.css`;
    res = await fetch(
      app.url + `/api/browser/proxy?url=${encodeURIComponent(assetUrl)}`,
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "text/css");
    const css = await res.text();
    assert.equal(css, "body { color: red; }");
  } finally {
    await app.close();
    await new Promise((resolve) => mockTarget.close(resolve));
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("browser URL normalization and title formatting match expected patterns", () => {
  function normalize(input) {
    const trimmed = input.trim();
    if (!trimmed || trimmed === "about:blank") return "about:blank";
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (/^\d{2,5}$/.test(trimmed)) return `http://localhost:${trimmed}`;
    if (/^localhost(:\d+)?(\/.*)?$/i.test(trimmed)) return `http://${trimmed}`;
    if (/^127\.0\.0\.1(:\d+)?(\/.*)?$/i.test(trimmed))
      return `http://${trimmed}`;
    if (/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(:\d+)?(\/.*)?$/i.test(trimmed)) {
      return `https://${trimmed}`;
    }
    return `https://duckduckgo.com/?q=${encodeURIComponent(trimmed)}`;
  }

  function formatTitle(url) {
    if (!url || url === "about:blank") return "Nouvel onglet";
    try {
      const parsed = new URL(url);
      if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
        return `Localhost${parsed.port ? `:${parsed.port}` : ""}`;
      }
      return parsed.hostname.replace(/^www\./, "");
    } catch {
      return url;
    }
  }

  assert.equal(normalize(""), "about:blank");
  assert.equal(normalize("about:blank"), "about:blank");
  assert.equal(normalize("5173"), "http://localhost:5173");
  assert.equal(normalize("3000"), "http://localhost:3000");
  assert.equal(normalize("localhost:8080/api"), "http://localhost:8080/api");
  assert.equal(normalize("127.0.0.1:4318"), "http://127.0.0.1:4318");
  assert.equal(normalize("github.com/my-repo"), "https://github.com/my-repo");
  assert.equal(normalize("https://example.com"), "https://example.com");
  assert.equal(
    normalize("react docs"),
    "https://duckduckgo.com/?q=react%20docs",
  );

  assert.equal(formatTitle("about:blank"), "Nouvel onglet");
  assert.equal(formatTitle("http://localhost:5173"), "Localhost:5173");
  assert.equal(formatTitle("http://127.0.0.1:4318"), "Localhost:4318");
  assert.equal(formatTitle("https://github.com/pulls"), "github.com");
  assert.equal(formatTitle("https://www.google.com/search"), "google.com");
});
