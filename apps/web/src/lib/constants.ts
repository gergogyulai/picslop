// Shared between client and server. Server always re-validates.

export const MB = 1024 * 1024;

export const IMAGE_MAX_BYTES = 25 * MB;
export const VIDEO_MAX_BYTES = 150 * MB;
export const VIDEO_MAX_SECONDS = 180;
export const POSTER_MAX_BYTES = 5 * MB;
export const IMAGE_MAX_PIXELS = 60_000_000;

export const CAPTION_MAX = 280;
/** Files per bulk upload; each becomes its own post. */
export const BULK_MAX_FILES = 50;
export const COMMENT_MAX = 500;
/** Replies nest up to this depth (0 = top level); replying deeper attaches next to the comment instead. */
export const COMMENT_MAX_DEPTH = 4;
export const PAGE_SIZE = 24;

/** Image types the server accepts. HEIC/HEIF is converted to JPEG in the browser before upload. */
export const IMAGE_UPLOAD_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/tiff",
] as const;

/** Extra image types the picker accepts because the browser converts them. */
export const HEIC_TYPES = ["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"];

/**
 * Video containers we accept. Codec support (H.264, HEVC, VP8/9, AV1) depends on the viewer's browser,
 * so the uploader's browser must be able to play the file before it is sent.
 */
export const VIDEO_UPLOAD_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
  "video/x-m4v",
  "video/3gpp",
] as const;

export const ACCEPT_ATTR = [
  ...IMAGE_UPLOAD_TYPES,
  ...HEIC_TYPES,
  ...VIDEO_UPLOAD_TYPES,
  ".heic",
  ".heif",
  ".mov",
  ".mkv",
  ".m4v",
].join(",");

/** Shown on every post as one-tap reactions. Any other emoji can be picked from the full picker. */
export const QUICK_REACTIONS = ["🔥", "😂", "😍", "😮", "💀", "🤡", "😢", "💯"] as const;

/** Different emoji allowed on one post, and reactions one person can leave on one post. */
export const MAX_DISTINCT_REACTIONS = 40;
export const MAX_REACTIONS_PER_USER = 12;

/**
 * Exactly one standard (RGI) emoji: flags, skin tones, ZWJ sequences and keycaps included;
 * text, symbols and multiple emoji are rejected.
 */
export function isEmoji(s: unknown): s is string {
  return typeof s === "string" && s.length > 0 && s.length <= 32 && /^\p{RGI_Emoji}$/v.test(s);
}

export const SORTS = [
  { id: "hot", label: "Hot" },
  { id: "top", label: "Top" },
  { id: "new", label: "New" },
  { id: "discussed", label: "Most discussed" },
] as const;

export type SortId = (typeof SORTS)[number]["id"];

export type MediaKind = "image" | "video";

export type PostView = {
  id: string;
  kind: MediaKind;
  authorId: string;
  authorName: string;
  caption: string;
  createdAt: number;
  width: number;
  height: number;
  duration: number;
  up: number;
  down: number;
  score: number;
  comments: number;
  thumbUrl: string;
  mediaUrl: string;
  myVote: -1 | 0 | 1;
};

export type PostDetail = PostView & {
  /** emoji -> count, only emoji with at least one reaction */
  reactions: Record<string, number>;
  myReactions: string[];
};

export type CommentView = {
  id: string;
  parentId: string | null;
  depth: number;
  /** Deleted but kept as a placeholder because it still has replies. */
  deleted: boolean;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: number;
};
