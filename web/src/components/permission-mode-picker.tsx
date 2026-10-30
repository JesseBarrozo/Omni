import React from "react";
import { Hand, FilePenLine, ShieldCheck, ShieldAlert, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type PermissionMode = "ask" | "accept-edits" | "auto" | "full-access";

export type PermissionOption = {
  id: PermissionMode;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  isWarning?: boolean;
};

export const PERMISSION_OPTIONS: PermissionOption[] = [
  {
    id: "ask",
    label: "Demander l’approbation",
    description: "Demande avant les modifications et commandes que vos réglages n'autorisent pas",
    icon: Hand,
  },
  {
    id: "accept-edits",
    label: "Accepter les modifications",
    description: "Approuve les modifications et commandes de fichiers ; demande pour le reste",
    icon: FilePenLine,
  },
  {
    id: "auto",
    label: "Approuver pour moi",
    description: "Examine les demandes d’approbation pour vous",
    icon: ShieldCheck,
  },
  {
    id: "full-access",
    label: "Accès complet",
    description: "Ne demande jamais avant les modifications ou les commandes",
    icon: ShieldAlert,
    isWarning: true,
  },
];

export type PermissionModePickerProps = {
  value: PermissionMode;
  onChange: (value: PermissionMode) => void;
  disabled?: boolean;
  className?: string;
};

export function PermissionModePicker({
  value,
  onChange,
  disabled = false,
  className,
}: PermissionModePickerProps) {
  const currentOption =
    PERMISSION_OPTIONS.find((opt) => opt.id === value) ?? PERMISSION_OPTIONS[0];
  const CurrentIcon = currentOption.icon;
  const isFullAccess = value === "full-access";

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "composer-permissions inline-flex items-center gap-1.5 text-xs font-medium cursor-pointer py-1 px-2 rounded-md transition-colors",
            isFullAccess
              ? "text-amber-400 hover:text-amber-300"
              : "text-muted-foreground hover:text-foreground",
            disabled && "opacity-50 pointer-events-none",
            className,
          )}
          aria-label={`Mode d'autorisation : ${currentOption.label}`}
          title="Choisir le traitement des demandes d’autorisation"
        >
          <CurrentIcon
            className={cn(
              "size-3.5 shrink-0",
              isFullAccess && "text-amber-400",
            )}
          />
          <span className="truncate">{currentOption.label}</span>
          <ChevronDown
            className={cn(
              "size-3 shrink-0 opacity-60",
              isFullAccess && "text-amber-400 opacity-80",
            )}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={6}
        collisionPadding={8}
        className="w-[320px] p-1.5 bg-[#18191b] border-border/80 shadow-2xl rounded-xl z-50"
      >
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(val) => onChange(val as PermissionMode)}
        >
          {PERMISSION_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const isSelected = value === opt.id;
            const isWarningItem = opt.isWarning;

            return (
              <DropdownMenuRadioItem
                key={opt.id}
                value={opt.id}
                className={cn(
                  "relative flex cursor-pointer select-none items-start gap-2.5 rounded-lg py-2 pr-2.5 pl-8 text-xs outline-none transition-colors",
                  isSelected
                    ? "bg-white/[0.08]"
                    : "hover:bg-white/[0.04]",
                )}
              >
                <div className="flex flex-col gap-0.5 min-w-0">
                  <div
                    className={cn(
                      "flex items-center gap-1.5 font-medium text-xs",
                      isWarningItem && (isSelected ? "text-amber-400" : "text-amber-400/90"),
                      !isWarningItem && "text-foreground",
                    )}
                  >
                    <Icon
                      className={cn(
                        "size-3.5 shrink-0",
                        isWarningItem ? "text-amber-400" : "text-foreground/90",
                      )}
                    />
                    <span>{opt.label}</span>
                  </div>
                  <div className="text-[11px] leading-snug text-muted-foreground font-normal">
                    {opt.description}
                  </div>
                </div>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

