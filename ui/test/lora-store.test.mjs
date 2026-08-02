import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  LoraStore,
  LoraStoreError,
  normalizeLoraName,
  validateLoraUrl,
} from "../lib/lora-store.mjs";

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

function safetensorsFile(metadata = { format: "pt" }) {
  const header = Buffer.from(JSON.stringify({ __metadata__: metadata }));
  const length = Buffer.alloc(8);
  length.writeBigUInt64LE(BigInt(header.length));
  return Buffer.concat([length, header]);
}

test("normalizes safe LoRA names and rejects path-like names", () => {
  assert.equal(normalizeLoraName("  My Style.safetensors  "), "My Style");
  assert.throws(() => normalizeLoraName("../secret"), LoraStoreError);
  assert.throws(() => normalizeLoraName("bad/name"), /LoRA name/);
});

test("accepts only public HTTPS LoRA URLs", async () => {
  assert.equal(
    (await validateLoraUrl("https://models.example/model.safetensors", {
      lookup: publicLookup,
    })).hostname,
    "models.example",
  );
  await assert.rejects(() => validateLoraUrl("http://models.example/model"), /HTTPS/);
  await assert.rejects(
    () =>
      validateLoraUrl("https://models.example/model", {
        lookup: async () => [{ address: "169.254.169.254", family: 4 }],
      }),
    /public addresses/,
  );
  await assert.rejects(
    () => validateLoraUrl("https://127.0.0.1/model"),
    /public hostname/,
  );
});

test("streams, validates, stores, and lists a LoRA", async () => {
  const loraDir = await mkdtemp(path.join(os.tmpdir(), "cpdif-lora-test-"));
  const data = safetensorsFile();
  const store = new LoraStore(
    { loraDir, maxLoraBytes: 1024, loraDownloadTimeoutMs: 1000 },
    {
      lookup: publicLookup,
      fetchImpl: async () =>
        new Response(data, {
          status: 200,
          headers: { "content-length": String(data.length) },
        }),
    },
  );
  try {
    const downloaded = await store.download({
      name: "Studio Light",
      url: "https://models.example/studio.safetensors",
    });
    assert.equal(downloaded.filename, "Studio Light.safetensors");
    assert.deepEqual(await readFile(path.join(loraDir, downloaded.filename)), data);
    assert.deepEqual((await store.list()).map(({ name }) => name), ["Studio Light"]);
    await assert.rejects(
      () =>
        store.download({
          name: "Studio Light",
          url: "https://models.example/studio.safetensors",
        }),
      (error) => error.statusCode === 409,
    );
  } finally {
    await rm(loraDir, { recursive: true, force: true });
  }
});

test("rejects oversized, invalid, and private-redirect downloads without residue", async () => {
  for (const scenario of [
    {
      name: "oversized",
      maxLoraBytes: 8,
      response: () => new Response(safetensorsFile()),
      statusCode: 413,
    },
    {
      name: "invalid",
      maxLoraBytes: 1024,
      response: () => new Response("not safetensors"),
      statusCode: 422,
    },
    {
      name: "redirect",
      maxLoraBytes: 1024,
      response: () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://localhost/private" },
        }),
      statusCode: 400,
    },
  ]) {
    const loraDir = await mkdtemp(path.join(os.tmpdir(), `cpdif-lora-${scenario.name}-`));
    const store = new LoraStore(
      {
        loraDir,
        maxLoraBytes: scenario.maxLoraBytes,
        loraDownloadTimeoutMs: 1000,
      },
      { lookup: publicLookup, fetchImpl: async () => scenario.response() },
    );
    try {
      await assert.rejects(
        () =>
          store.download({
            name: scenario.name,
            url: "https://models.example/model.safetensors",
          }),
        (error) => error.statusCode === scenario.statusCode,
      );
      assert.deepEqual(await readdir(loraDir), []);
    } finally {
      await rm(loraDir, { recursive: true, force: true });
    }
  }
});
