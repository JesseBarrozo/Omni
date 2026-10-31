// Atlas pages for the project panel: lists the generated Atlas markdown documents.
// Clicking an atlas document opens it directly in Omni's editor / viewer tab.

import { FileText } from "lucide-react";

export type AtlasPage = { name: string; title: string };

export function AtlasViewer({
  pages,
  activePath,
  onOpenFile,
  onOpenCitation,
}: {
  projectId?: string;
  pages: AtlasPage[];
  activePath?: string | null;
  onOpenFile?: (entry: { name: string; path: string; directory: boolean }) => void;
  onOpenCitation?: (path: string, line: number) => void;
}) {
  if (!pages || pages.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-1">
        Aucune page d'atlas générée.
      </p>
    );
  }

  function handleOpen(page: AtlasPage) {
    const filePath = `atlas/${page.name}`;
    if (onOpenFile) {
      onOpenFile({ name: page.name, path: filePath, directory: false });
    } else if (onOpenCitation) {
      onOpenCitation(filePath, 1);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      {pages.map((page) => {
        const filePath = `atlas/${page.name}`;
        const isActive = activePath === filePath;
        return (
          <button
            key={page.name}
            type="button"
            title={`Ouvrir ${filePath} dans l'éditeur`}
            onClick={() => handleOpen(page)}
            className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
              isActive
                ? "bg-accent text-accent-foreground font-medium"
                : "hover:bg-accent/50 text-foreground"
            }`}
          >
            <FileText className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{page.title}</span>
              <span className="block truncate text-xs text-muted-foreground">{filePath}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
