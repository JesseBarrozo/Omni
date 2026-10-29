import OpenAI from "openai";
import { SecretStore } from "./secret-store.mjs";

const serviceName = "Omni OpenRouter API Key";
const accountName = "default";
const baseURL = "https://openrouter.ai/api/v1";

export class OpenRouterAuth {
  constructor({ secretStore = new SecretStore({}) } = {}) {
    this.secretStore = secretStore;
  }

  getApiKey() {
    return this.secretStore.get(serviceName, accountName);
  }

  hasApiKey() {
    return this.getApiKey() !== null;
  }

  setApiKey(value) {
    if (
      typeof value !== "string" ||
      !value ||
      value.length > 16384 ||
      /[\r\n\0-\x1f\x7f]/.test(value)
    )
      throw new TypeError("La clé API doit être une seule ligne non vide.");
    this.secretStore.set(serviceName, accountName, value);
  }

  deleteApiKey() {
    return this.secretStore.delete(serviceName, accountName);
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
