#!/usr/bin/env node
// Generates the project atlas under atlas/ from the source tree.
// Every fact on a generated page cites `path:line`, and checkAtlas verifies
// those citations, so an agent can open the cited line to confirm a claim.
// Node built-ins only: no model call, no network access, no provider.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const GENERATOR = "tools/atlas/generate.mjs";
const ATLAS_DIR = "atlas";
const ENGINE_FILE = "apps/engine/src/engine.ts";
const CAPABILITIES_DIR = "apps/engine/src/capabilities";
const SCHEMA_DIR = "apps/engine/src/database/schema";
const MIGRATIONS_DIR = "apps/engine/drizzle";
const ENV_FILE = ".env.example";
const SNAPSHOT_FILE = "invokta.mcp.json";
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", ".git"]);
const TEST_SOURCE = /\.(test|check)\.|\/test\//;
const SECRET_KEY = /PASSWORD|SECRET|TOKEN|_KEY|DATABASE_URL/;
const IGNORED_HOSTS = /^(localhost|127\.0\.0\.1)$|example\.(com|org|net)$|\.example$/;
const CITATION = /((?:[\w.-]+\/)*[\w.-]+\.(?:ts|tsx|mjs|js|json|md|sql|toml|yml|yaml|sh|html|example)):(\d+)/g;

// Omni has no default project: it maps only the root it is given, either as
// the path argument or through ATLAS_PROJECT. Returns null when neither is set.
export function projectFromArguments(argv, environment = process.env) {
  const path = argv[1] ?? environment.ATLAS_PROJECT;
  return path ? resolve(path) : null;
}

function read(root, relativePath) {
  const path = join(root, relativePath);
  return existsSync(path) && statSync(path).isFile() ? readFileSync(path, "utf8") : null;
}

function listFiles(root, relativeDir, accept = () => true) {
  const base = join(root, relativeDir);
  if (!existsSync(base)) return [];
  const found = [];
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), relative);
        continue;
      }
      const file = `${relativeDir}/${relative}`;
      if (accept(file)) found.push(file);
    }
  };
  walk(base, "");
  return found.sort();
}

function listDirectories(root, relativeDir) {
  const base = join(root, relativeDir);
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

function lineOfPattern(text, pattern, fallback = 1) {
  const index = text.search(pattern);
  return index < 0 ? fallback : lineOf(text, index);
}

function lineOfText(text, needle) {
  const index = text.indexOf(needle);
  return index < 0 ? null : lineOf(text, index);
}

function cell(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function markdownTable(headers, rows) {
  const lines = [
    `| ${headers.map(cell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
  ];
  return lines.join("\n");
}

function digestOf(inputs) {
  const hash = createHash("sha256");
  for (const [path, content] of inputs) hash.update(`${path}\0${content}\0`);
  return hash.digest("hex").slice(0, 16);
}

// Parsers. Pure functions over source text, so they can be tested directly.

export function parseEngineRegistry(text) {
  const start = text.indexOf("    capabilities: {");
  if (start < 0) return [];
  const end = text.indexOf("\n    },", start);
  const block = text.slice(start, end < 0 ? undefined : end);
  const pattern = /^ {6}([a-z][a-z0-9_]*):\s*(\w+)\.(\w+),?$/gm;
  return [...block.matchAll(pattern)].map((match) => ({
    id: match[1],
    group: match[2],
    member: match[3],
    line: lineOf(text, start + match.index),
  }));
}

export function parseGroups(text) {
  const factoryFiles = new Map();
  for (const match of text.matchAll(/import\s*\{\s*(create\w+Capabilities)\s*\}\s*from\s*"\.\/capabilities\/([\w-]+)\.js"/g)) {
    factoryFiles.set(match[1], `${CAPABILITIES_DIR}/${match[2]}.ts`);
  }
  const groups = new Map();
  for (const match of text.matchAll(/const (\w+) = (create\w+Capabilities)\(/g)) {
    groups.set(match[1], { factory: match[2], file: factoryFiles.get(match[2]) ?? null });
  }
  return groups;
}

export function parseTables(text) {
  return [...text.matchAll(/pgTable\(\s*"([a-z_][a-z0-9_]*)"/g)].map((match) => ({
    name: match[1],
    line: lineOf(text, match.index),
  }));
}

export function parseEnvExample(text) {
  const lines = text.split("\n");
  const entries = [];
  lines.forEach((line, index) => {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match) return;
    const comment = [];
    for (let above = index - 1; above >= 0 && lines[above].startsWith("#"); above -= 1) {
      comment.unshift(lines[above].replace(/^#\s?/, ""));
    }
    entries.push({
      key: match[1],
      value: SECRET_KEY.test(match[1]) ? "<secret placeholder>" : match[2],
      description: comment.join(" ").trim(),
      line: index + 1,
    });
  });
  return entries;
}

export function parseHosts(text) {
  return [...text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)]
    .map((match) => ({ host: match[1].toLowerCase(), line: lineOf(text, match.index) }))
    .filter(({ host }) => !IGNORED_HOSTS.test(host));
}

// Inputs: every file a generated page depends on.

function collectInputs(root) {
  const inputs = new Map();
  const add = (path) => {
    const content = read(root, path);
    if (content !== null) inputs.set(path, content);
  };
  add(ENGINE_FILE);
  add(ENV_FILE);
  for (const path of listFiles(root, CAPABILITIES_DIR, (file) => file.endsWith(".ts"))) add(path);
  for (const path of listFiles(root, SCHEMA_DIR, (file) => file.endsWith(".ts"))) add(path);
  for (const path of listFiles(root, MIGRATIONS_DIR, (file) => file.endsWith(".sql"))) add(path);
  for (const app of listDirectories(root, "apps")) {
    add(`apps/${app}/package.json`);
    for (const path of listFiles(root, `apps/${app}/src`, (file) => /\.(ts|tsx|mjs)$/.test(file) && !TEST_SOURCE.test(file))) add(path);
  }
  return new Map([...inputs].sort(([a], [b]) => a.localeCompare(b)));
}

// Renderers. Each returns the page text; citations come from the same source reads.

function header(digest) {
  return `<!-- generated by ${GENERATOR}. Do not edit by hand. Source digest: ${digest} -->`;
}

function renderCapabilities(root, digest) {
  const engine = read(root, ENGINE_FILE) ?? "";
  const groups = parseGroups(engine);
  const entries = parseEngineRegistry(engine);
  const rows = entries.map((entry) => {
    const group = groups.get(entry.group);
    const factoryText = group?.file ? read(root, group.file) : null;
    const factoryLine = factoryText && group ? lineOfText(factoryText, `export function ${group.factory}(`) : null;
    const factory = group?.file ? (factoryLine ? `${group.file}:${factoryLine}` : group.file) : "not resolved";
    return [`\`${entry.id}\``, entry.group, `\`${ENGINE_FILE}:${entry.line}\``, `\`${factory}\``];
  });
  return [
    header(digest),
    "",
    "# Capabilities",
    "",
    `The engine registers ${entries.length} capabilities. Each row cites the registration in \`${ENGINE_FILE}\` and the factory that defines it.`,
    "",
    "Access, timeout, and annotations live in each factory file. This page gives identity and location only.",
    "",
    markdownTable(["Capability", "Domain", "Registered at", "Factory"], rows),
    "",
  ].join("\n");
}

function renderMap(root, digest) {
  const workspaceRows = listDirectories(root, "apps").flatMap((app) => {
    const path = `apps/${app}/package.json`;
    const text = read(root, path);
    if (text === null) return [];
    const parsed = JSON.parse(text);
    return [[`\`${parsed.name ?? app}\``, `\`apps/${app}/\``, parsed.version ?? "—", `\`${path}:${lineOfPattern(text, /"name"/)}\``]];
  });
  const candidates = [
    ["Engine composition root", "apps/engine/src/engine.ts"],
    ["Direct invocation", "apps/engine/src/direct.ts"],
    ["MCP HTTP entry", "apps/engine/src/mcp-http.ts"],
    ["HTTP authentication", "apps/engine/src/http-auth.ts"],
    ["Server runtime", "apps/server/src/runtime.ts"],
    ["Automation worker", "apps/server/src/services/automation/worker.ts"],
    ["Release publisher", "apps/server/src/release/publisher.ts"],
    ["Admin application", "apps/admin/src/main.tsx"],
  ];
  const entryRows = candidates
    .filter(([, path]) => read(root, path) !== null)
    .map(([label, path]) => [label, `\`${path}:1\``]);
  const services = listDirectories(root, "apps/server/src/services").map((name) => `\`apps/server/src/services/${name}/\``);
  return [
    header(digest),
    "",
    "# Map",
    "",
    "## Workspaces",
    "",
    markdownTable(["Package", "Path", "Version", "Declared at"], workspaceRows),
    "",
    "## Entry points",
    "",
    markdownTable(["Role", "File"], entryRows),
    "",
    "## Server services",
    "",
    services.length > 0 ? services.map((service) => `- ${service}`).join("\n") : "None found.",
    "",
  ].join("\n");
}

function renderDataModel(root, digest) {
  const tableRows = listFiles(root, SCHEMA_DIR, (file) => file.endsWith(".ts")).flatMap((file) =>
    parseTables(read(root, file) ?? "").map((table) => ({ ...table, file })),
  );
  tableRows.sort((a, b) => a.name.localeCompare(b.name));
  const migrationRows = listFiles(root, MIGRATIONS_DIR, (file) => file.endsWith(".sql")).map((file) => [
    `\`${file.split("/").pop()}\``,
    `\`${file}:1\``,
  ]);
  return [
    header(digest),
    "",
    "# Data model",
    "",
    `${tableRows.length} tables are declared with \`pgTable\` in \`${SCHEMA_DIR}/\`.`,
    "",
    markdownTable(
      ["Table", "Declared at"],
      tableRows.map((table) => [`\`${table.name}\``, `\`${table.file}:${table.line}\``]),
    ),
    "",
    "## Migrations",
    "",
    markdownTable(["Migration", "File"], migrationRows),
    "",
  ].join("\n");
}

function renderConfig(root, digest) {
  const entries = parseEnvExample(read(root, ENV_FILE) ?? "");
  return [
    header(digest),
    "",
    "# Configuration",
    "",
    `Variables documented in \`${ENV_FILE}\`. Secret values appear as placeholders.`,
    "",
    markdownTable(
      ["Variable", "Example value", "Description", "Declared at"],
      entries.map((entry) => [`\`${entry.key}\``, `\`${entry.value}\``, entry.description || "—", `\`${ENV_FILE}:${entry.line}\``]),
    ),
    "",
  ].join("\n");
}

function sourceFiles(root) {
  return listFiles(root, "apps", (file) => /^apps\/[^/]+\/src\/.*\.(ts|tsx|mjs)$/.test(file) && !TEST_SOURCE.test(file));
}

function renderExternal(root, digest) {
  const hosts = new Map();
  const fetches = [];
  for (const file of sourceFiles(root)) {
    const text = read(root, file) ?? "";
    for (const { host, line } of parseHosts(text)) {
      const sites = hosts.get(host) ?? [];
      sites.push(`${file}:${line}`);
      hosts.set(host, sites);
    }
    for (const match of text.matchAll(/\bfetch\(/g)) fetches.push(`${file}:${lineOf(text, match.index)}`);
  }
  const hostRows = [...hosts]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([host, sites]) => [`\`${host}\``, sites.map((site) => `\`${site}\``).join(", ")]);
  return [
    header(digest),
    "",
    "# External dependencies",
    "",
    "Hosts referenced from production source (tests excluded). Comments count as references, so review each row before adding it to the allowlist.",
    "",
    "## Hosts",
    "",
    markdownTable(["Host", "Referenced at"], hostRows),
    "",
    "## Outbound call sites",
    "",
    "Listed by location. A call to a relative URL reaches this project's own server, not an external host.",
    "",
    markdownTable(
      ["Call"],
      fetches.map((site) => [`\`${site}\``]),
    ),
    "",
  ].join("\n");
}

function buildIndex(root, digest) {
  const engine = read(root, ENGINE_FILE) ?? "";
  const groups = parseGroups(engine);
  const capabilities = parseEngineRegistry(engine).map((entry) => ({
    id: entry.id,
    domain: entry.group,
    file: ENGINE_FILE,
    line: entry.line,
    factory: groups.get(entry.group)?.file ?? null,
  }));
  const tables = listFiles(root, SCHEMA_DIR, (file) => file.endsWith(".ts"))
    .flatMap((file) => parseTables(read(root, file) ?? "").map((table) => ({ name: table.name, file, line: table.line })))
    .sort((a, b) => a.name.localeCompare(b.name));
  const config = parseEnvExample(read(root, ENV_FILE) ?? "").map((entry) => ({ key: entry.key, file: ENV_FILE, line: entry.line }));
  return {
    schemaVersion: 1,
    generator: GENERATOR,
    digest,
    capabilities,
    tables,
    config,
  };
}

export function generateAtlas(root) {
  const digest = digestOf(collectInputs(root));
  const pages = new Map();
  pages.set(`${ATLAS_DIR}/capabilities.md`, renderCapabilities(root, digest));
  pages.set(`${ATLAS_DIR}/map.md`, renderMap(root, digest));
  pages.set(`${ATLAS_DIR}/data-model.md`, renderDataModel(root, digest));
  pages.set(`${ATLAS_DIR}/config.md`, renderConfig(root, digest));
  pages.set(`${ATLAS_DIR}/external-dependencies.md`, renderExternal(root, digest));
  pages.set(`${ATLAS_DIR}/index.json`, `${JSON.stringify(buildIndex(root, digest), null, 2)}\n`);
  return pages;
}

export function writeAtlas(root) {
  const pages = generateAtlas(root);
  mkdirSync(join(root, ATLAS_DIR), { recursive: true });
  for (const [path, content] of pages) writeFileSync(join(root, path), content);
  return [...pages.keys()];
}

export function checkCitations(root, pagePaths) {
  const errors = [];
  for (const page of pagePaths) {
    const text = read(root, page) ?? "";
    for (const match of text.matchAll(CITATION)) {
      const [, file, rawLine] = match;
      const line = Number(rawLine);
      const content = read(root, file);
      const where = `${page}: ${file}:${line}`;
      if (content === null) {
        errors.push(`${where} does not exist.`);
        continue;
      }
      const count = content.endsWith("\n") ? content.split("\n").length - 1 : content.split("\n").length;
      if (line < 1 || line > count) errors.push(`${where} is past the end of the file (${count} lines).`);
    }
  }
  return errors;
}

function checkRegistry(root) {
  const snapshot = read(root, SNAPSHOT_FILE);
  if (snapshot === null) return [];
  const documented = new Set(JSON.parse(snapshot).capabilityIds);
  const registered = new Set(parseEngineRegistry(read(root, ENGINE_FILE) ?? "").map((entry) => entry.id));
  const errors = [];
  for (const id of documented) if (!registered.has(id)) errors.push(`capability ${id} is in ${SNAPSHOT_FILE} but not registered in ${ENGINE_FILE}.`);
  for (const id of registered) if (!documented.has(id)) errors.push(`capability ${id} is registered in ${ENGINE_FILE} but not in ${SNAPSHOT_FILE}.`);
  return errors;
}

export function checkAtlas(root) {
  const errors = [];
  const pages = generateAtlas(root);
  for (const [path, content] of pages) {
    const current = read(root, path);
    if (current === null) errors.push(`${path} is missing: run npm run atlas:generate.`);
    else if (current !== content) errors.push(`${path} is stale: run npm run atlas:generate.`);
  }
  const pagePaths = listFiles(root, ATLAS_DIR, (file) => file.endsWith(".md"));
  errors.push(...checkCitations(root, pagePaths));
  errors.push(...checkRegistry(root));
  return errors;
}

function main(argv) {
  const command = argv[0] ?? "generate";
  const root = projectFromArguments(argv);
  if (!["generate", "check"].includes(command) || !root) {
    process.stderr.write(
      "Usage: node scripts/atlas.mjs <generate|check> <project-root>\nOr set ATLAS_PROJECT. There is no default project.\n",
    );
    return 1;
  }
  if (command === "generate") {
    for (const path of writeAtlas(root)) process.stdout.write(`wrote ${path}\n`);
    return 0;
  }
  if (command === "check") {
    const errors = checkAtlas(root);
    for (const error of errors) process.stderr.write(`${error}\n`);
    if (errors.length === 0) process.stdout.write("Atlas is up to date and every citation resolves.\n");
    return errors.length === 0 ? 0 : 1;
  }
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
