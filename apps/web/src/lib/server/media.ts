import sharp, { type Metadata } from "sharp";

import { IMAGE_MAX_PIXELS } from "$lib/constants";

import { getRange } from "./r2";

sharp.cache(false);
sharp.concurrency(2);

// ---------------------------------------------------------------------------
// Sniffing: never trust the declared content type, look at the bytes.
// ---------------------------------------------------------------------------

const ascii = (b: Uint8Array, start: number, len: number) =>
  String.fromCharCode(...b.subarray(start, start + len));

export type VideoContainer = "isobmff" | "matroska";

export function sniffVideo(head: Uint8Array): VideoContainer | null {
  if (head.length >= 12 && ascii(head, 4, 4) === "ftyp") {
    const brand = ascii(head, 8, 4);
    // HEIC/AVIF stills are ISO BMFF too, don't let them through as "video".
    if (/^(heic|heix|hevc|heim|heis|mif1|msf1|avif|avis)$/.test(brand)) return null;
    return "isobmff";
  }
  // Older QuickTime files may start with other atoms.
  if (head.length >= 8 && /^(moov|mdat|wide|free|skip|pnot)$/.test(ascii(head, 4, 4))) return "isobmff";
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return "matroska";
  return null;
}

/** The content type we store/serve. Browsers play MOV (H.264/HEVC) fine when told it's MP4. */
export function servedVideoType(container: VideoContainer) {
  return container === "isobmff" ? "video/mp4" : "video/webm";
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

const ALLOWED_IMAGE_FORMATS = new Set(["jpeg", "png", "webp", "gif", "avif", "heif", "tiff"]);

export type ProcessedImage = {
  full: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
};

/**
 * Validates and re-encodes an image. Re-encoding strips all metadata (EXIF, GPS, etc.),
 * normalises orientation, caps dimensions and neutralises malformed/polyglot files.
 */
export async function processImage(input: Buffer, opts: { fullMax?: number } = {}): Promise<ProcessedImage> {
  const fullMax = opts.fullMax ?? 2560;
  let meta: Metadata;
  try {
    meta = await sharp(input, { limitInputPixels: IMAGE_MAX_PIXELS }).metadata();
  } catch {
    throw new MediaError("That file isn't a valid image.");
  }
  if (!meta.format || !ALLOWED_IMAGE_FORMATS.has(meta.format)) {
    throw new MediaError("Unsupported image format.");
  }
  const animated = (meta.pages ?? 1) > 1 && (meta.format === "gif" || meta.format === "webp");

  const base = () =>
    sharp(input, { limitInputPixels: IMAGE_MAX_PIXELS, animated, failOn: "error" }).rotate();

  try {
    const full = await base()
      .resize({ width: fullMax, height: fullMax, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 84, effort: 4 })
      .toBuffer({ resolveWithObject: true });

    // Thumbnails are always a still of the first frame to keep the board light.
    const thumb = await sharp(input, { limitInputPixels: IMAGE_MAX_PIXELS })
      .rotate()
      .resize({ width: 720, height: 1440, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 74, effort: 4 })
      .toBuffer();

    const height = animated ? (full.info.pageHeight ?? full.info.height) : full.info.height;
    return { full: full.data, thumb, width: full.info.width, height };
  } catch (e) {
    console.error("[media] image processing failed", e);
    throw new MediaError("Couldn't process that image.");
  }
}

export class MediaError extends Error {}

// ---------------------------------------------------------------------------
// Video duration (best effort, via ranged reads from R2 — no ffmpeg needed)
// ---------------------------------------------------------------------------

const MAX_MOOV_BYTES = 16 * 1024 * 1024;

/** Returns duration in seconds, or null if it can't be determined. */
export async function probeVideoDuration(
  key: string,
  size: number,
  container: VideoContainer,
): Promise<number | null> {
  try {
    return container === "isobmff" ? await isoBmffDuration(key, size) : await matroskaDuration(key, size);
  } catch (e) {
    console.warn("[media] duration probe failed", e);
    return null;
  }
}

async function isoBmffDuration(key: string, size: number): Promise<number | null> {
  let offset = 0;
  // Walk top-level boxes (ftyp, mdat, moov, ...) reading only their headers.
  for (let i = 0; i < 64 && offset + 8 <= size; i++) {
    const h = await getRange(key, offset, Math.min(offset + 15, size - 1));
    const dv = new DataView(h.buffer, h.byteOffset, h.byteLength);
    let boxSize = dv.getUint32(0);
    const type = ascii(h, 4, 4);
    let headerLen = 8;
    if (boxSize === 1) {
      if (h.length < 16) return null;
      boxSize = Number(dv.getBigUint64(8));
      headerLen = 16;
    } else if (boxSize === 0) {
      boxSize = size - offset;
    }
    if (boxSize < headerLen) return null;

    if (type === "moov") {
      if (boxSize > MAX_MOOV_BYTES) return null;
      const moov = await getRange(key, offset + headerLen, offset + boxSize - 1);
      return findMvhdDuration(moov);
    }
    offset += boxSize;
  }
  return null;
}

function findMvhdDuration(moov: Uint8Array): number | null {
  const dv = new DataView(moov.buffer, moov.byteOffset, moov.byteLength);
  let p = 0;
  while (p + 8 <= moov.length) {
    const s = dv.getUint32(p);
    const t = ascii(moov, p + 4, 4);
    if (t === "mvhd") {
      const version = moov[p + 8];
      if (version === 1) {
        const timescale = dv.getUint32(p + 8 + 4 + 16);
        const duration = Number(dv.getBigUint64(p + 8 + 4 + 16 + 4));
        return timescale ? duration / timescale : null;
      }
      const timescale = dv.getUint32(p + 8 + 4 + 8);
      const duration = dv.getUint32(p + 8 + 4 + 8 + 4);
      return timescale ? duration / timescale : null;
    }
    if (s < 8) return null;
    p += s;
  }
  return null;
}

// Minimal EBML reader: Segment > Info > (TimecodeScale, Duration)
const EBML_SEGMENT = 0x18538067;
const EBML_INFO = 0x1549a966;
const EBML_TIMECODE_SCALE = 0x2ad7b1;
const EBML_DURATION = 0x4489;

function readVint(b: Uint8Array, p: number, keepMarker: boolean) {
  const first = b[p];
  if (first === undefined || first === 0) return null;
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 8 || p + len > b.length) return null;
  let value = keepMarker ? first : first & (0xff >> len);
  let allOnes = value === (0xff >> len);
  for (let i = 1; i < len; i++) {
    const byte = b[p + i]!;
    value = value * 256 + byte;
    if (byte !== 0xff) allOnes = false;
  }
  return { value, len, unknown: !keepMarker && allOnes };
}

async function matroskaDuration(key: string, size: number): Promise<number | null> {
  const buf = await getRange(key, 0, Math.min(size, 512 * 1024) - 1);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  const walk = (start: number, end: number, want: number) => {
    let p = start;
    while (p < end) {
      const id = readVint(buf, p, true);
      if (!id) return null;
      const sz = readVint(buf, p + id.len, false);
      if (!sz) return null;
      const dataStart = p + id.len + sz.len;
      const dataEnd = sz.unknown ? end : Math.min(end, dataStart + sz.value);
      if (id.value === want) return { start: dataStart, end: dataEnd };
      if (sz.unknown) return null;
      p = dataStart + sz.value;
    }
    return null;
  };

  const segment = walk(0, buf.length, EBML_SEGMENT);
  if (!segment) return null;
  const info = walk(segment.start, segment.end, EBML_INFO);
  if (!info) return null;

  let scale = 1_000_000;
  let duration: number | null = null;
  let p = info.start;
  while (p < info.end) {
    const id = readVint(buf, p, true);
    const sz = id && readVint(buf, p + id.len, false);
    if (!id || !sz) break;
    const d = p + id.len + sz.len;
    if (id.value === EBML_TIMECODE_SCALE) {
      let v = 0;
      for (let i = 0; i < sz.value; i++) v = v * 256 + buf[d + i]!;
      scale = v || scale;
    } else if (id.value === EBML_DURATION) {
      duration = sz.value === 4 ? dv.getFloat32(d) : sz.value === 8 ? dv.getFloat64(d) : null;
    }
    p = d + sz.value;
  }
  return duration == null ? null : (duration * scale) / 1e9;
}
