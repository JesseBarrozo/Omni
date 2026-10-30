// Project file tree for the inspector. Behaviour follows the VS Code explorer:
// lazy folder loading, folders first, arrow-key navigation, Enter to open,
// create/rename/delete with F2 and Delete, and the open file highlighted.
// Pure rules live in lib/file-tree-model.ts.

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  FilePlus,
  FolderPlus,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";

import { FileIcon } from "@/components/file-icon";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import {
  ROOT,
  navigate,
  parentOf,
  sortEntries,
  visibleRows,
  type TreeEntry,
  type TreeKey,
  type TreeNodeState,
  type TreeRow,
} from "@/lib/file-tree-model";

const TREE_KEYS = new Set<string>(["ArrowDown", "ArrowUp", "Home", "End", "ArrowRight", "ArrowLeft"]);
const INDENT = 14;
const BASE_PADDING = 8;

// An input row in the tree: a new entry under `parent`, or a rename of `path`.
type Draft =
  | { kind: "create"; parent: string; directory: boolean; value: string }
  | { kind: "rename"; path: string; value: string };

function remapPath(path: string, from: string, to: string): string {
  return path === from || path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : path;
}

export function FileTree({
  projectId,
  refreshKey,
  activePath,
  onOpenFile,
}: {
  projectId: string | null;
  refreshKey: number;
  activePath: string | null;
  onOpenFile: (entry: TreeEntry) => void;
}) {
  const [nodes, setNodes] = useState<Map<string, TreeNodeState>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const loadToken = useRef(0);

  // Loads one directory into the tree. Results from an older project or
  // refresh are dropped, so a slow response never overwrites newer state.
  async function loadDirectory(directory: string) {
    if (!projectId) return;
    const token = loadToken.current;
    setNodes((current) =>
      new Map(current).set(directory, { entries: current.get(directory)?.entries ?? null, loading: true, error: null }),
    );
    try {
      const entries = await api<TreeEntry[]>(`/projects/${projectId}/files?path=${encodeURIComponent(directory)}`);
      if (token !== loadToken.current) return;
      setNodes((current) => new Map(current).set(directory, { entries: sortEntries(entries), loading: false, error: null }));
    } catch (error) {
      if (token !== loadToken.current) return;
      setNodes((current) =>
        new Map(current).set(directory, {
          entries: null,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  // A new project or a refresh starts from the root with nothing expanded.
  useEffect(() => {
    loadToken.current += 1;
    setNodes(new Map());
    setExpanded(new Set());
    setSelected(null);
    setDraft(null);
    setActionError(null);
    void loadDirectory(ROOT);
    // loadDirectory reads projectId; the effect runs when either changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, refreshKey]);

  const rows = visibleRows(nodes, expanded);

  function expand(path: string) {
    setExpanded((current) => new Set(current).add(path));
    if (!nodes.get(path)?.entries) void loadDirectory(path);
  }

  function collapse(path: string) {
    setExpanded((current) => {
      const next = new Set(current);
      next.delete(path);
      return next;
    });
  }

  function toggle(path: string) {
    if (expanded.has(path)) collapse(path);
    else expand(path);
  }

  function select(path: string) {
    setSelected(path);
    containerRef.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`)?.scrollIntoView({ block: "nearest" });
  }

  function activate(row: TreeRow) {
    select(row.path);
    if (row.directory) toggle(row.path);
    else onOpenFile({ name: row.name, path: row.path, directory: false });
  }

  // The folder that receives a new entry: the selected folder, the parent of
  // the selected file, or the project root.
  function targetDirectory(): string {
    const row = rows.find((candidate) => candidate.path === selected);
    if (!row) return ROOT;
    return row.directory ? row.path : parentOf(row.path);
  }

  function startCreate(directory: boolean) {
    const parent = targetDirectory();
    setActionError(null);
    if (parent !== ROOT && !expanded.has(parent)) expand(parent);
    setDraft({ kind: "create", parent, directory, value: "" });
  }

  function startRename() {
    const row = rows.find((candidate) => candidate.path === selected);
    if (!row) return;
    setActionError(null);
    setDraft({ kind: "rename", path: row.path, value: row.name });
  }

  async function commitDraft() {
    if (!projectId || !draft) return;
    const name = draft.value.trim();
    if (!name) {
      setDraft(null);
      return;
    }
    try {
      if (draft.kind === "create") {
        const created = await api<{ path: string }>(`/projects/${projectId}/file-create`, {
          parent: draft.parent,
          name,
          directory: draft.directory,
        });
        setDraft(null);
        await loadDirectory(draft.parent);
        select(created.path);
        if (!draft.directory) onOpenFile({ name, path: created.path, directory: false });
      } else {
        const parent = parentOf(draft.path);
        const renamed = await api<{ path: string }>(`/projects/${projectId}/file-rename`, { from: draft.path, to: name });
        setDraft(null);
        setExpanded((current) => new Set([...current].map((path) => remapPath(path, draft.path, renamed.path))));
        await loadDirectory(parent);
        select(renamed.path);
      }
      setActionError(null);
      containerRef.current?.focus();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }

  async function deleteSelected() {
    const row = rows.find((candidate) => candidate.path === selected);
    if (!projectId || !row) return;
    if (!window.confirm(`Supprimer « ${row.name} » ?`)) return;
    try {
      await api(`/projects/${projectId}/file-delete`, { path: row.path });
      const parent = parentOf(row.path);
      setExpanded((current) => new Set([...current].filter((path) => path !== row.path && !path.startsWith(`${row.path}/`))));
      setSelected(parent === ROOT ? null : parent);
      await loadDirectory(parent);
      setActionError(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Keys typed in the name input bubble here; only the tree itself reacts.
    if (event.target !== event.currentTarget || draft) return;
    if (event.key === "F2") {
      event.preventDefault();
      startRename();
      return;
    }
    if (event.key === "Delete") {
      event.preventDefault();
      void deleteSelected();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      const row = rows.find((candidate) => candidate.path === selected);
      if (!row) return;
      event.preventDefault();
      activate(row);
      return;
    }
    if (!TREE_KEYS.has(event.key)) return;
    event.preventDefault();
    const action = navigate(rows, selected, event.key as TreeKey);
    if (action.type === "select") select(action.path);
    else if (action.type === "expand") expand(action.path);
    else if (action.type === "collapse") collapse(action.path);
  }

  function reloadExpanded() {
    loadToken.current += 1;
    setNodes(new Map());
    setDraft(null);
    void loadDirectory(ROOT);
    for (const path of expanded) void loadDirectory(path);
  }

  const rootState = nodes.get(ROOT);
  const createAtRoot = draft?.kind === "create" && draft.parent === ROOT;

  function draftInput(depth: number) {
    return (
      <input
        autoFocus
        aria-label={draft?.kind === "rename" ? "Renommer" : "Nom du nouvel élément"}
        value={draft?.value ?? ""}
        onChange={(event) => setDraft((current) => (current ? { ...current, value: event.target.value } : current))}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") void commitDraft();
          if (event.key === "Escape") setDraft(null);
        }}
        onBlur={() => setDraft(null)}
        style={{ marginLeft: BASE_PADDING + depth * INDENT + 22 }}
        className="my-0.5 mr-2 h-6 min-w-0 flex-1 rounded border border-ring bg-background px-1.5 text-sm outline-none"
      />
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-end gap-0.5">
        <Button variant="ghost" size="icon-xs" aria-label="Nouveau fichier" onClick={() => startCreate(false)}>
          <FilePlus />
        </Button>
        <Button variant="ghost" size="icon-xs" aria-label="Nouveau dossier" onClick={() => startCreate(true)}>
          <FolderPlus />
        </Button>
        <Button variant="ghost" size="icon-xs" aria-label="Actualiser l'explorateur" onClick={reloadExpanded}>
          <RefreshCw />
        </Button>
        <Button variant="ghost" size="icon-xs" aria-label="Réduire tous les dossiers" onClick={() => setExpanded(new Set())}>
          <ChevronsDownUp />
        </Button>
      </div>
      {actionError && <p className="px-2 py-1 text-xs text-destructive">{actionError}</p>}
      <div
        ref={containerRef}
        role="tree"
        aria-label="Explorateur de fichiers"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onFocus={() => {
          if (selected === null && rows.length > 0) setSelected(rows[0].path);
        }}
        className="flex flex-col rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {rootState?.error && <p className="px-2 py-1 text-xs text-destructive">{rootState.error}</p>}
        {rootState?.loading && !rootState.entries && <p className="px-2 py-1 text-xs text-muted-foreground">Chargement…</p>}
        {rootState?.entries && rootState.entries.length === 0 && !createAtRoot && (
          <p className="px-2 py-1 text-xs text-muted-foreground">Dossier vide.</p>
        )}
        {createAtRoot && <div className="flex items-center">{draftInput(0)}</div>}
        {rows.map((row) => {
          const isSelected = selected === row.path;
          const isActive = activePath === row.path;
          const isRenaming = draft?.kind === "rename" && draft.path === row.path;
          const childState = row.directory && row.expanded ? nodes.get(row.path) : undefined;
          const creatingHere = draft?.kind === "create" && draft.parent === row.path;
          return (
            <div key={row.path}>
              <div
                role="treeitem"
                aria-level={row.depth + 1}
                aria-selected={isSelected}
                aria-expanded={row.directory ? row.expanded : undefined}
                data-path={row.path}
                title={row.path}
                onClick={() => {
                  if (!isRenaming) activate(row);
                }}
                onDoubleClick={() => {
                  if (!row.directory) onOpenFile({ name: row.name, path: row.path, directory: false });
                }}
                style={{ paddingLeft: BASE_PADDING + row.depth * INDENT }}
                className={[
                  "flex h-7 cursor-pointer items-center gap-1.5 pr-2 text-sm select-none",
                  isSelected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
                  isActive ? "font-medium text-foreground" : "text-muted-foreground",
                ].join(" ")}
              >
                {row.directory ? (
                  row.expanded ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />
                ) : (
                  <span className="size-3.5 shrink-0" />
                )}
                <FileIcon path={row.path} directory={row.directory} open={row.expanded} />
                {isRenaming ? (
                  <input
                    autoFocus
                    aria-label="Renommer"
                    value={draft.value}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => setDraft({ kind: "rename", path: row.path, value: event.target.value })}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.key === "Enter") void commitDraft();
                      if (event.key === "Escape") setDraft(null);
                    }}
                    onBlur={() => setDraft(null)}
                    className="h-6 min-w-0 flex-1 rounded border border-ring bg-background px-1.5 text-sm outline-none"
                  />
                ) : (
                  <span className="truncate">{row.name}</span>
                )}
              </div>
              {creatingHere && <div className="flex items-center">{draftInput(row.depth + 1)}</div>}
              {childState?.loading && !childState.entries && (
                <p style={{ paddingLeft: BASE_PADDING + (row.depth + 1) * INDENT + 22 }} className="py-0.5 text-xs text-muted-foreground">
                  Chargement…
                </p>
              )}
              {childState?.error && (
                <p style={{ paddingLeft: BASE_PADDING + (row.depth + 1) * INDENT + 22 }} className="py-0.5 text-xs text-destructive">
                  {childState.error}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-end gap-0.5">
        <Button variant="ghost" size="icon-xs" aria-label="Renommer l'élément sélectionné" disabled={!selected} onClick={startRename}>
          <Pencil />
        </Button>
        <Button variant="ghost" size="icon-xs" aria-label="Supprimer l'élément sélectionné" disabled={!selected} onClick={() => void deleteSelected()}>
          <Trash2 />
        </Button>
      </div>
    </div>
  );
}
