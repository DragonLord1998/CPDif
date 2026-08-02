import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import { PidUpscaler } from "../lib/pid-upscaler.mjs";

test("launches the pinned PiD wrapper without a shell and verifies its output", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cpdif-pid-test-"));
  const outputPath = path.join(directory, "klein-1-pid4x.png");
  const calls = [];
  const spawnProcess = (binary, args, options) => {
    calls.push({ binary, args, options });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    setImmediate(async () => {
      await writeFile(outputPath, "png");
      child.emit("close", 0, null);
    });
    return child;
  };
  const upscaler = new PidUpscaler(
    {
      pidPython: "python3",
      pidScript: "/repo/scripts/pid/upscale_4x.py",
      pidRoot: "/runtime/PiD",
    },
    { spawnProcess },
  );
  const spec = {
    inputPath: "/jobs/klein-1.png",
    outputPath,
    prompt: "a cat in a studio",
    seed: 22,
  };
  try {
    await upscaler.upscale(spec);
    assert.equal(await upscaler.cached(spec), true);
    assert.equal(calls[0].binary, "python3");
    assert.equal(calls[0].options.shell, false);
    assert.deepEqual(calls[0].args, [
      "/repo/scripts/pid/upscale_4x.py",
      "--pid-root",
      "/runtime/PiD",
      "--input",
      "/jobs/klein-1.png",
      "--output",
      outputPath,
      "--prompt",
      "a cat in a studio",
      "--seed",
      "22",
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
