/** @type {import('tailwindcss').Config} */

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
