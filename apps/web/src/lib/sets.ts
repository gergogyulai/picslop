// Curated sets: shared between client and server, so the export button and the export endpoint
// apply exactly the same rule. The server always re-checks.

export const SET_NAME_MAX = 80;
export const SET_MAX_ITEMS = 300;
export const VETO_REASON_MAX = 200;

export type ItemState = "pending" | "approved" | "vetoed";

export const ITEM_STATES: readonly ItemState[] = ["pending", "approved", "vetoed"];

export type SetItemView = {
  postId: string;
  /** 1-based place in the video. */
  position: number;
  state: ItemState;
  /** Who put it in its current state, and when: the curator who added it while pending, otherwise the reviewer. */
  stateById: string;
  stateByName: string;
  stateAt: number;
  /** Optional veto reason; only ever set while vetoed. */
  reason: string;
  addedById: string;
  addedByName: string;
  addedAt: number;
  /** The vetoed image this one replaced, if any. */
  replaces: string;
  /** Null when the post has since been deleted from the board. */
  post: {
    kind: "image" | "video";
    caption: string;
    authorName: string;
    width: number;
    height: number;
    thumbUrl: string;
    mediaUrl: string;
  } | null;
};

export type SetLogEntry = {
  at: number;
  byId: string;
  byName: string;
  action: "create" | "rename" | "add" | "add-many" | "remove" | "replace" | "reorder" | "approve" | "veto";
  postId?: string;
  /** For "add-many": how many images went in. */
  count?: number;
  /** For "replace": the vetoed image that left the set. */
  replaced?: string;
  reason?: string;
};

export type SetView = {
  id: string;
  name: string;
  createdById: string;
  createdByName: string;
  createdAt: number;
  updatedAt: number;
  /** Bumped by every change to the set's contents or order (not by reviews). Reorders must quote it. */
  rev: number;
  items: SetItemView[];
  /** Images vetoed and swapped out of this set; they can't be added back. */
  rejected: string[];
};

export type BulkAddResult = {
  added: number;
  /** Already in the set. */
  present: number;
  /** Vetoed out of this set before, so not allowed back. */
  rejected: number;
  /** Didn't fit: the set hit its size limit. */
  full: number;
  /** Videos, which can't go into a slideshow. */
  videos: number;
};

export type ExportBlockers = {
  empty: boolean;
  pending: number;
  vetoed: number;
  /** Images whose post was deleted from the board after being added. */
  missing: number;
};

/**
 * A set can be exported only when it has images and every one of them is approved:
 * no vetoed images, no pending ones, none whose post has disappeared.
 */
export function exportBlockers(items: Pick<SetItemView, "state" | "post">[]): ExportBlockers {
  return {
    empty: items.length === 0,
    pending: items.filter((i) => i.post && i.state === "pending").length,
    vetoed: items.filter((i) => i.post && i.state === "vetoed").length,
    missing: items.filter((i) => !i.post).length,
  };
}

export function canExport(b: ExportBlockers) {
  return !b.empty && b.pending === 0 && b.vetoed === 0 && b.missing === 0;
}

export function blockerText(b: ExportBlockers) {
  if (b.empty) return "Add images before exporting.";
  const parts: string[] = [];
  if (b.vetoed) parts.push(`${b.vetoed} vetoed (replace ${b.vetoed === 1 ? "it" : "them"})`);
  if (b.pending) parts.push(`${b.pending} waiting for a reviewer`);
  if (b.missing) parts.push(`${b.missing} deleted from the board`);
  return parts.length ? `Export unlocks when every image is approved: ${parts.join(", ")}.` : "";
}
