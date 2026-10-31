// Provider accounts pane, modelled on Orca's AccountsPane: one section per LLM
// provider showing the accounts Omni detected on this machine (the ambient CLI
// logins) with an "add account" button that runs the real OAuth login, plus the
// provider's API-key profiles. Wired to Omni's real backend — GET /api/accounts
// (read-only detection), GET /api/usage (presence) and /api/settings/accounts
// (key profiles). OAuth sign-in runs in an Omni terminal (the real CLI flow),
// not a faked headless flow.

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Plus, RefreshCw, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import type { UsageProvider, UsageSnapshot } from "@/lib/usage-types";
import { AgentIcon } from "@/components/agent-icons";
import { SettingsSection } from "@/components/settings/settings-primitives";
import { useTranslation } from "@/i18n";

type Profiles = { profiles: string[]; active: string | null };
type Draft = { name: string; key: string };
type DetectedAccount = {
  id: string;
  email?: string | null;
  name?: string | null;
  plan?: string | null;
  rateLimitTier?: string | null;
  active?: boolean;
  source: string;
  authMode?: string;
};
type AccountsSnapshot = { accounts: Record<string, DetectedAccount[]>; detectedAt: string };

// Canonical providers, mirroring USAGE_PROVIDERS in src/usage.mjs. `loginCli` is
// the `omni auth login` target when the provider supports OAuth (null when it is
// key-only in Omni).
const PROVIDERS = [
  { id: "claude", label: "Claude", icon: "claude", keyProvider: "anthropic", loginCli: "claude" },
  { id: "openai", label: "OpenAI", icon: "codex", keyProvider: "openai", loginCli: "codex" },
  { id: "gemini", label: "Gemini", icon: "gemini", keyProvider: "google", loginCli: null },
  { id: "antigravity", label: "Antigravity", icon: "antigravity", keyProvider: "antigravity", loginCli: null },
  { id: "openrouter", label: "OpenRouter", icon: "openrouter", keyProvider: "openrouter", loginCli: null },
] as const;

export function ProviderAccounts() {
  const { t } = useTranslation();
  const [usage, setUsage] = useState<UsageSnapshot | null>(null);
  const [detected, setDetected] = useState<AccountsSnapshot | null>(null);
  const [profiles, setProfiles] = useState<Record<string, Profiles>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const [snapshot, accounts, ...rows] = await Promise.allSettled([
        api<UsageSnapshot>("/usage"),
        api<AccountsSnapshot>("/accounts"),
        ...PROVIDERS.map((p) =>
          p.keyProvider === "antigravity" ? Promise.resolve({ profiles: [], active: null } as Profiles) : api<Profiles>(`/settings/accounts?provider=${p.keyProvider}`),
        ),
      ]);
      if (snapshot.status === "fulfilled") setUsage(snapshot.value);
      if (accounts.status === "fulfilled") setDetected(accounts.value);
      setProfiles(
        (previous) => ({ ...previous, ...Object.fromEntries(PROVIDERS.flatMap((p, index) => {
          const row = rows[index];
          return row.status === "fulfilled" ? [[p.keyProvider, row.value]] : [];
        })) }),
      );
      if (accounts.status === "rejected") setError(accounts.reason instanceof Error ? accounts.reason.message : String(accounts.reason));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
    const refreshOnFocus = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnFocus);
    return () => {
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnFocus);
    };
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
      void api<UsageSnapshot>("/usage").then(setUsage).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function addAccount(loginCli: string) {
    setError("");
    setNotice("");
    try {
      await api("/accounts/login", { provider: loginCli });
      setNotice(t("settings.accounts.loginLaunched"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function draftFor(keyProvider: string): Draft {
    return drafts[keyProvider] ?? { name: "default", key: "" };
  }
  function setDraft(keyProvider: string, patch: Partial<Draft>) {
    setDrafts((prev) => ({ ...prev, [keyProvider]: { ...draftFor(keyProvider), ...patch } }));
  }

  function statusBadge(up: UsageProvider | undefined, hasAccount: boolean) {
    const connected = up?.authKinds.includes("oauth") || hasAccount;
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

  function accountLabel(account: DetectedAccount, providerLabel: string): string {
    return account.email || account.name || `${providerLabel}`;
  }
  function accountDetail(account: DetectedAccount): string {
    const bits: string[] = [];
    if (account.plan) bits.push(t("settings.accounts.plan", { plan: account.plan }));
    if (account.rateLimitTier && !account.plan) bits.push(account.rateLimitTier);
    return bits.join(" · ");
  }

  return (
    <>
      {error && (
        <div className="settings-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="settings-notice" role="status">
          {notice}
        </div>
      )}
      {PROVIDERS.map((provider) => {
        const up = usage?.providers.find((p) => p.id === provider.id);
        const accounts = detected?.accounts[provider.id] ?? [];
        const list = profiles[provider.keyProvider];
        const draft = draftFor(provider.keyProvider);
        return (
          <SettingsSection
            key={provider.id}
            title={
              <span className="account-head">
                <AgentIcon agent={provider.icon} size={16} />
                {provider.label}
              </span>
            }
            action={statusBadge(up, accounts.length > 0)}
          >
            {/* Detected accounts (Orca's "Comptes"): read-only, with an OAuth add button. */}
            <div className="account-section">
              <div className="account-section-head">
                <span>{t("settings.accounts.accounts")}</span>
                <span className="account-section-hint">{t("settings.accounts.accountsHint")}</span>
                {provider.loginCli && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="account-add-btn"
                    onClick={() => void addAccount(provider.loginCli!)}
                  >
                    <UserPlus data-icon="inline-start" />
                    {t("settings.accounts.addAccount")}
                  </Button>
                )}
              </div>
              {accounts.length ? (
                accounts.map((account) => (
                  <div className="account-detected-row" key={account.id}>
                    <span className="account-avatar">
                      <AgentIcon agent={provider.icon} size={15} />
                    </span>
                    <div className="account-detected-text">
                      <span className="account-detected-name">
                        {accountLabel(account, provider.label)}
                        {account.source === "system" && (
                          <Badge variant="outline">{t("settings.accounts.thisDevice")}</Badge>
                        )}
                        {account.active !== false && (
                          <Badge variant="secondary">{t("settings.accounts.active")}</Badge>
                        )}
                      </span>
                      {accountDetail(account) && <small>{accountDetail(account)}</small>}
                    </div>
                  </div>
                ))
              ) : (
                <p className="account-empty">{t("settings.accounts.noAccounts")}</p>
              )}
            </div>

            {/* API-key profiles (Omni's keychain-backed keys). */}
            {provider.id !== "antigravity" && <div className="account-keys">
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
            </div>}
          </SettingsSection>
        );
      })}
    </>
  );
}
