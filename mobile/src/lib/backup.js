import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { allTableRows, exportSql, importTableRows } from "./sqlBackup.js";

const FORMAT = "barkaati-offline-backup";
const VERSION = 1;

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

async function ensureCacheDir() {
  try {
    await Filesystem.mkdir({ path: "backups", directory: Directory.Cache, recursive: true });
  } catch (e) {
    if (!/already exists/i.test(e?.message || "")) throw e;
  }
}

async function walk(prefix = "") {
  const out = [];
  let listing;
  try {
    listing = await Filesystem.readdir({ path: prefix, directory: Directory.Data });
  } catch {
    return out;
  }
  for (const entry of listing.files || []) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.type === "directory") {
      out.push(...(await walk(path)));
    } else {
      out.push(path);
    }
  }
  return out;
}

async function readBase64(path) {
  const res = await Filesystem.readFile({ path, directory: Directory.Data });
  return typeof res.data === "string" ? res.data : "";
}

async function rmrf(path) {
  try {
    await Filesystem.rmdir({ path, directory: Directory.Data, recursive: true });
  } catch {
    /* not there */
  }
}

async function shareFile(path, title) {
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
  await Share.share({ title, text: title, url: uri, dialogTitle: title });
  return uri;
}

/** Full backup: every table + every uploaded image/document, as a single ZIP. */
export async function exportZipBackup() {
  const tables = await allTableRows();
  const files = await walk();
  const manifest = {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    tables,
    filePaths: files
  };
  const entries = {
    "manifest.json": strToU8(JSON.stringify(manifest))
  };
  for (const path of files) {
    const base64 = await readBase64(path);
    if (base64) entries[`files/${path}`] = strToU8(base64);
  }
  const zipped = zipSync(entries, { level: 6 });
  const name = `backups/barkaati-${stamp()}.zip`;
  await ensureCacheDir();
  await Filesystem.writeFile({
    path: name,
    data: bytesToBase64(zipped),
    directory: Directory.Cache,
    recursive: true
  });
  const uri = await shareFile(name, "Barkaati backup");
  return { uri, files: files.length, tables: Object.keys(tables).length };
}

export async function exportSqlFile({ share = true } = {}) {
  const sql = await exportSql();
  const name = `backups/barkaati-${stamp()}.sql`;
  await ensureCacheDir();
  await Filesystem.writeFile({
    path: name,
    data: bytesToBase64(strToU8(sql)),
    directory: Directory.Cache,
    recursive: true
  });
  const uri = share ? await shareFile(name, "Barkaati SQL backup") : name;
  return { uri, bytes: sql.length };
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(String(base64 || ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Restore a ZIP produced by exportZipBackup. Replaces all current data. */
export async function importZipBackup(base64) {
  let entries;
  try {
    entries = unzipSync(base64ToBytes(base64));
  } catch {
    throw new Error("That file is not a valid ZIP backup.");
  }
  const manifestBytes = entries["manifest.json"];
  if (!manifestBytes) throw new Error("The ZIP is missing its manifest.json.");
  let manifest;
  try {
    manifest = JSON.parse(strFromU8(manifestBytes));
  } catch {
    throw new Error("The ZIP manifest is unreadable.");
  }
  if (manifest.format !== FORMAT) throw new Error("That ZIP was not created by this app.");
  if (!manifest.tables) throw new Error("The backup contains no data tables.");

  const rows = await importTableRows(manifest.tables, { wipe: true });

  await rmrf("images");
  await rmrf("docs");
  let restored = 0;
  for (const [name, bytes] of Object.entries(entries)) {
    if (!name.startsWith("files/")) continue;
    const path = name.slice("files/".length);
    if (!path || path.includes("..")) continue;
    await Filesystem.writeFile({
      path,
      data: strFromU8(bytes),
      directory: Directory.Data,
      recursive: true
    });
    restored += 1;
  }
  return { rows, files: restored, exportedAt: manifest.exportedAt };
}

/** Read a file chosen with <input type="file"> as base64 (no data URL prefix). */
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.split(",").pop() : result);
    };
    reader.readAsDataURL(file);
  });
}

export function fileToText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsText(file);
  });
}
