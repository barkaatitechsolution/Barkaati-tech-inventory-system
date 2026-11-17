export const THEME_STORAGE_KEY = "storemanager-theme";
const ANIM_CLASS = "theme-anim";
const ANIM_MS = 400;
const THEME_COLORS = { light: "#1748b6", dark: "#0f172a" };

export function getTheme() {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function applyTheme(theme) {
  const next = theme === "dark" ? "dark" : "light";
  const root = document.documentElement;
  root.classList.toggle("dark", next === "dark");
  root.style.colorScheme = next;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLORS[next]);
  return next;
}

export function initTheme() {
  let stored = null;
  try {
    stored = localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
  const systemDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  return applyTheme(stored === "dark" || stored === "light" ? stored : systemDark ? "dark" : "light");
}

export function setTheme(theme) {
  const next = applyTheme(theme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    /* private mode - theme just won't persist */
  }
  return next;
}

export function toggleTheme() {
  const root = document.documentElement;
  root.classList.add(ANIM_CLASS);
  const next = setTheme(getTheme() === "dark" ? "light" : "dark");
  window.clearTimeout(toggleTheme._timer);
  toggleTheme._timer = window.setTimeout(() => root.classList.remove(ANIM_CLASS), ANIM_MS);
  return next;
}
