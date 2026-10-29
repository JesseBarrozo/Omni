import { platform } from "node:os";
import { Entry } from "@napi-rs/keyring";

const identityPattern = /^[A-Za-z0-9][A-Za-z0-9 .:_/-]{0,127}$/;

function defaultEntry(service, account) {
  const options =
    platform() === "linux" ? { linux: { store: "secret-service" } } : undefined;
  return new Entry(service, account, options);
}

function validateIdentity(service, account) {
  if (
    typeof service !== "string" ||
    !identityPattern.test(service) ||
    typeof account !== "string" ||
    !identityPattern.test(account)
  )
    throw new TypeError("Identifiant de trousseau Omni invalide");
}

function unavailable() {
  return new Error(
    "Le trousseau système est inaccessible; vérifiez qu’il est déverrouillé et réessayez.",
  );
}

export class SecretStore {
  constructor({ entryFactory = defaultEntry, entry } = {}) {
    if (typeof entryFactory !== "function")
      throw new TypeError("entryFactory doit être une fonction");
    this.entryFactory = entry ? () => entry : entryFactory;
  }

  #entry(service, account) {
    return this.entryFactory(service, account);
  }

  get(service, account) {
    validateIdentity(service, account);
    try {
      return this.#entry(service, account).getPassword();
    } catch {
      throw unavailable();
    }
  }

  set(service, account, secret) {
    validateIdentity(service, account);
    if (typeof secret !== "string" || secret.length === 0)
      throw new TypeError("Le secret doit être une chaîne non vide");
    try {
      this.#entry(service, account).setPassword(secret);
    } catch {
      throw unavailable();
    }
  }

  delete(service, account) {
    validateIdentity(service, account);
    try {
      return this.#entry(service, account).deletePassword();
    } catch {
      throw unavailable();
    }
  }
}
