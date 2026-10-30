// Pure model of the project file tree: ordering, visible rows and keyboard
// navigation. The component keeps the loaded directories; this file decides
// what is shown and where the selection goes, so it can be tested without a DOM.

export const ROOT = ".";

export type TreeEntry = { name: string; path: string; directory: boolean };

export type TreeNodeState = {
  entries: TreeEntry[] | null;
  loading: boolean;
  error: string | null;
};

export type TreeRow = {
  path: string;
  name: string;
  directory: boolean;
  depth: number;
  expanded: boolean;
};

export type TreeKey = "ArrowDown" | "ArrowUp" | "Home" | "End" | "ArrowRight" | "ArrowLeft";

export type TreeAction =
  | { type: "none" }
  | { type: "select"; path: string }
  | { type: "expand"; path: string }
  | { type: "collapse"; path: string };

// Folders first, then names in natural order, ignoring case.
export function sortEntries(entries: TreeEntry[]): TreeEntry[] {
  return [...entries].sort(
    (a, b) =>
      Number(b.directory) - Number(a.directory) ||
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
  );
}

export function parentOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? ROOT : path.slice(0, index);
}

// Rows in display order. A directory's children appear only when it is expanded
// and its listing has been loaded.
export function visibleRows(nodes: Map<string, TreeNodeState>, expanded: Set<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (directory: string, depth: number) => {
    for (const entry of nodes.get(directory)?.entries ?? []) {
      const open = entry.directory && expanded.has(entry.path);
      rows.push({ path: entry.path, name: entry.name, directory: entry.directory, depth, expanded: open });
      if (open) walk(entry.path, depth + 1);
    }
  };
  walk(ROOT, 0);
  return rows;
}

// Keyboard behaviour follows the VS Code explorer: arrows move and expand or
// collapse, Home and End jump to the ends of the list.
export function navigate(rows: TreeRow[], current: string | null, key: TreeKey): TreeAction {
  if (rows.length === 0) return { type: "none" };
  const index = current === null ? -1 : rows.findIndex((row) => row.path === current);
  const row = index >= 0 ? rows[index] : null;
  switch (key) {
    case "ArrowDown":
      return { type: "select", path: rows[Math.min(index + 1, rows.length - 1)].path };
    case "ArrowUp":
      return { type: "select", path: rows[Math.max(index - 1, 0)].path };
    case "Home":
      return { type: "select", path: rows[0].path };
    case "End":
      return { type: "select", path: rows[rows.length - 1].path };
    case "ArrowRight": {
      if (!row || !row.directory) return { type: "none" };
      if (!row.expanded) return { type: "expand", path: row.path };
      const child = rows[index + 1];
      return child && child.depth > row.depth ? { type: "select", path: child.path } : { type: "none" };
    }
    case "ArrowLeft": {
      if (!row) return { type: "none" };
      if (row.directory && row.expanded) return { type: "collapse", path: row.path };
      const parent = parentOf(row.path);
      return parent === ROOT ? { type: "none" } : { type: "select", path: parent };
    }
  }
}
