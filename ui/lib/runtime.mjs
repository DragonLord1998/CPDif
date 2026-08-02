import { randomUUID } from "node:crypto";
import { constants, existsSync } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const IMAGE_SIZES = new Set([512, 768, 1024]);
const MAX_PROMPT_LENGTH = 4_000;
const MAX_LOG_LENGTH = 1_000_000;
const DEFAULT_KILL_GRACE_MS = 5_000;

function firstExisting(paths) {
  return paths.find((candidate) => existsSync(candidate)) ?? paths[0];
}

function detectA100() {
  const result = spawnSync(
    "nvidia-smi",
    ["--query-gpu=name", "--format=csv,noheader"],
    { encoding: "utf8", timeout: 2_000 },
  );
  return result.status === 0 && result.stdout.includes("A100");
}

export function resolveRuntimeConfig({ env = process.env, uiRoot } = {}) {
  if (!uiRoot) {
    throw new Error("uiRoot is required");
  }

  const workDir = path.resolve(env.CPDIF_WORKDIR ?? "/content/cpdif-work");
  const modelDir = path.join(workDir, "models");
  const binary = path.resolve(
    env.CPDIF_BIN ??
      firstExisting([
        path.join(workDir, "build-sm120", "bin", "cpdif"),
        path.join(workDir, "build-a100", "bin", "cpdif"),
        path.join(workDir, "build-sm80", "bin", "cpdif"),
        path.resolve(uiRoot, "..", "build", "cpdif"),
      ]),
  );
  const maxVram = Object.hasOwn(env, "CPDIF_UI_MAX_VRAM")
    ? env.CPDIF_UI_MAX_VRAM.trim()
    : detectA100()
      ? "8"
      : "";
  const maxLoraBytes = Number.parseInt(
    env.CPDIF_UI_MAX_LORA_BYTES ?? String(4 * 1024 * 1024 * 1024),
    10,
  );

  return Object.freeze({
    host: env.CPDIF_UI_HOST ?? "127.0.0.1",
    port: Number.parseInt(env.CPDIF_UI_PORT ?? "4173", 10),
    workDir,
    binary,
    transformer: path.resolve(
      env.CPDIF_TRANSFORMER ??
        path.join(modelDir, "flux-2-klein-9b-kv-Q8_0.gguf"),
    ),
    textEncoder: path.resolve(
      env.CPDIF_TEXT_ENCODER ?? path.join(modelDir, "qwen_3_8b.safetensors"),
    ),
    vae: path.resolve(env.CPDIF_VAE ?? path.join(modelDir, "flux2-vae.safetensors")),
    outputDir: path.resolve(
      env.CPDIF_UI_DATA_DIR ?? path.join(uiRoot, "data", "jobs"),
    ),
    loraDir: path.resolve(env.CPDIF_LORA_DIR ?? path.join(workDir, "loras")),
    maxLoraBytes:
      Number.isSafeInteger(maxLoraBytes) && maxLoraBytes > 0
        ? maxLoraBytes
        : 4 * 1024 * 1024 * 1024,
    loraDownloadTimeoutMs: 30 * 60 * 1000,
    maxVram,
  });
}

async function isAccessible(filePath, mode) {
  try {
    await access(filePath, mode);
    return true;
  } catch {
    return false;
  }
}

export async function runtimeReadiness(config) {
  const checks = {
    binary: await isAccessible(config.binary, constants.R_OK | constants.X_OK),
    transformer: await isAccessible(config.transformer, constants.R_OK),
    textEncoder: await isAccessible(config.textEncoder, constants.R_OK),
    vae: await isAccessible(config.vae, constants.R_OK),
  };
  return {
    ready: Object.values(checks).every(Boolean),
    checks,
    profile: "FLUX.2 Klein 9B-KV Q8 / CUDA / 4 steps",
    maxVram: config.maxVram || null,
  };
}

function readPrompt(payload, key, label) {
  if (typeof payload[key] !== "string") {
    throw new TypeError(`${label} is required`);
  }
  const value = payload[key].trim();
  if (!value) {
    throw new TypeError(`${label} is required`);
  }
  if (value.length > MAX_PROMPT_LENGTH) {
    throw new TypeError(`${label} must be at most ${MAX_PROMPT_LENGTH} characters`);
  }
  return value;
}

export function normalizeJobInput(payload) {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("request body must be a JSON object");
  }
  const width = Number(payload.width ?? 1024);
  const height = Number(payload.height ?? 1024);
  const seed = Number(payload.seed ?? 42);
  if (!IMAGE_SIZES.has(width) || !IMAGE_SIZES.has(height)) {
    throw new TypeError("width and height must be 512, 768, or 1024");
  }
  if (!Number.isSafeInteger(seed) || seed < 0 || seed >= 2_147_483_647) {
    throw new TypeError("seed must be an integer between 0 and 2147483646");
  }

  return Object.freeze({
    prompt: readPrompt(payload, "prompt", "prompt"),
    editPrompt: readPrompt(payload, "editPrompt", "edit prompt"),
    width,
    height,
    seed,
  });
}

export function jobPaths(outputDir, jobId) {
  const directory = path.join(outputDir, jobId);
  return Object.freeze({
    directory,
    sourceImage: path.join(directory, "source.png"),
    sourceTelemetry: path.join(directory, "source.json"),
    editedImage: path.join(directory, "edited.png"),
    editedTelemetry: path.join(directory, "edited.json"),
    log: path.join(directory, "cpdif.log"),
  });
}

export function buildCpdifArgs(config, input, paths) {
  const args = [
    "generate-edit",
    "--transformer",
    config.transformer,
    "--text-encoder",
    config.textEncoder,
    "--vae",
    config.vae,
    "--klein-kv-cache",
    "--steps",
    "4",
    "--width",
    String(input.width),
    "--height",
    String(input.height),
    "--cfg-scale",
    "1.0",
    "--rng",
    "cpu",
    "--qwen-image-layers",
    "3",
    "--no-offload-to-cpu",
  ];
  if (config.maxVram) {
    args.push("--max-vram", config.maxVram);
  }
  args.push(
    "--prompt",
    input.prompt,
    "--edit-prompt",
    input.editPrompt,
    "--seed",
    String(input.seed),
    "--edit-seed",
    String(input.seed + 1),
    "--output",
    paths.sourceImage,
    "--telemetry",
    paths.sourceTelemetry,
    "--edited-output",
    paths.editedImage,
    "--edited-telemetry",
    paths.editedTelemetry,
  );
  return args;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    input: job.input,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    error: job.error,
    log: job.log,
    telemetry: job.telemetry,
    images:
      job.status === "completed"
        ? {
            source: `/api/jobs/${job.id}/images/source`,
            edited: `/api/jobs/${job.id}/images/edited`,
          }
        : null,
  };
}

export class JobManager {
  constructor(
    config,
    {
      spawnProcess = spawn,
      idFactory = randomUUID,
      now = () => new Date(),
      killGraceMs = DEFAULT_KILL_GRACE_MS,
    } = {},
  ) {
    this.config = config;
    this.spawnProcess = spawnProcess;
    this.idFactory = idFactory;
    this.now = now;
    this.killGraceMs = killGraceMs;
    this.jobs = new Map();
    this.queue = [];
    this.draining = false;
  }

  create(payload) {
    const input = normalizeJobInput(payload);
    const id = this.idFactory();
    const job = {
      id,
      input,
      paths: jobPaths(this.config.outputDir, id),
      status: "queued",
      createdAt: this.now().toISOString(),
      startedAt: null,
      completedAt: null,
      error: null,
      log: "",
      telemetry: null,
      child: null,
      killTimer: null,
      cancelRequested: false,
    };
    this.jobs.set(id, job);
    this.queue.push(job);
    void this.#drain();
    return publicJob(job);
  }

  get(id) {
    const job = this.jobs.get(id);
    return job ? publicJob(job) : null;
  }

  list() {
    return [...this.jobs.values()].slice(-20).reverse().map(publicJob);
  }

  imagePath(id, kind) {
    const job = this.jobs.get(id);
    if (!job || job.status !== "completed") {
      return null;
    }
    return kind === "source" ? job.paths.sourceImage : job.paths.editedImage;
  }

  cancel(id) {
    const job = this.jobs.get(id);
    if (!job || ["completed", "failed", "cancelled"].includes(job.status)) {
      return job ? publicJob(job) : null;
    }
    job.cancelRequested = true;
    if (job.status === "queued") {
      job.status = "cancelled";
      job.completedAt = this.now().toISOString();
    } else {
      job.status = "cancelling";
      const child = job.child;
      child?.kill("SIGTERM");
      if (child && !job.killTimer) {
        job.killTimer = setTimeout(() => {
          if (job.child === child && job.status === "cancelling") {
            child.kill("SIGKILL");
          }
        }, this.killGraceMs);
        job.killTimer.unref?.();
      }
    }
    return publicJob(job);
  }

  shutdown() {
    for (const job of this.jobs.values()) {
      if (["queued", "running", "cancelling"].includes(job.status)) {
        this.cancel(job.id);
      }
    }
  }

  async #drain() {
    if (this.draining) {
      return;
    }
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const job = this.queue.shift();
        if (job.status === "cancelled") {
          continue;
        }
        try {
          await this.#run(job);
        } catch (error) {
          job.status = job.cancelRequested ? "cancelled" : "failed";
          job.error = job.cancelRequested ? null : String(error.message ?? error);
          job.completedAt = this.now().toISOString();
        }
      }
    } finally {
      this.draining = false;
    }
  }

  async #run(job) {
    await mkdir(job.paths.directory, { recursive: true });
    job.status = "running";
    job.startedAt = this.now().toISOString();
    const args = buildCpdifArgs(this.config, job.input, job.paths);
    const child = this.spawnProcess(this.config.binary, args, {
      cwd: job.paths.directory,
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    job.child = child;
    const appendLog = (chunk) => {
      job.log = (job.log + chunk.toString()).slice(-MAX_LOG_LENGTH);
    };
    child.stdout?.on("data", appendLog);
    child.stderr?.on("data", appendLog);

    let result;
    try {
      result = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => resolve({ code, signal }));
      });
    } finally {
      if (job.killTimer) {
        clearTimeout(job.killTimer);
        job.killTimer = null;
      }
      job.child = null;
    }
    await writeFile(job.paths.log, job.log, "utf8");
    if (job.cancelRequested) {
      job.status = "cancelled";
      job.completedAt = this.now().toISOString();
      return;
    }
    if (result.code !== 0) {
      throw new Error(
        `cpdif exited with ${result.code ?? `signal ${result.signal ?? "unknown"}`}`,
      );
    }
    const [source, edited] = await Promise.all([
      readJson(job.paths.sourceTelemetry),
      readJson(job.paths.editedTelemetry),
    ]);
    if (source.klein_kv_cache !== true || edited.klein_kv_cache !== true) {
      throw new Error("telemetry did not confirm the Klein KV-cache path");
    }
    job.telemetry = { source, edited };
    job.status = "completed";
    job.completedAt = this.now().toISOString();
  }
}
