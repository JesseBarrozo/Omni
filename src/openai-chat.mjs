import OpenAI from "openai";

export class OpenAIChat {
  constructor({
    apiKey = process.env.OPENAI_API_KEY,
    client,
    oauth,
    fetchImpl = fetch,
    clientFactory = (apiKey) => new OpenAI({ apiKey, maxRetries: 0 }),
  } = {}) {
    if (!client && !apiKey && !oauth)
      throw new Error(
        "Connectez OpenAI avec `omni auth login openai` ou configurez OPENAI_API_KEY.",
      );
    this.apiKey = apiKey;
    this.client = client ?? (apiKey ? clientFactory(apiKey) : null);
    this.oauth = oauth;
    this.fetch = fetchImpl;
    this.clientFactory = clientFactory;
  }
  async listModels() {
    if (this.oauth) {
      const token = await this.oauth.getAccessToken();
      const response = await this.fetch("https://api.openai.com/v1/models", {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30000),
      });
      const catalog = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          `Catalogue OpenAI indisponible (HTTP ${response.status}, ${catalog.error?.code ?? "erreur inconnue"}).`,
        );
      if (!Array.isArray(catalog.models))
        throw new Error("OpenAI a renvoyé un catalogue de modèles invalide.");
      return catalog.models
        .filter((model) => model.visibility === "list" && model.slug)
        .map(({ slug }) => slug);
    }
    try {
      const response = await this.client.models.list();
      return response.data.map(({ id }) => id).sort();
    } catch (error) {
      throw this.#safeApiError(error);
    }
  }
  #safeApiError(error) {
    const message =
      error instanceof Error ? error.message : "Erreur OpenAI inconnue.";
    const apiKey = this.apiKey;
    return new Error(
      apiKey ? message.replaceAll(apiKey, "[REDACTED]") : message,
    );
  }
  async stream({ model, messages, signal, onDelta, onUsage = () => {} }) {
    const client = this.oauth
      ? this.clientFactory(await this.oauth.getAccessToken())
      : this.client;
    let stream;
    try {
      stream = await client.responses.create(
        {
          model,
          input: messages.map(({ role, content }) => ({ role, content })),
          stream: true,
          ...(this.oauth ? { store: false } : {}),
        },
        { signal },
      );
    } catch (error) {
      throw this.#safeApiError(error);
    }
    let text = "";
    let completed = false;
    let completedUsage = null;
    try {
      for await (const event of stream) {
        if (event.type === "response.output_text.delta") {
          text += event.delta;
          onDelta(event.delta);
        }
        if (event.type === "response.completed") {
          completed = true;
          const usage = event.response?.usage;
          const validCount = (count) =>
            Number.isSafeInteger(count) && count >= 0;
          const tokens = {
            ...(validCount(usage?.input_tokens)
              ? { input: usage.input_tokens }
              : {}),
            ...(validCount(usage?.output_tokens)
              ? { output: usage.output_tokens }
              : {}),
            ...(validCount(usage?.output_tokens_details?.reasoning_tokens)
              ? { reasoning: usage.output_tokens_details.reasoning_tokens }
              : {}),
            cache: {
              ...(validCount(usage?.input_tokens_details?.cached_tokens)
                ? { read: usage.input_tokens_details.cached_tokens }
                : {}),
              ...(validCount(usage?.input_tokens_details?.cache_write_tokens)
                ? { write: usage.input_tokens_details.cache_write_tokens }
                : {}),
            },
          };
          if (Object.keys(tokens).some((key) => key !== "cache"))
            completedUsage = { providerId: "openai", tokens };
        }
        if (event.type === "error" || event.type === "response.failed") {
          const detail = event.message ?? event.response?.error?.message;
          throw new Error(
            detail ?? "Le fournisseur a échoué pendant le flux Responses",
          );
        }
        if (event.type === "response.incomplete") {
          throw new Error("Le fournisseur a terminé une réponse incomplète");
        }
      }
      if (!completed)
        throw new Error(
          "Le flux Responses s’est terminé sans réponse complète",
        );
      if (completedUsage) onUsage(completedUsage);
      return text;
    } catch (error) {
      throw this.#safeApiError(error);
    } finally {
      stream.controller.abort();
    }
  }
}
