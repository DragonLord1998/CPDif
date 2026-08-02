import assert from "node:assert/strict";
import test from "node:test";

import {
  FLUX2_PROMPT_SYSTEM,
  PromptAssistant,
  resolvePromptAssistantConfig,
} from "../lib/prompt-assistant.mjs";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("accepts only a loopback Ollama endpoint", () => {
  assert.equal(
    resolvePromptAssistantConfig({
      env: { CPDIF_PROMPT_ASSISTANT_URL: "http://localhost:11434" },
    }).endpoint.href,
    "http://localhost:11434/",
  );
  assert.throws(
    () =>
      resolvePromptAssistantConfig({
        env: { CPDIF_PROMPT_ASSISTANT_URL: "https://example.com" },
      }),
    /loopback HTTP origin/,
  );
  assert.throws(
    () =>
      resolvePromptAssistantConfig({
        env: { CPDIF_PROMPT_ASSISTANT_MODEL: "   " },
      }),
    /model must not be empty/,
  );
});

test("reports whether the configured local model is present", async () => {
  const assistant = new PromptAssistant(
    resolvePromptAssistantConfig({ env: {} }),
    {
      fetchImpl: async () =>
        jsonResponse({
          models: [{ name: "lukey03/qwen3.5-9b-abliterated-vision:latest" }],
        }),
    },
  );
  assert.equal((await assistant.status()).ready, true);
});

test("rewrites with BFL rules and unloads the model after text or vision use", async () => {
  const requests = [];
  const assistant = new PromptAssistant(
    resolvePromptAssistantConfig({ env: {} }),
    {
      fetchImpl: async (_url, options) => {
        requests.push(JSON.parse(options.body));
        return jsonResponse({ message: { content: JSON.stringify({ prompt: "A detailed cat portrait" }) } });
      },
      imageStat: async () => ({ isFile: () => true, size: 3 }),
      readImage: async () => Buffer.from("png"),
    },
  );

  const text = await assistant.rewrite({ mode: "generate", prompt: "cat" });
  const vision = await assistant.rewrite(
    { mode: "edit", prompt: "make coat red" },
    { imagePath: "/jobs/source.png" },
  );

  assert.equal(text.usedVision, false);
  assert.equal(vision.usedVision, true);
  assert.equal(requests[0].keep_alive, 0);
  assert.equal(requests[0].think, false);
  assert.equal(requests[1].messages[1].images[0], Buffer.from("png").toString("base64"));
  assert.match(FLUX2_PROMPT_SYSTEM, /does not use negative prompts/);
  assert.match(FLUX2_PROMPT_SYSTEM, /what must remain unchanged/);
});

test("rejects invalid prompt modes and malformed model output", async () => {
  const assistant = new PromptAssistant(
    resolvePromptAssistantConfig({ env: {} }),
    { fetchImpl: async () => jsonResponse({ message: { content: "not json" } }) },
  );
  await assert.rejects(
    assistant.rewrite({ mode: "other", prompt: "cat" }),
    /generate or edit/,
  );
  await assert.rejects(
    assistant.rewrite({ mode: "generate", prompt: "cat" }),
    /invalid rewrite/,
  );
});
