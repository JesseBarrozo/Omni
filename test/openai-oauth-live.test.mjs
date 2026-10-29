import test from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { OpenAIAuth } from "../src/openai-auth.mjs";
import { OpenAIChat } from "../src/openai-chat.mjs";

test(
  "real OpenAI ChatGPT OAuth lists models and streams a completed Responses API answer",
  { skip: process.env.OMNI_LIVE_OPENAI_OAUTH_TESTS !== "1", timeout: 90000 },
  async () => {
    const auth = new OpenAIAuth({
      dataDir: process.env.OMNI_DATA_DIR ?? join(homedir(), ".omni"),
    });
    assert.equal(
      auth.hasCredentials(),
      true,
      "Connect OpenAI with `omni auth login openai` first",
    );
    const chat = new OpenAIChat({ oauth: auth });
    const models = await chat.listModels();
    assert.ok(
      models.length > 0,
      "OpenAI OAuth model catalog must not be empty",
    );
    const model = process.env.OMNI_OPENAI_OAUTH_TEST_MODEL ?? models[0];
    assert.ok(
      models.includes(model),
      "Live model must come from the account catalog",
    );
    const deltas = [];
    const answer = await chat.stream({
      model,
      messages: [
        { role: "user", content: "Réponds uniquement par : OAuth OK" },
      ],
      onDelta: (delta) => deltas.push(delta),
    });
    assert.ok(deltas.length > 0, "Responses API must stream text deltas");
    assert.ok(answer.trim().length > 0, "Responses API must return model text");
  },
);
