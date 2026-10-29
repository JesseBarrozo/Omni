import Anthropic from "@anthropic-ai/sdk";
import { SecretStore } from "./secret-store.mjs";

const serviceName = "Omni Anthropic API Key";
const accountName = "default";

export class AnthropicApiAuth {
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

export class AnthropicApiChat {
  constructor({ apiKey, client, clientFactory, maxTokens = 4096 } = {}) {
    if (!apiKey && !client)
      throw new Error(
        "Connectez Anthropic avec `omni auth key set anthropic --stdin` ou configurez ANTHROPIC_API_KEY.",
      );
    if (!Number.isSafeInteger(maxTokens) || maxTokens < 1)
      throw new TypeError("maxTokens doit être un entier positif.");
    this.apiKey = apiKey;
    this.client =
      client ??
      (
        clientFactory ??
        ((key) => new Anthropic({ apiKey: key, maxRetries: 0 }))
      )(apiKey);
    this.maxTokens = maxTokens;
  }

  #safeError(error) {
    const message =
      error instanceof Error ? error.message : "Erreur Anthropic inconnue.";
    return new Error(
      this.apiKey ? message.replaceAll(this.apiKey, "[REDACTED]") : message,
    );
  }

  async listModels() {
    try {
      const models = [];
      for await (const model of this.client.models.list())
        if (typeof model.id === "string" && model.id) models.push(model.id);
      return [...new Set(models)].sort();
    } catch (error) {
      throw this.#safeError(error);
    }
  }

  async stream({ model, messages, signal, onDelta }) {
    let stream;
    let text = "";
    let completed = false;
    try {
      stream = this.client.messages.stream(
        {
          model: model.startsWith("anthropic:")
            ? model.slice("anthropic:".length)
            : model,
          max_tokens: this.maxTokens,
          messages: messages
            .filter(({ role }) => role === "user" || role === "assistant")
            .map(({ role, content }) => ({ role, content })),
        },
        { signal },
      );
      stream.on("text", (delta) => {
        text += delta;
        onDelta(delta);
      });
      const finalMessage = await stream.finalMessage();
      completed = finalMessage.stop_reason !== null;
      if (!completed)
        throw new Error("Le flux Anthropic s’est terminé sans message_stop.");
      return text;
    } catch (error) {
      throw this.#safeError(error);
    } finally {
      if (signal?.aborted) stream?.abort();
    }
  }
}
