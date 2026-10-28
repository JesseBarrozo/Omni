import OpenAI from "openai";

export class OpenAIChat {
  constructor({ apiKey = process.env.OPENAI_API_KEY, client } = {}) {
    if (!client && !apiKey)
      throw new Error(
        "OPENAI_API_KEY est requis. Configurez-le dans votre environnement, jamais dans un fichier Omni.",
      );
    this.client = client ?? new OpenAI({ apiKey, maxRetries: 0 });
  }
  async listModels() {
    const response = await this.client.models.list();
    return response.data.map(({ id }) => id).sort();
  }
  async stream({ model, messages, signal, onDelta }) {
    const stream = await this.client.responses.create(
      {
        model,
        input: messages.map(({ role, content }) => ({ role, content })),
        stream: true,
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
