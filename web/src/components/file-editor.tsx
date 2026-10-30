import { useEffect, useRef } from "react";
import Editor, { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker.js?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker.js?worker";
import CssWorker from "monaco-editor/esm/vs/language/css/css.worker.js?worker";
import HtmlWorker from "monaco-editor/esm/vs/language/html/html.worker.js?worker";
import TsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker.js?worker";

self.MonacoEnvironment = {
  getWorker(_id, label) {
    if (label === "json") return new JsonWorker();
    if (["css", "scss", "less"].includes(label)) return new CssWorker();
    if (["html", "handlebars", "razor"].includes(label))
      return new HtmlWorker();
    if (["typescript", "javascript"].includes(label)) return new TsWorker();
    return new EditorWorker();
  },
};
loader.config({ monaco });

const languages: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  mts: "typescript",
  tsx: "typescript",
  json: "json",
  css: "css",
  scss: "scss",
  html: "html",
  md: "markdown",
  mdx: "markdown",
  py: "python",
  rs: "rust",
  go: "go",
  sh: "shell",
  zsh: "shell",
  yaml: "yaml",
  yml: "yaml",
  sql: "sql",
  xml: "xml",
  svg: "xml",
  java: "java",
  c: "c",
  cpp: "cpp",
};

export default function FileEditor({
  path,
  content,
  readOnly,
  onChange,
  line,
}: {
  path: string;
  content: string;
  readOnly: boolean;
  onChange: (value: string) => void;
  line?: number;
}) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  // Jump to a line requested from elsewhere, such as a citation in the atlas.
  useEffect(() => {
    if (!line || !editorRef.current) return;
    editorRef.current.setPosition({ lineNumber: line, column: 1 });
    editorRef.current.revealLineInCenter(line);
  }, [line, path]);
  const extension = path.split(".").at(-1)?.toLowerCase() ?? "";
  return (
    <Editor
      path={path}
      language={languages[extension] ?? "plaintext"}
      value={content}
      onChange={(value) => onChange(value ?? "")}
      theme="vs-dark"
      onMount={(editor) => {
        editorRef.current = editor;
      }}
      options={{
        readOnly,
        automaticLayout: true,
        minimap: { enabled: true },
        fontSize: 13,
        padding: { top: 16 },
        scrollBeyondLastLine: false,
        wordWrap: "on",
        tabSize: 2,
      }}
      loading={<div className="editor-loading">Chargement de l’éditeur…</div>}
    />
  );
}
