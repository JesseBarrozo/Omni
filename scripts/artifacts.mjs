#!/usr/bin/env node
// Registry for shared artifacts that agents read: plans, reports, diagrams.
// Files live in .context/artifacts/ with an index.json describing each one.
// Node built-ins only, so any agent or human can run it without installing.

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const KINDS = ["plan", "report", "diagram", "dataset", "design", "other"];
const EXTENSIONS = new Set([".html", ".md", ".json", ".svg", ".png", ".csv", ".txt", ".mmd"]);
const INDEX_FILE = "index.json";
const SCHEMA_VERSION = 1;

export function defaultRoot() {
  return fileURLToPath(new URL("../", import.meta.url));
}

export function artifactsDirectory(root) {
  return join(root, ".context", "artifacts");
}

export function slugify(title) {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "artifact";
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function readIndex(dir) {
  const path = join(dir, INDEX_FILE);
  if (!existsSync(path)) return { schemaVersion: SCHEMA_VERSION, artifacts: [] };
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeIndex(dir, index) {
  const artifacts = [...index.artifacts].sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(
    join(dir, INDEX_FILE),
    `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, artifacts }, null, 2)}\n`,
  );
}

function assertKind(kind) {
  if (!KINDS.includes(kind)) {
    throw new Error(`kind must be one of: ${KINDS.join(", ")}. Got "${kind}".`);
  }
}

export function addArtifact({ root, source, title, kind, description, author = null, sourceUrl = null, now = new Date(), force = false }) {
  assertKind(kind);
  if (!title?.trim()) throw new Error("title is required.");
  if (!description?.trim()) throw new Error("description is required.");

  const extension = extname(source).toLowerCase();
  if (!EXTENSIONS.has(extension)) {
    throw new Error(`Unsupported extension "${extension}". Allowed: ${[...EXTENSIONS].join(", ")}.`);
  }

  const dir = artifactsDirectory(root);
  mkdirSync(dir, { recursive: true });
  const index = readIndex(dir);
  const id = slugify(title);
  if (index.artifacts.some((entry) => entry.id === id) && !force) {
    throw new Error(`An artifact with id "${id}" already exists. Pass force to replace it.`);
  }

  const content = readFileSync(source);
  const file = `${id}${extension}`;
  writeFileSync(join(dir, file), content);

  const timestamp = now.toISOString();
  const entry = {
    id,
    title: title.trim(),
    kind,
    description: description.trim(),
    file,
    sha256: sha256(content),
    bytes: content.length,
    author,
    sourceUrl,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  index.artifacts = [...index.artifacts.filter((existing) => existing.id !== id), entry];
  writeIndex(dir, index);
  return entry;
}

export function refreshArtifact({ root, id, now = new Date() }) {
  const dir = artifactsDirectory(root);
  const index = readIndex(dir);
  const entry = index.artifacts.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`No artifact with id "${id}".`);

  const content = readFileSync(join(dir, entry.file));
  entry.sha256 = sha256(content);
  entry.bytes = content.length;
  entry.updatedAt = now.toISOString();
  writeIndex(dir, index);
  return entry;
}

export function listArtifacts(root) {
  const { artifacts } = readIndex(artifactsDirectory(root));
  return [...artifacts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function checkArtifacts(root) {
  const dir = artifactsDirectory(root);
  if (!existsSync(join(dir, INDEX_FILE))) return [];

  const errors = [];
  const index = readIndex(dir);
  if (index.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`index.json schemaVersion must be ${SCHEMA_VERSION}.`);
  }

  const seen = new Set();
  const registeredFiles = new Set();
  for (const entry of index.artifacts) {
    if (seen.has(entry.id)) errors.push(`duplicate id ${entry.id}.`);
    seen.add(entry.id);

    if (!KINDS.includes(entry.kind)) errors.push(`${entry.id}: unknown kind "${entry.kind}".`);
    if (!entry.file || basename(entry.file) !== entry.file) {
      errors.push(`${entry.id}: file must be a plain file name, got "${entry.file}".`);
      continue;
    }
    registeredFiles.add(entry.file);

    const path = join(dir, entry.file);
    if (!existsSync(path) || !statSync(path).isFile()) {
      errors.push(`missing file for ${entry.id}: ${entry.file}.`);
      continue;
    }
    if (sha256(readFileSync(path)) !== entry.sha256) {
      errors.push(`sha256 mismatch for ${entry.id}: run refresh after reviewing the change.`);
    }
  }

  for (const file of readdirSync(dir)) {
    if (file === INDEX_FILE || file === "README.md") continue;
    if (!registeredFiles.has(file)) errors.push(`not in the index: ${file}.`);
  }
  return errors;
}

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument "${token}".`);
    const name = token.slice(2);
    if (name === "force") {
      flags.force = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`--${name} needs a value.`);
    flags[name] = value;
    i += 1;
  }
  return flags;
}

function usage() {
  return [
    "Usage:",
    "  node tools/artifacts/artifacts.mjs add --file <path> --title <title> --kind <kind> --description <text> [--author <name>] [--source-url <url>] [--force]",
    "  node tools/artifacts/artifacts.mjs list",
    "  node tools/artifacts/artifacts.mjs check",
    "  node tools/artifacts/artifacts.mjs refresh --id <id>",
    `Kinds: ${KINDS.join(", ")}`,
  ].join("\n");
}

function main(argv) {
  const [command, ...rest] = argv;
  const root = defaultRoot();
  const flags = parseFlags(rest);

  switch (command) {
    case "add": {
      const entry = addArtifact({
        root,
        source: resolve(flags.file ?? ""),
        title: flags.title,
        kind: flags.kind,
        description: flags.description,
        author: flags.author,
        sourceUrl: flags["source-url"],
        force: flags.force === true,
      });
      process.stdout.write(`Registered ${entry.id} (${entry.file}).\n`);
      return 0;
    }
    case "list": {
      for (const entry of listArtifacts(root)) {
        process.stdout.write(`${entry.createdAt.slice(0, 10)}  ${entry.kind.padEnd(8)}  ${entry.id}  ${entry.title}\n`);
      }
      return 0;
    }
    case "check": {
      const errors = checkArtifacts(root);
      for (const error of errors) process.stderr.write(`${error}\n`);
      if (errors.length === 0) process.stdout.write("Artifacts store is consistent.\n");
      return errors.length === 0 ? 0 : 1;
    }
    case "refresh": {
      if (!flags.id) throw new Error("refresh needs --id <id>.");
      const entry = refreshArtifact({ root, id: flags.id });
      process.stdout.write(`Refreshed ${entry.id}.\n`);
      return 0;
    }
    default:
      process.stdout.write(`${usage()}\n`);
      return command === undefined || command === "help" ? 0 : 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
