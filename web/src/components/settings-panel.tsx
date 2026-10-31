import { useMemo, useState } from "react";
import type { ComponentType } from "react";
import {
  ArrowLeft,
  Blocks,
  Bot,
  Boxes,
  Check,
  Network,
  Plug,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
  UserCog,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import { api, type WorkspaceState } from "@/lib/api";
import { ProviderAccounts } from "@/components/provider-accounts";
import { AgentModels } from "@/components/agent-models";
import { AgentIcon } from "@/components/agent-icons";
import {
  PERMISSION_OPTIONS,
  type PermissionMode,
} from "@/components/permission-mode-picker";
import {
  SettingsRow,
  SettingsSection,
  SettingsSegmentedControl,
  SettingsSubsectionHeader,
} from "@/components/settings/settings-primitives";
import { useTranslation, LOCALES, type Locale } from "@/i18n";
import type { Translate } from "@/i18n";

type SectionId = "general" | "accounts" | "agents" | "mcp" | "integrations" | "plugins";
type NavGroup = "capabilities" | "configuration";
type NavItem = {
  id: SectionId;
  title: keyof NavCatalog;
  icon: ComponentType<{ className?: string }>;
  group: NavGroup;
  badge?: boolean;
};
type NavCatalog = {
  "settings.nav.agents": string;
  "settings.nav.accounts": string;
  "settings.nav.mcp": string;
  "settings.nav.general": string;
  "settings.nav.integrations": string;
  "settings.nav.plugins": string;
};

// Grouped navigation, modelled on Orca's settings: capabilities first, then
// configuration. Accounts carries an "optional" badge, as in Orca. Harness swap
// and available models live inside the Agents pane, as in Orca.
const NAV: NavItem[] = [
  { id: "agents", title: "settings.nav.agents", icon: Bot, group: "capabilities" },
  { id: "accounts", title: "settings.nav.accounts", icon: UserCog, group: "capabilities" },
  { id: "mcp", title: "settings.nav.mcp", icon: Network, group: "capabilities" },
  { id: "general", title: "settings.nav.general", icon: SlidersHorizontal, group: "configuration" },
  { id: "integrations", title: "settings.nav.integrations", icon: Plug, group: "configuration" },
  { id: "plugins", title: "settings.nav.plugins", icon: Boxes, group: "configuration" },
];

const GROUPS: { group: NavGroup; label: keyof GroupCatalog }[] = [
  { group: "capabilities", label: "settings.groupCapabilities" },
  { group: "configuration", label: "settings.groupConfiguration" },
];
type GroupCatalog = { "settings.groupCapabilities": string; "settings.groupConfiguration": string };

export function SettingsPanel({
  state,
  refresh,
  addMcp,
  currentHarness,
  setDefaultHarness,
  permissionMode,
  setDefaultPermission,
  onBack,
}: {
  state: WorkspaceState;
  refresh: () => Promise<unknown>;
  addMcp: () => void;
  currentHarness: string;
  setDefaultHarness: (id: string) => void;
  permissionMode: PermissionMode;
  setDefaultPermission: (mode: PermissionMode) => void;
  onBack?: () => void;
}) {
  const { t, locale, setLocale } = useTranslation();
  const [section, setSection] = useState<SectionId>("general");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [tabAutoGenerateTitle, setTabAutoGenerateTitle] = useState(() =>
    localStorage.getItem("omni.tabAutoGenerateTitle") !== "false",
  );
  const translate = t as Translate;

  const filteredNav = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return NAV;
    return NAV.filter((item) => translate(item.title).toLowerCase().includes(needle));
  }, [query, translate]);

  async function change(path: string, body: unknown) {
    setBusy(true);
    setError("");
    try {
      await api(path, body);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const activeItem = NAV.find((item) => item.id === section) ?? NAV[0];

  return (
    <section className="settings-page">
      <nav className="settings-nav" aria-label={t("settings.nav.aria")}>
        <div className="brand settings-brand">
          <img src="/assets/omni.svg" alt="Omni" />
          <span>
            omni<span className="brand-dot">.</span>
          </span>
          <Badge variant="outline">LOCAL</Badge>
        </div>
        {onBack && (
          <Button variant="ghost" className="settings-back" onClick={onBack}>
            <ArrowLeft className="settings-nav-icon" />
            <span className="settings-nav-title">{t("settings.back")}</span>
          </Button>
        )}
        <div className="settings-search">
          <Search className="settings-search-icon" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("settings.search")}
            aria-label={t("settings.search")}
          />
        </div>
        {GROUPS.map(({ group, label }) => {
          const items = filteredNav.filter((item) => item.group === group);
          if (items.length === 0) return null;
          return (
            <div className="settings-nav-group" key={group}>
              <span>{translate(label)}</span>
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <Button
                    key={item.id}
                    variant={item.id === section ? "secondary" : "ghost"}
                    className="settings-nav-item"
                    onClick={() => setSection(item.id)}
                  >
                    <Icon className="settings-nav-icon" />
                    <span className="settings-nav-title">{translate(item.title)}</span>
                    {item.badge && (
                      <Badge variant="secondary" className="settings-nav-badge">
                        {t("settings.optional")}
                      </Badge>
                    )}
                  </Button>
                );
              })}
            </div>
          );
        })}
        {filteredNav.length === 0 && <p className="settings-nav-empty">{t("settings.noResults")}</p>}
      </nav>
      <div className="settings-content">
        <div className="settings-title">
          <activeItem.icon />
          <div>
            <h1>{translate(activeItem.title)}</h1>
            <p>{t("settings.subtitle")}</p>
          </div>
        </div>
        {error && (
          <div className="settings-error" role="alert">
            {error}
          </div>
        )}

        {section === "general" && (
          <>
            <SettingsSection>
              <SettingsRow
                label={t("settings.language")}
                description={t("settings.languageHint")}
                control={
                  <Select value={locale} onValueChange={(value) => setLocale(value as Locale)}>
                    <SelectTrigger aria-label={t("settings.language")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {LOCALES.map((code) => (
                          <SelectItem key={code} value={code}>
                            {t(`lang.${code}` as "lang.fr")}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                }
              />
            </SettingsSection>
            <SettingsSection
              title="Empêcher la mise en veille"
              description="Maintient l’ordinateur éveillé en permanence ou pendant les exécutions d’agents. Le mode Agent ne s’active que lorsqu’une exécution Omni est en cours."
            >
              <SettingsRow
                label="Mode"
                control={
                  <Select
                    value={state.awake?.mode ?? "off"}
                    onValueChange={(mode) => void change("/settings/awake", { mode })}
                    disabled={busy || !state.awake?.supported}
                  >
                    <SelectTrigger aria-label="Mode de prévention de la veille">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="on">Toujours activé</SelectItem>
                        <SelectItem value="auto">Pendant le travail des agents</SelectItem>
                        <SelectItem value="off">Désactivé</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                }
              />
              <div className="awake-status" role="status">
                <span className={state.awake?.active ? "awake-dot active" : "awake-dot"} />
                {state.awake?.active
                  ? "Prévention de la veille active"
                  : state.awake?.mode === "auto"
                    ? `En attente${state.awake.workingAgents ? ` · ${state.awake.workingAgents} agent(s)` : " d’une exécution"}`
                    : "Prévention de la veille inactive"}
              </div>
              {!state.awake?.supported && (
                <p className="awake-note">La prévention automatique est disponible sur macOS et Linux.</p>
              )}
              {state.awake?.error && <p className="awake-note">{state.awake.error}</p>}
            </SettingsSection>
          </>
        )}

        {section === "accounts" && (
          <>
            <p className="settings-lead">{t("settings.accounts.hint")}</p>
            <ProviderAccounts />
          </>
        )}

        {section === "agents" && (
          <>
            <SettingsSection
              title={t("settings.harness.title")}
              description={t("settings.harness.hint")}
            >
              <HarnessPills
                harnesses={state.harnesses}
                current={currentHarness}
                autoLabel={translate("settings.harness.auto")}
                onSelect={setDefaultHarness}
              />
              <div className="agents-permissions-block">
                <div className="agents-permissions">
                  <strong>{t("settings.agents.permissions")}</strong>
                  <Select
                    value={permissionMode}
                    onValueChange={(value) => setDefaultPermission(value as PermissionMode)}
                  >
                    <SelectTrigger
                      className="agents-permissions-trigger"
                      data-warning={permissionMode === "full-access" ? "true" : undefined}
                      aria-label={t("settings.agents.permissions")}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {PERMISSION_OPTIONS.map((option) => (
                          <SelectItem key={option.id} value={option.id}>
                            <span className="agents-permission-option" data-warning={option.isWarning ? "true" : undefined}>
                              <option.icon className="settings-nav-icon" />
                              {option.label}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
                <p className="settings-field-description">{t("settings.agents.permissionsHint")}</p>
              </div>
            </SettingsSection>

            <SettingsSection
              title={t("settings.agents.namingTitle")}
              description={t("settings.agents.namingHint")}
            >
              <SettingsRow
                label={t("settings.agents.tabAutoGenerateTitle")}
                description={t("settings.agents.tabAutoGenerateTitleHint")}
                control={
                  <Switch
                    checked={tabAutoGenerateTitle}
                    onCheckedChange={(checked) => {
                      setTabAutoGenerateTitle(checked);
                      localStorage.setItem(
                        "omni.tabAutoGenerateTitle",
                        String(checked),
                      );
                    }}
                    aria-label={t("settings.agents.tabAutoGenerateTitle")}
                  />
                }
              />
            </SettingsSection>

            <SettingsSection
              title={
                <span className="agents-installed-title">
                  {t("settings.installed")}
                  <Badge variant="secondary">
                    {t("settings.detected", {
                      count: state.harnesses.filter((h) => h.enabled !== undefined).length + (state.installedAgents?.antigravity ? 1 : 0),
                    })}
                  </Badge>
                </span>
              }
              action={
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void refresh()}>
                  <RefreshCw data-icon="inline-start" />
                  {t("settings.refresh")}
                </Button>
              }
            >
              <div className="agent-rows">
                {state.harnesses.map((h) => (
                  <InstalledAgentRow
                    key={h.id}
                    harness={h}
                    isDefault={h.id === currentHarness}
                    busy={busy}
                    onToggle={(enabled) =>
                      void change("/settings/registry", { type: "harness", id: h.id, enabled })
                    }
                    onSetDefault={() => setDefaultHarness(h.id)}
                    t={translate}
                  />
                ))}
                {state.installedAgents?.antigravity && (
                  <div className="agent-row">
                    <div className="agent-row-main">
                      <span className="agent-row-icon"><AgentIcon agent="antigravity" size={16} /></span>
                      <div className="agent-row-text"><span className="agent-row-name">Antigravity</span><small className="agent-row-desc">CLI Antigravity · catalogue de modèles</small></div>
                      <Badge variant="secondary">Installé</Badge>
                    </div>
                  </div>
                )}
              </div>
            </SettingsSection>

            <SettingsSection>
              <AgentModels onChanged={() => void refresh()} />
            </SettingsSection>
          </>
        )}

        {section === "mcp" && (
          <SettingsSection
            title="Serveurs MCP"
            description="Les outils restent soumis aux permissions du harness."
            action={
              <Button size="sm" onClick={addMcp}>
                <Plus data-icon="inline-start" />
                Ajouter
              </Button>
            }
          >
            {state.mcpServers.length ? (
              state.mcpServers.map((m) => (
                <SettingsRow
                  key={m.name}
                  label={m.name}
                  description={`${m.transport} · ${m.toolCount} outils`}
                  control={
                    <Button
                      variant="ghost"
                      size="icon"
                      title={`Supprimer ${m.name}`}
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(`Supprimer le serveur MCP ${m.name} ?`))
                          void change("/settings/mcp/remove", { name: m.name });
                      }}
                    >
                      <Trash2 />
                    </Button>
                  }
                />
              ))
            ) : (
              <p>Aucun serveur MCP enregistré.</p>
            )}
          </SettingsSection>
        )}

        {section === "integrations" && (
          <>
            <SettingsSection
              title="GitHub"
              description="Omni utilise GitHub CLI et le remote Git du projet. Le panneau Tâches et les pull requests utilisent ce compte."
            >
              <p>
                <code>gh auth status</code> · <code>gh auth login</code>
              </p>
            </SettingsSection>
            <SettingsSection
              title="Autres connexions"
              description="Configurez les serveurs MCP dans la section MCP. Les intégrations natives supplémentaires ne sont pas encore disponibles."
            >
              <Blocks className="settings-empty-icon" />
            </SettingsSection>
          </>
        )}

        {section === "plugins" && (
          <SettingsSection
            title="Plugins"
            description="Omni ne dispose pas encore de registre ou de gestionnaire de plugins. Les serveurs MCP peuvent être ajoutés dans la section MCP."
          >
            <Boxes className="settings-empty-icon" />
          </SettingsSection>
        )}
      </div>
    </section>
  );
}

// Default-harness pills, modelled on Orca's UniversalChatHarnessSetting: an
// "Auto" pill plus one per enabled harness, a check on the active one.
function HarnessPills({
  harnesses,
  current,
  autoLabel,
  onSelect,
}: {
  harnesses: WorkspaceState["harnesses"];
  current: string;
  autoLabel: string;
  onSelect: (id: string) => void;
}) {
  const pills = [{ id: "auto", name: autoLabel }, ...harnesses.filter((h) => h.enabled !== false)];
  return (
    <div className="harness-pills">
      {pills.map((h) => {
        const active = h.id === current;
        return (
          <button
            key={h.id}
            type="button"
            aria-pressed={active}
            className={active ? "harness-pill is-active" : "harness-pill"}
            onClick={() => onSelect(h.id)}
          >
            {h.id !== "auto" && <AgentIcon agent={h.id} size={14} />}
            {h.name}
            {active && <Check className="harness-pill-check" />}
          </button>
        );
      })}
    </div>
  );
}

// One detected-agent row, modelled on Orca's AgentCatalogRow: icon, name, a
// detail sub-line, availability segmented control, a "set default" button, and
// a chevron that expands the agent's details.
function InstalledAgentRow({
  harness,
  isDefault,
  busy,
  onToggle,
  onSetDefault,
  t,
}: {
  harness: WorkspaceState["harnesses"][number];
  isDefault: boolean;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
  onSetDefault: () => void;
  t: Translate;
}) {
  const [open, setOpen] = useState(false);
  const enabled = harness.enabled !== false;
  const registered = harness.enabled !== undefined;
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={registered && !enabled ? "agent-row is-off" : "agent-row"}
    >
      <div className="agent-row-main">
        <span className="agent-row-icon">
          <AgentIcon agent={harness.id} size={16} />
        </span>
        <div className="agent-row-text">
          <span className="agent-row-name">
            {harness.name}
            {registered && !enabled && <Badge variant="secondary">{t("settings.disabled")}</Badge>}
          </span>
          <small className="agent-row-desc">{harness.description}</small>
        </div>
        <div className="agent-row-controls">
          {registered ? (
            <SettingsSegmentedControl
              className="settings-agent-toggle"
              ariaLabel={`${harness.name} — ${t("settings.enabled")} / ${t("settings.disabled")}`}
              value={enabled ? "on" : "off"}
              onChange={(next) => onToggle(next === "on")}
              options={[
                { value: "on", label: t("settings.enabled") },
                { value: "off", label: t("settings.disabled") },
              ]}
            />
          ) : (
            <Badge variant="secondary">{t("settings.unregistered")}</Badge>
          )}
          <Button
            size="sm"
            variant={isDefault ? "secondary" : "ghost"}
            disabled={busy || !enabled || isDefault}
            onClick={onSetDefault}
            className="agent-row-default"
          >
            {isDefault && <Check data-icon="inline-start" />}
            {t("settings.makeDefault")}
          </Button>
          <CollapsibleTrigger asChild>
            <button type="button" className="agent-row-chevron" aria-label={harness.name}>
              <ChevronDown className={open ? "is-open" : ""} />
            </button>
          </CollapsibleTrigger>
        </div>
      </div>
      <CollapsibleContent className="agent-row-detail">
        <p>{harness.description}</p>
        <code>{harness.id}</code>
      </CollapsibleContent>
    </Collapsible>
  );
}
