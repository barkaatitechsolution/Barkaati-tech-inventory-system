import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { now, query, queryOne, run, transaction } from "../db/index.js";
import { SYNC_TABLES, SYNC_BY_TABLE } from "../db/syncSchema.js";

const KEY = {
  server: "sync_server_url",
  token: "sync_token",
  device: "sync_device_id",
  prefix: "sync_device_prefix",
  cursor: "sync_cursor",
  initialized: "sync_initialized",
  lastAt: "sync_last_at",
  lastError: "sync_last_error",
  deviceName: "sync_device_name"
};

const BOOLEAN_FIELDS = new Set([
  "online",
  "pf_enabled",
  "action_password_enabled",
  "online_store_enabled",
  "active",
  "is_manual"
]);

let syncing = null;
let autoTimer = null;
let eventSource = null;
let onlineHandler = null;

async function meta(key) {
  const row = await queryOne("SELECT value FROM app_meta WHERE key = ?", [key]);
  return row?.value ?? "";
}

async function setMeta(key, value) {
  await run(
    "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value == null ? "" : String(value)]
  );
}

async function setMarker(applying) {
  await setMeta("sync_applying", applying ? "1" : "0");
}

export function normalizeServerUrl(value) {
  let url = String(value || "").trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url.replace(/\/+$/, "");
}

export async function getSyncConfig() {
  const [serverUrl, token, deviceId, prefix, cursor, initialized, lastAt, lastError, deviceName] =
    await Promise.all([
      meta(KEY.server),
      meta(KEY.token),
      meta(KEY.device),
      meta(KEY.prefix),
      meta(KEY.cursor),
      meta(KEY.initialized),
      meta(KEY.lastAt),
      meta(KEY.lastError),
      meta(KEY.deviceName)
    ]);
  return {
    serverUrl,
    token,
    deviceId,
    prefix,
    cursor: Number(cursor) || 0,
    initialized: initialized === "1",
    lastAt,
    lastError,
    deviceName,
    pending: await pendingCount()
  };
}

export async function saveSyncServerUrl(url) {
  await setMeta(KEY.server, normalizeServerUrl(url));
}

async function pendingCount() {
  let pending = 0;
  for (const spec of SYNC_TABLES) {
    try {
      const row = await queryOne(`SELECT COUNT(*) AS n FROM "${spec.table}" WHERE sync_dirty = 1`);
      pending += Number(row?.n) || 0;
    } catch {
      /* table not ready */
    }
  }
  try {
    const row = await queryOne("SELECT COUNT(*) AS n FROM sync_tombstones");
    pending += Number(row?.n) || 0;
  } catch {
    /* not migrated yet */
  }
  return pending;
}

async function request(path, { method = "GET", serverUrl, token, body, timeout = 45000 } = {}) {
  const base = normalizeServerUrl(serverUrl);
  if (!base) throw new Error("Enter the shop server address first.");
  const url = `${base}${path}`;
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.request({
      url,
      method,
      headers,
      data: body,
      connectTimeout: timeout,
      readTimeout: timeout
    });
    const data = res.data;
    if (res.status >= 400) {
      throw new Error(data?.error || `Server returned ${res.status}`);
    }
    return data;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || `Server returned ${res.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export async function pairDevice({ serverUrl, code, deviceName }) {
  const data = await request("/api/sync/pair", {
    method: "POST",
    serverUrl,
    body: { code: String(code || "").trim().toUpperCase(), device_name: deviceName || "Phone" }
  });
  await setMeta(KEY.server, normalizeServerUrl(serverUrl));
  await setMeta(KEY.token, data.token);
  await setMeta(KEY.device, data.id);
  await setMeta(KEY.prefix, data.prefix);
  await setMeta(KEY.deviceName, deviceName || "Phone");
  await setMeta("device_invoice_prefix", data.prefix);
  await setMeta(KEY.cursor, "0");
  await setMeta(KEY.initialized, "0");
  await setMeta(KEY.lastError, "");
  return data;
}

export async function disconnectSync() {
  stopAutoSync();
  await setMeta(KEY.token, "");
  await setMeta(KEY.device, "");
  await setMeta(KEY.prefix, "");
  await setMeta(KEY.initialized, "0");
  await setMeta(KEY.cursor, "0");
  await setMeta(KEY.lastError, "");
}

export function syncNow(options = {}) {
  if (syncing) return syncing;
  syncing = doSync(options).finally(() => {
    syncing = null;
  });
  return syncing;
}

async function doSync({ replace = false, backupFirst = false } = {}) {
  const cfg = await getSyncConfig();
  if (!cfg.serverUrl || !cfg.token) {
    throw new Error("Pair this phone with the shop server first.");
  }
  try {
    if (replace) {
      if (backupFirst) {
        const { exportSqlFile } = await import("./backup.js");
        await exportSqlFile({ share: false });
      }
      const snap = await request("/api/sync/snapshot", {
        serverUrl: cfg.serverUrl,
        token: cfg.token,
        timeout: 120000
      });
      await applySnapshot(snap);
      await setMeta(KEY.cursor, String(snap.cursor || 0));
      await setMeta(KEY.initialized, "1");
    } else {
      if (!cfg.initialized) {
        throw new Error("Download the web data on this phone before syncing.");
      }
      await pushChanges(cfg);
      await pullChanges(cfg.serverUrl, cfg.token, cfg.cursor);
    }
    await setMeta(KEY.lastAt, now());
    await setMeta(KEY.lastError, "");
    return getSyncConfig();
  } catch (e) {
    await setMeta(KEY.lastError, e?.message || String(e));
    throw e;
  }
}

async function tableInfo(table) {
  const rows = await query(`PRAGMA table_info("${table}")`);
  return new Map(
    rows.map((r) => [
      r.name,
      { notnull: !!r.notnull, dflt: r.dflt_value, type: String(r.type || "") }
    ])
  );
}

function toLocalValue(value, col) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "boolean") value = value ? 1 : 0;
  if (typeof value === "object") value = JSON.stringify(value);
  const type = String(col?.type || "").toUpperCase();
  if (/INT/.test(type) && typeof value === "string" && /^(true|false)$/i.test(value)) {
    value = value.toLowerCase() === "true" ? 1 : 0;
  }
  if (/INT/.test(type)) {
    const n = Number(value);
    if (Number.isFinite(n)) value = n;
  } else if (/REAL|NUM|DOUBLE|FLOAT|DECIMAL/.test(type)) {
    const n = Number(value);
    if (Number.isFinite(n)) value = n;
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      const p = (n) => String(n).padStart(2, "0");
      value = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
        d.getMinutes()
      )}:${p(d.getSeconds())}`;
    }
  }
  return value;
}

async function resolveLocalId(parentTable, parentSyncId, maps) {
  if (parentSyncId == null) return null;
  let map = maps.get(parentTable);
  if (!map) {
    map = new Map();
    maps.set(parentTable, map);
  }
  if (map.has(parentSyncId)) return map.get(parentSyncId);
  const row = await queryOne(`SELECT id FROM "${parentTable}" WHERE sync_id = ?`, [parentSyncId]);
  const id = row?.id ?? null;
  map.set(parentSyncId, id);
  return id;
}

async function resolveParentSyncId(parentTable, localId, maps) {
  if (localId == null) return null;
  let map = maps.get(parentTable);
  if (!map) {
    map = new Map();
    maps.set(parentTable, map);
  }
  if (map.has(localId)) return map.get(localId);
  const row = await queryOne(`SELECT sync_id FROM "${parentTable}" WHERE id = ?`, [localId]);
  const syncId = row?.sync_id ?? null;
  map.set(localId, syncId);
  return syncId;
}

async function upsertLocal(spec, row, maps, infoCache) {
  let info = infoCache.get(spec.table);
  if (!info) {
    info = await tableInfo(spec.table);
    infoCache.set(spec.table, info);
  }
  const data = { ...row };
  for (const [field, parent] of Object.entries(spec.refs || {})) {
    if (data[field] == null) {
      data[field] = null;
      continue;
    }
    data[field] = await resolveLocalId(parent, data[field], maps);
  }

  const cols = [];
  const vals = [];
  for (const [key, value] of Object.entries(data)) {
    const col = info.get(key);
    if (!col) continue;
    let v = toLocalValue(value, col);
    if (v === undefined) continue;
    if (v === null && col.notnull) {
      if (col.dflt !== null && col.dflt !== undefined) continue;
      v = /INT|REAL|NUM|DOUBLE|FLOAT|DECIMAL/i.test(col.type) ? 0 : "";
    }
    cols.push(key);
    vals.push(v);
  }

  if (info.has("sync_base_updated_at")) {
    cols.push("sync_base_updated_at");
    vals.push(row.updated_at || null);
  }
  if (info.has("sync_dirty")) {
    cols.push("sync_dirty");
    vals.push(0);
  }
  if (spec.table === "products" && info.has("sync_base_stock")) {
    cols.push("sync_base_stock");
    vals.push(Number(row.stock) || 0);
  }
  if (info.has("updated_at") && row.updated_at && !cols.includes("updated_at")) {
    cols.push("updated_at");
    vals.push(toLocalValue(row.updated_at, info.get("updated_at")));
  }

  const key = spec.singleton ? "id" : "sync_id";
  const keyVal = spec.singleton ? 1 : row.sync_id;
  if (keyVal == null || keyVal === "") throw new Error(`Missing sync_id for ${spec.table}`);

  const existing = await queryOne(`SELECT rowid AS rid FROM "${spec.table}" WHERE ${key} = ?`, [keyVal]);
  if (existing) {
    const sets = cols.map((c) => `"${c}" = ?`).join(", ");
    await run(`UPDATE "${spec.table}" SET ${sets} WHERE ${key} = ?`, [...vals, keyVal]);
  } else {
    if (spec.singleton && !cols.includes("id")) {
      cols.unshift("id");
      vals.unshift(1);
    }
    await run(
      `INSERT INTO "${spec.table}" (${cols.map((c) => `"${c}"`).join(", ")})
       VALUES (${cols.map(() => "?").join(", ")})`,
      vals
    );
  }
}

async function applySnapshot(snap) {
  const byName = new Map((snap.tables || []).map((t) => [t.table, t.rows || []]));
  await transaction(async () => {
    await setMarker(true);
    await run("PRAGMA defer_foreign_keys = ON");
    for (const spec of [...SYNC_TABLES].reverse()) {
      await run(`DELETE FROM "${spec.table}"`);
    }
    await run("DELETE FROM sync_tombstones");
    const maps = new Map();
    const infoCache = new Map();
    for (const spec of SYNC_TABLES) {
      const rows = byName.get(spec.table);
      if (!rows?.length) continue;
      for (const row of rows) {
        await upsertLocal(spec, row, maps, infoCache);
      }
    }
    await setMarker(false);
  });
}

async function applyChanges(changes) {
  await transaction(async () => {
    await setMarker(true);
    await run("PRAGMA defer_foreign_keys = ON");
    const maps = new Map();
    const infoCache = new Map();
    for (const change of changes) {
      const spec = SYNC_BY_TABLE.get(change.table);
      if (!spec) continue;
      if (change.op === "delete") {
        const key = spec.singleton ? "id" : "sync_id";
        const keyVal = spec.singleton ? 1 : change.sync_id;
        await run(`DELETE FROM "${spec.table}" WHERE ${key} = ?`, [keyVal]);
      } else if (change.data) {
        await upsertLocal(spec, change.data, maps, infoCache);
      }
    }
    await setMarker(false);
  });
}

async function localToServer(spec, row, maps, txDelta) {
  const data = { ...row };
  delete data.id;
  delete data.sync_dirty;
  delete data.sync_base_updated_at;
  delete data.sync_base_stock;
  if (spec.table === "store_info") {
    delete data.action_password;
    delete data.action_password_enabled;
  }
  for (const [field, parent] of Object.entries(spec.refs || {})) {
    if (data[field] == null) continue;
    data[field] = await resolveParentSyncId(parent, data[field], maps);
  }
  for (const field of BOOLEAN_FIELDS) {
    if (field in data && data[field] != null) data[field] = !!Number(data[field]);
  }
  if (spec.table === "products") {
    const stock = Number(row.stock) || 0;
    const base = row.sync_base_stock == null ? null : Number(row.sync_base_stock);
    const tx = Number(txDelta.get(row.sync_id) || 0);
    if (row.sync_base_updated_at) {
      // Existing product: only send the part of the stock change that did not
      // come from a sale/purchase/return/removal in this same push. The server
      // derives those from the line rows, so sending them twice would double
      // count every offline sale.
      const residual = stock - (base || 0) - tx;
      if (Math.abs(residual) > 0.0001) data.stock_delta = residual;
      delete data.stock;
    } else {
      // New product: send the stock it had before this push's line items.
      data.stock = stock - tx;
    }
  }
  return data;
}

async function collectChanges() {
  const raw = [];
  for (const spec of SYNC_TABLES) {
    const rows = await query(`SELECT * FROM "${spec.table}" WHERE sync_dirty = 1 LIMIT 500`);
    for (const row of rows) {
      if (!row.sync_id) continue;
      raw.push({ spec, row });
      if (raw.length >= 4000) break;
    }
    if (raw.length >= 4000) break;
  }

  const txDelta = new Map();
  const productSyncCache = new Map();
  const productSyncId = async (localId) => {
    if (localId == null) return null;
    if (productSyncCache.has(localId)) return productSyncCache.get(localId);
    const p = await queryOne("SELECT sync_id FROM products WHERE id = ?", [localId]);
    const id = p?.sync_id || null;
    productSyncCache.set(localId, id);
    return id;
  };
  for (const { spec, row } of raw) {
    if (row.sync_base_updated_at) continue;
    let delta = 0;
    if (spec.table === "sale_items") delta = -Number(row.qty || 0);
    else if (spec.table === "sale_return_items") delta = Number(row.qty || 0);
    else if (spec.table === "supplier_purchase_items") delta = Number(row.quantity || 0);
    else if (spec.table === "stock_removals") delta = -Number(row.qty || 0);
    else continue;
    const id = await productSyncId(row.product_id);
    if (id) txDelta.set(id, (txDelta.get(id) || 0) + delta);
  }

  const changes = [];
  const maps = new Map();
  for (const { spec, row } of raw) {
    changes.push({
      table: spec.table,
      op: row.sync_base_updated_at ? "update" : "insert",
      sync_id: row.sync_id,
      base_updated_at: row.sync_base_updated_at || null,
      data: await localToServer(spec, row, maps, txDelta)
    });
  }

  const tombs = await query("SELECT * FROM sync_tombstones ORDER BY deleted_at LIMIT 1000");
  for (const tomb of tombs) {
    if (!SYNC_BY_TABLE.has(tomb.table_name)) continue;
    changes.push({
      table: tomb.table_name,
      op: "delete",
      sync_id: tomb.sync_id,
      base_updated_at: tomb.base_updated_at || null,
      data: null
    });
  }
  return { changes, tombstones: tombs };
}

async function pushChanges(cfg) {
  const { changes } = await collectChanges();
  if (!changes.length) return;
  const res = await request("/api/sync/push", {
    method: "POST",
    serverUrl: cfg.serverUrl,
    token: cfg.token,
    body: { changes },
    timeout: 120000
  });
  const done = new Set();
  const failedProducts = new Set();
  const lineProducts = new Set();
  let firstError = null;
  for (const result of res.results || []) {
    if (result.status === "ok" || result.status === "conflict") {
      done.add(`${result.table}:${result.sync_id}`);
    } else if (result.status === "error") {
      if (result.table === "products") failedProducts.add(result.sync_id);
      if (!firstError) firstError = result.error || `Could not sync ${result.table}`;
    }
  }
  for (const change of changes) {
    if (!done.has(`${change.table}:${change.sync_id}`)) continue;
    if (
      change.op === "insert" &&
      ["sale_items", "sale_return_items", "supplier_purchase_items", "stock_removals"].includes(
        change.table
      )
    ) {
      const productId = change.data?.product_id;
      if (productId) lineProducts.add(productId);
    }
  }

  // Clearing the dirty flag is itself an UPDATE, so it must run with the
  // sync-applying marker set or the local trigger would immediately dirty the
  // row again.
  await transaction(async () => {
    await setMarker(true);
    for (const change of changes) {
      if (!done.has(`${change.table}:${change.sync_id}`)) continue;
      if (change.op === "delete") {
        await run("DELETE FROM sync_tombstones WHERE table_name = ? AND sync_id = ?", [
          change.table,
          change.sync_id
        ]);
      } else if (change.table === "products") {
        await run(
          "UPDATE products SET sync_dirty = 0, sync_base_stock = stock WHERE sync_id = ?",
          [change.sync_id]
        );
      } else {
        await run(`UPDATE "${change.table}" SET sync_dirty = 0 WHERE sync_id = ?`, [change.sync_id]);
      }
    }
    for (const productSyncId of lineProducts) {
      if (failedProducts.has(productSyncId)) continue;
      await run("UPDATE products SET sync_base_stock = stock WHERE sync_id = ?", [productSyncId]);
    }
    await setMarker(false);
  });
  if (firstError) throw new Error(firstError);
}

async function pullChanges(serverUrl, token, startCursor) {
  let cursor = Number(startCursor) || 0;
  for (let guard = 0; guard < 1000; guard += 1) {
    const res = await request(`/api/sync/pull?cursor=${cursor}&limit=500`, {
      serverUrl,
      token,
      timeout: 120000
    });
    if (res.changes?.length) await applyChanges(res.changes);
    const next = Number(res.cursor) || cursor;
    if (next === cursor && res.hasMore) break;
    cursor = next;
    await setMeta(KEY.cursor, String(cursor));
    if (!res.hasMore) break;
  }
}

function setupEvents(cfg) {
  if (!cfg.token || !cfg.initialized) return;
  if (typeof EventSource === "undefined") return;
  // The WebView is https://localhost, so an http EventSource would be blocked
  // as mixed content. Phones on a local http server use the 30s poll instead;
  // https deployments get the live event stream.
  if (Capacitor.isNativePlatform() && cfg.serverUrl.startsWith("http://")) return;
  try {
    const url = `${cfg.serverUrl}/api/sync/events?token=${encodeURIComponent(cfg.token)}&cursor=${encodeURIComponent(cfg.cursor)}`;
    eventSource = new EventSource(url);
    eventSource.addEventListener("change", () => {
      syncNow().catch(() => {});
    });
  } catch {
    eventSource = null;
  }
}

export async function startAutoSync() {
  if (autoTimer) return;
  const cfg = await getSyncConfig();
  if (cfg.initialized && cfg.token) syncNow().catch(() => {});
  onlineHandler = () => syncNow().catch(() => {});
  window.addEventListener("online", onlineHandler);
  autoTimer = setInterval(() => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    syncNow().catch(() => {});
  }, 30000);
  setupEvents(cfg);
}

export function stopAutoSync() {
  if (autoTimer) clearInterval(autoTimer);
  autoTimer = null;
  if (onlineHandler) window.removeEventListener("online", onlineHandler);
  onlineHandler = null;
  if (eventSource) eventSource.close();
  eventSource = null;
}
