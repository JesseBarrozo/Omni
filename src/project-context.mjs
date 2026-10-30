import { realpath, stat, readFile, readdir } from "node:fs/promises";
import { resolve, relative, dirname, join, sep } from "node:path";
import { redactSecrets } from "./core.mjs";

export async function projectRoot(path) {
  let root;
  try { root = await realpath(resolve(path)); }
  catch (error) { if (error.code === "ENOENT") throw new Error("Le dossier du projet est introuvable. Modifiez son chemin ou archivez le projet."); throw error; }
  if (!(await stat(root)).isDirectory())
    throw new Error("Le projet doit être un dossier existant.");
  return root;
}
export async function ensureProject(store, path, name) {
  const root = await projectRoot(path);
  try {
    return store.project(root);
  } catch {}
  for (const project of store.projects()) {
    if (!project.rootPath) continue;
    try {
      if ((await projectRoot(project.rootPath)) === root) return project;
    } catch {}
  }
  return store.createProject(name || root.split(sep).at(-1), root);
}
export async function containedFile(root, path) {
  const target = await realpath(resolve(root, path));
  const rel = relative(root, target);
  if (rel === ".." || rel.startsWith(".." + sep) || rel.startsWith(sep))
    throw new Error("Ce chemin sort du projet.");
  return target;
}
export async function readProjectContext(path, { limit = 36000 } = {}) {
  const root = await projectRoot(path);
  const candidates = [];
  let current = root;
  for (let i = 0; i < 12; i++) {
    candidates.unshift(join(current, "AGENTS.md"));
    if (dirname(current) === current) break;
    current = dirname(current);
  }
  for (const file of [
    "CLAUDE.md",
    ".context/README.md",
    ".context/docs/README.md",
    ".context/runtime/workflows/prevc.json",
  ])
    candidates.push(join(root, file));
  const files = [];
  let remaining = limit;
  for (const file of candidates) {
    try {
      if (!(await stat(file)).isFile()) continue;
      const content = redactSecrets(
        (await readFile(file, "utf8")).slice(0, Math.min(12000, remaining)),
      );
      if (content) {
        files.push({ path: file, content });
        remaining -= content.length;
      }
      if (remaining <= 0) break;
    } catch (error) {
      if (!["ENOENT", "ENOTDIR", "EACCES"].includes(error.code)) throw error;
    }
  }
  let entries = [];
  try {
    entries = (await readdir(root, { withFileTypes: true }))
      .filter(
        (e) =>
          !e.name.startsWith(".") || [".context", ".claude"].includes(e.name),
      )
      .slice(0, 50)
      .map((e) => e.name + (e.isDirectory() ? "/" : ""));
  } catch {}
  const text = [
    "Tu es Omni, un agent de développement dans ce projet. Réponds en français, sauf demande contraire. Utilise les outils réels du Harness pour inspecter et modifier le projet ; ne prétends jamais avoir exécuté une action sans preuve. Respecte les instructions AGENTS.md et les approbations de l’utilisateur.",
    `Dossier de travail : ${root}\nEntrées du projet : ${entries.join(", ")}`,
    "dotcontext est le serveur MCP de contexte du projet (.context), pas DbContext ni le SDK .NET. Si les instructions le demandent, utilise ses outils MCP disponibles. Si le serveur manque ou une permission est refusée, indique cette limite concrète.",
    ...files.map((f) => `--- ${f.path} ---\n${f.content}`),
  ].join("\n\n");
  return {
    root,
    files: files.map(({ path, content }) => ({
      path,
      characters: content.length,
    })),
    text,
  };
}
