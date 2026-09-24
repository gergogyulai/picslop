// Browser-side preparation of files before upload: type/size checks, HEIC → JPEG,
// video playability + length checks and poster capture. The server re-validates everything.
import {
  HEIC_TYPES,
  IMAGE_MAX_BYTES,
  IMAGE_UPLOAD_TYPES,
  POSTER_MAX_BYTES,
  VIDEO_MAX_BYTES,
  VIDEO_MAX_SECONDS,
  VIDEO_UPLOAD_TYPES,
  type MediaKind,
} from "$lib/constants";
import { formatBytes, formatDuration } from "$lib/format";

export type Prepared = {
  kind: MediaKind;
  file: Blob;
  type: string;
  name: string;
  /** Object URL of a still preview (the image itself, or the video's poster). */
  previewUrl: string;
  poster?: Blob;
  duration?: number;
};

const VIDEO_EXT: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/x-m4v",
  mov: "video/quicktime",
  qt: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  "3gp": "video/3gpp",
};
const ext = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";

const isHeic = (f: File) => HEIC_TYPES.includes(f.type) || ["heic", "heif"].includes(ext(f.name));
const isVideo = (f: File) => f.type.startsWith("video/") || !!VIDEO_EXT[ext(f.name)];

export function isSupportedFile(f: File) {
  return isHeic(f) || f.type.startsWith("image/") || isVideo(f);
}

const SAMPLE = 2 * 1024 * 1024;

/**
 * Content fingerprint used to spot the same file added twice (even renamed). Small files are hashed
 * whole; big ones by size + first and last 2 MB, which keeps 150 MB videos cheap on phones.
 */
export async function fingerprint(f: Blob): Promise<string> {
  const parts: BlobPart[] = [String(f.size), "|"];
  if (f.size <= SAMPLE * 4) parts.push(f);
  else parts.push(f.slice(0, SAMPLE), f.slice(f.size - SAMPLE));
  const digest = await crypto.subtle.digest("SHA-256", await new Blob(parts).arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Validates and converts one file. `onStatus` reports slow steps ("Converting HEIC…"). */
export async function prepareFile(f: File, onStatus?: (s: string) => void): Promise<Prepared> {
  if (isHeic(f)) {
    onStatus?.("Converting HEIC…");
    if (f.size > IMAGE_MAX_BYTES) throw new Error(`Images can be at most ${formatBytes(IMAGE_MAX_BYTES)}.`);
    const { heicTo } = await import("heic-to/csp");
    const jpeg = await heicTo({ blob: f, type: "image/jpeg", quality: 0.92 });
    return prepareImage(jpeg, "image/jpeg", f.name.replace(/\.hei[cf]$/i, ".jpg"));
  }
  if (f.type.startsWith("image/")) {
    onStatus?.("Reading image…");
    return prepareImage(f, f.type, f.name);
  }
  if (isVideo(f)) {
    onStatus?.("Checking video…");
    return prepareVideo(f);
  }
  throw new Error("That file type isn't supported.");
}

function prepareImage(file: Blob, type: string, name: string): Prepared {
  if (!(IMAGE_UPLOAD_TYPES as readonly string[]).includes(type)) {
    throw new Error("Supported images: JPEG, PNG, WebP, GIF, AVIF, TIFF and HEIC.");
  }
  if (file.size > IMAGE_MAX_BYTES) throw new Error(`Images can be at most ${formatBytes(IMAGE_MAX_BYTES)}.`);
  return { kind: "image", file, type, name, previewUrl: URL.createObjectURL(file) };
}

async function prepareVideo(f: File): Promise<Prepared> {
  let type = f.type;
  if (!(VIDEO_UPLOAD_TYPES as readonly string[]).includes(type)) type = VIDEO_EXT[ext(f.name)] ?? "";
  if (!type) throw new Error("Supported videos: MP4, MOV, WebM, MKV, M4V and 3GP.");
  if (f.size > VIDEO_MAX_BYTES) throw new Error(`Videos can be at most ${formatBytes(VIDEO_MAX_BYTES)}.`);

  const url = URL.createObjectURL(f);
  const video = document.createElement("video");
  try {
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = url;

    await once(video, "loadeddata", 20_000, "Your browser can't play this video (unsupported codec). Try exporting it as MP4 (H.264).");
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("Couldn't read the video's length.");
    if (duration > VIDEO_MAX_SECONDS + 0.5) {
      throw new Error(`Videos can be at most ${formatDuration(VIDEO_MAX_SECONDS)} long (this one is ${formatDuration(duration)}).`);
    }
    if (!video.videoWidth || !video.videoHeight) throw new Error("That file has no playable video track.");

    video.currentTime = Math.min(1, duration * 0.1);
    await once(video, "seeked", 10_000, "Couldn't grab a thumbnail from the video.");
    const poster = await capture(video);
    return { kind: "video", file: f, type, name: f.name, previewUrl: URL.createObjectURL(poster), poster, duration };
  } finally {
    // Release the decoder right away; with many files queued this matters.
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

function once(el: HTMLMediaElement, event: string, timeout: number, message: string) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => done(new Error(message)), timeout);
    const ok = () => done();
    const fail = () => done(new Error(message));
    function done(err?: Error) {
      clearTimeout(t);
      el.removeEventListener(event, ok);
      el.removeEventListener("error", fail);
      if (err) reject(err);
      else resolve();
    }
    el.addEventListener(event, ok);
    el.addEventListener("error", fail);
  });
}

async function capture(video: HTMLVideoElement): Promise<Blob> {
  const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
  for (const [type, q] of [
    ["image/webp", 0.85],
    ["image/jpeg", 0.85],
  ] as const) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, q));
    // Safari silently falls back to PNG for WebP; accept whatever real type we got.
    if (blob && blob.size <= POSTER_MAX_BYTES) return blob;
  }
  throw new Error("Couldn't create a thumbnail for this video.");
}

/** PUT to a presigned URL with upload progress (fetch can't report upload progress). */
export function putWithProgress(url: string, body: Blob, type: string, onProgress?: (f: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", type);
    if (onProgress) xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status}).`)));
    xhr.onerror = () => reject(new Error("Upload failed — check your connection."));
    xhr.send(body);
  });
}
