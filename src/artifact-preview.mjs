// Serves project HTML artifacts to the internal browser. The response is
// sandboxed: scripts in the artifact run in an opaque origin, without access
// to the workspace API or to the cookies of the GUI.

const ARTIFACT_DIRECTORIES = ["artifacts/", "outputs/", "output/", ".context/artifacts/"];

export const PREVIEW_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "content-security-policy": "sandbox allow-scripts allow-forms",
  "x-content-type-options": "nosniff",
  "cache-control": "no-store",
};

export function isPreviewablePath(relativePath) {
  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized.startsWith("/") || normalized.split("/").includes("..")) return false;
  return (
    /\.html?$/i.test(normalized) &&
    ARTIFACT_DIRECTORIES.some((directory) => normalized.startsWith(directory))
  );
}
