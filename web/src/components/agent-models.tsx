// Models available to Auto & Omni Chat, modelled on Orca's NativeChatModelSettings:
// a subsection header with the total count, then one collapsible group per
// provider with an enable/disable control and its models. Wired to Omni's real
// registry: GET /api/models and POST /api/settings/registry (type provider|model).

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { api } from "@/lib/api";
import { AgentIcon } from "@/components/agent-icons";
import {
  SettingsSegmentedControl,
  SettingsSubsectionHeader,
} from "@/components/settings/settings-primitives";
import { useTranslation } from "@/i18n";

type Model = {
  id: string;
  providerId: string;
  enabled: boolean;
  enabledForAuto: boolean;
  available: boolean;
};
type Provider = { id: string; name: string; enabled: boolean };
type Registry = { models: Model[]; providers: Provider[] };

// Prettify a model id for display, e.g. "gpt-6-astra" → "GPT 6 Astra".
function humanizeModel(id: string): string {
  return id
    .replace(/[-_]/g, " ")
    .replace(/\bgpt\b/gi, "GPT")
    .replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

// Provider id → agent id for the logo (the registry ids differ from the icons).
const ICON: Record<string, string> = {
  openai: "codex",
  codex: "codex",
  anthropic: "claude",
  claude: "claude",
  google: "gemini",
  gemini: "gemini",
};

export function AgentModels({ onChanged }: { onChanged?: () => void }) {
  const { t } = useTranslation();
  const [registry, setRegistry] = useState<Registry | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRegistry(await api<Registry>("/models"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      await api("/settings/registry", body);
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const groups = useMemo(() => {
    if (!registry) return [];
    const byProvider = new Map<string, Model[]>();
    for (const model of registry.models) {
      const list = byProvider.get(model.providerId) ?? [];
      list.push(model);
      byProvider.set(model.providerId, list);
    }
    return [...byProvider.entries()].map(([providerId, models]) => ({
      providerId,
      models,
      provider: registry.providers.find((p) => p.id === providerId),
    }));
  }, [registry]);
  const modelCount = groups.reduce((count, group) => count + group.models.length, 0);

  return (
    <div className="agent-models" data-settings-section="agent-models">
      <SettingsSubsectionHeader
        title={
          <span className="account-head">
            {t("settings.models.title")}
            <Badge variant="secondary">{modelCount}</Badge>
          </span>
        }
        description={t("settings.models.hint")}
      />
      {error && (
        <div className="settings-error" role="alert">
          {error}
        </div>
      )}
      {groups.length ? (
        <div className="model-provider-list">
          {groups.map(({ providerId, models, provider }) => (
            <ModelProviderGroup
              key={providerId}
              providerId={providerId}
              providerLabel={provider?.name ?? providerId}
              providerEnabled={provider?.enabled !== false}
              models={models}
              busy={busy}
              onToggleProvider={(enabled) =>
                void toggle({ type: "provider", id: providerId, enabled })
              }
              onToggleModel={(modelId, enabled) =>
                void toggle({ type: "model", providerId, id: modelId, enabled })
              }
              t={t}
            />
          ))}
        </div>
      ) : (
        <p className="account-empty">{t("settings.models.none")}</p>
      )}
    </div>
  );
}

function ModelProviderGroup({
  providerId,
  providerLabel,
  providerEnabled,
  models,
  busy,
  onToggleProvider,
  onToggleModel,
  t,
}: {
  providerId: string;
  providerLabel: string;
  providerEnabled: boolean;
  models: Model[];
  busy: boolean;
  onToggleProvider: (enabled: boolean) => void;
  onToggleModel: (modelId: string, enabled: boolean) => void;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className={providerEnabled ? "model-provider-row" : "model-provider-row is-off"}>
        <CollapsibleTrigger asChild>
          <button type="button" className="model-provider-head" aria-label={providerLabel}>
            <span className="model-provider-icon">
              <AgentIcon agent={ICON[providerId] ?? providerId} size={16} />
            </span>
            <span className="model-provider-name">{providerLabel}</span>
            <Badge variant="secondary">{models.length}</Badge>
          </button>
        </CollapsibleTrigger>
        <SettingsSegmentedControl
          className="settings-agent-toggle"
          ariaLabel={`${providerLabel} — ${t("settings.enabled")} / ${t("settings.disabled")}`}
          value={providerEnabled ? "on" : "off"}
          onChange={(next) => onToggleProvider(next === "on")}
          options={[
            { value: "on", label: t("settings.enabled") },
            { value: "off", label: t("settings.disabled") },
          ]}
        />
        <CollapsibleTrigger asChild>
          <button type="button" className="model-provider-chevron" aria-label={providerLabel}>
            <ChevronDown className={open ? "is-open" : ""} />
          </button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent className="model-list">
        {models.map((model) => (
          <div className="model-row" key={model.id}>
            <div className="model-row-text">
              <span className="model-row-label">{humanizeModel(model.id)}</span>
              <small className="model-row-sub">{model.id}</small>
            </div>
            <Switch
              checked={model.enabled}
              disabled={busy}
              aria-label={model.id}
              onCheckedChange={(next) => onToggleModel(model.id, next)}
            />
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
