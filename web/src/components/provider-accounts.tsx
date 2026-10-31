// Provider accounts pane, modelled on Orca's AccountsPane: one section per LLM
// provider, each showing its OAuth sign-in state and its API-key profiles
// (list, activate, remove, add). It is wired to Omni's real backend — OAuth
// presence from GET /api/usage, key profiles from /api/settings/accounts — not
// to Orca's Electron daemon. OAuth sign-in itself is terminal-driven in Omni,
// so the pane reports the state and the command instead of running the flow.

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import type { UsageProvider, UsageSnapshot } from "@/lib/usage-types";
import { AgentIcon } from "@/components/agent-icons";
import {
  SettingsRow,
  SettingsSection,
} from "@/components/settings/settings-primitives";
import { useTranslation } from "@/i18n";

type Profiles = { profiles: string[]; active: string | null };
type Draft = { name: string; key: string };

// Canonical providers, mirroring USAGE_PROVIDERS in src/usage.mjs. `icon` names
// the agent logo, `keyProvider` the key-profile backend, `oauthCmd` the terminal
// command when the provider supports OAuth (null when it is key-only).
const PROVIDERS = [
  { id: "claude", label: "Claude", icon: "claude", keyProvider: "anthropic", oauthCmd: "omni auth login claude" },
  { id: "openai", label: "OpenAI", icon: "codex", keyProvider: "openai", oauthCmd: "omni auth login codex" },
  { id: "gemini", label: "Gemini", icon: "gemini", keyProvider: "google", oauthCmd: null },
  { id: "openrouter", label: "OpenRouter", icon: "openrouter", keyProvider: "openrouter", oauthCmd: null },
] as const;

export function ProviderAccounts() {
  const { t } = useTranslation();
  const [usage, setUsage] = useState<UsageSnapshot | null>(null);
  const [profiles, setProfiles] = useState<Record<string, Profiles>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const [snapshot, ...rows] = await Promise.all([
        api<UsageSnapshot>("/usage"),
        ...PROVIDERS.map((p) =>
          api<Profiles>(`/settings/accounts?provider=${p.keyProvider}`),
        ),
      ]);
      setUsage(snapshot);
      setProfiles(
        Object.fromEntries(PROVIDERS.map((p, index) => [p.keyProvider, rows[index]])),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(
    keyProvider: string,
    action: "set" | "use" | "remove",
    profile: string,
    key?: string,
  ) {
    setBusy(true);
    setError("");
    try {
      const next = await api<Profiles>("/settings/accounts", {
        provider: keyProvider,
        action,
        profile,
        ...(action === "set" ? { key } : {}),
      });
      setProfiles((prev) => ({ ...prev, [keyProvider]: next }));
      if (action === "set") setDrafts((prev) => ({ ...prev, [keyProvider]: { name: "default", key: "" } }));
      // Credential presence may have changed; refresh the OAuth/key status.
      void api<UsageSnapshot>("/usage").then(setUsage).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function draftFor(keyProvider: string): Draft {
    return drafts[keyProvider] ?? { name: "default", key: "" };
  }
  function setDraft(keyProvider: string, patch: Partial<Draft>) {
    setDrafts((prev) => ({ ...prev, [keyProvider]: { ...draftFor(keyProvider), ...patch } }));
  }

  function statusBadge(up: UsageProvider | undefined) {
    const connected = up?.authKinds.includes("oauth");
    const keyed = up?.authKinds.includes("api-key");
    const label = connected
      ? t("settings.accounts.connected")
      : keyed
        ? t("settings.accounts.keyConfigured")
        : t("settings.accounts.notConfigured");
    return (
      <Badge variant={connected || keyed ? "secondary" : "outline"} className="account-status">
        <span className={connected || keyed ? "account-dot is-on" : "account-dot"} />
        {label}
      </Badge>
    );
  }

  return (
    <>
      {error && (
        <div className="settings-error" role="alert">
          {error}
        </div>
      )}
      {PROVIDERS.map((provider) => {
        const up = usage?.providers.find((p) => p.id === provider.id);
        const list = profiles[provider.keyProvider];
        const draft = draftFor(provider.keyProvider);
        const connected = up?.authKinds.includes("oauth");
        return (
          <SettingsSection
            key={provider.id}
            title={
              <span className="account-head">
                <AgentIcon agent={provider.icon} size={16} />
                {provider.label}
              </span>
            }
            action={statusBadge(up)}
          >
            {provider.oauthCmd && (
              <SettingsRow
                label={t("settings.accounts.oauth")}
                description={
                  connected
                    ? t("settings.accounts.oauthConnected")
                    : t("settings.accounts.oauthHint", { command: provider.oauthCmd })
                }
                control={
                  connected ? (
                    <Badge variant="secondary">{t("settings.accounts.active")}</Badge>
                  ) : (
                    <code className="account-command">{provider.oauthCmd}</code>
                  )
                }
              />
            )}
            <div className="account-keys">
              <div className="account-keys-head">
                <KeyRound className="settings-nav-icon" />
                <span>{t("settings.accounts.keyProfiles")}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="account-keys-refresh"
                  disabled={busy}
                  onClick={() => void load()}
                >
                  <RefreshCw data-icon="inline-start" />
                  {t("settings.refresh")}
                </Button>
              </div>
              {list?.profiles.length ? (
                list.profiles.map((name) => {
                  const active = list.active === name;
                  return (
                    <div className="account-key-row" key={name}>
                      <strong>{name}</strong>
                      <Badge variant={active ? "secondary" : "outline"}>
                        {active ? t("settings.accounts.active") : t("settings.accounts.available")}
                      </Badge>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || active}
                        onClick={() => void act(provider.keyProvider, "use", name)}
                      >
                        {t("settings.accounts.use")}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        title={t("settings.accounts.remove")}
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm(t("settings.accounts.removeConfirm", { profile: name })))
                            void act(provider.keyProvider, "remove", name);
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  );
                })
              ) : (
                <p className="account-empty">{t("settings.accounts.noKeys")}</p>
              )}
              <div className="account-add">
                <Input
                  aria-label={t("settings.accounts.profileName")}
                  value={draft.name}
                  onChange={(e) => setDraft(provider.keyProvider, { name: e.target.value })}
                  placeholder={t("settings.accounts.profileName")}
                />
                <Input
                  aria-label={`${provider.label} — ${t("settings.accounts.apiKey")}`}
                  type="password"
                  autoComplete="off"
                  value={draft.key}
                  onChange={(e) => setDraft(provider.keyProvider, { key: e.target.value })}
                  placeholder={t("settings.accounts.apiKey")}
                />
                <Button
                  size="sm"
                  disabled={busy || !draft.key || !draft.name.trim()}
                  onClick={() => void act(provider.keyProvider, "set", draft.name.trim(), draft.key)}
                >
                  <Plus data-icon="inline-start" />
                  {t("settings.accounts.save")}
                </Button>
              </div>
            </div>
          </SettingsSection>
        );
      })}
    </>
  );
}
