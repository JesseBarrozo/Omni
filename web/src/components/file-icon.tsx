import theme from "@/assets/vscode-seti/theme.json";
import languages from "@/assets/vscode-seti/languages.json";
import folderIcon from "@/assets/vscode-seti/folder.svg";
import folderOpenIcon from "@/assets/vscode-seti/folder-open.svg";

type IconDefinition = { fontCharacter?: string; fontColor?: string };
const definitions = theme.iconDefinitions as Record<string, IconDefinition>;
const names = theme.fileNames as Record<string, string>;
const extensions = theme.fileExtensions as Record<string, string>;
const languageNames = languages.fileNames as Record<string, string>;
const languageExtensions = languages.fileExtensions as Record<string, string>;

/** Apply VS Code's file-name, compound-extension, then language association precedence. */
export function resolveFileIcon(path: string): IconDefinition {
  const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  const suffixes = name.split(".").map((_, index, parts) => parts.slice(index).join(".")).filter(Boolean);
  const lookup = (mapping: Record<string, string>) => suffixes.map((suffix) => mapping[suffix]).find(Boolean);
  const iconId = names[name] ?? lookup(extensions) ?? languageNames[name] ?? lookup(languageExtensions) ?? theme.file;
  return definitions[iconId] ?? definitions[theme.file];
}

export function FileIcon({ path, directory = false, open = false }: { path: string; directory?: boolean; open?: boolean }) {
  if (directory) return <img className="vscode-file-icon vscode-folder-icon" src={open ? folderOpenIcon : folderIcon} alt="" aria-hidden="true" />;
  const icon = resolveFileIcon(path);
  const code = Number.parseInt((icon.fontCharacter ?? "").replace(/^\\/, ""), 16);
  return <span className="vscode-file-icon vscode-seti-icon" style={{ color: icon.fontColor }} aria-hidden="true">{Number.isFinite(code) ? String.fromCodePoint(code) : ""}</span>;
}
