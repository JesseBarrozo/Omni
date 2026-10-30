#!/usr/bin/env node
// Generates a project atlas under <project>/atlas/ for any project.
// Every fact on a generated page cites `path:line`, and checkAtlas verifies
// those citations, so an agent can open the cited line to confirm a claim.
// Layout-specific pages (capabilities, data model) appear only when the
// project has the matching sources. Node built-ins only: no model call, no
// network access, no provider.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { extname, join, posix, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const GENERATOR = "tools/atlas/generate.mjs";
const ATLAS_DIR = "atlas";
const ENGINE_FILE = "apps/engine/src/engine.ts";
const CAPABILITIES_DIR = "apps/engine/src/capabilities";
const SNAPSHOT_FILE = "invokta.mcp.json";
const SCHEMA_VERSION = 2;
const MAX_TEXT_BYTES = 1_000_000;
const MAX_FILES = 20_000;
const SKIPPED_NAMES = new Set([
  "node_modules", "dist", "build", "out", "coverage", "target", "vendor", "__pycache__",
  "venv", ".venv", ".git", ".next", ".nuxt", ".cache", ".turbo", ".svelte-kit", ".gradle",
  ".idea", ".vscode", ".dart_tool", "Pods",
]);
const KEPT_HIDDEN = new Set([".context", ".github", ".agents", ".claude", ".codex"]);
// The atlas output is excluded so that writing it never changes its own digest.
const SKIPPED_PATHS = new Set([ATLAS_DIR, ".context/runtime", ".context/cache"]);
const SECRET_KEY = /PASSWORD|SECRET|TOKEN|_KEY|DATABASE_URL/;
const IGNORED_HOSTS = /^(localhost|127\.0\.0\.1)$|example\.(com|org|net)$|\.example$/;
const CITATION = /((?:[\w.-]+\/)*[\w.-]+\.(?:ts|tsx|mjs|js|jsx|cjs|py|go|rs|rb|java|kt|php|cs|swift|md|json|toml|yml|yaml|sh|sql|html|example|sample|template|prisma|csproj)):(\d+)/g;
const SOURCE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".rb", ".java",
  ".kt", ".php", ".cs", ".swift", ".vue", ".svelte", ".c", ".h", ".cpp", ".hpp",
]);
const TEXT_EXTENSIONS = new Set([
  ...SOURCE_EXTENSIONS, ".md", ".json", ".toml", ".yml", ".yaml", ".sql", ".prisma",
  ".txt", ".cfg", ".ini", ".xml", ".gradle", ".kts", ".csproj", ".sln", ".html", ".css",
]);
const MANIFEST_KINDS = new Map([
  ["package.json", "node"], ["pyproject.toml", "python"], ["requirements.txt", "python"],
  ["setup.py", "python"], ["go.mod", "go"], ["Cargo.toml", "rust"], ["Gemfile", "ruby"],
  ["pom.xml", "java"], ["build.gradle", "java"], ["build.gradle.kts", "java"],
  ["composer.json", "php"], ["Package.swift", "swift"],
]);
const ENTRY_NAMES = new Set(["main", "app", "server", "cli", "__main__", "manage", "run", "worker"]);
const ENV_TEMPLATE = /(^|\/)\.?env\.(example|sample|template)$/;
const TEST_SOURCE = /\.(test|check|spec)\.|(^|\/)tests?\//;
const TEST_FILE = /\.(test|spec)\.[a-z]+$|(^|\/)tests?\/|(^|\/)test_[^/]*\.py$|_test\.(go|py)$/;
const DOCUMENT = /(^|\/)(README|AGENTS|CLAUDE|GEMINI|CONTRIBUTING|ARCHITECTURE|CHANGELOG|WORKSPACE|VERIFICATION)[^/]*\.md$|^docs\/.+\.md$|^\.context\/[^/]+\/README\.md$/i;
const OUTBOUND_CALL = /\bfetch\(|\brequests\.(get|post|put|patch|delete|request)\(|\baxios\.|\bhttpx\.|\bhttp\.(Get|Post)\(|\breqwest::|\bHttpClient\b/;

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

function isTextual(path) {
  const name = posix.basename(path);
  return ENV_TEMPLATE.test(path) || TEXT_EXTENSIONS.has(extname(name).toLowerCase());
}

function walkProject(root) {
  const found = [];
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (found.length >= MAX_FILES) return;
      if (entry.isSymbolicLink()) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (SKIPPED_NAMES.has(entry.name)) continue;
        if (entry.name.startsWith(".") && !KEPT_HIDDEN.has(entry.name)) continue;
        if (SKIPPED_PATHS.has(relative)) continue;
        walk(join(dir, entry.name), relative);
      } else if (entry.isFile()) {
        found.push(relative);
      }
    }
  };
  if (existsSync(root)) walk(root, "");
  return found.sort();
}

// A snapshot reads each textual file at most once, however many pages use it.
function snapshot(root) {
  const paths = walkProject(root);
  const known = new Set(paths);
  const cache = new Map();
  const text = (path) => {
    if (!cache.has(path)) {
      const full = join(root, path);
      const small = known.has(path) && isTextual(path) && statSync(full).size <= MAX_TEXT_BYTES;
      cache.set(path, small ? readFileSync(full, "utf8") : null);
    }
    return cache.get(path);
  };
  return { paths, text };
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
  return [
    `| ${headers.map(cell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
  ].join("\n");
}

function digestOf(inputs) {
  const hash = createHash("sha256");
  for (const [path, content] of inputs) hash.update(`${path}\0${content}\0`);
  return hash.digest("hex").slice(0, 16);
}

function header(digest) {
  return `<!-- generated by ${GENERATOR}. Do not edit by hand. Source digest: ${digest} -->`;
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

// Analysis: everything the pages report, computed once from the snapshot.

function manifestKind(path) {
  const name = posix.basename(path);
  if (/\.(csproj|sln)$/.test(name)) return "dotnet";
  return MANIFEST_KINDS.get(name) ?? null;
}

function analyze(project) {
  const { paths, text } = project;
  const present = new Set(paths);
  const shallow = (path) => path.split("/").length <= 3;

  const manifests = paths
    .filter((path) => manifestKind(path) !== null && shallow(path))
    .slice(0, 50)
    .map((path) => ({ path, kind: manifestKind(path) }));
  const stack = [...new Set([
    ...manifests.map((manifest) => manifest.kind),
    ...(present.has("tsconfig.json") ? ["typescript"] : []),
  ])].sort();

  const packages = manifests
    .filter((manifest) => posix.basename(manifest.path) === "package.json")
    .map((manifest) => {
      const body = text(manifest.path) ?? "";
      let json = {};
      try {
        json = JSON.parse(body || "{}");
      } catch {
        json = {};
      }
      return { path: manifest.path, dir: posix.dirname(manifest.path) === "." ? "" : posix.dirname(manifest.path), body, json };
    });

  const scripts = packages.flatMap((pkg) =>
    Object.entries(pkg.json.scripts ?? {}).map(([name, command]) => ({
      name,
      command: String(command),
      file: pkg.path,
      line: lineOfText(pkg.body, `"${name}":`) ?? 1,
    })),
  );

  const entryPoints = [];
  for (const pkg of packages) {
    for (const key of ["bin", "main"]) {
      const value = pkg.json[key];
      const targets = typeof value === "string" ? [value] : value && typeof value === "object" ? Object.values(value) : [];
      for (const target of targets) {
        const path = posix.normalize(posix.join(pkg.dir, String(target)));
        if (present.has(path)) entryPoints.push({ path, kind: key, declaredIn: pkg.path, line: lineOfText(pkg.body, `"${key}"`) ?? 1 });
      }
    }
  }
  for (const path of paths) {
    const name = posix.basename(path);
    const stem = name.replace(/\.[^.]+$/, "");
    if (!ENTRY_NAMES.has(stem) || !SOURCE_EXTENSIONS.has(extname(name)) || TEST_SOURCE.test(path)) continue;
    if (path.includes("/") && !/(^|\/)(src|app|cmd|bin|lib)\//.test(path)) continue;
    entryPoints.push({ path, kind: "module", declaredIn: path, line: 1 });
  }

  const documents = paths
    .filter((path) => DOCUMENT.test(path))
    .slice(0, 60)
    .map((path) => {
      const body = text(path) ?? "";
      const heading = /^#\s+(.+)$/m.exec(body);
      return heading
        ? { path, title: heading[1].trim(), line: lineOf(body, heading.index) }
        : { path, title: posix.basename(path), line: 1 };
    });

  const sourcePaths = paths.filter((path) => SOURCE_EXTENSIONS.has(extname(path)) && !TEST_SOURCE.test(path));
  const testPaths = paths.filter((path) => SOURCE_EXTENSIONS.has(extname(path)) && TEST_FILE.test(path));

  const envEntries = paths
    .filter((path) => ENV_TEMPLATE.test(path))
    .flatMap((file) => parseEnvExample(text(file) ?? "").map((entry) => ({ ...entry, file })));

  const hosts = [];
  const calls = [];
  for (const path of sourcePaths) {
    const body = text(path);
    if (body === null) continue;
    for (const { host, line } of parseHosts(body)) hosts.push({ host, file: path, line });
    body.split("\n").forEach((content, index) => {
      if (OUTBOUND_CALL.test(content)) calls.push({ file: path, line: index + 1 });
    });
  }

  const topLevel = new Map();
  for (const path of paths) {
    const first = path.split("/")[0];
    topLevel.set(first, (topLevel.get(first) ?? 0) + 1);
  }
  const structure = [...topLevel]
    .map(([name, files]) => ({ name, kind: present.has(name) ? "file" : "dir", files }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const tables = sourcePaths.flatMap((file) => parseTables(text(file) ?? "").map((table) => ({ name: table.name, file, line: table.line })));
  const prismaModels = paths
    .filter((path) => path.endsWith(".prisma"))
    .flatMap((file) => {
      const body = text(file) ?? "";
      return [...body.matchAll(/^model\s+(\w+)\s*\{/gm)].map((match) => ({ name: match[1], file, line: lineOf(body, match.index) }));
    });
  const migrations = paths.filter((path) => path.endsWith(".sql") && /(^|\/)(migrations|drizzle)\//.test(path));

  const engineText = text(ENGINE_FILE);
  const groups = engineText === null ? new Map() : parseGroups(engineText);
  const capabilities = engineText === null
    ? []
    : parseEngineRegistry(engineText).map((entry) => {
        const group = groups.get(entry.group);
        const factoryText = group?.file ? text(group.file) : null;
        const factoryLine = factoryText && group ? lineOfText(factoryText, `export function ${group.factory}(`) : null;
        return {
          id: entry.id,
          domain: entry.group,
          file: ENGINE_FILE,
          line: entry.line,
          factory: group?.file ?? null,
          factoryLine,
        };
      });

  return {
    paths, text, stack, manifests, packages, scripts, entryPoints, documents,
    sourcePaths, testPaths, envEntries, hosts, calls, structure,
    tables, prismaModels, migrations, capabilities,
    engine: engineText !== null,
    hasData: tables.length > 0 || prismaModels.length > 0 || migrations.length > 0,
  };
}

// Renderers. Each returns the page text; citations come from the same reads.

function renderMap(a, digest) {
  const stackLine = a.stack.length > 0 ? a.stack.map((kind) => `\`${kind}\``).join(", ") : "No manifest recognised.";
  const manifestRows = a.manifests.map((manifest) => [`\`${manifest.path}\``, manifest.kind, `\`${manifest.path}:1\``]);
  const structureRows = a.structure.map((entry) => [`\`${entry.name}${entry.kind === "dir" ? "/" : ""}\``, entry.kind, entry.files]);
  const entryRows = a.entryPoints.map((entry) => [`\`${entry.path}\``, entry.kind, `\`${entry.declaredIn}:${entry.line}\``]);
  const scriptRows = a.scripts.map((script) => [`\`${script.name}\``, `\`${script.command}\``, `\`${script.file}:${script.line}\``]);
  const workspaceRoot = a.packages.find((pkg) => pkg.dir === "");
  const workspaces = workspaceRoot?.json.workspaces;
  const patterns = Array.isArray(workspaces) ? workspaces : workspaces?.packages ?? [];
  const workspaceRows = patterns.map((pattern) => [`\`${pattern}\``, `\`package.json:${lineOfText(workspaceRoot.body, `"workspaces"`) ?? 1}\``]);
  return [
    header(digest), "", "# Map", "",
    "## Stack", "", stackLine, "",
    "## Manifests", "", manifestRows.length ? markdownTable(["Manifest", "Kind", "Declared at"], manifestRows) : "None found.", "",
    "## Structure", "", "Counts of files per top-level entry. Listings describe the tree; they make no claim about code.", "",
    markdownTable(["Entry", "Kind", "Files"], structureRows), "",
    "## Entry points", "", entryRows.length ? markdownTable(["Path", "Kind", "Declared at"], entryRows) : "None detected.", "",
    "## Scripts", "", scriptRows.length ? markdownTable(["Script", "Command", "Declared at"], scriptRows) : "None declared.", "",
    "## Workspaces", "", workspaceRows.length ? markdownTable(["Pattern", "Declared at"], workspaceRows) : "None declared.", "",
  ].join("\n");
}

function renderDocuments(a, digest) {
  const rows = a.documents.map((doc) => [doc.title, `\`${doc.path}\``, `\`${doc.path}:${doc.line}\``]);
  return [
    header(digest), "", "# Documents", "",
    "Project documents with their first heading. Read the cited heading to see the section in full.", "",
    rows.length ? markdownTable(["Title", "File", "Heading at"], rows) : "None found.", "",
  ].join("\n");
}

function renderConfig(a, digest) {
  const rows = a.envEntries.map((entry) => [`\`${entry.key}\``, `\`${entry.value}\``, entry.description || "—", `\`${entry.file}:${entry.line}\``]);
  return [
    header(digest), "", "# Configuration", "",
    "Variables documented in environment templates. Secret values appear as placeholders.", "",
    rows.length ? markdownTable(["Variable", "Example value", "Description", "Declared at"], rows) : "No environment template found (.env.example and its variants).",
    "",
  ].join("\n");
}

function renderExternal(a, digest) {
  const byHost = new Map();
  for (const site of a.hosts) {
    const sites = byHost.get(site.host) ?? [];
    sites.push(`${site.file}:${site.line}`);
    byHost.set(site.host, sites);
  }
  const hostRows = [...byHost]
    .sort(([x], [y]) => x.localeCompare(y))
    .map(([host, sites]) => [`\`${host}\``, sites.map((site) => `\`${site}\``).join(", ")]);
  const callRows = a.calls.slice(0, 300).map((call) => [`\`${call.file}:${call.line}\``]);
  return [
    header(digest), "", "# External dependencies", "",
    "Hosts referenced from source files (tests excluded). Comments count as references, so review each row before adding it to an allowlist.", "",
    "## Hosts", "", hostRows.length ? markdownTable(["Host", "Referenced at"], hostRows) : "None found.", "",
    "## Outbound call sites", "",
    "Calls to HTTP clients. A call to a relative URL reaches the project's own server, not an external host.", "",
    callRows.length ? markdownTable(["Call"], callRows) : "None found.", "",
  ].join("\n");
}

function renderDataModel(a, digest) {
  const tableRows = a.tables.map((table) => [`\`${table.name}\``, `\`${table.file}:${table.line}\``]);
  const modelRows = a.prismaModels.map((model) => [`\`${model.name}\``, `\`${model.file}:${model.line}\``]);
  const migrationRows = a.migrations.map((file) => [`\`${file}\``, `\`${file}:1\``]);
  return [
    header(digest), "", "# Data model", "",
    `${a.tables.length} tables declared with \`pgTable\`, ${a.prismaModels.length} Prisma models, ${a.migrations.length} SQL migrations.`, "",
    ...(tableRows.length ? [markdownTable(["Table", "Declared at"], tableRows), ""] : []),
    ...(modelRows.length ? [markdownTable(["Prisma model", "Declared at"], modelRows), ""] : []),
    ...(migrationRows.length ? ["## Migrations", "", markdownTable(["Migration", "File"], migrationRows), ""] : []),
  ].join("\n");
}

function renderCapabilities(a, digest) {
  const rows = a.capabilities.map((entry) => [
    `\`${entry.id}\``,
    entry.domain,
    `\`${entry.file}:${entry.line}\``,
    `\`${entry.factory ? (entry.factoryLine ? `${entry.factory}:${entry.factoryLine}` : entry.factory) : "not resolved"}\``,
  ]);
  return [
    header(digest), "", "# Capabilities", "",
    `The engine registers ${a.capabilities.length} capabilities. Each row cites the registration in \`${ENGINE_FILE}\` and the factory that defines it.`, "",
    "Access, timeout, and annotations live in each factory file. This page gives identity and location only.", "",
    markdownTable(["Capability", "Domain", "Registered at", "Factory"], rows), "",
  ].join("\n");
}

function renderReadme(pages, digest) {
  const descriptions = {
    "map.md": "Stack, manifests, structure, entry points, scripts, workspaces",
    "documents.md": "Project documents and their headings",
    "config.md": "Environment variables from templates",
    "external-dependencies.md": "Hosts and outbound HTTP calls",
    "data-model.md": "Tables, Prisma models, and migrations",
    "capabilities.md": "Engine capabilities and their factories",
    "index.json": "Machine-readable index of the pages above",
  };
  const rows = Object.keys(descriptions).filter((name) => pages.has(`${ATLAS_DIR}/${name}`)).map((name) => [`[${name}](${name})`, descriptions[name]]);
  return [
    header(digest), "", "# Project atlas", "",
    "Map of this project for agents and people who change it. Read the page you need.", "",
    markdownTable(["Page", "Content"], rows), "",
    "## Rules", "",
    "- Every fact cites `path:line`. Open the cited line to confirm a claim.",
    "- If a point is not covered here, read the source instead of inferring it.",
    "- Pages are generated. Regenerate after changing manifests, scripts, documents, environment templates, or sources.", "",
  ].join("\n");
}

function renderIndex(a, digest) {
  const sourceFiles = a.sourcePaths.length;
  return `${JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    generator: GENERATOR,
    digest,
    stack: a.stack,
    sourceFiles,
    manifests: a.manifests,
    entryPoints: a.entryPoints,
    scripts: a.scripts.map(({ name, command, file, line }) => ({ name, command, file, line })),
    documents: a.documents,
    env: a.envEntries.map(({ key, file, line }) => ({ key, file, line })),
    externalHosts: a.hosts,
    outboundCalls: a.calls,
    tests: { count: a.testPaths.length, sample: a.testPaths.slice(0, 20) },
    capabilities: a.capabilities,
    tables: a.tables,
  }, null, 2)}\n`;
}

export function generateAtlas(root) {
  const project = snapshot(root);
  const a = analyze(project);
  const inputs = project.paths
    .map((path) => [path, project.text(path)])
    .filter(([, content]) => content !== null);
  const digest = digestOf(inputs);

  const pages = new Map();
  pages.set(`${ATLAS_DIR}/map.md`, renderMap(a, digest));
  pages.set(`${ATLAS_DIR}/documents.md`, renderDocuments(a, digest));
  pages.set(`${ATLAS_DIR}/config.md`, renderConfig(a, digest));
  pages.set(`${ATLAS_DIR}/external-dependencies.md`, renderExternal(a, digest));
  if (a.hasData) pages.set(`${ATLAS_DIR}/data-model.md`, renderDataModel(a, digest));
  if (a.engine) pages.set(`${ATLAS_DIR}/capabilities.md`, renderCapabilities(a, digest));
  pages.set(`${ATLAS_DIR}/index.json`, renderIndex(a, digest));
  pages.set(`${ATLAS_DIR}/README.md`, renderReadme(pages, digest));
  return pages;
}

function generatedFilesNotIn(root, pages) {
  const dir = join(root, ATLAS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md") && !pages.has(`${ATLAS_DIR}/${name}`))
    .filter((name) => (read(root, `${ATLAS_DIR}/${name}`) ?? "").startsWith(`<!-- generated by ${GENERATOR}`));
}

export function writeAtlas(root) {
  const pages = generateAtlas(root);
  mkdirSync(join(root, ATLAS_DIR), { recursive: true });
  for (const name of generatedFilesNotIn(root, pages)) unlinkSync(join(root, ATLAS_DIR, name));
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
  const snapshotText = read(root, SNAPSHOT_FILE);
  if (snapshotText === null) return [];
  const documented = new Set(JSON.parse(snapshotText).capabilityIds);
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
  for (const name of generatedFilesNotIn(root, pages)) {
    errors.push(`${ATLAS_DIR}/${name} is obsolete: run npm run atlas:generate.`);
  }
  const pagePaths = [...pages.keys()].filter((path) => path.endsWith(".md"));
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
  const errors = checkAtlas(root);
  for (const error of errors) process.stderr.write(`${error}\n`);
  if (errors.length === 0) process.stdout.write("Atlas is up to date and every citation resolves.\n");
  return errors.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
