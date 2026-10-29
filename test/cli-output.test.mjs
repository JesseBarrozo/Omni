import test from "node:test";
import assert from "node:assert/strict";
import { serializeJsonLine } from "../src/cli-output.mjs";

test("CLI JSONL events have a stable versioned envelope and one JSON line", () => {
  const line = serializeJsonLine("message.delta", { delta: "hello\nworld" });
  assert.equal(line.includes("\n"), false);
  assert.deepEqual(JSON.parse(line), {
    delta: "hello\nworld",
    version: 1,
    type: "message.delta",
  });
});

test("CLI event payload cannot override the envelope type or version", () => {
  assert.deepEqual(
    JSON.parse(
      serializeJsonLine("run.completed", { type: "secret", version: 9 }),
    ),
    { version: 1, type: "run.completed" },
  );
});
