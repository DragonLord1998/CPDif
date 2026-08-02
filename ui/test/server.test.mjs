import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import { createHttpServer } from "../server.mjs";

function fakeManager() {
  const job = {
    id: "abc-123",
    status: "queued",
    input: {},
    images: null,
  };
  return {
    create: () => job,
    get: (id) => (id === job.id ? job : null),
    list: () => [job],
    cancel: (id) => (id === job.id ? { ...job, status: "cancelled" } : null),
    imagePath: () => null,
    shutdown: () => {},
  };
}

async function withServer(callback, { ready = true, loraStore } = {}) {
  const manager = fakeManager();
  const app = createHttpServer({
    config: { host: "127.0.0.1", port: 0 },
    manager,
    loraStore,
    readiness: async () => ({
      ready,
      checks: { binary: ready, transformer: ready, textEncoder: ready, vae: ready },
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
