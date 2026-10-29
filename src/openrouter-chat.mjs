import OpenAI from "openai";
import { SecretStore } from "./secret-store.mjs";
import { ApiKeyProfiles } from "./api-key-profiles.mjs";

const serviceName = "Omni OpenRouter API Key";
const baseURL = "https://openrouter.ai/api/v1";

export class OpenRouterAuth {
  constructor({ secretStore = new SecretStore({}) } = {}) {
    this.profiles = new ApiKeyProfiles({
      serviceName,
      providerName: "OpenRouter",
      secretStore,
    });
  }

  getApiKey(profile) {
    return this.profiles.getApiKey(profile);
  }
  hasApiKey(profile) {
    return this.profiles.hasApiKey(profile);
  }
  setApiKey(value, profile) {
    return this.profiles.setApiKey(value, profile);
  }
  listApiKeyProfiles() {
    return this.profiles.listApiKeyProfiles();
  }
  useApiKeyProfile(profile) {
    return this.profiles.useApiKeyProfile(profile);
  }
  deleteApiKey(profile) {
    return this.profiles.deleteApiKey(profile);
  }
}

export class OpenRouterChat {
  constructor({ apiKey, client, clientFactory } = {}) {
    if (!apiKey && !client)
      throw new Error(
        "Connectez OpenRouter avec `omni auth key set openrouter --stdin` ou configurez OPENROUTER_API_KEY.",
      );
    this.apiKey = apiKey;
    this.client =
      client ??
      (
        clientFactory ??
        ((key) =>
          new OpenAI({
            apiKey: key,
            baseURL,
            maxRetries: 0,
            defaultHeaders: {
              "X-OpenRouter-Title": "Omni",
            },
          }))
      )(apiKey);
  }

  #safeError(error) {
    const message =
      error instanceof Error ? error.message : "Erreur OpenRouter inconnue.";
    return new Error(
      this.apiKey ? message.replaceAll(this.apiKey, "[REDACTED]") : message,
    );
  }

  async listModels() {
    try {
      const response = await this.client.models.list();
      return response.data.map(({ id }) => id).sort();
    } catch (error) {
      throw this.#safeError(error);
    }
  }

  async stream({ model, messages, signal, onDelta }) {
    let stream;
    try {
      stream = await this.client.chat.completions.create(
        {
          model: model.startsWith("openrouter:")
            ? model.slice("openrouter:".length)
            : model,
          messages,
          stream: true,
        },
        { signal },
      );
      let text = "";
      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta) {
          text += delta;
          onDelta(delta);
        }
        if (chunk.error)
          throw new Error(
            chunk.error.message ?? "Erreur OpenRouter pendant le flux.",
          );
      }
      return text;
    } catch (error) {
      throw this.#safeError(error);
    } finally {
      stream?.controller?.abort();
    }
  }
}

export { baseURL as OPENROUTER_BASE_URL };
