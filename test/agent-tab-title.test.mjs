import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveGeneratedTabTitle,
  isDefaultConversationTitle,
  GENERATED_TAB_TITLE_MAX_LENGTH,
  GENERATED_TAB_TITLE_SOURCE_SCAN_LIMIT,
} from "../src/agent-tab-title.mjs";

test("deriveGeneratedTabTitle derives a short title from the first useful prompt clause", () => {
  assert.equal(
    deriveGeneratedTabTitle(
      "Can you please refactor the auth middleware to use JWT tokens?",
    ),
    "Refactor the auth middleware to use JWT",
  );
});

test("deriveGeneratedTabTitle handles French filler phrases", () => {
  assert.equal(
    deriveGeneratedTabTitle(
      "Peux-tu corriger le bug de connexion s'il te plaît ?",
    ),
    "Corriger le bug de connexion",
  );

  assert.equal(
    deriveGeneratedTabTitle(
      "S'il te plaît, ajoute un bouton de validation dans le formulaire",
    ),
    "Ajoute un bouton de validation dans le",
  );

  assert.equal(
    deriveGeneratedTabTitle(
      "Je voudrais que tu implémentes le dark mode pour l'application",
    ),
    "Implémentes le dark mode pour l",
  );

  assert.equal(
    deriveGeneratedTabTitle("Aide-moi à configurer le serveur MCP"),
    "Configurer le serveur MCP",
  );
});

test("deriveGeneratedTabTitle strips markup, links, emoji, and punctuation", () => {
  assert.equal(
    deriveGeneratedTabTitle(
      "Please fix auth note #1 with `src/auth.ts`!!! https://example.com 🔥",
    ),
    "Fix auth note 1 with src auth",
  );
});

test("deriveGeneratedTabTitle preserves non-ASCII title text while folding Unicode whitespace", () => {
  assert.equal(
    deriveGeneratedTabTitle("Please 修正\u00a0résumé\t検索\u3000１２３!!!"),
    "修正 résumé 検索 １２３",
  );
});

test("deriveGeneratedTabTitle keeps useful text after common issue prefixes", () => {
  assert.equal(
    deriveGeneratedTabTitle("Issue #2056: Opt-in generated tab titles for agents"),
    "Opt in generated tab titles for agents",
  );
  assert.equal(
    deriveGeneratedTabTitle("Bug: Impossible de valider le panier"),
    "Impossible de valider le panier",
  );
});

test("deriveGeneratedTabTitle strips a URL containing underscores intact", () => {
  assert.equal(
    deriveGeneratedTabTitle(
      "inspect https://gitlab.com/g/p/-/work_items/9 then report",
    ),
    "Inspect then report",
  );
});

test("deriveGeneratedTabTitle strips a URL wrapped in markdown emphasis without leaking fragments", () => {
  const title = deriveGeneratedTabTitle(
    "Review _https://github.com/o/r/pull/5_ now",
  );
  assert.equal(title, "Review now");
  assert.ok(!/https|pull/.test(title));
});

test("deriveGeneratedTabTitle bounds titles to maximum length without adding punctuation", () => {
  const title = deriveGeneratedTabTitle(
    "I want to replace the terminal reconnection hydration flow with a safer retry path",
  );
  assert.ok(title);
  assert.ok(title.length <= GENERATED_TAB_TITLE_MAX_LENGTH);
  assert.ok(/^[\p{L}\p{N}\s]+$/u.test(title));
});

test("deriveGeneratedTabTitle returns null when the prompt has no useful title text", () => {
  assert.equal(deriveGeneratedTabTitle("please!!!"), null);
  assert.equal(deriveGeneratedTabTitle("s'il te plaît !!!"), null);
  assert.equal(deriveGeneratedTabTitle(""), null);
  assert.equal(deriveGeneratedTabTitle(null), null);
});

test("isDefaultConversationTitle identifies default and non-default titles", () => {
  assert.equal(isDefaultConversationTitle(null), true);
  assert.equal(isDefaultConversationTitle(""), true);
  assert.equal(isDefaultConversationTitle("Nouvelle conversation"), true);
  assert.equal(isDefaultConversationTitle("New conversation"), true);
  assert.equal(isDefaultConversationTitle("Nueva conversación"), true);
  assert.equal(isDefaultConversationTitle("Chat"), true);
  assert.equal(isDefaultConversationTitle("Chat 1"), true);
  assert.equal(isDefaultConversationTitle("Chat 42"), true);

  assert.equal(isDefaultConversationTitle("Refactor auth middleware"), false);
  assert.equal(isDefaultConversationTitle("Corriger le bug de connexion"), false);
});

test("workspace.run automatically names conversation with default title", async () => {
  const { mkdtempSync, mkdirSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { ChatStore } = await import("../src/chat-store.mjs");
  const { AgentWorkspace } = await import("../src/agent-workspace.mjs");

  const dir = mkdtempSync(join(tmpdir(), "omni-title-test-"));
  const root = join(dir, "proj");
  mkdirSync(root);
  const store = new ChatStore(join(dir, "omni.sqlite"));
  const project = store.createProject("Test", root);
  const conv = store.createConversation(
    project.id,
    "Nouvelle conversation",
    "codex",
  );

  const events = [];
  const workspace = new AgentWorkspace({
    store,
    dataDir: join(dir, "data"),
    adapterFactory: () => ({
      async initialize() {},
      async createSession() {
        return { id: "s1" };
      },
      async *run() {
        yield { type: "message.delta", payload: { delta: "Done" } };
        yield { type: "message.completed", payload: {} };
      },
    }),
  });
  workspace.on("event", (e) => events.push(e));

  try {
    await workspace.run({
      conversationId: conv.id,
      prompt: "Can you please refactor the auth middleware to use JWT tokens?",
    });

    const updated = store.conversation(conv.id);
    assert.equal(updated.title, "Refactor the auth middleware to use JWT");

    const renamedEvent = events.find((e) => e.type === "conversation.renamed");
    assert.ok(renamedEvent);
    assert.equal(
      renamedEvent.payload.title,
      "Refactor the auth middleware to use JWT",
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("workspace.run preserves manual/custom conversation titles", async () => {
  const { mkdtempSync, mkdirSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { ChatStore } = await import("../src/chat-store.mjs");
  const { AgentWorkspace } = await import("../src/agent-workspace.mjs");

  const dir = mkdtempSync(join(tmpdir(), "omni-title-custom-"));
  const root = join(dir, "proj");
  mkdirSync(root);
  const store = new ChatStore(join(dir, "omni.sqlite"));
  const project = store.createProject("Test", root);
  const conv = store.createConversation(
    project.id,
    "Mon titre personnalisé",
    "codex",
  );

  const workspace = new AgentWorkspace({
    store,
    dataDir: join(dir, "data"),
    adapterFactory: () => ({
      async initialize() {},
      async createSession() {
        return { id: "s1" };
      },
      async *run() {
        yield { type: "message.delta", payload: { delta: "Done" } };
        yield { type: "message.completed", payload: {} };
      },
    }),
  });

  try {
    await workspace.run({
      conversationId: conv.id,
      prompt: "Peux-tu corriger le bug de connexion ?",
    });

    const updated = store.conversation(conv.id);
    assert.equal(updated.title, "Mon titre personnalisé");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("workspace-server POST /api/conversations and generate-title auto-name conversations", async () => {
  const { mkdtempSync, mkdirSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { ChatStore } = await import("../src/chat-store.mjs");
  const { startWorkspaceServer } = await import("../src/workspace-server.mjs");

  const dir = mkdtempSync(join(tmpdir(), "omni-server-title-"));
  const root = join(dir, "proj");
  mkdirSync(root);
  const store = new ChatStore(join(dir, "omni.sqlite"));
  const project = store.createProject("Test", root);
  const app = await startWorkspaceServer({
    store,
    dataDir: join(dir, "data"),
    cwd: root,
    port: 0,
  });

  try {
    // 1. Create with prompt-like title
    const createRes = await fetch(`${app.url}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-omni-request": "1" },
      body: JSON.stringify({
        projectId: project.id,
        title: "Peux-tu configurer ESLint et Prettier pour le projet ?",
      }),
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    assert.equal(created.title, "Configurer ESLint et Prettier pour le");

    // 2. Create blank conversation, add user message, then call generate-title
    const blankRes = await fetch(`${app.url}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-omni-request": "1" },
      body: JSON.stringify({
        projectId: project.id,
        title: "Nouvelle conversation",
      }),
    });
    const blank = await blankRes.json();
    assert.equal(blank.title, "Nouvelle conversation");

    store.addMessage(
      blank.id,
      "user",
      "Ajoute les tests unitaires pour le composant Button",
    );

    const genRes = await fetch(
      `${app.url}/api/conversations/${blank.id}/generate-title`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-omni-request": "1" },
        body: JSON.stringify({}),
      },
    );
    assert.equal(genRes.status, 200);
    const generated = await genRes.json();
    assert.equal(
      generated.title,
      "Ajoute les tests unitaires pour le",
    );
  } finally {
    await app.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
