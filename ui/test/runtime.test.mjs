import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  JobManager,
  buildCpdifArgs,
  buildWorkflowCommands,
  jobPaths,
  normalizeJobInput,
  normalizeWorkflowInput,
  resolveRuntimeConfig,
  workflowPaths,
} from "../lib/runtime.mjs";

async function waitFor(predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("condition did not become true before timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("normalizes the small validated UI input surface", () => {
  assert.deepEqual(normalizeJobInput({
    prompt: "  a cat  ",
    editPrompt: "  add a suit  ",
    width: 1024,
    height: 1024,
    seed: 42,
  }), {
    prompt: "a cat",
    editPrompt: "add a suit",
    width: 1024,
    height: 1024,
    seed: 42,
  });
});

test("rejects invalid dimensions and seeds", () => {
  assert.throws(
    () => normalizeJobInput({ prompt: "cat", editPrompt: "suit", width: 640 }),
    /width and height/,
  );
  assert.throws(
    () => normalizeJobInput({ prompt: "cat", editPrompt: "suit", seed: -1 }),
    /seed/,
  );
});

test("infers Generate or Edit from each stage image connection", () => {
  assert.deepEqual(
    normalizeWorkflowInput({
      stages: [
        { id: "klein-1", prompt: "a cat", seed: 10 },
        {
          id: "klein-2",
          inputStageId: "klein-1",
          prompt: "dress it in a suit",
          seed: 11,
        },
        { id: "klein-3", prompt: "a mountain", seed: 12 },
      ],
    }).stages.map(({ id, inputStageId, mode }) => ({ id, inputStageId, mode })),
    [
      { id: "klein-1", inputStageId: null, mode: "generate" },
      { id: "klein-2", inputStageId: "klein-1", mode: "edit" },
      { id: "klein-3", inputStageId: null, mode: "generate" },
    ],
  );
  assert.throws(
    () =>
      normalizeWorkflowInput({
        stages: [
          { id: "klein-1", inputStageId: "future", prompt: "invalid" },
        ],
      }),
    /earlier stage/,
  );
  const uploadId = "123e4567-e89b-42d3-a456-426614174000";
  const uploaded = normalizeWorkflowInput({
    stages: [
      {
        id: "klein-1",
        inputImageId: uploadId,
        prompt: "replace the background",
      },
    ],
  }).stages[0];
  assert.equal(uploaded.mode, "edit");
  assert.equal(uploaded.inputImageId, uploadId);
  assert.throws(
    () =>
      normalizeWorkflowInput({
        stages: [
          {
            id: "klein-1",
            inputStageId: "earlier",
            inputImageId: uploadId,
            prompt: "invalid",
          },
        ],
      }),
    /at most one image input/,
  );
});

test("builds generate-only and fused connected workflow commands", () => {
  const config = {
    transformer: "/models/kv.gguf",
    textEncoder: "/models/qwen.safetensors",
    vae: "/models/vae.safetensors",
    maxVram: "8",
  };
  const generateInput = normalizeWorkflowInput({
    stages: [{ id: "klein-1", prompt: "a cat", seed: 10 }],
  });
  const generateCommands = buildWorkflowCommands(
    config,
    generateInput,
    workflowPaths("/outputs", "generate", generateInput),
  );
  assert.equal(generateCommands.length, 1);
  assert.equal(generateCommands[0].args[0], "generate");
  assert.equal(generateCommands[0].args.includes("--klein-kv-cache"), false);

  const chainInput = normalizeWorkflowInput({
    stages: [
      { id: "klein-1", prompt: "a cat", seed: 10 },
      {
        id: "klein-2",
        inputStageId: "klein-1",
        prompt: "add a suit",
        seed: 11,
      },
      {
        id: "klein-3",
        inputStageId: "klein-2",
        prompt: "make the tie red",
        seed: 12,
      },
    ],
  });
  const chainCommands = buildWorkflowCommands(
    config,
    chainInput,
    workflowPaths("/outputs", "chain", chainInput),
  );
  assert.deepEqual(chainCommands.map(({ stageIds }) => stageIds), [
    ["klein-1", "klein-2"],
    ["klein-3"],
  ]);
  assert.equal(chainCommands[0].args[0], "generate-edit");
  assert.equal(chainCommands[1].args[0], "edit");
  assert.equal(
    chainCommands[1].args[chainCommands[1].args.indexOf("--reference-image") + 1],
    "/outputs/chain/klein-2.png",
  );

  const uploadId = "123e4567-e89b-42d3-a456-426614174000";
  const uploadInput = normalizeWorkflowInput({
    stages: [
      {
        id: "klein-1",
        inputImageId: uploadId,
        prompt: "turn the sky pink",
        seed: 13,
      },
    ],
  });
  const uploadCommand = buildWorkflowCommands(
    config,
    uploadInput,
    workflowPaths("/outputs", "upload", uploadInput),
    new Map([[uploadId, "/uploads/reference.png"]]),
  )[0];
  assert.equal(uploadCommand.args[0], "edit");
  assert.equal(
    uploadCommand.args[uploadCommand.args.indexOf("--reference-image") + 1],
    "/uploads/reference.png",
  );
});

test("builds the exact Klein KV command without a shell", () => {
  const config = {
    transformer: "/models/kv.gguf",
    textEncoder: "/models/qwen.safetensors",
    vae: "/models/vae.safetensors",
    maxVram: "8",
  };
  const input = normalizeJobInput({
    prompt: "cat",
    editPrompt: "add a suit",
    width: 1024,
    height: 1024,
    seed: 42,
  });
  const paths = jobPaths("/outputs", "job-1");
  const args = buildCpdifArgs(config, input, paths);

  assert.equal(args[0], "generate-edit");
  assert.ok(args.includes("--klein-kv-cache"));
  assert.ok(args.includes("--no-offload-to-cpu"));
  assert.deepEqual(args.slice(args.indexOf("--max-vram"), args.indexOf("--max-vram") + 2), [
    "--max-vram",
    "8",
  ]);
  assert.equal(args[args.indexOf("--edit-seed") + 1], "43");
  assert.equal(args[args.indexOf("--edited-output") + 1], "/outputs/job-1/edited.png");
  assert.equal(args.includes("--cache"), false);
});

test("resolves the LoRA asset directory and bounded download limit", () => {
  const config = resolveRuntimeConfig({
    uiRoot: "/repo/ui",
    env: {
      CPDIF_WORKDIR: "/runtime/work",
      CPDIF_UI_MAX_VRAM: "",
      CPDIF_LORA_DIR: "/runtime/loras",
      CPDIF_UI_IMAGE_DIR: "/runtime/images",
      CPDIF_UI_MAX_LORA_BYTES: "2048",
      CPDIF_UI_MAX_IMAGE_BYTES: "4096",
    },
  });
  assert.equal(config.loraDir, "/runtime/loras");
  assert.equal(config.imageDir, "/runtime/images");
  assert.equal(config.maxLoraBytes, 2048);
  assert.equal(config.maxImageBytes, 4096);
});

test("forces a stuck cancelled process down and advances the GPU queue", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "cpdif-ui-test-"));
  const ids = ["first", "second"];
  const killSignals = [];
  let spawnCount = 0;
  const spawnProcess = (_binary, args) => {
    spawnCount += 1;
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = (signal) => {
      killSignals.push(signal);
      if (signal === "SIGKILL") {
        setImmediate(() => child.emit("close", null, signal));
      }
      return true;
    };
    if (spawnCount === 2) {
      const value = (name) => args[args.indexOf(name) + 1];
      setImmediate(async () => {
        await Promise.all([
          writeFile(value("--output"), "png"),
          writeFile(value("--edited-output"), "png"),
          writeFile(value("--telemetry"), JSON.stringify({ klein_kv_cache: true })),
          writeFile(
            value("--edited-telemetry"),
            JSON.stringify({ klein_kv_cache: true }),
          ),
        ]);
        child.emit("close", 0, null);
      });
    }
    return child;
  };
  const manager = new JobManager(
    {
      binary: "/fake/cpdif",
      transformer: "/fake/kv.gguf",
      textEncoder: "/fake/qwen.safetensors",
      vae: "/fake/vae.safetensors",
      maxVram: "",
      outputDir,
    },
    {
      spawnProcess,
      idFactory: () => ids.shift(),
      killGraceMs: 10,
    },
  );
  const input = { prompt: "cat", editPrompt: "add a suit", seed: 42 };

  try {
    const first = manager.create(input);
    const second = manager.create(input);
    await waitFor(() => manager.get(first.id).status === "running");
    manager.cancel(first.id);
    await waitFor(() => manager.get(second.id).status === "completed");

    assert.equal(manager.get(first.id).status, "cancelled");
    assert.deepEqual(killSignals, ["SIGTERM", "SIGKILL"]);
  } finally {
    manager.shutdown();
    await rm(outputDir, { recursive: true, force: true });
  }
});
