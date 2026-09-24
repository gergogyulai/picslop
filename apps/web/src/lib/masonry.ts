import type { PostView } from "./constants";

type Sizing = Pick<PostView, "width" | "height" | "caption">;

/** Height / width of a card's media box, clamped so extreme panoramas and strips stay usable. */
export function cardRatio(p: Pick<PostView, "width" | "height">) {
  return p.width && p.height ? Math.min(Math.max(p.height / p.width, 0.45), 1.9) : 1;
}

/** Rough rendered card height in px for a given card width (media + caption + footer + bottom margin). */
export function estimateCardHeight(p: Sizing, width: number) {
  let h = width * cardRatio(p) + 90;
  if (p.caption) h += Math.min(3, Math.ceil((p.caption.length * 7.8) / width)) * 20 + 8;
  return h;
}

// Typical card width per column count. Placement uses these fixed values rather than measured
// widths so a post's column depends only on the posts before it: appending never moves anything.
const NOMINAL_WIDTH = [0, 360, 170, 260, 290, 270];

/**
 * Greedy shortest-column placement. It's online (each post only looks at earlier ones), so the
 * result for a prefix of `posts` never changes when more posts are appended.
 */
export function distribute<T extends Sizing>(posts: T[], count: number) {
  const width = NOMINAL_WIDTH[count] ?? 260;
  const cols = Array.from({ length: count }, () => [] as { post: T; index: number }[]);
  const heights = new Array<number>(count).fill(0);
  posts.forEach((post, index) => {
    let c = 0;
    for (let i = 1; i < count; i++) if (heights[i]! < heights[c]! - 1) c = i;
    cols[c]!.push({ post, index });
    heights[c]! += estimateCardHeight(post, width);
  });
  return cols;
}

/** Column count per Tailwind breakpoint; 0 stands for "phone" where the grid/feed toggle applies. */
const BREAKPOINTS: [string, number][] = [
  ["96rem", 5],
  ["80rem", 4],
  ["48rem", 3],
  ["40rem", 2],
];

export function currentBreakpointCols() {
  for (const [w, n] of BREAKPOINTS) if (matchMedia(`(min-width: ${w})`).matches) return n;
  return 0;
}

export function watchBreakpoints(cb: () => void) {
  const qs = BREAKPOINTS.map(([w]) => matchMedia(`(min-width: ${w})`));
  qs.forEach((q) => q.addEventListener("change", cb));
  return () => qs.forEach((q) => q.removeEventListener("change", cb));
}

export const COLS_COOKIE = "board-cols";
export const FEED_COOKIE = "board-feed";

export function setPrefCookie(name: string, value: string) {
  document.cookie = `${name}=${value}; path=/; max-age=31536000; samesite=lax`;
}
