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

async function withServer(callback, { ready = true } = {}) {
  const manager = fakeManager();
  const app = createHttpServer({
    config: { host: "127.0.0.1", port: 0 },
    manager,
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
