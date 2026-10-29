export async function runChatTurn({
  store,
  provider,
  conversationId,
  model,
  prompt,
  signal,
  onDelta = () => {},
  onUsage = () => {},
}) {
  if (!prompt.trim()) throw new Error("Le message ne peut pas être vide");
  store.addMessage(conversationId, "user", prompt);
  const assistantId = store.addMessage(
    conversationId,
    "assistant",
    "",
    "streaming",
  );
  store.setStatus(conversationId, "running");
  let answer = "";
  try {
    const history = store
      .conversation(conversationId)
      .messages.filter(
        (message) =>
          (message.status === "completed" ||
            (message.role === "assistant" &&
              message.status === "interrupted")) &&
          message.id !== assistantId,
      )
      .map(({ role, content }) => ({ role, content }));
    answer = await provider.stream({
      model,
      messages: history,
      conversationId,
      signal,
      onDelta: (delta) => {
        answer += delta;
        store.appendMessageDelta(assistantId, delta);
        onDelta(delta);
      },
      onUsage: (usage) => {
        const payload = {
          ...usage,
          conversationId,
          harnessId: null,
          sessionId: null,
        };
        store.appendEvent(conversationId, "usage.updated", payload);
        onUsage(payload);
      },
    });
    store.setMessage(assistantId, answer, "completed");
    store.setStatus(conversationId, "completed");
    return { status: "completed", answer };
  } catch (error) {
    const interrupted = signal?.aborted ?? false;
    store.setMessage(
      assistantId,
      answer,
      interrupted ? "interrupted" : "failed",
    );
    store.setStatus(conversationId, interrupted ? "interrupted" : "failed");
    if (!interrupted) throw error;
    return { status: "interrupted", answer };
  }
}
