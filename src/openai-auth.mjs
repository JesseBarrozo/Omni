import {
  randomBytes,
  randomUUID,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createLocalJWKSet, jwtVerify } from "jose";
import { SecretStore } from "./secret-store.mjs";

const issuerUrl = "https://auth.openai.com";
const apiResource = "https://api.openai.com/v1";
const requiredScopes = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "resource.invoke",
  "chatgpt.tokens.use.direct",
];
const serviceName = "Omni OpenAI ChatGPT OAuth";
const accountName = "default";

function safeKeyringError() {
  return new Error(
    "Le trousseau système est inaccessible; vérifiez qu’il est déverrouillé et réessayez.",
  );
}

export function openSystemBrowser(url) {
  const [executable, args] =
    platform() === "darwin"
      ? ["open", [url]]
      : platform() === "win32"
        ? ["rundll32.exe", ["url.dll,FileProtocolHandler", url]]
        : ["xdg-open", [url]];
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { detached: true, stdio: "ignore" });
    child.once("error", () =>
      reject(new Error("Impossible d’ouvrir le navigateur système.")),
    );
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

function ensureHostId(dataDir) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dataDir, 0o700);
  } catch {}
  const file = join(dataDir, "openai-host-id");
  if (existsSync(file)) {
    const hostId = readFileSync(file, "utf8").trim();
    if (!/^urn:uuid:[0-9a-f-]{36}$/i.test(hostId))
      throw new Error("L’identifiant local Omni/OpenAI est invalide.");
    return hostId;
  }
  const hostId = `urn:uuid:${randomUUID()}`;
  let fd;
  try {
    fd = openSync(file, "wx", 0o600);
    writeFileSync(fd, `${hostId}\n`);
    fsyncSync(fd);
    closeSync(fd);
    return hostId;
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    if (error.code === "EEXIST") return ensureHostId(dataDir);
    throw error;
  }
}

function parseCredential(value) {
  if (value === null) return null;
  let credential;
  try {
    credential = JSON.parse(value);
  } catch {
    throw new Error("Les identifiants OpenAI du trousseau sont illisibles.");
  }
  if (
    !credential ||
    typeof credential.clientId !== "string" ||
    !credential.clientId ||
    typeof credential.accessToken !== "string" ||
    !credential.accessToken ||
    !Array.isArray(credential.scopes) ||
    !credential.scopes.includes("chatgpt.tokens.use.direct") ||
    !Number.isFinite(credential.expiresAt)
  )
    throw new Error("Les identifiants OpenAI du trousseau sont incomplets.");
  return credential;
}

export async function validateOpenAIIdentity({
  idToken,
  clientId,
  nonce,
  discovery,
  fetchImpl = fetch,
}) {
  if (discovery.issuer !== issuerUrl || !discovery.jwks_uri)
    throw new Error("La configuration OIDC OpenAI est invalide.");
  const jwksResponse = await fetchImpl(discovery.jwks_uri, {
    signal: AbortSignal.timeout(15000),
  });
  if (!jwksResponse.ok)
    throw new Error(
      `Impossible de charger les clés OIDC OpenAI (HTTP ${jwksResponse.status}).`,
    );
  const jwks = await jwksResponse.json();
  const { payload } = await jwtVerify(idToken, createLocalJWKSet(jwks), {
    issuer: discovery.issuer,
    audience: clientId,
    requiredClaims: ["sub", "exp", "iat", "nonce"],
    clockTolerance: 5,
  });
  if (
    payload.nonce !== nonce ||
    typeof payload.sub !== "string" ||
    !payload.sub
  )
    throw new Error("La validation de l’identité ou du nonce OpenAI a échoué.");
  return payload;
}

export class OpenAIAuth {
  constructor({
    dataDir,
    entry,
    secretStore = new SecretStore({ entry }),
    fetchImpl = fetch,
    openBrowser = openSystemBrowser,
    now = Date.now,
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = {}) {
    if (!dataDir) throw new TypeError("dataDir est requis pour OpenAIAuth");
    this.dataDir = dataDir;
    this.secretStore = secretStore;
    this.fetch = fetchImpl;
    this.openBrowser = openBrowser;
    this.now = now;
    this.wait = wait;
    this.refreshInProgress = null;
  }

  #readCredential() {
    try {
      const credential = parseCredential(
        this.secretStore.get(serviceName, accountName),
      );
      if (credential && Object.hasOwn(credential, "idToken")) {
        const minimalCredential = { ...credential };
        delete minimalCredential.idToken;
        this.#saveCredential(minimalCredential);
        return minimalCredential;
      }
      return credential;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("Les identifiants OpenAI")
      )
        throw error;
      throw safeKeyringError();
    }
  }

  #saveCredential(credential) {
    try {
      this.secretStore.set(
        serviceName,
        accountName,
        JSON.stringify(credential),
      );
    } catch {
      throw safeKeyringError();
    }
  }

  hasCredentials() {
    return this.#readCredential() !== null;
  }

  async login() {
    const hostId = ensureHostId(this.dataDir);
    const previous = this.#readCredential();
    const discovery = await this.#discovery();
    const state = randomBytes(32).toString("base64url");
    const nonce = randomBytes(32).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    await this.#startCallback({
      discovery,
      state,
      nonce,
      verifier,
      challenge,
      hostId,
      clientId: previous?.clientId,
    });
    const callback = await this.#waitForCallback();
    this.#saveCredential(callback.credential);
    return { connected: true, scopes: callback.credential.scopes };
  }

  async #discovery() {
    let response;
    try {
      response = await this.fetch(
        `${issuerUrl}/.well-known/openid-configuration`,
        {
          signal: AbortSignal.timeout(15000),
        },
      );
    } catch {
      throw new Error("Impossible de joindre la découverte OIDC OpenAI.");
    }
    if (!response.ok)
      throw new Error(
        `Découverte OIDC OpenAI indisponible (HTTP ${response.status}).`,
      );
    const discovery = await response.json();
    const endpoints = [
      discovery.issuer,
      discovery.authorization_endpoint,
      discovery.token_endpoint,
      discovery.jwks_uri,
    ];
    if (
      discovery.issuer !== issuerUrl ||
      endpoints.some((endpoint) => {
        try {
          return new URL(endpoint).origin !== issuerUrl;
        } catch {
          return true;
        }
      })
    )
      throw new Error(
        "Les endpoints OIDC annoncés par OpenAI ne sont pas valides.",
      );
    return discovery;
  }

  async #startCallback({
    discovery,
    state,
    nonce,
    verifier,
    challenge,
    hostId,
    clientId,
  }) {
    const server = createServer();
    const redirectUri = await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () =>
        resolve(`http://127.0.0.1:${server.address().port}/auth/callback`),
      );
    });
    const authorizeUrl = new URL(discovery.authorization_endpoint);
    const params = {
      client_id: clientId ?? "dynamic_agent_client",
      response_type: "code",
      redirect_uri: redirectUri,
      scope: requiredScopes.join(" "),
      resource: apiResource,
      state,
      nonce,
      code_challenge_method: "S256",
      code_challenge: challenge,
      ext_agent_host_id: hostId,
    };
    if (!clientId) params.agent_name_hint = "Omni";
    for (const [key, value] of Object.entries(params))
      authorizeUrl.searchParams.set(key, value);

    const callback = new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => {
          reject(new Error("Connexion OpenAI expirée après 10 minutes."));
        },
        10 * 60 * 1000,
      );
      this.clearCallbackTimeout = () => clearTimeout(timeout);
      server.once("request", (request, response) => {
        clearTimeout(timeout);
        this.clearCallbackTimeout = null;
        const url = new URL(request.url, redirectUri);
        const suppliedState = Buffer.from(url.searchParams.get("state") ?? "");
        const expectedState = Buffer.from(state);
        if (
          url.pathname !== "/auth/callback" ||
          suppliedState.length !== expectedState.length ||
          !timingSafeEqual(suppliedState, expectedState)
        ) {
          response.writeHead(400).end("État OAuth invalide.");
          reject(
            new Error(
              "La réponse de connexion OpenAI ne correspond pas à cette tentative.",
            ),
          );
          return;
        }
        const oauthError = url.searchParams.get("error");
        if (oauthError) {
          response
            .writeHead(200, { "content-type": "text/plain; charset=utf-8" })
            .end(
              "Connexion OpenAI non autorisée. Vous pouvez fermer cet onglet.",
            );
          reject(new Error(`Connexion OpenAI refusée (${oauthError}).`));
          return;
        }
        const code = url.searchParams.get("code");
        const returnedClientId = url.searchParams.get("client_id");
        const effectiveClientId = clientId ?? returnedClientId;
        if (
          !code ||
          !effectiveClientId ||
          (clientId && returnedClientId && returnedClientId !== clientId)
        ) {
          response.writeHead(400).end("Réponse OAuth incomplète.");
          reject(
            new Error("OpenAI n’a pas fourni une inscription OAuth valide."),
          );
          return;
        }
        response
          .writeHead(200, { "content-type": "text/plain; charset=utf-8" })
          .end(
            "Connexion reçue; Omni vérifie les autorisations. Vous pouvez fermer cet onglet.",
          );
        void this.#exchangeAndVerify({
          discovery,
          code,
          clientId: effectiveClientId,
          verifier,
          redirectUri,
          nonce,
        }).then(resolve, reject);
      });
    });
    callback.catch(() => {});
    this.pendingServer = server;
    this.pendingCallback = callback;
    try {
      await this.openBrowser(authorizeUrl.toString());
    } catch (error) {
      this.clearCallbackTimeout?.();
      this.clearCallbackTimeout = null;
      server.close();
      throw error;
    }
    return redirectUri;
  }

  async #waitForCallback() {
    try {
      return await this.pendingCallback;
    } finally {
      this.pendingServer?.close();
      this.pendingServer = null;
      this.pendingCallback = null;
    }
  }

  async #exchangeAndVerify({
    discovery,
    code,
    clientId,
    verifier,
    redirectUri,
    nonce,
  }) {
    const response = await this.fetch(discovery.token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
        resource: apiResource,
      }),
      signal: AbortSignal.timeout(30000),
    });
    const tokens = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(
        `Échange OAuth OpenAI refusé (HTTP ${response.status}, ${tokens.error ?? "erreur inconnue"}).`,
      );
    const scopes = String(tokens.scope ?? "")
      .split(/\s+/)
      .filter(Boolean);
    if (
      typeof tokens.access_token !== "string" ||
      typeof tokens.id_token !== "string" ||
      !scopes.includes("chatgpt.tokens.use.direct")
    )
      throw new Error(
        "OpenAI n’a pas accordé le scope d’utilisation du plan ChatGPT.",
      );
    await validateOpenAIIdentity({
      idToken: tokens.id_token,
      clientId,
      nonce,
      discovery,
      fetchImpl: this.fetch,
    });
    return {
      credential: {
        clientId,
        hostId: ensureHostId(this.dataDir),
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
        expiresAt:
          this.now() + Math.max(0, Number(tokens.expires_in) || 3600) * 1000,
        scopes,
      },
    };
  }

  async getAccessToken() {
    const credential = this.#readCredential();
    if (!credential)
      throw new Error("Connectez OpenAI avec `omni auth login openai`.");
    if (credential.expiresAt > this.now() + 60000)
      return credential.accessToken;
    if (!credential.refreshToken)
      throw new Error(
        "La session OpenAI a expiré; relancez `omni auth login openai`.",
      );
    if (!this.refreshInProgress) {
      this.refreshInProgress = this.#refreshCredential().finally(() => {
        this.refreshInProgress = null;
      });
    }
    const refreshed = await this.refreshInProgress;
    return refreshed.accessToken;
  }

  async #refreshCredential() {
    const release = await this.#acquireRefreshLock();
    try {
      const credential = this.#readCredential();
      if (!credential)
        throw new Error("Connectez OpenAI avec `omni auth login openai`.");
      if (credential.expiresAt > this.now() + 60000) return credential;
      if (!credential.refreshToken)
        throw new Error(
          "La session OpenAI a expiré; relancez `omni auth login openai`.",
        );
      const discovery = await this.#discovery();
      const response = await this.fetch(discovery.token_endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: credential.clientId,
          refresh_token: credential.refreshToken,
          resource: apiResource,
        }),
        signal: AbortSignal.timeout(30000),
      });
      const tokens = await response.json().catch(() => ({}));
      if (!response.ok || typeof tokens.access_token !== "string")
        throw new Error(
          `Renouvellement OAuth OpenAI refusé (HTTP ${response.status}, ${tokens.error ?? "erreur inconnue"}).`,
        );
      const scopes = String(tokens.scope ?? credential.scopes.join(" "))
        .split(/\s+/)
        .filter(Boolean);
      if (!scopes.includes("chatgpt.tokens.use.direct"))
        throw new Error(
          "Le renouvellement OpenAI ne conserve plus le scope d’utilisation du plan ChatGPT.",
        );
      const updated = {
        ...credential,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? credential.refreshToken,
        expiresAt:
          this.now() + Math.max(0, Number(tokens.expires_in) || 3600) * 1000,
        scopes,
      };
      this.#saveCredential(updated);
      return updated;
    } finally {
      release();
    }
  }

  async #acquireRefreshLock() {
    mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    const lockPath = join(this.dataDir, "openai-refresh.lock");
    const owner = `${process.pid}:${randomUUID()}`;
    const deadline = this.now() + 30000;
    while (this.now() < deadline) {
      try {
        const fd = openSync(lockPath, "wx", 0o600);
        writeFileSync(fd, owner);
        closeSync(fd);
        return () => {
          try {
            if (readFileSync(lockPath, "utf8") === owner) unlinkSync(lockPath);
          } catch {}
        };
      } catch (error) {
        if (error.code !== "EEXIST")
          throw new Error(
            "Impossible de verrouiller le renouvellement OpenAI.",
          );
        try {
          const lock = readFileSync(lockPath, "utf8");
          const [pidText] = lock.split(":");
          const pid = Number(pidText);
          const age =
            this.now() - (await import("node:fs")).statSync(lockPath).mtimeMs;
          let alive = false;
          if (Number.isSafeInteger(pid) && pid > 0) {
            try {
              process.kill(pid, 0);
              alive = true;
            } catch (processError) {
              alive = processError.code === "EPERM";
            }
          }
          if (!alive && age > 60000) unlinkSync(lockPath);
        } catch (readError) {
          if (readError.code === "ENOENT") continue;
        }
        await this.wait(100);
      }
    }
    throw new Error(
      "Un autre processus Omni renouvelle déjà la session OpenAI.",
    );
  }
}
