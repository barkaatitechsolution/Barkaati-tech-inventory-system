import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { applyTheme, getTheme, toggleTheme, THEME_STORAGE_KEY } from "../lib/theme.js";

const cx = (...args) => args.filter(Boolean).join(" ");

export default function ThemeToggle({ className = "", onDark = false }) {
  const [theme, setThemeState] = useState(getTheme);

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== THEME_STORAGE_KEY || !e.newValue) return;
      setThemeState(applyTheme(e.newValue));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const toggle = () => setThemeState(toggleTheme());
  const isDark = theme === "dark";
  const label = isDark ? "Switch to light theme" : "Switch to dark theme";

  return (
    <button
      type="button"
      onClick={toggle}
      title={label}
      aria-label={label}
      aria-pressed={isDark}
      className={cx(
        "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors",
        onDark
          ? "bg-white/15 text-white active:bg-white/25"
          : "border border-slate-200 bg-white text-slate-600 shadow-sm active:bg-slate-100",
        className
      )}
    >
      {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}
