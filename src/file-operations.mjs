// Create, rename and delete for the project file explorer. Every path is
// resolved inside the project root, symbolic links are never followed, and
// names hidden from the explorer (secrets, .git, dependency folders) cannot be
// created, renamed onto, or deleted.

import { lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const FORBIDDEN_NAME = /^\.{1,2}$/;

// Resolves a project-relative path, refusing anything outside the root.
export function insideProject(root, relativePath) {
  if (isAbsolute(relativePath)) throw new Error("Chemin absolu refusé.");
  const target = resolve(root, relativePath);
  const rel = relative(root, target);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error("Ce chemin sort du projet.");
  }
  return target;
}

function assertName(name, isHidden) {
  if (!name || name.includes("/") || name.includes("\\") || FORBIDDEN_NAME.test(name)) {
    throw new Error("Nom invalide.");
  }
  if (isHidden(name)) throw new Error("Ce nom est protégé.");
}

function assertNoHiddenSegment(relativePath, isHidden) {
  if (relativePath.split("/").some((segment) => isHidden(segment))) {
    throw new Error("Ce chemin est protégé.");
  }
}

async function entryExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

// Returns the stat of an existing entry; symbolic links are refused, not followed.
async function ownEntry(path) {
  const info = await lstat(path).catch(() => null);
  if (!info) throw new Error("Élément introuvable.");
  if (info.isSymbolicLink()) throw new Error("Les liens symboliques ne sont pas modifiables.");
  return info;
}

export async function createEntry({ root, parent, name, directory, isHidden }) {
  assertName(name, isHidden);
  const parentPath = insideProject(root, parent);
  assertNoHiddenSegment(parent, isHidden);
  const parentInfo = await ownEntry(parentPath);
  if (!parentInfo.isDirectory()) throw new Error("Le dossier parent n'existe pas.");
  const target = join(parentPath, name);
  if (await entryExists(target)) throw new Error(`« ${name} » existe déjà.`);
  if (directory) await mkdir(target);
  else await writeFile(target, "", { flag: "wx" });
  return { path: parent ? `${parent}/${name}` : name };
}

export async function renameEntry({ root, from, to, isHidden }) {
  if (!from) throw new Error("La racine du projet ne se renomme pas.");
  assertNoHiddenSegment(from, isHidden);
  const source = insideProject(root, from);
  await ownEntry(source);
  const parent = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : "";
  assertName(to, isHidden);
  const target = join(insideProject(root, parent), to);
  if (await entryExists(target)) throw new Error(`« ${to} » existe déjà.`);
  await rename(source, target);
  return { path: parent ? `${parent}/${to}` : to };
}

export async function deleteEntry({ root, path, isHidden }) {
  if (!path) throw new Error("La racine du projet ne se supprime pas.");
  assertNoHiddenSegment(path, isHidden);
  const target = insideProject(root, path);
  await ownEntry(target);
  await rm(target, { recursive: true });
  return { path };
}
