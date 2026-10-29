import { GoogleGenAI } from "@google/genai";
import { SecretStore } from "./secret-store.mjs";

const serviceName = "Omni Gemini API Key";
const accountName = "default";

export class GeminiApiAuth {
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
