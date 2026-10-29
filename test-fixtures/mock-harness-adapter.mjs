import { randomUUID } from "node:crypto";

// Test-only adapter. Never import this fixture from production modules.
export class MockHarnessAdapter {
  constructor({ id = "mock", name = "Mock Harness", events } = {}) {
    this.id = id;
    this.name = name;
    this.events = events;
    this.sessions = new Map();
    this.capabilityInfo = {
      tools: true,
      streaming: true,
      checkpoint: true,
      permissions: true,
    };
  }

  async initialize() {}

  async capabilities() {
    return this.capabilityInfo;
  }

  async createSession(input) {
    const session = { id: randomUUID(), harnessId: this.id, ...input };
    this.sessions.set(session.id, session);
    return session;
  }

  async *run(input) {
    const sessionId = input.sessionId ?? (await this.createSession(input)).id;
    const conversationId = input.conversationId;
    const text = input.response ?? `Mock response for: ${input.prompt}`;
    for (const delta of text.match(/.{1,24}/gs) ?? [text]) {
      if (this.sessions.get(sessionId)?.interrupted) return;
      await Promise.resolve();
      yield {
        conversationId,
        type: "message.delta",
        payload: { sessionId, delta },
      };
    }
    yield {
      conversationId,
      type: "message.completed",
      payload: { sessionId, content: text },
    };
  }

  async interrupt(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) session.interrupted = true;
  }

  async checkpoint(sessionId) {
    return {
      id: randomUUID(),
      sessionId,
      createdAt: new Date().toISOString(),
      state: "mock",
    };
  }

  async resumeSession(sessionId) {
    if (!this.sessions.has(sessionId))
      throw new Error(`Unknown harness session: ${sessionId}`);
  }

  async dispose() {
    this.sessions.clear();
  }
}
