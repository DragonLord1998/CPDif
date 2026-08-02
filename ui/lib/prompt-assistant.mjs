import { readFile, stat } from "node:fs/promises";

const MAX_PROMPT_LENGTH = 4_000;
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const DEFAULT_ENDPOINT = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "lukey03/qwen3.5-9b-abliterated-vision";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);
const PROMPT_MODES = new Set(["generate", "edit"]);

export const FLUX2_PROMPT_SYSTEM = `You are the local prompt director for CPDif and FLUX.2 Klein.

Rewrite the user's draft into one production-ready FLUX.2 prompt while preserving the user's intent. Follow these rules derived from Black Forest Labs' official FLUX.2 prompting guidance:
- Return only the requested JSON object. Do not include commentary or markdown.
- Describe what should appear, not negative-prompt clauses. FLUX.2 does not use negative prompts.
- Put the most important subject first, followed by action, critical style, essential context, and secondary detail.
- Prefer clear natural language. Aim for 30 to 80 words unless the request genuinely needs more detail.
- Preserve exact quoted text, spelling, names, numbers, and hex colors.
- Add camera, lens, lighting, composition, material, or typography detail only when it supports the user's stated intent.
- Do not add unrelated objects, identities, brands, text, or story elements.
- For Generate mode, describe a complete scene that can stand alone.
- For Edit mode, state precisely what changes and what must remain unchanged. When a reference image is attached, ground the instruction in visible subjects, composition, lighting, and materials without inventing unseen details.
- Do not weaken or reinterpret safety requirements. The rewritten prompt must remain suitable for the configured image model and its license.

The JSON response must contain exactly one string field named "prompt".`;

function parseBoolean(value, fallback) {
  if (value == null || value === "") {
    return fallback;
  }
  return !["0", "false", "no", "off"].includes(String(value).toLowerCase());
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeEndpoint(value) {
  const endpoint = new URL(value || DEFAULT_ENDPOINT);
  if (
    endpoint.protocol !== "http:" ||
    !LOOPBACK_HOSTS.has(endpoint.hostname.toLowerCase()) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    !["", "/"].includes(endpoint.pathname)
  ) {
    throw new TypeError("prompt assistant endpoint must be a loopback HTTP origin");
  }
  endpoint.pathname = "/";
  return endpoint;
}

export function resolvePromptAssistantConfig({ env = process.env } = {}) {
  const model = String(env.CPDIF_PROMPT_ASSISTANT_MODEL || DEFAULT_MODEL).trim();
  if (!model) {
    throw new TypeError("prompt assistant model must not be empty");
  }
  return Object.freeze({
    enabled: parseBoolean(env.CPDIF_PROMPT_ASSISTANT_ENABLED, true),
    endpoint: normalizeEndpoint(env.CPDIF_PROMPT_ASSISTANT_URL),
    model,
    timeoutMs: parsePositiveInteger(env.CPDIF_PROMPT_ASSISTANT_TIMEOUT_MS, 180_000),
  });
}

function modelMatches(models, expected) {
  const candidates = new Set([expected, `${expected}:latest`]);
  return models.some((entry) => candidates.has(entry?.name) || candidates.has(entry?.model));
}

function assistantError(message, statusCode = 502) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function responseJson(response) {
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw assistantError("local prompt assistant returned invalid JSON");
  }
  if (!response.ok) {
    throw assistantError(
      payload?.error || `local prompt assistant failed (${response.status})`,
    );
  }
  return payload;
}

function normalizeRewriteInput(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("prompt rewrite request must be a JSON object");
  }
  const mode = String(input.mode || "").toLowerCase();
  if (!PROMPT_MODES.has(mode)) {
    throw new TypeError("prompt rewrite mode must be generate or edit");
  }
  if (typeof input.prompt !== "string") {
    throw new TypeError("prompt is required");
  }
  const prompt = input.prompt.trim();
  if (!prompt || prompt.length > MAX_PROMPT_LENGTH) {
    throw new TypeError(`prompt must contain 1 to ${MAX_PROMPT_LENGTH} characters`);
  }
  return { mode, prompt };
}

export class PromptAssistant {
  constructor(
    config = resolvePromptAssistantConfig(),
    { fetchImpl = fetch, readImage = readFile, imageStat = stat } = {},
  ) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.readImage = readImage;
    this.imageStat = imageStat;
  }

  async status() {
    const { enabled, endpoint, model, timeoutMs } = this.config;
    if (!enabled) {
      return { enabled: false, ready: false, model, detail: "Disabled" };
    }
    try {
      const response = await this.fetchImpl(new URL("api/tags", endpoint), {
        signal: AbortSignal.timeout(Math.min(timeoutMs, 5_000)),
      });
      const payload = await responseJson(response);
      const ready = modelMatches(payload.models || [], model);
      return {
        enabled: true,
        ready,
        model,
        detail: ready ? "Local vision model ready" : "Model is not downloaded yet",
      };
    } catch (error) {
      return {
        enabled: true,
        ready: false,
        model,
        detail: error.name === "TimeoutError" ? "Ollama status timed out" : "Ollama unavailable",
      };
    }
  }

  async rewrite(input, { imagePath = null } = {}) {
    const { mode, prompt } = normalizeRewriteInput(input);
    const { enabled, endpoint, model, timeoutMs } = this.config;
    if (!enabled) {
      throw assistantError("local prompt assistant is disabled", 503);
    }

    let imageBase64 = null;
    if (imagePath) {
      const metadata = await this.imageStat(imagePath);
      if (!metadata.isFile() || metadata.size > MAX_IMAGE_BYTES) {
        throw new TypeError("reference image is missing or too large for prompt assistance");
      }
      imageBase64 = (await this.readImage(imagePath)).toString("base64");
    }

    const request = {
      model,
      stream: false,
      think: false,
      keep_alive: 0,
      format: {
        type: "object",
        properties: { prompt: { type: "string" } },
        required: ["prompt"],
        additionalProperties: false,
      },
      options: {
        temperature: 0.15,
        num_predict: 512,
      },
      messages: [
        { role: "system", content: FLUX2_PROMPT_SYSTEM },
        {
          role: "user",
          content: [
            `Mode: ${mode === "edit" ? "Edit" : "Generate"}`,
            imageBase64
              ? "A reference image is attached. Use vision to ground the rewrite."
              : mode === "edit"
                ? "No reference pixels are available yet. Improve the edit instruction without inventing image details."
                : "Improve this text-to-image prompt.",
            `User draft: ${prompt}`,
          ].join("\n"),
          ...(imageBase64 ? { images: [imageBase64] } : {}),
        },
      ],
    };

    const response = await this.fetchImpl(new URL("api/chat", endpoint), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const payload = await responseJson(response);
    let result;
    try {
      result = JSON.parse(payload?.message?.content || "");
    } catch {
      throw assistantError("local prompt assistant returned an invalid rewrite");
    }
    const rewritten = typeof result?.prompt === "string" ? result.prompt.trim() : "";
    if (!rewritten || rewritten.length > MAX_PROMPT_LENGTH) {
      throw assistantError("local prompt assistant returned an empty or oversized prompt");
    }
    return {
      prompt: rewritten,
      model,
      usedVision: Boolean(imageBase64),
    };
  }
}
