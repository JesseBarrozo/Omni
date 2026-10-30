// Atlas of the project open in the harness: status for the GUI and generation
// on request. The generator itself lives in scripts/atlas.mjs.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { writeAtlas } from "../scripts/atlas.mjs";

const ATLAS_DIR = "atlas";
const INDEX_FILE = "index.json";

// The generated index is the marker: the manual README can exist without it.
export function atlasStatus(rootPath) {
  const indexPath = join(rootPath, ATLAS_DIR, INDEX_FILE);
  if (!existsSync(indexPath)) return { present: false, path: ATLAS_DIR };
  const index = JSON.parse(readFileSync(indexPath, "utf8"));
  return {
    present: true,
    path: ATLAS_DIR,
    digest: index.digest,
    stack: index.stack ?? [],
    sourceFiles: index.sourceFiles ?? 0,
    entryPoints: index.entryPoints?.length ?? 0,
    scripts: index.scripts?.length ?? 0,
    documents: index.documents?.length ?? 0,
    externalHosts: new Set((index.externalHosts ?? []).map((site) => site.host)).size,
    capabilities: index.capabilities?.length ?? 0,
    tables: index.tables?.length ?? 0,
  };
}

export function generateAtlas(rootPath) {
  return writeAtlas(rootPath);
}
