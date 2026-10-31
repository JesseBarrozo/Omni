import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  CodeBlock,
  CodeBlockContent,
  CodeBlockHeader,
  CodeBlockTitle,
  CodeBlockActions,
  CodeBlockCopyButton,
} from "@/components/ui/code-block";

const CITATION_REGEX = /^((?:[\w.-]+\/)*[\w.-]+\.[a-zA-Z0-9]+):(\d+)$/;
const FILE_PATH_REGEX =
  /^((?:[\w.-]+\/)*[\w.-]+\.(?:mdx?|ts|tsx|js|mjs|cjs|jsx|json|ya?ml|toml|css|scss|html|sh|py|rs|go|sql|env(?:[\w.-]+)?))$/i;

export function MarkdownContent({
  text,
  onOpenCitation,
}: {
  text: string;
  onOpenCitation?: (path: string, line?: number) => void;
}) {
  return (
    <div className="markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children }) => {
            const rawText = String(children).replace(/\n$/, "");
            if (className || rawText.includes("\n")) {
              return (
                <CodeBlock>
                  <CodeBlockHeader>
                    <CodeBlockTitle>
                      {className?.replace("language-", "") || "Code"}
                    </CodeBlockTitle>
                    <CodeBlockActions>
                      <CodeBlockCopyButton value={rawText} />
                    </CodeBlockActions>
                  </CodeBlockHeader>
                  <CodeBlockContent wrap>{rawText}</CodeBlockContent>
                </CodeBlock>
              );
            }

            if (onOpenCitation) {
              const citationMatch = CITATION_REGEX.exec(rawText);
              if (citationMatch) {
                const filePath = citationMatch[1];
                const line = Number(citationMatch[2]);
                return (
                  <button
                    type="button"
                    title={`Ouvrir ${filePath} à la ligne ${line}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenCitation(filePath, line);
                    }}
                    className="inline-flex items-center rounded bg-muted/80 px-1 py-0.5 font-mono text-xs text-primary underline-offset-2 hover:underline hover:bg-muted cursor-pointer"
                  >
                    {rawText}
                  </button>
                );
              }

              const fileMatch = FILE_PATH_REGEX.exec(rawText);
              if (fileMatch) {
                const filePath = fileMatch[1];
                return (
                  <button
                    type="button"
                    title={`Ouvrir ${filePath}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenCitation(filePath);
                    }}
                    className="inline-flex items-center rounded bg-muted/80 px-1 py-0.5 font-mono text-xs text-primary underline-offset-2 hover:underline hover:bg-muted cursor-pointer"
                  >
                    {rawText}
                  </button>
                );
              }
            }

            return <code className="inline-code">{children}</code>;
          },
          a: ({ href, children }) => {
            if (onOpenCitation && href && !/^(?:https?:|mailto:|#)/i.test(href)) {
              const [targetPath, hash] = href.split("#");
              const lineMatch = hash ? /^L?(\d+)$/i.exec(hash) : null;
              const line = lineMatch ? Number(lineMatch[1]) : undefined;
              return (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onOpenCitation(targetPath.replace(/^\.\//, ""), line);
                  }}
                  className="text-primary underline underline-offset-2 hover:text-primary/80 inline cursor-pointer text-left font-inherit p-0 bg-transparent border-none"
                >
                  {children}
                </button>
              );
            }
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            );
          },
          img: ({ alt }) => (
            <span className="text-muted-foreground">
              [Image : {alt || "contenu distant"}]
            </span>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
