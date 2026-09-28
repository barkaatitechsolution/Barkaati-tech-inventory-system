/** @type {import('tailwindcss').Config} */

// Every colour is routed through a CSS variable declared in src/index.css, so the
// light and dark palettes can be swapped at runtime by toggling `.dark` on <html>.
// Existing class names keep working unchanged -- no `dark:` variants needed.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

// Accent families: one variable per shade, redefined per theme in index.css.
const accent = (family) =>
  Object.fromEntries(
    [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((s) => [s, v(`c-${family}-${s}`)])
  );

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        inherit: "inherit",
        current: "currentColor",
        transparent: "transparent",
        white: v("c-white"),
        slate: accent("slate"),
        indigo: accent("indigo"),
        emerald: accent("emerald"),
        rose: accent("rose"),
        amber: accent("amber"),
        sky: accent("sky"),
        violet: accent("violet"),
        orange: accent("orange"),
        blue: accent("blue"),
        purple: accent("purple"),
        cyan: accent("cyan")
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"]
      }
    }
  },
  plugins: []
};
