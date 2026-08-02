import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import { ImageStore } from "../lib/image-store.mjs";

function png(width = 32, height = 24) {
  const bytes = Buffer.alloc(32);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

test("streams validated reference images without trusting the filename", async () => {
  const imageDir = await mkdtemp(path.join(os.tmpdir(), "cpdif-image-test-"));
  const data = png();
  const store = new ImageStore({ imageDir, maxImageBytes: 1024 });
  try {
    const image = await store.upload({
      body: Readable.from([data.subarray(0, 12), data.subarray(12)]),
      contentType: "image/png",
      filename: encodeURIComponent("../Reference Cat.png"),
      declaredSize: data.length,
    });
    assert.equal(image.filename, "Reference Cat.png");
    assert.equal(image.width, 32);
    assert.equal(image.height, 24);
    assert.deepEqual(await readFile(store.path(image.id)), data);
    assert.equal(store.list()[0].url, `/api/images/${image.id}`);
    assert.equal(await store.remove(image.id), true);
    assert.deepEqual(await readdir(imageDir), []);
  } finally {
    await rm(imageDir, { recursive: true, force: true });
  }
});

test("rejects invalid, oversized, and unsupported reference images without residue", async () => {
  for (const scenario of [
    { contentType: "image/gif", data: Buffer.from("GIF89a"), max: 1024, status: 415 },
    { contentType: "image/png", data: Buffer.from("not png"), max: 1024, status: 422 },
    { contentType: "image/png", data: png(), max: 8, status: 413 },
    { contentType: "image/png", data: png(20_000, 20), max: 1024, status: 422 },
  ]) {
    const imageDir = await mkdtemp(path.join(os.tmpdir(), "cpdif-image-reject-"));
    const store = new ImageStore({ imageDir, maxImageBytes: scenario.max });
    try {
      await assert.rejects(
        () =>
          store.upload({
            body: Readable.from([scenario.data]),
            contentType: scenario.contentType,
            filename: "source",
          }),
        (error) => error.statusCode === scenario.status,
      );
      assert.deepEqual(await readdir(imageDir).catch(() => []), []);
    } finally {
      await rm(imageDir, { recursive: true, force: true });
    }
  }
});
