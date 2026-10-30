import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const modes = new Set(["on", "auto", "off"]);

/** Keeps the host awake continuously or while Omni runs an agent. */
export class AwakeController {
  constructor({ dataDir, platform = process.platform, spawnProcess = spawn } = {}) {
    this.dataDir = dataDir;
    this.platform = platform;
    this.spawnProcess = spawnProcess;
    this.mode = "off";
    this.activeRuns = 0;
    this.child = null;
    this.error = null;
    this.onChange = null;
    this.exitHandler = () => this.stop();
    process.on("exit", this.exitHandler);
  }

  async init() {
    try {
      const saved = JSON.parse(await readFile(join(this.dataDir, "awake.json"), "utf8"));
      if (modes.has(saved.mode)) this.mode = saved.mode;
    } catch (error) {
      if (error.code !== "ENOENT") this.error = error.message;
    }
    this.reconcile();
  }

  async setMode(mode) {
    if (!modes.has(mode)) throw new Error("Mode de veille invalide.");
    this.mode = mode;
    await mkdir(this.dataDir, { recursive: true });
    await writeFile(join(this.dataDir, "awake.json"), `${JSON.stringify({ mode }, null, 2)}\n`, { mode: 0o600 });
    this.reconcile();
    return this.status();
  }

  setActiveRuns(count) {
    this.activeRuns = Math.max(0, count);
    this.reconcile();
  }

  status() {
    return {
      mode: this.mode,
      active: Boolean(this.child) && !this.child.killed,
      workingAgents: this.activeRuns,
      supported: this.platform === "darwin" || this.platform === "linux",
      error: this.error,
    };
  }

  close() {
    this.stop();
    process.off("exit", this.exitHandler);
  }

  reconcile() {
    const shouldHold = this.mode === "on" || (this.mode === "auto" && this.activeRuns > 0);
    if (!shouldHold) return this.stop();
    if (this.child || (this.platform !== "darwin" && this.platform !== "linux")) return;
    const command = this.platform === "darwin" ? "/usr/bin/caffeinate" : "systemd-inhibit";
    const args = this.platform === "darwin"
      ? ["-dimsu", "-w", String(process.pid)]
      : ["--what=sleep:idle", "--mode=block", "--who=Omni", "--why=Un agent Omni travaille", "sleep", "infinity"];
    try {
      const child = this.spawnProcess(command, args, { stdio: "ignore" });
      this.child = child;
      this.error = null;
      child.once("error", (error) => {
        if (this.child === child) this.child = null;
        this.error = error.message;
        this.onChange?.(this.status());
      });
      child.once("exit", (code) => {
        if (this.child !== child) return;
        this.child = null;
        if (shouldHold) this.error = `${command} s’est arrêté (${code ?? "signal"}).`;
        this.onChange?.(this.status());
      });
    } catch (error) {
      this.error = error.message;
    }
  }

  stop() {
    const child = this.child;
    this.child = null;
    if (child && !child.killed) child.kill("SIGTERM");
  }
}
