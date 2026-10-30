import { EventEmitter } from "node:events";
import { emitKeypressEvents } from "node:readline";
import { homedir } from "node:os";
import { logoRows } from "./terminal-logo.mjs";

const reset = "\x1b[0m";
const tones = {
  gold: "\x1b[38;2;255;210;129m",
  dim: "\x1b[90m",
  white: "\x1b[1;37m",
};
const clean = (text) =>
  String(text)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "")
    .replace(/\t/g, "    ");
const cellWidth = (char) =>
  /\p{Mark}/u.test(char)
    ? 0
    : /[\u1100-\u115f\u2329\u232a\u2e80-\ua4cf\uac00-\ud7af\uf900-\ufaff\ufe10-\ufe6f\uff00-\uff60\uffe0-\uffe6\u{1f300}-\u{1faff}]/u.test(
          char,
        )
      ? 2
      : 1;
function fit(text, width) {
  let result = "",
    used = 0;
  for (const char of clean(text)) {
    const size = cellWidth(char);
    if (used + size > width) break;
    result += char;
    used += size;
  }
  return result;
}
function wrap(text, width) {
  const lines = [];
  for (const paragraph of clean(text).split("\n")) {
    let line = "",
      used = 0;
    for (const char of paragraph) {
      const size = cellWidth(char);
      if (used + size > width) {
        lines.push(line);
        line = "";
        used = 0;
      }
      line += char;
      used += size;
    }
    lines.push(line);
  }
  return lines;
}

// The same frame is used by the live terminal and the offline visual preview.
export function terminalFrame({
  columns = 100,
  rows = 32,
  model = "",
  cwd = "",
  messages = [],
  input = "",
  cursor = input.length,
  busy = false,
  tick = 0,
  scroll = 0,
  color = true,
  mode = "Chat",
  harnessId = "",
  approval = null,
  activity = "",
}) {
  const width = Math.max(18, columns - 4);
  const paint = (text, tone) =>
    color ? `${tones[tone]}${text}${reset}` : text;
  const lines = Array(rows).fill("");
  const put = (y, text, tone) => {
    if (y >= 0 && y < rows)
      lines[y] = "  " + (tone ? paint(fit(text, width), tone) : text);
  };
  const path =
    cwd === homedir()
      ? "~"
      : cwd.startsWith(homedir() + "/")
        ? "~" + cwd.slice(homedir().length)
        : cwd;
  put(
    1,
    paint("◈ ", "gold") + paint("Omni", "white") + paint("  v0.1.0", "dim"),
  );
  put(2, path, "dim");
  const headerEnd = 5;
  const inputLines = wrap(input, width - 2);
  const before = wrap(input.slice(0, cursor), width - 2);
  const caretRow = before.length - 1;
  const caretColumn = [...before.at(-1)].reduce(
    (sum, char) => sum + cellWidth(char),
    0,
  );
  const editorHeight = approval
    ? 4
    : Math.min(4, Math.max(2, inputLines.length));
  const footerY = rows - 3;
  const lowerRule = footerY - 1;
  const editorY = lowerRule - editorHeight;
  const upperRule = editorY - 1;
  const contentHeight = Math.max(0, upperRule - headerEnd - 2);
  const transcript = [];
  for (const message of messages) {
    transcript.push({
      text:
        message.role === "user"
          ? "› Vous"
          : message.role === "assistant"
            ? "● Omni"
            : "· Information",
      tone: message.role === "assistant" ? "gold" : "white",
    });
    transcript.push(
      ...wrap(message.text, width - 2).map((text) => ({
        text: "  " + text,
        tone: null,
      })),
      { text: "", tone: null },
    );
  }
  const maxScroll = Math.max(0, transcript.length - contentHeight);
  const offset = Math.min(scroll, maxScroll);
  const visible = transcript.slice(
    Math.max(0, transcript.length - contentHeight - offset),
    transcript.length - offset,
  );
  visible.forEach(({ text, tone }, i) => put(headerEnd + i, text, tone));
  if (!messages.length && contentHeight > 2) {
    const logoWidth = Math.min(32, Math.floor((contentHeight - 2) * 2), width);
    const mark = logoWidth >= 12 ? logoRows(logoWidth) : [];
    const top =
      headerEnd +
      Math.max(0, Math.floor((contentHeight - mark.length - 2) / 2));
    const left = " ".repeat(Math.max(0, Math.floor((width - logoWidth) / 2)));
    mark.forEach((row, i) => put(top + i, left + row, "gold"));
    const title = "Universal AI Harness";
    put(
      top + mark.length + 1,
      " ".repeat(Math.max(0, Math.floor((width - title.length) / 2))) + title,
      "dim",
    );
  }
  if (upperRule > headerEnd)
    put(
      upperRule - 1,
      busy
        ? `${["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"][tick % 10]} ${activity || "Omni travaille…"}  Échap pour interrompre`
        : offset
          ? "↑ Historique · PgDn pour revenir à la réponse"
          : "",
      busy ? "gold" : "dim",
    );
  put(upperRule, "─".repeat(width), "dim");
  const inputStart = Math.max(0, caretRow - editorHeight + 1);
  for (let i = 0; i < editorHeight; i++) {
    const text = inputLines[inputStart + i] ?? "";
    const value = fit(
      (i === 0 ? "› " : "  ") +
        (text || (!input && i === 0 ? "Demandez quelque chose à Omni…" : "")),
      width,
    );
    const used = [...value].reduce((sum, char) => sum + cellWidth(char), 0);
    put(
      editorY + i,
      (color ? "\x1b[48;5;236m" : "") +
        (color ? tones[input ? "white" : "dim"] : "") +
        value +
        " ".repeat(Math.max(0, width - used)) +
        (color ? reset : ""),
    );
  }
  if (approval) {
    const request = approval.request ?? {};
    put(editorY, "Autorisation ponctuelle requise", "gold");
    put(
      editorY + 1,
      request.toolName ?? request.method ?? "Action du Harness",
      "white",
    );
    put(
      editorY + 2,
      JSON.stringify(
        request.input ?? request.params ?? { serveur: request.server },
      ),
      "dim",
    );
    put(
      editorY + 3,
      "[y] Autoriser une fois   [n] Refuser   [Échap] Annuler le tour",
      "gold",
    );
  }
  put(lowerRule, "─".repeat(width), "dim");
  put(
    footerY,
    paint(
      fit(`${mode}${harnessId ? " · " + harnessId : ""} · ${model}`, width),
      "gold",
    ) + paint(fit(` · ${path}`, Math.max(0, width - model.length - 12)), "dim"),
  );
  put(
    footerY + 1,
    "/help commandes · Alt+Entrée nouvelle ligne · PgUp/PgDn historique",
    "dim",
  );
  return {
    lines,
    cursor: {
      row: editorY + Math.min(caretRow - inputStart, editorHeight - 1) + 1,
      column: Math.min(columns - 1, 5 + caretColumn),
    },
  };
}

export class TerminalUI extends EventEmitter {
  constructor({
    input = process.stdin,
    output = process.stdout,
    model,
    cwd,
    mode = "Chat",
    harnessId = "",
  }) {
    super();
    Object.assign(this, {
      input,
      output,
      model,
      cwd,
      messages: [],
      draft: "",
      cursor: 0,
      busy: false,
      tick: 0,
      scroll: 0,
      history: [],
      historyIndex: 0,
      queued: [],
      mode,
      harnessId,
    });
    this.wasRaw = Boolean(input.isRaw);
    emitKeypressEvents(input);
    input.setRawMode(true);
    input.resume();
    output.write("\x1b[?1049h\x1b[?25l\x1b[?2004h");
    this.onKey = (text, key) => this.key(text, key ?? {});
    this.onResize = () => this.render();
    input.on("keypress", this.onKey);
    output.on("resize", this.onResize);
    this.timer = setInterval(() => {
      if (this.busy) {
        this.tick++;
        this.render();
      }
    }, 100);
    this.render();
  }
  render() {
    if (this.closed) return;
    const frame = terminalFrame({
      columns: this.output.columns ?? 100,
      rows: this.output.rows ?? 32,
      model: this.model,
      cwd: this.cwd,
      messages: this.messages,
      input: this.draft,
      cursor: this.cursor,
      busy: this.busy,
      tick: this.tick,
      scroll: this.scroll,
      color: !Object.hasOwn(process.env, "NO_COLOR"),
      mode: this.mode,
      harnessId: this.harnessId,
      approval: this.approval,
      activity: this.activity,
    });
    this.output.write(
      "\x1b[?2026h\x1b[?25l\x1b[H" +
        frame.lines.map((line) => line + "\x1b[K").join("\r\n") +
        `\x1b[${frame.cursor.row};${frame.cursor.column}H\x1b[?25h\x1b[?2026l`,
    );
  }
  question() {
    if (this.queued.length) return Promise.resolve(this.queued.shift());
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.render();
    });
  }
  notice(text) {
    this.messages.push({ role: "system", text });
    this.render();
  }
  startAnswer(prompt) {
    this.messages.push(
      { role: "user", text: prompt },
      { role: "assistant", text: "" },
    );
    this.busy = true;
    this.answer = this.messages.at(-1);
    this.scroll = 0;
    this.render();
  }
  delta(text) {
    (this.answer ?? this.messages.at(-1)).text += clean(text);
  }
  finish() {
    this.busy = false;
    this.render();
  }
  clear() {
    this.messages = [];
    this.scroll = 0;
    this.render();
  }
  key(text, key) {
    if (this.closed) return;
    if (
      this.approval &&
      ["y", "n"].includes(text?.toLowerCase()) &&
      !this.pasting
    ) {
      const approval = this.approval;
      this.approval = null;
      this.emit("approval", {
        id: approval.id,
        allowed: text.toLowerCase() === "y",
      });
      this.render();
      return;
    }
    if (key.sequence === "\x1b[200~") {
      this.pasting = true;
      return;
    }
    if (key.sequence === "\x1b[201~") {
      this.pasting = false;
      this.render();
      return;
    }
    if (this.pasting) {
      if (!this.busy && text) this.insert(text);
      return;
    }
    if (
      (key.ctrl && key.name === "c") ||
      (key.name === "escape" && this.busy)
    ) {
      if (this.busy) this.emit("SIGINT");
      else if (this.draft) {
        this.draft = "";
        this.cursor = 0;
      } else this.submit("/quit");
    } else if (key.name === "pageup") this.scroll += 5;
    else if (key.name === "pagedown")
      this.scroll = Math.max(0, this.scroll - 5);
    else if (this.busy) return;
    else if (key.ctrl && key.name === "d" && !this.draft) this.submit("/quit");
    else if (key.name === "return" && !key.meta && !key.shift)
      this.submit(this.draft);
    else if (key.name === "return" || key.name === "enter") this.insert("\n");
    else if (key.name === "backspace" && this.cursor > 0) {
      const n = Array.from(this.draft.slice(0, this.cursor)).at(-1).length;
      this.draft =
        this.draft.slice(0, this.cursor - n) + this.draft.slice(this.cursor);
      this.cursor -= n;
    } else if (key.name === "delete") {
      const n = Array.from(this.draft.slice(this.cursor))[0]?.length ?? 0;
      this.draft =
        this.draft.slice(0, this.cursor) + this.draft.slice(this.cursor + n);
    } else if (key.name === "left")
      this.cursor -=
        Array.from(this.draft.slice(0, this.cursor)).at(-1)?.length ?? 0;
    else if (key.name === "right")
      this.cursor += Array.from(this.draft.slice(this.cursor))[0]?.length ?? 0;
    else if (key.name === "home" || (key.ctrl && key.name === "a"))
      this.cursor = 0;
    else if (key.name === "end" || (key.ctrl && key.name === "e"))
      this.cursor = this.draft.length;
    else if (key.ctrl && key.name === "u") {
      this.draft = this.draft.slice(this.cursor);
      this.cursor = 0;
    } else if (key.name === "up" || key.name === "down") {
      this.historyIndex = Math.max(
        0,
        Math.min(
          this.history.length,
          this.historyIndex + (key.name === "up" ? -1 : 1),
        ),
      );
      this.draft = this.history[this.historyIndex] ?? "";
      this.cursor = this.draft.length;
    } else if (text && !key.ctrl && !key.meta) this.insert(text);
    this.render();
  }
  insert(text) {
    const value = clean(text.replace(/\r/g, "\n"));
    this.draft =
      this.draft.slice(0, this.cursor) + value + this.draft.slice(this.cursor);
    this.cursor += value.length;
  }
  submit(value) {
    if (!value.trim()) return;
    this.history.push(value);
    this.historyIndex = this.history.length;
    this.draft = "";
    this.cursor = 0;
    const resolve = this.resolve;
    this.resolve = null;
    if (resolve) resolve(value);
    else this.queued.push(value);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    this.input.off("keypress", this.onKey);
    this.output.off("resize", this.onResize);
    this.input.setRawMode(this.wasRaw);
    this.input.pause();
    this.output.write("\x1b[0m\x1b[?2004l\x1b[?25h\x1b[?1049l");
    if (this.resolve) this.resolve("/quit");
  }
}
