import { Router, raw } from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { streamSqlBackup, streamExcelBackup, readBackupFile, backupSummary, importSqlBackup, tablesReferencingMissing } from "./backup.js";
import { receipt58HTML } from "../client/src/lib/receipt.js";
import { printReceipt58 as printReceiptOnPrinter, printerName } from "./print.js";

const UPLOADS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "uploads");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const dstr = (d) => {
  if (d instanceof Date) {
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    return `${y}-${mo}-${da}`;
  }
  return String(d || "");
};
const monthKeyOf = (dateStr) => dateStr.slice(0, 7);
// Date and time the way <input type="datetime-local"> wants it back:
// "2026-10-21T18:30". A TIMESTAMP without a timezone is read back as the
// wall-clock time it was written with, so the local getters give the same
// value the shop typed in.
const dstrTime = (d) => {
  if (d instanceof Date) {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  const s = String(d || "");
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) return s.replace(" ", "T");
  return s;
};
function validThroughDate(c) {
  const s = dstr(c.start_date || c.valid_from);
  const months = Number(c.months) || 0;
  if (s && months > 0) {
    const [y, m] = s.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + months, 1));
    d.setUTCDate(0);
    return d.toISOString().slice(0, 10);
  }
  return c.end_date ? dstr(c.end_date) : null;
}
function normalizeVoucherTiers(raw, fallbackType) {
  if (raw == null) return { tiers: null };
  if (!Array.isArray(raw)) return { error: "Offers must be a list" };
  const tiers = [];
  const seen = new Set();
  for (const item of raw) {
    const min = Number(item?.min_total);
    const value = Number(item?.discount_value);
    if (!Number.isFinite(min) || min < 0) return { error: "Each offer needs a valid minimum bill" };
    if (!Number.isFinite(value) || value <= 0) return { error: "Each offer needs a discount greater than zero" };
    if (seen.has(min)) return { error: "Each offer needs a different minimum bill" };
    seen.add(min);
    const type =
      item?.discount_type === "percent"
        ? "percent"
        : item?.discount_type === "rupee"
          ? "rupee"
          : fallbackType;
    tiers.push({
      min_total: Math.round(min * 100) / 100,
      discount_type: type,
      discount_value: Math.round(value * 100) / 100
    });
  }
  tiers.sort((a, b) => a.min_total - b.min_total);
  return { tiers };
}
function voucherTierForTotal(c, total) {
  let tiers = c.tiers;
  if (typeof tiers === "string") {
    try {
      tiers = JSON.parse(tiers);
    } catch {
      tiers = [];
    }
  }
  if (Array.isArray(tiers) && tiers.length > 0) {
    let best = null;
    for (const t of tiers) {
      const min = Number(t.min_total) || 0;
      if (min > total) continue;
      if (!best || min > (Number(best.min_total) || 0)) best = t;
    }
    if (!best) return null;
    return {
      min_total: Number(best.min_total) || 0,
      discount_type:
        best.discount_type === "percent"
          ? "percent"
          : best.discount_type === "rupee"
            ? "rupee"
            : c.discount_type === "percent"
              ? "percent"
              : "rupee",
      discount_value: Number(best.discount_value) || 0
    };
  }
  const min = Number(c.min_total) || 0;
  if (min > total) return null;
  return {
    min_total: min,
    discount_type: c.discount_type === "percent" ? "percent" : "rupee",
    discount_value: Number(c.discount_value) || 0
  };
}
function publicVoucher(v, extra = {}) {
  const months = Number(v.months) || 0;
  const usesCount = extra.usesCount != null ? extra.usesCount : (v.uses ? v.uses.length : null);
  return {
    code: v.code,
    status: v.status,
    customer_name: v.customer_name || null,
    campaign_id: v.campaign_id,
    campaign_name: v.campaign_name,
    discount_type: v.discount_type,
    discount_value: Number(v.discount_value) || 0,
    min_total: Number(v.min_total) || 0,
    months,
    valid_from: extra.valid_from != null ? extra.valid_from : (dstr(v.valid_from) || null),
    valid_through: extra.valid_through != null ? extra.valid_through : validThroughDate(v),
    remaining_uses: extra.remainingUses != null ? extra.remainingUses : Math.max(0, months - (usesCount || 0)),
    used_this_month: !!extra.usedThisMonth
  };
}
async function loadVoucherUses(q, voucherId) {
  const { rows } = await q.query(
    "SELECT id, bill_id, month_key, discount_applied, used_at FROM voucher_uses WHERE voucher_id = $1 ORDER BY used_at ASC, id ASC",
    [voucherId]
  );
  return rows;
}

// Put returned stock back into the FIFO pack rows of a product. Every stock
// number the UI shows is SUM(product_packs.remaining), so crediting
// products.stock alone leaves the inventory looking unchanged. The pack a sale
// drained is normally left 'empty', so it has to be credited with its real
// pack_size, and any remainder that no existing pack can hold is booked as a
// new pack instead of being dropped.
async function restorePacks(client, { productId, packId, qty }) {
  let toRestore = Math.round((Number(qty) || 0) * 10000) / 10000;
  if (toRestore <= 0) return;

  const { rows } = await client.query(
    `SELECT id, pack_size, remaining FROM product_packs
     WHERE product_id = $1 AND remaining < pack_size
     ORDER BY (id = $2) DESC, created_at ASC, id ASC
     FOR UPDATE`,
    [productId, packId || 0]
  );

  // Mirror the sale, which drained FIFO, so the pack that was emptied is the
  // first one refilled.
  const origin = rows.find((p) => Number(p.id) === Number(packId));
  const packSize = Math.max(1, Number(origin?.pack_size) || Number(rows[0]?.pack_size) || 1);

  for (const pk of rows) {
    if (toRestore <= 0) break;
    const room = Math.max(0, Number(pk.pack_size) - Number(pk.remaining));
    if (room <= 0) continue;
    const give = Math.min(toRestore, room);
    await client.query(
      `UPDATE product_packs
       SET remaining = remaining + $1,
           status = CASE
                      WHEN remaining + $1 >= pack_size THEN 'closed'
                      WHEN status = 'empty' THEN 'open'
                      ELSE status
                    END,
           opened_at = CASE WHEN status = 'empty' THEN LOCALTIMESTAMP ELSE opened_at END
       WHERE id = $2`,
      [give, pk.id]
    );
    toRestore = Math.round((toRestore - give) * 10000) / 10000;
  }

  while (toRestore > 0) {
    const give = Math.min(toRestore, packSize);
    await client.query(
      `INSERT INTO product_packs (product_id, pack_size, remaining, status, opened_at)
       VALUES ($1, $2, $3, 'open', LOCALTIMESTAMP)`,
      [productId, packSize, give]
    );
    toRestore = Math.round((toRestore - give) * 10000) / 10000;
  }
}

// Take units out of the FIFO pack rows of a product. This is the mirror of
// restorePacks: the same packs a sale would have drained are drained here, so
// the stock on hand (SUM(product_packs.remaining)) drops by exactly the amount
// that was written off.
//
// Packs are read (and locked) in FIFO batches of only what the transaction
// needs. A big purchase can leave tens of thousands of single-unit packs; doing
// one SELECT + UPDATE per pack made a 1000-unit sale take minutes, so the whole
// batch is now drained in one statement.
async function drainProductPacks(client, { productId, qty, packId = null }) {
  const wanted = Math.round((Number(qty) || 0) * 10000) / 10000;
  if (wanted <= 0) return { drained: 0, remaining: 0, packId: packId || null };

  let remaining = wanted;
  let firstPackId = packId ? Number(packId) : null;
  let cursor = null;
  const planned = [];

  while (remaining > 0) {
    const limit = Math.max(1, Math.min(Math.ceil(remaining), 1000));
    const params = [productId];
    let where = "product_id = $1 AND status <> 'empty' AND remaining > 0";
    if (cursor) {
      params.push(cursor.created_at, cursor.id);
      where += ` AND (created_at, id) > ($2::timestamp, $3::integer)`;
    }
    params.push(limit);
    const { rows: packs } = await client.query(
      `SELECT id, remaining, created_at
       FROM product_packs
       WHERE ${where}
       ORDER BY created_at ASC, id ASC
       LIMIT $${params.length}
       FOR UPDATE`,
      params
    );
    if (packs.length === 0) break;

    for (const pack of packs) {
      if (remaining <= 0) break;
      const take = Math.min(Number(pack.remaining), remaining);
      if (take <= 0) continue;
      planned.push({ id: Number(pack.id), take });
      if (firstPackId === null) firstPackId = Number(pack.id);
      remaining = Math.round((remaining - take) * 10000) / 10000;
      cursor = pack;
    }
    if (packs.length < limit) break;
  }

  if (planned.length > 0) {
    await client.query(
      `UPDATE product_packs pp
       SET remaining = pp.remaining - batch.take,
           status = CASE
             WHEN pp.remaining - batch.take <= 0 THEN 'empty'
             WHEN pp.status = 'closed' THEN 'open'
             ELSE pp.status
           END,
           opened_at = CASE WHEN pp.status = 'closed' THEN LOCALTIMESTAMP ELSE pp.opened_at END
       FROM unnest($1::integer[], $2::numeric[]) AS batch(id, take)
       WHERE pp.id = batch.id`,
      [planned.map((p) => p.id), planned.map((p) => p.take)]
    );
  }

  // Whatever is left could not be found in any pack (a product stocked without
  // packs); the caller has already reduced products.stock for the full amount.
  return {
    drained: Math.round((wanted - remaining) * 10000) / 10000,
    remaining,
    packId: firstPackId
  };
}

async function drainPacks(client, { productId, qty }) {
  const { remaining } = await drainProductPacks(client, { productId, qty });
  return remaining;
}

// Online orders are saved as sales with status "booking" and, deliberately, do
// not touch stock: the shop accepted the request but has not actually handed
// the goods over yet. Confirming the booking is the moment stock leaves the
// shelf, so this is where the real availability check and deduction happen.
async function confirmOnlineBooking(client, saleId, { status = "paid", paid } = {}) {
  const { rows: saleRows } = await client.query(
    "SELECT * FROM sales WHERE id = $1 FOR UPDATE",
    [saleId]
  );
  const sale = saleRows[0];
  if (!sale) return { error: "Order not found", code: 404 };
  if (sale.channel !== "online") return { error: "This is not an online order", code: 400 };
  if (sale.status !== "booking") return { error: "This order has already been confirmed", code: 400 };

  const nextStatus = status || "paid";
  if (!["paid", "partial", "credit"].includes(nextStatus)) {
    return { error: "Order must be confirmed as paid, partial or credit", code: 400 };
  }

  const { rows: items } = await client.query(
    `SELECT si.product_id, si.qty, p.name, p.stock,
            COALESCE((
              SELECT SUM(pp.remaining)
              FROM product_packs pp WHERE pp.product_id = p.id
            ), 0) AS pack_stock
     FROM sale_items si
     JOIN products p ON p.id = si.product_id
     WHERE si.sale_id = $1
     ORDER BY si.id`,
    [saleId]
  );
  for (const it of items) {
    const packStock = Number(it.pack_stock) || 0;
    it.available =
      Math.round((packStock > 0 ? packStock : Number(it.stock) || 0) * 100) / 100;
  }
  const shortages = items.filter((it) => it.available < Number(it.qty));
  if (shortages.length > 0) {
    const detail = shortages
      .map((it) => `${it.name} (need ${Number(it.qty)}, have ${it.available})`)
      .join(", ");
    return { error: `Insufficient stock: ${detail}`, code: 400 };
  }

  for (const it of items) {
    await drainProductPacks(client, { productId: it.product_id, qty: it.qty });
    await client.query("UPDATE products SET stock = stock - $1 WHERE id = $2", [
      it.qty,
      it.product_id
    ]);
  }

  const total = Number(sale.total) || 0;
  const nextPaid =
    paid === undefined || paid === null
      ? nextStatus === "paid"
        ? total
        : nextStatus === "partial"
          ? Math.round(total / 2)
          : 0
      : Number(paid) || 0;

  await client.query("UPDATE sales SET status = $1, paid = $2 WHERE id = $3", [
    nextStatus,
    nextPaid,
    saleId
  ]);
  return { ok: true, status: nextStatus, paid: nextPaid };
}

function onlineOrderToClient(row) {
  const base = {
    id: row.id,
    invoice_no: row.invoice_no,
    customer: row.online_customer_name || row.customer_record_name || row.customer || "Online customer",
    customer_phone: row.online_customer_phone || "",
    delivery_type: row.online_delivery_type || "delivery",
    address: row.online_address || "",
    note: row.note || "",
    total: Number(row.total) || 0,
    paid: Number(row.paid) || 0,
    status: row.status,
    channel: row.channel,
    payment_method: row.payment_method,
    created_at: row.created_at,
    items: []
  };
  return base;
}

// A purchase used to insert one product_packs row per pack. That is fine for a
// carton of 24 bottles, but a bulk lot of 300,000,000 single units would try to
// write 300 million rows and wedge the server. Past a sensible row budget the
// lot is stored as one aggregate pack whose "pack size" is the whole purchase;
// FIFO draining, returns and stock totals keep working, but the database does
// not explode.
const MAX_PACK_ROWS = 10000;

async function insertPurchasePacks(client, { productId, purchaseId, packSize, totalQty }) {
  const size = Number(packSize) || 1;
  const total = Number(totalQty) || 0;
  if (total <= 0) return;
  const packCount = Math.ceil(total / size);
  if (packCount <= MAX_PACK_ROWS) {
    await client.query(
      `INSERT INTO product_packs (product_id, purchase_id, pack_size, remaining, status)
       SELECT $1, $2, $3, $3, 'closed'
       FROM generate_series(1, $4::integer)`,
      [productId, purchaseId, size, packCount]
    );
    return;
  }
  await client.query(
    `INSERT INTO product_packs (product_id, purchase_id, pack_size, remaining, status)
     VALUES ($1, $2, $3, $3, 'closed')`,
    [productId, purchaseId, total]
  );
}

const IMAGE_RE = /^data:image\/(png|jpe?g|webp|gif|bmp);base64,/;

function saveBillImage(dataUrl) {
  if (!dataUrl) return null;
  if (typeof dataUrl === "string" && dataUrl.startsWith("/uploads/")) return dataUrl;
  const m = typeof dataUrl === "string" ? dataUrl.match(IMAGE_RE) : null;
  if (!m) return null;
  const ext = m[1] === "jpeg" ? "jpg" : m[1];
  const buf = Buffer.from(dataUrl.slice(m[0].length), "base64");
  if (buf.length > 8 * 1024 * 1024) throw new Error("Bill image exceeds 8MB");
  const name = `bill-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${ext}`;
  fs.promises
    .writeFile(path.join(UPLOADS_DIR, name), buf)
    .catch(() => {});
  return `/uploads/${name}`;
}

function removeBillImageUrl(p) {
  if (typeof p === "string" && p.startsWith("/uploads/")) {
    try {
      fs.unlinkSync(path.join(UPLOADS_DIR, path.basename(p)));
    } catch {
      /* ignore */
    }
  }
}

function saveProductImage(productId, dataUrl) {
  if (!dataUrl) return null;
  if (typeof dataUrl === "string" && dataUrl.startsWith("/uploads/")) return dataUrl;
  const m = typeof dataUrl === "string" ? dataUrl.match(IMAGE_RE) : null;
  if (!m) return null;
  const ext = m[1] === "jpeg" ? "jpg" : m[1];
  const buf = Buffer.from(dataUrl.slice(m[0].length), "base64");
  if (buf.length > 10 * 1024 * 1024) throw new Error("Product image exceeds 10MB");
  const dir = path.join(UPLOADS_DIR, "products", String(productId));
  fs.mkdirSync(dir, { recursive: true });
  const name = `img-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${ext}`;
  fs.promises
    .writeFile(path.join(dir, name), buf)
    .catch(() => {});
  return `/uploads/products/${productId}/${name}`;
}

function removeProductImageUrl(p) {
  if (typeof p === "string" && p.startsWith("/uploads/products/")) {
    try {
      const rel = p.replace(/^\/uploads\//, "");
      fs.unlinkSync(path.join(UPLOADS_DIR, rel));
    } catch {
      /* ignore */
    }
  }
}

const DOC_MIME_RE = /^data:([a-zA-Z0-9.+\-]+\/[a-zA-Z0-9.+\-]+);base64,/;
const DOC_EXT = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel.sheet.macroEnabled.12": "xlsm",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/rtf": "rtf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp"
};

// Last-resort mapping when a client sends a generic MIME (or none) but does
// supply a filename. Keeps .docx/.xlsx working on systems where the browser
// cannot identify Office formats.
const DOC_MIME_FROM_EXT = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
  csv: "text/csv",
  txt: "text/plain",
  rtf: "application/rtf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp"
};

const mimeForUpload = (mime, name) => {
  const m = String(mime || "").toLowerCase();
  if (DOC_EXT[m]) return m;
  const ext = String(name || "").split(".").pop()?.toLowerCase() || "";
  return DOC_MIME_FROM_EXT[ext] || m;
};

function saveBusinessDoc(dataUrl) {
  if (!dataUrl) return null;
  if (typeof dataUrl === "string" && dataUrl.startsWith("/uploads/docs/")) {
    // Already uploaded (two-step flow, or an edit that keeps the existing file).
    // Read the real size back off disk so it is not recorded as 0.
    let size = 0;
    try {
      size = fs.statSync(path.join(UPLOADS_DIR, dataUrl.replace(/^\/uploads\//, ""))).size;
    } catch {
      /* ignore */
    }
    return { file_path: dataUrl, file_type: null, file_size: size, replaced: false };
  }
  const m = typeof dataUrl === "string" ? dataUrl.match(DOC_MIME_RE) : null;
  if (!m) return null;
  const mime = m[1];
  const ext = DOC_EXT[mime];
  if (!ext) throw new Error("Unsupported file type. Upload an image, PDF, Word or Excel file.");
  const buf = Buffer.from(dataUrl.slice(m[0].length), "base64");
  if (buf.length > 15 * 1024 * 1024) throw new Error("Document exceeds 15MB");
  return persistDoc(buf, mime, ext);
}

// Raw binary upload: the client streams the File directly instead of base64-encoding
// it on the main thread, which is far faster on CPU-throttled mobile devices.
async function saveBusinessDocBuffer(buf, mime, name) {
  if (!buf || !buf.length) return null;
  const resolved = mimeForUpload(mime, name);
  const ext = DOC_EXT[resolved];
  if (!ext) throw new Error("Unsupported file type. Upload an image, PDF, Word or Excel file.");
  if (buf.length > 15 * 1024 * 1024) throw new Error("Document exceeds 15MB");
  return persistDoc(buf, resolved, ext);
}

async function persistDoc(buf, mime, ext) {
  const dir = path.join(UPLOADS_DIR, "docs");
  await fs.promises.mkdir(dir, { recursive: true });
  const name = `doc-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${ext}`;
  await fs.promises.writeFile(path.join(dir, name), buf);
  return { file_path: `/uploads/docs/${name}`, file_type: mime, file_size: buf.length, replaced: false };
}

function removeBusinessDocPath(p) {
  if (typeof p === "string" && p.startsWith("/uploads/docs/")) {
    try {
      fs.unlinkSync(path.join(UPLOADS_DIR, p.replace(/^\/uploads\//, "")));
    } catch {
      /* ignore */
    }
  }
}

// Employee papers (ID proofs, contracts, bank details) were uploaded against an
// employee and deleted along with the employee record. That whole sub-feature
// went with the Employee page, so its folder helpers are gone. Any files already
// under uploads/employees/ are simply left on disk; remove that folder by hand
// if you want the disk space back.

const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Request body limits. The global limit has to stay above the largest thing the
// client can legitimately send: uploads are base64 data URLs, which inflate a
// 15MB file to roughly 20MB once encoded, so 25MB is the floor with headroom.
// The 413 handler used to answer "maximum is 15MB" no matter which limit had
// actually been exceeded -- and /backup/* raises its own limit to 80MB -- so the
// message is derived from the limit that really applied.
export const BODY_LIMIT_BYTES = 25 * 1024 * 1024;
export const IMPORT_LIMIT_BYTES = 80 * 1024 * 1024;
export const bodyLimit = (bytes) => `${bytes / (1024 * 1024)}MB`;
export const tooLargeMessage = (err) => {
  const limit = Number(err?.limit) || Number(err?.limitRaw) || 0;
  const raw = limit === Number(IMPORT_LIMIT_BYTES) || /backup|import/i.test(String(err?.path || ""))
    ? bodyLimit(IMPORT_LIMIT_BYTES)
    : bodyLimit(BODY_LIMIT_BYTES);
  return `Request too large — maximum request size is ${raw}`;
};

const MAX_PAGE_SIZE = 500;
const MAX_PRODUCT_OPTIONS = 2000;

function paging(req, fallback = 50) {
  const raw = Number(req.query.limit);
  const limit = Math.min(Math.max(Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : fallback, 1), MAX_PAGE_SIZE);
  const rawOff = Number(req.query.offset);
  const offset = Math.max(Number.isFinite(rawOff) && rawOff > 0 ? Math.trunc(rawOff) : 0, 0);
  return { limit, offset };
}

function normalizeName(s) {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function addDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function register(app, pool) {
  const router = Router();

  router.get("/health", (_req, res) => res.json({ ok: true }));

// ─── Store Info ──────────────────────────────────────────
// The shop's identity as printed on receipts, invoices, quotations and vouchers.
// Single row keyed on id = 1; camelCase in, snake_case in the database.
const STORE_INFO_FIELDS = [
  ["name", "name", ""],
  ["address", "address", ""],
  ["phone", "phone", ""],
  ["logo", "logo", ""],
  ["qrCode", "qr_code", ""],
  ["taxNo", "tax_no", ""],
  ["bankHolder", "bank_holder", ""],
  ["bankName", "bank_name", ""],
  ["bankAccountNo", "bank_account_no", ""],
  ["ifsc", "ifsc", ""],
  ["upiId", "upi_id", ""],
  ["footerText", "footer_text", ""],
  ["tagline", "tagline", ""],
  ["whatsappNumber", "whatsapp_number", ""],
  ["deliveryFee", "delivery_fee", 0],
  ["onlineStoreEnabled", "online_store_enabled", true],
  ["onlineStoreUrl", "online_store_url", ""]
];

function storeInfoToClient(row) {
  const out = {};
  for (const [key, column, fallback] of STORE_INFO_FIELDS) {
    const value = row?.[column];
    if (value === null || value === undefined) {
      out[key] = fallback;
    } else if (typeof fallback === "number") {
      out[key] = Number(value) || 0;
    } else if (typeof fallback === "boolean") {
      out[key] = value === true || value === "t" || value === "true" || value === 1;
    } else {
      out[key] = value;
    }
  }
  return out;
}

// ─── Edit / delete password ──────────────────────────────
// Stored as a scrypt hash with a random salt, never as plain text. The hash is
// deliberately left out of STORE_INFO_FIELDS so it can never reach a client
// through the normal store-info response.
function hashActionPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function checkActionPassword(password, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = crypto.scryptSync(String(password), salt, 64);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

async function actionSecurityRow(pool) {
  const { rows } = await pool.query(
    "SELECT action_password, action_password_enabled FROM store_info WHERE id = 1"
  );
  const row = rows[0] || {};
  return {
    password: row.action_password || null,
    enabled: !!row.action_password_enabled
  };
}

router.get(
  "/store-info",
  h(async (_req, res) => {
    const { rows } = await pool.query("SELECT * FROM store_info WHERE id = 1");
    res.json(storeInfoToClient(rows[0]));
  })
);

  router.put(
  "/store-info",
  h(async (req, res) => {
    const body = req.body || {};
    const toValue = (key, fallback) => {
      const v = body[key];
      if (fallback === true || fallback === false) {
        if (v === undefined || v === null) return fallback;
        return v === true || v === "true" || v === 1 || v === "1";
      }
      if (typeof fallback === "number") return Number(v) || 0;
      if (v === undefined || v === null) return "";
      return String(v);
    };
    await pool.query(
      `INSERT INTO store_info (id, name, address, phone, logo, qr_code, tax_no,
                               bank_holder, bank_name, bank_account_no, ifsc, upi_id, footer_text,
                               tagline, whatsapp_number, delivery_fee, online_store_enabled, online_store_url)
       VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
               $13, $14, $15, $16, $17)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, address = EXCLUDED.address, phone = EXCLUDED.phone,
         logo = EXCLUDED.logo, qr_code = EXCLUDED.qr_code, tax_no = EXCLUDED.tax_no,
         bank_holder = EXCLUDED.bank_holder, bank_name = EXCLUDED.bank_name,
         bank_account_no = EXCLUDED.bank_account_no, ifsc = EXCLUDED.ifsc,
         upi_id = EXCLUDED.upi_id,
         footer_text = EXCLUDED.footer_text,
         tagline = EXCLUDED.tagline, whatsapp_number = EXCLUDED.whatsapp_number,
         delivery_fee = EXCLUDED.delivery_fee, online_store_enabled = EXCLUDED.online_store_enabled,
         online_store_url = EXCLUDED.online_store_url,
         updated_at = LOCALTIMESTAMP`,
      STORE_INFO_FIELDS.map(([key, , fallback]) => toValue(key, fallback))
    );
    const { rows } = await pool.query("SELECT * FROM store_info WHERE id = 1");
    res.json(storeInfoToClient(rows[0]));
  })
);

// ─── Edit / delete password ──────────────────────────────
// The client asks whether protection is on before every update/delete, and
// verifies the password with /security/verify before letting the action run.
router.get(
  "/security",
  h(async (_req, res) => {
    const { password, enabled } = await actionSecurityRow(pool);
    res.json({ enabled: !!(password && enabled), hasPassword: !!password });
  })
);

router.post(
  "/security/verify",
  h(async (req, res) => {
    const { password: stored, enabled } = await actionSecurityRow(pool);
    if (!stored || !enabled) return res.json({ required: false, valid: true });
    const password = String(req.body?.password ?? "");
    res.json({ required: true, valid: checkActionPassword(password, stored) });
  })
);

router.put(
  "/security/password",
  h(async (req, res) => {
    const { password: stored, enabled } = await actionSecurityRow(pool);
    if (stored) {
      const current = String(req.body?.currentPassword ?? "");
      if (!checkActionPassword(current, stored)) {
        return res.status(403).json({ error: "Current password is incorrect" });
      }
    }
    const newPassword = String(req.body?.newPassword ?? "");
    if (newPassword && newPassword.length < 4) {
      return res.status(400).json({ error: "Password must be at least 4 characters" });
    }
    const value = newPassword ? hashActionPassword(newPassword) : null;
    // Setting the first password turns protection on. Changing an existing
    // password leaves the on/off switch exactly where the user left it.
    const nextEnabled = value ? (stored ? enabled : true) : false;
    await pool.query(
      `INSERT INTO store_info (id, action_password, action_password_enabled)
       VALUES (1, $1, $2)
       ON CONFLICT (id) DO UPDATE SET action_password = EXCLUDED.action_password,
                                      action_password_enabled = EXCLUDED.action_password_enabled,
                                      updated_at = LOCALTIMESTAMP`,
      [value, nextEnabled]
    );
    res.json({ enabled: !!(value && nextEnabled), hasPassword: !!value });
  })
);

router.put(
  "/security/toggle",
  h(async (req, res) => {
    const { password: stored } = await actionSecurityRow(pool);
    if (!stored) {
      return res.status(400).json({ error: "Set a password before changing protection" });
    }
    const current = String(req.body?.currentPassword ?? "");
    if (!checkActionPassword(current, stored)) {
      return res.status(403).json({ error: "Current password is incorrect" });
    }
    const enabled = req.body?.enabled === true || req.body?.enabled === "true";
    await pool.query(
      "UPDATE store_info SET action_password_enabled = $1, updated_at = LOCALTIMESTAMP WHERE id = 1",
      [enabled]
    );
    res.json({ enabled, hasPassword: true });
  })
);

// The printer is paired to the laptop that hosts this server, not to the phone
// that taps Print. The client posts the sale it is looking at and this route
// renders the same 58mm receipt the browser used to print, then queues it on the
// laptop's CUPS printer. That is what makes a phone print silently at the counter.
router.post(
  "/print/receipt",
  h(async (req, res) => {
    const body = req.body || {};
    const sale = body.sale;
    if (!sale || typeof sale !== "object" || Array.isArray(sale)) {
      return res.status(400).json({ error: "Sale data is required" });
    }
    const items = Array.isArray(body.items) ? body.items : [];
    const storeInfo =
      body.storeInfo && typeof body.storeInfo === "object" && !Array.isArray(body.storeInfo)
        ? body.storeInfo
        : {};

    const html = receipt58HTML(sale, items, storeInfo);
    try {
      const result = await printReceiptOnPrinter(html);
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(502).json({ error: `Could not print on ${printerName()}: ${e.message}` });
    }
  })
);

  router.get("/backup/sql", h(async (_req, res) => await streamSqlBackup(pool, res)));
  router.get("/backup/excel", h(async (_req, res) => await streamExcelBackup(pool, res)));

  const IMPORT_LIMIT = bodyLimit(IMPORT_LIMIT_BYTES);
  const importMode = (req) => {
    const m = String(req.get("x-import-mode") || "").toLowerCase();
    return m === "merge" ? "merge" : "replace";
  };
  const backupText = (req) => {
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || !buf.length) throw new Error("A SQL backup file is required");
    const sql = buf.toString("utf8");
    if (sql.charCodeAt(0) === 0xfeff) return sql.slice(1);
    return sql;
  };
  const badImport = (res, e) => res.status(400).json({ error: e.message });

  // Preview of an uploaded backup: which tables and how many rows, so the UI
  // can show it before anything is written.
  router.post(
    "/backup/inspect",
    raw({ type: "application/octet-stream", limit: IMPORT_LIMIT }),
    h(async (req, res) => {
      try {
        const grouped = await readBackupFile(pool, backupText(req));
        const missing = await tablesReferencingMissing(pool, [...grouped.keys()]);
        res.json({ ok: true, ...backupSummary(grouped), alsoClearedByReplace: missing });
      } catch (e) {
        badImport(res, e);
      }
    })
  );

  // Restores an uploaded backup. "replace" empties the tables the file covers,
  // "merge" only adds rows whose ids are still free. Both run in one
  // transaction, so a failure leaves the database untouched.
  router.post(
    "/backup/import",
    raw({ type: "application/octet-stream", limit: IMPORT_LIMIT }),
    h(async (req, res) => {
      const mode = importMode(req);
      try {
        const summary = await importSqlBackup(pool, backupText(req), mode);
        res.json({ ok: true, mode, ...summary });
      } catch (e) {
        badImport(res, e);
      }
    })
  );

  router.get(
    "/dashboard",
    h(async (_req, res) => {
      const day = todayStr();
      const month = day.slice(0, 8) + "01";
      const yestStr = addDays(-1);

      const [
        todaySales,
        yestSales,
        monthSales,
        monthCost,
        monthProfitRow,
        monthDiscountRow,
        monthReturnProfitRow,
        monthExpenseRow,
        stockSummary,
        outstandingRow,
        counts,
        assetsRow
      ] = await Promise.all([
        pool.query(
          "SELECT COALESCE(SUM(total),0) AS total, COALESCE(SUM(paid),0) AS paid FROM sales WHERE created_at >= $1::date AND created_at < $1::date + 1",
          [day]
        ).then((r) => r.rows[0]),
        pool.query("SELECT COALESCE(SUM(total),0) AS total FROM sales WHERE created_at >= $1::date AND created_at < $1::date + 1", [yestStr]).then((r) => r.rows[0]),
        pool.query(
          "SELECT COALESCE(SUM(total),0) AS total, COALESCE(SUM(paid),0) AS paid FROM sales WHERE created_at >= $1::date",
          [month]
        ).then((r) => r.rows[0]),
        pool.query(
          `SELECT COALESCE(SUM(si.qty * si.purchase_price),0) AS cost
           FROM sale_items si
           JOIN sales s ON s.id = si.sale_id
           WHERE s.created_at >= $1::date`,
          [month]
        ).then((r) => r.rows[0].cost),
        pool.query(
          `SELECT COALESCE(SUM(si.profit),0) AS profit
           FROM sale_items si
           JOIN sales s ON s.id = si.sale_id
           WHERE s.created_at >= $1::date`,
          [month]
        ).then((r) => r.rows[0].profit),
        pool.query(
          `SELECT COALESCE(SUM(vu.discount_applied),0) AS total
           FROM voucher_uses vu JOIN sales s ON s.id = vu.bill_id
           WHERE s.created_at >= $1::date`,
          [month]
        ).then((r) => r.rows[0].total),
        pool.query(
          `SELECT COALESCE(SUM(profit),0) AS total
           FROM sale_returns WHERE created_at >= $1::date`,
          [month]
        ).then((r) => r.rows[0].total),
        pool.query("SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE date >= $1::date", [month]).then((r) => r.rows[0].total),
        pool.query(
          `WITH pack_stock AS (
             SELECT product_id, SUM(remaining) AS total_stock
             FROM product_packs GROUP BY product_id
           ),
           latest_cost AS (
             SELECT DISTINCT ON (product_id) product_id, purchase_price
             FROM supplier_purchase_items
             ORDER BY product_id, created_at DESC
           ),
           stock AS (
             SELECT p.id, p.name, p.unit, p.reorder_level, p.selling_price,
                    COALESCE(ss.total_stock, 0) AS total_stock,
                    COALESCE(lc.purchase_price, p.purchase_price) AS cost,
                    c.name AS category
             FROM products p
             LEFT JOIN categories c ON c.id = p.category_id
             LEFT JOIN pack_stock ss ON ss.product_id = p.id
             LEFT JOIN latest_cost lc ON lc.product_id = p.id
           )
           SELECT
             COALESCE((SELECT SUM(total_stock * cost) FROM stock), 0) AS stock_value,
             COALESCE((SELECT SUM(total_stock * selling_price) FROM stock), 0) AS retail_value,
             COALESCE((
               SELECT json_agg(json_build_object(
                        'id', s.id, 'name', s.name, 'unit', s.unit,
                        'stock', s.total_stock, 'reorder_level', s.reorder_level,
                        'category', s.category, 'selling_price', s.selling_price))
               FROM (
                 SELECT * FROM stock WHERE total_stock <= reorder_level
                 ORDER BY (total_stock / (reorder_level + 0.0001)) ASC
               ) s
             ), '[]'::json) AS low_stock`
        ).then((r) => r.rows[0]),
        pool.query("SELECT COALESCE(SUM(total - paid),0) AS total FROM sales WHERE total > paid").then((r) => r.rows[0].total),
        pool
          .query(
            `SELECT (SELECT COUNT(*) FROM customers) AS customers,
                    (SELECT COUNT(*) FROM suppliers) AS suppliers,
                    (SELECT COUNT(*) FROM products) AS products,
                    (SELECT COUNT(*) FROM assets) AS assets`
          )
          .then((r) => r.rows[0]),
        pool.query("SELECT COALESCE(SUM(current_value),0) AS total FROM assets").then((r) => r.rows[0].total)
      ]);

      const last30 = [];
      for (let i = 29; i >= 0; i--) last30.push(addDays(-i));
      const winStart = last30[0];
      const winEnd = addDays(1);

      const [revenueRows, expenseRows, categorySales, topProducts, recentSales, recentExpenses] =
        await Promise.all([
          pool.query(
            `SELECT to_char(created_at::date, 'YYYY-MM-DD') AS day, SUM(total) AS revenue
             FROM sales
             WHERE created_at >= $1::date AND created_at < $2::date
             GROUP BY 1`,
            [winStart, winEnd]
          ).then((r) => r.rows),
          pool.query(
            `SELECT to_char(date::date, 'YYYY-MM-DD') AS day, SUM(amount) AS amount
             FROM expenses
             WHERE date >= $1::date AND date < $2::date
             GROUP BY 1`,
            [winStart, winEnd]
          ).then((r) => r.rows),
          pool.query(
            `SELECT COALESCE(c.name, 'Other') AS category, SUM(si.qty * si.unit_price) AS value
             FROM sale_items si
             JOIN products p ON p.id = si.product_id
             LEFT JOIN categories c ON c.id = p.category_id
             JOIN sales s ON s.id = si.sale_id
             WHERE s.created_at >= $1::date AND s.created_at < ($1::date + INTERVAL '1 month')
             GROUP BY 1 ORDER BY value DESC`,
            [month]
          ).then((r) => r.rows),
          pool.query(
            `SELECT p.name, COALESCE(c.name, 'Other') AS category, SUM(si.qty) AS qty,
                    SUM(si.qty * si.unit_price) AS revenue
             FROM sale_items si
             JOIN sales s ON s.id = si.sale_id
             JOIN products p ON p.id = si.product_id
             LEFT JOIN categories c ON c.id = p.category_id
             WHERE s.created_at >= $1::date AND s.created_at < ($1::date + INTERVAL '1 month')
             GROUP BY p.id, p.name, c.name ORDER BY qty DESC LIMIT 6`,
            [month]
          ).then((r) => r.rows.map((r2) => ({ ...r2, qty: Math.round(r2.qty), revenue: Math.round(r2.revenue) }))),
          pool.query(
            `SELECT s.id, s.invoice_no, s.total, s.status, s.payment_method, s.created_at,
                    COALESCE(cu.name, 'Walk-in') AS customer
             FROM sales s LEFT JOIN customers cu ON cu.id = s.customer_id
             ORDER BY s.created_at DESC LIMIT 8`
          ).then((r) => r.rows),
          pool.query(
            "SELECT id, category, amount, description, payment_method, date FROM expenses ORDER BY date DESC LIMIT 6"
          ).then((r) => r.rows)
        ]);

      const revMap = Object.fromEntries(revenueRows.map((r) => [r.day, r.revenue]));
      const expMap = Object.fromEntries(expenseRows.map((r) => [r.day, r.amount]));
      const revenueSeries = last30.map((d) => ({
        day: d.slice(5),
        revenue: Math.round(revMap[d] || 0),
        expenses: Math.round(expMap[d] || 0)
      }));

      res.json({
        kpis: {
          todaySales: Math.round(todaySales.total),
          todaySalesPaid: Math.round(todaySales.paid),
          yestSales: Math.round(yestSales.total),
          monthSales: Math.round(monthSales.total),
          monthProfit: Math.round((Number(monthProfitRow) || 0) - (Number(monthDiscountRow) || 0) - (Number(monthReturnProfitRow) || 0)),
          monthCost: Math.round(monthCost),
          monthExpenses: Math.round(monthExpenseRow),
          monthPaid: Math.round(monthSales.paid),
          stockValue: Math.round(stockSummary.stock_value),
          retailValue: Math.round(stockSummary.retail_value),
          lowStockCount: stockSummary.low_stock.length,
          outstanding: Math.round(outstandingRow),
          assetsValue: Math.round(assetsRow)
        },
        counts,
        lowStock: stockSummary.low_stock,
        revenueSeries,
        categorySales: categorySales.map((r) => ({ ...r, value: Math.round(r.value) })),
        topProducts,
        recentSales,
        recentExpenses
      });
    })
  );

  router.get(
    "/stats",
    h(async (req, res) => {
      const today = todayStr();
      const defFrom = today.slice(0, 8) + "01";
      const valid = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);
      let from = valid(req.query.from) ? req.query.from : defFrom;
      let to = valid(req.query.to) ? req.query.to : today;
      if (from > to) from = to;
      const p = (n) => String(n).padStart(2, "0");
      const end = new Date(Date.parse(`${to}T12:00:00`));
      end.setDate(end.getDate() + 1);
      const endExcl = `${end.getFullYear()}-${p(end.getMonth() + 1)}-${p(end.getDate())}`;

      const days = [];
      const dStart = new Date(`${from}T12:00:00`);
      const dEnd = new Date(`${to}T12:00:00`);
      for (let d = dStart; d <= dEnd; d.setDate(d.getDate() + 1)) {
        days.push(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
      }

      const [
        summary,
        costProfit,
        expensesRow,
        dailyRev,
        dailyProfit,
        dailyReturnProfit,
        dailyExp
      ] = await Promise.all([
        pool.query(
          `SELECT COALESCE(SUM(total),0) AS revenue, COALESCE(SUM(paid),0) AS paid, COUNT(*) AS orders
           FROM sales WHERE created_at >= $1::date AND created_at < $2::date`,
          [from, endExcl]
        ),
        pool.query(
          `SELECT COALESCE(SUM(si.profit),0)
                  - COALESCE((SELECT SUM(vu.discount_applied) FROM voucher_uses vu JOIN sales sv ON sv.id = vu.bill_id
                              WHERE sv.created_at >= $1::date AND sv.created_at < $2::date),0)
                  - COALESCE((SELECT SUM(r.profit) FROM sale_returns r
                              WHERE r.created_at >= $1::date AND r.created_at < $2::date),0) AS profit,
                  COALESCE(SUM(si.qty * si.purchase_price),0) AS cost
           FROM sale_items si JOIN sales s ON s.id = si.sale_id
           WHERE s.created_at >= $1::date AND s.created_at < $2::date`,
          [from, endExcl]
        ),
        pool.query(
          `SELECT COALESCE(SUM(amount),0) AS total FROM expenses
           WHERE date >= $1::date AND date < $2::date`,
          [from, endExcl]
        ),
        pool.query(
          `SELECT to_char(created_at::date, 'YYYY-MM-DD') AS day, SUM(COALESCE(total,0)) AS v
           FROM sales WHERE created_at >= $1::date AND created_at < $2::date GROUP BY 1`,
          [from, endExcl]
        ),
        pool.query(
          `SELECT day, SUM(profit) AS v FROM (
             SELECT to_char(s.created_at::date, 'YYYY-MM-DD') AS day,
                    SUM(COALESCE(si.profit,0))
                    - COALESCE((SELECT SUM(vu.discount_applied) FROM voucher_uses vu WHERE vu.bill_id = s.id),0) AS profit
             FROM sale_items si JOIN sales s ON s.id = si.sale_id
             WHERE s.created_at >= $1::date AND s.created_at < $2::date
             GROUP BY s.id, s.created_at
           ) t GROUP BY 1`,
          [from, endExcl]
        ),
        pool.query(
          `SELECT to_char(created_at::date, 'YYYY-MM-DD') AS day, SUM(COALESCE(profit,0)) AS v
           FROM sale_returns WHERE created_at >= $1::date AND created_at < $2::date GROUP BY 1`,
          [from, endExcl]
        ),
        pool.query(
          `SELECT to_char(date::date, 'YYYY-MM-DD') AS day, SUM(COALESCE(amount,0)) AS v
           FROM expenses WHERE date >= $1::date AND date < $2::date GROUP BY 1`,
          [from, endExcl]
        )
      ]);

      const mkMap = (rows) => Object.fromEntries(rows.map((r) => [r.day, Number(r.v) || 0]));
      const revMap = mkMap(dailyRev.rows);
      const profMap = mkMap(dailyProfit.rows);
      const retMap = mkMap(dailyReturnProfit.rows);
      const expMap = mkMap(dailyExp.rows);

      const series = days.map((day) => ({
        day: day.slice(5),
        revenue: Math.round(revMap[day] || 0),
        profit: Math.round((profMap[day] || 0) - (retMap[day] || 0)),
        expenses: Math.round(expMap[day] || 0)
      }));

      const revenue = Math.round(Number(summary.rows[0].revenue) || 0);
      const profit = Math.round(Number(costProfit.rows[0].profit) || 0);
      const cost = Math.round(Number(costProfit.rows[0].cost) || 0);
      const expenses = Math.round(Number(expensesRow.rows[0].total) || 0);
      const orders = Number(summary.rows[0].orders) || 0;
      const collected = Math.round(Number(summary.rows[0].paid) || 0);
      const margin = revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : 0;

      const [categorySales, topProducts] = await Promise.all([
        pool.query(
          `SELECT COALESCE(c.name, 'Other') AS category, SUM(si.qty * si.unit_price) AS value
           FROM sale_items si
           JOIN products p ON p.id = si.product_id
           LEFT JOIN categories c ON c.id = p.category_id
           JOIN sales s ON s.id = si.sale_id
           WHERE s.created_at >= $1::date AND s.created_at < $2::date
           GROUP BY 1 ORDER BY value DESC`,
          [from, endExcl]
        ).then((r) => r.rows.map((x) => ({ ...x, value: Math.round(x.value) }))),
        pool.query(
          `SELECT p.name, COALESCE(c.name, 'Other') AS category, SUM(si.qty) AS qty,
                  SUM(si.qty * si.unit_price) AS revenue
           FROM sale_items si
           JOIN sales s ON s.id = si.sale_id
           JOIN products p ON p.id = si.product_id
           LEFT JOIN categories c ON c.id = p.category_id
           WHERE s.created_at >= $1::date AND s.created_at < $2::date
           GROUP BY p.id, p.name, c.name ORDER BY qty DESC LIMIT 6`,
          [from, endExcl]
        ).then((r) => r.rows.map((x) => ({ ...x, qty: Math.round(x.qty), revenue: Math.round(x.revenue) })))
      ]);

      res.json({
        from,
        to,
        kpis: { revenue, profit, cost, expenses, orders, collected, margin },
        series,
        categorySales,
        topProducts
      });
    })
  );

  router.get(
    "/categories",
    h(async (_req, res) => {
      const { rows } = await pool.query(
        `SELECT c.*,
                COALESCE(
                  json_agg(json_build_object('id', sc.id, 'name', sc.name) ORDER BY sc.name)
                    FILTER (WHERE sc.id IS NOT NULL),
                  '[]'
                ) AS subcategories,
                (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count
         FROM categories c
         LEFT JOIN subcategories sc ON sc.category_id = c.id
         GROUP BY c.id
         ORDER BY c.name`
      );
      res.json(rows);
    })
  );

  router.post(
    "/categories",
    h(async (req, res) => {
      const b = req.body || {};
      if (!b.name) return res.status(400).json({ error: "Category name is required" });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows } = await client.query(
          "INSERT INTO categories (name, description, quality_stars) VALUES ($1,$2,$3) RETURNING id",
          [b.name, b.description || null, Number(b.quality_stars) || 0]
        );
        const id = rows[0].id;
        for (const sub of b.subcategories || []) {
          const name = (typeof sub === "string" ? sub : sub.name || "").trim();
          if (name) {
            await client.query(
              "INSERT INTO subcategories (category_id, name) VALUES ($1,$2) ON CONFLICT DO NOTHING",
              [id, name]
            );
          }
        }
        await client.query("COMMIT");
        res.status(201).json({ id });
      } catch (e) {
        await client.query("ROLLBACK");
        if (e.code === "23505") return res.status(400).json({ error: "A category with this name already exists" });
        throw e;
      } finally {
        client.release();
      }
    })
  );

  router.put(
    "/categories/:id",
    h(async (req, res) => {
      const b = req.body || {};
      if (!b.name) return res.status(400).json({ error: "Category name is required" });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query(
          "UPDATE categories SET name = $1, description = $2, quality_stars = $3 WHERE id = $4",
          [b.name, b.description || null, Number(b.quality_stars) || 0, req.params.id]
        );
        if (result.rowCount === 0) {
          await client.query("ROLLBACK");
          return res.status(404).json({ error: "Category not found" });
        }
        const keepIds = [];
        for (const sub of b.subcategories || []) {
          const name = (typeof sub === "string" ? sub : sub.name || "").trim();
          if (!name) continue;
          if (sub.id) {
            await client.query("UPDATE subcategories SET name = $1 WHERE id = $2 AND category_id = $3", [
              name, sub.id, req.params.id
            ]);
            keepIds.push(Number(sub.id));
          } else {
            const r = await client.query(
              `INSERT INTO subcategories (category_id, name) VALUES ($1,$2)
               ON CONFLICT (category_id, name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
              [req.params.id, name]
            );
            keepIds.push(r.rows[0].id);
          }
        }
        if (keepIds.length) {
          await client.query("DELETE FROM subcategories WHERE category_id = $1 AND id <> ALL($2::int[])", [
            req.params.id, keepIds
          ]);
        } else {
          await client.query("DELETE FROM subcategories WHERE category_id = $1", [req.params.id]);
        }
        await client.query("COMMIT");
        res.json({ updated: true });
      } catch (e) {
        await client.query("ROLLBACK");
        if (e.code === "23505") return res.status(400).json({ error: "A category with this name already exists" });
        throw e;
      } finally {
        client.release();
      }
    })
  );

  router.delete(
    "/categories/:id",
    h(async (req, res) => {
      const result = await pool.query("DELETE FROM categories WHERE id = $1", [req.params.id]);
      if (result.rowCount === 0) return res.status(404).json({ error: "Category not found" });
      res.json({ deleted: true });
    })
  );

  router.get(
    "/items",
    h(async (_req, res) => {
      const { rows } = await pool.query(
        `SELECT DISTINCT item_name FROM (
           SELECT name AS item_name FROM products
           UNION
           SELECT item_name FROM supplier_purchase_items
         ) t WHERE item_name IS NOT NULL AND item_name <> '' ORDER BY item_name`
      );
      res.json(rows.map((r) => r.item_name));
    })
  );

  router.get(
    "/products",
    h(async (req, res) => {
      const { limit, offset } = paging(req);
      const q = String(req.query.q || "").trim();
      const cat = req.query.category_id ? Number(req.query.category_id) || null : null;
      const price = String(req.query.price || "");

      // Build the filter clause in JS so an empty search emits no ILIKE at all.
      const params = [];
      const clauses = [];
      if (q) {
        params.push(`%${q}%`);
        const like = `$${params.length}`;
        clauses.push(
          `(p.name ILIKE ${like} OR p.sku ILIKE ${like} OR p.hsn_code ILIKE ${like}
            OR c.name ILIKE ${like} OR sc.name ILIKE ${like})`
        );
      }
      if (cat !== null) {
        params.push(cat);
        clauses.push(`p.category_id = $${params.length}`);
      }
      if (price) {
        clauses.push(
          price === "missing"
            ? "COALESCE(p.selling_price,0) <= 0"
            : "COALESCE(p.selling_price,0) > 0"
        );
      }
      const FILTERS = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const FROM = `FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN subcategories sc ON sc.id = p.subcategory_id`;
      const [{ rows: countRows }, { rows }] = await Promise.all([
        pool.query(`SELECT COUNT(*)::int AS total ${FROM} ${FILTERS}`, params),
        pool.query(
          // Resolve the page's product ids first, then aggregate child tables for
          // just those ids. Aggregating every child row and then LIMITing costs
          // ~10x more as the catalogue grows.
          `WITH page AS (
             SELECT p.id ${FROM} ${FILTERS}
             ORDER BY p.name
             LIMIT ${limit} OFFSET ${offset}
           ),
           packs AS (
             SELECT product_id,
                    SUM(remaining) AS total_stock,
                    COUNT(*) FILTER (WHERE status <> 'empty') AS open_packs,
                    COALESCE(SUM(remaining) FILTER (WHERE status <> 'empty'), 0) AS pack_remaining
             FROM product_packs
             WHERE product_id IN (SELECT id FROM page)
             GROUP BY product_id
           ),
           latest_price AS (
             SELECT DISTINCT ON (spi.product_id) spi.product_id, spi.purchase_price
             FROM supplier_purchase_items spi
             WHERE spi.product_id IN (SELECT id FROM page)
             ORDER BY spi.product_id, spi.created_at DESC
           ),
           images AS (
             SELECT pi.product_id,
                    json_agg(json_build_object('id', pi.id, 'url', pi.url)
                             ORDER BY pi.sort_order, pi.id) AS images
             FROM product_images pi
             WHERE pi.product_id IN (SELECT id FROM page)
             GROUP BY pi.product_id
           ),
           cprices AS (
             SELECT cp.product_id,
                    json_agg(json_build_object('category_id', cp.category_id,
                                               'selling_price', cp.selling_price)
                             ORDER BY cp.category_id) AS category_prices
             FROM customer_prices cp
             WHERE cp.product_id IN (SELECT id FROM page)
             GROUP BY cp.product_id
           )
           SELECT p.*, c.name AS category, sc.name AS subcategory,
                  COALESCE(latest_price.purchase_price, p.purchase_price) AS purchase_price,
                  COALESCE(packs.total_stock, 0) AS stock,
                  COALESCE(packs.total_stock, 0) * COALESCE(latest_price.purchase_price, p.purchase_price) AS stock_value,
                  COALESCE(images.images, '[]') AS images,
                  COALESCE(cprices.category_prices, '[]') AS category_prices,
                  COALESCE(packs.open_packs, 0) AS open_packs,
                  COALESCE(packs.pack_remaining, 0) AS pack_remaining
           FROM page
           JOIN products p ON p.id = page.id
           LEFT JOIN categories c ON c.id = p.category_id
           LEFT JOIN subcategories sc ON sc.id = p.subcategory_id
           LEFT JOIN packs ON packs.product_id = p.id
           LEFT JOIN latest_price ON latest_price.product_id = p.id
           LEFT JOIN images ON images.product_id = p.id
           LEFT JOIN cprices ON cprices.product_id = p.id
           ORDER BY p.name`,
          params
        )
      ]);

      res.json({ rows, total: countRows[0]?.total ?? 0 });
    })
  );

  // Lightweight full catalog for dropdowns/lookups (billing, quotations, store).
  // Distinct from /products, which is now the paginated list view.
  router.get(
    "/product-options",
    h(async (req, res) => {
      const { rows } = await pool.query(
        `WITH packs AS (
           SELECT product_id, SUM(remaining) AS total_stock
           FROM product_packs GROUP BY product_id),
         latest_price AS (
           SELECT DISTINCT ON (spi.product_id)
                  spi.product_id, spi.purchase_price, spi.tax, spi.discount,
                  COALESCE(sp.additional_charges, 0) / NULLIF(spq.total_qty, 0) AS charges_per_unit
           FROM supplier_purchase_items spi
           LEFT JOIN supplier_purchases sp ON sp.id = spi.purchase_id
           LEFT JOIN (
             SELECT purchase_id, SUM(quantity) AS total_qty
             FROM supplier_purchase_items GROUP BY purchase_id
           ) spq ON spq.purchase_id = spi.purchase_id
           WHERE COALESCE(spi.purchase_price, 0) > 0
           ORDER BY spi.product_id, spi.id DESC),
         images AS (
           SELECT pi.product_id,
                  json_agg(json_build_object('id', pi.id, 'url', pi.url)
                           ORDER BY pi.sort_order, pi.id) AS images
           FROM product_images pi GROUP BY pi.product_id),
         cprices AS (
           SELECT cp.product_id,
                  json_agg(json_build_object('category_id', cp.category_id,
                                             'selling_price', cp.selling_price)
                           ORDER BY cp.category_id) AS category_prices
           FROM customer_prices cp GROUP BY cp.product_id)
         SELECT p.id, p.name, p.sku, p.unit, p.unit_id, p.barcode,
                p.category_id, p.subcategory_id,
                p.online,
                c.name AS category,
                p.selling_price, p.market_price, p.tax, p.discount,
                p.hsn_code, p.reorder_level,
                COALESCE(latest_price.purchase_price, p.purchase_price) AS purchase_price,
                ROUND(COALESCE(
                  (latest_price.purchase_price - COALESCE(latest_price.discount, 0))
                    * (1 + COALESCE(latest_price.tax, 0) / 100.0)
                    + COALESCE(latest_price.charges_per_unit, 0),
                  p.purchase_price
                )::numeric, 2) AS purchase_cost,
                COALESCE(packs.total_stock, 0) AS stock,
                COALESCE(images.images, '[]') AS images,
                COALESCE(cprices.category_prices, '[]') AS category_prices
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         LEFT JOIN packs ON packs.product_id = p.id
         LEFT JOIN latest_price ON latest_price.product_id = p.id
         LEFT JOIN images ON images.product_id = p.id
         LEFT JOIN cprices ON cprices.product_id = p.id
         ORDER BY p.name
         LIMIT ${MAX_PRODUCT_OPTIONS}`,
        []
      );
      res.json(rows);
    })
  );

  router.get(
    "/products/:id",
    h(async (req, res) => {
      const { rows } = await pool.query(
        `SELECT p.*, c.name AS category, sc.name AS subcategory,
                COALESCE(latest_price.purchase_price, p.purchase_price) AS purchase_price,
                COALESCE(stock_sum.total_stock, 0) AS stock,
                COALESCE(images.images, '[]') AS images,
                COALESCE(cprices.category_prices, '[]') AS category_prices
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         LEFT JOIN subcategories sc ON sc.id = p.subcategory_id
         LEFT JOIN LATERAL (
           SELECT spi.purchase_price
           FROM supplier_purchase_items spi
           WHERE spi.product_id = p.id
           ORDER BY spi.created_at DESC
           LIMIT 1
         ) latest_price ON true
         LEFT JOIN LATERAL (
           SELECT COALESCE(SUM(pp.remaining), 0) AS total_stock
           FROM product_packs pp
           WHERE pp.product_id = p.id
         ) stock_sum ON true
         LEFT JOIN LATERAL (
           SELECT COALESCE(json_agg(json_build_object('id', pi.id, 'url', pi.url) ORDER BY pi.sort_order, pi.id), '[]') AS images
           FROM product_images pi
           WHERE pi.product_id = p.id
         ) images ON true
         LEFT JOIN LATERAL (
           SELECT COALESCE(json_agg(json_build_object('category_id', cp.category_id, 'selling_price', cp.selling_price) ORDER BY cp.category_id), '[]') AS category_prices
           FROM customer_prices cp
           WHERE cp.product_id = p.id
         ) cprices ON true
         WHERE p.id = $1`,
        [req.params.id]
      );
      if (rows.length === 0) return res.status(404).json({ error: "Product not found" });
      res.json(rows[0]);
    })
  );

  router.post(
    "/products",
    h(async (req, res) => {
      const b = req.body || {};
      if (!b.name || b.name.trim() === "") {
        return res.status(400).json({ error: "Product name is required" });
      }
      const name = b.name.trim();
      try {
        const { rows: existing } = await pool.query(
          `SELECT id FROM products
           WHERE lower(regexp_replace(trim(name), '\s{2,}', ' ', 'g')) = $1
           ORDER BY id LIMIT 1`,
          [normalizeName(name)]
        );
        if (existing.length > 0) {
          const id = existing[0].id;
          await pool.query(
            `UPDATE products SET
               name = $1, sku = $2, category_id = $3, subcategory_id = $4, unit = $5,
               unit_id = COALESCE($6::int, unit_id),
               selling_price = $7, reorder_level = $8,
               hsn_code = $9, discount = $10, tax = $11, expiry_date = $12, description = $13,
               market_price = $14, online = $15
             WHERE id = $16`,
            [
              name, b.sku || null, b.category_id || null, b.subcategory_id || null,
              b.unit || "pcs", b.unit_id || null,
              Number(b.selling_price) || 0, Number(b.reorder_level) || 0,
              b.hsn_code || null, Number(b.discount) || 0, Number(b.tax) || 0,
              b.expiry_date || null, b.description || null,
              Number(b.market_price) || 0, !!b.online, id
            ]
          );
          return res.json({ id, updated: true });
        }
        const { rows } = await pool.query(
          `INSERT INTO products (name, sku, category_id, subcategory_id, unit, unit_id, purchase_price, selling_price, stock, reorder_level, hsn_code, discount, tax, expiry_date, description, market_price, online)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
          [
            name, b.sku || null, b.category_id || null, b.subcategory_id || null,
            b.unit || "pcs", b.unit_id || null,
            0, Number(b.selling_price) || 0,
            0, Number(b.reorder_level) || 0,
            b.hsn_code || null, Number(b.discount) || 0, Number(b.tax) || 0,
            b.expiry_date || null, b.description || null,
            Number(b.market_price) || 0, !!b.online
          ]
        );
        res.status(201).json({ id: rows[0].id, ...b });
      } catch (e) {
        if (e.code === "23505") return res.status(400).json({ error: "A product with this SKU already exists" });
        throw e;
      }
    })
  );

  router.put(
    "/products/:id",
    h(async (req, res) => {
      const b = req.body || {};
      try {
        const result = await pool.query(
          `UPDATE products SET
             name = $1, sku = $2, category_id = $3, subcategory_id = $4, unit = $5, unit_id = $6,
             selling_price = $7, reorder_level = $8,
             hsn_code = $9, discount = $10, tax = $11, expiry_date = $12, description = $13,
             market_price = $14, online = $15
           WHERE id = $16`,
          [
            b.name, b.sku || null, b.category_id || null, b.subcategory_id || null,
            b.unit || "pcs", b.unit_id || null,
            Number(b.selling_price) || 0, Number(b.reorder_level) || 0,
            b.hsn_code || null, Number(b.discount) || 0, Number(b.tax) || 0,
            b.expiry_date || null, b.description || null,
            Number(b.market_price) || 0, !!b.online, req.params.id
          ]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: "Product not found" });
        res.json({ updated: true });
      } catch (e) {
        if (e.code === "23505") return res.status(400).json({ error: "A product with this SKU already exists" });
        throw e;
      }
    })
  );

  router.delete(
    "/products/:id",
    h(async (req, res) => {
      const { rows: imgs } = await pool.query(
        "SELECT url FROM product_images WHERE product_id = $1",
        [req.params.id]
      );
      imgs.forEach((r) => removeProductImageUrl(r.url));
      const result = await pool.query("DELETE FROM products WHERE id = $1", [req.params.id]);
      if (result.rowCount === 0) return res.status(404).json({ error: "Product not found" });
      res.json({ deleted: true });
    })
  );

  router.put(
    "/product-prices/:id",
    h(async (req, res) => {
      const b = req.body || {};
      const result = await pool.query(
        "UPDATE products SET selling_price = $1, market_price = $2 WHERE id = $3",
        [Number(b.selling_price) || 0, Number(b.market_price) || 0, req.params.id]
      );
      if (result.rowCount === 0) return res.status(404).json({ error: "Product not found" });
      res.json({ updated: true });
    })
  );

  router.post(
    "/products/:id/images",
    h(async (req, res) => {
      const b = req.body || {};
      const files = Array.isArray(b.files) ? b.files : [];
      const { rows: exists } = await pool.query("SELECT id FROM products WHERE id = $1", [req.params.id]);
      if (exists.length === 0) return res.status(404).json({ error: "Product not found" });
      const { rows: count } = await pool.query(
        "SELECT COALESCE(COUNT(*), 0)::int AS n FROM product_images WHERE product_id = $1",
        [req.params.id]
      );
      let order = count[0].n;
      const saved = [];
      for (const f of files) {
        const url = saveProductImage(req.params.id, f && (f.data_url || f.url));
        if (!url) continue;
        const { rows } = await pool.query(
          `INSERT INTO product_images (product_id, url, sort_order)
           VALUES ($1, $2, $3) RETURNING id, url, sort_order`,
          [req.params.id, url, order]
        );
        saved.push(rows[0]);
        order += 1;
      }
      res.status(201).json({ images: saved });
    })
  );

  router.delete(
    "/products/:id/images",
    h(async (req, res) => {
      const ids = Array.isArray((req.body || {}).ids) ? req.body.ids.map(Number).filter(Boolean) : [];
      if (ids.length === 0) return res.json({ deleted: 0 });
      const { rows } = await pool.query(
        `SELECT id, url FROM product_images WHERE product_id = $1 AND id = ANY($2::int[])`,
        [req.params.id, ids]
      );
      rows.forEach((r) => removeProductImageUrl(r.url));
      const { rowCount } = await pool.query(
        `DELETE FROM product_images WHERE product_id = $1 AND id = ANY($2::int[])`,
        [req.params.id, ids]
      );
      res.json({ deleted: rowCount });
    })
  );

  router.put(
    "/products/:id/images/order",
    h(async (req, res) => {
      const order = Array.isArray((req.body || {}).order) ? req.body.order.map(Number).filter(Boolean) : [];
      for (let i = 0; i < order.length; i += 1) {
        await pool.query(
          `UPDATE product_images SET sort_order = $1 WHERE id = $2 AND product_id = $3`,
          [i, order[i], req.params.id]
        );
      }
      res.json({ updated: order.length });
    })
  );

  // ─── Product Packs ──────────────────────────────────────────
  router.get(
    "/product-packs",
    h(async (req, res) => {
      const { product_id } = req.query;
      let where = "";
      const params = [];
      if (product_id) {
        params.push(product_id);
        where = ` WHERE pp.product_id = $1`;
      }
      const { rows } = await pool.query(
        `SELECT pp.*, p.name AS product_name, p.unit, p.selling_price, p.purchase_price,
                sp.purchased_at, s.name AS supplier_name
         FROM product_packs pp
         JOIN products p ON p.id = pp.product_id
         LEFT JOIN supplier_purchases sp ON sp.id = pp.purchase_id
         LEFT JOIN suppliers s ON s.id = sp.supplier_id
         ${where}
         ORDER BY pp.created_at DESC`,
        params
      );
      const stats = (
        await pool.query(
          `SELECT COUNT(*) AS total_packs,
                  COALESCE(SUM(pp.remaining), 0) AS total_stock_qty,
                  COUNT(*) FILTER (WHERE pp.status = 'open') AS open_packs,
                  COUNT(*) FILTER (WHERE pp.status = 'empty') AS empty_packs,
                  COALESCE(SUM(pp.remaining) FILTER (WHERE pp.status <> 'empty'), 0) AS available_qty
           FROM product_packs pp${where}`,
          params
        )
      ).rows[0];
      res.json({ packs: rows, stats });
    })
  );

  router.get(
    "/product-packs/:id",
    h(async (req, res) => {
      const { rows } = await pool.query(
        `SELECT pp.*, p.name AS product_name, p.unit, p.selling_price, p.purchase_price
         FROM product_packs pp
         JOIN products p ON p.id = pp.product_id
         WHERE pp.id = $1`,
        [req.params.id]
      );
      if (rows.length === 0) return res.status(404).json({ error: "Pack not found" });
      res.json(rows[0]);
    })
  );

  router.put(
    "/product-packs/:id",
    h(async (req, res) => {
      const b = req.body || {};
      const result = await pool.query(
        "UPDATE product_packs SET remaining = $1, status = $2 WHERE id = $3",
        [Number(b.remaining), b.status || "open", req.params.id]
      );
      if (result.rowCount === 0) return res.status(404).json({ error: "Pack not found" });
      res.json({ updated: true });
    })
  );

  // ─── Sales ──────────────────────────────────────────────────
  // Shared sale-detail loader used by GET /sales/:id and GET /sales/invoice/:invoice_no.
  // Each line item carries returned_qty (already-returned quantity) so the UI can
  // compute what is still eligible for return.
  async function loadSaleDetail(pool, saleId) {
    const { rows } = await pool.query(
      `SELECT s.*, COALESCE(cu.name, NULLIF(s.online_customer_name, ''), 'Walk-in') AS customer,
              COALESCE(NULLIF(s.online_customer_phone, ''), cu.phone) AS customer_phone
       FROM sales s LEFT JOIN customers cu ON cu.id = s.customer_id WHERE s.id = $1`,
      [saleId]
    );
    if (rows.length === 0) return null;
    const sale = rows[0];
    sale.items = (
      await pool.query(
        `SELECT si.*, p.name AS product_name, p.unit,
                u.short_name AS unit_name, su.short_name AS sale_unit_name,
                pp.pack_size, pp.remaining AS pack_remaining, pp.status AS pack_status,
                pr.name AS pack_supplier,
                COALESCE((SELECT SUM(sri.qty) FROM sale_return_items sri WHERE sri.sale_item_id = si.id), 0) AS returned_qty
         FROM sale_items si
         JOIN products p ON p.id = si.product_id
         LEFT JOIN measuring_units u ON u.id = si.unit_id
         LEFT JOIN measuring_units su ON su.id = si.unit_id
         LEFT JOIN product_packs pp ON pp.id = si.product_pack_id
         LEFT JOIN supplier_purchases sp ON sp.id = pp.purchase_id
         LEFT JOIN suppliers pr ON pr.id = sp.supplier_id
         WHERE si.sale_id = $1`,
        [saleId]
      )
    ).rows;
    const totals = sale.items.reduce((acc, it) => {
      acc.profit += Number(it.profit) || 0;
      return acc;
    }, { profit: 0 });
    const { rows: [vuRow] } = await pool.query(
      "SELECT COALESCE(SUM(discount_applied),0) AS d FROM voucher_uses WHERE bill_id = $1",
      [saleId]
    );
    const voucherDiscount = Number(vuRow.d) || 0;
    const { rows: [retTot] } = await pool.query(
      `SELECT COALESCE(SUM(total_refund),0) AS refunded,
              COALESCE(SUM(profit),0) AS returned_profit,
              COUNT(*) AS count
       FROM sale_returns WHERE sale_id = $1`,
      [saleId]
    );
    const returnedRefund = Number(retTot.refunded) || 0;
    const returnedProfit = Number(retTot.returned_profit) || 0;
    sale.returned_total = Math.round(returnedRefund * 100) / 100;
    sale.returned_profit = Math.round(returnedProfit * 100) / 100;
    sale.has_returns = Number(retTot.count) > 0;
    sale.total_profit = totals.profit - voucherDiscount - returnedProfit;
    sale.voucher_discount = voucherDiscount;
    const { rows: vr } = await pool.query(
      `SELECT v.id, v.code, v.status, v.customer_name, v.issued_at,
              c.id AS campaign_id, c.name AS campaign_name,
              COALESCE(v.discount_type, c.discount_type) AS discount_type,
              COALESCE(v.discount_value, c.discount_value) AS discount_value,
              COALESCE(v.min_total, c.min_total) AS min_total,
              c.months, c.start_date AS valid_from, c.end_date
       FROM vouchers v JOIN voucher_campaigns c ON c.id = v.campaign_id
       WHERE v.bill_id = $1 LIMIT 1`,
      [saleId]
    );
    if (vr[0]) {
      const v = vr[0];
      v.uses = await loadVoucherUses(pool, v.id);
      const { rows: [td] } = await pool.query("SELECT CURRENT_DATE::text AS d");
      sale.voucher = publicVoucher(v, {
        usesCount: v.uses.length,
        usedThisMonth: v.uses.some((u) => u.month_key === monthKeyOf(td.d))
      });
    } else {
      sale.voucher = null;
    }
    // The voucher this bill redeemed, if any. The edit form shows it as a
    // read-only discount so changing items does not silently drop it.
    const { rows: uv } = await pool.query(
      `SELECT v.code, c.name AS campaign_name,
              COALESCE(v.discount_type, c.discount_type) AS discount_type,
              COALESCE(v.discount_value, c.discount_value) AS discount_value,
              COALESCE(v.min_total, c.min_total) AS min_total,
              vu.discount_applied
       FROM voucher_uses vu
       JOIN vouchers v ON v.id = vu.voucher_id
       JOIN voucher_campaigns c ON c.id = v.campaign_id
       WHERE vu.bill_id = $1 LIMIT 1`,
      [saleId]
    );
    sale.used_voucher = uv[0]
      ? {
          code: uv[0].code,
          campaign_name: uv[0].campaign_name,
          discount_type: uv[0].discount_type,
          discount_value: Number(uv[0].discount_value) || 0,
          min_total: Number(uv[0].min_total) || 0,
          discount_applied: Number(uv[0].discount_applied) || 0
        }
      : null;
    return sale;
  }

  router.get(
    "/sales",
    h(async (req, res) => {
      // Scalable list: aggregates computed in single LATERAL passes (one indexed
      // scan per sale) instead of one correlated subquery per field, and the
      // result set can be trimmed to a date range via ?from=&to= (indexed).
      const from = req.query.from ? String(req.query.from).trim() : null;
      const to = req.query.to ? String(req.query.to).trim() : null;
      const params = [];
      let where = "WHERE 1=1";
      if (/^\d{4}-\d{2}-\d{2}$/.test(from || "")) {
        params.push(from);
        where += ` AND s.created_at >= $${params.length}::date`;
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(to || "")) {
        params.push(to);
        where += ` AND s.created_at < ($${params.length}::date + 1)`;
      }
      const { rows } = await pool.query(
        `SELECT s.*, COALESCE(cu.name, NULLIF(s.online_customer_name, ''), 'Walk-in') AS customer,
                COALESCE(NULLIF(s.online_customer_phone, ''), cu.phone) AS customer_phone,
                COALESCE(it.item_count, 0) AS item_count,
                COALESCE(it.profit, 0) - COALESCE(vd.discount, 0) - COALESCE(rt.profit, 0) AS profit,
                COALESCE(it.hsn_codes, '') AS hsn_codes,
                COALESCE(it.tax_rates, '') AS tax_rates,
                COALESCE(it.tax_amt, 0) AS tax_amt
         FROM sales s
         LEFT JOIN customers cu ON cu.id = s.customer_id
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int AS item_count,
                  COALESCE(SUM(si.profit),0) AS profit,
                  COALESCE(string_agg(DISTINCT si.hsn_code, ', ' ORDER BY si.hsn_code)
                            FILTER (WHERE si.hsn_code IS NOT NULL), '') AS hsn_codes,
                  COALESCE(string_agg(DISTINCT si.tax::text, ', ' ORDER BY si.tax::text)
                            FILTER (WHERE COALESCE(si.tax,0) > 0), '') AS tax_rates,
                  COALESCE(SUM(si.tax_amt),0) AS tax_amt
           FROM sale_items si WHERE si.sale_id = s.id
         ) it ON TRUE
         LEFT JOIN LATERAL (
           SELECT COALESCE(SUM(vu.discount_applied),0) AS discount
           FROM voucher_uses vu WHERE vu.bill_id = s.id
         ) vd ON TRUE
         LEFT JOIN LATERAL (
           SELECT COALESCE(SUM(r.profit),0) AS profit
           FROM sale_returns r WHERE r.sale_id = s.id
         ) rt ON TRUE
         ${where}
         ORDER BY s.created_at DESC`,
        params
      );
      res.json(rows);
    })
  );

  router.get(
    "/sales/:id",
    h(async (req, res) => {
      const sale = await loadSaleDetail(pool, req.params.id);
      if (!sale) return res.status(404).json({ error: "Sale not found" });
      res.json(sale);
    })
  );

  // ─── Online orders ───────────────────────────────────────
  // Orders placed on the public storefront are sales rows with channel =
  // "online" and status = "booking". They arrive here so the shop can confirm
  // (which checks and deducts stock) or cancel them without touching stock.
  router.get(
    "/online-orders",
    h(async (req, res) => {
      const { rows } = await pool.query(
        `SELECT s.*, c.name AS customer_record_name
         FROM sales s
         LEFT JOIN customers c ON c.id = s.customer_id
         WHERE s.channel = 'online'
         ORDER BY s.created_at DESC, s.id DESC
         LIMIT 500`
      );
      const ids = rows.map((r) => r.id);
      let itemRows = [];
      if (ids.length > 0) {
        const result = await pool.query(
          `SELECT si.*, p.name AS product_name, p.unit AS unit_name
           FROM sale_items si
           LEFT JOIN products p ON p.id = si.product_id
           WHERE si.sale_id = ANY($1::int[])
           ORDER BY si.sale_id, si.id`,
          [ids]
        );
        itemRows = result.rows;
      }
      const bySale = new Map();
      for (const item of itemRows) {
        const list = bySale.get(item.sale_id) || [];
        list.push({
          id: item.id,
          product_id: item.product_id,
          product_name: item.product_name,
          qty: Number(item.qty) || 0,
          unit: item.unit_name || "",
          unit_price: Number(item.unit_price) || 0,
          line_total: Math.round((Number(item.unit_price) || 0) * (Number(item.qty) || 0) * 100) / 100
        });
        bySale.set(item.sale_id, list);
      }
      const orders = rows.map((row) => {
        const order = onlineOrderToClient(row);
        order.items = bySale.get(row.id) || [];
        order.subtotal = Math.round(order.items.reduce((a, it) => a + it.line_total, 0) * 100) / 100;
        order.delivery_fee = Math.max(0, Math.round((order.total - order.subtotal) * 100) / 100);
        return order;
      });
      res.json({ orders });
    })
  );

  router.post(
    "/online-orders/:id/confirm",
    h(async (req, res) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await confirmOnlineBooking(client, Number(req.params.id), {
          status: req.body?.status,
          paid: req.body?.paid
        });
        if (result.error) {
          await client.query("ROLLBACK");
          return res.status(result.code || 400).json({ error: result.error });
        }
        await client.query("COMMIT");
        res.json(result);
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    })
  );

  router.post(
    "/online-orders/:id/cancel",
    h(async (req, res) => {
      const { rows } = await pool.query(
        "SELECT id, channel, status FROM sales WHERE id = $1",
        [req.params.id]
      );
      if (rows.length === 0) return res.status(404).json({ error: "Order not found" });
      if (rows[0].channel !== "online") return res.status(400).json({ error: "This is not an online order" });
      if (rows[0].status !== "booking") {
        return res.status(400).json({ error: "Only a booking can be cancelled" });
      }
      await pool.query("UPDATE sales SET status = 'cancelled', paid = 0 WHERE id = $1", [
        req.params.id
      ]);
      res.json({ ok: true, status: "cancelled" });
    })
  );

  router.post(
    "/sales",
    h(async (req, res) => {
      const b = req.body || {};
      if (!Array.isArray(b.items) || b.items.length === 0) {
        return res.status(400).json({ error: "At least one item is required" });
      }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        let total = 0;
        let totalProfit = 0;
        const validatedItems = [];
        let customerCatId = null;
        if (b.customer_id) {
          const { rows: cr } = await client.query(
            "SELECT category_id FROM customers WHERE id = $1",
            [b.customer_id]
          );
          customerCatId = cr.length ? cr[0].category_id : null;
        }
        for (const it of b.items) {
          const { rows } = await client.query(
            `SELECT COALESCE(cp.selling_price, p.selling_price) AS selling_price,
                    p.stock, p.discount, p.tax, p.hsn_code, p.market_price,
                    COALESCE(
                      (SELECT ROUND(
                          (spi.purchase_price - COALESCE(spi.discount, 0))
                          + ((spi.purchase_price - COALESCE(spi.discount, 0)) * spi.tax / 100)
                          + (COALESCE(sp.additional_charges, 0) / NULLIF(spq.total_qty, 0)),
                          2
                        )::numeric
                       FROM supplier_purchase_items spi
                       JOIN supplier_purchases sp ON sp.id = spi.purchase_id
                       LEFT JOIN (
                         SELECT purchase_id, SUM(quantity) AS total_qty
                         FROM supplier_purchase_items GROUP BY purchase_id
                       ) spq ON spq.purchase_id = spi.purchase_id
                       WHERE spi.product_id = p.id AND COALESCE(spi.purchase_price, 0) > 0
                       ORDER BY spi.id DESC LIMIT 1),
                      p.purchase_price
                    ) AS unit_cost
             FROM products p
             LEFT JOIN customer_prices cp
               ON cp.product_id = p.id AND cp.category_id = $2
             WHERE p.id = $1
             FOR UPDATE OF p`,
            [it.product_id, customerCatId]
          );
          if (rows.length === 0) throw new Error(`Product ${it.product_id} not found`);
          const qty = Number(it.qty) || 1;
          if (Number(rows[0].stock) < qty) throw new Error(`Insufficient stock for product ${it.product_id}`);
          const sp = Number(rows[0].selling_price);
          const pp = Number(rows[0].unit_cost);
          const disc = Number(rows[0].discount) || 0;
          const tax = Number(rows[0].tax) || 0;
          const taxable = Math.max(0, sp - disc);
          const unitPrice = Math.round((taxable + (taxable * tax) / 100) * 100) / 100;
          const unitProfit = Math.round((unitPrice - pp) * 100) / 100;
          const tax_amt = Math.round(taxable * (tax / 100) * qty * 100) / 100;
          total += unitPrice * qty;
          totalProfit += unitProfit * qty;
          validatedItems.push({
            ...it,
            qty,
            unit_price: unitPrice,
            market_price: Number(rows[0].market_price) || 0,
            purchase_price: pp,
            profit: unitProfit * qty,
            hsn_code: rows[0].hsn_code || null,
            tax,
            tax_amt
          });
        }

        total = Math.round(total * 100) / 100;
        totalProfit = Math.round(totalProfit * 100) / 100;

        let voucherDiscount = 0;
        let redeemed = null;
        let issue = null;

        const { rows: [tdRow] } = await client.query("SELECT CURRENT_DATE::text AS d");
        const todayStr = tdRow.d;

        if (b.voucher_code) {
          const code = String(b.voucher_code).trim();
          const { rows: vr } = await client.query(
            `SELECT v.id, v.status, v.code, v.customer_name,
                    c.id AS campaign_id, c.name AS campaign_name,
                    COALESCE(v.discount_type, c.discount_type) AS discount_type,
                    COALESCE(v.discount_value, c.discount_value) AS discount_value,
                    COALESCE(v.min_total, c.min_total) AS min_total,
                    c.months, c.start_date AS valid_from, c.end_date
             FROM vouchers v JOIN voucher_campaigns c ON c.id = v.campaign_id
             WHERE v.code = $1 FOR UPDATE OF v`,
            [code]
          );
          if (vr.length === 0) throw new Error("Invalid voucher code");
          const v = vr[0];
          v.uses = await loadVoucherUses(client, v.id);
          const from = dstr(v.valid_from);
          const through = validThroughDate(v);
          const curMonth = monthKeyOf(todayStr);
          if (v.status !== "issued") throw new Error("This voucher has already been used");
          if (from && todayStr < from) throw new Error("This voucher is not active yet");
          if (through && todayStr > through) throw new Error("This voucher has expired");
          if (v.uses.some((u) => u.month_key === curMonth)) {
            throw new Error("This voucher is already used this month — try again next month");
          }
          const minTotal = Number(v.min_total) || 0;
          if (minTotal > 0 && total < minTotal) {
            throw new Error(`Minimum shopping of Rs ${minTotal} required to use this voucher`);
          }
          if (v.uses.length >= (Number(v.months) || 0)) {
            throw new Error(`This voucher has already been used (${v.uses.length} times)`);
          }
          voucherDiscount =
            v.discount_type === "percent"
              ? Math.round((total * Number(v.discount_value)) / 100 * 100) / 100
              : Math.min(Number(v.discount_value), total);
          voucherDiscount = Math.round(voucherDiscount * 100) / 100;
          v.remainingUses = Math.max(0, (Number(v.months) || 0) - v.uses.length - 1);
          redeemed = v;
        }

        const invoiceBaseTotal = total;
        const netTotal = Math.max(0, Math.round((total - voucherDiscount) * 100) / 100);

        const { rows: campaignRows } = await client.query(
          `SELECT * FROM voucher_campaigns
           WHERE (start_date IS NULL OR start_date <= CURRENT_DATE)
             AND (end_date IS NULL OR end_date >= CURRENT_DATE)
             AND issued_count < issue_limit
           ORDER BY id ASC
           LIMIT 200 FOR UPDATE`
        );
        let pick = null;
        for (const c of campaignRows) {
          const through = validThroughDate(c);
          if (through && todayStr > through) continue;
          const tier = voucherTierForTotal(c, invoiceBaseTotal);
          if (!tier) continue;
          const minTotal = Number(tier.min_total) || 0;
          const pickMin = pick ? pick.__min : -1;
          if (
            !pick ||
            minTotal > pickMin ||
            (minTotal === pickMin && through && (!pick.__through || through < pick.__through))
          ) {
            pick = c;
            pick.__tier = tier;
            pick.__min = minTotal;
            pick.__through = through;
          }
        }
        let customerName = null;
        if (b.customer_id) {
          const { rows: cr } = await client.query("SELECT name FROM customers WHERE id = $1", [b.customer_id]);
          customerName = cr.length ? cr[0].name : null;
        }
        if (pick) {
          await client.query("UPDATE voucher_campaigns SET issued_count = issued_count + 1 WHERE id = $1", [pick.id]);
          const tier = pick.__tier;
          issue = {
            campaign_id: pick.id,
            campaign_name: pick.name,
            discount_type: tier.discount_type,
            discount_value: Number(tier.discount_value),
            min_total: Number(tier.min_total) || 0,
            months: Number(pick.months) || 0,
            valid_till: validThroughDate(pick),
            customer_name: customerName,
            sale_total: invoiceBaseTotal
          };
        }

        const { rows: [invRow] } = await client.query(
          `SELECT COALESCE(MAX(CASE WHEN invoice_no ~ '^INV-[0-9]+$' THEN SUBSTRING(invoice_no FROM 5)::INTEGER ELSE 0 END), 0) + 1 AS next_no FROM sales`
        );
        const inv = `INV-${String(invRow.next_no).padStart(4, "0")}`;
        const status = b.status || "paid";
        const paid = status === "paid" ? netTotal : status === "partial" ? Math.round(netTotal / 2) : 0;
        const { rows: saleRows } = await client.query(
          `INSERT INTO sales (invoice_no, customer_id, total, paid, status, payment_method, note)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [inv, b.customer_id || null, netTotal, paid, status, b.payment_method || "cash", b.note || null]
        );
        const saleId = saleRows[0].id;

        if (redeemed) {
          await client.query(
            `INSERT INTO voucher_uses (voucher_id, bill_id, month_key, discount_applied)
             VALUES ($1,$2,$3,$4)`,
            [redeemed.id, saleId, monthKeyOf(todayStr), voucherDiscount]
          );
          const { rows: [cnt] } = await client.query(
            "SELECT COUNT(*)::int AS c FROM voucher_uses WHERE voucher_id = $1",
            [redeemed.id]
          );
          if (cnt.c >= (Number(redeemed.months) || 0)) {
            await client.query("UPDATE vouchers SET status = 'used' WHERE id = $1", [redeemed.id]);
          }
          await client.query(
            "UPDATE voucher_campaigns SET redeemed_count = redeemed_count + 1 WHERE id = $1",
            [redeemed.campaign_id]
          );
        }

        if (issue) {
          let inserted = false;
          for (let attempt = 0; attempt < 20 && !inserted; attempt++) {
            const code = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
            try {
              await client.query(
                `INSERT INTO vouchers (campaign_id, code, status, bill_id, customer_name, sale_total, discount_type, discount_value, min_total)
                 VALUES ($1,$2,'issued',$3,$4,$5,$6,$7,$8)`,
                [
                  issue.campaign_id,
                  code,
                  saleId,
                  issue.customer_name,
                  issue.sale_total,
                  issue.discount_type,
                  issue.discount_value,
                  issue.min_total
                ]
              );
              issue.code = code;
              inserted = true;
            } catch (e) {
              if (e.code !== "23505") throw e;
            }
          }
          if (!inserted) throw new Error("Could not allocate a unique voucher code");
        }

        for (const it of validatedItems) {
          const { packId } = await drainProductPacks(client, {
            productId: it.product_id,
            qty: it.qty,
            packId: it.product_pack_id || null
          });

          await client.query(
              `INSERT INTO sale_items (sale_id, product_id, product_pack_id, qty, unit_price, market_price, unit_id, conversion_factor, purchase_price, profit, hsn_code, tax, tax_amt)
               VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,$9,$10,$11,$12)`,
              [saleId, it.product_id, packId, it.qty, it.unit_price, it.market_price, it.unit_id || null, it.purchase_price, it.profit, it.hsn_code, it.tax, it.tax_amt]
            );

          await client.query("UPDATE products SET stock = stock - $1 WHERE id = $2", [it.qty, it.product_id]);
        }

        await client.query("COMMIT");
        res.status(201).json({
          id: saleId,
          invoice_no: inv,
          total: netTotal,
          discount: voucherDiscount,
          paid,
          status,
          profit: Math.round((totalProfit - voucherDiscount) * 100) / 100,
          redeemed: redeemed
            ? {
                code: redeemed.code,
                campaign_name: redeemed.campaign_name,
                discount: voucherDiscount,
                months: Number(redeemed.months) || 0,
                remaining_uses: redeemed.remainingUses,
                valid_through: validThroughDate(redeemed)
              }
            : null,
          voucher: issue
            ? {
                code: issue.code,
                campaign_name: issue.campaign_name,
                discount_type: issue.discount_type,
                discount_value: issue.discount_value,
                min_total: issue.min_total,
                months: issue.months,
                valid_till: issue.valid_till
              }
            : null
        });
      } catch (e) {
        await client.query("ROLLBACK");
        res.status(400).json({ error: e.message });
      } finally {
        client.release();
      }
    })
  );

  router.put(
    "/sales/:id",
    h(async (req, res) => {
      const b = req.body || {};
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows: saleRows } = await client.query(
          "SELECT * FROM sales WHERE id = $1 FOR UPDATE",
          [req.params.id]
        );
        if (saleRows.length === 0) {
          await client.query("ROLLBACK");
          return res.status(404).json({ error: "Sale not found" });
        }
        const sale = saleRows[0];

        // An unconfirmed online order has no stock against it yet. Rewriting its
        // lines through the normal sale editor would put phantom stock back, so
        // it has to be confirmed or cancelled from the Online Orders page first.
        if (sale.channel === "online" && (sale.status === "booking" || sale.status === "cancelled")) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            error: "Confirm or cancel the online order before editing the sale."
          });
        }

        // A bill that has had items returned cannot have its lines rewritten:
        // the return rows point at the sale items, and the stock has already
        // been credited back. Non-item details (customer, payment, note,
        // status) can still be corrected.
        const { rows: retRows } = await client.query(
          "SELECT id FROM sale_returns WHERE sale_id = $1 LIMIT 1",
          [req.params.id]
        );
        const itemsLocked = retRows.length > 0;
        const wantsItems = Array.isArray(b.items) && !itemsLocked;

        let netTotal = Number(sale.total) || 0;

        if (wantsItems) {
          if (b.items.length === 0) {
            await client.query("ROLLBACK");
            return res.status(400).json({ error: "At least one item is required" });
          }

          // Put the old bill's stock back first, so the same product can be
          // reused in the edited bill and the stock check sees the full shelf.
          const { rows: oldItems } = await client.query(
            "SELECT product_id, qty, product_pack_id FROM sale_items WHERE sale_id = $1",
            [req.params.id]
          );
          for (const it of oldItems) {
            await client.query("UPDATE products SET stock = stock + $1 WHERE id = $2", [
              it.qty,
              it.product_id
            ]);
            await restorePacks(client, {
              productId: it.product_id,
              packId: it.product_pack_id,
              qty: it.qty
            });
          }
          await client.query("DELETE FROM sale_items WHERE sale_id = $1", [req.params.id]);

          let total = 0;
          let totalProfit = 0;
          const validatedItems = [];
          let customerCatId = null;
          if (b.customer_id) {
            const { rows: cr } = await client.query(
              "SELECT category_id FROM customers WHERE id = $1",
              [b.customer_id]
            );
            customerCatId = cr.length ? cr[0].category_id : null;
          }
          for (const it of b.items) {
            const { rows } = await client.query(
              `SELECT COALESCE(cp.selling_price, p.selling_price) AS selling_price,
                      p.stock, p.discount, p.tax, p.hsn_code, p.market_price,
                      COALESCE(
                        (SELECT ROUND(
                            (spi.purchase_price - COALESCE(spi.discount, 0))
                            + ((spi.purchase_price - COALESCE(spi.discount, 0)) * spi.tax / 100)
                            + (COALESCE(sp.additional_charges, 0) / NULLIF(spq.total_qty, 0)),
                            2
                          )::numeric
                         FROM supplier_purchase_items spi
                         JOIN supplier_purchases sp ON sp.id = spi.purchase_id
                         LEFT JOIN (
                           SELECT purchase_id, SUM(quantity) AS total_qty
                           FROM supplier_purchase_items GROUP BY purchase_id
                         ) spq ON spq.purchase_id = spi.purchase_id
                         WHERE spi.product_id = p.id AND COALESCE(spi.purchase_price, 0) > 0
                         ORDER BY spi.id DESC LIMIT 1),
                        p.purchase_price
                      ) AS unit_cost
               FROM products p
               LEFT JOIN customer_prices cp
                 ON cp.product_id = p.id AND cp.category_id = $2
               WHERE p.id = $1
               FOR UPDATE OF p`,
              [it.product_id, customerCatId]
            );
            if (rows.length === 0) throw new Error(`Product ${it.product_id} not found`);
            const qty = Number(it.qty) || 1;
            if (Number(rows[0].stock) < qty) throw new Error(`Insufficient stock for product ${it.product_id}`);
            const sp = Number(rows[0].selling_price);
            const pp = Number(rows[0].unit_cost);
            const disc = Number(rows[0].discount) || 0;
            const tax = Number(rows[0].tax) || 0;
            const taxable = Math.max(0, sp - disc);
            const unitPrice = Math.round((taxable + (taxable * tax) / 100) * 100) / 100;
            const unitProfit = Math.round((unitPrice - pp) * 100) / 100;
            const tax_amt = Math.round(taxable * (tax / 100) * qty * 100) / 100;
            total += unitPrice * qty;
            totalProfit += unitProfit * qty;
            validatedItems.push({
              ...it,
              qty,
              unit_price: unitPrice,
              market_price: Number(rows[0].market_price) || 0,
              purchase_price: pp,
              profit: unitProfit * qty,
              hsn_code: rows[0].hsn_code || null,
              tax,
              tax_amt
            });
          }

          total = Math.round(total * 100) / 100;
          totalProfit = Math.round(totalProfit * 100) / 100;

          // Keep any voucher the bill already redeemed, recalculating its
          // value against the edited total (percent offers change with it).
          let voucherDiscount = 0;
          const { rows: voucherUses } = await client.query(
            `SELECT vu.id AS use_id,
                    COALESCE(v.discount_type, c.discount_type) AS discount_type,
                    COALESCE(v.discount_value, c.discount_value) AS discount_value
             FROM voucher_uses vu
             JOIN vouchers v ON v.id = vu.voucher_id
             JOIN voucher_campaigns c ON c.id = v.campaign_id
             WHERE vu.bill_id = $1`,
            [req.params.id]
          );
          for (const vu of voucherUses) {
            const d =
              vu.discount_type === "percent"
                ? Math.round((total * Number(vu.discount_value)) / 100 * 100) / 100
                : Math.min(Number(vu.discount_value) || 0, total);
            voucherDiscount += d;
            await client.query("UPDATE voucher_uses SET discount_applied = $1 WHERE id = $2", [
              d,
              vu.use_id
            ]);
          }
          voucherDiscount = Math.min(Math.round(voucherDiscount * 100) / 100, total);
          netTotal = Math.max(0, Math.round((total - voucherDiscount) * 100) / 100);

          for (const it of validatedItems) {
            const { packId } = await drainProductPacks(client, {
              productId: it.product_id,
              qty: it.qty,
              packId: it.product_pack_id || null
            });
            await client.query(
              `INSERT INTO sale_items (sale_id, product_id, product_pack_id, qty, unit_price, market_price, unit_id, conversion_factor, purchase_price, profit, hsn_code, tax, tax_amt)
               VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,$9,$10,$11,$12)`,
              [
                req.params.id,
                it.product_id,
                packId,
                it.qty,
                it.unit_price,
                it.market_price,
                it.sale_unit_id || it.unit_id || null,
                it.purchase_price,
                it.profit,
                it.hsn_code,
                it.tax,
                it.tax_amt
              ]
            );
            await client.query("UPDATE products SET stock = stock - $1 WHERE id = $2", [
              it.qty,
              it.product_id
            ]);
          }

          // An issued voucher records the bill total it was earned on; keep it
          // in step when the bill is corrected.
          await client.query("UPDATE vouchers SET sale_total = $1 WHERE bill_id = $2", [
            total,
            req.params.id
          ]);
        }

        const status = b.status || sale.status || "paid";
        let paid = Number(sale.paid) || 0;
        if (wantsItems || b.status !== undefined) {
          if (status === "paid") {
            paid = netTotal;
          } else if (status === "partial") {
            paid =
              paid > 0 && paid < netTotal
                ? paid
                : Math.round((netTotal / 2) * 100) / 100;
          } else {
            paid = 0;
          }
        }

        await client.query(
          `UPDATE sales
           SET customer_id = $1, payment_method = $2, note = $3,
               total = $4, paid = $5, status = $6
           WHERE id = $7`,
          [
            b.customer_id || null,
            b.payment_method || sale.payment_method || "cash",
            b.note || null,
            netTotal,
            paid,
            status,
            req.params.id
          ]
        );

        await client.query("COMMIT");
        res.json({ updated: true, total: netTotal, paid, status, items_locked: itemsLocked });
      } catch (e) {
        await client.query("ROLLBACK");
        res.status(400).json({ error: e.message });
      } finally {
        client.release();
      }
    })
  );

  router.put(
    "/sales/:id/status",
    h(async (req, res) => {
      const b = req.body || {};
      const status = b.status || "paid";
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows } = await client.query(
          "SELECT id, total, channel, status FROM sales WHERE id = $1 FOR UPDATE",
          [req.params.id]
        );
        if (rows.length === 0) {
          await client.query("ROLLBACK");
          return res.status(404).json({ error: "Sale not found" });
        }
        const sale = rows[0];

        // Confirming an online booking is the point where its stock actually
        // leaves the shelf, so route it through the same guarded helper as the
        // Online Orders page.
        if (sale.channel === "online" && sale.status === "booking" && status !== "booking") {
          const result = await confirmOnlineBooking(client, sale.id, { status, paid: b.paid });
          if (result.error) {
            await client.query("ROLLBACK");
            return res.status(result.code || 400).json({ error: result.error });
          }
          await client.query("COMMIT");
          return res.json({ updated: true, status: result.status, paid: result.paid });
        }
        if (sale.channel === "online" && sale.status !== "booking" && status === "booking") {
          await client.query("ROLLBACK");
          return res.status(400).json({
            error: "A confirmed online order cannot be moved back to booking"
          });
        }

        const total = Number(sale.total);
        const paid = status === "paid" ? total : Number(b.paid) || 0;
        await client.query("UPDATE sales SET status = $1, paid = $2 WHERE id = $3", [
          status,
          paid,
          req.params.id
        ]);
        await client.query("COMMIT");
        res.json({ updated: true, status, paid });
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    })
  );

  router.delete(
    "/sales/:id",
    h(async (req, res) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // A sale with returns must not be deleted whole: its items already had
        // stock put back, so deleting the original sale would double-subtract.
        const { rows: retRows } = await client.query(
          "SELECT id FROM sale_returns WHERE sale_id = $1 LIMIT 1",
          [req.params.id]
        );
        if (retRows.length > 0) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "Cannot delete a sale that has returns" });
        }
        const { rows: saleRows } = await client.query(
          "SELECT id, channel, status FROM sales WHERE id = $1 FOR UPDATE",
          [req.params.id]
        );
        if (saleRows.length === 0) {
          await client.query("ROLLBACK");
          return res.status(404).json({ error: "Sale not found" });
        }
        const sale = saleRows[0];
        const { rows: items } = await client.query(
          "SELECT product_id, qty, product_pack_id FROM sale_items WHERE sale_id = $1",
          [req.params.id]
        );
        const result = await client.query("DELETE FROM sales WHERE id = $1", [req.params.id]);
        if (result.rowCount === 0) {
          await client.query("ROLLBACK");
          return res.status(404).json({ error: "Sale not found" });
        }
        // A booking or cancelled online order never deducted stock, so there is
        // nothing to put back for it.
        const stockWasDeducted = !(
          sale.channel === "online" && (sale.status === "booking" || sale.status === "cancelled")
        );
        if (stockWasDeducted) {
          for (const it of items) {
            await client.query("UPDATE products SET stock = stock + $1 WHERE id = $2", [it.qty, it.product_id]);
            await restorePacks(client, {
              productId: it.product_id,
              packId: it.product_pack_id,
              qty: it.qty
            });
          }
        }
        await client.query("COMMIT");
        res.json({ deleted: true });
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    })
  );

  // ─── Returns ──────────────────────────────────────────────

  // Find a bill by its invoice number and hand back its full line items (with
  // already-returned quantities) so the returns page can pick what to restock.
  router.get(
    "/sales/invoice/:invoice_no",
    h(async (req, res) => {
      const { rows } = await pool.query(
        "SELECT id FROM sales WHERE LOWER(invoice_no) = LOWER($1) LIMIT 1",
        [req.params.invoice_no]
      );
      if (rows.length === 0) return res.status(404).json({ error: "No sale found with that invoice number" });
      const sale = await loadSaleDetail(pool, rows[0].id);
      res.json(sale);
    })
  );

  router.get(
    "/returns",
    h(async (req, res) => {
      const limit = Math.min(Number(req.query.limit) || 20, 100);
      const { rows } = await pool.query(
        `SELECT r.id, r.sale_id, r.invoice_no, r.customer, r.total_refund, r.reason, r.created_at,
                (SELECT COUNT(*) FROM sale_return_items ri WHERE ri.return_id = r.id) AS item_count,
                (SELECT json_agg(json_build_object(
                          'product_name', ri.product_name, 'qty', ri.qty,
                          'unit_name', ri.unit_name, 'refund_amount', ri.refund_amount)
                       ORDER BY ri.id)
                 FROM sale_return_items ri WHERE ri.return_id = r.id) AS items
         FROM sale_returns r
         ORDER BY r.created_at DESC, r.id DESC
         LIMIT $1`,
        [limit]
      );
      res.json(rows);
    })
  );

  // Return an item (or part of it) from a bill: record the return, refund the
  // stored per-unit price (already tax-inclusive), and put the stock back into
  // both products.stock and the FIFO packs - mirroring DELETE /sales/:id.
  router.post(
    "/sales/:id/returns",
    h(async (req, res) => {
      const b = req.body || {};
      const reqItems = Array.isArray(b.items) ? b.items : [];
      if (reqItems.length === 0) return res.status(400).json({ error: "Select at least one item to return" });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows: saleRows } = await client.query(
          "SELECT id, invoice_no, customer_id FROM sales WHERE id = $1 FOR UPDATE",
          [req.params.id]
        );
        if (saleRows.length === 0) {
          await client.query("ROLLBACK");
          return res.status(404).json({ error: "Sale not found" });
        }
        const sale = saleRows[0];
        const { rows: saleItems } = await client.query(
          `SELECT si.id, si.product_id, si.product_pack_id, si.qty, si.unit_price, si.profit,
                  p.name AS product_name, p.unit AS unit, u.short_name AS unit_name
           FROM sale_items si
           JOIN products p ON p.id = si.product_id
           LEFT JOIN measuring_units u ON u.id = si.unit_id
           WHERE si.sale_id = $1`,
          [req.params.id]
        );
        const byId = new Map(saleItems.map((row) => [Number(row.id), row]));
        let totalRefund = 0;
        let profitReversed = 0;
        const rowsToInsert = [];
        for (const r of reqItems) {
          const saleItemId = Number(r.sale_item_id);
          const qty = Math.round((Number(r.qty) || 0) * 100) / 100;
          if (qty <= 0) continue;
          const it = byId.get(saleItemId);
          if (!it) throw new Error("Item does not belong to this bill");
          const { rows: [prev] } = await client.query(
            "SELECT COALESCE(SUM(qty),0) AS returned FROM sale_return_items WHERE sale_item_id = $1",
            [saleItemId]
          );
          const alreadyReturned = Number(prev.returned) || 0;
          const maxQty = Math.round((Number(it.qty) - alreadyReturned) * 100) / 100;
          if (qty > maxQty) throw new Error(`Cannot return more than ${maxQty}${it.unit_name ? ` ${it.unit_name}` : ""} of "${it.product_name}"`);
          const refund = Math.round(Number(it.unit_price) * qty * 100) / 100;
          // Reverse the margin that was earned on this item: the returned units'
          // share of the sale line's stored profit (selling price − cost).
          const unitProfit = Math.round((Number(it.profit || 0) / Math.max(Number(it.qty) || 0, 0.000001)) * 100) / 100;
          profitReversed += Math.round(unitProfit * qty * 100) / 100;
          totalRefund += refund;
          rowsToInsert.push({
            sale_item_id: saleItemId,
            product_id: it.product_id,
            product_pack_id: it.product_pack_id || null,
            product_name: it.product_name,
            unit_name: it.unit_name || it.unit || "",
            qty,
            unit_price: Number(it.unit_price),
            refund_amount: refund
          });
        }
        if (rowsToInsert.length === 0) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "Enter a quantity to return" });
        }
        totalRefund = Math.round(totalRefund * 100) / 100;
        profitReversed = Math.round(profitReversed * 100) / 100;
        const { rows: custRows } = await client.query("SELECT name FROM customers WHERE id = $1", [sale.customer_id]);
        const customerName = custRows.length ? custRows[0].name : "Walk-in";
        const { rows: [ret] } = await client.query(
          `INSERT INTO sale_returns (sale_id, invoice_no, customer, total_refund, profit, reason)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [sale.id, sale.invoice_no, customerName, totalRefund, profitReversed, b.reason || null]
        );
        for (const r of rowsToInsert) {
          await client.query(
            `INSERT INTO sale_return_items
               (return_id, sale_item_id, product_id, product_name, unit_name, qty, unit_price, refund_amount)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [ret.id, r.sale_item_id, r.product_id, r.product_name, r.unit_name, r.qty, r.unit_price, r.refund_amount]
          );
          await client.query("UPDATE products SET stock = stock + $1 WHERE id = $2", [r.qty, r.product_id]);
          await restorePacks(client, {
            productId: r.product_id,
            packId: r.product_pack_id,
            qty: r.qty
          });
        }
        await client.query("COMMIT");
        res.json({
          id: ret.id,
          sale_id: sale.id,
          invoice_no: sale.invoice_no,
          total_refund: totalRefund,
          profit_reversed: profitReversed,
          items_returned: rowsToInsert.length
        });
      } catch (e) {
        await client.query("ROLLBACK");
        res.status(400).json({ error: e.message });
      } finally {
        client.release();
      }
    })
  );

  // ─── Stock Removal (write-off) ───────────────────────────
  // Stock that leaves the shelf without being sold: broken, expired, taken
  // home by the owner, lost in the shop. The units come out of products.stock
  // and out of the FIFO packs, and every write-off is kept as a record so the
  // shop can see what went missing and why.
  const STOCK_REMOVAL_REASONS = {
    damaged: "Damaged / broken",
    expired: "Expired",
    personal: "Used personally",
    supplier: "Returned to supplier",
    loss: "Lost / stolen",
    sample: "Sample / display",
    other: "Other"
  };

  router.get(
    "/stock-removals",
    h(async (req, res) => {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const { rows } = await pool.query(
        `SELECT r.id, r.reason, r.note, r.total_qty, r.total_value, r.created_at,
                (SELECT COUNT(*) FROM stock_removal_items ri WHERE ri.removal_id = r.id) AS item_count,
                (SELECT json_agg(json_build_object(
                          'product_id', ri.product_id,
                          'product_name', ri.product_name, 'qty', ri.qty,
                          'unit_name', ri.unit_name, 'amount', ri.amount)
                       ORDER BY ri.id)
                 FROM stock_removal_items ri WHERE ri.removal_id = r.id) AS items
         FROM stock_removals r
         ORDER BY r.created_at DESC, r.id DESC
         LIMIT $1`,
        [limit]
      );
      res.json(rows);
    })
  );

  // Write stock off. Every line takes its units out of products.stock and out
  // of the FIFO packs in one transaction, so a half-finished write-off can
  // never leave the books and the shelf disagreeing.
  router.post(
    "/stock-removals",
    h(async (req, res) => {
      const b = req.body || {};
      const reason = String(b.reason || "").trim().toLowerCase();
      if (!STOCK_REMOVAL_REASONS[reason]) {
        return res.status(400).json({ error: "Pick a reason for the stock removal" });
      }
      const reqItems = Array.isArray(b.items) ? b.items : [];
      if (reqItems.length === 0) {
        return res.status(400).json({ error: "Add at least one product to remove" });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const prepared = [];
        for (const it of reqItems) {
          const productId = Number(it.product_id);
          const qty = Math.round((Number(it.qty) || 0) * 100) / 100;
          if (!productId || qty <= 0) continue;

          const { rows: pRows } = await client.query(
            "SELECT id, name, unit, stock, purchase_price FROM products WHERE id = $1 FOR UPDATE",
            [productId]
          );
          if (pRows.length === 0) throw new Error("One of the products no longer exists");
          const p = pRows[0];
          const { rows: packRows } = await client.query(
            "SELECT COALESCE(SUM(remaining), 0) AS pack_stock FROM product_packs WHERE product_id = $1",
            [productId]
          );
          const packStock = Number(packRows[0]?.pack_stock) || 0;
          // The Stock Levels page counts the packs, so that is what the shop
          // sees as "in stock". Products stocked without packs fall back to
          // the stock column.
          const available = Math.round((packStock > 0 ? packStock : Number(p.stock) || 0) * 100) / 100;
          if (qty > available) {
            throw new Error(
              `Only ${available} ${p.unit || "pcs"} of "${p.name}" left in stock`
            );
          }

          const { rows: priceRows } = await client.query(
            `SELECT purchase_price FROM supplier_purchase_items
             WHERE product_id = $1 AND COALESCE(purchase_price, 0) > 0
             ORDER BY created_at DESC, id DESC LIMIT 1`,
            [productId]
          );
          const unitCost = Number(priceRows[0]?.purchase_price) || Number(p.purchase_price) || 0;
          prepared.push({
            product_id: productId,
            product_name: p.name,
            unit_name: p.unit || "",
            qty,
            unit_cost: unitCost,
            amount: Math.round(unitCost * qty * 100) / 100
          });
        }
        if (prepared.length === 0) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "Enter a quantity to remove" });
        }

        const totalQty = Math.round(prepared.reduce((s, r) => s + r.qty, 0) * 100) / 100;
        const totalValue = Math.round(prepared.reduce((s, r) => s + r.amount, 0) * 100) / 100;
        const { rows: [removal] } = await client.query(
          `INSERT INTO stock_removals (reason, note, total_qty, total_value)
           VALUES ($1,$2,$3,$4) RETURNING id`,
          [reason, String(b.note || "").trim() || null, totalQty, totalValue]
        );
        for (const r of prepared) {
          await client.query(
            `INSERT INTO stock_removal_items
               (removal_id, product_id, product_name, unit_name, qty, unit_cost, amount)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [removal.id, r.product_id, r.product_name, r.unit_name, r.qty, r.unit_cost, r.amount]
          );
          await client.query("UPDATE products SET stock = stock - $1 WHERE id = $2", [r.qty, r.product_id]);
          await drainPacks(client, { productId: r.product_id, qty: r.qty });
        }
        await client.query("COMMIT");
        res.status(201).json({
          id: removal.id,
          reason,
          total_qty: totalQty,
          total_value: totalValue,
          items_removed: prepared.length
        });
      } catch (e) {
        await client.query("ROLLBACK");
        res.status(400).json({ error: e.message });
      } finally {
        client.release();
      }
    })
  );

  // Undo a write-off: the units go back into products.stock and into the packs
  // they were taken from, and the record is dropped. Used when stock was
  // removed by mistake.
  router.delete(
    "/stock-removals/:id",
    h(async (req, res) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows: remRows } = await client.query(
          "SELECT id FROM stock_removals WHERE id = $1 FOR UPDATE",
          [req.params.id]
        );
        if (remRows.length === 0) {
          await client.query("ROLLBACK");
          return res.status(404).json({ error: "Stock removal not found" });
        }
        const { rows: itemRows } = await client.query(
          "SELECT product_id, qty FROM stock_removal_items WHERE removal_id = $1",
          [req.params.id]
        );
        for (const it of itemRows) {
          if (!it.product_id) continue;
          await client.query("UPDATE products SET stock = stock + $1 WHERE id = $2", [it.qty, it.product_id]);
          await restorePacks(client, { productId: it.product_id, packId: null, qty: it.qty });
        }
        await client.query("DELETE FROM stock_removals WHERE id = $1", [req.params.id]);
        await client.query("COMMIT");
        res.json({ restored: true, items: itemRows.length });
      } catch (e) {
        await client.query("ROLLBACK");
        res.status(400).json({ error: e.message });
      } finally {
        client.release();
      }
    })
  );

  // ─── Customers ──────────────────────────────────────────────
  router.get(
    "/customers",
    h(async (_req, res) => {
      const { rows } = await pool.query(
        `SELECT c.*, cc.name AS category_name,
          (SELECT COUNT(*) FROM sales s WHERE s.customer_id = c.id) AS sales_count,
          (SELECT COALESCE(SUM(s.total - s.paid),0) FROM sales s WHERE s.customer_id = c.id) AS balance
         FROM customers c
         LEFT JOIN customer_categories cc ON cc.id = c.category_id
         ORDER BY c.name`
      );
      res.json(rows);
    })
  );

  router.post(
    "/customers",
    h(async (req, res) => {
      const b = req.body || {};
      if (!b.name) return res.status(400).json({ error: "name is required" });
      const { rows } = await pool.query(
        "INSERT INTO customers (name, phone, email, address, credit_limit, category_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
        [b.name, b.phone || null, b.email || null, b.address || null, Number(b.credit_limit) || 0, b.category_id || null]
      );
      res.status(201).json({ id: rows[0].id, ...b });
    })
  );

  router.put(
    "/customers/:id",
    h(async (req, res) => {
      const b = req.body || {};
      const result = await pool.query(
        "UPDATE customers SET name = $1, phone = $2, email = $3, address = $4, credit_limit = $5, category_id = $6 WHERE id = $7",
        [b.name, b.phone, b.email, b.address, Number(b.credit_limit) || 0, b.category_id || null, req.params.id]
      );
      if (result.rowCount === 0) return res.status(404).json({ error: "Customer not found" });
      res.json({ updated: true });
    })
  );

  router.delete(
    "/customers/:id",
    h(async (req, res) => {
      const result = await pool.query("DELETE FROM customers WHERE id = $1", [req.params.id]);
      if (result.rowCount === 0) return res.status(404).json({ error: "Customer not found" });
      res.json({ deleted: true });
    })
  );

  // ─── Customer Payments ─────────────────────────────────────
  // Money the customer hands over against a bill. A bill can be settled in
  // parts: every part payment is kept in customer_payments and the bill's
  // paid amount and status follow along, so the customer balance on the
  // Customers page and the reminders badge always match the ledger.
  router.get(
    "/customer-payments",
    h(async (req, res) => {
      const limit = Math.min(Number(req.query.limit) || 100, 1000);
      const customerId = req.query.customer_id ? Number(req.query.customer_id) || null : null;
      const params = [];
      let where = "WHERE NOT EXISTS (SELECT 1 FROM sales s WHERE s.id = cp.sale_id AND s.total <= s.paid)";
      if (customerId) {
        params.push(customerId);
        where += ` AND cp.customer_id = $${params.length}`;
      }
      params.push(limit);
      const { rows } = await pool.query(
        `SELECT cp.*, c.name AS customer_name, c.phone AS customer_phone
         FROM customer_payments cp
         LEFT JOIN customers c ON c.id = cp.customer_id
         ${where}
         ORDER BY COALESCE(cp.paid_on, cp.created_at::date) DESC, cp.id DESC
         LIMIT $${params.length}`,
        params
      );
      res.json(rows);
    })
  );

  // The bills a customer still owes money on, oldest first -- the order the
  // money is normally collected in.
  router.get(
    "/customer-bills",
    h(async (req, res) => {
      const customerId = Number(req.query.customer_id) || null;
      const params = [];
      let where = "WHERE s.total > s.paid";
      if (customerId) {
        params.push(customerId);
        where += ` AND s.customer_id = $${params.length}`;
      }
      const { rows } = await pool.query(
        `SELECT s.id, s.invoice_no, s.customer_id, s.total, s.paid, s.status,
                s.payment_method, s.created_at,
                (s.total - s.paid) AS due,
                COALESCE(c.name, 'Walk-in') AS customer,
                (SELECT COALESCE(SUM(cp.amount), 0) FROM customer_payments cp WHERE cp.sale_id = s.id) AS received
         FROM sales s
         LEFT JOIN customers c ON c.id = s.customer_id
         ${where}
         ORDER BY s.created_at ASC, s.id ASC`,
        params
      );
      res.json(rows);
    })
  );

  router.get(
    "/customer-bills/completed",
    h(async (req, res) => {
      const customerId = Number(req.query.customer_id) || null;
      const params = [];
      let where = "WHERE s.total <= s.paid AND s.paid > 0";
      if (customerId) {
        params.push(customerId);
        where += ` AND s.customer_id = $${params.length}`;
      }
      const { rows } = await pool.query(
        `SELECT s.id, s.invoice_no, s.customer_id, s.total, s.paid, s.status,
                s.payment_method, s.created_at,
                0 AS due,
                COALESCE(c.name, 'Walk-in') AS customer,
                c.phone AS customer_phone,
                (SELECT COALESCE(SUM(cp.amount), 0) FROM customer_payments cp WHERE cp.sale_id = s.id) AS received,
                COALESCE((SELECT json_agg(json_build_object('id', cp.id, 'amount', cp.amount, 'method', cp.method, 'paid_on', cp.paid_on, 'note', cp.note, 'created_at', cp.created_at) ORDER BY cp.created_at ASC, cp.id ASC) FROM customer_payments cp WHERE cp.sale_id = s.id), '[]'::json) AS payments
         FROM sales s
         LEFT JOIN customers c ON c.id = s.customer_id
         ${where}
         ORDER BY s.created_at DESC, s.id DESC`,
        params
      );
      res.json(rows);
    })
  );

  router.post(
    "/customer-payments",
    h(async (req, res) => {
      const b = req.body || {};
      const saleId = Number(b.sale_id);
      const amount = Math.round((Number(b.amount) || 0) * 100) / 100;
      if (!saleId) return res.status(400).json({ error: "Pick a bill to pay" });
      if (!(amount > 0)) return res.status(400).json({ error: "Enter the amount received" });

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows: saleRows } = await client.query(
          `SELECT s.id, s.invoice_no, s.customer_id, s.total, s.paid,
                  COALESCE(c.name, 'Walk-in') AS customer
           FROM sales s
           LEFT JOIN customers c ON c.id = s.customer_id
           WHERE s.id = $1
           FOR UPDATE OF s`,
          [saleId]
        );
        if (saleRows.length === 0) {
          await client.query("ROLLBACK");
          return res.status(404).json({ error: "Bill not found" });
        }
        const sale = saleRows[0];
        const total = Number(sale.total) || 0;
        const paid = Number(sale.paid) || 0;
        const due = Math.round((total - paid) * 100) / 100;
        if (due <= 0) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "This bill is already fully paid" });
        }
        if (amount > due) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: `Only ${due} is still due on this bill` });
        }

        const newPaid = Math.round((paid + amount) * 100) / 100;
        const status = newPaid >= total ? "paid" : newPaid > 0 ? "partial" : "credit";
        await client.query("UPDATE sales SET paid = $1, status = $2 WHERE id = $3", [newPaid, status, saleId]);
        const { rows: [payment] } = await client.query(
          `INSERT INTO customer_payments
             (sale_id, customer_id, invoice_no, customer, amount, method, paid_on, note)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           RETURNING id, created_at`,
          [
            saleId,
            sale.customer_id || null,
            sale.invoice_no,
            sale.customer,
            amount,
            String(b.method || "cash").trim().toLowerCase(),
            b.paid_on || null,
            String(b.note || "").trim() || null
          ]
        );
        await client.query("COMMIT");
        res.status(201).json({
          id: payment.id,
          sale_id: saleId,
          invoice_no: sale.invoice_no,
          customer: sale.customer,
          amount,
          paid: newPaid,
          due: Math.round((total - newPaid) * 100) / 100,
          status
        });
      } catch (e) {
        await client.query("ROLLBACK");
        res.status(400).json({ error: e.message });
      } finally {
        client.release();
      }
    })
  );

  // Undo a payment that was entered by mistake: the bill goes back to what it
  // was before the money was counted in.
  router.delete(
    "/customer-payments/:id",
    h(async (req, res) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows: payRows } = await client.query(
          "SELECT id, sale_id, amount FROM customer_payments WHERE id = $1 FOR UPDATE",
          [req.params.id]
        );
        if (payRows.length === 0) {
          await client.query("ROLLBACK");
          return res.status(404).json({ error: "Payment not found" });
        }
        const pay = payRows[0];
        if (pay.sale_id) {
          const { rows: saleRows } = await client.query(
            "SELECT id, total, paid FROM sales WHERE id = $1 FOR UPDATE",
            [pay.sale_id]
          );
          if (saleRows.length) {
            const total = Number(saleRows[0].total) || 0;
            const paid = Math.max(
              0,
              Math.round(((Number(saleRows[0].paid) || 0) - (Number(pay.amount) || 0)) * 100) / 100
            );
            const status = paid >= total ? "paid" : paid > 0 ? "partial" : "credit";
            await client.query("UPDATE sales SET paid = $1, status = $2 WHERE id = $3", [
              paid,
              status,
              pay.sale_id
            ]);
          }
        }
        await client.query("DELETE FROM customer_payments WHERE id = $1", [pay.id]);
        await client.query("COMMIT");
        res.json({ reversed: true });
      } catch (e) {
        await client.query("ROLLBACK");
        res.status(400).json({ error: e.message });
      } finally {
        client.release();
      }
    })
  );

  // ─── Call Notes ────────────────────────────────────────────
  // What a customer, supplier or client said on the phone, and when to call
  // them back. The note keeps the contact's name so it still reads right
  // after the contact is renamed or removed.
  const CALL_CONTACT_TYPES = new Set(["customer", "supplier", "client", "other"]);

  // A datetime-local value from the browser ("2026-10-21T18:30"). Anything
  // else is dropped rather than guessed at.
  const callBackAt = (value) => {
    const s = String(value || "").trim();
    if (!s) return null;
    if (!/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?$/.test(s)) return null;
    return s.replace(" ", "T");
  };

  const callNoteToClient = (row) => ({
    ...row,
    call_back_at: row.call_back_at ? dstrTime(row.call_back_at) : null,
    called_at: row.called_at ? dstrTime(row.called_at) : null
  });

  router.get(
    "/call-notes",
    h(async (req, res) => {
      const limit = Math.min(Number(req.query.limit) || 200, 500);
      const params = [];
      const clauses = [];
      const status = String(req.query.status || "").trim();
      const contactType = String(req.query.contact_type || "").trim();
      const q = String(req.query.q || "").trim();
      if (status) {
        params.push(status);
        clauses.push(`n.status = $${params.length}`);
      }
      if (contactType) {
        params.push(contactType);
        clauses.push(`n.contact_type = $${params.length}`);
      }
      if (req.query.customer_id) {
        params.push(Number(req.query.customer_id) || 0);
        clauses.push(`n.customer_id = $${params.length}`);
      }
      if (req.query.supplier_id) {
        params.push(Number(req.query.supplier_id) || 0);
        clauses.push(`n.supplier_id = $${params.length}`);
      }
      if (q) {
        params.push(`%${q}%`);
        const like = `$${params.length}`;
        clauses.push(
          `(n.contact_name ILIKE ${like} OR n.subject ILIKE ${like} OR n.note ILIKE ${like} OR n.phone ILIKE ${like})`
        );
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      params.push(limit);
      const { rows } = await pool.query(
        `SELECT n.*, c.name AS customer_name, s.name AS supplier_name
         FROM call_notes n
         LEFT JOIN customers c ON c.id = n.customer_id
         LEFT JOIN suppliers s ON s.id = n.supplier_id
         ${where}
         ORDER BY CASE WHEN n.status = 'pending' THEN 0 ELSE 1 END,
                  n.call_back_at ASC NULLS LAST,
                  n.created_at DESC
         LIMIT $${params.length}`,
        params
      );
      res.json(rows.map(callNoteToClient));
    })
  );

  router.post(
    "/call-notes",
    h(async (req, res) => {
      const b = req.body || {};
      const contactType = String(b.contact_type || "customer").trim().toLowerCase();
      if (!CALL_CONTACT_TYPES.has(contactType)) {
        return res.status(400).json({ error: "Pick who the note is about" });
      }
      const subject = String(b.subject || "").trim();
      const note = String(b.note || "").trim();
      if (!subject && !note) {
        return res.status(400).json({ error: "Write down what was said" });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        let contactName = String(b.contact_name || "").trim();
        let customerId = null;
        let supplierId = null;
        if (contactType === "customer" && b.customer_id) {
          customerId = Number(b.customer_id);
          const { rows } = await client.query("SELECT name FROM customers WHERE id = $1", [customerId]);
          if (rows.length === 0) customerId = null;
          else contactName = rows[0].name;
        } else if (contactType === "supplier" && b.supplier_id) {
          supplierId = Number(b.supplier_id);
          const { rows } = await client.query("SELECT name FROM suppliers WHERE id = $1", [supplierId]);
          if (rows.length === 0) supplierId = null;
          else contactName = rows[0].name;
        }
        if (!contactName) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "Enter the name of the person" });
        }

        const { rows: [row] } = await client.query(
          `INSERT INTO call_notes
             (contact_type, customer_id, supplier_id, contact_name, phone, subject, note, call_back_at, priority)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           RETURNING *`,
          [
            contactType,
            customerId,
            supplierId,
            contactName,
            String(b.phone || "").trim() || null,
            subject || null,
            note || null,
            callBackAt(b.call_back_at),
            ["low", "normal", "high"].includes(String(b.priority || "").toLowerCase())
              ? String(b.priority).toLowerCase()
              : "normal"
          ]
        );
        await client.query("COMMIT");
        res.status(201).json(callNoteToClient(row));
      } catch (e) {
        await client.query("ROLLBACK");
        res.status(400).json({ error: e.message });
      } finally {
        client.release();
      }
    })
  );

  router.put(
    "/call-notes/:id",
    h(async (req, res) => {
      const b = req.body || {};
      const contactType = String(b.contact_type || "customer").trim().toLowerCase();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows: existing } = await client.query(
          "SELECT id FROM call_notes WHERE id = $1 FOR UPDATE",
          [req.params.id]
        );
        if (existing.length === 0) {
          await client.query("ROLLBACK");
          return res.status(404).json({ error: "Note not found" });
        }
        let contactName = String(b.contact_name || "").trim();
        let customerId = null;
        let supplierId = null;
        if (contactType === "customer" && b.customer_id) {
          customerId = Number(b.customer_id);
          const { rows } = await client.query("SELECT name FROM customers WHERE id = $1", [customerId]);
          if (rows.length === 0) customerId = null;
          else contactName = rows[0].name;
        } else if (contactType === "supplier" && b.supplier_id) {
          supplierId = Number(b.supplier_id);
          const { rows } = await client.query("SELECT name FROM suppliers WHERE id = $1", [supplierId]);
          if (rows.length === 0) supplierId = null;
          else contactName = rows[0].name;
        }
        if (!contactName) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "Enter the name of the person" });
        }
        const { rows: [row] } = await client.query(
          `UPDATE call_notes SET
             contact_type = $1, customer_id = $2, supplier_id = $3, contact_name = $4,
             phone = $5, subject = $6, note = $7, call_back_at = $8, priority = $9,
             updated_at = LOCALTIMESTAMP
           WHERE id = $10
           RETURNING *`,
          [
            contactType,
            customerId,
            supplierId,
            contactName,
            String(b.phone || "").trim() || null,
            String(b.subject || "").trim() || null,
            String(b.note || "").trim() || null,
            callBackAt(b.call_back_at),
            ["low", "normal", "high"].includes(String(b.priority || "").toLowerCase())
              ? String(b.priority).toLowerCase()
              : "normal",
            req.params.id
          ]
        );
        await client.query("COMMIT");
        res.json(callNoteToClient(row));
      } catch (e) {
        await client.query("ROLLBACK");
        res.status(400).json({ error: e.message });
      } finally {
        client.release();
      }
    })
  );

  // Mark the call back as done (or reopen it).
  router.patch(
    "/call-notes/:id/status",
    h(async (req, res) => {
      const b = req.body || {};
      const status = String(b.status || "").trim().toLowerCase();
      if (!["pending", "done"].includes(status)) {
        return res.status(400).json({ error: "Status must be pending or done" });
      }
      const { rows } = await pool.query(
        `UPDATE call_notes
         SET status = $1,
             called_at = CASE WHEN $3::boolean THEN LOCALTIMESTAMP ELSE NULL END,
             updated_at = LOCALTIMESTAMP
         WHERE id = $2
         RETURNING *`,
        [status, req.params.id, status === "done"]
      );
      if (rows.length === 0) return res.status(404).json({ error: "Note not found" });
      res.json(callNoteToClient(rows[0]));
    })
  );

  router.delete(
    "/call-notes/:id",
    h(async (req, res) => {
      const result = await pool.query("DELETE FROM call_notes WHERE id = $1", [req.params.id]);
      if (result.rowCount === 0) return res.status(404).json({ error: "Note not found" });
      res.json({ deleted: true });
    })
  );

  // ─── Suppliers ──────────────────────────────────────────────
  router.get(
    "/suppliers",
    h(async (_req, res) => {
      const { rows } = await pool.query(
        `SELECT s.*,
          (SELECT COUNT(*) FROM supplier_purchases sp WHERE sp.supplier_id = s.id) AS purchase_count,
          (SELECT COALESCE(SUM(sp.grand_total),0) FROM supplier_purchases sp WHERE sp.supplier_id = s.id) AS purchase_total
         FROM suppliers s ORDER BY s.name`
      );
      res.json(rows);
    })
  );

  router.post(
    "/suppliers",
    h(async (req, res) => {
      const b = req.body || {};
      if (!b.name) return res.status(400).json({ error: "name is required" });
      const { rows } = await pool.query(
        `INSERT INTO suppliers (name, company_name, contact_person, phone, email, address, detail, products_sold)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [b.name, b.company_name || null, b.contact_person || null, b.phone || null, b.email || null, b.address || null, b.detail || null, b.products_sold || null]
      );
      res.status(201).json({ id: rows[0].id, ...b });
    })
  );

  router.put(
    "/suppliers/:id",
    h(async (req, res) => {
      const b = req.body || {};
      const result = await pool.query(
        `UPDATE suppliers SET name = $1, company_name = $2, contact_person = $3, phone = $4, email = $5,
           address = $6, detail = $7, products_sold = $8 WHERE id = $9`,
        [b.name, b.company_name || null, b.contact_person || null, b.phone || null, b.email || null, b.address || null, b.detail || null, b.products_sold || null, req.params.id]
      );
      if (result.rowCount === 0) return res.status(404).json({ error: "Supplier not found" });
      res.json({ updated: true });
    })
  );

  router.delete(
    "/suppliers/:id",
    h(async (req, res) => {
      const result = await pool.query("DELETE FROM suppliers WHERE id = $1", [req.params.id]);
      if (result.rowCount === 0) return res.status(404).json({ error: "Supplier not found" });
      res.json({ deleted: true });
    })
  );

  // ─── Supplier Purchases ─────────────────────────────────────
  router.get(
    "/supplier-purchases",
    h(async (_req, res) => {
      const { rows } = await pool.query(
        `SELECT sp.id, sp.supplier_id, sp.additional_charges, sp.grand_total, sp.paid_amount, sp.due_date, sp.bill_image, sp.purchased_at, sp.created_at,
                s.name AS supplier_name,
                s.company_name AS supplier_company,
                (SELECT COUNT(*) FROM supplier_purchase_items spi WHERE spi.purchase_id = sp.id) AS item_count
         FROM supplier_purchases sp
         LEFT JOIN suppliers s ON s.id = sp.supplier_id
         ORDER BY sp.purchased_at DESC`
      );
      res.json(rows);
    })
  );

  router.get(
    "/supplier-purchases/:id",
    h(async (req, res) => {
      const { rows } = await pool.query(
        `SELECT sp.*, s.name AS supplier_name, s.company_name AS supplier_company
         FROM supplier_purchases sp LEFT JOIN suppliers s ON s.id = sp.supplier_id
         WHERE sp.id = $1`,
        [req.params.id]
      );
      if (rows.length === 0) return res.status(404).json({ error: "Purchase not found" });
      const purchase = rows[0];
      purchase.items = (
        await pool.query(
          `SELECT spi.*, p.name AS product_name, u.short_name AS unit_name,
                  (SELECT COUNT(*) FROM product_packs pp WHERE pp.purchase_id = spi.purchase_id AND pp.product_id = spi.product_id) AS pack_count
           FROM supplier_purchase_items spi
           LEFT JOIN products p ON p.id = spi.product_id
           LEFT JOIN measuring_units u ON u.id = spi.unit_id
           WHERE spi.purchase_id = $1 ORDER BY spi.id`,
          [purchase.id]
        )
      ).rows;
      res.json(purchase);
    })
  );

  router.patch(
    "/supplier-purchases/:id/payment",
    h(async (req, res) => {
      const b = req.body || {};
      const result = await pool.query(
        "UPDATE supplier_purchases SET paid_amount = $1, due_date = $2 WHERE id = $3",
        [Math.max(0, Number(b.paid_amount) || 0), b.due_date || null, req.params.id]
      );
      if (result.rowCount === 0) return res.status(404).json({ error: "Purchase not found" });
      res.json({ updated: true });
    })
  );

  router.post(
    "/supplier-purchases",
    h(async (req, res) => {
      const b = req.body || {};
      if (!Array.isArray(b.items) || b.items.length === 0) {
        return res.status(400).json({ error: "At least one item is required" });
      }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const billImage = saveBillImage(b.bill_image);
        const { rows: spRows } = await client.query(
          `INSERT INTO supplier_purchases (supplier_id, additional_charges, grand_total, paid_amount, due_date, bill_image, purchased_at)
           VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamp, LOCALTIMESTAMP)) RETURNING id`,
          [b.supplier_id || null, Number(b.additional_charges) || 0, Number(b.grand_total) || 0, Math.max(0, Number(b.paid_amount) || 0), b.due_date || null, billImage, b.purchased_at || null]
        );
        const purchaseId = spRows[0].id;

        for (const it of b.items) {
          const qty = Number(it.quantity) || 1;
          const packSize = Number(it.pack_size) || 1;
          const packCount = Math.ceil(qty / packSize);
          const totalQty = packCount * packSize;

          let productId = it.product_id || null;
          if (!productId && it.item_name && it.item_name.trim()) {
            const { rows: matched } = await client.query(
              `SELECT id FROM products
               WHERE lower(regexp_replace(trim(name), '\s{2,}', ' ', 'g')) = $1
               LIMIT 1`,
              [normalizeName(it.item_name.trim())]
            );
            if (matched.length > 0) {
              productId = matched[0].id;
            } else {
              const { rows: newProd } = await client.query(
                `INSERT INTO products (name, purchase_price, selling_price, unit, unit_id, hsn_code)
                 VALUES ($1, $2, 0, $3, $4, $5) RETURNING id`,
                [
                  it.item_name.trim(),
                  Number(it.purchase_price) || 0,
                  it.pack_sub_unit || "pcs",
                  it.unit_id || null,
                  it.hsn_code || null
                ]
              );
              productId = newProd[0].id;
            }
          }

          await client.query(
            `INSERT INTO supplier_purchase_items
               (purchase_id, product_id, item_name, purchase_price, quantity, unit_id, pack_size, pack_sub_unit, pack_price, hsn_code, tax, discount)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [
              purchaseId, productId, it.item_name,
              Number(it.purchase_price) || 0, totalQty,
              it.unit_id || null, packSize, it.pack_sub_unit || null,
              Number(it.pack_price) || Number(it.purchase_price) || 0,
              it.hsn_code || null, Number(it.tax) || 0, Number(it.discount) || 0
            ]
          );

          if (productId) {
            await insertPurchasePacks(client, {
              productId,
              purchaseId,
              packSize,
              totalQty
            });
            await client.query(
              "UPDATE products SET stock = stock + $1 WHERE id = $2",
              [totalQty, productId]
            );
            const rate = Number(it.purchase_price) || 0;
            if (rate > 0) {
              await client.query("UPDATE products SET purchase_price = $1 WHERE id = $2", [rate, productId]);
            }
          }
        }
        await client.query("COMMIT");
        res.status(201).json({ id: purchaseId });
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    })
  );

  router.put(
    "/supplier-purchases/:id",
    h(async (req, res) => {
      const b = req.body || {};
      if (!Array.isArray(b.items)) {
        return res.status(400).json({ error: "items array is required" });
      }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows: prev } = await client.query(
          "SELECT bill_image FROM supplier_purchases WHERE id = $1 FOR UPDATE",
          [req.params.id]
        );
        const billImage = saveBillImage(b.bill_image);
        const result = await client.query(
          `UPDATE supplier_purchases SET supplier_id = $1, additional_charges = $2, grand_total = $3, paid_amount = $4, due_date = $5, bill_image = $6, purchased_at = $7 WHERE id = $8`,
          [b.supplier_id || null, Number(b.additional_charges) || 0, Number(b.grand_total) || 0, Math.max(0, Number(b.paid_amount) || 0), b.due_date || null, billImage, b.purchased_at || null, req.params.id]
        );
        if (result.rowCount === 0) {
          await client.query("ROLLBACK");
          return res.status(404).json({ error: "Purchase not found" });
        }
        if (prev.length > 0 && prev[0].bill_image && prev[0].bill_image !== billImage) {
          removeBillImageUrl(prev[0].bill_image);
        }

        const { rows: oldItems } = await client.query(
          "SELECT product_id, quantity FROM supplier_purchase_items WHERE purchase_id = $1",
          [req.params.id]
        );
        for (const it of oldItems) {
          if (it.product_id) {
            await client.query("UPDATE products SET stock = stock - $1 WHERE id = $2", [it.quantity, it.product_id]);
          }
        }
        await client.query("DELETE FROM product_packs WHERE purchase_id = $1", [req.params.id]);
        await client.query("DELETE FROM supplier_purchase_items WHERE purchase_id = $1", [req.params.id]);

        for (const it of b.items) {
          const qty = Number(it.quantity) || 1;
          const packSize = Number(it.pack_size) || 1;
          const packCount = Math.ceil(qty / packSize);
          const totalQty = packCount * packSize;

          let productId = it.product_id || null;
          if (!productId && it.item_name && it.item_name.trim()) {
            const { rows: matched } = await client.query(
              `SELECT id FROM products
               WHERE lower(regexp_replace(trim(name), '\s{2,}', ' ', 'g')) = $1
               LIMIT 1`,
              [normalizeName(it.item_name.trim())]
            );
            if (matched.length > 0) {
              productId = matched[0].id;
            } else {
              const { rows: newProd } = await client.query(
                `INSERT INTO products (name, purchase_price, selling_price, unit, unit_id, hsn_code)
                 VALUES ($1, $2, 0, $3, $4, $5) RETURNING id`,
                [
                  it.item_name.trim(),
                  Number(it.purchase_price) || 0,
                  it.pack_sub_unit || "pcs",
                  it.unit_id || null,
                  it.hsn_code || null
                ]
              );
              productId = newProd[0].id;
            }
          }

          await client.query(
            `INSERT INTO supplier_purchase_items
               (purchase_id, product_id, item_name, purchase_price, quantity, unit_id, pack_size, pack_sub_unit, pack_price, hsn_code, tax, discount)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [
              req.params.id, productId, it.item_name,
              Number(it.purchase_price) || 0, totalQty,
              it.unit_id || null, packSize, it.pack_sub_unit || null,
              Number(it.pack_price) || Number(it.purchase_price) || 0,
              it.hsn_code || null, Number(it.tax) || 0, Number(it.discount) || 0
            ]
          );

          if (productId) {
            await insertPurchasePacks(client, {
              productId,
              purchaseId: req.params.id,
              packSize,
              totalQty
            });
            await client.query(
              "UPDATE products SET stock = stock + $1 WHERE id = $2",
              [totalQty, productId]
            );
            const rate = Number(it.purchase_price) || 0;
            if (rate > 0) {
              await client.query("UPDATE products SET purchase_price = $1 WHERE id = $2", [rate, productId]);
            }
          }
        }
        await client.query("COMMIT");
        res.json({ updated: true });
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    })
  );

  router.delete(
    "/supplier-purchases/:id",
    h(async (req, res) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows: items } = await client.query(
          "SELECT product_id, quantity FROM supplier_purchase_items WHERE purchase_id = $1",
          [req.params.id]
        );
        const { rows: prev } = await client.query(
          "SELECT bill_image FROM supplier_purchases WHERE id = $1 FOR UPDATE",
          [req.params.id]
        );
        const result = await client.query("DELETE FROM supplier_purchases WHERE id = $1", [req.params.id]);
        if (result.rowCount === 0) {
          await client.query("ROLLBACK");
          return res.status(404).json({ error: "Purchase not found" });
        }
        for (const it of items) {
          if (it.product_id) {
            await client.query("UPDATE products SET stock = stock - $1 WHERE id = $2", [it.quantity, it.product_id]);
          }
        }
        await client.query("COMMIT");
        if (prev.length > 0) removeBillImageUrl(prev[0].bill_image);
        res.json({ deleted: true });
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    })
  );

  // ─── Assets ─────────────────────────────────────────────────
  router.get(
    "/assets",
    h(async (_req, res) => {
      res.json((await pool.query("SELECT * FROM assets ORDER BY purchase_date DESC")).rows);
    })
  );

  router.post(
    "/assets",
    h(async (req, res) => {
      const b = req.body || {};
      if (!b.name) return res.status(400).json({ error: "name is required" });
      const { rows } = await pool.query(
        `INSERT INTO assets (name, category, purchase_date, purchase_cost, current_value, condition, location, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [b.name, b.category || "Equipment", b.purchase_date || null, Number(b.purchase_cost) || 0, Number(b.current_value) || Number(b.purchase_cost) || 0, b.condition || "Good", b.location || null, b.note || null]
      );
      res.status(201).json({ id: rows[0].id, ...b });
    })
  );

  router.put(
    "/assets/:id",
    h(async (req, res) => {
      const b = req.body || {};
      const result = await pool.query(
        `UPDATE assets SET name = $1, category = $2, purchase_date = $3, purchase_cost = $4,
           current_value = $5, condition = $6, location = $7, note = $8 WHERE id = $9`,
        [b.name, b.category || "Equipment", b.purchase_date || null, Number(b.purchase_cost) || 0, Number(b.current_value) || 0, b.condition || "Good", b.location || null, b.note || null, req.params.id]
      );
      if (result.rowCount === 0) return res.status(404).json({ error: "Asset not found" });
      res.json({ updated: true });
    })
  );

  router.delete(
    "/assets/:id",
    h(async (req, res) => {
      const result = await pool.query("DELETE FROM assets WHERE id = $1", [req.params.id]);
      if (result.rowCount === 0) return res.status(404).json({ error: "Asset not found" });
      res.json({ deleted: true });
    })
  );

  // ─── Expenses ───────────────────────────────────────────────
  router.get(
    "/expenses",
    h(async (_req, res) => {
      res.json((await pool.query("SELECT * FROM expenses ORDER BY date DESC")).rows);
    })
  );

  router.post(
    "/expenses",
    h(async (req, res) => {
      const b = req.body || {};
      if (!b.category || !b.amount) return res.status(400).json({ error: "category and amount are required" });
      const { rows } = await pool.query(
        "INSERT INTO expenses (category, amount, description, payment_method, date) VALUES ($1,$2,$3,$4,$5) RETURNING id",
        [b.category, Number(b.amount), b.description || null, b.payment_method || "cash", b.date || todayStr()]
      );
      res.status(201).json({ id: rows[0].id, ...b });
    })
  );

  router.delete(
    "/expenses/:id",
    h(async (req, res) => {
      const result = await pool.query("DELETE FROM expenses WHERE id = $1", [req.params.id]);
      if (result.rowCount === 0) return res.status(404).json({ error: "Expense not found" });
      res.json({ deleted: true });
    })
  );

  // ─── Cheques ─────────────────────────────────────────────────
  router.get(
    "/cheques",
    h(async (req, res) => {
      const status = String(req.query.status || "").trim();
      const supplierId = req.query.supplier_id ? Number(req.query.supplier_id) : null;
      const customerId = req.query.customer_id ? Number(req.query.customer_id) : null;
      const params = [];
      let where = "WHERE 1=1";
      if (status === "pending" || status === "cleared" || status === "bounced") {
        params.push(status);
        where += ` AND c.status = $${params.length}`;
      }
      if (supplierId) {
        params.push(supplierId);
        where += ` AND c.supplier_id = $${params.length}::int`;
      }
      if (customerId) {
        params.push(customerId);
        where += ` AND c.customer_id = $${params.length}::int`;
      }
      const { rows } = await pool.query(
        `SELECT c.*, s.name AS supplier_name, cu.name AS customer_name
         FROM cheques c
         LEFT JOIN suppliers s ON s.id = c.supplier_id
         LEFT JOIN customers cu ON cu.id = c.customer_id
         ${where}
         ORDER BY c.issue_date DESC NULLS LAST, c.id DESC`,
        params
      );
      res.json(rows);
    })
  );

  router.get(
    "/cheques/:id",
    h(async (req, res) => {
      const { rows } = await pool.query(
        `SELECT c.*, s.name AS supplier_name, cu.name AS customer_name
         FROM cheques c
         LEFT JOIN suppliers s ON s.id = c.supplier_id
         LEFT JOIN customers cu ON cu.id = c.customer_id
         WHERE c.id = $1`,
        [req.params.id]
      );
      if (rows.length === 0) return res.status(404).json({ error: "Cheque not found" });
      res.json(rows[0]);
    })
  );

  router.post(
    "/cheques",
    h(async (req, res) => {
      const b = req.body || {};
      const chequeNo = String(b.cheque_no || "").trim();
      if (!chequeNo) return res.status(400).json({ error: "Cheque number is required" });
      if (!(Number(b.amount) > 0)) return res.status(400).json({ error: "Amount must be greater than zero" });
      const status = ["pending", "cleared", "bounced"].includes(b.status) ? b.status : "pending";
      const { rows } = await pool.query(
        `INSERT INTO cheques (cheque_no, bank_name, drawer_name, payee, amount, issue_date, clearing_date,
           status, supplier_id, customer_id, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [chequeNo, b.bank_name || null, b.drawer_name || null, b.payee || null,
         Number(b.amount) || 0, b.issue_date || null, b.clearing_date || null,
         status, b.supplier_id ? Number(b.supplier_id) : null,
         b.customer_id ? Number(b.customer_id) : null, b.notes || null]
      );
      res.status(201).json({ id: rows[0].id, ...b });
    })
  );

  router.put(
    "/cheques/:id",
    h(async (req, res) => {
      const b = req.body || {};
      const chequeNo = String(b.cheque_no || "").trim();
      if (!chequeNo) return res.status(400).json({ error: "Cheque number is required" });
      if (!(Number(b.amount) > 0)) return res.status(400).json({ error: "Amount must be greater than zero" });
      const status = ["pending", "cleared", "bounced"].includes(b.status) ? b.status : "pending";
      const result = await pool.query(
        `UPDATE cheques SET cheque_no = $1, bank_name = $2, drawer_name = $3, payee = $4, amount = $5,
           issue_date = $6, clearing_date = $7, status = $8, supplier_id = $9, customer_id = $10,
           notes = $11 WHERE id = $12`,
        [chequeNo, b.bank_name || null, b.drawer_name || null, b.payee || null,
         Number(b.amount) || 0, b.issue_date || null, b.clearing_date || null,
         status, b.supplier_id ? Number(b.supplier_id) : null,
         b.customer_id ? Number(b.customer_id) : null, b.notes || null, req.params.id]
      );
      if (result.rowCount === 0) return res.status(404).json({ error: "Cheque not found" });
      res.json({ updated: true });
    })
  );

  router.patch(
    "/cheques/:id/status",
    h(async (req, res) => {
      const b = req.body || {};
      const status = ["pending", "cleared", "bounced"].includes(b.status) ? b.status : null;
      if (!status) return res.status(400).json({ error: "Invalid status" });
      const result = await pool.query(
        "UPDATE cheques SET status = $1 WHERE id = $2",
        [status, req.params.id]
      );
      if (result.rowCount === 0) return res.status(404).json({ error: "Cheque not found" });
      res.json({ updated: true });
    })
  );

  router.delete(
    "/cheques/:id",
    h(async (req, res) => {
      const result = await pool.query("DELETE FROM cheques WHERE id = $1", [req.params.id]);
      if (result.rowCount === 0) return res.status(404).json({ error: "Cheque not found" });
      res.json({ deleted: true });
    })
  );

  // ─── Tasks ──────────────────────────────────────────────────
  const TASK_PRIORITIES = ["low", "normal", "high", "urgent"];
  const TASK_STATUSES = ["pending", "in_progress", "completed", "cancelled"];

  router.get(
    "/tasks",
    h(async (req, res) => {
      const status = String(req.query.status || "").trim();
      const assignedTo = req.query.assigned_to ? Number(req.query.assigned_to) : null;
      const params = [];
      let where = "WHERE 1=1";
      if (TASK_STATUSES.includes(status)) {
        params.push(status);
        where += ` AND t.status = $${params.length}`;
      }
      if (assignedTo) {
        params.push(assignedTo);
        where += ` AND t.assigned_to = $${params.length}::int`;
      }
      const { rows } = await pool.query(
        `SELECT t.*, e.name AS employee_name
         FROM tasks t LEFT JOIN employees e ON e.id = t.assigned_to
         ${where}
         ORDER BY CASE WHEN t.status IN ('pending','in_progress') THEN 0 ELSE 1 END,
                  t.due_date ASC NULLS LAST, t.id DESC`,
        params
      );
      res.json(rows);
    })
  );

  router.get(
    "/tasks/:id",
    h(async (req, res) => {
      const { rows } = await pool.query(
        `SELECT t.*, e.name AS employee_name
         FROM tasks t LEFT JOIN employees e ON e.id = t.assigned_to
         WHERE t.id = $1`,
        [req.params.id]
      );
      if (rows.length === 0) return res.status(404).json({ error: "Task not found" });
      res.json(rows[0]);
    })
  );

  router.post(
    "/tasks",
    h(async (req, res) => {
      const b = req.body || {};
      const title = String(b.title || "").trim();
      if (!title) return res.status(400).json({ error: "Task title is required" });
      const priority = TASK_PRIORITIES.includes(b.priority) ? b.priority : "normal";
      const status = TASK_STATUSES.includes(b.status) ? b.status : "pending";
      const { rows } = await pool.query(
        `INSERT INTO tasks (title, description, assigned_to, priority, status, due_date)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [title, b.description || null, b.assigned_to ? Number(b.assigned_to) : null,
         priority, status, b.due_date || null]
      );
      res.status(201).json({ id: rows[0].id, ...b });
    })
  );

  router.put(
    "/tasks/:id",
    h(async (req, res) => {
      const b = req.body || {};
      const title = String(b.title || "").trim();
      if (!title) return res.status(400).json({ error: "Task title is required" });
      const priority = TASK_PRIORITIES.includes(b.priority) ? b.priority : "normal";
      const status = TASK_STATUSES.includes(b.status) ? b.status : "pending";
      const result = await pool.query(
        `UPDATE tasks SET title = $1, description = $2, assigned_to = $3, priority = $4, status = $5,
           due_date = $6,
           completed_at = CASE WHEN $5::varchar = 'completed' THEN LOCALTIMESTAMP ELSE NULL END
         WHERE id = $7`,
        [title, b.description || null, b.assigned_to ? Number(b.assigned_to) : null,
         priority, status, b.due_date || null, req.params.id]
      );
      if (result.rowCount === 0) return res.status(404).json({ error: "Task not found" });
      res.json({ updated: true });
    })
  );

  router.patch(
    "/tasks/:id/status",
    h(async (req, res) => {
      const b = req.body || {};
      const status = TASK_STATUSES.includes(b.status) ? b.status : null;
      if (!status) return res.status(400).json({ error: "Invalid task status" });
      const result = await pool.query(
        `UPDATE tasks SET status = $1,
           completed_at = CASE WHEN $1::varchar = 'completed' THEN LOCALTIMESTAMP ELSE NULL END
         WHERE id = $2`,
        [status, req.params.id]
      );
      if (result.rowCount === 0) return res.status(404).json({ error: "Task not found" });
      res.json({ updated: true });
    })
  );

  router.delete(
    "/tasks/:id",
    h(async (req, res) => {
      const result = await pool.query("DELETE FROM tasks WHERE id = $1", [req.params.id]);
      if (result.rowCount === 0) return res.status(404).json({ error: "Task not found" });
      res.json({ deleted: true });
    })
  );

  // ─── Reminders ─────────────────────────────────────────────
  // "What needs chasing today?" is one question the shop asks every morning,
  // but the answers sit in four unrelated tables. Rather than making the page
  // pull customers, purchases, cheques and tasks and stitch them together, the
  // join happens here once and every row arrives in the same shape, so the UI
  // can sort and group without knowing where a line came from.
  //
  // Due dates are reduced to a whole number of days against today rather than
  // compared as timestamps: both sides go through Date.UTC, so a daylight-saving
  // shift in between can't turn "due today" into "due tomorrow".
  const dayNumber = (value) => {
    if (value === null || value === undefined || value === "") return null;
    const parts = dstr(value).split("-");
    if (parts.length < 3) return null;
    const [y, m, d] = parts.map(Number);
    if (!y || !m || !d) return null;
    return Date.UTC(y, m - 1, d) / 86400000;
  };

  const severityOf = (daysLeft) => {
    if (daysLeft === null) return "unscheduled";
    if (daysLeft < 0) return "overdue";
    if (daysLeft === 0) return "today";
    if (daysLeft <= 3) return "soon";
    if (daysLeft <= 7) return "week";
    return "later";
  };

  router.get(
    "/reminders",
    h(async (_req, res) => {
      const now = new Date();
      const todayNum = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000;
      const daysLeftOf = (value) => {
        const n = dayNumber(value);
        return n === null ? null : n - todayNum;
      };
      const base = (kind, id, title, subtitle, amount, dueDate, page, meta) => {
        const daysLeft = daysLeftOf(dueDate);
        return {
          key: `${kind}:${id}`,
          kind,
          id,
          title,
          subtitle,
          amount: amount === null || amount === undefined ? null : Number(amount) || 0,
          due_date: dueDate ? dstr(dueDate) : null,
          days_left: daysLeft,
          severity: severityOf(daysLeft),
          page,
          meta: meta || {}
        };
      };

      // Four small reads, in parallel: each one is already an index-friendly
      // scan of its own table, and none of them touch the other three.
      const [dueRows, purchaseRows, chequeRows, taskRows] = await Promise.all([
        // Money owed to the shop. Sales carry no due date, so these can't be
        // bucketed by "days remaining" — they land in the unscheduled bucket and
        // carry how long the oldest unpaid bill has been sitting instead.
        pool.query(
          `SELECT c.id, c.name, c.phone, c.email,
             COALESCE(SUM(s.total - s.paid), 0) AS balance,
             COUNT(*) AS unpaid_bills,
             MIN(s.created_at) AS oldest_unpaid_at
           FROM customers c
           JOIN sales s ON s.customer_id = c.id
           WHERE s.total > s.paid
           GROUP BY c.id
           HAVING COALESCE(SUM(s.total - s.paid), 0) > 0
           ORDER BY balance DESC`
        ),
        pool.query(
          `SELECT sp.id, sp.supplier_id, sp.due_date,
             (sp.grand_total - sp.paid_amount) AS balance,
             s.name AS supplier_name
           FROM supplier_purchases sp
           LEFT JOIN suppliers s ON s.id = sp.supplier_id
           WHERE sp.grand_total > sp.paid_amount
           ORDER BY sp.due_date ASC NULLS LAST, sp.id DESC`
        ),
        // A pending cheque past its clearing date counts as overdue, matching
        // how the Cheques page already labels it.
        pool.query(
          `SELECT c.id, c.cheque_no, c.bank_name, c.drawer_name, c.amount,
             c.issue_date, c.clearing_date, c.supplier_id, c.customer_id,
             s.name AS supplier_name, cu.name AS customer_name
           FROM cheques c
           LEFT JOIN suppliers s ON s.id = c.supplier_id
           LEFT JOIN customers cu ON cu.id = c.customer_id
           WHERE c.status = 'pending'
           ORDER BY c.clearing_date ASC NULLS LAST, c.id DESC`
        ),
        pool.query(
          `SELECT t.id, t.title, t.priority, t.due_date, t.status, e.name AS employee_name
           FROM tasks t
           LEFT JOIN employees e ON e.id = t.assigned_to
           WHERE t.status IN ('pending', 'in_progress')
           ORDER BY t.due_date ASC NULLS LAST, t.id DESC`
        )
      ]);

      const reminders = [];

      for (const c of dueRows.rows) {
        const outstandingDays = daysLeftOf(c.oldest_unpaid_at);
        reminders.push(
          base(
            "customer_due",
            c.id,
            c.name,
            `${c.unpaid_bills} unpaid bill${Number(c.unpaid_bills) === 1 ? "" : "s"}`,
            c.balance,
            null,
            "customers",
            {
              phone: c.phone || "",
              email: c.email || "",
              unpaid_bills: Number(c.unpaid_bills) || 0,
              oldest_unpaid_date: c.oldest_unpaid_at ? dstr(c.oldest_unpaid_at) : null,
              outstanding_days: outstandingDays === null ? null : Math.abs(outstandingDays)
            }
          )
        );
      }

      for (const p of purchaseRows.rows) {
        reminders.push(
          base(
            "supplier_due",
            p.id,
            p.supplier_name || "Unknown supplier",
            "Purchase balance to pay",
            p.balance,
            p.due_date,
            "purchases",
            { supplier_id: p.supplier_id }
          )
        );
      }

      for (const q of chequeRows.rows) {
        const party = q.supplier_name || q.customer_name || q.drawer_name || "Unnamed party";
        reminders.push(
          base(
            "cheque",
            q.id,
            `Cheque ${q.cheque_no}`,
            q.bank_name ? `${party} · ${q.bank_name}` : party,
            q.amount,
            q.clearing_date,
            "cheques",
            {
              cheque_no: q.cheque_no,
              bank_name: q.bank_name || "",
              drawer_name: q.drawer_name || "",
              supplier_name: q.supplier_name || "",
              customer_name: q.customer_name || ""
            }
          )
        );
      }

      for (const t of taskRows.rows) {
        reminders.push(
          base(
            "task",
            t.id,
            t.title,
            t.employee_name
              ? `Task for ${t.employee_name}`
              : "Unassigned task",
            null,
            t.due_date,
            "tasks",
            { priority: t.priority, status: t.status, employee_name: t.employee_name || "" }
          )
        );
      }

      // Most pressing first: anything already late, then soonest, then the
      // undated tail — which is a list of real balances but has no clock on it,
      // so it can never outrank something that is due tomorrow.
      const rank = { overdue: 0, today: 1, soon: 2, week: 3, later: 4, unscheduled: 5 };
      reminders.sort((a, b) => {
        const bySeverity = rank[a.severity] - rank[b.severity];
        if (bySeverity !== 0) return bySeverity;
        if (a.days_left === null && b.days_left !== null) return 1;
        if (b.days_left === null && a.days_left !== null) return -1;
        if (a.days_left !== null && b.days_left !== null && a.days_left !== b.days_left) {
          return a.days_left - b.days_left;
        }
        return (b.amount || 0) - (a.amount || 0);
      });

      const overdue = reminders.filter((r) => r.days_left !== null && r.days_left < 0).length;
      const dueToday = reminders.filter((r) => r.days_left === 0).length;

      res.json({
        reminders,
        summary: {
          total: reminders.length,
          overdue,
          due_today: dueToday,
          // What the sidebar badge counts: late or due today, i.e. the things
          // that stop being a problem once they are dealt with today.
          needs_attention: overdue + dueToday
        }
      });
    })
  );

  // ─── Business Documents ─────────────────────────────────────
  router.get(
    "/business-documents",
    h(async (_req, res) => {
      res.json((await pool.query("SELECT * FROM business_documents ORDER BY uploaded_at DESC, id DESC")).rows);
    })
  );

  router.get(
    "/business-documents/:id",
    h(async (req, res) => {
      const { rows } = await pool.query("SELECT * FROM business_documents WHERE id = $1", [req.params.id]);
      if (rows.length === 0) return res.status(404).json({ error: "Document not found" });
      res.json(rows[0]);
    })
  );

  const businessDocError = (e) =>
    String(e && e.message).includes("Unsupported file type") || String(e && e.message).includes("exceeds 15MB")
      ? e
      : null;

  // Raw binary upload. The client posts the File as the request body, which avoids
  // base64-encoding it in JS first (slower and ~33% larger) and keeps the event
  // loop free. Returns a /uploads/docs path that the JSON endpoints below accept.
  router.post(
    "/business-documents/upload",
    raw({ type: "application/octet-stream", limit: "15mb" }),
    h(async (req, res) => {
      const buf = req.body;
      if (!Buffer.isBuffer(buf) || !buf.length) {
        return res.status(400).json({ error: "A valid file is required" });
      }
      const mime = String(req.get("x-file-type") || "").toLowerCase();
      let rawName = "";
      try {
        rawName = decodeURIComponent(String(req.get("x-file-name") || ""));
      } catch {
        rawName = String(req.get("x-file-name") || "");
      }
      let saved;
      try {
        saved = await saveBusinessDocBuffer(buf, mime, rawName);
      } catch (e) {
        const known = businessDocError(e);
        if (known) return res.status(400).json({ error: e.message });
        throw e;
      }
      if (!saved) return res.status(400).json({ error: "A valid file is required" });
      res.status(201).json(saved);
    })
  );

  router.post(
    "/business-documents",
    h(async (req, res) => {
      const b = req.body || {};
      const name = String(b.name || "").trim();
      if (!name) return res.status(400).json({ error: "Document name is required" });
      let saved;
      try {
        saved = await saveBusinessDoc(b.file);
      } catch (e) {
        const known = businessDocError(e);
        if (known) return res.status(400).json({ error: e.message });
        throw e;
      }
      if (!saved) return res.status(400).json({ error: "A valid file is required" });
      const { rows } = await pool.query(
        `INSERT INTO business_documents (name, category, file_path, file_type, file_size, notes)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [name, b.category || "Other", saved.file_path, saved.file_type || b.file_type || null,
         saved.file_size, b.notes || null]
      );
      res.status(201).json({ id: rows[0].id, ...b, file_path: saved.file_path });
    })
  );

  router.put(
    "/business-documents/:id",
    h(async (req, res) => {
      const b = req.body || {};
      const existing = await pool.query("SELECT * FROM business_documents WHERE id = $1", [req.params.id]);
      if (existing.rows.length === 0) return res.status(404).json({ error: "Document not found" });
      const doc = existing.rows[0];
      const name = String(b.name || doc.name || "").trim();
      let filePath = doc.file_path;
      let fileType = doc.file_type;
      let fileSize = doc.file_size;
      if (b.file) {
        let saved;
        try {
          saved = await saveBusinessDoc(b.file);
        } catch (e) {
          const known = businessDocError(e);
          if (known) return res.status(400).json({ error: e.message });
          throw e;
        }
        if (saved) {
          if (saved.replaced && saved.file_path === doc.file_path) {
            /* unchanged */
          } else {
            removeBusinessDocPath(doc.file_path);
            filePath = saved.file_path;
            fileType = saved.file_type || doc.file_type;
            fileSize = saved.file_size || doc.file_size;
          }
        }
      }
      await pool.query(
        `UPDATE business_documents SET name = $1, category = $2, file_path = $3, file_type = $4,
           file_size = $5, notes = $6 WHERE id = $7`,
        [name, b.category || doc.category || "Other", filePath, fileType, fileSize, b.notes != null ? b.notes : doc.notes, req.params.id]
      );
      res.json({ updated: true });
    })
  );

  router.delete(
    "/business-documents/:id",
    h(async (req, res) => {
      const { rows } = await pool.query("SELECT file_path FROM business_documents WHERE id = $1", [req.params.id]);
      if (rows.length === 0) return res.status(404).json({ error: "Document not found" });
      const result = await pool.query("DELETE FROM business_documents WHERE id = $1", [req.params.id]);
      if (result.rowCount === 0) return res.status(404).json({ error: "Document not found" });
      removeBusinessDocPath(rows[0].file_path);
      res.json({ deleted: true });
    })
  );

  // ─── Expense & Asset Categories ───────────────────────
  // ---- Non-Sale Inventory (packaging / materials, not for sale) ----
  router.get(
    "/non-sale-inventory",
    h(async (_req, res) => {
      const { rows } = await pool.query("SELECT * FROM non_sale_inventory ORDER BY created_at DESC, id DESC");
      res.json(rows);
    })
  );

  router.get(
    "/non-sale-inventory/:id",
    h(async (req, res) => {
      const { rows } = await pool.query("SELECT * FROM non_sale_inventory WHERE id = $1", [req.params.id]);
      if (rows.length === 0) return res.status(404).json({ error: "Item not found" });
      res.json(rows[0]);
    })
  );

  router.post(
    "/non-sale-inventory",
    h(async (req, res) => {
      const b = req.body || {};
      const name = String(b.name || "").trim();
      if (!name) return res.status(400).json({ error: "Name is required" });
      const qty = Number(b.quantity_purchased ?? b.quantity ?? 0) || 0;
      const amt = Number(b.amount_per_unit ?? b.amount ?? b.rate ?? 0) || 0;
      const total = Math.round(qty * amt * 100) / 100;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows } = await client.query(
          "INSERT INTO non_sale_inventory (name, size, unit, quantity_purchased, amount_per_unit, total_amount, stock_remaining, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
          [name, b.size || null, b.unit || "pcs", qty, amt, total, qty, b.notes || null]
        );
        if (total > 0) {
          await client.query(
            "INSERT INTO expenses (category, amount, description, payment_method, date) VALUES ($1,$2,$3,$4,$5)",
            ["Packaging/Materials", total, "Non-sale inventory purchase: " + name + " (Qty: " + qty + " " + (b.unit || "pcs") + ")", b.payment_method || "cash", dstr(new Date())]
          );
        }
        await client.query("COMMIT");
        res.status(201).json(rows[0]);
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    })
  );

  router.put(
    "/non-sale-inventory/:id",
    h(async (req, res) => {
      const b = req.body || {};
      const existing = await pool.query("SELECT * FROM non_sale_inventory WHERE id = $1", [req.params.id]);
      if (existing.rows.length === 0) return res.status(404).json({ error: "Item not found" });
      const cur = existing.rows[0];
      const name = b.name != null ? String(b.name).trim() || cur.name : cur.name;
      const amt = b.amount_per_unit != null ? Number(b.amount_per_unit) || 0 : Number(cur.amount_per_unit) || 0;
      const addQty = b.add_quantity != null ? Number(b.add_quantity) || 0 : 0;
      const newStock = Math.max(0, Number(cur.stock_remaining) || 0) + addQty;
      const newQtyPurchased = (Number(cur.quantity_purchased) || 0) + addQty;
      const newTotal = Math.round(newQtyPurchased * amt * 100) / 100;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "UPDATE non_sale_inventory SET name=$1, size=$2, unit=$3, quantity_purchased=$4, amount_per_unit=$5, total_amount=$6, stock_remaining=$7, notes=$8, updated_at=LOCALTIMESTAMP WHERE id=$9",
          [name, b.size != null ? b.size : cur.size, b.unit != null ? b.unit : cur.unit, newQtyPurchased, amt, newTotal, newStock, b.notes != null ? b.notes : cur.notes, req.params.id]
        );
        if (addQty > 0 && amt > 0) {
          await client.query(
            "INSERT INTO expenses (category, amount, description, payment_method, date) VALUES ($1,$2,$3,$4,$5)",
            ["Packaging/Materials", Math.round(addQty * amt * 100) / 100, "Non-sale inventory restock: " + name + " (+" + addQty + " " + (b.unit || cur.unit || "pcs") + ")", b.payment_method || "cash", dstr(new Date())]
          );
        }
        await client.query("COMMIT");
        const { rows } = await pool.query("SELECT * FROM non_sale_inventory WHERE id = $1", [req.params.id]);
        res.json(rows[0]);
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    })
  );

  router.post(
    "/non-sale-inventory/:id/use",
    h(async (req, res) => {
      const b = req.body || {};
      const useQty = Number(b.quantity || b.qty || 0) || 0;
      if (useQty <= 0) return res.status(400).json({ error: "Quantity must be greater than 0" });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows } = await client.query("SELECT * FROM non_sale_inventory WHERE id = $1 FOR UPDATE", [req.params.id]);
        if (rows.length === 0) {
          await client.query("ROLLBACK");
          return res.status(404).json({ error: "Item not found" });
        }
        const cur = rows[0];
        const remaining = Number(cur.stock_remaining) || 0;
        if (useQty > remaining) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "Not enough stock remaining" });
        }
        await client.query("UPDATE non_sale_inventory SET stock_remaining = $1, updated_at = LOCALTIMESTAMP WHERE id = $2", [Math.max(0, remaining - useQty), req.params.id]);
        await client.query("COMMIT");
        const { rows: out } = await pool.query("SELECT * FROM non_sale_inventory WHERE id = $1", [req.params.id]);
        res.json(out[0]);
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    })
  );

  router.delete(
    "/non-sale-inventory/:id",
    h(async (req, res) => {
      const result = await pool.query("DELETE FROM non_sale_inventory WHERE id = $1", [req.params.id]);
      if (result.rowCount === 0) return res.status(404).json({ error: "Item not found" });
      res.json({ deleted: true });
    })
  );

  const categoryCrud = (table, label) => ({
    list: h(async (_req, res) => res.json((await pool.query(`SELECT * FROM ${table} ORDER BY name`)).rows)),
    create: h(async (req, res) => {
      const name = String((req.body || {}).name || "").trim();
      if (!name) return res.status(400).json({ error: `${label} name is required` });
      try {
        const { rows } = await pool.query(`INSERT INTO ${table} (name) VALUES ($1) RETURNING id`, [name]);
        res.status(201).json({ id: rows[0].id, name });
      } catch (e) {
        if (e.code === "23505") return res.status(400).json({ error: `Category "${name}" already exists` });
        throw e;
      }
    }),
    update: h(async (req, res) => {
      const name = String((req.body || {}).name || "").trim();
      if (!name) return res.status(400).json({ error: `${label} name is required` });
      try {
        const result = await pool.query(`UPDATE ${table} SET name = $1 WHERE id = $2`, [name, req.params.id]);
        if (result.rowCount === 0) return res.status(404).json({ error: `${label} not found` });
        res.json({ updated: true });
      } catch (e) {
        if (e.code === "23505") return res.status(400).json({ error: `Category "${name}" already exists` });
        throw e;
      }
    }),
    remove: h(async (req, res) => {
      const result = await pool.query(`DELETE FROM ${table} WHERE id = $1`, [req.params.id]);
      if (result.rowCount === 0) return res.status(404).json({ error: `${label} not found` });
      res.json({ deleted: true });
    })
  });

  const expenseCat = categoryCrud("expense_categories", "Expense category");
  router.get("/expense-categories", expenseCat.list);
  router.post("/expense-categories", expenseCat.create);
  router.put("/expense-categories/:id", expenseCat.update);
  router.delete("/expense-categories/:id", expenseCat.remove);

  const assetCat = categoryCrud("asset_categories", "Asset category");
  router.get("/asset-categories", assetCat.list);
  router.post("/asset-categories", assetCat.create);
  router.put("/asset-categories/:id", assetCat.update);
  router.delete("/asset-categories/:id", assetCat.remove);

  const docCat = categoryCrud("business_document_categories", "Document category");
  router.get("/business-document-categories", docCat.list);
  router.post("/business-document-categories", docCat.create);
  router.put("/business-document-categories/:id", docCat.update);
  router.delete("/business-document-categories/:id", docCat.remove);

  const custCat = categoryCrud("customer_categories", "Customer category");
  router.get("/customer-categories", custCat.list);
  router.post("/customer-categories", custCat.create);
  router.put("/customer-categories/:id", custCat.update);
  router.delete("/customer-categories/:id", custCat.remove);

  router.put(
    "/customer-prices/:productId",
    h(async (req, res) => {
      const productId = parseInt(req.params.productId, 10);
      if (!Number.isFinite(productId)) return res.status(400).json({ error: "Invalid product id" });
      const prices = (req.body || {}).prices && typeof (req.body || {}).prices === "object" ? req.body.prices : {};
      const { rows: exists } = await pool.query("SELECT id FROM products WHERE id = $1", [productId]);
      if (exists.length === 0) return res.status(404).json({ error: "Product not found" });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const [catId, raw] of Object.entries(prices)) {
          const cat = parseInt(catId, 10);
          if (!Number.isFinite(cat)) continue;
          const val = Number(raw);
          if (val > 0) {
            await client.query(
              `INSERT INTO customer_prices (product_id, category_id, selling_price)
               VALUES ($1::int, $2::int, $3)
               ON CONFLICT (product_id, category_id) DO UPDATE SET selling_price = EXCLUDED.selling_price`,
              [productId, cat, val]
            );
          } else {
            await client.query(
              "DELETE FROM customer_prices WHERE product_id = $1::int AND category_id = $2::int",
              [productId, cat]
            );
          }
        }
        await client.query("COMMIT");
        res.json({ updated: true });
      } catch (e) {
        await client.query("ROLLBACK");
        res.status(400).json({ error: e.message });
      } finally {
        client.release();
      }
    })
  );

  // ─── Measuring Units ────────────────────────────────────────
  router.get(
    "/measuring-units",
    h(async (_req, res) => {
      const { rows } = await pool.query("SELECT * FROM measuring_units ORDER BY category, name");
      res.json(rows);
    })
  );

  router.get(
    "/measuring-units/:id",
    h(async (req, res) => {
      const { rows } = await pool.query("SELECT * FROM measuring_units WHERE id = $1", [req.params.id]);
      if (rows.length === 0) return res.status(404).json({ error: "Unit not found" });
      res.json(rows[0]);
    })
  );

  router.post(
    "/measuring-units",
    h(async (req, res) => {
      const b = req.body || {};
      if (!b.name || !b.short_name) return res.status(400).json({ error: "name and short_name are required" });
      try {
        const { rows } = await pool.query(
          `INSERT INTO measuring_units (name, short_name, category, base_unit, conversion_factor)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [b.name, b.short_name, b.category || "other", b.base_unit || null, Number(b.conversion_factor) || 1]
        );
        res.status(201).json({ id: rows[0].id, ...b });
      } catch (e) {
        if (e.code === "23505") return res.status(400).json({ error: "Unit with this name already exists" });
        throw e;
      }
    })
  );

  router.put(
    "/measuring-units/:id",
    h(async (req, res) => {
      const b = req.body || {};
      try {
        const result = await pool.query(
          `UPDATE measuring_units SET name = $1, short_name = $2, category = $3,
           base_unit = $4, conversion_factor = $5 WHERE id = $6`,
          [b.name, b.short_name, b.category || "other", b.base_unit || null, Number(b.conversion_factor) || 1, req.params.id]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: "Unit not found" });
        res.json({ updated: true });
      } catch (e) {
        if (e.code === "23505") return res.status(400).json({ error: "Unit with this name already exists" });
        throw e;
      }
    })
  );

  router.delete(
    "/measuring-units/:id",
    h(async (req, res) => {
      const result = await pool.query("DELETE FROM measuring_units WHERE id = $1", [req.params.id]);
      if (result.rowCount === 0) return res.status(404).json({ error: "Unit not found" });
      res.json({ deleted: true });
    })
  );

  // ─── Employees ─────────────────────────────────────────────
  const EMP_FIELDS = [
    "name",
    "phone",
    "email",
    "address",
    "designation",
    "salary_type",
    "salary_rate",
    "joining_date",
    "starting_date",
    "rank",
    "stars",
    "shift_start",
    "shift_end",
    "pf_enabled",
    "pf_rate",
    "notes"
  ];

  // The Employee page and its attendance/payroll/document backend are gone, but
  // the `employees` table stays and /employees keeps working: Tasks assigns work
  // to a person through `assigned_to`, and that dropdown is populated from here.
  // The payroll-only columns (rank, shift_*, pf_*) are left on the table rather
  // than dropped -- nothing reads them now, and removing a column is not
  // something a git revert can undo.
  const EMP_RANKS = ["noob", "pro", "prince", "king"];

  // Free-form values straight from the form, normalised for the column types.
  const empValues = (b = {}) => [
    String(b.name || "").trim() || null,
    b.phone ? String(b.phone).trim() : null,
    b.email ? String(b.email).trim() : null,
    b.address ? String(b.address).trim() : null,
    b.designation ? String(b.designation).trim() : null,
    ["salary", "wages", "freelancer"].includes(b.salary_type) ? b.salary_type : "salary",
    Number(b.salary_rate) || 0,
    b.joining_date || null,
    b.starting_date || null,
    EMP_RANKS.includes(b.rank) ? b.rank : "noob",
    Math.min(5, Math.max(1, Math.round(Number(b.stars) || 1))),
    b.shift_start || null,
    b.shift_end || null,
    b.pf_enabled === true || b.pf_enabled === "true" || b.pf_enabled === 1,
    Number(b.pf_rate) || 0,
    b.notes ? String(b.notes).trim() : null
  ];

  router.get(
    "/employees",
    h(async (_req, res) => {
      const { rows } = await pool.query(
        `SELECT id, name, phone, email, address, designation, salary_type, salary_rate,
                joining_date, starting_date, rank, stars, shift_start, shift_end,
                pf_enabled, pf_rate, notes, created_at
         FROM employees ORDER BY name`
      );
      res.json(rows);
    })
  );

  router.get(
    "/employees/:id",
    h(async (req, res) => {
      const { rows } = await pool.query(
        `SELECT id, name, phone, email, address, designation, salary_type, salary_rate,
                joining_date, starting_date, rank, stars, shift_start, shift_end,
                pf_enabled, pf_rate, notes, created_at
         FROM employees WHERE id = $1`,
        [req.params.id]
      );
      if (rows.length === 0) return res.status(404).json({ error: "Employee not found" });
      res.json(rows[0]);
    })
  );

  router.post(
    "/employees",
    h(async (req, res) => {
      const b = req.body || {};
      if (!String(b.name || "").trim()) return res.status(400).json({ error: "name is required" });
      const { rows } = await pool.query(
        `INSERT INTO employees (${EMP_FIELDS.join(", ")})
         VALUES (${EMP_FIELDS.map((_, i) => `$${i + 1}`).join(", ")})
         RETURNING id`,
        empValues(b)
      );
      res.status(201).json({ id: rows[0].id, ...b });
    })
  );

  router.put(
    "/employees/:id",
    h(async (req, res) => {
      const b = req.body || {};
      if (!String(b.name || "").trim()) return res.status(400).json({ error: "name is required" });
      const result = await pool.query(
        `UPDATE employees SET ${EMP_FIELDS.map((f, i) => `${f} = $${i + 1}`).join(", ")}
         WHERE id = $${EMP_FIELDS.length + 1}`,
        [...empValues(b), req.params.id]
      );
      if (result.rowCount === 0) return res.status(404).json({ error: "Employee not found" });
      res.json({ updated: true });
    })
  );

  router.delete(
    "/employees/:id",
    h(async (req, res) => {
      const result = await pool.query("DELETE FROM employees WHERE id = $1", [req.params.id]);
      if (result.rowCount === 0) return res.status(404).json({ error: "Employee not found" });
      res.json({ deleted: true });
    })
  );

  // ─── Voucher campaigns ────────────────────────────────────
  router.get(
    "/voucher-campaigns",
    h(async (_req, res) => {
      const { rows } = await pool.query(
        `SELECT c.*,
                CASE
                  WHEN c.start_date IS NOT NULL AND COALESCE(c.months,0) > 0
                       AND CURRENT_DATE > (date_trunc('month', c.start_date) + (c.months || ' months')::interval - interval '1 day')::date THEN 'ended'
                  WHEN c.start_date IS NOT NULL AND c.start_date > CURRENT_DATE THEN 'upcoming'
                  ELSE 'active'
                END AS computed_status,
                CASE
                  WHEN c.start_date IS NOT NULL AND COALESCE(c.months,0) > 0
                       THEN (date_trunc('month', c.start_date) + (c.months || ' months')::interval - interval '1 day')::date
                  ELSE c.end_date
                END AS valid_through
         FROM voucher_campaigns c ORDER BY c.created_at DESC, c.id DESC`
      );
      res.json(rows);
    })
  );

  router.post(
    "/voucher-campaigns",
    h(async (req, res) => {
      const b = req.body || {};
      const name = String(b.name || "").trim();
      if (!name) return res.status(400).json({ error: "Voucher name is required" });
      const baseType = b.discount_type === "percent" ? "percent" : "rupee";
      const parsedTiers = normalizeVoucherTiers(b.tiers, baseType);
      if (parsedTiers.error) return res.status(400).json({ error: parsedTiers.error });
      const tiers = parsedTiers.tiers || [];
      const primary = tiers.length ? tiers[0] : null;
      const discountType = primary ? primary.discount_type : baseType;
      const discountValue = primary ? primary.discount_value : Number(b.discount_value) || 0;
      if (discountValue <= 0) return res.status(400).json({ error: "Discount value must be greater than zero" });
      const minTotal = primary ? primary.min_total : Math.max(0, Number(b.min_total) || 0);
      const months = Number(b.months) != null ? Math.round(Number(b.months)) : 5;
      if (Number.isNaN(months) || months < 1 || months > 24) {
        return res.status(400).json({ error: "Months must be between 1 and 24" });
      }
      if (b.start_date && b.end_date && b.start_date > b.end_date) {
        return res.status(400).json({ error: "Start date must be before end date" });
      }
      const { rows } = await pool.query(
        `INSERT INTO voucher_campaigns (name, discount_type, discount_value, quantity, issue_limit, min_total, months, start_date, end_date, tiers)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) RETURNING id`,
        [
          name,
          discountType,
          discountValue,
          Math.max(0, Number(b.quantity) || 0),
          Math.max(0, Number(b.issue_limit) || 0),
          minTotal,
          months,
          b.start_date || null,
          b.end_date || null,
          JSON.stringify(tiers)
        ]
      );
      res.status(201).json(rows[0]);
    })
  );

  router.put(
    "/voucher-campaigns/:id",
    h(async (req, res) => {
      const b = req.body || {};
      const hasStart = Object.prototype.hasOwnProperty.call(b, "start_date");
      const hasEnd = Object.prototype.hasOwnProperty.call(b, "end_date");
      const hasTiers = Object.prototype.hasOwnProperty.call(b, "tiers");
      const startDate = b.start_date || null;
      const endDate = b.end_date || null;
      const { rows: [existing] } = await pool.query(
        "SELECT start_date, end_date, discount_type FROM voucher_campaigns WHERE id = $1::int",
        [req.params.id]
      );
      if (!existing) return res.status(404).json({ error: "Campaign not found" });
      const nextStart = hasStart ? startDate : dstr(existing.start_date);
      const nextEnd = hasEnd ? endDate : dstr(existing.end_date);
      if (nextStart && nextEnd && nextStart > nextEnd) {
        return res.status(400).json({ error: "Start date must be before end date" });
      }
      let tiers = null;
      let primary = null;
      if (hasTiers) {
        const fallbackType =
          b.discount_type === "percent"
            ? "percent"
            : b.discount_type === "rupee"
              ? "rupee"
              : existing.discount_type === "percent"
                ? "percent"
                : "rupee";
        const parsedTiers = normalizeVoucherTiers(b.tiers, fallbackType);
        if (parsedTiers.error) return res.status(400).json({ error: parsedTiers.error });
        tiers = parsedTiers.tiers || [];
        primary = tiers.length ? tiers[0] : null;
      }
      const discountType = primary
        ? primary.discount_type
        : b.discount_type === "percent"
          ? "percent"
          : b.discount_type === "rupee"
            ? "rupee"
            : null;
      const discountValue = primary
        ? primary.discount_value
        : b.discount_value != null
          ? Number(b.discount_value)
          : null;
      const minTotal = primary
        ? primary.min_total
        : b.min_total != null
          ? Math.max(0, Number(b.min_total))
          : null;
      const result = await pool.query(
        `UPDATE voucher_campaigns
           SET name = COALESCE($2, name),
               discount_type = COALESCE($3, discount_type),
               discount_value = COALESCE($4, discount_value),
               quantity = COALESCE($5, quantity),
               issue_limit = COALESCE($6, issue_limit),
               min_total = COALESCE($7, min_total),
               months = COALESCE($8, months),
               start_date = CASE WHEN $11::boolean THEN $9::date ELSE start_date END,
               end_date = CASE WHEN $12::boolean THEN $10::date ELSE end_date END,
               tiers = CASE WHEN $13::boolean THEN $14::jsonb ELSE tiers END
         WHERE id = $1::int`,
        [
          req.params.id,
          b.name != null ? String(b.name).trim() || null : null,
          discountType,
          discountValue,
          b.quantity != null ? Math.max(0, Number(b.quantity)) : null,
          b.issue_limit != null ? Math.max(0, Number(b.issue_limit)) : null,
          minTotal,
          b.months != null ? Math.round(Number(b.months)) : null,
          startDate,
          endDate,
          hasStart,
          hasEnd,
          hasTiers,
          hasTiers ? JSON.stringify(tiers || []) : null
        ]
      );
      if (result.rowCount === 0) return res.status(404).json({ error: "Campaign not found" });
      res.json({ updated: true });
    })
  );

  router.delete(
    "/voucher-campaigns/:id",
    h(async (req, res) => {
      const result = await pool.query("DELETE FROM voucher_campaigns WHERE id = $1", [req.params.id]);
      if (result.rowCount === 0) return res.status(404).json({ error: "Campaign not found" });
      res.json({ deleted: true });
    })
  );

  // ─── Vouchers ──────────────────────────────────────────────
  router.get(
    "/vouchers/validate",
    h(async (req, res) => {
      const code = String(req.query.code || "").trim();
      if (!/^\d{4}$/.test(code)) {
        return res.status(400).json({ valid: false, error: "Enter a valid 4-digit voucher code" });
      }
      const { rows } = await pool.query(
        `SELECT v.id, v.code, v.status, v.customer_name, v.sale_total, v.issued_at,
                c.id AS campaign_id, c.name AS campaign_name,
                COALESCE(v.discount_type, c.discount_type) AS discount_type,
                COALESCE(v.discount_value, c.discount_value) AS discount_value,
                COALESCE(v.min_total, c.min_total) AS min_total,
                c.months, c.start_date AS valid_from, c.end_date
         FROM vouchers v JOIN voucher_campaigns c ON c.id = v.campaign_id
         WHERE v.code = $1`,
        [code]
      );
      if (rows.length === 0) {
        return res.status(200).json({ valid: false, error: "Unknown voucher code" });
      }
      const v = rows[0];
      const { rows: [td] } = await pool.query("SELECT CURRENT_DATE::text AS d");
      const todayStr = td.d;
      v.uses = await loadVoucherUses(pool, v.id);
      const from = dstr(v.valid_from);
      const through = validThroughDate(v);
      const curMonth = monthKeyOf(todayStr);
      const usedThisMonth = v.uses.some((u) => u.month_key === curMonth);
      const months = Number(v.months) || 0;
      const remainingUses = Math.max(0, months - v.uses.length);
      let error = null;
      if (v.status !== "issued") error = `This voucher has already been used (${v.uses.length} times)`;
      else if (from && todayStr < from) error = `This voucher starts on ${from}`;
      else if (through && todayStr > through) error = `This voucher expired on ${through}`;
      else if (usedThisMonth) error = "This voucher is already used this month — try again next month";
      else if (months > 0 && remainingUses <= 0) error = `All ${v.uses.length} uses are done`;
      else if (req.query.total != null) {
        const minTotal = Number(v.min_total) || 0;
        if (minTotal > 0 && Number(req.query.total) < minTotal) {
          error = `Minimum shopping of Rs ${minTotal} required to use this voucher`;
        }
      }
      if (error) {
        return res.status(200).json({ valid: false, error });
      }
      res.json({
        valid: true,
        voucher: publicVoucher(v, { usesCount: v.uses.length, remainingUses, usedThisMonth, valid_from: from, valid_through: through })
      });
    })
  );

  router.get(
    "/vouchers",
    h(async (req, res) => {
      const campaignId = req.query.campaign_id ? Number(req.query.campaign_id) : null;
      const status = String(req.query.status || "").trim();
      const params = [];
      let where = "WHERE 1=1";
      if (campaignId) {
        params.push(campaignId);
        where += ` AND v.campaign_id = $${params.length}::int`;
      }
      if (status === "issued" || status === "used" || status === "redeemed") {
        if (status === "issued") {
          where += ` AND v.status = 'issued'`;
        } else {
          where += ` AND v.status IN ('used','redeemed')`;
        }
      }
      const { rows } = await pool.query(
        `SELECT v.id, v.campaign_id, v.code, v.status, v.bill_id, v.customer_name, v.sale_total,
                v.issued_at, v.redeemed_at, v.redeemed_bill_id,
                c.name AS campaign_name,
                COALESCE(v.discount_type, c.discount_type) AS discount_type,
                COALESCE(v.discount_value, c.discount_value) AS discount_value,
                COALESCE(v.min_total, c.min_total) AS min_total,
                c.months, c.start_date AS valid_from, c.end_date
         FROM vouchers v JOIN voucher_campaigns c ON c.id = v.campaign_id
         ${where}
         ORDER BY v.issued_at DESC, v.id DESC
         LIMIT 5000`,
        params
      );
      let usesByVoucher = {};
      if (rows.length > 0) {
        const ids = rows.map((r) => r.id);
        const { rows: uses } = await pool.query(
          "SELECT voucher_id, id, bill_id, month_key, discount_applied, used_at FROM voucher_uses WHERE voucher_id = ANY($1::int[]) ORDER BY used_at ASC, id ASC",
          [ids]
        );
        usesByVoucher = uses.reduce((m, u) => {
          (m[u.voucher_id] = m[u.voucher_id] || []).push(u);
          return m;
        }, {});
      }
      const { rows: [td] } = await pool.query("SELECT CURRENT_DATE::text AS d");
      const todayStr = td.d;
      res.json(
        rows.map((r) => {
          const uses = usesByVoucher[r.id] || [];
          return {
            ...r,
            use_count: uses.length,
            uses_left: Math.max(0, (Number(r.months) || 0) - uses.length),
            last_used_at: uses.length ? uses[uses.length - 1].used_at : null,
            valid_through: validThroughDate(r),
            used_this_month: uses.some((u) => u.month_key === monthKeyOf(todayStr))
          };
        })
      );
    })
  );

  router.delete(
    "/vouchers/:id",
    h(async (req, res) => {
      const result = await pool.query("DELETE FROM vouchers WHERE id = $1", [req.params.id]);
      if (result.rowCount === 0) return res.status(404).json({ error: "Voucher not found" });
      res.json({ deleted: true });
    })
  );

  // ─── Brokers ───────────────────────────────────────────────
  // Enquiry lifecycle: sent = message WhatsApped to the broker, ordered = they
  // confirmed a rate, received = goods arrived, cancelled = stood down.
  const BROKER_ENQUIRY_STATUSES = ["sent", "ordered", "received", "cancelled"];

  router.get(
    "/brokers",
    h(async (_req, res) => {
      const { rows } = await pool.query(
        `SELECT b.*,
                (SELECT COUNT(*) FROM broker_enquiries e WHERE e.broker_id = b.id)::int AS enquiry_count,
                (SELECT MAX(e.created_at) FROM broker_enquiries e WHERE e.broker_id = b.id) AS last_enquiry_at,
                (SELECT COUNT(*) FROM broker_enquiries e
                   JOIN broker_enquiry_items i ON i.enquiry_id = e.id
                  WHERE e.broker_id = b.id AND e.status <> 'cancelled')::int AS open_item_count
         FROM brokers b
         ORDER BY b.name`
      );
      res.json(rows);
    })
  );

  router.post(
    "/brokers",
    h(async (req, res) => {
      const b = req.body || {};
      const name = String(b.name || "").trim();
      const phone = String(b.phone || "").trim();
      if (!name) return res.status(400).json({ error: "Broker name is required" });
      if (!phone) return res.status(400).json({ error: "Broker phone is required to send WhatsApp" });
      const { rows } = await pool.query(
        `INSERT INTO brokers (name, company_name, phone, area, speciality, detail)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [name, b.company_name || null, phone, b.area || null, b.speciality || null, b.detail || null]
      );
      res.status(201).json({ id: rows[0].id, ...b });
    })
  );

  router.put(
    "/brokers/:id",
    h(async (req, res) => {
      const b = req.body || {};
      const name = String(b.name || "").trim();
      const phone = String(b.phone || "").trim();
      if (!name) return res.status(400).json({ error: "Broker name is required" });
      if (!phone) return res.status(400).json({ error: "Broker phone is required to send WhatsApp" });
      const result = await pool.query(
        `UPDATE brokers SET name = $1, company_name = $2, phone = $3, area = $4, speciality = $5, detail = $6
         WHERE id = $7`,
        [name, b.company_name || null, phone, b.area || null, b.speciality || null, b.detail || null, req.params.id]
      );
      if (result.rowCount === 0) return res.status(404).json({ error: "Broker not found" });
      res.json({ updated: true });
    })
  );

  router.delete(
    "/brokers/:id",
    h(async (req, res) => {
      const result = await pool.query("DELETE FROM brokers WHERE id = $1", [req.params.id]);
      if (result.rowCount === 0) return res.status(404).json({ error: "Broker not found" });
      res.json({ deleted: true });
    })
  );

  router.get(
    "/broker-enquiries",
    h(async (req, res) => {
      const status = String(req.query.status || "").trim();
      const brokerId = req.query.broker_id ? Number(req.query.broker_id) : null;
      const params = [];
      let where = "WHERE 1=1";
      if (BROKER_ENQUIRY_STATUSES.includes(status)) {
        params.push(status);
        where += ` AND e.status = $${params.length}`;
      }
      if (brokerId) {
        params.push(brokerId);
        where += ` AND e.broker_id = $${params.length}::int`;
      }
      const { rows } = await pool.query(
        `SELECT e.*, b.name AS broker_name, b.phone AS broker_phone, b.area AS broker_area,
                COUNT(i.id)::int AS item_count,
                COALESCE(SUM(i.qty), 0) AS total_qty
         FROM broker_enquiries e
         JOIN brokers b ON b.id = e.broker_id
         LEFT JOIN broker_enquiry_items i ON i.enquiry_id = e.id
         ${where}
         GROUP BY e.id, b.name, b.phone, b.area
         ORDER BY e.created_at DESC, e.id DESC
         LIMIT 500`,
        params
      );
      res.json(rows);
    })
  );

  router.get(
    "/broker-enquiries/:id",
    h(async (req, res) => {
      const { rows } = await pool.query(
        `SELECT e.*, b.name AS broker_name, b.phone AS broker_phone, b.area AS broker_area
         FROM broker_enquiries e JOIN brokers b ON b.id = e.broker_id
         WHERE e.id = $1`,
        [req.params.id]
      );
      if (rows.length === 0) return res.status(404).json({ error: "Enquiry not found" });
      const enquiry = rows[0];
      const { rows: items } = await pool.query(
        "SELECT * FROM broker_enquiry_items WHERE enquiry_id = $1 ORDER BY id",
        [req.params.id]
      );
      res.json({ ...enquiry, items });
    })
  );

  router.post(
    "/broker-enquiries",
    h(async (req, res) => {
      const b = req.body || {};
      const brokerId = Number(b.broker_id);
      if (!brokerId) return res.status(400).json({ error: "Select a broker to send the enquiry to" });

      const items = (Array.isArray(b.items) ? b.items : [])
        .map((it) => ({
          product_id: it.product_id ? Number(it.product_id) : null,
          product_name: String(it.product_name || "").trim(),
          qty: Number(it.qty) || 0,
          unit_name: String(it.unit_name || "").trim() || null,
          rate: Number(it.rate) || 0,
          note: String(it.note || "").trim() || null
        }))
        .filter((it) => it.product_name && it.qty > 0);
      if (items.length === 0) {
        return res.status(400).json({ error: "Add at least one product with a quantity" });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows: brokerRows } = await client.query("SELECT id FROM brokers WHERE id = $1", [brokerId]);
        if (brokerRows.length === 0) {
          await client.query("ROLLBACK");
          return res.status(404).json({ error: "Broker not found" });
        }

        const ref =
          String(b.reference_no || "").trim() ||
          `BR-${dstr(new Date()).replace(/-/g, "").slice(2)}-${String(Date.now()).slice(-4)}`;

        const { rows } = await client.query(
          `INSERT INTO broker_enquiries (broker_id, reference_no, notes, status)
           VALUES ($1,$2,$3,$4) RETURNING id, created_at`,
          [brokerId, ref, b.notes || null, BROKER_ENQUIRY_STATUSES.includes(b.status) ? b.status : "sent"]
        );
        const enquiryId = rows[0].id;

        for (const it of items) {
          await client.query(
            `INSERT INTO broker_enquiry_items
               (enquiry_id, product_id, product_name, qty, unit_name, rate, note)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [enquiryId, it.product_id, it.product_name, it.qty, it.unit_name, it.rate, it.note]
          );
        }
        await client.query("COMMIT");
        res.status(201).json({ id: enquiryId, reference_no: ref, created_at: rows[0].created_at });
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    })
  );

  router.patch(
    "/broker-enquiries/:id/status",
    h(async (req, res) => {
      const status = String((req.body || {}).status || "");
      if (!BROKER_ENQUIRY_STATUSES.includes(status)) {
        return res.status(400).json({ error: "Invalid enquiry status" });
      }
      const result = await pool.query("UPDATE broker_enquiries SET status = $1 WHERE id = $2", [
        status,
        req.params.id
      ]);
      if (result.rowCount === 0) return res.status(404).json({ error: "Enquiry not found" });
      res.json({ updated: true });
    })
  );

  router.delete(
    "/broker-enquiries/:id",
    h(async (req, res) => {
      const result = await pool.query("DELETE FROM broker_enquiries WHERE id = $1", [req.params.id]);
      if (result.rowCount === 0) return res.status(404).json({ error: "Enquiry not found" });
      res.json({ deleted: true });
    })
  );

  router.use((err, _req, res, _next) => {
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
    // A route that validated its own input set a 4xx status; keep it.
    const clientStatus = Number(err?.status || err?.statusCode);
    if (clientStatus >= 400 && clientStatus < 500) {
      return res.status(clientStatus).json({ error: err.message || "Bad request" });
    }
    console.error(err);
    res.status(500).json({ error: err.message || "Internal server error" });
  });

  app.use("/api", router);
}
