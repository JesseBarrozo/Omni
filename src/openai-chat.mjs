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
    const response = await this.client.models.list();
    return response.data.map(({ id }) => id).sort();
  }
  async stream({ model, messages, signal, onDelta }) {
    const client = this.oauth
      ? this.clientFactory(await this.oauth.getAccessToken())
      : this.client;
    const stream = await client.responses.create(
      {
        model,
        input: messages.map(({ role, content }) => ({ role, content })),
        stream: true,
        ...(this.oauth ? { store: false } : {}),
      },
      { signal },
    );
    let text = "";
    let completed = false;
    try {
      for await (const event of stream) {
        if (event.type === "response.output_text.delta") {
          text += event.delta;
          onDelta(event.delta);
        }
        if (event.type === "response.completed") completed = true;
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
      return text;
    } finally {
      stream.controller.abort();
    }
  }
}
