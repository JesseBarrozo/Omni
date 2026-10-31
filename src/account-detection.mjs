// Detects the LLM accounts already signed in on this machine, so the GUI can
// show them (like Orca's AccountsPane) without Omni holding the credentials.
// Read-only: it parses the official CLIs' own auth material and extracts only
// non-sensitive identity fields (email, plan, expiry). It never logs or returns
// tokens.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { platform } from "node:process";

// Decode a JWT payload without verifying it — we only read identity claims for
// display, never trust it for auth.
function decodeJwtClaims(token) {
  if (typeof token !== "string") return null;
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

// Codex / OpenAI: ~/.codex/auth.json holds an id_token (JWT) with the ChatGPT
// account email and plan, plus an optional API key.
export function detectCodexAccount({ home = homedir() } = {}) {
  let auth;
  try {
    auth = JSON.parse(readFileSync(join(home, ".codex", "auth.json"), "utf8"));
  } catch {
    return null;
  }
  const claims = decodeJwtClaims(auth?.tokens?.id_token);
  const openai = claims?.["https://api.openai.com/auth"] ?? {};
  const email = typeof claims?.email === "string" ? claims.email : null;
  const apiKey = Boolean(auth?.OPENAI_API_KEY);
  if (!email && !apiKey) return null;
  return {
    id: openai.chatgpt_account_id ?? email ?? "codex",
    email,
    name: typeof claims?.name === "string" ? claims.name : null,
    plan: typeof openai.chatgpt_plan_type === "string" ? openai.chatgpt_plan_type : null,
    authMode: auth?.auth_mode ?? (apiKey ? "api-key" : "oauth"),
    apiKey,
  };
}

// Claude: on macOS the Claude Code CLI stores its OAuth material in the login
// keychain ("Claude Code-credentials"); on other platforms in a credentials
// file. The token does not expose the email, so we report the subscription tier
// and connection state (we never call an account API just to show an email).
export function detectClaudeAccount({ home = homedir() } = {}) {
  let credentials = readClaudeCredentialsFile(home) ?? readClaudeKeychain();
  const oauth = credentials?.claudeAiOauth;
  if (!oauth) return null;
  const active =
    typeof oauth.expiresAt === "number" ? oauth.expiresAt > Date.now() : true;
  return {
    id: "claude",
    email: null,
    plan: typeof oauth.subscriptionType === "string" ? oauth.subscriptionType : null,
    rateLimitTier: typeof oauth.rateLimitTier === "string" ? oauth.rateLimitTier : null,
    expiresAt: typeof oauth.expiresAt === "number" ? oauth.expiresAt : null,
    active,
    authMode: "oauth",
  };
}

function readClaudeCredentialsFile(home) {
  try {
    return JSON.parse(readFileSync(join(home, ".claude", ".credentials.json"), "utf8"));
  } catch {
    return null;
  }
}

function readClaudeKeychain() {
  if (platform !== "darwin") return null;
  try {
    const raw = execFileSync(
      "security",
      ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Gemini: the Gemini CLI stores OAuth credentials in ~/.gemini/oauth_creds.json
// when signed in; the id_token, when present, carries the account email.
export function detectGeminiAccount({ home = homedir() } = {}) {
  let creds;
  try {
    creds = JSON.parse(readFileSync(join(home, ".gemini", "oauth_creds.json"), "utf8"));
  } catch {
    return null;
  }
  const claims = decodeJwtClaims(creds?.id_token);
  const email = typeof claims?.email === "string" ? claims.email : null;
  if (!creds?.access_token && !email) return null;
  return { id: email ?? "gemini", email, authMode: "oauth" };
}

// One system account per provider (the ambient CLI login). Providers with no
// detected account are omitted. The result is keyed by the GUI provider id.
export function detectAccounts(options = {}) {
  const accounts = {};
  const claude = detectClaudeAccount(options);
  if (claude) accounts.claude = [{ ...claude, source: "system" }];
  const codex = detectCodexAccount(options);
  if (codex) accounts.openai = [{ ...codex, source: "system" }];
  const gemini = detectGeminiAccount(options);
  if (gemini) accounts.gemini = [{ ...gemini, source: "system" }];
  return accounts;
}

export function collectAccounts(options = {}) {
  return { accounts: detectAccounts(options), detectedAt: new Date().toISOString() };
}
