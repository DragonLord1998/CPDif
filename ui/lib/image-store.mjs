import { randomUUID } from "node:crypto";
import { link, mkdir, open, unlink } from "node:fs/promises";
import path from "node:path";

const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;
const MAX_HEADER_BYTES = 1024 * 1024;
const MAX_DIMENSION = 16_384;
const MAX_PIXELS = 64 * 1024 * 1024;
const IMAGE_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const IMAGE_TYPES = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
]);
const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

export class ImageStoreError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "ImageStoreError";
    this.statusCode = statusCode;
  }
}

function fail(statusCode, message) {
  throw new ImageStoreError(statusCode, message);
}

function normalizeFilename(value) {
  let filename = "reference image";
  try {
    filename = decodeURIComponent(String(value || ""));
  } catch {
    fail(400, "image filename is invalid");
  }
  filename = path.basename(filename).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return filename.slice(0, 120) || "reference image";
}

function pngDimensions(header) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (header.length < 24 || !header.subarray(0, 8).equals(signature)) {
    fail(422, "uploaded file is not a valid PNG image");
  }
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

function jpegDimensions(header) {
  if (header.length < 4 || header[0] !== 0xff || header[1] !== 0xd8) {
    fail(422, "uploaded file is not a valid JPEG image");
  }
  let offset = 2;
  while (offset + 8 < header.length) {
    if (header[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (header[offset] === 0xff) {
      offset += 1;
    }
    const marker = header[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    if (offset + 2 > header.length) {
      break;
    }
    const segmentLength = header.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > header.length) {
      break;
    }
    if (JPEG_SOF_MARKERS.has(marker) && segmentLength >= 7) {
      return {
        height: header.readUInt16BE(offset + 3),
        width: header.readUInt16BE(offset + 5),
      };
    }
    offset += segmentLength;
  }
  fail(422, "JPEG dimensions were not found in the first 1 MiB");
}

function validateDimensions({ width, height }) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_DIMENSION ||
    height > MAX_DIMENSION ||
    width * height > MAX_PIXELS
  ) {
    fail(422, "reference image dimensions are unsupported");
  }
  return { width, height };
}

function publicImage(image) {
  return Object.freeze({
    id: image.id,
    filename: image.filename,
    contentType: image.contentType,
    sizeBytes: image.sizeBytes,
    width: image.width,
    height: image.height,
    url: `/api/images/${image.id}`,
  });
}

export class ImageStore {
  constructor({ imageDir, maxImageBytes = DEFAULT_MAX_BYTES } = {}) {
    if (!imageDir) {
      throw new Error("imageDir is required");
    }
    this.imageDir = path.resolve(imageDir);
    this.maxBytes = maxImageBytes;
    this.images = new Map();
  }

  list() {
    return [...this.images.values()].map(publicImage);
  }

  path(id) {
    return IMAGE_ID.test(String(id || "")) ? this.images.get(id)?.path ?? null : null;
  }

  get(id) {
    return IMAGE_ID.test(String(id || "")) ? this.images.get(id) ?? null : null;
  }

  async upload({ body, contentType, filename, declaredSize } = {}) {
    const normalizedType = String(contentType || "").split(";", 1)[0].trim().toLowerCase();
    const extension = IMAGE_TYPES.get(normalizedType);
    if (!extension) {
      fail(415, "reference image must be PNG or JPEG");
    }
    const safeFilename = normalizeFilename(filename);
    const expectedSize = Number(declaredSize);
    if (Number.isFinite(expectedSize) && expectedSize > this.maxBytes) {
      fail(413, `reference image exceeds the ${this.maxBytes}-byte upload limit`);
    }
    if (!body || typeof body[Symbol.asyncIterator] !== "function") {
      fail(400, "reference image body is required");
    }

    await mkdir(this.imageDir, { recursive: true });
    const id = randomUUID();
    const destination = path.join(this.imageDir, `${id}.${extension}`);
    const temporary = path.join(this.imageDir, `.${id}.${extension}.part`);
    const file = await open(temporary, "wx");
    const headerParts = [];
    let headerBytes = 0;
    let sizeBytes = 0;
    try {
      try {
        for await (const chunk of body) {
          const bytes = Buffer.from(chunk);
          sizeBytes += bytes.length;
          if (sizeBytes > this.maxBytes) {
            fail(413, `reference image exceeds the ${this.maxBytes}-byte upload limit`);
          }
          if (headerBytes < MAX_HEADER_BYTES) {
            const part = bytes.subarray(0, MAX_HEADER_BYTES - headerBytes);
            headerParts.push(part);
            headerBytes += part.length;
          }
          await file.write(bytes);
        }
        await file.sync();
      } finally {
        await file.close();
      }
      if (sizeBytes === 0) {
        fail(400, "reference image body is empty");
      }
      const header = Buffer.concat(headerParts, headerBytes);
      const dimensions = validateDimensions(
        normalizedType === "image/png" ? pngDimensions(header) : jpegDimensions(header),
      );
      await link(temporary, destination);
      await unlink(temporary);
      const image = Object.freeze({
        id,
        filename: safeFilename,
        contentType: normalizedType,
        sizeBytes,
        ...dimensions,
        path: destination,
      });
      this.images.set(id, image);
      return publicImage(image);
    } finally {
      await file.close().catch(() => {});
      await unlink(temporary).catch(() => {});
    }
  }

  async remove(id) {
    const image = this.get(id);
    if (!image) {
      return false;
    }
    this.images.delete(id);
    await unlink(image.path).catch(() => {});
    return true;
  }
}
