// Atlas pages for the project panel: a summary of the generated pages, and
// each page rendered as Markdown. A citation such as `src/main.ts:42` becomes a
// button that opens the file at that line, so a claim can be checked in one click.

import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, FileText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

export type AtlasPage = { name: string; title: string };

const CITATION = /^((?:[\w.-]+\/)*[\w.-]+\.[\w]+):(\d+)$/;

export function AtlasViewer({
  projectId,
  pages,
  onOpenCitation,
}: {
  projectId: string;
  pages: AtlasPage[];
  onOpenCitation: (path: string, line: number) => void;
}) {
  const [current, setCurrent] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Another project has its own atlas: start from its summary.
  useEffect(() => {
    setCurrent(null);
    setText("");
    setError("");
  }, [projectId]);

  useEffect(() => {
    if (!current) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<{ name: string; text: string }>(
      `/projects/${projectId}/atlas-page?name=${encodeURIComponent(current)}`,
      undefined,
      controller.signal,
    )
      .then((page) => {
        if (!controller.signal.aborted) setText(page.text);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [projectId, current]);

  if (!current) {
    return (
      <div className="flex flex-col gap-1">
        {pages.map((page) => (
          <button
            key={page.name}
            type="button"
            onClick={() => setCurrent(page.name)}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent/50"
          >
            <FileText className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{page.title}</span>
              <span className="block truncate text-xs text-muted-foreground">atlas/{page.name}</span>
            </span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Button variant="ghost" size="sm" className="self-start" onClick={() => setCurrent(null)}>
        <ArrowLeft />
        Sommaire
      </Button>
      {loading && <p className="text-xs text-muted-foreground">Chargement…</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {!loading && !error && (
        <div className="markdown text-sm">
          <Markdown
            remarkPlugins={[remarkGfm]}
            components={{
              code: ({ className, children }) => {
                const value = String(children).replace(/\n$/, "");
                const citation = !className && !value.includes("\n") ? CITATION.exec(value) : null;
                if (citation) {
                  return (
                    <button
                      type="button"
                      title={`Ouvrir ${citation[1]} à la ligne ${citation[2]}`}
                      onClick={() => onOpenCitation(citation[1], Number(citation[2]))}
                      className="rounded bg-muted px-1 font-mono text-xs text-primary underline-offset-2 hover:underline"
                    >
                      {value}
                    </button>
                  );
                }
                return <code className={className}>{children}</code>;
              },
            }}
          >
            {text}
          </Markdown>
        </div>
      )}
    </div>
  );
}
