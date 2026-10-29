import { GoogleGenAI } from "@google/genai";
import { SecretStore } from "./secret-store.mjs";
import { ApiKeyProfiles } from "./api-key-profiles.mjs";

const serviceName = "Omni Gemini API Key";

export class GeminiApiAuth {
  constructor({ secretStore = new SecretStore({}) } = {}) {
    this.profiles = new ApiKeyProfiles({
      serviceName,
      providerName: "Gemini",
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

export class GeminiApiChat {
  constructor({ apiKey, client, clientFactory, maxOutputTokens = 4096 } = {}) {
    if (!apiKey && !client)
      throw new Error(
        "Connectez Gemini avec `omni auth key set google --stdin` ou configurez GEMINI_API_KEY.",
      );
    if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1)
      throw new TypeError("maxOutputTokens doit être un entier positif.");
    this.apiKey = apiKey;
    this.client =
      client ??
      (
        clientFactory ??
        ((key) =>
          new GoogleGenAI({
            apiKey: key,
            httpOptions: { retryOptions: { attempts: 1 } },
          }))
      )(apiKey);
    this.maxOutputTokens = maxOutputTokens;
  }

  #safeError(error) {
    const message =
      error instanceof Error ? error.message : "Erreur Gemini inconnue.";
    return new Error(
      this.apiKey ? message.replaceAll(this.apiKey, "[REDACTED]") : message,
    );
  }

  async listModels() {
    try {
      const models = [];
      for await (const model of await this.client.models.list()) {
        if (
          typeof model.name === "string" &&
          model.name &&
          model.supportedActions?.includes("generateContent")
        )
          models.push(model.name);
      }
      return [...new Set(models)].sort();
    } catch (error) {
      throw this.#safeError(error);
    }
  }

  async stream({ model, messages, signal, onDelta, onUsage = () => {} }) {
    let text = "";
    let sawChunk = false;
    let finalUsage = null;
    try {
      const stream = await this.client.models.generateContentStream({
        model: model.startsWith("google:")
          ? model.slice("google:".length)
          : model,
        contents: messages
          .filter(({ role }) => role === "user" || role === "assistant")
          .map(({ role, content }) => ({
            role: role === "assistant" ? "model" : "user",
            parts: [{ text: content }],
          })),
        config: {
          maxOutputTokens: this.maxOutputTokens,
          abortSignal: signal,
        },
      });
      for await (const chunk of stream) {
        sawChunk = true;
        if (chunk.usageMetadata) finalUsage = chunk.usageMetadata;
        const blockReason = chunk.promptFeedback?.blockReason;
        if (blockReason)
          throw new Error(`Gemini a bloqué la demande (${blockReason}).`);
        const delta = chunk.text;
        if (typeof delta === "string" && delta) {
          text += delta;
          onDelta(delta);
        }
      }
      if (!sawChunk)
        throw new Error("Le flux Gemini s’est terminé sans réponse.");
      if (finalUsage) {
        const validCount = (value) => Number.isSafeInteger(value) && value >= 0;
        const tokens = {
          ...(validCount(finalUsage.promptTokenCount)
            ? { input: finalUsage.promptTokenCount }
            : {}),
          ...(validCount(finalUsage.candidatesTokenCount)
            ? { output: finalUsage.candidatesTokenCount }
            : {}),
          ...(validCount(finalUsage.thoughtsTokenCount)
            ? { reasoning: finalUsage.thoughtsTokenCount }
            : {}),
          cache: {
            ...(validCount(finalUsage.cachedContentTokenCount)
              ? { read: finalUsage.cachedContentTokenCount }
              : {}),
          },
        };
        if (Object.keys(tokens).some((key) => key !== "cache"))
          onUsage({ providerId: "google", tokens });
      }
      return text;
    } catch (error) {
      throw this.#safeError(error);
    }
  }
}
