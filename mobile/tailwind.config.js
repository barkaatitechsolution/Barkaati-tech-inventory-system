/** @type {import('tailwindcss').Config} */

// Colours resolve to CSS variables declared in src/theme.css, so the light and
// dark palettes swap at runtime by toggling `.dark` on <html>.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
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
        brand: accent("brand"),
        red: accent("red"),
        emerald: accent("emerald"),
        amber: accent("amber"),
        indigo: accent("indigo"),
        sky: accent("sky"),
        rose: accent("rose"),
        purple: accent("purple"),
        violet: accent("violet"),
        cyan: accent("cyan"),
        blue: accent("blue"),
        teal: accent("teal"),
        fuchsia: accent("fuchsia"),
        orange: accent("orange")
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"]
      }
    }
  },
  plugins: []
};
