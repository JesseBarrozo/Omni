import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  Terminal,
  Globe,
  FilePlus,
  MessageSquarePlus,
  Smartphone,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type TabCreateDropdownProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  onNewTerminal: () => void;
  onNewBrowser: () => void;
  onNewMarkdown: () => void;
  onNewChat: () => void;
  onNewMobileEmulator?: () => void;
  onSelectAgent?: (agentId: string) => void;
  onOpenSettings?: () => void;
  onOpenTeams?: () => void;
  openTabs?: Array<{ id: string; title: string; type: "chat" | "file" | "browser" | "terminal" }>;
  onSelectTab?: (tabId: string) => void;
};

type MenuItem = {
  id: string;
  category: "action" | "chat";
  label: string;
  shortcut?: string;
  icon: React.ReactNode;
  keywords: string[];
  action: () => void;
};

export function TabCreateDropdown({
  isOpen,
  onOpenChange,
  children,
  onNewTerminal,
  onNewBrowser,
  onNewMarkdown,
  onNewChat,
  onNewMobileEmulator,
  openTabs = [],
  onSelectTab,
}: TabCreateDropdownProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      const frame = requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [isOpen]);

  const allItems: MenuItem[] = useMemo(() => {
    return [
      {
        id: "new-terminal",
        category: "action",
        label: "Nouveau terminal",
        shortcut: "⌘T",
        icon: <Terminal className="size-3.5 text-muted-foreground shrink-0" />,
        keywords: ["terminal", "bash", "zsh", "console", "cmd", "shell"],
        action: () => {
          onNewTerminal();
          onOpenChange(false);
        },
      },
      {
        id: "new-browser",
        category: "action",
        label: "Nouvel onglet de navigateur",
        shortcut: "⌘⇧B",
        icon: <Globe className="size-3.5 text-muted-foreground shrink-0" />,
        keywords: ["navigateur", "browser", "web", "http", "localhost", "url", "onglet"],
        action: () => {
          onNewBrowser();
          onOpenChange(false);
        },
      },
      {
        id: "new-markdown",
        category: "action",
        label: "Nouveau Markdown",
        shortcut: "⌘⇧M",
        icon: <FilePlus className="size-3.5 text-muted-foreground shrink-0" />,
        keywords: ["markdown", "md", "fichier", "doc", "document", "note"],
        action: () => {
          onNewMarkdown();
          onOpenChange(false);
        },
      },
      {
        id: "new-mobile",
        category: "action",
        label: "Nouvel émulateur mobile",
        shortcut: "⌘⌥⇧E",
        icon: <Smartphone className="size-3.5 text-muted-foreground shrink-0" />,
        keywords: ["mobile", "émulateur", "responsive", "iphone", "android", "phone"],
        action: () => {
          if (onNewMobileEmulator) onNewMobileEmulator();
          else onNewBrowser();
          onOpenChange(false);
        },
      },
      // Replaces the framed agent options with "Lancer un nouveau chat"
      {
        id: "new-chat",
        category: "chat",
        label: "Lancer un nouveau chat",
        shortcut: "⇧⌘O",
        icon: <MessageSquarePlus className="size-3.5 text-muted-foreground shrink-0" />,
        keywords: [
          "chat",
          "nouveau chat",
          "lancer",
          "lancer un nouveau chat",
          "session",
          "conversation",
          "discussion",
          "nouvelle session",
        ],
        action: () => {
          onNewChat();
          onOpenChange(false);
        },
      },
    ];
  }, [
    onNewTerminal,
    onNewBrowser,
    onNewMarkdown,
    onNewChat,
    onNewMobileEmulator,
    onOpenChange,
  ]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allItems;
    return allItems.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.keywords.some((kw) => kw.toLowerCase().includes(q)),
    );
  }, [allItems, query]);

  const matchingTabs = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return openTabs.filter((t) => t.title.toLowerCase().includes(q));
  }, [openTabs, query]);

  const totalCount = matchingTabs.length + filteredItems.length;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (totalCount > 0 ? (prev + 1) % totalCount : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) =>
        totalCount > 0 ? (prev - 1 + totalCount) % totalCount : 0,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (matchingTabs.length > 0 && selectedIndex < matchingTabs.length) {
        const tab = matchingTabs[selectedIndex];
        if (tab && onSelectTab) {
          onSelectTab(tab.id);
          onOpenChange(false);
        }
      } else {
        const itemIndex = selectedIndex - matchingTabs.length;
        const item = filteredItems[itemIndex >= 0 ? itemIndex : 0];
        if (item) item.action();
      }
    }
  };

  return (
    <DropdownMenu open={isOpen} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="tab-create-dropdown w-72 sm:w-80 rounded-[12px] border border-border/80 bg-[#161619] shadow-[0_20px_48px_rgba(0,0,0,0.7)] p-1.5 backdrop-blur-md outline-none"
        onCloseAutoFocus={(e) => {
          // Avoid stealing focus from newly mounted terminal/editor
          e.preventDefault();
        }}
      >
        {/* Omnibox input at top (Orca-inspired) */}
        <div className="px-2 pt-1 pb-1.5" onKeyDown={handleKeyDown}>
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedIndex(0);
              }}
              placeholder="Recherchez les onglets ouverts, l'historique, les..."
              className="w-full bg-transparent border-0 outline-none text-[12px] text-foreground placeholder:text-muted-foreground/60 leading-5"
            />
          </div>
        </div>

        <div className="h-px bg-border/40 mx-0.5 mb-1" />

        <div className="max-h-[380px] overflow-y-auto space-y-0.5 pr-0.5">
          {/* Open tabs matching search */}
          {matchingTabs.length > 0 && (
            <div className="pb-1">
              <DropdownMenuLabel>Onglets ouverts</DropdownMenuLabel>
              {matchingTabs.map((tab, idx) => {
                const isSelected = selectedIndex === idx;
                return (
                  <DropdownMenuItem
                    key={tab.id}
                    className={cn(
                      "justify-between text-[12px] py-1.5",
                      isSelected && "bg-accent text-accent-foreground font-semibold",
                    )}
                    onSelect={() => {
                      onSelectTab?.(tab.id);
                      onOpenChange(false);
                    }}
                    onMouseEnter={() => setSelectedIndex(idx)}
                  >
                    <span className="truncate flex-1">{tab.title}</span>
                    <span className="text-[10.5px] text-muted-foreground/80 shrink-0">
                      Basculer
                    </span>
                  </DropdownMenuItem>
                );
              })}
              <DropdownMenuSeparator />
            </div>
          )}

          {/* Action options (Nouveau terminal, Nouvel onglet de navigateur, Nouveau Markdown, Nouvel émulateur mobile) */}
          {filteredItems
            .filter((item) => item.category === "action")
            .map((item, idx) => {
              const actualIdx = matchingTabs.length + idx;
              const isSelected = selectedIndex === actualIdx;
              return (
                <DropdownMenuItem
                  key={item.id}
                  className={cn(
                    "justify-between text-[12.5px] py-1.5",
                    isSelected && "bg-accent text-accent-foreground font-semibold",
                  )}
                  onSelect={item.action}
                  onMouseEnter={() => setSelectedIndex(actualIdx)}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {item.icon}
                    <span className="truncate">{item.label}</span>
                  </div>
                  {item.shortcut && (
                    <DropdownMenuShortcut>{item.shortcut}</DropdownMenuShortcut>
                  )}
                </DropdownMenuItem>
              );
            })}

          {/* Separator before "Lancer un nouveau chat" */}
          {filteredItems.some((i) => i.category === "action") &&
            filteredItems.some((i) => i.category === "chat") && (
              <DropdownMenuSeparator />
            )}

          {/* Chat option (Lancer un nouveau chat) */}
          {filteredItems
            .filter((item) => item.category === "chat")
            .map((item, idx) => {
              const actionCount = filteredItems.filter(
                (i) => i.category === "action",
              ).length;
              const actualIdx = matchingTabs.length + actionCount + idx;
              const isSelected = selectedIndex === actualIdx;
              return (
                <DropdownMenuItem
                  key={item.id}
                  className={cn(
                    "justify-between text-[12.5px] py-1.5",
                    isSelected && "bg-accent text-accent-foreground font-semibold",
                  )}
                  onSelect={item.action}
                  onMouseEnter={() => setSelectedIndex(actualIdx)}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {item.icon}
                    <span className="truncate">{item.label}</span>
                  </div>
                  {item.shortcut && (
                    <DropdownMenuShortcut>{item.shortcut}</DropdownMenuShortcut>
                  )}
                </DropdownMenuItem>
              );
            })}

          {filteredItems.length === 0 && matchingTabs.length === 0 && (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">
              Aucun résultat trouvé pour "{query}"
            </div>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
