import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

const STORAGE_KEY = "storemanager-theme";
const ANIM_CLASS = "theme-anim";
const ANIM_MS = 400;

const currentTheme = () =>
  document.documentElement.classList.contains("dark") ? "dark" : "light";

export default function ThemeToggle({ className = "" }) {
  const [theme, setTheme] = useState(currentTheme);

  useEffect(() => {
    // Keep in step if another tab changes the theme.
    const onStorage = (e) => {
      if (e.key !== STORAGE_KEY || !e.newValue) return;
      const next = e.newValue === "dark" ? "dark" : "light";
      document.documentElement.classList.toggle("dark", next === "dark");
      document.documentElement.style.colorScheme = next;
      setTheme(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    const root = document.documentElement;

    // Enable the cross-fade only for the switch itself, then drop it so the
    // app's own transitions keep their original behaviour.
    root.classList.add(ANIM_CLASS);
    root.classList.toggle("dark", next === "dark");
    root.style.colorScheme = next;
    setTheme(next);

    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private mode - theme just won't persist */
    }

    window.clearTimeout(toggle._t);
    toggle._t = window.setTimeout(() => root.classList.remove(ANIM_CLASS), ANIM_MS);
  };

  const isDark = theme === "dark";
  const label = isDark ? "Switch to light theme" : "Switch to dark theme";

  return (
    <button
      type="button"
      onClick={toggle}
      title={label}
      aria-label={label}
      aria-pressed={isDark}
      className={`group relative flex h-10 w-[4.5rem] shrink-0 items-center rounded-full border border-slate-200 bg-slate-100 p-1 transition-colors hover:border-indigo-300 ${className}`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute left-1 top-1 h-8 w-8 rounded-full bg-white shadow-md ring-1 ring-slate-200/70 transition-transform duration-300 ease-out ${
          isDark ? "translate-x-8" : "translate-x-0"
        }`}
      />
      <span className="relative z-10 flex w-1/2 items-center justify-center">
        <Sun
          className={`h-[18px] w-[18px] transition-all duration-300 ${
            isDark ? "text-slate-400" : "text-amber-500"
          }`}
        />
      </span>
      <span className="relative z-10 flex w-1/2 items-center justify-center">
        <Moon
          className={`h-[18px] w-[18px] transition-all duration-300 ${
            isDark ? "text-indigo-400" : "text-slate-400"
          }`}
        />
      </span>
    </button>
  );
}
