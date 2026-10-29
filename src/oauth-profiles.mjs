import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PROFILE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const PROVIDERS = new Set(["codex", "claude"]);

export class OAuthProfiles {
  constructor({ dataDir }) {
    if (typeof dataDir !== "string" || !dataDir)
      throw new TypeError("dataDir requis");
    this.dataDir = dataDir;
    this.file = join(dataDir, "oauth-profiles.json");
  }

  #validate(provider, profile) {
    if (!PROVIDERS.has(provider))
      throw new TypeError("Fournisseur OAuth invalide.");
    if (typeof profile !== "string" || !PROFILE_PATTERN.test(profile))
      throw new TypeError("Nom de profil OAuth invalide.");
  }

  #read() {
    try {
      const value = JSON.parse(readFileSync(this.file, "utf8"));
      if (
        value?.version !== 1 ||
        typeof value.active !== "object" ||
        typeof value.profiles !== "object"
      )
        throw 0;
      for (const [provider, profile] of Object.entries(value.active))
        this.#validate(provider, profile);
      for (const [provider, profiles] of Object.entries(value.profiles)) {
        if (!PROVIDERS.has(provider) || !Array.isArray(profiles)) throw 0;
        for (const profile of profiles) this.#validate(provider, profile);
      }
      return value;
    } catch (error) {
      if (error?.code === "ENOENT") return { active: {}, profiles: {} };
      throw new Error("Registre des profils OAuth Omni illisible ou invalide.");
    }
  }

  #write(registry) {
    mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    chmodSync(this.dataDir, 0o700);
    writeFileSync(this.file, JSON.stringify({ version: 1, ...registry }), {
      mode: 0o600,
    });
    chmodSync(this.file, 0o600);
  }

  active(provider) {
    this.#validate(provider, "default");
    return this.#read().active[provider] ?? "default";
  }

  use(provider, profile) {
    this.#validate(provider, profile);
    const registry = this.#read();
    registry.active[provider] = profile;
    registry.profiles[provider] ??= ["default"];
    if (!registry.profiles[provider].includes(profile))
      registry.profiles[provider].push(profile);
    this.#write(registry);
    return profile;
  }

  environment(provider, profile = this.active(provider)) {
    this.#validate(provider, profile);
    if (profile === "default") return process.env;
    const directory = join(this.dataDir, "oauth", provider, profile);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    for (const privateDirectory of [
      join(this.dataDir, "oauth"),
      join(this.dataDir, "oauth", provider),
      directory,
    ])
      chmodSync(privateDirectory, 0o700);
    return {
      ...process.env,
      ...(provider === "codex"
        ? { CODEX_HOME: directory }
        : { CLAUDE_CONFIG_DIR: directory }),
    };
  }

  list(provider) {
    this.#validate(provider, "default");
    return {
      profiles: this.#read().profiles[provider] ?? ["default"],
      active: this.active(provider),
    };
  }
}
