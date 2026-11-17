import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": "http://localhost:3001",
      "/uploads": "http://localhost:3001"
    }
  },
  build: {
    // The charting library is a lazy chunk, so a >500 kB warning for it is
    // expected and harmless.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Keep the React runtime in its own long-lived cache chunk, but let the
        // lazy Dashboard chart chunk own recharts/d3. Naming recharts in the
        // old object form pulled React into the charts chunk, which made every
        // page preload the whole charting library on first paint.
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return "react";
          if (/[\\/]node_modules[\\/](recharts|d3-[^\\/]+)[\\/]/.test(id)) return "charts";
        }
      }
    }
  }
});