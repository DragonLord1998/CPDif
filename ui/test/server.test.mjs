import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import { createHttpServer } from "../server.mjs";

function fakeManager() {
  let created = false;
  const job = {
    id: "abc-123",
    status: "queued",
    input: {},
    images: null,
  };
  return {
    create: () => {
      created = true;
      return job;
    },
    get: (id) => (id === job.id ? job : null),
    list: () => (created ? [job] : []),
    cancel: (id) => (id === job.id ? { ...job, status: "cancelled" } : null),
    imagePath: () => null,
    upscaleSpec: () => null,
    shutdown: () => {},
  };
}

async function withServer(
  callback,
  {
    ready = true,
    imageStore,
    loraStore,
    promptAssistant,
    pidUpscaler,
    manager = fakeManager(),
    pidReady = false,
  } = {},
) {
  const app = createHttpServer({
    config: { host: "127.0.0.1", port: 0 },
    manager,
    imageStore,
    loraStore,
    promptAssistant,
    pidUpscaler,
    readiness: async () => ({
      ready,
      checks: { binary: ready, transformer: ready, textEncoder: ready, vae: ready },
      features: { pidUpscale: { ready: pidReady, checks: {} } },
      profile: "test",
      maxVram: null,
    }),
  });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const address = app.server.address();
  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    app.server.close();
    await once(app.server, "close");
  }
}

test("serves readiness and creates a queued job", async () => {
  await withServer(async (origin) => {
    const status = await fetch(`${origin}/api/status`);
    assert.equal(status.status, 200);
    assert.equal((await status.json()).ready, true);

    const created = await fetch(`${origin}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "cat", editPrompt: "suit" }),
    });
    assert.equal(created.status, 202);
    assert.equal((await created.json()).id, "abc-123");
  });
});

test("rewrites prompts through the optional local assistant with a completed image", async () => {
  const calls = [];
  const manager = fakeManager();
  manager.imagePath = (jobId, stageId) =>
    jobId === "done-job" && stageId === "klein-1" ? "/jobs/klein-1.png" : null;
  const promptAssistant = {
    status: async () => ({ enabled: true, ready: true, model: "qwen", detail: "ready" }),
    rewrite: async (input, options) => {
      calls.push({ input, options });
      return { prompt: "A polished red coat edit", model: "qwen", usedVision: true };
    },
  };

  await withServer(async (origin) => {
    const status = await fetch(`${origin}/api/prompt-assistant/status`);
    assert.equal((await status.json()).ready, true);

    const response = await fetch(`${origin}/api/prompt-assistant/rewrite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "edit",
        prompt: "red coat",
        image: { jobId: "done-job", stageId: "klein-1" },
      }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).usedVision, true);
    assert.deepEqual(calls[0], {
      input: { mode: "edit", prompt: "red coat" },
      options: { imagePaths: ["/jobs/klein-1.png"] },
    });
  }, { manager, promptAssistant });
});

test("uploads image sources and uses them for vision-grounded prompt rewrites", async () => {
  const sourceId = "123e4567-e89b-42d3-a456-426614174000";
  const uploads = [];
  const imageStore = {
    list: () => [],
    upload: async (input) => {
      uploads.push(input);
      for await (const _chunk of input.body) {
        // Drain the request like the production streaming store.
      }
      return {
        id: sourceId,
        filename: "cat.png",
        contentType: "image/png",
        sizeBytes: 24,
        width: 32,
        height: 24,
        url: `/api/images/${sourceId}`,
      };
    },
    path: (id) => (id === sourceId ? "/uploads/cat.png" : null),
    get: () => null,
    remove: async () => false,
  };
  const calls = [];
  const promptAssistant = {
    status: async () => ({ enabled: true, ready: true, model: "qwen", detail: "ready" }),
    rewrite: async (input, options) => {
      calls.push({ input, options });
      return { prompt: "A polished upload edit", model: "qwen", usedVision: true };
    },
  };

  await withServer(async (origin) => {
    const upload = await fetch(`${origin}/api/images`, {
      method: "POST",
      headers: {
        "Content-Type": "image/png",
        "X-CPDif-Filename": encodeURIComponent("cat.png"),
      },
      body: Buffer.alloc(24),
    });
    assert.equal(upload.status, 201);
    assert.equal((await upload.json()).image.id, sourceId);
    assert.equal(uploads[0].contentType, "image/png");

    const rewrite = await fetch(`${origin}/api/prompt-assistant/rewrite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "edit",
        prompt: "make the coat red",
        image: { sourceId },
      }),
    });
    assert.equal(rewrite.status, 200);
    assert.deepEqual(calls[0].options, { imagePaths: ["/uploads/cat.png"] });
  }, { imageStore, promptAssistant });
});

test("passes up to four completed or uploaded images to Qwen in order", async () => {
  const sourceId = "123e4567-e89b-42d3-a456-426614174000";
  const manager = fakeManager();
  manager.imagePath = (jobId, stageId) => `/jobs/${jobId}/${stageId}.png`;
  const imageStore = {
    list: () => [],
    path: (id) => (id === sourceId ? "/uploads/reference.png" : null),
  };
  const calls = [];
  const promptAssistant = {
    status: async () => ({ enabled: true, ready: true, model: "qwen", detail: "ready" }),
    rewrite: async (input, options) => {
      calls.push({ input, options });
      return { prompt: "numbered edit", usedVision: true, referenceCount: 3 };
    },
  };
  await withServer(async (origin) => {
    const response = await fetch(`${origin}/api/prompt-assistant/rewrite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "edit",
        prompt: "Use Image 1, Image 2, and Image 3",
        images: [
          { sourceId },
          { jobId: "job-a", stageId: "klein-1" },
          { jobId: "job-b", stageId: "klein-2" },
        ],
      }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(calls[0].options.imagePaths, [
      "/uploads/reference.png",
      "/jobs/job-a/klein-1.png",
      "/jobs/job-b/klein-2.png",
    ]);
  }, { manager, imageStore, promptAssistant });
});

test("runs and caches NVIDIA PiD 4x for one completed Output-node source", async () => {
  const jobId = "323e4567-e89b-42d3-a456-426614174000";
  const manager = fakeManager();
  const spec = {
    inputPath: "/jobs/klein-1.png",
    outputPath: "/jobs/klein-1-pid4x.png",
    prompt: "a cat",
    seed: 42,
    url: `/api/jobs/${jobId}/images/klein-1/upscaled`,
  };
  manager.upscaleSpec = (requestedJobId, stageId) =>
    requestedJobId === jobId && stageId === "klein-1" ? spec : null;
  const calls = [];
  const pidUpscaler = {
    cached: async () => false,
    upscale: async (value) => calls.push(value),
    shutdown: () => {},
  };
  await withServer(async (origin) => {
    const response = await fetch(
      `${origin}/api/jobs/${jobId}/images/klein-1/upscale`,
      { method: "POST" },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(calls, [spec]);
    assert.deepEqual(await response.json(), {
      image: { url: spec.url, scale: 4, model: "NVIDIA PiD", cached: false },
    });
  }, { manager, pidUpscaler, pidReady: true });
});

test("does not overlap NVIDIA PiD with a new Klein GPU job", async () => {
  const jobId = "323e4567-e89b-42d3-a456-426614174000";
  const manager = fakeManager();
  manager.upscaleSpec = () => ({
    inputPath: "/jobs/klein-1.png",
    outputPath: "/jobs/klein-1-pid4x.png",
    prompt: "a cat",
    seed: 42,
    url: `/api/jobs/${jobId}/images/klein-1/upscaled`,
  });
  let finishUpscale;
  const pidUpscaler = {
    cached: async () => false,
    upscale: async () =>
      new Promise((resolve) => {
        finishUpscale = resolve;
      }),
    shutdown: () => {},
  };
  await withServer(async (origin) => {
    const upscale = fetch(`${origin}/api/jobs/${jobId}/images/klein-1/upscale`, {
      method: "POST",
    });
    while (!finishUpscale) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const job = await fetch(`${origin}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "cat", editPrompt: "suit" }),
    });
    assert.equal(job.status, 409);
    assert.match((await job.json()).error, /NVIDIA PiD/);
    finishUpscale();
    assert.equal((await upscale).status, 200);
  }, { manager, pidUpscaler, pidReady: true });
});

test("does not overlap local prompt assistance with a native GPU workflow", async () => {
  let finishRewrite;
  const promptAssistant = {
    status: async () => ({ enabled: true, ready: true, model: "qwen", detail: "ready" }),
    rewrite: async () =>
      new Promise((resolve) => {
        finishRewrite = () =>
          resolve({ prompt: "A polished prompt", model: "qwen", usedVision: false });
      }),
  };

  await withServer(async (origin) => {
    const rewrite = fetch(`${origin}/api/prompt-assistant/rewrite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "generate", prompt: "cat" }),
    });
    while (!finishRewrite) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const job = await fetch(`${origin}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "cat", editPrompt: "suit" }),
    });
    assert.equal(job.status, 409);
    assert.match((await job.json()).error, /prompt improvement/);

    finishRewrite();
    assert.equal((await rewrite).status, 200);

    const manager = fakeManager();
    manager.create({});
    const blockedAssistant = {
      status: promptAssistant.status,
      rewrite: async () => assert.fail("assistant must not run while CPDif is queued"),
    };
    await withServer(async (nestedOrigin) => {
      const response = await fetch(`${nestedOrigin}/api/prompt-assistant/rewrite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "generate", prompt: "cat" }),
      });
      assert.equal(response.status, 409);
      assert.match((await response.json()).error, /active GPU task/);
    }, { manager, promptAssistant: blockedAssistant });
  }, { promptAssistant });
});

test("blocks job creation until all runtime assets are ready", async () => {
  await withServer(async (origin) => {
    const response = await fetch(`${origin}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(response.status, 503);
  }, { ready: false });
});

test("rejects malformed JSON", async () => {
  await withServer(async (origin) => {
    const response = await fetch(`${origin}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    assert.equal(response.status, 400);
  });
});

test("lists and downloads LoRA assets without claiming inference support", async () => {
  const stored = [];
  const loraStore = {
    list: async () => stored,
    download: async ({ name }) => {
      const lora = {
        name,
        filename: `${name}.safetensors`,
        sizeBytes: 123,
        downloadedAt: "2026-08-02T00:00:00.000Z",
      };
      stored.push(lora);
      return lora;
    },
  };
  await withServer(async (origin) => {
    const initial = await fetch(`${origin}/api/loras`);
    assert.deepEqual(await initial.json(), { loras: [], inferenceSupported: false });

    const response = await fetch(`${origin}/api/loras`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "My Style", url: "https://example.com/lora" }),
    });
    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.lora.filename, "My Style.safetensors");
    assert.equal(payload.inferenceSupported, false);
  }, { loraStore });
});

test("preserves LoRA download error status codes", async () => {
  await withServer(async (origin) => {
    const response = await fetch(`${origin}/api/loras`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "duplicate", url: "https://example.com/lora" }),
    });
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /already exists/);
  }, {
    loraStore: {
      list: async () => [],
      download: async () => {
        throw Object.assign(new Error("LoRA already exists"), { statusCode: 409 });
      },
    },
  });
});
