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
import { LoraStore } from "./lib/lora-store.mjs";

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
  loraStore,
  publicDir = path.join(UI_ROOT, "public"),
} = {}) {
  const runtimeConfig = config ?? resolveRuntimeConfig({ uiRoot: UI_ROOT });
  const jobs = manager ?? new JobManager(runtimeConfig);
  const loras =
    loraStore ??
    new LoraStore({
      loraDir:
        runtimeConfig.loraDir ??
        path.join(runtimeConfig.workDir ?? path.join(UI_ROOT, "data"), "loras"),
      maxLoraBytes: runtimeConfig.maxLoraBytes,
      loraDownloadTimeoutMs: runtimeConfig.loraDownloadTimeoutMs,
    });

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
      if (request.method === "GET" && pathname === "/api/loras") {
        sendJson(response, 200, {
          loras: await loras.list(),
          inferenceSupported: false,
        });
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

  server.on("close", () => jobs.shutdown?.());
  return { server, config: runtimeConfig, manager: jobs, loraStore: loras };
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
