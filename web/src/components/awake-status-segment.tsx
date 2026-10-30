import { useState } from "react";
import { Check, Coffee } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { api, type WorkspaceState } from "@/lib/api";

type AwakeStatus = WorkspaceState["awake"];
const modes = [
  { value: "on", label: "Activé", description: "Garder l’ordinateur éveillé en permanence" },
  { value: "auto", label: "Agent", description: "Garder l’ordinateur éveillé pendant le travail d’un agent" },
  { value: "off", label: "Désactivé", description: "Autoriser la mise en veille habituelle" },
] as const;

export function AwakeStatusSegment({ status, connected, onChange, onError }: {
  status: AwakeStatus | undefined;
  connected: boolean;
  onChange: (status: AwakeStatus) => void;
  onError: (error: unknown) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [requestError, setRequestError] = useState("");
  const mode = status?.mode ?? "off";
  const label = modes.find((item) => item.value === mode)?.label ?? "Désactivé";
  const activity = status?.active ? "Actif" : "Inactif";
  const description = requestError || status?.error || (!status?.supported ? "Indisponible sur ce système" : `${label} · ${activity}`);
  async function setMode(value: string) {
    if (busy || value === mode) return;
    setBusy(true);
    setRequestError("");
    try {
      onChange(await api<AwakeStatus>("/settings/awake", { mode: value }));
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : String(error));
      onError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="awake-segment" disabled={!connected || !status || !status.supported || busy}
          aria-label={`Empêcher la mise en veille : ${description}`} title={`Empêcher la mise en veille · ${description}`}>
          <Coffee className={status?.active ? "awake-segment-icon-active" : undefined} />
          <span>{label}</span><i className={status?.active ? "is-active" : undefined} aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="awake-menu" side="top" align="end" sideOffset={8}>
          <DropdownMenu.Label className="awake-menu-heading"><span>Empêcher la mise en veille</span><small>{label} · {activity}</small></DropdownMenu.Label>
          <DropdownMenu.Separator className="awake-menu-separator" />
          <DropdownMenu.RadioGroup value={mode} onValueChange={(value) => void setMode(value)}>
            {modes.map((item) => (
              <DropdownMenu.RadioItem key={item.value} value={item.value} className="awake-menu-option">
                <span className="awake-menu-check"><DropdownMenu.ItemIndicator><Check /></DropdownMenu.ItemIndicator></span>
                <span><strong>{item.label}</strong><small>{item.description}</small></span>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
          {(requestError || status?.error) && <p className="awake-menu-error">{requestError || status?.error}</p>}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
