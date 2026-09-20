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
app.use(express.json({ limit: "12mb" }));

async function start() {
  try {
    await ensureDatabase();
    await initSchema({ reset: RESET_DB });
    if (process.env.SEED_DEMO !== "false") await seed();
    await mergeDuplicateProducts();

    register(app, pool);

    const uploadsDir = path.join(__dirname, "uploads");
    app.use("/uploads", express.static(uploadsDir));

    const clientDist = path.join(__dirname, "..", "client", "dist");
    app.use(express.static(clientDist));
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(path.join(clientDist, "index.html"));
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