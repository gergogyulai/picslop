export type ThemePref = "light" | "dark" | "system";

const KEY = "picslop:theme";
const PAPER = { light: "#f2ede3", dark: "#171512" } as const;

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark") return v;
  } catch {}
  return "system";
}

/** The theme actually showing right now. */
export function isDark(): boolean {
  const set = document.documentElement.dataset.theme;
  if (set) return set === "dark";
  return matchMedia("(prefers-color-scheme: dark)").matches;
}

export function setThemePref(pref: ThemePref) {
  try {
    if (pref === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {}
  const root = document.documentElement;
  if (pref === "system") delete root.dataset.theme;
  else root.dataset.theme = pref;
  syncThemeColor();
}

/** Keep the browser chrome colour in step with the paper. */
export function syncThemeColor() {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = isDark() ? PAPER.dark : PAPER.light;
}
