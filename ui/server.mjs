import http from "node:http";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  JobManager,
  resolveRuntimeConfig,
  runtimeReadiness,
} from "./lib/runtime.mjs";
import { ImageStore } from "./lib/image-store.mjs";
import { LoraStore } from "./lib/lora-store.mjs";
import {
  PromptAssistant,
  resolvePromptAssistantConfig,
} from "./lib/prompt-assistant.mjs";
import { PidUpscaler } from "./lib/pid-upscaler.mjs";

const UI_ROOT = path.dirname(fileURLToPath(import.meta.url));
const MAX_BODY_BYTES = 64 * 1024;

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

function sendError(response, status, message) {
  sendJson(response, status, { error: message });
}

async function readJsonBody(request) {
  if (!request.headers["content-type"]?.startsWith("application/json")) {
    throw new TypeError("Content-Type must be application/json");
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > MAX_BODY_BYTES) {
      throw new TypeError("request body is too large");
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new TypeError("request body must contain valid JSON");
  }
}

async function sendStatic(response, publicDir, pathname) {
  const files = new Map([
    ["/", ["index.html", "text/html; charset=utf-8"]],
    ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
    ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ]);
  const entry = files.get(pathname);
  if (!entry) {
    return false;
  }
  const body = await readFile(path.join(publicDir, entry[0]));
  response.writeHead(200, {
    "Content-Type": entry[1],
    "Content-Length": body.length,
    "Cache-Control": pathname === "/" ? "no-store" : "public, max-age=300",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy":
      "default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'; connect-src 'self'",
  });
  response.end(body);
  return true;
}

export function createHttpServer({
  config,
  manager,
  readiness = runtimeReadiness,
  imageStore,
  loraStore,
  promptAssistant,
  pidUpscaler,
  publicDir = path.join(UI_ROOT, "public"),
} = {}) {
  const runtimeConfig = config ?? resolveRuntimeConfig({ uiRoot: UI_ROOT });
  const images =
    imageStore ??
    new ImageStore({
      imageDir:
        runtimeConfig.imageDir ?? path.join(UI_ROOT, "data", "images"),
      maxImageBytes: runtimeConfig.maxImageBytes,
    });
  const jobs =
    manager ??
    new JobManager(runtimeConfig, {
      resolveImageSource: (id) => images.path(id),
    });
  const loras =
    loraStore ??
    new LoraStore({
      loraDir:
        runtimeConfig.loraDir ??
        path.join(runtimeConfig.workDir ?? path.join(UI_ROOT, "data"), "loras"),
      maxLoraBytes: runtimeConfig.maxLoraBytes,
      loraDownloadTimeoutMs: runtimeConfig.loraDownloadTimeoutMs,
    });
  const assistant =
    promptAssistant ?? new PromptAssistant(resolvePromptAssistantConfig());
  const upscaler = pidUpscaler ?? new PidUpscaler(runtimeConfig);
  const activeJobStatuses = new Set(["queued", "running", "cancelling"]);
  let assistantBusy = false;
  let pidBusy = false;
  let nativeStartReservations = 0;

  const nativeWorkflowActive = () =>
    pidBusy ||
    nativeStartReservations > 0 ||
    jobs.list().some((job) => activeJobStatuses.has(job.status));

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      const { pathname } = url;

      if (request.method === "GET" && pathname === "/api/status") {
        sendJson(response, 200, await readiness(runtimeConfig));
        return;
      }
      if (request.method === "GET" && pathname === "/api/jobs") {
        sendJson(response, 200, { jobs: jobs.list() });
        return;
      }
      if (request.method === "GET" && pathname === "/api/images") {
        sendJson(response, 200, { images: images.list() });
        return;
      }
      if (request.method === "POST" && pathname === "/api/images") {
        sendJson(response, 201, {
          image: await images.upload({
            body: request,
            contentType: request.headers["content-type"],
            filename: request.headers["x-cpdif-filename"],
            declaredSize: request.headers["content-length"],
          }),
        });
        return;
      }
      if (request.method === "GET" && pathname === "/api/loras") {
        sendJson(response, 200, {
          loras: await loras.list(),
          inferenceSupported: false,
        });
        return;
      }
      if (request.method === "GET" && pathname === "/api/prompt-assistant/status") {
        sendJson(response, 200, await assistant.status());
        return;
      }
      if (request.method === "POST" && pathname === "/api/prompt-assistant/rewrite") {
        if (assistantBusy || nativeWorkflowActive()) {
          sendError(response, 409, "wait for the active GPU task before improving a prompt");
          return;
        }
        assistantBusy = true;
        try {
          const body = await readJsonBody(request);
          if (body.image != null && body.images != null) {
            throw new TypeError("use image or images, not both");
          }
          const references = body.images ?? (body.image != null ? [body.image] : []);
          if (!Array.isArray(references) || references.length > 4) {
            throw new TypeError("prompt rewrite accepts at most four image references");
          }
          const imagePaths = references.map((reference, index) => {
            if (
              typeof reference !== "object" ||
              reference === null ||
              Array.isArray(reference)
            ) {
              throw new TypeError(`prompt rewrite image ${index + 1} is invalid`);
            }
            const uploaded = typeof reference.sourceId === "string";
            const completed =
              typeof reference.jobId === "string" &&
              typeof reference.stageId === "string";
            if (uploaded === completed) {
              throw new TypeError(
                `prompt rewrite image ${index + 1} must identify one upload or completed job stage`,
              );
            }
            const imagePath = uploaded
              ? images.path(reference.sourceId)
              : jobs.imagePath(reference.jobId, reference.stageId);
            if (!imagePath) {
              throw new TypeError(`prompt rewrite image ${index + 1} is not available`);
            }
            return imagePath;
          });
          sendJson(
            response,
            200,
            await assistant.rewrite(
              { mode: body.mode, prompt: body.prompt },
              { imagePaths },
            ),
          );
        } finally {
          assistantBusy = false;
        }
        return;
      }
      if (request.method === "POST" && pathname === "/api/loras") {
        sendJson(response, 201, {
          lora: await loras.download(await readJsonBody(request)),
          inferenceSupported: false,
        });
        return;
      }
      if (request.method === "POST" && pathname === "/api/jobs") {
        if (assistantBusy) {
          sendError(response, 409, "wait for prompt improvement to finish before starting CPDif");
          return;
        }
        if (pidBusy) {
          sendError(response, 409, "wait for NVIDIA PiD upscaling to finish before starting CPDif");
          return;
        }
        nativeStartReservations += 1;
        try {
          const status = await readiness(runtimeConfig);
          if (!status.ready) {
            sendJson(response, 503, {
              error: "CPDif binary or model assets are not ready",
              status,
            });
            return;
          }
          const job = jobs.create(await readJsonBody(request));
          sendJson(response, 202, job);
        } finally {
          nativeStartReservations -= 1;
        }
        return;
      }

      const jobMatch = pathname.match(/^\/api\/jobs\/([a-f0-9-]+)$/i);
      if (jobMatch && request.method === "GET") {
        const job = jobs.get(jobMatch[1]);
        if (!job) {
          sendError(response, 404, "job not found");
          return;
        }
        sendJson(response, 200, job);
        return;
      }

      const cancelMatch = pathname.match(/^\/api\/jobs\/([a-f0-9-]+)\/cancel$/i);
      if (cancelMatch && request.method === "POST") {
        const job = jobs.cancel(cancelMatch[1]);
        if (!job) {
          sendError(response, 404, "job not found");
          return;
        }
        sendJson(response, 200, job);
        return;
      }

      const upscaleMatch = pathname.match(
        /^\/api\/jobs\/([a-f0-9-]+)\/images\/([a-z][a-z0-9-]{0,31})\/upscale$/,
      );
      if (upscaleMatch && request.method === "POST") {
        const spec = jobs.upscaleSpec?.(upscaleMatch[1], upscaleMatch[2]);
        if (!spec) {
          sendError(response, 404, "completed Klein output not found");
          return;
        }
        if (await upscaler.cached(spec)) {
          sendJson(response, 200, {
            image: { url: spec.url, scale: 4, model: "NVIDIA PiD", cached: true },
          });
          return;
        }
        if (assistantBusy || nativeWorkflowActive()) {
          sendError(response, 409, "wait for the active GPU task before using NVIDIA PiD");
          return;
        }
        pidBusy = true;
        try {
          const status = await readiness(runtimeConfig);
          if (status.features?.pidUpscale?.ready !== true) {
            sendJson(response, 503, {
              error: "NVIDIA PiD source or FLUX.2 checkpoints are not ready",
              status: status.features?.pidUpscale ?? null,
            });
            return;
          }
          await upscaler.upscale(spec);
          sendJson(response, 200, {
            image: { url: spec.url, scale: 4, model: "NVIDIA PiD", cached: false },
          });
        } finally {
          pidBusy = false;
        }
        return;
      }

      const upscaledImageMatch = pathname.match(
        /^\/api\/jobs\/([a-f0-9-]+)\/images\/([a-z][a-z0-9-]{0,31})\/upscaled$/,
      );
      if (upscaledImageMatch && request.method === "GET") {
        const spec = jobs.upscaleSpec?.(upscaledImageMatch[1], upscaledImageMatch[2]);
        if (!spec || !(await upscaler.cached(spec))) {
          sendError(response, 404, "upscaled image not found");
          return;
        }
        response.writeHead(200, {
          "Content-Type": "image/png",
          "Cache-Control": "private, max-age=31536000, immutable",
          "X-Content-Type-Options": "nosniff",
        });
        createReadStream(spec.outputPath)
          .on("error", () => response.destroy())
          .pipe(response);
        return;
      }

      const imageMatch = pathname.match(
        /^\/api\/jobs\/([a-f0-9-]+)\/images\/([a-z][a-z0-9-]{0,31})$/,
      );
      if (imageMatch && request.method === "GET") {
        const imagePath = jobs.imagePath(imageMatch[1], imageMatch[2]);
        if (!imagePath) {
          sendError(response, 404, "image not found");
          return;
        }
        response.writeHead(200, {
          "Content-Type": "image/png",
          "Cache-Control": "private, max-age=31536000, immutable",
          "X-Content-Type-Options": "nosniff",
        });
        createReadStream(imagePath)
          .on("error", () => {
            if (!response.headersSent) {
              sendError(response, 404, "image not found");
            } else {
              response.destroy();
            }
          })
          .pipe(response);
        return;
      }

      const uploadedImageMatch = pathname.match(
        /^\/api\/images\/([a-f0-9-]+)$/i,
      );
      if (uploadedImageMatch && request.method === "GET") {
        const image = images.get(uploadedImageMatch[1]);
        if (!image) {
          sendError(response, 404, "uploaded image not found");
          return;
        }
        response.writeHead(200, {
          "Content-Type": image.contentType,
          "Content-Length": image.sizeBytes,
          "Cache-Control": "private, max-age=31536000, immutable",
          "X-Content-Type-Options": "nosniff",
        });
        createReadStream(image.path)
          .on("error", () => response.destroy())
          .pipe(response);
        return;
      }
      if (uploadedImageMatch && request.method === "DELETE") {
        if (assistantBusy || nativeWorkflowActive()) {
          sendError(response, 409, "wait for the active GPU task before removing an image");
          return;
        }
        if (!(await images.remove(uploadedImageMatch[1]))) {
          sendError(response, 404, "uploaded image not found");
          return;
        }
        sendJson(response, 200, { removed: true });
        return;
      }

      if (request.method === "GET" && (await sendStatic(response, publicDir, pathname))) {
        return;
      }
      sendError(response, 404, "not found");
    } catch (error) {
      const status =
        Number.isInteger(error.statusCode) &&
        error.statusCode >= 400 &&
        error.statusCode <= 599
          ? error.statusCode
          : error instanceof TypeError
            ? 400
            : 500;
      sendError(response, status, error.message ?? "internal server error");
    }
  });

  server.on("close", () => {
    jobs.shutdown?.();
    upscaler.shutdown?.();
  });
  return {
    server,
    config: runtimeConfig,
    manager: jobs,
    imageStore: images,
    loraStore: loras,
    promptAssistant: assistant,
    pidUpscaler: upscaler,
  };
}

export async function startServer(options = {}) {
  const app = createHttpServer(options);
  await new Promise((resolve, reject) => {
    app.server.once("error", reject);
    app.server.listen(app.config.port, app.config.host, resolve);
  });
  const status = await runtimeReadiness(app.config);
  console.log(`CPDif UI listening on http://${app.config.host}:${app.config.port}`);
  console.log(
    status.ready
      ? `Runtime ready: ${status.profile}`
      : `Runtime not ready: ${Object.entries(status.checks)
          .filter(([, ready]) => !ready)
          .map(([name]) => name)
          .join(", ")}`,
  );
  return app;
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  const app = await startServer();
  const stop = () => app.server.close();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
