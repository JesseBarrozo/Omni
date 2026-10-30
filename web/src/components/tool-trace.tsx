import { Check, Wrench, AlertCircle, Terminal, FileText } from "lucide-react";
import {
  Trace,
  TraceLine,
  TraceIcon,
  TraceTitle,
  TraceDescription,
  TraceCollapsible,
  TraceCollapsibleTrigger,
  TraceCollapsibleContent,
} from "@/components/ui/trace";
import { CodeBlock, CodeBlockContent } from "@/components/ui/code-block";
import type { OmniEvent } from "@/lib/api";
export function ToolTrace({ events }: { events: OmniEvent[] }) {
  const tools = events.filter((e) => e.type === "tool.started");
  if (!tools.length) return null;
  return (
    <Trace>
      {tools.slice(-18).map((event) => {
        const p = event.payload;
        const key = p.toolUseId ?? p.callId ?? p.itemId;
        const ended = events.find(
          (e) =>
            ["tool.completed", "tool.failed"].includes(e.type) &&
            (key
              ? (e.payload.toolUseId ??
                  e.payload.callId ??
                  e.payload.itemId) === key
              : e.payload.toolName === p.toolName) &&
            e.createdAt >= event.createdAt,
        );
        const name = p.toolName ?? p.capability?.name ?? "Outil du Harness";
        const Icon =
          ended?.type === "tool.failed"
            ? AlertCircle
            : ended
              ? Check
              : /bash|command|terminal/i.test(name)
                ? Terminal
                : /read|grep|glob/i.test(name)
                  ? FileText
                  : Wrench;
        const line = (
          <TraceLine
            status={
              ended?.type === "tool.failed"
                ? "error"
                : ended
                  ? undefined
                  : "running"
            }
          >
            <TraceIcon>
              <Icon />
            </TraceIcon>
            <TraceTitle>{name}</TraceTitle>
            <TraceDescription>
              {ended ? "terminé" : "en cours"}
            </TraceDescription>
          </TraceLine>
        );
        return (
          <TraceCollapsible key={event.id}>
            <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
            <TraceCollapsibleContent>
              <CodeBlock size="sm">
                <CodeBlockContent wrap>
                  {JSON.stringify(p, null, 2)}
                </CodeBlockContent>
              </CodeBlock>
            </TraceCollapsibleContent>
          </TraceCollapsible>
        );
      })}
    </Trace>
  );
}
