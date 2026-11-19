import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";

const IMAGE_MIME = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp"
};

const DOC_MIME = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel.sheet.macroEnabled.12": "xlsm",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/rtf": "rtf",
  ...IMAGE_MIME
};

export const isDataUrl = (value) => /^data:[^;]+;base64,/.test(String(value || ""));
export const isRemote = (value) => /^(https?:|file:|content:|\/)/i.test(String(value || ""));

function extFor(mime) {
  return DOC_MIME[String(mime || "").toLowerCase()] || "bin";
}

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Persist a base64 data URL into app storage. Returns a relative path such as
 * "images/products/12/img-123.jpg" that is safe to store in SQLite.
 */
export async function saveDataUrl(dataUrl, folder = "images/misc") {
  if (!dataUrl) return "";
  if (!isDataUrl(dataUrl)) return dataUrl;
  const match = String(dataUrl).match(/^data:([^;]+);base64,(.*)$/s);
  if (!match) return "";
  const [, mime, base64] = match;
  const ext = extFor(mime);
  const name = `${folder}/${Date.now()}-${randomId()}.${ext}`;
  if (!Capacitor.isNativePlatform()) return dataUrl;
  await Filesystem.mkdir({ path: folder, directory: Directory.Data, recursive: true });
  await Filesystem.writeFile({
    path: name,
    data: base64,
    directory: Directory.Data,
    recursive: true
  });
  return name;
}

export async function saveBase64(base64, mime, folder = "docs", originalName = "") {
  if (!base64) return "";
  const ext = originalName.includes(".")
    ? originalName.split(".").pop().toLowerCase()
    : extFor(mime);
  const name = `${folder}/${Date.now()}-${randomId()}.${ext || "bin"}`;
  if (!Capacitor.isNativePlatform()) return name;
  await Filesystem.mkdir({ path: folder, directory: Directory.Data, recursive: true });
  await Filesystem.writeFile({
    path: name,
    data: base64,
    directory: Directory.Data,
    recursive: true
  });
  return name;
}

let dataRoot = "";

/** Cache the app data directory once at startup so URLs can resolve synchronously. */
export async function initFileRoot() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const res = await Filesystem.getUri({ path: "", directory: Directory.Data });
    dataRoot = String(res.uri || "").replace(/\/+$/, "");
  } catch {
    dataRoot = "";
  }
}

export async function clearDataFiles() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { files } = await Filesystem.readdir({ path: "", directory: Directory.Data });
    for (const entry of files || []) {
      try {
        await Filesystem.rmdir({ path: entry.name, directory: Directory.Data, recursive: true });
      } catch {}
      try {
        await Filesystem.deleteFile({ path: entry.name, directory: Directory.Data });
      } catch {}
    }
    dataRoot = "";
  } catch {}
}

/** Turn a stored relative path into a URL the WebView can display. */
export function resolveFileUrl(path) {
  if (!path) return "";
  if (isDataUrl(path) || /^https?:|^content:|^blob:/i.test(path)) return path;
  if (!Capacitor.isNativePlatform()) return path;
  try {
    const full = dataRoot ? `${dataRoot}/${String(path).replace(/^\/+/, "")}` : path;
    return Capacitor.convertFileSrc(full);
  } catch {
    return path;
  }
}

export async function fileUri(path) {
  if (!path || isDataUrl(path)) return path;
  if (!Capacitor.isNativePlatform()) return path;
  const res = await Filesystem.getUri({ path, directory: Directory.Data });
  return res.uri;
}

export async function readFileBase64(path) {
  if (!path) return null;
  if (isDataUrl(path)) {
    const m = String(path).match(/^data:[^;]+;base64,(.*)$/s);
    return m ? m[1] : null;
  }
  if (!Capacitor.isNativePlatform()) return null;
  const res = await Filesystem.readFile({ path, directory: Directory.Data });
  return typeof res.data === "string" ? res.data : null;
}

export async function deleteFile(path) {
  if (!path || isDataUrl(path) || !Capacitor.isNativePlatform()) return;
  try {
    await Filesystem.deleteFile({ path, directory: Directory.Data });
  } catch {
    /* already gone */
  }
}

export async function ensureDir(path) {
  if (!Capacitor.isNativePlatform()) return;
  await Filesystem.mkdir({ path, directory: Directory.Data, recursive: true });
}

export function mimeFromName(name) {
  const ext = String(name || "").split(".").pop()?.toLowerCase();
  return Object.entries(DOC_MIME).find(([, v]) => v === ext)?.[0] || "application/octet-stream";
}
