import React, { useMemo, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { openCodeModelPresentation } from "@/lib/model-presentation";

export type EffortLevel = "low" | "medium" | "high" | "max";

export type ModelItem = {
  id: string;
  providerId?: string;
  name?: string;
  description?: string;
  isFree?: boolean;
};

function humanizeModelName(id: string): string {
  // Format known models nicely
  if (id === "auto" || id === "auto-orchestrator") return "Auto";
  const raw = id.includes("::") ? id.split("::").slice(1).join("::") : id;
  return raw
    .replace(/^(claude-(?:opus|sonnet|haiku|fable))-(\d+)-(\d+)(?=-|$)/i, "$1-$2.$3")
    .replace(/-\d{8}$/, "")
    .replace(/-sonnet-/, " Sonnet ")
    .replace(/-opus-/, " Opus ")
    .replace(/-haiku-/, " Haiku ")
    .replace(/-/g, " ")
    .replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

function modelSubtitle(id: string, providerId?: string): string {
  if (id === "auto" || id === "auto-orchestrator") {
    return "Orca choisit le meilleur modèle disponible.";
  }
  const prov = providerId ? providerId : id.includes("::") ? id.split("::")[0] : "";
  const modelPart = id.includes("::") ? id.split("::").slice(1).join("::") : id;
  const humanProv =
    prov === "claude"
      ? "Claude"
      : prov === "openai" || prov === "codex"
        ? "OpenAI"
        : prov === "google" || prov === "gemini"
          ? "Gemini"
          : prov;
  return `${humanProv} ${modelPart.replace(/[-_]/g, " ")}`.trim();
}

export function ChatComposerModelPicker({
  models,
  value,
  onSelect,
  effort = "medium",
  onEffortChange,
  fastMode = false,
  onFastModeChange,
  disabled,
}: {
  models: readonly (string | ModelItem)[];
  value: string;
  onSelect: (value: string) => void;
  effort?: EffortLevel;
  onEffortChange?: (effort: EffortLevel) => void;
  fastMode?: boolean;
  onFastModeChange?: (fastMode: boolean) => void;
  disabled?: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const normalizedModels: ModelItem[] = useMemo(() => {
    return models.map((m) => {
      if (typeof m === "string") {
        const [prov, ...rest] = m.includes("::") ? m.split("::") : ["", m];
        const modelId = rest.join("::");
        const presentation = prov === "opencode" ? openCodeModelPresentation(modelId) : null;
        return {
          id: m,
          providerId: prov || undefined,
          name: presentation?.name ?? humanizeModelName(m),
          description: presentation?.description ?? modelSubtitle(m, prov),
          isFree: presentation?.isFree,
        };
      }
      return {
        id: m.id,
        providerId: m.providerId,
        name: m.name ?? humanizeModelName(m.id),
        description: m.description ?? modelSubtitle(m.id, m.providerId),
        isFree: m.isFree,
      };
    });
  }, [models]);

  const allChoices: ModelItem[] = useMemo(() => {
    const autoExists = normalizedModels.some(
      (m) => m.id === "auto" || m.id === "auto-orchestrator",
    );
    const list: ModelItem[] = [];
    if (!autoExists) {
      list.push({
        id: "auto-orchestrator",
        name: "Auto",
        description: "Orca choisit le meilleur modèle disponible.",
      });
    }
    list.push(...normalizedModels);
    return list;
  }, [normalizedModels]);

  const filteredChoices = useMemo(() => {
    if (!search.trim()) return allChoices;
    const query = search.toLowerCase().trim();
    return allChoices.filter(
      (c) =>
        c.name?.toLowerCase().includes(query) ||
        c.id.toLowerCase().includes(query) ||
        c.description?.toLowerCase().includes(query),
    );
  }, [allChoices, search]);

  const selectedItem =
    allChoices.find((c) => c.id === value) ??
    (value === "auto" || value === "auto-orchestrator" ? allChoices[0] : null);

  const displayLabel =
    selectedItem?.name ??
    (value === "auto" || value === "auto-orchestrator"
      ? "Auto"
      : humanizeModelName(value));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={disabled}
          aria-label={`Modèle : ${displayLabel}`}
          className="composer-model-trigger h-7 max-w-64 min-w-0 shrink gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          <span className="truncate font-medium">{displayLabel}</span>
          <ChevronDown className="size-3 shrink-0 opacity-70" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        sideOffset={6}
        collisionPadding={8}
        className="w-96 max-w-[calc(100vw-2rem)] p-0 divide-y divide-border/50"
      >
        {/* Search header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border/40">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            type="text"
            className="w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
            placeholder="Rechercher des modèles…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
        </div>

        {/* Model list */}
        <div className="max-h-64 overflow-y-auto p-1 space-y-0.5">
          {filteredChoices.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground">
              Aucun modèle ne correspond à votre recherche.
            </div>
          ) : (
            filteredChoices.map((choice) => {
              const isSelected =
                choice.id === value ||
                ((choice.id === "auto" || choice.id === "auto-orchestrator") &&
                  (value === "auto" || value === "auto-orchestrator"));

              return (
                <button
                  key={choice.id}
                  type="button"
                  className={cn(
                    "w-full flex items-center justify-between text-left p-2 rounded-lg transition-colors cursor-pointer",
                    isSelected
                      ? "bg-accent/80 text-accent-foreground"
                      : "hover:bg-accent/40 text-foreground",
                  )}
                  onClick={() => {
                    onSelect(choice.id);
                    setOpen(false);
                  }}
                >
                  <div className="min-w-0 pr-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium truncate">
                        {choice.name}
                      </span>
                      {choice.isFree ? (
                        <Badge variant="secondary" className="text-[10px] py-0 px-1.5">
                          Free
                        </Badge>
                      ) : null}
                    </div>
                    {choice.description ? (
                      <p className="text-[11px] text-muted-foreground truncate leading-tight mt-0.5">
                        {choice.description}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex size-4 shrink-0 items-center justify-center">
                    {isSelected ? (
                      <Check className="size-3.5 text-foreground" />
                    ) : null}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Effort & Fast Mode controls */}
        <div className="p-2 space-y-2 bg-muted/20">
          {/* Effort segmented control */}
          <div className="flex items-center justify-between gap-2 px-1">
            <span className="text-xs text-muted-foreground font-medium">Effort</span>
            <div className="inline-flex rounded-lg p-0.5 bg-muted/60 text-xs">
              {(
                [
                  { key: "low", label: "Basse" },
                  { key: "medium", label: "Moy." },
                  { key: "high", label: "Haute" },
                  { key: "max", label: "Max" },
                ] as const
              ).map((lvl) => {
                const isActive = effort === lvl.key;
                return (
                  <button
                    key={lvl.key}
                    type="button"
                    className={cn(
                      "px-2 py-0.5 rounded-md text-[11px] transition-all cursor-pointer",
                      isActive
                        ? "bg-background text-foreground shadow-xs font-medium"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => onEffortChange?.(lvl.key)}
                  >
                    {lvl.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Fast Mode toggle */}
          <div className="flex items-center justify-between gap-2 px-1">
            <span className="text-xs text-muted-foreground font-medium">Mode rapide</span>
            <Switch
              checked={fastMode}
              onCheckedChange={(checked) => onFastModeChange?.(checked)}
              aria-label="Mode rapide"
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

