import express from "express";
import cors from "cors";
import compression from "compression";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, ensureDatabase } from "./db.js";
import { register } from "./api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3002);

// Product photos live in the shop app's uploads folder. Serving them from the
// public server keeps their URLs relative, so they keep working behind a
// Cloudflare tunnel instead of pointing back at localhost.
const UPLOADS_DIR =
  process.env.INVENTORY_UPLOADS_DIR || path.join(__dirname, "..", "..", "server", "uploads");

app.use(cors());
app.use(compression());
app.use(express.json({ limit: "2mb" }));

async function start() {
  try {
    await ensureDatabase();
    await pool.query("SELECT 1");
    register(app);

    const clientDist = path.join(__dirname, "..", "client", "dist");
    app.use("/uploads", express.static(UPLOADS_DIR, { maxAge: "1d" }));
    app.use("/assets", express.static(path.join(clientDist, "assets"), { maxAge: "7d", immutable: true }));
    app.use(express.static(clientDist));
    app.use("/api", (_req, res) => res.status(404).json({ error: "API route not found" }));
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(path.join(clientDist, "index.html"));
    });
    app.use((err, _req, res, _next) => {
      const tooLarge =
        err &&
        (err.type === "entity.too.large" ||
          err.status === 413 ||
          err.statusCode === 413 ||
          /too large/i.test(String(err.message || "")));
      if (tooLarge) {
        return res.status(413).json({ error: "Request body is too large." });
      }
      const clientStatus = Number(err?.status || err?.statusCode);
      if (clientStatus >= 400 && clientStatus < 500) {
        return res.status(clientStatus).json({ error: err.message || "Bad request" });
      }
      console.error(err);
      res.status(500).json({ error: err.message || "Internal server error" });
    });

    app.listen(PORT, () => {
      console.log(`Online Store running on http://localhost:${PORT}`);
    });
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

start();
