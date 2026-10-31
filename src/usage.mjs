// Account usage for the status bar. Phase A reports, per provider Omni can
// authenticate, whether credentials are present and a coarse status. It never
// invents usage windows: real per-provider fetchers (percentages, resets) are
// ported from Orca's rate-limits code in phase B, and fill `windows`.

import { OAuthProfiles } from "./oauth-profiles.mjs";
import { ApiKeyProfiles } from "./api-key-profiles.mjs";

// Canonical providers shown in the usage footer. `apiKey` names the key-profile
// provider (see keyProviders in workspace-server.mjs); `oauth` names the OAuth
// provider when the account signs in instead of using a key.
export const USAGE_PROVIDERS = [
  { id: "claude", label: "Claude", authKinds: ["oauth", "api-key"], apiKey: "anthropic", oauth: "claude" },
  { id: "openai", label: "OpenAI", authKinds: ["oauth", "api-key"], apiKey: "openai", oauth: "codex" },
  { id: "gemini", label: "Gemini", authKinds: ["api-key"], apiKey: "google", oauth: null },
  { id: "openrouter", label: "OpenRouter", authKinds: ["api-key"], apiKey: "openrouter", oauth: null },
];

const KEY_SERVICES = {
  openai: ["Omni OpenAI API Key", "OpenAI"],
  openrouter: ["Omni OpenRouter API Key", "OpenRouter"],
  anthropic: ["Omni Anthropic API Key", "Anthropic"],
  google: ["Omni Gemini API Key", "Google"],
};

// Builds the snapshot from a presence map { providerId: { apiKey, oauth } }.
// Pure, so it is tested without a keychain. `oauth` is listed before `api-key`
// because a signed-in account takes precedence over a stored key.
export function buildUsageSnapshot(presence, now = new Date()) {
  const providers = USAGE_PROVIDERS.map((provider) => {
    const found = presence[provider.id] ?? { apiKey: false, oauth: false };
    const authKinds = [];
    if (found.oauth) authKinds.push("oauth");
    if (found.apiKey) authKinds.push("api-key");
    const configured = authKinds.length > 0;
    return {
      id: provider.id,
      label: provider.label,
      configured,
      authKinds,
      status: configured ? "unavailable" : "not-configured",
      windows: [],
    };
  });
  return { providers, updatedAt: now.toISOString() };
}

// Reads real credential presence from the keychain and the OAuth profile store.
// A keychain read can throw (locked, unavailable); treat that as absent.
export function detectPresence({ dataDir }) {
  const oauth = new OAuthProfiles({ dataDir });
  const presence = {};
  for (const provider of USAGE_PROVIDERS) {
    let apiKey = false;
    let hasOauth = false;
    try {
      if (provider.apiKey && KEY_SERVICES[provider.apiKey]) {
        const [serviceName, providerName] = KEY_SERVICES[provider.apiKey];
        apiKey = new ApiKeyProfiles({ serviceName, providerName }).hasApiKey();
      }
    } catch {
      apiKey = false;
    }
    try {
      // "default" reuses the ambient CLI config and is not proof of a signed-in
      // session, so phase A counts only OAuth profiles Omni itself stores.
      // Real sign-in detection (reading the CLI auth files) lands in phase B.
      if (provider.oauth)
        hasOauth = oauth.list(provider.oauth).profiles.some((profile) => profile !== "default");
    } catch {
      hasOauth = false;
    }
    presence[provider.id] = { apiKey, oauth: hasOauth };
  }
  return presence;
}

export function collectUsageSnapshot({ dataDir }, now = new Date()) {
  return buildUsageSnapshot(detectPresence({ dataDir }), now);
}
