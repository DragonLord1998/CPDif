import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";

const MAX_LOG_LENGTH = 200_000;

export class PidUpscaler {
  constructor(config, { spawnProcess = spawn } = {}) {
    this.config = config;
    this.spawnProcess = spawnProcess;
    this.child = null;
  }

  async cached(spec) {
    try {
      await access(spec.outputPath, constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  async upscale(spec) {
    if (this.child) {
      throw Object.assign(new Error("NVIDIA PiD is already upscaling an output"), {
        statusCode: 409,
      });
    }
    await mkdir(path.dirname(spec.outputPath), { recursive: true });
    const args = [
      this.config.pidScript,
      "--pid-root",
      this.config.pidRoot,
      "--input",
      spec.inputPath,
      "--output",
      spec.outputPath,
      "--prompt",
      spec.prompt,
      "--seed",
      String(spec.seed),
    ];
    const child = this.spawnProcess(this.config.pidPython, args, {
      cwd: this.config.pidRoot,
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;
    let log = "";
    const appendLog = (chunk) => {
      log = (log + chunk.toString()).slice(-MAX_LOG_LENGTH);
    };
    child.stdout?.on("data", appendLog);
    child.stderr?.on("data", appendLog);
    try {
      const result = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => resolve({ code, signal }));
      });
      if (result.code !== 0) {
        const suffix = log.trim() ? `\n${log.trim()}` : "";
        throw new Error(
          `NVIDIA PiD exited with ${result.code ?? `signal ${result.signal ?? "unknown"}`}${suffix}`,
        );
      }
      if (!(await this.cached(spec))) {
        throw new Error("NVIDIA PiD completed without producing the 4x image");
      }
      return { log };
    } finally {
      if (this.child === child) {
        this.child = null;
      }
    }
  }

  shutdown() {
    this.child?.kill("SIGTERM");
  }
}
