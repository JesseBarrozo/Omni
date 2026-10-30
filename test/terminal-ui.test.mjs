import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { TerminalUI, terminalFrame } from "../src/terminal-ui.mjs";

test("terminal layout anchors its editor and adapts to terminal size and multiline input", () => {
  for (const [columns, rows] of [
    [120, 40],
    [80, 24],
    [40, 16],
  ]) {
    const frame = terminalFrame({
      columns,
      rows,
      model: "model",
      cwd: "/project",
      color: false,
    });
    assert.equal(frame.lines.length, rows);
    assert.match(frame.lines[rows - 6], /Demandez/);
    assert.ok(frame.cursor.row < rows);
    assert.ok(frame.lines.every((line) => [...line].length <= columns));
    assert.equal(
      frame.lines.some((line) => line.includes("\x1b")),
      false,
    );
    const multiline = terminalFrame({
      columns,
      rows,
      model: "model",
      input: "first\nsecond\nthird",
      color: false,
    });
    assert.ok(multiline.lines.some((line) => line.includes("third")));
    assert.equal(multiline.cursor.row, rows - 4);
  }
});

test("terminal viewport scrolls responses and strips terminal control sequences", () => {
  const messages = [
    {
      role: "assistant",
      text:
        Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n") +
        "\x1b[2J",
    },
  ];
  const latest = terminalFrame({
    columns: 80,
    rows: 24,
    messages,
    color: false,
  });
  assert.ok(latest.lines.some((line) => line.includes("line 49")));
  assert.ok(!latest.lines.some((line) => line.includes("\x1b")));
  const earlier = terminalFrame({
    columns: 80,
    rows: 24,
    messages,
    color: false,
    scroll: 10,
  });
  assert.ok(!earlier.lines.some((line) => line.includes("line 49")));
  assert.ok(earlier.lines.some((line) => line.includes("line 39")));
});

test("terminal editor handles Unicode, multiline paste, cancellation and restores terminal state", async () => {
  const input = new PassThrough();
  input.setRawMode = (value) => {
    input.isRaw = value;
  };
  const output = new PassThrough();
  output.columns = 80;
  output.rows = 24;
  let written = "";
  output.on("data", (chunk) => (written += chunk));
  const ui = new TerminalUI({ input, output, model: "model", cwd: "/project" });
  try {
    const answer = ui.question();
    ui.key("A😀", {});
    ui.key("", { name: "backspace" });
    assert.equal(ui.draft, "A");
    ui.key("", { sequence: "\x1b[200~" });
    ui.key("\r", { name: "return" });
    ui.key("B", {});
    ui.key("", { sequence: "\x1b[201~" });
    assert.equal(ui.draft, "A\nB");
    ui.key("\r", { name: "return" });
    assert.equal(await answer, "A\nB");
    let aborted = false;
    ui.on("SIGINT", () => (aborted = true));
    ui.startAnswer("prompt");
    ui.delta("partial");
    ui.key("", { name: "escape" });
    assert.equal(aborted, true);
    assert.equal(ui.messages.at(-1).text, "partial");
    ui.finish();
    ui.key("/help", {});
    ui.key("\r", { name: "return" });
    assert.equal(await ui.question(), "/help");
    const pending = ui.question();
    ui.close();
    assert.equal(await pending, "/quit");
    assert.equal(input.isRaw, false);
    assert.ok(written.includes("\x1b[?1049l"));
    assert.equal(input.listenerCount("keypress"), 0);
  } finally {
    ui.close();
  }
});
