import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Terminal as TerminalIcon,
  Trash2,
  Copy,
  Check,
  CornerDownLeft,
  Loader2,
  Folder,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export type TerminalLine = {
  id: string;
  type: "command" | "stdout" | "stderr" | "system";
  text: string;
  exitCode?: number;
  timestamp: number;
};

export type TerminalPaneProps = {
  tabId: string;
  projectId?: string;
  initialCwd?: string;
  onCloseTab?: () => void;
};

export function TerminalPane({
  tabId: _tabId,
  projectId,
  initialCwd,
  onCloseTab,
}: TerminalPaneProps) {
  const [cwd, setCwd] = useState(initialCwd || "");
  const [lines, setLines] = useState<TerminalLine[]>([
    {
      id: "greeting",
      type: "system",
      text: "Omni Terminal · Connecté au runtime local · bash/zsh disponible",
      timestamp: Date.now(),
    },
  ]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [copied, setCopied] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines, running]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleCopyAll = useCallback(() => {
    const text = lines.map((l) => l.text).join("\n");
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [lines]);

  const handleClear = useCallback(() => {
    setLines([
      {
        id: `clear-${Date.now()}`,
        type: "system",
        text: "Terminal effacé.",
        timestamp: Date.now(),
      },
    ]);
  }, []);

  const executeCommand = useCallback(
    async (cmd: string) => {
      const trimmed = cmd.trim();
      if (!trimmed) return;

      setHistory((prev) => [trimmed, ...prev.filter((h) => h !== trimmed)]);
      setHistoryIndex(-1);
      setInput("");

      const cmdId = `cmd-${Date.now()}`;
      setLines((prev) => [
        ...prev,
        {
          id: cmdId,
          type: "command",
          text: `${cwd ? cwd.split("/").pop() : "omni"} $ ${trimmed}`,
          timestamp: Date.now(),
        },
      ]);

      if (trimmed === "clear") {
        handleClear();
        return;
      }

      setRunning(true);
      try {
        const response = await fetch("/api/terminal/exec", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-omni-request": "1",
          },
          body: JSON.stringify({
            command: trimmed,
            projectId,
            cwd: cwd || undefined,
          }),
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || `Erreur HTTP ${response.status}`);
        }

        const data: {
          stdout: string;
          stderr: string;
          exitCode: number;
          cwd: string;
        } = await response.json();

        if (data.cwd && data.cwd !== cwd) {
          setCwd(data.cwd);
        }

        const newLines: TerminalLine[] = [];
        if (data.stdout) {
          newLines.push({
            id: `out-${Date.now()}`,
            type: "stdout",
            text: data.stdout.trimEnd(),
            exitCode: data.exitCode,
            timestamp: Date.now(),
          });
        }
        if (data.stderr) {
          newLines.push({
            id: `err-${Date.now()}`,
            type: "stderr",
            text: data.stderr.trimEnd(),
            exitCode: data.exitCode,
            timestamp: Date.now(),
          });
        }
        if (!data.stdout && !data.stderr && data.exitCode !== 0) {
          newLines.push({
            id: `err-${Date.now()}`,
            type: "stderr",
            text: `Processus terminé avec le code ${data.exitCode}`,
            exitCode: data.exitCode,
            timestamp: Date.now(),
          });
        }

        setLines((prev) => [...prev, ...newLines]);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setLines((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            type: "stderr",
            text: `Erreur: ${msg}`,
            exitCode: 1,
            timestamp: Date.now(),
          },
        ]);
      } finally {
        setRunning(false);
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    },
    [cwd, handleClear, projectId],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void executeCommand(input);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length === 0) return;
      const nextIndex = Math.min(historyIndex + 1, history.length - 1);
      setHistoryIndex(nextIndex);
      setInput(history[nextIndex] || "");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex <= 0) {
        setHistoryIndex(-1);
        setInput("");
      } else {
        const nextIndex = historyIndex - 1;
        setHistoryIndex(nextIndex);
        setInput(history[nextIndex] || "");
      }
    } else if (e.key === "c" && (e.ctrlKey || e.metaKey) && running) {
      setLines((prev) => [
        ...prev,
        {
          id: `int-${Date.now()}`,
          type: "system",
          text: "^C Interrompu",
          timestamp: Date.now(),
        },
      ]);
      setRunning(false);
    }
  };

  const cwdShort = cwd ? cwd.split("/").filter(Boolean).slice(-2).join("/") : "";

  return (
    <div className="terminal-pane flex flex-col flex-1 h-full w-full bg-[#0a0a0c] text-foreground font-mono">
      {/* Header bar */}
      <div className="terminal-toolbar flex items-center justify-between px-3 py-1.5 border-b border-border/40 bg-[#111114] text-xs">
        <div className="flex items-center gap-2">
          <TerminalIcon className="w-3.5 h-3.5 text-amber-400" />
          <span className="font-semibold text-muted-foreground text-[11px] tracking-wide uppercase">
            Terminal
          </span>
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-400 font-sans">
            <span
              className={`size-1.5 rounded-full ${running ? "bg-amber-400 animate-ping" : "bg-emerald-400"}`}
            />
            {running ? "Exécution…" : "Prêt"}
          </span>
          {cwdShort && (
            <span
              className="hidden sm:inline-flex items-center gap-1 text-[11px] text-muted-foreground/80 max-w-[280px] truncate"
              title={cwd}
            >
              <Folder className="w-3 h-3 shrink-0" />
              {cwdShort}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 font-sans">
          <Button
            variant="ghost"
            size="icon-xs"
            title="Copier tout l'historique"
            onClick={handleCopyAll}
            className="text-muted-foreground hover:text-foreground"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            title="Effacer l'affichage (clear)"
            onClick={handleClear}
            className="text-muted-foreground hover:text-foreground"
          >
            <Trash2 className="w-3 h-3" />
          </Button>
          {onCloseTab && (
            <Button
              variant="ghost"
              size="icon-xs"
              title="Fermer le terminal"
              onClick={onCloseTab}
              className="text-muted-foreground hover:text-foreground ml-1"
            >
              ✕
            </Button>
          )}
        </div>
      </div>

      {/* Output log */}
      <div
        className="terminal-output flex-1 overflow-y-auto p-3 text-[12px] leading-relaxed select-text space-y-1"
        onClick={() => inputRef.current?.focus()}
      >
        {lines.map((line) => {
          if (line.type === "system") {
            return (
              <div key={line.id} className="text-muted-foreground/60 italic text-[11px]">
                # {line.text}
              </div>
            );
          }
          if (line.type === "command") {
            return (
              <div key={line.id} className="text-amber-300 font-medium pt-1">
                {line.text}
              </div>
            );
          }
          if (line.type === "stderr") {
            return (
              <pre
                key={line.id}
                className="text-rose-400 whitespace-pre-wrap font-mono text-[11.5px]"
              >
                {line.text}
              </pre>
            );
          }
          return (
            <pre
              key={line.id}
              className="text-zinc-200 whitespace-pre-wrap font-mono text-[11.5px]"
            >
              {line.text}
            </pre>
          );
        })}
        {running && (
          <div className="flex items-center gap-2 text-amber-400 text-xs py-1">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Exécution en cours…</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Prompt input row */}
      <div className="terminal-input-row flex items-center gap-2 px-3 py-2 border-t border-border/40 bg-[#0c0c0e]">
        <span className="text-emerald-400 font-bold select-none text-xs">
          ➜
        </span>
        <span className="text-muted-foreground text-xs select-none hidden sm:inline">
          {cwdShort ? cwdShort.split("/").pop() : "omni"} $
        </span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          disabled={running}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={running ? "Commande en cours..." : "Entrez une commande (ex: ls, git status, npm test)..."}
          className="flex-1 bg-transparent border-0 outline-none text-foreground text-xs placeholder:text-muted-foreground/40 font-mono"
        />
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={running || !input.trim()}
          onClick={() => void executeCommand(input)}
          className="text-muted-foreground hover:text-foreground shrink-0"
        >
          <CornerDownLeft className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
}
