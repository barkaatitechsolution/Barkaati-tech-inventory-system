import express from "express";
import cors from "cors";
import compression from "compression";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, ensureDatabase, initSchema, seed, mergeDuplicateProducts } from "./db.js";
import { register } from "./api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;
const RESET_DB = process.env.RESET_DB === "true" || process.argv.includes("--reset");

app.use(cors());
app.use(compression());
app.use(express.json({ limit: "25mb" }));

async function start() {
  try {
    await ensureDatabase();
    await initSchema({ reset: RESET_DB });
    if (process.env.SEED_DEMO === "true") await seed();
    await mergeDuplicateProducts();

    register(app, pool);

    const clientDist = path.join(__dirname, "..", "client", "dist");
    const uploadsDir = path.join(__dirname, "uploads");
    app.use("/uploads", express.static(uploadsDir, { maxAge: "1d" }));
    app.use("/assets", express.static(path.join(clientDist, "assets"), { maxAge: "7d", immutable: true }));
    app.use(express.static(clientDist));
    app.use("/api", (_req, res) => res.status(404).json({ error: "API route not found" }));
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(path.join(clientDist, "index.html"));
    });

    app.use((err, _req, res, _next) => {
      // Body-parser limit errors are client errors, not server faults.
      const tooLarge =
        err &&
        (err.type === "entity.too.large" ||
          err.status === 413 ||
          err.statusCode === 413 ||
          /too large/i.test(String(err.message || "")));
      if (tooLarge) {
        return res.status(413).json({ error: "File is too large — maximum is 15MB" });
      }
      console.error(err);
      res.status(500).json({ error: err.message || "Internal server error" });
    });

    app.listen(PORT, () => {
      console.log(`Store Manager API running on http://localhost:${PORT} (PostgreSQL)`);
    });
  } catch (e) {
    console.error("Failed to start server:", e.message);
    process.exit(1);
  }
}

start();