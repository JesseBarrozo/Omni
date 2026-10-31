import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  symlinkSync,
  realpathSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { ChatStore } from "../src/chat-store.mjs";
import { AgentWorkspace } from "../src/agent-workspace.mjs";
import { readProjectContext, containedFile, isEphemeralPath } from "../src/project-context.mjs";
import { startWorkspaceServer } from "../src/workspace-server.mjs";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "omni-workspace-"));
  const root = join(dir, "project");
  mkdirSync(root);
  writeFileSync(join(dir, "AGENTS.md"), "Parent instruction: use dotcontext.");
  writeFileSync(
    join(root, "AGENTS.md"),
    "Project instruction: inspect before writing.",
  );
  mkdirSync(join(root, ".context"));
  writeFileSync(
    join(root, ".context/README.md"),
    "dotcontext owns the workflow.",
  );
  const store = new ChatStore(join(dir, "data/omni.sqlite"));
  const project = store.createProject("Test workspace", root);
  const conversation = store.createConversation(project.id, "Test", "codex");
  return {
    dir,
    root,
    store,
    project,
    conversation,
    close() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
function adapterFactory(
  probe,
  { approval = false, fail = false, wait = false } = {},
) {
  return ({ store, requestPermission, cwd, harnessId }) => ({
    id: harnessId,
    async initialize() {},
    async createSession({ conversationId }) {
      probe.created++;
      store.appendEvent(conversationId, "session.started", {
        harnessId,
        sessionId: `${harnessId}-session-${probe.created}`,
      });
      return { id: `${harnessId}-session-${probe.created}` };
    },
    async resumeSession(id) {
      probe.resumed++;
      return { id };
    },
    async *run({ prompt, signal }) {
      probe.prompt = prompt;
      if (approval) {
        const allowed = await requestPermission(
          { toolName: "Write", input: { path: "approved.txt" } },
          signal,
        );
        probe.approved = allowed;
        if (allowed) writeFileSync(join(cwd, "approved.txt"), "executed once");
      }
      if (wait) {
        await new Promise((resolve) =>
          signal.addEventListener("abort", resolve, { once: true }),
        );
        yield { type: "session.interrupted", payload: {} };
        return;
      }
      if (fail) throw new Error("fixture failure");
      yield {
        type: "message.delta",
        payload: { delta: "Réponse réelle du contrat de test." },
      };
      yield { type: "message.completed", payload: {} };
    },
    async checkpoint() {
      return { id: "checkpoint-test" };
    },
    async interrupt() {
      probe.cancelled = true;
    },
    async dispose() {
      probe.disposed = true;
    },
  });
}
const probe = () => ({ created: 0, resumed: 0 });

test("switching back to a harness starts a fresh session with the intervening conversation", async () => {
  const f = fixture(),
    p = probe();
  try {
    const workspace = new AgentWorkspace({
      store: f.store,
      dataDir: join(f.dir, "data"),
      adapterFactory: adapterFactory(p),
    });
    await workspace.run({
      conversationId: f.conversation.id,
      prompt: "Première demande",
      harnessId: "codex",
    });
    await workspace.run({
      conversationId: f.conversation.id,
      prompt: "Décision avec Claude",
      harnessId: "claude-code",
    });
    await workspace.run({
      conversationId: f.conversation.id,
      prompt: "Reprendre avec Codex",
      harnessId: "codex",
    });
    assert.equal(p.created, 3);
    assert.equal(p.resumed, 0);
    assert.match(p.prompt, /Décision avec Claude/);
    assert.match(p.prompt, /Première demande/);
  } finally {
    f.close();
  }
});

test("workspace injects project/ancestor instructions and reuses durable adapter sessions after restart", async () => {
  const f = fixture(),
    p = probe();
  try {
    let workspace = new AgentWorkspace({
      store: f.store,
      dataDir: join(f.dir, "data"),
      adapterFactory: adapterFactory(p),
    });
    await workspace.run({
      conversationId: f.conversation.id,
      prompt: "Mets à jour dotcontext",
    });
    assert.match(p.prompt, /Parent instruction/);
    assert.match(p.prompt, /Project instruction/);
    assert.match(p.prompt, /pas DbContext/);
    assert.match(p.prompt, /dotcontext owns/);
    assert.equal(
      f.store.conversation(f.conversation.id).messages[0].content,
      "Mets à jour dotcontext",
    );
    assert.equal(f.store.conversation(f.conversation.id).status, "completed");
    workspace = new AgentWorkspace({
      store: f.store,
      dataDir: join(f.dir, "data"),
      adapterFactory: adapterFactory(p),
    });
    await workspace.run({
      conversationId: f.conversation.id,
      prompt: "Continue",
    });
    assert.equal(p.created, 1);
    assert.equal(p.resumed, 1);
    assert.equal(f.store.conversation(f.conversation.id).messages.length, 4);
  } finally {
    f.close();
  }
});

test("workspace gates each action, refuses reused approvals and cancels unresolved permission requests", async () => {
  const f = fixture(),
    p = probe();
  const workspace = new AgentWorkspace({
    store: f.store,
    dataDir: join(f.dir, "data"),
    adapterFactory: adapterFactory(p, { approval: true }),
  });
  try {
    let used;
    workspace.on("event", (e) => {
      if (e.type === "approval.requested") {
        used = e.payload.id;
        workspace.approve(used, true);
      }
    });
    await workspace.run({
      conversationId: f.conversation.id,
      prompt: "Write approved",
    });
    assert.equal(
      readFileSync(join(f.root, "approved.txt"), "utf8"),
      "executed once",
    );
    assert.throws(() => workspace.approve(used, true), /expiré|traitée/);
    workspace.removeAllListeners("event");
    workspace.on("event", (e) => {
      if (e.type === "approval.requested") workspace.cancel(f.conversation.id);
    });
    const result = await workspace.run({
      conversationId: f.conversation.id,
      prompt: "Must cancel",
    });
    assert.equal(result.status, "interrupted");
    assert.equal(p.approved, false);
    assert.equal(workspace.permissions.size, 0);
  } finally {
    await workspace.close();
    f.close();
  }
});

test("permission modes apply to adapter requests for the selected turn", async () => {
  const f = fixture(),
    p = probe();
  const workspace = new AgentWorkspace({
    store: f.store,
    dataDir: join(f.dir, "data"),
    adapterFactory: adapterFactory(p, { approval: true }),
  });
  try {
    let pending = 0;
    workspace.on("event", (event) => {
      if (event.type === "approval.requested") pending++;
    });
    await workspace.run({
      conversationId: f.conversation.id,
      prompt: "Deny",
      permissionMode: "deny",
    });
    assert.equal(p.approved, false);
    assert.equal(existsSync(join(f.root, "approved.txt")), false);
    await workspace.run({
      conversationId: f.conversation.id,
      prompt: "Allow",
      permissionMode: "allow",
    });
    assert.equal(p.approved, true);
    assert.equal(
      readFileSync(join(f.root, "approved.txt"), "utf8"),
      "executed once",
    );
    assert.equal(pending, 0);
    await assert.rejects(
      workspace.run({
        conversationId: f.conversation.id,
        prompt: "Invalid",
        permissionMode: "invalid",
      }),
      /permission invalide/i,
    );
  } finally {
    await workspace.close();
    f.close();
  }
});

test("workspace refuses concurrent runs and reports failed adapters without inventing success", async () => {
  const f = fixture(),
    p = probe();
  const workspace = new AgentWorkspace({
    store: f.store,
    dataDir: join(f.dir, "data"),
    adapterFactory: adapterFactory(p, { approval: true }),
  });
  try {
    const request = new Promise((resolve) => workspace.once("event", resolve));
    const running = workspace.run({
      conversationId: f.conversation.id,
      prompt: "Hold",
    });
    await request;
    assert.equal(workspace.snapshot().runs[0].projectId, f.project.id);
    await assert.rejects(
      workspace.run({ conversationId: f.conversation.id, prompt: "Duplicate" }),
      /déjà active/,
    );
    workspace.cancel(f.conversation.id);
    await running;
    workspace.adapterFactory = adapterFactory(p, { fail: true });
    await assert.rejects(
      workspace.run({ conversationId: f.conversation.id, prompt: "Fail" }),
      /fixture failure/,
    );
    assert.equal(f.store.conversation(f.conversation.id).status, "failed");
    assert.equal(workspace.active.size, 0);
  } finally {
    await workspace.close();
    f.close();
  }
});

test("project context cannot escape the root through symlinks or disclose excluded API files", async () => {
  const f = fixture();
  try {
    const context = await readProjectContext(f.root);
    assert.equal(context.root, realpathSync(f.root));
    assert.ok(context.files.length >= 3);
    symlinkSync(join(f.dir, "AGENTS.md"), join(f.root, "outside.md"));
    await assert.rejects(containedFile(f.root, "outside.md"), /sort du projet/);
  } finally {
    f.close();
  }
});

test("GUI API shares SQLite, serves real context/files and rejects cross-origin mutations", async () => {
  const f = fixture(),
    p = probe();
  const workspace = new AgentWorkspace({
    store: f.store,
    dataDir: join(f.dir, "data"),
    adapterFactory: adapterFactory(p, { approval: true }),
  });
  const app = await startWorkspaceServer({
    store: f.store,
    dataDir: join(f.dir, "data"),
    cwd: f.root,
    port: 0,
    workspace,
  });
  const post = (path, body, headers = {}) =>
    fetch(app.url + "/api" + path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-omni-request": "1",
        ...headers,
      },
      body: JSON.stringify(body),
    });
  try {
    writeFileSync(join(f.root, ".env"), "SECRET=no-echo");
    let response = await fetch(app.url + "/api/state");
    const state = await response.json();
    assert.equal(state.projects.length, 1);
    assert.equal(state.mcpServers[0].name, "dotcontext");
    response = await fetch(app.url + `/api/projects/${f.project.id}/context`);
    assert.ok(
      (await response.json()).files.some((f) => f.path.endsWith("AGENTS.md")),
    );
    response = await fetch(app.url + `/api/projects/${f.project.id}/files`);
    assert.ok(!(await response.json()).some((f) => f.name === ".env"));
    response = await fetch(
      app.url + `/api/projects/${f.project.id}/file?path=.env`,
    );
    assert.equal(response.status, 400);
    symlinkSync(join(f.root, ".env"), join(f.root, "visible-link"));
    response = await fetch(
      app.url + `/api/projects/${f.project.id}/file?path=visible-link`,
    );
    assert.equal(response.status, 400);
    const fileUrl = `/projects/${f.project.id}/file`;
    writeFileSync(join(f.root, "editable.txt"), "initial\n");
    const opened = await (
      await fetch(app.url + `/api${fileUrl}?path=editable.txt`)
    ).json();
    response = await post(fileUrl, {
      path: "editable.txt",
      content: "saved\n",
      revision: opened.revision,
    });
    assert.equal(response.status, 200);
    assert.equal(readFileSync(join(f.root, "editable.txt"), "utf8"), "saved\n");
    response = await post(fileUrl, {
      path: "editable.txt",
      content: "stale",
      revision: opened.revision,
    });
    assert.equal(response.status, 409);
    assert.equal(readFileSync(join(f.root, "editable.txt"), "utf8"), "saved\n");
    response = await post(fileUrl, {
      path: ".env",
      content: "bad",
      revision: opened.revision,
    });
    assert.equal(response.status, 400);
    execFileSync("git", ["init", "-q"], { cwd: f.root });
    execFileSync("git", ["config", "user.name", "Omni test"], { cwd: f.root });
    execFileSync("git", ["config", "user.email", "test@example.invalid"], {
      cwd: f.root,
    });
    response = await post(`/projects/${f.project.id}/git-generate-message`, {
      harnessId: "codex",
      model: "codex",
    });
    assert.equal(response.status, 200);
    assert.match(p.prompt, /saved/);
    assert.equal(
      execFileSync("git", ["diff", "--cached", "--name-only"], {
        cwd: f.root,
        encoding: "utf8",
      }),
      "",
    );
    response = await post(`/projects/${f.project.id}/git-stage`, {
      path: "editable.txt",
    });
    assert.equal(response.status, 200);
    response = await post(`/projects/${f.project.id}/git-unstage`, {
      path: "editable.txt",
    });
    assert.equal(response.status, 200);
    assert.equal(readFileSync(join(f.root, "editable.txt"), "utf8"), "saved\n");
    response = await post(`/projects/${f.project.id}/git-stage`, {
      path: "editable.txt",
    });
    assert.equal(response.status, 200);
    response = await fetch(
      app.url +
        `/api/projects/${f.project.id}/git-file-diff?path=editable.txt&staged=true`,
    );
    assert.match((await response.json()).content, /saved/);
    response = await post(`/projects/${f.project.id}/git-generate-message`, {
      harnessId: "codex",
      model: "codex",
    });
    assert.equal(response.status, 200);
    assert.equal(
      (await response.json()).message,
      "Réponse réelle du contrat de test.",
    );
    assert.equal(p.approved, false);
    assert.match(p.prompt, /saved/);
    assert.equal(
      f.store.conversations(f.project.id, { archived: true }).length,
      0,
    );
    response = await post(`/projects/${f.project.id}/git-commit`, {
      message: "Initial test",
    });
    assert.equal(response.status, 200);
    response = await post(`/projects/${f.project.id}/git-branch`, {
      name: "feature-test",
      create: true,
    });
    assert.equal(response.status, 200);
    response = await fetch(app.url + `/api/projects/${f.project.id}/git`);
    const git = await response.json();
    assert.equal(git.branch, "feature-test");
    assert.equal(git.history[0].subject, "Initial test");
    assert.equal(git.history[0].author, "Omni test");
    assert.deepEqual(git.history[0].parents, []);
    assert.ok(git.history[0].refs.includes("feature-test"));
    response = await fetch(
      app.url +
        `/api/projects/${f.project.id}/git-commit-detail?hash=${git.history[0].id}`,
    );
    assert.equal(response.status, 200);
    assert.match((await response.json()).content, /Initial test/);
    response = await fetch(
      app.url + `/api/projects/${f.project.id}/git-commit-detail?hash=HEAD`,
    );
    assert.equal(response.status, 400);
    response = await fetch(app.url + `/api/projects/${f.project.id}/summary`);
    assert.equal((await response.json()).branch, "feature-test");
    response = await fetch(
      app.url +
        `/api/projects/${f.project.id}/github-tasks?kind=issues&filter=review`,
    );
    assert.equal(response.status, 400);
    response = await fetch(app.url + `/api/settings/accounts?provider=unknown`);
    assert.equal(response.status, 400);
    response = await post("/settings/registry", {
      type: "bogus",
      id: "x",
      enabled: true,
    });
    assert.equal(response.status, 400);
    response = await post(
      "/conversations",
      { projectId: f.project.id },
      { origin: "https://evil.example" },
    );
    assert.equal(response.status, 403);
    response = await fetch(app.url + "/api/conversations", {
      method: "POST",
      body: "{}",
    });
    assert.equal(response.status, 403);
    const pending = new Promise((resolve) =>
      workspace.on("event", (e) => {
        if (e.type === "approval.requested") resolve(e.payload);
      }),
    );
    response = await post("/runs", {
      conversationId: f.conversation.id,
      harnessId: "codex",
      model: "codex",
      prompt: "Approved API action",
    });
    assert.equal(response.status, 202);
    const approval = await pending;
    assert.equal(existsSync(join(f.root, "approved.txt")), false);
    const finished = new Promise((resolve) =>
      workspace.on("event", (e) => {
        if (e.type === "run.finished") resolve();
      }),
    );
    response = await post(`/approvals/${approval.id}`, { allowed: true });
    assert.equal(response.status, 200);
    await finished;
    assert.equal(existsSync(join(f.root, "approved.txt")), true);
    response = await post(`/approvals/${approval.id}`, { allowed: true });
    assert.equal(response.status, 400);
    response = await fetch(app.url + `/api/conversations/${f.conversation.id}`);
    assert.equal((await response.json()).messages.length, 2);
  } finally {
    await app.close();
    f.close();
  }
});

test("workspace API discovers, opens and safely removes Git worktrees", async () => {
  const f = fixture();
  const git = (args, cwd = f.root) =>
    execFileSync("git", args, { cwd, stdio: "ignore" });
  git(["init"]);
  git(["config", "user.name", "Omni Test"]);
  git(["config", "user.email", "omni@example.invalid"]);
  git(["add", "."]);
  git(["commit", "-m", "initial"]);
  const app = await startWorkspaceServer({
    store: f.store,
    dataDir: join(f.dir, "data"),
    cwd: f.root,
    port: 0,
  });
  const endpoint = `/api/projects/${f.project.id}`;
  const post = (action, body) =>
    fetch(`${app.url}${endpoint}/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-omni-request": "1" },
      body: JSON.stringify(body),
    });
  const target = join(f.dir, "feature-worktree");
  try {
    let response = await post("worktree-create", {
      path: target,
      branch: "feature/omni",
    });
    assert.equal(response.status, 201, await response.text());
    let summary = await (await fetch(`${app.url}${endpoint}/summary`)).json();
    assert.equal(summary.worktrees.length, 2);
    assert.equal(summary.worktrees[0].mainWorktree, true);
    const created = summary.worktrees.find(
      (item) => item.branch === "feature/omni",
    );
    assert.ok(created?.projectId);
    response = await post("remove", {});
    assert.equal(response.status, 200);
    const removed = await response.json();
    assert.ok(removed.removedIds.includes(f.project.id));
    assert.ok(removed.removedIds.includes(created.projectId));
    assert.equal(existsSync(f.root), true);
    assert.equal(existsSync(target), true);
    assert.equal(f.store.projects().length, 0);
    assert.equal((await post("restore", {})).status, 200);
    assert.equal(
      (
        await fetch(`${app.url}/api/projects/${created.projectId}/restore`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-omni-request": "1",
          },
          body: "{}",
        })
      ).status,
      200,
    );
    response = await post("worktree-open", { path: created.path });
    assert.equal((await response.json()).id, created.projectId);
    writeFileSync(join(target, "untracked.txt"), "unsaved work");
    response = await post("worktree-remove", { path: created.path });
    assert.equal(response.status, 400);
    assert.equal(existsSync(join(target, "untracked.txt")), true);
    rmSync(join(target, "untracked.txt"));
    response = await post("worktree-remove", { path: created.path });
    assert.equal(response.status, 200, await response.text());
    assert.equal(existsSync(target), false);
    summary = await (await fetch(`${app.url}${endpoint}/summary`)).json();
    assert.equal(summary.worktrees.length, 1);
    assert.ok(
      f.store
        .archivedProjects()
        .some((project) => project.id === created.projectId),
    );
  } finally {
    await app.close();
    f.close();
  }
});

test("conversations can be renamed, archived, restored and explicitly deleted", async () => {
  const f = fixture();
  const app = await startWorkspaceServer({
    store: f.store,
    dataDir: join(f.dir, "data"),
    cwd: f.root,
    port: 0,
  });
  const base = `${app.url}/api/conversations/${f.conversation.id}`;
  const post = (path, body = {}) =>
    fetch(`${base}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-omni-request": "1" },
      body: JSON.stringify(body),
    });
  const list = (archived = false) =>
    fetch(
      `${app.url}/api/projects/${f.project.id}/conversations?archived=${archived}`,
    ).then((r) => r.json());
  try {
    f.store.addMessage(f.conversation.id, "user", "secret conversation");
    let response = await post("rename", { title: "Nouveau titre" });
    assert.equal((await response.json()).title, "Nouveau titre");
    response = await post("archive");
    assert.equal(response.status, 200);
    assert.equal((await list()).length, 0);
    assert.equal((await list(true)).length, 1);
    assert.equal(
      f.store.searchConversations("Nouveau", f.project.id).length,
      0,
    );
    response = await fetch(`${app.url}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-omni-request": "1" },
      body: JSON.stringify({
        conversationId: f.conversation.id,
        prompt: "test",
      }),
    });
    assert.equal(response.status, 400);
    assert.equal((await post("restore")).status, 200);
    assert.equal((await list()).length, 1);
    f.store.setStatus(f.conversation.id, "running");
    assert.equal((await post("delete")).status, 400);
    assert.equal((await post("archive")).status, 400);
    f.store.setStatus(f.conversation.id, "completed");
    assert.equal((await post("delete")).status, 200);
    assert.throws(() => f.store.conversation(f.conversation.id), /introuvable/);
    assert.equal(
      f.store.db
        .prepare("SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?")
        .get(f.conversation.id).n,
      0,
    );
    assert.equal(
      f.store.db
        .prepare(
          "SELECT COUNT(*) AS n FROM conversation_events WHERE conversation_id = ?",
        )
        .get(f.conversation.id).n,
      0,
    );
    const other = f.store.createConversation(f.project.id, "Other", "codex");
    f.store.addMessage(other.id, "user", "protected");
    assert.throws(
      () =>
        f.store.db
          .prepare("DELETE FROM conversation_events WHERE conversation_id = ?")
          .run(other.id),
      /append-only/,
    );
  } finally {
    await app.close();
    f.close();
  }
});

test("source control stages and unstages changes safely and shows file diffs", async () => {
  const f = fixture();
  const git = (args) =>
    execFileSync("git", args, { cwd: f.root, encoding: "utf8" });
  git(["init", "-q"]);
  git(["config", "user.name", "Test"]);
  git(["config", "user.email", "test@example.invalid"]);
  writeFileSync(join(f.root, "base.txt"), "before\n");
  git(["add", "base.txt"]);
  git(["commit", "-qm", "initial"]);
  writeFileSync(join(f.root, "base.txt"), "after\n");
  writeFileSync(join(f.root, "new.txt"), "new file\n");
  writeFileSync(join(f.root, ".env"), "PRIVATE=secret\n");
  const app = await startWorkspaceServer({
    store: f.store,
    dataDir: join(f.dir, "data"),
    cwd: f.root,
    port: 0,
  });
  const base = `${app.url}/api/projects/${f.project.id}`;
  const post = (action, body = {}) =>
    fetch(`${base}/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-omni-request": "1" },
      body: JSON.stringify(body),
    });
  try {
    let response = await fetch(
      `${base}/git-file-diff?path=base.txt&staged=false`,
    );
    assert.match((await response.json()).content, /after/);
    response = await fetch(`${base}/git-file-diff?path=new.txt&untracked=true`);
    assert.match((await response.json()).content, /new file/);
    assert.equal((await post("git-stage-all")).status, 200);
    const staged = git(["diff", "--cached", "--name-only"]);
    assert.match(staged, /base.txt/);
    assert.match(staged, /new.txt/);
    assert.doesNotMatch(staged, /\.env/);
    assert.equal((await post("git-unstage-all")).status, 200);
    assert.equal(git(["diff", "--cached", "--name-only"]), "");
    assert.equal(readFileSync(join(f.root, "base.txt"), "utf8"), "after\n");
    assert.equal(readFileSync(join(f.root, "new.txt"), "utf8"), "new file\n");
    assert.equal((await post("git-stage", { path: "../outside" })).status, 400);
  } finally {
    await app.close();
    f.close();
  }
});

test("isEphemeralPath identifies scratchpad, claude, and temporary test directories", () => {
  assert.equal(
    isEphemeralPath("/private/tmp/claude-501/-Users-barrozo-Github-Omni-Project/scratchpad/ops-DzwA"),
    true,
  );
  assert.equal(
    isEphemeralPath("/tmp/claude-501/scratchpad/ops-i9EY"),
    true,
  );
  assert.equal(
    isEphemeralPath("/tmp/omni-openai-oauth.TwV3uu"),
    true,
  );
  assert.equal(
    isEphemeralPath("/private/tmp/ops-DzwA"),
    true,
  );
  assert.equal(
    isEphemeralPath("/private/tmp/demo-Y2g8"),
    true,
  );
  assert.equal(
    isEphemeralPath("/Users/barrozo/Github/Omni-Project/Omni"),
    false,
  );
  assert.equal(
    isEphemeralPath("/var/folders/xx/T/omni-workspace-abc/project"),
    false,
  );
  assert.equal(
    isEphemeralPath(null),
    false,
  );
});

test("workspace server filters out ephemeral projects from /api/state", async () => {
  const f = fixture();
  f.store.createProject("Ghost Project", "/private/tmp/claude-501/scratchpad/ops-test");
  const app = await startWorkspaceServer({
    store: f.store,
    dataDir: join(f.dir, "data"),
    cwd: f.root,
    port: 0,
    workspace: new AgentWorkspace({ cwd: f.root, store: f.store, dataDir: join(f.dir, "data") }),
  });
  try {
    const res = await fetch(app.url + "/api/state");
    const state = await res.json();
    assert.equal(state.projects.length, 1);
    assert.equal(state.projects[0].id, f.project.id);
    assert.ok(!state.projects.some((p) => p.name === "Ghost Project"));
  } finally {
    await app.close();
    f.close();
  }
});
