import express from "express";
import cors from "cors";
import compression from "compression";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, ensureDatabase, initSchema, seed, mergeDuplicateProducts } from "./db.js";
import { register, BODY_LIMIT_BYTES, tooLargeMessage } from "./api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;
const RESET_DB = process.env.RESET_DB === "true" || process.argv.includes("--reset");

// This machine is the one that stays on at the shop and starts the app on boot.
// Phones and other devices need its current LAN address, which changes when the
// router hands out a new lease, so the address is written to a plain text file
// every time the server starts.
const APP_URL_FILE =
  process.env.APP_URL_FILE || path.join(__dirname, "..", "APP-URL.txt");

function lanAddress() {
  const candidates = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (/^(docker|br-|veth|virbr|vmnet|tun|tap|wg|zt)/i.test(name)) continue;
    for (const addr of addrs || []) {
      if (addr.family !== "IPv4" || addr.internal) continue;
      candidates.push({ name, address: addr.address });
    }
  }
  const rank = (name) =>
    /^(wl|wlan|wifi)/i.test(name) ? 0 : /^(en|eth)/i.test(name) ? 1 : 2;
  candidates.sort((a, b) => rank(a.name) - rank(b.name));
  return candidates[0] || null;
}

let lastLanKey = null;

function writeAppUrlFile(force = false) {
  const lan = lanAddress();
  const key = lan ? lan.address : "none";
  // Only touch the file when the address changes (or on the first boot start),
  // so a long-running server does not rewrite it for no reason.
  if (!force && key === lastLanKey && fs.existsSync(APP_URL_FILE)) return;
  lastLanKey = key;
  const when = new Date().toLocaleString("en-GB");
  const lines = [
    "Barkaati Tech Inventory System",
    "==============================",
    "",
    `Computer: ${os.hostname()}`,
    `Network IP: ${lan ? lan.address : "not connected"}${lan ? ` (${lan.name})` : ""}`,
    "",
    "Open the app on a phone or another device on the same Wi-Fi:",
    lan ? `  http://${lan.address}:5173    (development client)` : "  (no network address found)",
    lan ? `  http://${lan.address}:3001    (built app / API)` : "",
    "",
    "On this laptop:",
    "  http://localhost:5173",
    "  http://localhost:3001",
    "",
    `Updated: ${when}`,
    ""
  ];

  try {
    fs.writeFileSync(APP_URL_FILE, lines.join("\n"), "utf8");
    console.log(`App address written to ${APP_URL_FILE}`);
  } catch (e) {
    console.error(`Could not write ${APP_URL_FILE}: ${e.message}`);
  }
}

app.use(cors());
app.use(compression());
app.use(express.json({ limit: BODY_LIMIT_BYTES }));

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
        return res.status(413).json({ error: tooLargeMessage(err) });
      }
      // Routes that validate their own input throw with a 4xx status. Honour it
      // so a bad upload answers 400 instead of being reported as a server fault.
      const clientStatus = Number(err?.status || err?.statusCode);
      if (clientStatus >= 400 && clientStatus < 500) {
        return res.status(clientStatus).json({ error: err.message || "Bad request" });
      }
      console.error(err);
      res.status(500).json({ error: err.message || "Internal server error" });
    });

    app.listen(PORT, () => {
      console.log(`Store Manager API running on http://localhost:${PORT} (PostgreSQL)`);
      writeAppUrlFile(true);
      // If Wi-Fi connects late or the router hands out a different lease, keep
      // the file pointed at the address the shop devices can actually reach.
      setInterval(() => writeAppUrlFile(), 120000).unref();
    });
  } catch (e) {
    console.error("Failed to start server:", e.message);
    process.exit(1);
  }
}

start();