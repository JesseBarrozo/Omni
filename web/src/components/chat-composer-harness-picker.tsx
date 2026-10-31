import React, { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { AgentIcon } from "@/components/agent-icons";
import { cn } from "@/lib/utils";

export type HarnessOption = {
  id: string;
  name: string;
  enabled?: boolean;
};

export function ChatComposerHarnessPicker({
  harnesses,
  value,
  onSelect,
  disabled,
}: {
  harnesses: readonly HarnessOption[];
  value: string;
  onSelect: (value: string) => void;
  disabled?: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);

  const choices = [
    { value: "auto", label: "Auto" },
    ...harnesses
      .filter((h) => h.enabled !== false)
      .map((h) => ({
        value: h.id,
        label: h.name,
      })),
  ];

  const selected = choices.find((choice) => choice.value === value) ?? choices[0];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={disabled}
          aria-label={`Harness : ${selected?.label ?? "Auto"}`}
          className="composer-harness-trigger h-7 max-w-40 min-w-0 shrink gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          {selected && selected.value !== "auto" ? (
            <AgentIcon agent={selected.value} size={13} />
          ) : null}
          <span className="truncate font-medium">{selected?.label ?? "Auto"}</span>
          <ChevronDown className="size-3 shrink-0 opacity-70" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        sideOffset={6}
        collisionPadding={8}
        className="w-56 p-1"
      >
        <div className="flex flex-col gap-0.5">
          {choices.map((choice) => {
            const isSelected = choice.value === value;
            return (
              <Button
                key={choice.value}
                type="button"
                variant={isSelected ? "secondary" : "ghost"}
                size="sm"
                className={cn(
                  "w-full justify-between h-8 px-2 text-xs font-normal rounded-lg",
                  isSelected && "font-medium text-foreground",
                )}
                onClick={() => {
                  onSelect(choice.value);
                  setOpen(false);
                }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {choice.value !== "auto" ? (
                    <AgentIcon agent={choice.value} size={14} />
                  ) : null}
                  <span className="truncate">{choice.label}</span>
                </div>
                {isSelected ? <Check className="size-3.5 shrink-0 text-muted-foreground" /> : null}
              </Button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
