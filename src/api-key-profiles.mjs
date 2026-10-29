import { SecretStore } from "./secret-store.mjs";

const profilePattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export class ApiKeyProfiles {
  constructor({
    serviceName,
    providerName,
    secretStore = new SecretStore({}),
  }) {
    if (typeof serviceName !== "string" || !serviceName.trim())
      throw new TypeError("serviceName doit être une chaîne non vide");
    if (typeof providerName !== "string" || !providerName.trim())
      throw new TypeError("providerName doit être une chaîne non vide");
    this.serviceName = serviceName;
    this.providerName = providerName;
    this.registryServiceName = `${serviceName} Profiles`;
    this.secretStore = secretStore;
  }

  #validateProfile(profile) {
    if (typeof profile !== "string" || !profilePattern.test(profile))
      throw new TypeError(`Nom de profil ${this.providerName} invalide.`);
  }

  #readProfiles() {
    const raw = this.secretStore.get(this.registryServiceName, "registry");
    if (raw === null) {
      const hasLegacyDefault =
        this.secretStore.get(this.serviceName, "default") !== null;
      return {
        profiles: hasLegacyDefault ? ["default"] : [],
        active: hasLegacyDefault ? "default" : null,
      };
    }
    let registry;
    try {
      registry = JSON.parse(raw);
    } catch {
      throw new Error(
        `Le registre des profils ${this.providerName} est illisible.`,
      );
    }
    if (
      registry?.version !== 1 ||
      !Array.isArray(registry.profiles) ||
      registry.profiles.some(
        (profile) =>
          typeof profile !== "string" || !profilePattern.test(profile),
      ) ||
      new Set(registry.profiles).size !== registry.profiles.length ||
      (registry.active !== null &&
        (typeof registry.active !== "string" ||
          !registry.profiles.includes(registry.active)))
    )
      throw new Error(
        `Le registre des profils ${this.providerName} est invalide.`,
      );
    return { profiles: registry.profiles, active: registry.active };
  }

  #saveProfiles(registry) {
    this.secretStore.set(
      this.registryServiceName,
      "registry",
      JSON.stringify({ version: 1, ...registry }),
    );
  }

  listApiKeyProfiles() {
    return this.#readProfiles();
  }

  getApiKey(profile = undefined) {
    const selected = profile ?? this.#readProfiles().active;
    if (selected === null) return null;
    this.#validateProfile(selected);
    return this.secretStore.get(this.serviceName, selected);
  }

  hasApiKey(profile = undefined) {
    return this.getApiKey(profile) !== null;
  }

  setApiKey(apiKey, profile = "default") {
    if (
      typeof apiKey !== "string" ||
      apiKey.length === 0 ||
      apiKey.length > 16384 ||
      /[\r\n\0-\x1f\x7f]/.test(apiKey)
    )
      throw new TypeError("La clé API doit être une seule ligne non vide.");
    this.#validateProfile(profile);
    const registry = this.#readProfiles();
    const previous = this.secretStore.get(this.serviceName, profile);
    try {
      this.secretStore.set(this.serviceName, profile, apiKey);
      if (!registry.profiles.includes(profile)) registry.profiles.push(profile);
      if (registry.active === null) registry.active = profile;
      this.#saveProfiles(registry);
    } catch {
      try {
        if (previous === null)
          this.secretStore.delete(this.serviceName, profile);
        else this.secretStore.set(this.serviceName, profile, previous);
      } catch {}
      throw new Error(
        `Impossible d’enregistrer le profil ${this.providerName}.`,
      );
    }
  }

  useApiKeyProfile(profile) {
    this.#validateProfile(profile);
    const registry = this.#readProfiles();
    if (!registry.profiles.includes(profile) || !this.getApiKey(profile))
      throw new Error(
        `Ce profil de clé API ${this.providerName} n’existe pas.`,
      );
    registry.active = profile;
    this.#saveProfiles(registry);
    return profile;
  }

  deleteApiKey(profile = undefined) {
    const registry = this.#readProfiles();
    const selected = profile ?? registry.active;
    if (selected === null) return false;
    this.#validateProfile(selected);
    const previous = this.secretStore.get(this.serviceName, selected);
    try {
      const deleted = this.secretStore.delete(this.serviceName, selected);
      registry.profiles = registry.profiles.filter((name) => name !== selected);
      if (registry.active === selected)
        registry.active = registry.profiles.includes("default")
          ? "default"
          : (registry.profiles[0] ?? null);
      this.#saveProfiles(registry);
      return deleted;
    } catch {
      if (previous !== null)
        try {
          this.secretStore.set(this.serviceName, selected, previous);
        } catch {}
      throw new Error(
        `Impossible de supprimer le profil ${this.providerName}.`,
      );
    }
  }
}
