import Anthropic from "@anthropic-ai/sdk";
import { SecretStore } from "./secret-store.mjs";
import { ApiKeyProfiles } from "./api-key-profiles.mjs";

const serviceName = "Omni Anthropic API Key";

export class AnthropicApiAuth {
  constructor({ secretStore = new SecretStore({}) } = {}) {
    this.profiles = new ApiKeyProfiles({
      serviceName,
      providerName: "Anthropic",
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

  async stream({ model, messages, signal, onDelta, onUsage = () => {} }) {
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
      const usage = finalMessage.usage;
      const validCount = (value) => Number.isSafeInteger(value) && value >= 0;
      const tokens = {
        ...(validCount(usage?.input_tokens)
          ? { input: usage.input_tokens }
          : {}),
        ...(validCount(usage?.output_tokens)
          ? { output: usage.output_tokens }
          : {}),
        ...(usage?.output_tokens_details?.reasoning_tokens !== undefined
          ? validCount(usage.output_tokens_details.reasoning_tokens)
            ? { reasoning: usage.output_tokens_details.reasoning_tokens }
            : {}
          : {}),
        cache: {
          ...(validCount(usage?.cache_read_input_tokens)
            ? { read: usage.cache_read_input_tokens }
            : {}),
          ...(validCount(usage?.cache_creation_input_tokens)
            ? { write: usage.cache_creation_input_tokens }
            : {}),
        },
      };
      if (Object.keys(tokens).some((key) => key !== "cache"))
        onUsage({ providerId: "anthropic", tokens });
      return text;
    } catch (error) {
      throw this.#safeError(error);
    } finally {
      if (signal?.aborted) stream?.abort();
    }
  }
}
