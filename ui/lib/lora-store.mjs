import { randomUUID } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import {
  link,
  mkdir,
  open,
  readdir,
  stat,
  unlink,
} from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";

const DEFAULT_MAX_BYTES = 4 * 1024 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_REDIRECTS = 4;
const MAX_SAFETENSORS_HEADER_BYTES = 100 * 1024 * 1024;
const LORA_NAME = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,79}$/;

export class LoraStoreError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "LoraStoreError";
    this.statusCode = statusCode;
  }
}

function fail(statusCode, message) {
  throw new LoraStoreError(statusCode, message);
}

export function normalizeLoraName(value) {
  if (typeof value !== "string") {
    fail(400, "LoRA name is required");
  }
  const name = value.trim().replace(/\.safetensors$/i, "").trim();
  if (!name || !LORA_NAME.test(name) || name.endsWith(".") || name.includes("..")) {
    fail(
      400,
      "LoRA name must be 1-80 characters using letters, numbers, spaces, dot, dash, or underscore",
    );
  }
  return name;
}

function isPrivateIpv4(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return true;
  }
  const [a, b, c] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}

function isPrivateIpv6(address) {
  const normalized = address.toLowerCase();
  if (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:")
  ) {
    return true;
  }
  const first = Number.parseInt(normalized.split(":", 1)[0], 16);
  if (Number.isInteger(first) && (first & 0xffc0) === 0xfe80) {
    return true;
  }
  const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isPrivateIpv4(mapped[1]) : false;
}

function isPrivateAddress(address, family) {
  return family === 4 ? isPrivateIpv4(address) : isPrivateIpv6(address);
}

export async function validateLoraUrl(value, { lookup = dnsLookup } = {}) {
  if (typeof value !== "string" || !value.trim()) {
    fail(400, "LoRA URL is required");
  }
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    fail(400, "LoRA URL must be a valid HTTPS URL");
  }
  if (url.protocol !== "https:") {
    fail(400, "LoRA URL must use HTTPS");
  }
  if (url.username || url.password) {
    fail(400, "LoRA URL must not contain embedded credentials");
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    isIP(hostname)
  ) {
    fail(400, "LoRA URL must use a public hostname");
  }
  let addresses;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    fail(400, "LoRA URL hostname could not be resolved");
  }
  if (
    !Array.isArray(addresses) ||
    addresses.length === 0 ||
    addresses.some(({ address, family }) => isPrivateAddress(address, family))
  ) {
    fail(400, "LoRA URL hostname must resolve only to public addresses");
  }
  return url;
}

async function fetchWithSafeRedirects(url, { fetchImpl, lookup, signal }) {
  let current = url;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const safeUrl = await validateLoraUrl(current.href, { lookup });
    let response;
    try {
      response = await fetchImpl(safeUrl, {
        method: "GET",
        redirect: "manual",
        signal,
        headers: { Accept: "application/octet-stream, */*;q=0.5" },
      });
    } catch (error) {
      if (error?.name === "AbortError" || signal.aborted) {
        fail(504, "LoRA download timed out");
      }
      fail(502, "LoRA download request failed");
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) {
        fail(502, "LoRA download redirect did not include a destination");
      }
      if (redirects === MAX_REDIRECTS) {
        fail(502, "LoRA download exceeded the redirect limit");
      }
      current = new URL(location, safeUrl);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      fail(502, `LoRA download returned HTTP ${response.status}`);
    }
    if (!response.body) {
      fail(502, "LoRA download response was empty");
    }
    return response;
  }
  fail(502, "LoRA download exceeded the redirect limit");
}

async function validateSafetensors(filePath, sizeBytes) {
  if (sizeBytes < 10) {
    fail(422, "Downloaded file is not a valid safetensors file");
  }
  const file = await open(filePath, "r");
  try {
    const lengthBuffer = Buffer.alloc(8);
    await file.read(lengthBuffer, 0, 8, 0);
    const headerLength = Number(lengthBuffer.readBigUInt64LE());
    if (
      !Number.isSafeInteger(headerLength) ||
      headerLength < 2 ||
      headerLength > MAX_SAFETENSORS_HEADER_BYTES ||
      headerLength > sizeBytes - 8
    ) {
      fail(422, "Downloaded file is not a valid safetensors file");
    }
    const headerBuffer = Buffer.alloc(headerLength);
    await file.read(headerBuffer, 0, headerLength, 8);
    const header = JSON.parse(headerBuffer.toString("utf8").trim());
    if (header === null || typeof header !== "object" || Array.isArray(header)) {
      fail(422, "Downloaded file is not a valid safetensors file");
    }
  } catch (error) {
    if (error instanceof LoraStoreError) {
      throw error;
    }
    fail(422, "Downloaded file is not a valid safetensors file");
  } finally {
    await file.close();
  }
}

function publicLora(name, filename, stats) {
  return Object.freeze({
    name,
    filename,
    sizeBytes: stats.size,
    downloadedAt: stats.mtime.toISOString(),
  });
}

export class LoraStore {
  constructor(
    { loraDir, maxLoraBytes = DEFAULT_MAX_BYTES, loraDownloadTimeoutMs = DEFAULT_TIMEOUT_MS },
    { fetchImpl = globalThis.fetch, lookup = dnsLookup } = {},
  ) {
    if (!loraDir) {
      throw new Error("loraDir is required");
    }
    this.loraDir = path.resolve(loraDir);
    this.maxBytes = maxLoraBytes;
    this.timeoutMs = loraDownloadTimeoutMs;
    this.fetchImpl = fetchImpl;
    this.lookup = lookup;
    this.active = new Set();
  }

  async list() {
    await mkdir(this.loraDir, { recursive: true });
    const entries = await readdir(this.loraDir, { withFileTypes: true });
    const loras = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".safetensors"))
        .map(async (entry) => {
          const filename = entry.name;
          const name = filename.slice(0, -".safetensors".length);
          return publicLora(name, filename, await stat(path.join(this.loraDir, filename)));
        }),
    );
    return loras.sort((left, right) => right.downloadedAt.localeCompare(left.downloadedAt));
  }

  async download({ name: rawName, url: rawUrl } = {}) {
    const name = normalizeLoraName(rawName);
    const filename = `${name}.safetensors`;
    const key = filename.toLowerCase();
    if (this.active.has(key)) {
      fail(409, "A LoRA with this name is already downloading");
    }
    this.active.add(key);
    await mkdir(this.loraDir, { recursive: true });
    const destination = path.join(this.loraDir, filename);
    const temporary = path.join(this.loraDir, `.${filename}.${randomUUID()}.part`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    timeout.unref?.();
    try {
      const existingNames = await readdir(this.loraDir);
      if (existingNames.some((existing) => existing.toLowerCase() === key)) {
        fail(409, "A LoRA with this name already exists");
      }
      const initialUrl = await validateLoraUrl(rawUrl, { lookup: this.lookup });
      const response = await fetchWithSafeRedirects(initialUrl, {
        fetchImpl: this.fetchImpl,
        lookup: this.lookup,
        signal: controller.signal,
      });
      const declaredSize = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredSize) && declaredSize > this.maxBytes) {
        await response.body.cancel();
        fail(413, `LoRA exceeds the ${this.maxBytes}-byte download limit`);
      }
      const file = await open(temporary, "wx");
      let sizeBytes = 0;
      try {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          sizeBytes += value.byteLength;
          if (sizeBytes > this.maxBytes) {
            await reader.cancel();
            fail(413, `LoRA exceeds the ${this.maxBytes}-byte download limit`);
          }
          await file.write(value);
        }
        await file.sync();
      } finally {
        await file.close();
      }
      await validateSafetensors(temporary, sizeBytes);
      try {
        await link(temporary, destination);
        await unlink(temporary);
      } catch (error) {
        if (error?.code === "EEXIST") {
          fail(409, "A LoRA with this name already exists");
        }
        throw error;
      }
      return publicLora(name, filename, await stat(destination));
    } catch (error) {
      if (error?.name === "AbortError" || controller.signal.aborted) {
        fail(504, "LoRA download timed out");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      this.active.delete(key);
      await unlink(temporary).catch(() => {});
    }
  }
}
