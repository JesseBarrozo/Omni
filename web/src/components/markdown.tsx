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
export function MarkdownContent({ text }: { text: string }) {
  return (
    <div className="markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children }) => {
            const text = String(children).replace(/\n$/, "");
            return className || text.includes("\n") ? (
              <CodeBlock>
                <CodeBlockHeader>
                  <CodeBlockTitle>
                    {className?.replace("language-", "") || "Code"}
                  </CodeBlockTitle>
                  <CodeBlockActions>
                    <CodeBlockCopyButton value={text} />
                  </CodeBlockActions>
                </CodeBlockHeader>
                <CodeBlockContent wrap>{text}</CodeBlockContent>
              </CodeBlock>
            ) : (
              <code className="inline-code">{children}</code>
            );
          },
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
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
