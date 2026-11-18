import { Router, raw } from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { streamSqlBackup, streamExcelBackup, readBackupFile, backupSummary, importSqlBackup, tablesReferencingMissing } from "./backup.js";
import { receipt58HTML } from "../client/src/lib/receipt.js";
import { printReceipt58 as printReceiptOnPrinter, printerName } from "./print.js";
import { barcodeLabelsHTML, customerLabelsHTML } from "./barcode.js";
import { monthAccrual, payrollFor, ledgerFor, RANKS, PAYMENT_TYPES, DAY_FRACTION } from "./payroll.js";
import { isSalesProfitReady, recalcSaleProfit } from "./db.js";

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
  // The month-count anchor (if the campaign set one) is preferred: a voucher
  // whose monthly clock starts on, say, Dec 1 works for N counting months
  // from that date, not from the day the campaign started issuing coupons.
  const s = dstr(c.month_count_start || c.start_date || c.valid_from);
  const months = Number(c.months) || 0;
  if (s && months > 0) {
    const [y, m] = s.slice(0, 10).split("-").map(Number);
    const day = Number(s.slice(8, 10)) || 1;
    // anchor + N months, minus one day. Clamped to the month's end so an
    // anchor like Jan 31 rolls Feb's cycle onto Feb 28, never Mar 2.
    const end = new Date(Date.UTC(y, m - 1 + months, day));
    const lastDay = new Date(Date.UTC(y, m + months, 0)).getUTCDate();
    end.setUTCDate(Math.min(day, lastDay));
    end.setUTCDate(end.getUTCDate() - 1);
    return end.toISOString().slice(0, 10);
  }
  return c.end_date ? dstr(c.end_date) : null;
}

// The counting window a use-date falls into when the "once every month" clock
// is anchored at `anchor`. Window 0 runs anchor → anchor+1 month − 1 day,
// window 1 the month after, and so on. The key is the window's start month
// ("YYYY-MM"); the UNIQUE(voucher_id, month_key) rule on voucher_uses then
// enforces exactly one use per counting window. Without an anchor the plain
// calendar month is used, as before.
function voucherMonthKey(anchor, dateStr) {
  if (!anchor || !dateStr) return monthKeyOf(dateStr);
  const [ay, am, ad] = anchor.slice(0, 10).split("-").map(Number);
  const [ty, tm, td] = dateStr.slice(0, 10).split("-").map(Number);
  if ([ay, am, ad, ty, tm, td].some(Number.isNaN)) return monthKeyOf(dateStr);
  let windowIdx = (ty - ay) * 12 + (tm - am);
  const windowStart = (n) => {
    const y = ay, m0 = am - 1 + n;
    const lastDay = new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
    return new Date(Date.UTC(y, m0, Math.min(ad, lastDay)));
  };
  let start = windowStart(windowIdx);
  while (start.getTime() > Date.UTC(ty, tm - 1, td) && windowIdx > -1) {
    windowIdx -= 1;
    start = windowStart(Math.max(windowIdx, 0));
  }
  if (windowIdx < 0) return null;
  return `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
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
  let toRestore = Math.round((Number(qty) || 0) * 1000000) / 1000000;
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
    toRestore = Math.round((toRestore - give) * 1000000) / 1000000;
  }

  while (toRestore > 0) {
    const give = Math.min(toRestore, packSize);
    await client.query(
      `INSERT INTO product_packs (product_id, pack_size, remaining, status, opened_at)
       VALUES ($1, $2, $3, 'open', LOCALTIMESTAMP)`,
      [productId, packSize, give]
    );
    toRestore = Math.round((toRestore - give) * 1000000) / 1000000;
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
  const wanted = Math.round((Number(qty) || 0) * 1000000) / 1000000;
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
      remaining = Math.round((remaining - take) * 1000000) / 1000000;
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
    drained: Math.round((wanted - remaining) * 1000000) / 1000000,
    remaining,
    packId: firstPackId
  };
}

async function drainPacks(client, { productId, qty }) {
  const { remaining } = await drainProductPacks(client, { productId, qty });
  return remaining;
}

function weightOversellAllowance(product) {
  if (String(product?.unit_category || "").toLowerCase() !== "weight") return 0;
  const factor = Number(product?.unit_factor);
  if (!(factor > 0)) return 0;
  return Math.round((1 / factor) * 10000) / 10000;
}

function availableToSell(product, reserved = 0) {
  const stock = Math.max(0, Number(product?.stock) || 0);
  const unusedAllowance = Math.max(
    0,
    weightOversellAllowance(product) - Math.max(0, Number(product?.oversold_qty) || 0)
  );
  return Math.round((stock + unusedAllowance - reserved) * 1000000) / 1000000;
}

async function consumeSaleStock(client, { productId, qty }) {
  const amount = Math.max(0, Math.round((Number(qty) || 0) * 1000000) / 1000000);
  const { rows } = await client.query(
    `WITH before AS (
       SELECT stock, oversold_qty
       FROM products
       WHERE id = $2
       FOR UPDATE
     )
     UPDATE products p
        SET oversold_qty = COALESCE(b.oversold_qty, 0)
                           + GREATEST(0, $1::numeric - GREATEST(COALESCE(b.stock, 0), 0)),
            stock = GREATEST(0, COALESCE(b.stock, 0) - $1::numeric)
       FROM before b
      WHERE p.id = $2
      RETURNING GREATEST(0, $1::numeric - GREATEST(COALESCE(b.stock, 0), 0)) AS oversold_qty`,
    [amount, productId]
  );
  if (rows.length === 0) throw new Error(`Product ${productId} not found`);
  return Number(rows[0].oversold_qty) || 0;
}

async function restoreOversoldAllowance(client, { productId, oversoldQty, saleCreatedAt = null }) {
  const amount = Math.max(0, Math.round((Number(oversoldQty) || 0) * 1000000) / 1000000);
  if (amount <= 0) return;
  await client.query(
    `UPDATE products
        SET oversold_qty = GREATEST(0, COALESCE(oversold_qty, 0) - $1)
      WHERE id = $2
        AND (oversold_reset_at IS NULL OR $3::timestamp IS NULL OR $3::timestamp >= oversold_reset_at)`,
    [amount, productId, saleCreatedAt]
  );
}

async function resetOversoldAllowance(client, productId) {
  await client.query(
    "UPDATE products SET oversold_qty = 0, oversold_reset_at = LOCALTIMESTAMP WHERE id = $1",
    [productId]
  );
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
    `SELECT si.id, si.product_id, si.qty, p.name, p.unit, p.stock, p.oversold_qty,
            COALESCE(u.category, fu.category) AS unit_category, COALESCE(u.conversion_factor, fu.conversion_factor) AS unit_factor
     FROM sale_items si
     JOIN products p ON p.id = si.product_id
     LEFT JOIN measuring_units u ON u.id = p.unit_id
     LEFT JOIN LATERAL (
       SELECT category, conversion_factor
       FROM measuring_units
       WHERE p.unit_id IS NULL
         AND (LOWER(short_name) = LOWER(TRIM(p.unit)) OR LOWER(name) = LOWER(TRIM(p.unit)))
       LIMIT 1
     ) fu ON true
     WHERE si.sale_id = $1
     ORDER BY si.id`,
    [saleId]
  );
  const reservedByProduct = new Map();
  const shortages = [];
  for (const it of items) {
    const productId = Number(it.product_id);
    const reserved = reservedByProduct.get(productId) || 0;
    const available = availableToSell(it, reserved);
    if (Number(it.qty) > available + 0.00005) {
      shortages.push({ ...it, available });
    } else {
      reservedByProduct.set(productId, reserved + (Number(it.qty) || 0));
    }
  }
  if (shortages.length > 0) {
    const detail = shortages
      .map((it) => `${it.name} (need ${Number(it.qty)}, have ${it.available})`)
      .join(", ");
    return { error: `Insufficient stock: ${detail}`, code: 400 };
  }

  for (const it of items) {
    await drainProductPacks(client, { productId: it.product_id, qty: it.qty });
    const oversoldQty = await consumeSaleStock(client, {
      productId: it.product_id,
      qty: it.qty
    });
    await client.query("UPDATE sale_items SET oversold_qty = $1 WHERE id = $2", [
      oversoldQty,
      it.id
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

  // A booking earns its points when it is confirmed, because that is when the
  // customer actually gets the goods. Award them only once even if re-saved.
  if (sale.customer_id) {
    const program = await getActivePointProgram(client);
    const earned = pointsForTotal(total, program);
    if (earned > 0 && Math.trunc(Number(sale.points_earned) || 0) === 0) {
      await client.query(
        "UPDATE sales SET points_earned = $1, point_program_id = $2 WHERE id = $3",
        [earned, program?.id || null, saleId]
      );
      await adjustCustomerPoints(client, {
        customerId: sale.customer_id,
        change: earned,
        reason: `Earned on ${sale.invoice_no}`,
        saleId,
        program
      });
    }
  }
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

// A purchase stores exactly ONE product_packs record per line, sized to the
// whole quantity bought. Rewriting the row-per-pack design (100 single units =>
// 100 rows, and a 100,000,000-unit lot wedging the server trying to write 100
// million) into one aggregate record keeps the Packs page readable and the
// database small without changing any of the money maths:
//
//   - stock on hand is still SUM(product_packs.remaining), so the aggregate row
//     reports exactly the quantity purchased;
//   - FIFO draining subtracts from `remaining` however tiny or big the sale is;
//   - returns credit stock back into the same aggregate row;
//   - status flips closed -> open on the first sale, exactly as before.
async function insertPurchasePacks(client, { productId, purchaseId, totalQty, remaining = totalQty }) {
  const total = Number(totalQty) || 0;
  const left = Math.max(0, Math.min(total, Number(remaining) || 0));
  if (total <= 0) return;
  const status = left <= 0 ? "empty" : left < total ? "open" : "closed";
  const openedAt = status === "open" ? new Date() : null;
  await client.query(
    `INSERT INTO product_packs (product_id, purchase_id, pack_size, remaining, status, opened_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [productId, purchaseId, total, left, status, openedAt]
  );
}

async function loadPurchaseStockUsage(client, purchaseId) {
  const { rows } = await client.query(
    `WITH item_qty AS (
       SELECT product_id, SUM(quantity) AS qty
       FROM supplier_purchase_items
       WHERE purchase_id = $1 AND product_id IS NOT NULL
       GROUP BY product_id
     ), pack_qty AS (
       SELECT product_id, SUM(remaining) AS remaining
       FROM product_packs
       WHERE purchase_id = $1 AND product_id IS NOT NULL
       GROUP BY product_id
     )
     SELECT i.product_id, p.name, p.unit, i.qty,
            COALESCE(pk.remaining, i.qty) AS remaining
     FROM item_qty i
     JOIN products p ON p.id = i.product_id
     LEFT JOIN pack_qty pk ON pk.product_id = i.product_id`,
    [purchaseId]
  );
  return new Map(
    rows.map((row) => {
      const qty = Number(row.qty) || 0;
      const remaining = Number(row.remaining) || 0;
      return [
        Number(row.product_id),
        {
          name: row.name,
          unit: row.unit,
          qty,
          remaining,
          consumed: Math.max(0, qty - remaining)
        }
      ];
    })
  );
}

// Loyalty points are earned at the active programme's rate and spent against
// FIFO lots, so a balance built under an old programme keeps its old value.
// The sale stores what it granted/redeemed, and every change is appended to
// customer_points_ledger. The customer row is locked while its balance moves.
const POINTS_PER_RUPEES = 100;

const pointValueOf = (program) => {
  const v = Number(program?.point_value);
  return Number.isFinite(v) && v >= 0 ? v : 1;
};

const earnPerOf = (program) => {
  const v = Number(program?.earn_per);
  return Number.isFinite(v) && v > 0 ? v : POINTS_PER_RUPEES;
};

const pointsForTotal = (total, program = null) => {
  const n = Number(total) || 0;
  if (!program || n <= 0) return 0;
  return Math.floor(n / earnPerOf(program));
};

async function getActivePointProgram(client, at = null) {
  const { rows } = await client.query(
    `SELECT * FROM point_programs
      WHERE active = TRUE
        AND (starts_on IS NULL OR starts_on <= COALESCE($1::date, CURRENT_DATE))
        AND (ends_on IS NULL OR ends_on >= COALESCE($1::date, CURRENT_DATE))
      ORDER BY starts_on DESC NULLS LAST, id DESC
      LIMIT 1`,
    [at]
  );
  return rows[0] || null;
}

async function getPointProgramById(client, id) {
  const programId = Number(id) || null;
  if (!programId) return null;
  const { rows } = await client.query("SELECT * FROM point_programs WHERE id = $1", [programId]);
  return rows[0] || null;
}

async function adjustCustomerPoints(
  client,
  { customerId, change, reason, saleId = null, program = null, preferSaleId = null }
) {
  const id = Number(customerId) || null;
  const delta = Math.trunc(Number(change) || 0);
  if (!id || delta === 0) return null;
  const { rows } = await client.query("SELECT points FROM customers WHERE id = $1 FOR UPDATE", [id]);
  if (rows.length === 0) return null;
  const current = Math.trunc(Number(rows[0].points) || 0);

  if (delta > 0) {
    const value = pointValueOf(program);
    const programId = program?.id || null;
    await client.query(
      `INSERT INTO customer_point_lots
         (customer_id, program_id, sale_id, points, remaining, point_value, note)
       VALUES ($1,$2,$3,$4,$4,$5,$6)`,
      [id, programId, saleId, delta, value, reason || null]
    );
    const next = current + delta;
    await client.query("UPDATE customers SET points = $1 WHERE id = $2", [next, id]);
    await client.query(
      `INSERT INTO customer_points_ledger
         (customer_id, sale_id, program_id, point_value, kind, change, balance, reason)
       VALUES ($1,$2,$3,$4,'earn',$5,$6,$7)`,
      [id, saleId, programId, value, delta, next, reason || null]
    );
    return next;
  }

  let toRemove = Math.min(-delta, current);
  if (toRemove <= 0) return current;
  const order = preferSaleId
    ? "CASE WHEN sale_id = $2 THEN 0 ELSE 1 END, earned_at ASC, id ASC"
    : "earned_at ASC, id ASC";
  const params = preferSaleId ? [id, preferSaleId] : [id];
  const { rows: lots } = await client.query(
    `SELECT id, remaining, point_value FROM customer_point_lots
      WHERE customer_id = $1 AND remaining > 0
      ORDER BY ${order}
      FOR UPDATE`,
    params
  );
  let removedValue = 0;
  for (const lot of lots) {
    if (toRemove <= 0) break;
    const take = Math.min(toRemove, Number(lot.remaining) || 0);
    if (take <= 0) continue;
    await client.query("UPDATE customer_point_lots SET remaining = remaining - $1 WHERE id = $2", [
      take,
      lot.id
    ]);
    removedValue += take * (Number(lot.point_value) || 0);
    toRemove -= take;
  }
  const applied = Math.min(-delta, current) - toRemove;
  if (applied <= 0) return current;
  const next = current - applied;
  await client.query("UPDATE customers SET points = $1 WHERE id = $2", [next, id]);
  const weighted = Math.round((removedValue / applied) * 10000) / 10000;
  await client.query(
    `INSERT INTO customer_points_ledger
       (customer_id, sale_id, program_id, point_value, kind, change, balance, reason)
     VALUES ($1,$2,$3,$4,'adjust',$5,$6,$7)`,
    [id, saleId, program?.id || null, weighted, -applied, next, reason || null]
  );
  return next;
}

// Spend whole points, oldest lots first, never letting the discount exceed the
// bill. Returns the points actually used and the rupee value they removed.
async function redeemCustomerPoints(client, { customerId, points, maxDiscount, reason, saleId = null }) {
  const id = Number(customerId) || null;
  const requested = Math.trunc(Number(points) || 0);
  if (!id || requested <= 0) return { points: 0, discount: 0, allocations: [] };
  const { rows: cust } = await client.query("SELECT points FROM customers WHERE id = $1 FOR UPDATE", [id]);
  if (cust.length === 0) throw new Error("Customer not found");
  const balance = Math.trunc(Number(cust[0].points) || 0);
  if (balance <= 0) throw new Error("This customer has no points to redeem");
  const { rows: lots } = await client.query(
    `SELECT id, remaining, point_value FROM customer_point_lots
      WHERE customer_id = $1 AND remaining > 0
      ORDER BY earned_at ASC, id ASC
      FOR UPDATE`,
    [id]
  );
  let leftPoints = Math.min(requested, balance);
  let leftDiscount = Math.max(0, Number(maxDiscount) || 0);
  let usedPoints = 0;
  let discount = 0;
  const allocations = [];
  for (const lot of lots) {
    if (leftPoints <= 0 || leftDiscount <= 0) break;
    const value = Number(lot.point_value) || 0;
    const available = Number(lot.remaining) || 0;
    if (value <= 0) {
      const take = Math.min(leftPoints, available);
      if (take > 0) {
        allocations.push({ lotId: lot.id, points: take, pointValue: 0, discount: 0 });
        usedPoints += take;
        leftPoints -= take;
      }
      continue;
    }
    const affordable = Math.floor((leftDiscount + 1e-9) / value);
    const take = Math.min(leftPoints, available, affordable);
    if (take <= 0) break;
    const amount = Math.round(take * value * 100) / 100;
    allocations.push({ lotId: lot.id, points: take, pointValue: value, discount: amount });
    usedPoints += take;
    discount += amount;
    leftPoints -= take;
    leftDiscount -= amount;
  }
  discount = Math.round(discount * 100) / 100;
  if (usedPoints <= 0) return { points: 0, discount: 0, allocations: [] };
  for (const a of allocations) {
    await client.query("UPDATE customer_point_lots SET remaining = remaining - $1 WHERE id = $2", [
      a.points,
      a.lotId
    ]);
  }
  const next = balance - usedPoints;
  await client.query("UPDATE customers SET points = $1 WHERE id = $2", [next, id]);
  const weighted = Math.round((discount / usedPoints) * 10000) / 10000;
  await client.query(
    `INSERT INTO customer_points_ledger
       (customer_id, sale_id, program_id, point_value, kind, change, balance, reason)
     VALUES ($1,$2,NULL,$3,'redeem',$4,$5,$6)`,
    [id, saleId, weighted, -usedPoints, next, reason || null]
  );
  return { points: usedPoints, discount, allocations };
}

// Put redeemed points back when their bill is deleted. Mixed-value lots cannot
// be rebuilt exactly, so restore one lot at the weighted average value.
async function restoreRedeemedPoints(client, { customerId, saleId, points, discount, programId, reason }) {
  const id = Number(customerId) || null;
  const pts = Math.trunc(Number(points) || 0);
  if (!id || pts <= 0) return;
  const { rows } = await client.query("SELECT points FROM customers WHERE id = $1 FOR UPDATE", [id]);
  if (rows.length === 0) return;
  const value = Math.round(((Number(discount) || 0) / pts) * 10000) / 10000;
  await client.query(
    `INSERT INTO customer_point_lots
       (customer_id, program_id, sale_id, points, remaining, point_value, note)
     VALUES ($1,$2,NULL,$3,$3,$4,$5)`,
    [id, programId || null, pts, value, reason || null]
  );
  const next = Math.trunc(Number(rows[0].points) || 0) + pts;
  await client.query("UPDATE customers SET points = $1 WHERE id = $2", [next, id]);
  await client.query(
    `INSERT INTO customer_points_ledger
       (customer_id, sale_id, program_id, point_value, kind, change, balance, reason)
     VALUES ($1,$2,$3,$4,'restore',$5,$6,$7)`,
    [id, saleId, programId || null, value, pts, next, reason || null]
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

// A purchase can carry several bill photos. The client sends a list whose
// entries are either fresh base64 data URLs (saved to disk) or URLs already
// stored in /uploads (kept as they are, so an edit can keep existing photos).
// Returns the deduplicated list of /uploads URLs; anything unusable is skipped,
// exactly like the single-image flow behaved. `legacySingle` keeps the old
// one-image clients (and the paired mobile app) working.
const MAX_BILL_IMAGES = 10;

function saveBillImages(list, legacySingle) {
  const entries = Array.isArray(list) ? list : legacySingle ? [legacySingle] : [];
  if (entries.length > MAX_BILL_IMAGES) {
    throw new Error(`A purchase can carry at most ${MAX_BILL_IMAGES} bill images`);
  }
  const out = [];
  for (const entry of entries) {
    const url = saveBillImage(entry);
    if (url && !out.includes(url)) out.push(url);
  }
  return out;
}

// Everything a purchase photo edit needs to know about the row's current
// images: the stored JSONB array plus the legacy single-image column, merged
// without duplicates (the mobile app still writes only bill_image).
function purchaseImageList(row) {
  const list = Array.isArray(row?.bill_images)
    ? row.bill_images.filter((u) => typeof u === "string" && u.trim() !== "")
    : [];
  if (typeof row?.bill_image === "string" && row.bill_image !== "" && !list.includes(row.bill_image)) {
    list.push(row.bill_image);
  }
  return list;
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

// Employee papers and profile photos live under their own folder so deleting an
// employee never touches the Business Documents library.
const EMP_DOC_PREFIX = "/uploads/employees/";
const EMP_DOC_MAX_BYTES = 10 * 1024 * 1024;
const EMP_DOC_MIME = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel.sheet.macroEnabled.12",
  "text/csv",
  "text/plain",
  "application/rtf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/bmp"
]);

async function persistEmployeeDoc(employeeId, buf, mime, originalName) {
  if (!buf || !buf.length) throw Object.assign(new Error("No file received"), { status: 400 });
  const resolved = mimeForUpload(mime, originalName);
  if (!EMP_DOC_MIME.has(resolved)) {
    throw Object.assign(new Error("Unsupported file type. Upload an image, PDF, Word, Excel or text file."), { status: 400 });
  }
  if (buf.length > EMP_DOC_MAX_BYTES) {
    throw Object.assign(new Error(`File exceeds ${EMP_DOC_MAX_BYTES / (1024 * 1024)}MB`), { status: 400 });
  }
  const ext = DOC_EXT[resolved];
  const dir = path.join(UPLOADS_DIR, "employees", String(employeeId));
  await fs.promises.mkdir(dir, { recursive: true });
  const name = `emp-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${ext}`;
  await fs.promises.writeFile(path.join(dir, name), buf);
  return { file_path: `${EMP_DOC_PREFIX}${employeeId}/${name}`, file_type: resolved, file_size: buf.length };
}

function removeEmployeeDocPath(p) {
  if (typeof p === "string" && p.startsWith(EMP_DOC_PREFIX)) {
    try {
      fs.unlinkSync(path.join(UPLOADS_DIR, p.replace(/^\/uploads\//, "")));
    } catch {
      /* ignore */
    }
  }
}

async function persistEmployeePhoto(employeeId, buf, mime, originalName) {
  if (!buf || !buf.length) throw Object.assign(new Error("No file received"), { status: 400 });
  const resolved = mimeForUpload(mime, originalName);
  if (!resolved.startsWith("image/")) {
    throw Object.assign(new Error("Profile photo must be an image."), { status: 400 });
  }
  if (buf.length > 8 * 1024 * 1024) {
    throw Object.assign(new Error("Profile photo exceeds 8MB"), { status: 400 });
  }
  const ext = DOC_EXT[resolved] || "jpg";
  const dir = path.join(UPLOADS_DIR, "employees", String(employeeId));
  await fs.promises.mkdir(dir, { recursive: true });
  const name = `photo-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${ext}`;
  await fs.promises.writeFile(path.join(dir, name), buf);
  return { file_path: `${EMP_DOC_PREFIX}${employeeId}/${name}`, file_type: resolved, file_size: buf.length };
}

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
const MAX_SEARCH_RESULTS = 50;

function paging(req, fallback = 50) {
  const raw = Number(req.query.limit);
  const limit = Math.min(Math.max(Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : fallback, 1), MAX_PAGE_SIZE);
  const rawOff = Number(req.query.offset);
  const offset = Math.max(Number.isFinite(rawOff) && rawOff > 0 ? Math.trunc(rawOff) : 0, 0);
  return { limit, offset };
}

function pageParams(req, fallback = 20) {
  const rawLimit = Number(req.query.limit);
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) && rawLimit > 0 ? Math.trunc(rawLimit) : fallback, 1), MAX_PAGE_SIZE);
  const rawPage = Number(req.query.page);
  const page = Math.max(Number.isFinite(rawPage) && rawPage > 0 ? Math.trunc(rawPage) : 1, 1);
  return { page, limit, offset: (page - 1) * limit };
}

// Sales pages are ordered by (created_at, id). A cursor stores the last row a
// page returned so the next page can continue with an index range instead of
// asking PostgreSQL to walk and discard thousands of earlier rows.
function encodeCursor(row) {
  if (!row?.created_at_key || !row?.id) return null;
  return Buffer.from(`${row.created_at_key}|${row.id}`, "utf8").toString("base64url");
}

function decodeCursor(value) {
  if (!value) return null;
  try {
    const raw = Buffer.from(String(value), "base64url").toString("utf8");
    const split = raw.lastIndexOf("|");
    if (split < 1) return null;
    const created = raw.slice(0, split);
    const id = Number(raw.slice(split + 1));
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(created)) return null;
    if (!Number.isInteger(id) || id <= 0) return null;
    return { created, id };
  } catch {
    return null;
  }
}

function normalizeName(s) {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

// Empty strings become NULL so the products trigger can assign a generated
// barcode. A manually typed supplier barcode is kept exactly as scanned.
function normalizeBarcode(s) {
  const value = String(s || "").trim();
  return value === "" ? null : value;
}

const roundWeight = (value) => Math.round((Number(value) || 0) * 1000) / 1000;

function weightLabel(grams) {
  const g = roundWeight(grams);
  if (g >= 1000) {
    const kg = Math.round((g / 1000) * 1000) / 1000;
    return `${kg} kg`;
  }
  return `${g} g`;
}

function weightBarcodeValue(grams) {
  return `WT:${roundWeight(grams)}`;
}

function serializeWeightBarcode(row) {
  return {
    id: row.id,
    weight_g: roundWeight(row.weight_g),
    weight_label: weightLabel(row.weight_g),
    barcode: row.barcode,
    copies: Number(row.copies) || 1,
    created_at: row.created_at
  };
}

// The shop stays open past midnight, so a bill taken at 1 AM belongs to the
// business day that began the previous morning, not to the new calendar date.
// Every sales window and daily chart below classifies a sale by shifting its
// timestamp back this many hours: a cut-off of 4 keeps the "early hours" of
// tonight in yesterday's books, matching how a shop keeps its day book.
const DAY_CLOSE_HOUR = 4;
const BIZ_SHIFT = `interval '${DAY_CLOSE_HOUR} hours'`;

// The shop's own calendar, used for "today"/"yesterday" and voucher month keys.
// It must match the zone the database connections run in (db.js), otherwise a
// morning bill can be filed under one date by SQL and another by JS.
const SHOP_TZ = process.env.SHOP_TZ || "Asia/Kolkata";
const shopDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: SHOP_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

function todayStr() {
  return shopDay.format(new Date());
}

function addDays(days) {
  return shopDay.format(new Date(Date.now() + days * 86400000));
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
  ["onlineStoreUrl", "online_store_url", ""],
  ["invoiceNextNo", "invoice_next_no", ""]
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

// Custom invoice numbers look like RSM-001: a prefix followed by a number.
// Splitting them lets the counter roll over and keep the same digit width.
function parseInvoiceNumber(value) {
  const match = String(value || "").trim().match(/^(.*?)(\d+)$/);
  if (!match) return null;
  return { prefix: match[1], number: Number(match[2]), width: match[2].length };
}

// A counter row replaces the old MAX(invoice_no) scan. The row is updated with
// a single atomic statement, so concurrent tills get different numbers without
// an advisory lock or a full scan of the sales table.
async function allocateInvoiceNo(client) {
  const { rows: [settings] } = await client.query(
    "SELECT invoice_next_no FROM store_info WHERE id = 1"
  );
  const configured = parseInvoiceNumber(settings?.invoice_next_no);
  const key = configured ? configured.prefix : "INV-";
  const width = configured ? configured.width : 4;
  const minLast = configured ? Math.max(0, configured.number - 1) : 0;

  const { rows: existing } = await client.query(
    "SELECT 1 FROM invoice_counters WHERE name = $1",
    [key]
  );
  if (existing.length === 0) {
    const { rows: [maxRow] } = await client.query(
      `SELECT COALESCE(MAX(SUBSTRING(invoice_no FROM $1)::BIGINT), 0) AS max_no
         FROM sales
        WHERE invoice_no >= $2 AND invoice_no < $3
          AND SUBSTRING(invoice_no FROM $1) ~ '^[0-9]+$'`,
      [key.length + 1, key, key + "\uffff"]
    );
    const lastUsed = Math.max(minLast, Number(maxRow.max_no) || 0);
    await client.query(
      `INSERT INTO invoice_counters (name, value, width)
       VALUES ($1, $2, $3)
       ON CONFLICT (name) DO NOTHING`,
      [key, lastUsed, width]
    );
  }

  const nextSeed = configured ? configured.number : 1;
  const { rows: [counter] } = await client.query(
    `INSERT INTO invoice_counters (name, value, width)
     VALUES ($1, $2, $3)
     ON CONFLICT (name) DO UPDATE
       SET value = GREATEST(invoice_counters.value, EXCLUDED.value - 1) + 1,
           width = EXCLUDED.width
     RETURNING value, width`,
    [key, nextSeed, width]
  );
  const nextNo = Number(counter.value);
  const outWidth = Number(counter.width) || width;
  const invoiceNo = `${key}${String(nextNo).padStart(outWidth, "0")}`;

  if (configured) {
    const following = `${key}${String(nextNo + 1).padStart(outWidth, "0")}`;
    await client.query(
      `UPDATE store_info
          SET invoice_next_no = $1, updated_at = LOCALTIMESTAMP
        WHERE id = 1`,
      [following]
    );
  }

  return { invoiceNo, nextNo, width: outWidth, configured };
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
    const nextInvoice = String(body.invoiceNextNo ?? "").trim();
    if (nextInvoice && !/^.+?\d+$/.test(nextInvoice)) {
      return res.status(400).json({ error: "Invoice number must end with a number, e.g. RSM-001" });
    }
    if (nextInvoice.length > 30) {
      return res.status(400).json({ error: "Invoice number is too long (maximum 30 characters)" });
    }
    body.invoiceNextNo = nextInvoice;
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
                               tagline, whatsapp_number, delivery_fee, online_store_enabled, online_store_url,
                               invoice_next_no)
       VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
               $13, $14, $15, $16, $17, $18)
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
         invoice_next_no = EXCLUDED.invoice_next_no,
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

router.post(
  "/print/barcode-labels",
  h(async (req, res) => {
    const body = req.body || {};
    const products = Array.isArray(body.products) ? body.products : [];
    if (!products.length) {
      return res.status(400).json({ error: "At least one product is required" });
    }
    if (products.length > 2000) {
      return res.status(400).json({ error: "Too many labels in one print job" });
    }
    const storeInfo =
      body.storeInfo && typeof body.storeInfo === "object" && !Array.isArray(body.storeInfo)
        ? body.storeInfo
        : {};
    const copies = Math.max(1, Math.min(50, Number(body.copies) || 1));

    const html = barcodeLabelsHTML(storeInfo, products, { copies });
    try {
      const result = await printReceiptOnPrinter(html);
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(502).json({ error: `Could not print on ${printerName()}: ${e.message}` });
    }
  })
);

router.post(
  "/print/customer-cards",
  h(async (req, res) => {
    const body = req.body || {};
    const customers = Array.isArray(body.customers) ? body.customers : [];
    if (!customers.length) {
      return res.status(400).json({ error: "At least one customer is required" });
    }
    if (customers.length > 2000) {
      return res.status(400).json({ error: "Too many cards in one print job" });
    }
    const storeInfo =
      body.storeInfo && typeof body.storeInfo === "object" && !Array.isArray(body.storeInfo)
        ? body.storeInfo
        : {};
    const copies = Math.max(1, Math.min(50, Number(body.copies) || 1));

    const html = customerLabelsHTML(storeInfo, customers, { copies });
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
      const profitReady = isSalesProfitReady();
      const monthProfitSql = profitReady
        ? `SELECT COALESCE(SUM(profit),0) AS profit
             FROM sales
            WHERE created_at >= ($1::date + ${BIZ_SHIFT})`
        : `SELECT COALESCE(SUM(si.profit),0)
                  - COALESCE((SELECT SUM(vu.discount_applied) FROM voucher_uses vu JOIN sales sv ON sv.id = vu.bill_id
                               WHERE sv.created_at >= ($1::date + ${BIZ_SHIFT})),0)
                  - COALESCE((SELECT SUM(sv.points_discount) FROM sales sv
                               WHERE sv.created_at >= ($1::date + ${BIZ_SHIFT})),0) AS profit
             FROM sale_items si
             JOIN sales s ON s.id = si.sale_id
            WHERE s.created_at >= ($1::date + ${BIZ_SHIFT})`;

      const [
        todaySales,
        yestSales,
        monthSales,
        monthCost,
        monthProfitRow,
        monthPointsRow,
        monthReturnProfitRow,
        monthExpenseRow,
        stockSummary,
        outstandingRow,
        counts,
        assetsRow
      ] = await Promise.all([
        pool.query(
          `SELECT COALESCE(SUM(total),0) AS total, COALESCE(SUM(paid),0) AS paid FROM sales WHERE created_at >= ($1::date + ${BIZ_SHIFT}) AND created_at < ($1::date + 1 + ${BIZ_SHIFT})`,
          [day]
        ).then((r) => r.rows[0]),
        pool.query(`SELECT COALESCE(SUM(total),0) AS total FROM sales WHERE created_at >= ($1::date + ${BIZ_SHIFT}) AND created_at < ($1::date + 1 + ${BIZ_SHIFT})`, [yestStr]).then((r) => r.rows[0]),
        pool.query(
          `SELECT COALESCE(SUM(total),0) AS total, COALESCE(SUM(paid),0) AS paid FROM sales WHERE created_at >= ($1::date + ${BIZ_SHIFT})`,
          [month]
        ).then((r) => r.rows[0]),
        pool.query(
          `SELECT COALESCE(SUM(si.qty * si.purchase_price),0) AS cost
           FROM sale_items si
           JOIN sales s ON s.id = si.sale_id
           WHERE s.created_at >= ($1::date + ${BIZ_SHIFT})`,
          [month]
        ).then((r) => r.rows[0].cost),
        pool.query(monthProfitSql, [month]).then((r) => r.rows[0].profit),
        pool.query(
          `SELECT COALESCE(SUM(points_discount),0) AS total
           FROM sales WHERE created_at >= ($1::date + ${BIZ_SHIFT})`,
          [month]
        ).then((r) => r.rows[0].total),
        pool.query(
          `SELECT COALESCE(SUM(profit),0) AS total
           FROM sale_returns WHERE created_at >= ($1::date + ${BIZ_SHIFT})`,
          [month]
        ).then((r) => r.rows[0].total),
        pool.query("SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE date >= $1::date", [month]).then((r) => r.rows[0].total),
        pool.query(
          `WITH latest_cost AS (
             SELECT DISTINCT ON (spi.product_id) spi.product_id, spi.purchase_price
             FROM supplier_purchase_items spi
             WHERE spi.product_id IN (SELECT product_id FROM product_stock)
             ORDER BY spi.product_id, spi.created_at DESC
           ),
           vals AS (
             SELECT COALESCE(SUM(ps.stock * COALESCE(lc.purchase_price, p.purchase_price)), 0) AS stock_value,
                    COALESCE(SUM(ps.stock * p.selling_price), 0) AS retail_value
             FROM product_stock ps
             JOIN products p ON p.id = ps.product_id
             LEFT JOIN latest_cost lc ON lc.product_id = ps.product_id
           ),
           low AS (
             SELECT p.id, p.name, p.unit, p.reorder_level, p.selling_price,
                    COALESCE(ps.stock, 0) AS total_stock, c.name AS category
             FROM products p
             LEFT JOIN product_stock ps ON ps.product_id = p.id
             LEFT JOIN categories c ON c.id = p.category_id
             WHERE p.reorder_level > 0 AND COALESCE(ps.stock, 0) <= p.reorder_level
             ORDER BY (COALESCE(ps.stock, 0) / (p.reorder_level + 0.0001)) ASC
             LIMIT 200
           )
           SELECT vals.stock_value, vals.retail_value,
                  COALESCE((
                    SELECT json_agg(json_build_object(
                             'id', l.id, 'name', l.name, 'unit', l.unit,
                             'stock', l.total_stock, 'reorder_level', l.reorder_level,
                             'category', l.category, 'selling_price', l.selling_price))
                    FROM low l
                  ), '[]'::json) AS low_stock
           FROM vals`
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
            `SELECT to_char(created_at - ${BIZ_SHIFT}, 'YYYY-MM-DD') AS day, SUM(total) AS revenue
             FROM sales
             WHERE created_at >= ($1::date + ${BIZ_SHIFT}) AND created_at < ($2::date + ${BIZ_SHIFT})
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
             WHERE s.created_at >= ($1::date + ${BIZ_SHIFT}) AND s.created_at < ($1::date + INTERVAL '1 month' + ${BIZ_SHIFT})
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
             WHERE s.created_at >= ($1::date + ${BIZ_SHIFT}) AND s.created_at < ($1::date + INTERVAL '1 month' + ${BIZ_SHIFT})
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
          monthProfit: Math.round((Number(monthProfitRow) || 0) - (Number(monthReturnProfitRow) || 0)),
          monthPointsDiscount: Math.round(Number(monthPointsRow) || 0),
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
      // Reporting over every historical sale is what made the old dashboard
      // unusable at scale. Keep the widest window to twelve months.
      const cap = new Date(`${to}T12:00:00`);
      cap.setFullYear(cap.getFullYear() - 1);
      const capFrom = `${cap.getFullYear()}-${p(cap.getMonth() + 1)}-${p(cap.getDate())}`;
      if (from < capFrom) from = capFrom;
      const end = new Date(Date.parse(`${to}T12:00:00`));
      end.setDate(end.getDate() + 1);
      const endExcl = `${end.getFullYear()}-${p(end.getMonth() + 1)}-${p(end.getDate())}`;

      const days = [];
      const dStart = new Date(`${from}T12:00:00`);
      const dEnd = new Date(`${to}T12:00:00`);
      for (let d = dStart; d <= dEnd; d.setDate(d.getDate() + 1)) {
        days.push(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
      }

      const profitReady = isSalesProfitReady();
      const statsProfitSql = profitReady
        ? `SELECT COALESCE((SELECT SUM(profit) FROM sales
                             WHERE created_at >= ($1::date + ${BIZ_SHIFT}) AND created_at < ($2::date + ${BIZ_SHIFT})),0)
                  - COALESCE((SELECT SUM(profit) FROM sale_returns
                               WHERE created_at >= ($1::date + ${BIZ_SHIFT}) AND created_at < ($2::date + ${BIZ_SHIFT})),0) AS profit,
                  COALESCE((SELECT SUM(si.qty * si.purchase_price)
                              FROM sale_items si JOIN sales s ON s.id = si.sale_id
                             WHERE s.created_at >= ($1::date + ${BIZ_SHIFT}) AND s.created_at < ($2::date + ${BIZ_SHIFT})),0) AS cost`
        : `SELECT COALESCE(SUM(si.profit),0)
                  - COALESCE((SELECT SUM(vu.discount_applied) FROM voucher_uses vu JOIN sales sv ON sv.id = vu.bill_id
                               WHERE sv.created_at >= ($1::date + ${BIZ_SHIFT}) AND sv.created_at < ($2::date + ${BIZ_SHIFT})),0)
                  - COALESCE((SELECT SUM(sv.points_discount) FROM sales sv
                               WHERE sv.created_at >= ($1::date + ${BIZ_SHIFT}) AND sv.created_at < ($2::date + ${BIZ_SHIFT})),0)
                  - COALESCE((SELECT SUM(r.profit) FROM sale_returns r
                               WHERE r.created_at >= ($1::date + ${BIZ_SHIFT}) AND r.created_at < ($2::date + ${BIZ_SHIFT})),0) AS profit,
                  COALESCE(SUM(si.qty * si.purchase_price),0) AS cost
           FROM sale_items si JOIN sales s ON s.id = si.sale_id
           WHERE s.created_at >= ($1::date + ${BIZ_SHIFT}) AND s.created_at < ($2::date + ${BIZ_SHIFT})`;
      const dailyProfitSql = profitReady
        ? `SELECT to_char(created_at - ${BIZ_SHIFT}, 'YYYY-MM-DD') AS day, SUM(COALESCE(profit,0)) AS v
             FROM sales WHERE created_at >= ($1::date + ${BIZ_SHIFT}) AND created_at < ($2::date + ${BIZ_SHIFT}) GROUP BY 1`
        : `SELECT day, SUM(item_profit - voucher_discount - points_discount) AS v FROM (
             SELECT to_char(s.created_at - ${BIZ_SHIFT}, 'YYYY-MM-DD') AS day,
                    COALESCE(it.profit, 0) AS item_profit,
                    COALESCE(vd.discount, 0) AS voucher_discount,
                    COALESCE(s.points_discount, 0) AS points_discount
               FROM sales s
               LEFT JOIN LATERAL (
                 SELECT COALESCE(SUM(si.profit),0) AS profit
                   FROM sale_items si WHERE si.sale_id = s.id
               ) it ON TRUE
               LEFT JOIN (
                 SELECT bill_id, SUM(discount_applied) AS discount
                   FROM voucher_uses
                  GROUP BY bill_id
               ) vd ON vd.bill_id = s.id
              WHERE s.created_at >= ($1::date + ${BIZ_SHIFT}) AND s.created_at < ($2::date + ${BIZ_SHIFT})
           ) t GROUP BY 1`;

      const [
        summary,
        costProfit,
        expensesRow,
        dailyRev,
        dailyProfit,
        dailyReturnProfit,
        dailyExp,
        pointsRow
      ] = await Promise.all([
        pool.query(
          `SELECT COALESCE(SUM(total),0) AS revenue, COALESCE(SUM(paid),0) AS paid, COUNT(*) AS orders
           FROM sales WHERE created_at >= ($1::date + ${BIZ_SHIFT}) AND created_at < ($2::date + ${BIZ_SHIFT})`,
          [from, endExcl]
        ),
        pool.query(statsProfitSql, [from, endExcl]),
         pool.query(
           `SELECT COALESCE(SUM(amount),0) AS total FROM expenses
           WHERE date >= $1::date AND date < $2::date`,
          [from, endExcl]
        ),
        pool.query(
          `SELECT to_char(created_at - ${BIZ_SHIFT}, 'YYYY-MM-DD') AS day, SUM(COALESCE(total,0)) AS v
           FROM sales WHERE created_at >= ($1::date + ${BIZ_SHIFT}) AND created_at < ($2::date + ${BIZ_SHIFT}) GROUP BY 1`,
          [from, endExcl]
        ),
        pool.query(dailyProfitSql, [from, endExcl]),
        pool.query(
           `SELECT to_char(created_at - ${BIZ_SHIFT}, 'YYYY-MM-DD') AS day, SUM(COALESCE(profit,0)) AS v
            FROM sale_returns WHERE created_at >= ($1::date + ${BIZ_SHIFT}) AND created_at < ($2::date + ${BIZ_SHIFT}) GROUP BY 1`,
          [from, endExcl]
        ),
        pool.query(
          `SELECT to_char(date::date, 'YYYY-MM-DD') AS day, SUM(COALESCE(amount,0)) AS v
           FROM expenses WHERE date >= $1::date AND date < $2::date GROUP BY 1`,
          [from, endExcl]
        ),
        pool.query(
          `SELECT COALESCE(SUM(points_discount),0) AS discount,
                  COALESCE(SUM(points_redeemed),0)::int AS points
           FROM sales WHERE created_at >= ($1::date + ${BIZ_SHIFT}) AND created_at < ($2::date + ${BIZ_SHIFT})`,
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
      const pointsDiscount = Math.round(Number(pointsRow.rows[0].discount) || 0);
      const pointsRedeemed = Number(pointsRow.rows[0].points) || 0;

      const [categorySales, topProducts] = await Promise.all([
        pool.query(
          `SELECT COALESCE(c.name, 'Other') AS category, SUM(si.qty * si.unit_price) AS value
           FROM sale_items si
           JOIN products p ON p.id = si.product_id
           LEFT JOIN categories c ON c.id = p.category_id
           JOIN sales s ON s.id = si.sale_id
           WHERE s.created_at >= ($1::date + ${BIZ_SHIFT}) AND s.created_at < ($2::date + ${BIZ_SHIFT})
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
           WHERE s.created_at >= ($1::date + ${BIZ_SHIFT}) AND s.created_at < ($2::date + ${BIZ_SHIFT})
           GROUP BY p.id, p.name, c.name ORDER BY qty DESC LIMIT 6`,
          [from, endExcl]
        ).then((r) => r.rows.map((x) => ({ ...x, qty: Math.round(x.qty), revenue: Math.round(x.revenue) })))
      ]);

      res.json({
        from,
        to,
        kpis: { revenue, profit, cost, expenses, orders, collected, margin, pointsDiscount, pointsRedeemed },
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
        `WITH latest_price AS (
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
                p.online, p.oversold_qty,
                COALESCE(u.category, fu.category) AS unit_category,
                COALESCE(u.conversion_factor, fu.conversion_factor) AS unit_factor,
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
                COALESCE(ps.stock, 0) AS stock,
                COALESCE(images.images, '[]') AS images,
                COALESCE(cprices.category_prices, '[]') AS category_prices
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         LEFT JOIN measuring_units u ON u.id = p.unit_id
     LEFT JOIN LATERAL (
       SELECT category, conversion_factor
       FROM measuring_units
       WHERE p.unit_id IS NULL
         AND (LOWER(short_name) = LOWER(TRIM(p.unit)) OR LOWER(name) = LOWER(TRIM(p.unit)))
       LIMIT 1
     ) fu ON true
         LEFT JOIN product_stock ps ON ps.product_id = p.id
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

  // Price-list view. Like /product-options but without the 2000-row cap and
  // without the heavy image JSON, so the whole catalogue (with the latest
  // purchase cost used for margin) is available for client-side filtering.
  router.get(
    "/product-prices",
    h(async (_req, res) => {
      const { rows } = await pool.query(
        `WITH latest_price AS (
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
         cprices AS (
           SELECT cp.product_id,
                  json_agg(json_build_object('category_id', cp.category_id,
                                             'selling_price', cp.selling_price)
                           ORDER BY cp.category_id) AS category_prices
           FROM customer_prices cp GROUP BY cp.product_id)
         SELECT p.id, p.name, p.sku, p.unit, p.unit_id, p.barcode,
                p.category_id, p.subcategory_id, p.hsn_code, p.reorder_level,
                c.name AS category,
                p.selling_price, p.market_price, p.tax, p.discount,
                COALESCE(latest_price.purchase_price, p.purchase_price) AS purchase_price,
                ROUND(COALESCE(
                  (latest_price.purchase_price - COALESCE(latest_price.discount, 0))
                    * (1 + COALESCE(latest_price.tax, 0) / 100.0)
                    + COALESCE(latest_price.charges_per_unit, 0),
                  p.purchase_price
                )::numeric, 2) AS purchase_cost,
                COALESCE(ps.stock, 0) AS stock,
                COALESCE(cprices.category_prices, '[]') AS category_prices
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         LEFT JOIN product_stock ps ON ps.product_id = p.id
         LEFT JOIN latest_price ON latest_price.product_id = p.id
         LEFT JOIN cprices ON cprices.product_id = p.id
         ORDER BY p.name`,
        []
      );
      res.json(rows);
    })
  );

  // Type-ahead product lookup for the billing and quotation pickers. The old
  // picker loaded /product-options (capped at 2000 rows) and filtered in the
  // browser, so any product after the cap simply could not be selected. This
  // endpoint searches the indexed name/SKU/barcode columns and returns a small
  // page; an exact barcode or SKU match is sorted first for scanner input.
  router.get(
    "/products/search",
    h(async (req, res) => {
      const q = String(req.query.q || "").trim().slice(0, 100);
      const rawLimit = Number(req.query.limit);
      const limit = Math.min(
        Math.max(Number.isFinite(rawLimit) && rawLimit > 0 ? Math.trunc(rawLimit) : 20, 1),
        MAX_SEARCH_RESULTS
      );
      const params = [q || null, limit];
      let filter = "";
      if (q) {
        params.push(`%${q}%`);
        filter = `AND (
          p.name ILIKE $${params.length}
          OR p.sku ILIKE $${params.length}
          OR p.barcode ILIKE $${params.length}
          OR c.name ILIKE $${params.length}
        )`;
      }

      const { rows } = await pool.query(
        `WITH found AS (
           SELECT p.id,
                  CASE WHEN $1::text IS NOT NULL
                            AND (LOWER(COALESCE(p.barcode, '')) = LOWER($1)
                              OR LOWER(COALESCE(p.sku, '')) = LOWER($1))
                       THEN 0 ELSE 1 END AS rank
             FROM products p
             LEFT JOIN categories c ON c.id = p.category_id
            WHERE 1=1 ${filter}
            ORDER BY rank, p.name
            LIMIT $2
         ),
         latest_price AS (
           SELECT DISTINCT ON (spi.product_id)
                  spi.product_id, spi.purchase_price, spi.tax, spi.discount,
                  COALESCE(sp.additional_charges, 0) / NULLIF(spq.total_qty, 0) AS charges_per_unit
           FROM supplier_purchase_items spi
           LEFT JOIN supplier_purchases sp ON sp.id = spi.purchase_id
           LEFT JOIN (
             SELECT purchase_id, SUM(quantity) AS total_qty
             FROM supplier_purchase_items
             WHERE purchase_id IN (SELECT purchase_id FROM supplier_purchase_items
                                    WHERE product_id IN (SELECT id FROM found))
             GROUP BY purchase_id
           ) spq ON spq.purchase_id = spi.purchase_id
           WHERE COALESCE(spi.purchase_price, 0) > 0
             AND spi.product_id IN (SELECT id FROM found)
           ORDER BY spi.product_id, spi.id DESC),
         images AS (
           SELECT pi.product_id,
                  json_agg(json_build_object('id', pi.id, 'url', pi.url)
                           ORDER BY pi.sort_order, pi.id) AS images
           FROM product_images pi
           WHERE pi.product_id IN (SELECT id FROM found)
           GROUP BY pi.product_id),
         cprices AS (
           SELECT cp.product_id,
                  json_agg(json_build_object('category_id', cp.category_id,
                                             'selling_price', cp.selling_price)
                           ORDER BY cp.category_id) AS category_prices
           FROM customer_prices cp
           WHERE cp.product_id IN (SELECT id FROM found)
           GROUP BY cp.product_id)
         SELECT p.id, p.name, p.sku, p.unit, p.unit_id, p.barcode,
                p.category_id, p.subcategory_id,
                p.online, p.oversold_qty,
                COALESCE(u.category, fu.category) AS unit_category,
                COALESCE(u.conversion_factor, fu.conversion_factor) AS unit_factor,
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
                COALESCE(ps.stock, 0) AS stock,
                COALESCE(images.images, '[]') AS images,
                COALESCE(cprices.category_prices, '[]') AS category_prices
         FROM found f
         JOIN products p ON p.id = f.id
         LEFT JOIN categories c ON c.id = p.category_id
         LEFT JOIN measuring_units u ON u.id = p.unit_id
         LEFT JOIN LATERAL (
           SELECT category, conversion_factor
           FROM measuring_units
           WHERE p.unit_id IS NULL
             AND (LOWER(short_name) = LOWER(TRIM(p.unit)) OR LOWER(name) = LOWER(TRIM(p.unit)))
           LIMIT 1
         ) fu ON true
         LEFT JOIN product_stock ps ON ps.product_id = p.id
         LEFT JOIN latest_price ON latest_price.product_id = p.id
         LEFT JOIN images ON images.product_id = p.id
         LEFT JOIN cprices ON cprices.product_id = p.id
         ORDER BY f.rank, p.name`,
        params
      );
      res.json(rows);
    })
  );

  // Barcode lookup for the sales and purchase screens. It returns the same
  // fields as /product-options so a scanned product can be added to a bill or
  // purchase without first being in the loaded catalogue.
  router.get(
    "/products/barcode/:barcode",
    h(async (req, res) => {
      const code = String(req.params.barcode || "").trim();
      if (!code) return res.status(400).json({ error: "Barcode is required" });
      const { rows } = await pool.query(
        `SELECT p.id, p.name, p.sku, p.barcode, p.unit, p.unit_id,
                p.category_id, p.subcategory_id, p.online, p.oversold_qty,
                COALESCE(u.category, fu.category) AS unit_category,
                COALESCE(u.conversion_factor, fu.conversion_factor) AS unit_factor,
                c.name AS category,
                p.selling_price, p.market_price, p.tax, p.discount,
                p.hsn_code, p.reorder_level,
                COALESCE(latest_price.purchase_price, p.purchase_price) AS purchase_price,
                COALESCE(packs.total_stock, 0) AS stock,
                COALESCE(images.images, '[]') AS images,
                COALESCE(cprices.category_prices, '[]') AS category_prices
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         LEFT JOIN measuring_units u ON u.id = p.unit_id
         LEFT JOIN LATERAL (
           SELECT category, conversion_factor
           FROM measuring_units
           WHERE p.unit_id IS NULL
             AND (LOWER(short_name) = LOWER(TRIM(p.unit)) OR LOWER(name) = LOWER(TRIM(p.unit)))
           LIMIT 1
         ) fu ON true
         LEFT JOIN LATERAL (
           SELECT SUM(remaining) AS total_stock
           FROM product_packs
           WHERE product_id = p.id
         ) packs ON true
         LEFT JOIN LATERAL (
           SELECT spi.purchase_price
           FROM supplier_purchase_items spi
           WHERE spi.product_id = p.id
           ORDER BY spi.created_at DESC
           LIMIT 1
         ) latest_price ON true
         LEFT JOIN LATERAL (
           SELECT json_agg(json_build_object('id', pi.id, 'url', pi.url)
                           ORDER BY pi.sort_order, pi.id) AS images
           FROM product_images pi
           WHERE pi.product_id = p.id
         ) images ON true
         LEFT JOIN LATERAL (
           SELECT json_agg(json_build_object('category_id', cp.category_id,
                                             'selling_price', cp.selling_price)
                           ORDER BY cp.category_id) AS category_prices
           FROM customer_prices cp
           WHERE cp.product_id = p.id
         ) cprices ON true
         WHERE p.barcode = $1 OR LOWER(p.sku) = LOWER($1)
         LIMIT 1`,
        [code]
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: `No product found for barcode ${code}` });
      }
      res.json(rows[0]);
    })
  );

  // Weight barcodes carry only the weight (WT:<grams>). In a bill they are
  // applied to whichever line is currently selected.
  router.get(
    "/weight-barcodes",
    h(async (_req, res) => {
      const { rows } = await pool.query(
        "SELECT id, weight_g, barcode, copies, created_at FROM weight_barcodes ORDER BY weight_g, id"
      );
      res.json(rows.map(serializeWeightBarcode));
    })
  );

  router.post(
    "/weight-barcodes",
    h(async (req, res) => {
      const body = req.body || {};
      const rawWeights = Array.isArray(body.weights) ? body.weights : [body.weight_g];
      if (!rawWeights.length || rawWeights.length > 100) {
        return res.status(400).json({ error: "Add between 1 and 100 weights" });
      }
      const weights = [];
      for (const value of rawWeights) {
        const grams = roundWeight(value);
        if (!Number.isFinite(grams) || grams <= 0 || grams > 1000000) {
          return res.status(400).json({ error: `Invalid weight: ${value}` });
        }
        if (!weights.includes(grams)) weights.push(grams);
      }
      const copies = Math.max(1, Math.min(50, Math.round(Number(body.copies) || 1)));

      const created = [];
      const skipped = [];
      for (const grams of weights) {
        const barcode = weightBarcodeValue(grams);
        const inserted = await pool.query(
          `INSERT INTO weight_barcodes (weight_g, barcode, copies)
           VALUES ($1, $2, $3)
           ON CONFLICT (barcode) DO NOTHING
           RETURNING *`,
          [grams, barcode, copies]
        );
        if (!inserted.rows[0]) {
          skipped.push({ weight_g: grams, weight_label: weightLabel(grams), barcode });
          continue;
        }
        created.push(serializeWeightBarcode(inserted.rows[0]));
      }
      res.status(201).json({ created, skipped });
    })
  );

  router.get(
    "/weight-barcodes/lookup/:code",
    h(async (req, res) => {
      const code = String(req.params.code || "").trim();
      if (!code) return res.status(400).json({ error: "Barcode is required" });
      const { rows } = await pool.query(
        "SELECT id, weight_g, barcode, copies FROM weight_barcodes WHERE UPPER(barcode) = UPPER($1) LIMIT 1",
        [code]
      );
      if (!rows.length) {
        return res.status(404).json({ error: `No weight barcode found for ${code}` });
      }
      res.json(serializeWeightBarcode(rows[0]));
    })
  );

  router.delete(
    "/weight-barcodes/:id",
    h(async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: "Invalid barcode id" });
      }
      const { rowCount } = await pool.query(
        "DELETE FROM weight_barcodes WHERE id = $1",
        [id]
      );
      if (!rowCount) return res.status(404).json({ error: "Weight barcode not found" });
      res.json({ ok: true });
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
               market_price = $14, online = $15,
               barcode = COALESCE($16, barcode)
             WHERE id = $17`,
            [
              name, b.sku || null, b.category_id || null, b.subcategory_id || null,
              b.unit || "pcs", b.unit_id || null,
              Number(b.selling_price) || 0, Number(b.reorder_level) || 0,
              b.hsn_code || null, Number(b.discount) || 0, Number(b.tax) || 0,
              b.expiry_date || null, b.description || null,
              Number(b.market_price) || 0, !!b.online,
              normalizeBarcode(b.barcode), id
            ]
          );
          await pool.query(
            "UPDATE supplier_purchase_items SET item_name = $1 WHERE product_id = $2",
            [name, id]
          );
          return res.json({ id, updated: true });
        }
        const { rows } = await pool.query(
          `INSERT INTO products (name, sku, category_id, subcategory_id, unit, unit_id, purchase_price, selling_price, stock, reorder_level, hsn_code, discount, tax, expiry_date, description, market_price, online, barcode)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id, barcode`,
          [
            name, b.sku || null, b.category_id || null, b.subcategory_id || null,
            b.unit || "pcs", b.unit_id || null,
            0, Number(b.selling_price) || 0,
            0, Number(b.reorder_level) || 0,
            b.hsn_code || null, Number(b.discount) || 0, Number(b.tax) || 0,
            b.expiry_date || null, b.description || null,
            Number(b.market_price) || 0, !!b.online,
            normalizeBarcode(b.barcode)
          ]
        );
        res.status(201).json({ id: rows[0].id, barcode: rows[0].barcode, ...b });
      } catch (e) {
        if (e.code === "23505") {
          const isBarcode = /barcode/i.test(`${e.constraint || ""} ${e.detail || ""}`);
          return res.status(400).json({
            error: isBarcode
              ? "This barcode is already used by another product"
              : "A product with this SKU already exists"
          });
        }
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
             market_price = $14, online = $15,
             barcode = COALESCE($16, barcode)
           WHERE id = $17`,
          [
            b.name, b.sku || null, b.category_id || null, b.subcategory_id || null,
            b.unit || "pcs", b.unit_id || null,
            Number(b.selling_price) || 0, Number(b.reorder_level) || 0,
            b.hsn_code || null, Number(b.discount) || 0, Number(b.tax) || 0,
            b.expiry_date || null, b.description || null,
            Number(b.market_price) || 0, !!b.online,
            normalizeBarcode(b.barcode), req.params.id
          ]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: "Product not found" });
        await pool.query(
          "UPDATE supplier_purchase_items SET item_name = $1 WHERE product_id = $2",
          [b.name, req.params.id]
        );
        res.json({ updated: true });
      } catch (e) {
        if (e.code === "23505") {
          const isBarcode = /barcode/i.test(`${e.constraint || ""} ${e.detail || ""}`);
          return res.status(400).json({
            error: isBarcode
              ? "This barcode is already used by another product"
              : "A product with this SKU already exists"
          });
        }
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
         WHERE si.sale_id = $1
         ORDER BY si.id`,
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
    const pointsDiscount = Number(sale.points_discount) || 0;
    sale.total_profit = Math.round((totals.profit - voucherDiscount - pointsDiscount - returnedProfit) * 100) / 100;
    sale.voucher_discount = voucherDiscount;
    const { rows: vr } = await pool.query(
      `SELECT v.id, v.code, v.status, v.customer_name, v.issued_at,
              c.id AS campaign_id, c.name AS campaign_name,
              COALESCE(v.discount_type, c.discount_type) AS discount_type,
              COALESCE(v.discount_value, c.discount_value) AS discount_value,
              COALESCE(v.min_total, c.min_total) AS min_total,
              c.months, c.month_count_start,
              c.start_date AS valid_from, c.end_date
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
        usedThisMonth: v.uses.some((u) => u.month_key === voucherMonthKey(dstr(v.month_count_start), td.d))
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
      const validDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || "");
      let from = validDate(req.query.from) ? String(req.query.from).trim() : null;
      let to = validDate(req.query.to) ? String(req.query.to).trim() : null;
      if (!from && !to) from = to = todayStr();
      const q = String(req.query.q || "").trim().slice(0, 100);
      const status = String(req.query.status || "").trim();
      const { page, limit, offset } = pageParams(req, 20);
      const profitReady = isSalesProfitReady();

      const params = [];
      let where = "WHERE 1=1";
      if (from) {
        params.push(from);
        where += ` AND s.created_at >= ($${params.length}::date + ${BIZ_SHIFT})`;
      }
      if (to) {
        params.push(to);
        where += ` AND s.created_at < ($${params.length}::date + 1 + ${BIZ_SHIFT})`;
      }
      if (status) {
        params.push(status);
        where += ` AND s.status = $${params.length}`;
      }
      if (q) {
        params.push(`%${q}%`);
        where += ` AND (
          s.invoice_no ILIKE $${params.length}
          OR COALESCE(cu.name, NULLIF(s.online_customer_name, '')) ILIKE $${params.length}
          OR COALESCE(cu.phone, NULLIF(s.online_customer_phone, '')) ILIKE $${params.length}
        )`;
      }
      const summaryParams = [...params];

      // The common list (date range only, no search/status filter) reads its
      // totals from the per-day cache. A filtered list still needs the live
      // query because the cache cannot split by customer or status.
      const canUseDayCache = !q && !status && profitReady;
      // Set-based: aggregate the filtered sales once, then subtract returns (and,
      // when profit is not materialised, item profit / voucher discounts) with a
      // single join each. The previous form ran correlated LATERALs per sale, so
      // a 100k-row range cost ~300k index scans just to total a day.
      const profitExpr = profitReady
        ? `COALESCE(SUM(profit),0) - COALESCE((SELECT SUM(r.profit) FROM sale_returns r JOIN filtered f ON f.id = r.sale_id),0)`
        : `COALESCE((SELECT SUM(si.profit) FROM sale_items si JOIN filtered f ON f.id = si.sale_id),0)
           - COALESCE((SELECT SUM(vu.discount_applied) FROM voucher_uses vu JOIN filtered f ON f.id = vu.bill_id),0)
           - COALESCE((SELECT SUM(r.profit) FROM sale_returns r JOIN filtered f ON f.id = r.sale_id),0)`;
      const summarySql = `
        WITH filtered AS (
          SELECT s.id, s.total, s.paid, s.profit
            FROM sales s
            LEFT JOIN customers cu ON cu.id = s.customer_id
            ${where}
        )
        SELECT COUNT(*)::int AS count,
               COALESCE(SUM(total),0) AS total,
               COALESCE(SUM(paid),0) AS paid,
               COALESCE(SUM(total - paid),0) AS outstanding,
               ${profitExpr} AS profit
          FROM filtered`;

      const cursor = decodeCursor(req.query.cursor);
      const rowsParams = [...params];
      let rowsWhere = where;
      if (cursor) {
        rowsParams.push(cursor.created);
        const timeParam = rowsParams.length;
        rowsParams.push(cursor.id);
        const idParam = rowsParams.length;
        rowsWhere += ` AND (s.created_at < $${timeParam}::timestamp
                         OR (s.created_at = $${timeParam}::timestamp AND s.id < $${idParam}))`;
      }
      rowsParams.push(limit);
      const limitParam = rowsParams.length;
      let pagination = `LIMIT $${limitParam}`;
      if (!cursor) {
        rowsParams.push(offset);
        pagination += ` OFFSET $${rowsParams.length}`;
      }

      const itemProfitCol = profitReady ? "" : "COALESCE(SUM(si.profit),0) AS profit,";
      const rowProfit = profitReady
        ? "COALESCE(s.profit,0) - COALESCE(rt.profit,0)"
        : "COALESCE(it.profit,0) - COALESCE(vd.discount,0) - COALESCE(rt.profit,0)";

      const rowsSql = `
        SELECT s.*, s.created_at::text AS created_at_key,
               COALESCE(cu.name, NULLIF(s.online_customer_name, ''), 'Walk-in') AS customer,
               COALESCE(NULLIF(s.online_customer_phone, ''), cu.phone) AS customer_phone,
               COALESCE(it.item_count, 0) AS item_count,
               ${rowProfit} AS profit,
               COALESCE(it.hsn_codes, '') AS hsn_codes,
               COALESCE(it.tax_rates, '') AS tax_rates,
               COALESCE(it.tax_amt, 0) AS tax_amt
          FROM sales s
          LEFT JOIN customers cu ON cu.id = s.customer_id
          LEFT JOIN LATERAL (
            SELECT COUNT(*)::int AS item_count,
                   ${itemProfitCol}
                   COALESCE(string_agg(DISTINCT si.hsn_code, ', ' ORDER BY si.hsn_code)
                             FILTER (WHERE si.hsn_code IS NOT NULL), '') AS hsn_codes,
                   COALESCE(string_agg(DISTINCT si.tax::text, ', ' ORDER BY si.tax::text)
                             FILTER (WHERE COALESCE(si.tax,0) > 0), '') AS tax_rates,
                   COALESCE(SUM(si.tax_amt),0) AS tax_amt
              FROM sale_items si WHERE si.sale_id = s.id
          ) it ON TRUE
          ${profitReady ? "" : `LEFT JOIN LATERAL (
            SELECT COALESCE(SUM(vu.discount_applied),0) AS discount
              FROM voucher_uses vu WHERE vu.bill_id = s.id
          ) vd ON TRUE`}
          LEFT JOIN LATERAL (
            SELECT COALESCE(SUM(r.profit),0) AS profit
              FROM sale_returns r WHERE r.sale_id = s.id
          ) rt ON TRUE
          ${rowsWhere}
          ORDER BY s.created_at DESC, s.id DESC
          ${pagination}`;

      const summaryPromise = canUseDayCache
        ? pool.query(
            `SELECT COALESCE(SUM(sales_count),0)::int AS count,
                    COALESCE(SUM(total),0) AS total,
                    COALESCE(SUM(paid),0) AS paid,
                    COALESCE(SUM(outstanding),0) AS outstanding,
                    COALESCE(SUM(profit),0) AS profit
               FROM sales_daily_summary
              WHERE day >= $1::date AND day <= $2::date`,
            [from || "0001-01-01", to || "9999-12-31"]
          )
        : pool.query(summarySql, summaryParams);

      const [{ rows: [summary] }, { rows }] = await Promise.all([
        summaryPromise,
        pool.query(rowsSql, rowsParams)
      ]);

      res.json({
        rows,
        total: Number(summary.count) || 0,
        page,
        limit,
        next_cursor: encodeCursor(rows[rows.length - 1]),
        summary: {
          count: Number(summary.count) || 0,
          total: Number(summary.total) || 0,
          paid: Number(summary.paid) || 0,
          outstanding: Number(summary.outstanding) || 0,
          profit: Number(summary.profit) || 0
        }
      });
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
        const reservedByProduct = new Map();
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
                    p.name, p.unit, p.stock, p.oversold_qty,
                    p.discount, p.tax, p.hsn_code, p.market_price,
                    COALESCE(u.category, fu.category) AS unit_category,
                    COALESCE(u.conversion_factor, fu.conversion_factor) AS unit_factor,
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
             LEFT JOIN measuring_units u ON u.id = p.unit_id
     LEFT JOIN LATERAL (
       SELECT category, conversion_factor
       FROM measuring_units
       WHERE p.unit_id IS NULL
         AND (LOWER(short_name) = LOWER(TRIM(p.unit)) OR LOWER(name) = LOWER(TRIM(p.unit)))
       LIMIT 1
     ) fu ON true
             LEFT JOIN customer_prices cp
               ON cp.product_id = p.id AND cp.category_id = $2
             WHERE p.id = $1
             FOR UPDATE OF p`,
            [it.product_id, customerCatId]
          );
          if (rows.length === 0) throw new Error(`Product ${it.product_id} not found`);
          const qty = Number(it.qty) || 1;
          const productId = Number(it.product_id);
          const reserved = reservedByProduct.get(productId) || 0;
          const available = availableToSell(rows[0], reserved);
          if (qty > available + 0.00005) {
            throw new Error(
              `Insufficient stock for ${rows[0].name}: only ${available}${rows[0].unit ? ` ${rows[0].unit}` : ""} available`
            );
          }
          reservedByProduct.set(productId, reserved + qty);
          const sp = Number(rows[0].selling_price);
          const pp = Number(rows[0].unit_cost);
          const disc = Number(rows[0].discount) || 0;
          const tax = Number(rows[0].tax) || 0;
          const defaultTaxable = Math.max(0, sp - disc);
          const defaultUnitPrice = Math.round((defaultTaxable + (defaultTaxable * tax) / 100) * 100) / 100;
          const hasOverride =
            it.unit_price !== undefined &&
            it.unit_price !== null &&
            it.unit_price !== "" &&
            Number.isFinite(Number(it.unit_price));
          const unitPrice = hasOverride
            ? Math.max(0, Math.round(Number(it.unit_price) * 100) / 100)
            : defaultUnitPrice;
          const taxable = tax > 0 ? unitPrice / (1 + tax / 100) : unitPrice;
          const unitProfit = Math.round((unitPrice - pp) * 100) / 100;
          const tax_amt = Math.round((unitPrice - taxable) * qty * 100) / 100;
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
        // Counting window key for the redeem path. Calendar month by default;
        // the campaign's month-count anchor overrides it below.
        let voucherMonth = monthKeyOf(todayStr);

        if (b.voucher_code) {
          const code = String(b.voucher_code).trim();
          const { rows: vr } = await client.query(
            `SELECT v.id, v.status, v.code, v.customer_name,
                    c.id AS campaign_id, c.name AS campaign_name,
                    COALESCE(v.discount_type, c.discount_type) AS discount_type,
                    COALESCE(v.discount_value, c.discount_value) AS discount_value,
                    COALESCE(v.min_total, c.min_total) AS min_total,
                    c.months, c.month_count_start,
                    c.start_date AS valid_from, c.end_date
             FROM vouchers v JOIN voucher_campaigns c ON c.id = v.campaign_id
             WHERE v.code = $1 FOR UPDATE OF v`,
            [code]
          );
          if (vr.length === 0) throw new Error("Invalid voucher code");
          const v = vr[0];
          v.uses = await loadVoucherUses(client, v.id);
          const from = dstr(v.valid_from);
          const through = validThroughDate(v);
          // "Once every month" counting: anchored to the campaign's chosen
          // month-count start when set, calendar months otherwise.
          const countAnchor = dstr(v.month_count_start);
          if (countAnchor && todayStr < countAnchor) {
            throw new Error(`The monthly count for this voucher starts on ${countAnchor}`);
          }
          const curMonth = voucherMonthKey(countAnchor, todayStr);
          if (curMonth != null) voucherMonth = curMonth;
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
        let netTotal = Math.max(0, Math.round((total - voucherDiscount) * 100) / 100);

        const { rows: campaignRows } = await client.query(
          `SELECT * FROM voucher_campaigns
           WHERE (start_date IS NULL OR start_date <= CURRENT_DATE)
             AND (end_date IS NULL OR end_date >= CURRENT_DATE)
             AND issued_count < issue_limit
           ORDER BY id ASC
           LIMIT 200`
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
        if (pick) {
          // Claim exactly the chosen campaign. If another till took the last
          // one between the read and this update, the sale simply goes out
          // without a voucher instead of serialising every till behind a lock.
          const { rows: claimed } = await client.query(
            `UPDATE voucher_campaigns
                SET issued_count = issued_count + 1
              WHERE id = $1 AND issued_count < issue_limit
              RETURNING id`,
            [pick.id]
          );
          if (claimed.length > 0) {
            let customerName = null;
            if (b.customer_id) {
              const { rows: cr } = await client.query("SELECT name FROM customers WHERE id = $1", [b.customer_id]);
              customerName = cr.length ? cr[0].name : null;
            }
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
        }

        const { invoiceNo: inv } = await allocateInvoiceNo(client);
        const program = b.customer_id ? await getActivePointProgram(client) : null;
        const requestedPoints = Math.trunc(Number(b.redeem_points) || 0);
        let pointsRedeemed = 0;
        let pointsDiscount = 0;
        if (requestedPoints > 0) {
          if (!b.customer_id) throw new Error("Select a customer to redeem points");
          const redemption = await redeemCustomerPoints(client, {
            customerId: b.customer_id,
            points: requestedPoints,
            maxDiscount: netTotal,
            reason: `Redeemed on ${inv}`
          });
          pointsRedeemed = redemption.points;
          pointsDiscount = redemption.discount;
          netTotal = Math.max(0, Math.round((netTotal - pointsDiscount) * 100) / 100);
        }
        const status = b.status || "paid";
        const paid = status === "paid" ? netTotal : status === "partial" ? Math.round(netTotal / 2) : 0;
        const { rows: saleRows } = await client.query(
          `INSERT INTO sales
             (invoice_no, customer_id, total, paid, status, payment_method, note,
              points_redeemed, points_discount, point_program_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [
            inv,
            b.customer_id || null,
            netTotal,
            paid,
            status,
            b.payment_method || "cash",
            b.note || null,
            pointsRedeemed,
            pointsDiscount,
            program?.id || null
          ]
        );
        const saleId = saleRows[0].id;
        if (pointsRedeemed > 0) {
          await client.query(
            `UPDATE customer_points_ledger
                SET sale_id = $1
              WHERE id = (
                SELECT id FROM customer_points_ledger
                 WHERE customer_id = $2 AND kind = 'redeem' AND sale_id IS NULL
                 ORDER BY id DESC LIMIT 1
              )`,
            [saleId, b.customer_id]
          );
        }

        if (redeemed) {
          await client.query(
            `INSERT INTO voucher_uses (voucher_id, bill_id, month_key, discount_applied)
             VALUES ($1,$2,$3,$4)`,
            [redeemed.id, saleId, voucherMonth, voucherDiscount]
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
          const oversoldQty = await consumeSaleStock(client, {
            productId: it.product_id,
            qty: it.qty
          });

          await client.query(
              `INSERT INTO sale_items (sale_id, product_id, product_pack_id, qty, unit_price, market_price, unit_id, conversion_factor, purchase_price, profit, hsn_code, tax, tax_amt, oversold_qty)
               VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,$9,$10,$11,$12,$13)`,
              [saleId, it.product_id, packId, it.qty, it.unit_price, it.market_price, it.sale_unit_id || it.unit_id || null, it.purchase_price, it.profit, it.hsn_code, it.tax, it.tax_amt, oversoldQty]
            );
        }

        await recalcSaleProfit(client, saleId);

        const pointsEarned = b.customer_id ? pointsForTotal(netTotal, program) : 0;
        if (pointsEarned > 0) {
          await client.query("UPDATE sales SET points_earned = $1 WHERE id = $2", [pointsEarned, saleId]);
          await adjustCustomerPoints(client, {
            customerId: b.customer_id,
            change: pointsEarned,
            reason: `Earned on ${inv}`,
            saleId,
            program
          });
        }

        await client.query("COMMIT");
        res.status(201).json({
          id: saleId,
          invoice_no: inv,
          total: netTotal,
          discount: voucherDiscount,
          paid,
          status,
          points_earned: pointsEarned,
          points_redeemed: pointsRedeemed,
          points_discount: pointsDiscount,
          point_program: program ? { id: program.id, name: program.name } : null,
          profit: Math.round((totalProfit - voucherDiscount - pointsDiscount) * 100) / 100,
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
        const oldCustomerId = Number(sale.customer_id) || null;
        const targetCustomerId =
          b.customer_id === undefined ? oldCustomerId : Number(b.customer_id) || null;

        // Points already spent on this bill belong to the customer who spent
        // them, so the bill cannot be moved to somebody else. Delete and
        // re-create it if the customer was wrong.
        if (Number(sale.points_redeemed) > 0 && targetCustomerId !== oldCustomerId) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            error: "This bill used loyalty points. It cannot be moved to another customer."
          });
        }

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
            "SELECT product_id, qty, product_pack_id, oversold_qty FROM sale_items WHERE sale_id = $1",
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
            await restoreOversoldAllowance(client, {
              productId: it.product_id,
              oversoldQty: it.oversold_qty,
              saleCreatedAt: sale.created_at
            });
          }
          await client.query("DELETE FROM sale_items WHERE sale_id = $1", [req.params.id]);

          let total = 0;
          let totalProfit = 0;
          const validatedItems = [];
          const reservedByProduct = new Map();
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
                      p.name, p.unit, p.stock, p.oversold_qty,
                      p.discount, p.tax, p.hsn_code, p.market_price,
                      COALESCE(u.category, fu.category) AS unit_category,
                      COALESCE(u.conversion_factor, fu.conversion_factor) AS unit_factor,
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
               LEFT JOIN measuring_units u ON u.id = p.unit_id
     LEFT JOIN LATERAL (
       SELECT category, conversion_factor
       FROM measuring_units
       WHERE p.unit_id IS NULL
         AND (LOWER(short_name) = LOWER(TRIM(p.unit)) OR LOWER(name) = LOWER(TRIM(p.unit)))
       LIMIT 1
     ) fu ON true
               LEFT JOIN customer_prices cp
                 ON cp.product_id = p.id AND cp.category_id = $2
               WHERE p.id = $1
               FOR UPDATE OF p`,
              [it.product_id, customerCatId]
            );
            if (rows.length === 0) throw new Error(`Product ${it.product_id} not found`);
            const qty = Number(it.qty) || 1;
            const productId = Number(it.product_id);
            const reserved = reservedByProduct.get(productId) || 0;
            const available = availableToSell(rows[0], reserved);
            if (qty > available + 0.00005) {
              throw new Error(
                `Insufficient stock for ${rows[0].name}: only ${available}${rows[0].unit ? ` ${rows[0].unit}` : ""} available`
              );
            }
            reservedByProduct.set(productId, reserved + qty);
            const sp = Number(rows[0].selling_price);
            const pp = Number(rows[0].unit_cost);
            const disc = Number(rows[0].discount) || 0;
            const tax = Number(rows[0].tax) || 0;
            const defaultTaxable = Math.max(0, sp - disc);
            const defaultUnitPrice = Math.round((defaultTaxable + (defaultTaxable * tax) / 100) * 100) / 100;
            const hasOverride =
              it.unit_price !== undefined &&
              it.unit_price !== null &&
              it.unit_price !== "" &&
              Number.isFinite(Number(it.unit_price));
            const unitPrice = hasOverride
              ? Math.max(0, Math.round(Number(it.unit_price) * 100) / 100)
              : defaultUnitPrice;
            const taxable = tax > 0 ? unitPrice / (1 + tax / 100) : unitPrice;
            const unitProfit = Math.round((unitPrice - pp) * 100) / 100;
            const tax_amt = Math.round((unitPrice - taxable) * qty * 100) / 100;
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
          const lockedPointsDiscount = Number(sale.points_discount) || 0;
          if (lockedPointsDiscount > 0 && netTotal + 1e-9 < lockedPointsDiscount) {
            throw new Error(
              `This bill already redeemed Rs ${lockedPointsDiscount.toFixed(2)} in points. The new total is too low — delete the bill or return items instead.`
            );
          }
          netTotal = Math.max(0, Math.round((netTotal - lockedPointsDiscount) * 100) / 100);

          for (const it of validatedItems) {
            const { packId } = await drainProductPacks(client, {
              productId: it.product_id,
              qty: it.qty,
              packId: it.product_pack_id || null
            });
            const oversoldQty = await consumeSaleStock(client, {
              productId: it.product_id,
              qty: it.qty
            });
            await client.query(
              `INSERT INTO sale_items (sale_id, product_id, product_pack_id, qty, unit_price, market_price, unit_id, conversion_factor, purchase_price, profit, hsn_code, tax, tax_amt, oversold_qty)
               VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,$9,$10,$11,$12,$13)`,
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
                it.tax_amt,
                oversoldQty
              ]
            );
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

        const program =
          (await getPointProgramById(client, sale.point_program_id)) ||
          (await getActivePointProgram(client)) || {
            earn_per: POINTS_PER_RUPEES,
            point_value: 1
          };

        await client.query(
          `UPDATE sales
           SET customer_id = $1, payment_method = $2, note = $3,
               total = $4, paid = $5, status = $6, point_program_id = $7
           WHERE id = $8`,
          [
            targetCustomerId,
            b.payment_method || sale.payment_method || "cash",
            b.note || null,
            netTotal,
            paid,
            status,
            sale.point_program_id || program.id || null,
            req.params.id
          ]
        );

        if (wantsItems) await recalcSaleProfit(client, sale.id);

        // Loyalty points follow the corrected bill. Returned amounts no longer
        // earn, and moving the bill to another customer moves its points too.
        let pointsBase = netTotal;
        if (itemsLocked) {
          const { rows: [retSum] } = await client.query(
            "SELECT COALESCE(SUM(total_refund),0) AS refunded FROM sale_returns WHERE sale_id = $1",
            [sale.id]
          );
          pointsBase = Math.max(0, netTotal - (Number(retSum.refunded) || 0));
        }
        const oldPoints = Math.trunc(Number(sale.points_earned) || 0);
        let newPoints = oldPoints;
        if (wantsItems || oldCustomerId !== targetCustomerId) {
          newPoints = targetCustomerId ? pointsForTotal(pointsBase, program) : 0;
        }
        if (oldCustomerId === targetCustomerId) {
          const delta = newPoints - oldPoints;
          if (delta !== 0) {
            await adjustCustomerPoints(client, {
              customerId: targetCustomerId,
              change: delta,
              reason: `Bill ${sale.invoice_no} corrected`,
              saleId: sale.id,
              program,
              preferSaleId: sale.id
            });
          }
        } else {
          if (oldCustomerId && oldPoints) {
            await adjustCustomerPoints(client, {
              customerId: oldCustomerId,
              change: -oldPoints,
              reason: `Bill ${sale.invoice_no} moved to another customer`,
              saleId: sale.id,
              program,
              preferSaleId: sale.id
            });
          }
          if (targetCustomerId && newPoints) {
            await adjustCustomerPoints(client, {
              customerId: targetCustomerId,
              change: newPoints,
              reason: `Bill ${sale.invoice_no} moved to this customer`,
              saleId: sale.id,
              program
            });
          }
        }
        if (newPoints !== oldPoints) {
          await client.query("UPDATE sales SET points_earned = $1 WHERE id = $2", [newPoints, sale.id]);
        }

        await client.query("COMMIT");
        res.json({
          updated: true,
          total: netTotal,
          paid,
          status,
          items_locked: itemsLocked,
          points_earned: newPoints,
          points_redeemed: Math.trunc(Number(sale.points_redeemed) || 0),
          points_discount: Number(sale.points_discount) || 0
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
          `SELECT id, invoice_no, customer_id, points_earned, points_redeemed,
                  points_discount, point_program_id, channel, status, created_at
             FROM sales WHERE id = $1 FOR UPDATE`,
          [req.params.id]
        );
        if (saleRows.length === 0) {
          await client.query("ROLLBACK");
          return res.status(404).json({ error: "Sale not found" });
        }
        const sale = saleRows[0];
        const { rows: items } = await client.query(
          "SELECT product_id, qty, product_pack_id, oversold_qty FROM sale_items WHERE sale_id = $1",
          [req.params.id]
        );
        if (sale.customer_id && Number(sale.points_earned) > 0) {
          await adjustCustomerPoints(client, {
            customerId: sale.customer_id,
            change: -Math.trunc(Number(sale.points_earned)),
            reason: `Bill ${sale.invoice_no} deleted`,
            saleId: sale.id,
            preferSaleId: sale.id
          });
        }
        if (sale.customer_id && Number(sale.points_redeemed) > 0) {
          await restoreRedeemedPoints(client, {
            customerId: sale.customer_id,
            saleId: sale.id,
            points: sale.points_redeemed,
            discount: sale.points_discount,
            programId: sale.point_program_id,
            reason: `Bill ${sale.invoice_no} deleted — redeemed points restored`
          });
        }
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
            await restoreOversoldAllowance(client, {
              productId: it.product_id,
              oversoldQty: it.oversold_qty,
              saleCreatedAt: sale.created_at
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
          `SELECT id, invoice_no, customer_id, total, points_earned,
                  points_redeemed, points_discount, point_program_id, created_at
             FROM sales WHERE id = $1 FOR UPDATE`,
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
          const qty = Math.round((Number(r.qty) || 0) * 1000000) / 1000000;
          if (qty <= 0) continue;
          const it = byId.get(saleItemId);
          if (!it) throw new Error("Item does not belong to this bill");
          const { rows: [prev] } = await client.query(
            "SELECT COALESCE(SUM(qty),0) AS returned FROM sale_return_items WHERE sale_item_id = $1",
            [saleItemId]
          );
          const alreadyReturned = Number(prev.returned) || 0;
          const maxQty = Math.round((Number(it.qty) - alreadyReturned) * 1000000) / 1000000;
          if (qty > maxQty) throw new Error(`Cannot return more than ${maxQty}${it.unit_name ? ` ${it.unit_name}` : ""} of "${it.product_name}"`);
          const refund = Math.round(Number(it.unit_price) * qty * 100) / 100;
          const oversoldQty = qty;
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
            refund_amount: refund,
            oversold_qty: oversoldQty
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
          await restoreOversoldAllowance(client, {
            productId: r.product_id,
            oversoldQty: r.oversold_qty,
            saleCreatedAt: sale.created_at
          });
        }

        // Points are earned on what the customer keeps, so the bill is
        // re-scored after every return and the difference is taken back.
        let pointsAfterReturn = Math.trunc(Number(sale.points_earned) || 0);
        if (sale.customer_id) {
          const program =
            (await getPointProgramById(client, sale.point_program_id)) ||
            (await getActivePointProgram(client)) || {
              earn_per: POINTS_PER_RUPEES,
              point_value: 1
            };
          const { rows: [retSum] } = await client.query(
            "SELECT COALESCE(SUM(total_refund),0) AS refunded FROM sale_returns WHERE sale_id = $1",
            [sale.id]
          );
          const kept = Math.max(0, (Number(sale.total) || 0) - (Number(retSum.refunded) || 0));
          pointsAfterReturn = pointsForTotal(kept, program);
          const delta = pointsAfterReturn - Math.trunc(Number(sale.points_earned) || 0);
          if (delta !== 0) {
            await adjustCustomerPoints(client, {
              customerId: sale.customer_id,
              change: delta,
              reason: `Return on ${sale.invoice_no}`,
              saleId: sale.id,
              program,
              preferSaleId: sale.id
            });
            await client.query("UPDATE sales SET points_earned = $1 WHERE id = $2", [
              pointsAfterReturn,
              sale.id
            ]);
          }
        }

        await client.query("COMMIT");
        res.json({
          id: ret.id,
          sale_id: sale.id,
          invoice_no: sale.invoice_no,
          total_refund: totalRefund,
          profit_reversed: profitReversed,
          items_returned: rowsToInsert.length,
          points_earned: pointsAfterReturn
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
          const qty = Math.round((Number(it.qty) || 0) * 1000000) / 1000000;
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
          const available = Math.round((packStock > 0 ? packStock : Number(p.stock) || 0) * 1000000) / 1000000;
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

        const totalQty = Math.round(prepared.reduce((s, r) => s + r.qty, 0) * 1000000) / 1000000;
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
  const normalizeCardNo = (value) => {
    const raw = String(value ?? "").trim();
    return raw || null;
  };

  const validateCardNo = (value) => {
    const cardNo = normalizeCardNo(value);
    if (cardNo && !/^(\d{4}|\d{6})$/.test(cardNo)) {
      return { error: "Card number must be exactly 4 or 6 digits" };
    }
    return { cardNo };
  };

  const cardNoError = (e) => {
    if (e?.code !== "23505") return null;
    const detail = `${e.constraint || ""} ${e.detail || ""}`;
    return /card_no/i.test(detail) ? "This card number is already used by another customer" : null;
  };

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

  // Type-ahead customer lookup for pickers. Searching the indexed name and
  // phone columns avoids loading the whole customer book just to choose one.
  router.get(
    "/customers/search",
    h(async (req, res) => {
      const q = String(req.query.q || "").trim().slice(0, 100);
      const rawLimit = Number(req.query.limit);
      const limit = Math.min(
        Math.max(Number.isFinite(rawLimit) && rawLimit > 0 ? Math.trunc(rawLimit) : 20, 1),
        MAX_SEARCH_RESULTS
      );
      const params = [q || null, limit];
      let filter = "";
      if (q) {
        params.push(`%${q}%`);
        filter = `AND (
          c.name ILIKE $${params.length}
          OR c.phone ILIKE $${params.length}
          OR c.email ILIKE $${params.length}
          OR c.address ILIKE $${params.length}
          OR c.barcode ILIKE $${params.length}
          OR c.card_no ILIKE $${params.length}
          OR cc.name ILIKE $${params.length}
        )`;
      }

      const { rows } = await pool.query(
        `WITH found AS (
           SELECT c.id,
                  CASE WHEN $1::text IS NOT NULL
                            AND (LOWER(COALESCE(c.barcode, '')) = LOWER($1)
                              OR LOWER(COALESCE(c.card_no, '')) = LOWER($1)
                              OR c.phone = $1)
                       THEN 0 ELSE 1 END AS rank
             FROM customers c
             LEFT JOIN customer_categories cc ON cc.id = c.category_id
            WHERE 1=1 ${filter}
            ORDER BY rank, c.name
            LIMIT $2
         )
         SELECT c.*, cc.name AS category_name,
                (SELECT COUNT(*) FROM sales s WHERE s.customer_id = c.id) AS sales_count,
                COALESCE((SELECT SUM(s.total - s.paid) FROM sales s
                           WHERE s.customer_id = c.id AND s.total > s.paid), 0) AS balance
           FROM found f
           JOIN customers c ON c.id = f.id
           LEFT JOIN customer_categories cc ON cc.id = c.category_id
          ORDER BY f.rank, c.name`,
        params
      );
      res.json(rows);
    })
  );

  // The Customers page uses this paginated view. Keep GET /customers above as
  // the full array because every picker (Sales, Payments, Broadcast) expects it.
  router.get(
    "/customers/paged",
    h(async (req, res) => {
      const { page, limit, offset } = pageParams(req, 20);
      const q = String(req.query.q || "").trim().slice(0, 100);
      const categoryId = Number(req.query.category_id) || null;

      const params = [];
      let where = "WHERE 1=1";
      if (categoryId) {
        params.push(categoryId);
        where += ` AND c.category_id = $${params.length}`;
      }
      if (q) {
        params.push(`%${q}%`);
        where += ` AND (
          c.name ILIKE $${params.length}
          OR c.phone ILIKE $${params.length}
          OR c.email ILIKE $${params.length}
          OR c.address ILIKE $${params.length}
          OR c.barcode ILIKE $${params.length}
          OR c.card_no ILIKE $${params.length}
          OR cc.name ILIKE $${params.length}
        )`;
      }

      const rowsSql = `
        SELECT c.*, cc.name AS category_name,
          (SELECT COUNT(*) FROM sales s WHERE s.customer_id = c.id) AS sales_count,
          COALESCE((SELECT SUM(s.total - s.paid) FROM sales s
                     WHERE s.customer_id = c.id AND s.total > s.paid),0) AS balance
         FROM customers c
         LEFT JOIN customer_categories cc ON cc.id = c.category_id
         ${where}
         ORDER BY c.name ASC, c.id ASC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;

      const summarySql = `
        WITH filtered AS (
          SELECT c.id, c.points,
                 COALESCE((SELECT SUM(s.total - s.paid) FROM sales s
                            WHERE s.customer_id = c.id AND s.total > s.paid),0) AS balance
            FROM customers c
            LEFT JOIN customer_categories cc ON cc.id = c.category_id
            ${where}
        )
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE balance > 0)::int AS with_balance,
               COALESCE(SUM(balance),0) AS total_balance,
               COALESCE(SUM(points),0) AS total_points
          FROM filtered`;

      const [{ rows: [summary] }, { rows }] = await Promise.all([
        pool.query(summarySql, params),
        pool.query(rowsSql, [...params, limit, offset])
      ]);

      res.json({
        rows,
        total: Number(summary.total) || 0,
        page,
        limit,
        summary: {
          total: Number(summary.total) || 0,
          withBalance: Number(summary.with_balance) || 0,
          totalBalance: Number(summary.total_balance) || 0,
          totalPoints: Number(summary.total_points) || 0
        }
      });
    })
  );

  // Lightweight customer book for pages that genuinely need every customer
  // (Broadcast, SMS/email recipients, payments debtor list). Returns only the
  // fields those screens use and computes the outstanding balance with a single
  // grouped scan instead of one correlated subquery per customer.
  router.get(
    "/customers/light",
    h(async (_req, res) => {
      const { rows } = await pool.query(
        `SELECT c.id, c.name, c.phone, c.email, cc.name AS category_name,
                COALESCE(b.balance, 0) AS balance
           FROM customers c
           LEFT JOIN customer_categories cc ON cc.id = c.category_id
           LEFT JOIN (
             SELECT customer_id, SUM(total - paid) AS balance
               FROM sales
              WHERE customer_id IS NOT NULL
              GROUP BY customer_id
           ) b ON b.customer_id = c.id
          ORDER BY c.name`
      );
      res.json(rows);
    })
  );

  router.get(
    "/customers/:id",
    h(async (req, res) => {
      const { rows } = await pool.query(
        `SELECT c.*, cc.name AS category_name,
                (SELECT COUNT(*) FROM sales s WHERE s.customer_id = c.id) AS sales_count,
                COALESCE((SELECT SUM(s.total - s.paid) FROM sales s
                           WHERE s.customer_id = c.id AND s.total > s.paid), 0) AS balance
           FROM customers c
           LEFT JOIN customer_categories cc ON cc.id = c.category_id
          WHERE c.id = $1`,
        [req.params.id]
      );
      if (rows.length === 0) return res.status(404).json({ error: "Customer not found" });
      res.json(rows[0]);
    })
  );

  router.post(
    "/customers",
    h(async (req, res) => {
      const b = req.body || {};
      if (!b.name) return res.status(400).json({ error: "name is required" });
      const card = validateCardNo(b.card_no);
      if (card.error) return res.status(400).json({ error: card.error });
      try {
        const { rows } = await pool.query(
          "INSERT INTO customers (name, phone, email, address, credit_limit, category_id, card_no) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, barcode, card_no, points",
          [b.name, b.phone || null, b.email || null, b.address || null, Number(b.credit_limit) || 0, b.category_id || null, card.cardNo]
        );
        res.status(201).json({ ...b, id: rows[0].id, barcode: rows[0].barcode, card_no: rows[0].card_no, points: rows[0].points });
      } catch (e) {
        const message = cardNoError(e);
        if (message) return res.status(400).json({ error: message });
        throw e;
      }
    })
  );

  router.put(
    "/customers/:id",
    h(async (req, res) => {
      const b = req.body || {};
      const card = validateCardNo(b.card_no);
      if (card.error) return res.status(400).json({ error: card.error });
      try {
        const result = await pool.query(
          "UPDATE customers SET name = $1, phone = $2, email = $3, address = $4, credit_limit = $5, category_id = $6, card_no = $7 WHERE id = $8 RETURNING barcode, card_no, points",
          [b.name, b.phone, b.email, b.address, Number(b.credit_limit) || 0, b.category_id || null, card.cardNo, req.params.id]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: "Customer not found" });
        res.json({ updated: true, barcode: result.rows[0].barcode, card_no: result.rows[0].card_no, points: result.rows[0].points });
      } catch (e) {
        const message = cardNoError(e);
        if (message) return res.status(400).json({ error: message });
        throw e;
      }
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

  // Scan a printed customer card at the counter. Codes are stored upper-case
  // (CTKQZMR) but matched case-insensitively so a typed code also works.
  // The short 4/6-digit card number is accepted too, so the cashier can type
  // the number printed on the card instead of scanning the barcode.
  router.get(
    "/customers/barcode/:barcode",
    h(async (req, res) => {
      const code = String(req.params.barcode || "").trim();
      if (!code) return res.status(400).json({ error: "Barcode is required" });
      const { rows } = await pool.query(
        `SELECT c.*, cc.name AS category_name
           FROM customers c
           LEFT JOIN customer_categories cc ON cc.id = c.category_id
          WHERE LOWER(c.barcode) = LOWER($1) OR c.card_no = $1
          LIMIT 1`,
        [code]
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: "No customer found with that barcode" });
      }
      res.json(rows[0]);
    })
  );

  // ─── Point programmes ──────────────────────────────────────
  // Named earn/redeem rules. A programme is active only inside its date range,
  // and two active programmes may not cover the same day.
  const pointProgramInput = (b) => {
    const name = String(b?.name || "").trim();
    if (!name) throw new Error("Programme name is required");
    const earnPer = Number(b?.earn_per);
    if (!Number.isFinite(earnPer) || earnPer <= 0) {
      throw new Error("Earn rate must be greater than zero");
    }
    const pointValue = Number(b?.point_value);
    if (!Number.isFinite(pointValue) || pointValue < 0) {
      throw new Error("Point value cannot be negative");
    }
    const startsOn = String(b?.starts_on || "").trim() || null;
    const endsOn = String(b?.ends_on || "").trim() || null;
    if (startsOn && endsOn && endsOn < startsOn) {
      throw new Error("End date cannot be before the start date");
    }
    return {
      name,
      earnPer: Math.round(earnPer * 100) / 100,
      pointValue: Math.round(pointValue * 10000) / 10000,
      startsOn,
      endsOn,
      active: b?.active !== false && b?.active !== "false",
      notes: String(b?.notes || "").trim() || null
    };
  };

  const assertNoPointProgramOverlap = async (client, { id = null, startsOn, endsOn, active }) => {
    if (!active) return;
    const { rows } = await client.query(
      `SELECT id, name FROM point_programs
        WHERE active = TRUE
          AND ($1::int IS NULL OR id <> $1)
          AND daterange(
                COALESCE(starts_on, '-infinity'::date),
                COALESCE(ends_on, 'infinity'::date),
                '[]'
              ) && daterange(
                COALESCE($2::date, '-infinity'::date),
                COALESCE($3::date, 'infinity'::date),
                '[]'
              )
        LIMIT 1`,
      [id, startsOn, endsOn]
    );
    if (rows.length > 0) {
      throw new Error(
        `These dates overlap the active programme "${rows[0].name}". Only one programme can run at a time.`
      );
    }
  };

  router.get(
    "/point-programs",
    h(async (req, res) => {
      const { rows: programs } = await pool.query(
        `SELECT p.*,
                (SELECT COUNT(*)::int FROM customer_point_lots l WHERE l.program_id = p.id) AS lot_count,
                (SELECT COALESCE(SUM(l.remaining), 0)::int
                   FROM customer_point_lots l WHERE l.program_id = p.id) AS points_outstanding
           FROM point_programs p
          ORDER BY p.active DESC, p.starts_on DESC NULLS LAST, p.id DESC`
      );
      const active = await getActivePointProgram(pool);
      const { rows: [lotSummary] } = await pool.query(
        `SELECT COALESCE(SUM(remaining), 0)::int AS outstanding_points,
                COALESCE(SUM(remaining * point_value), 0) AS redeemable_value,
                COALESCE(SUM(remaining) FILTER (WHERE program_id IS NULL), 0)::int AS legacy_points,
                COALESCE(SUM(remaining * point_value) FILTER (WHERE program_id IS NULL), 0) AS legacy_value,
                COALESCE(SUM(points), 0)::int AS earned_points
           FROM customer_point_lots`
      );
      const { rows: [saleSummary] } = await pool.query(
        `SELECT COALESCE(SUM(points_redeemed), 0)::int AS redeemed_points,
                COALESCE(SUM(points_discount), 0) AS redeemed_value
           FROM sales`
      );
      const { rows: recent } = await pool.query(
        `SELECT l.id, l.change, l.balance, l.kind, l.point_value, l.reason,
                l.created_at, c.name AS customer_name, p.name AS program_name
           FROM customer_points_ledger l
           JOIN customers c ON c.id = l.customer_id
           LEFT JOIN point_programs p ON p.id = l.program_id
          ORDER BY l.id DESC
          LIMIT 25`
      );
      res.json({
        programs,
        active,
        summary: {
          ...lotSummary,
          redeemable_value: Math.round((Number(lotSummary.redeemable_value) || 0) * 100) / 100,
          legacy_value: Math.round((Number(lotSummary.legacy_value) || 0) * 100) / 100,
          ...saleSummary,
          redeemed_value: Math.round((Number(saleSummary.redeemed_value) || 0) * 100) / 100
        },
        recent
      });
    })
  );

  router.post(
    "/point-programs",
    h(async (req, res) => {
      let input;
      try {
        input = pointProgramInput(req.body);
      } catch (e) {
        return res.status(400).json({ error: e.message });
      }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await assertNoPointProgramOverlap(client, {
          startsOn: input.startsOn,
          endsOn: input.endsOn,
          active: input.active
        });
        const { rows } = await client.query(
          `INSERT INTO point_programs
             (name, earn_per, point_value, starts_on, ends_on, active, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [
            input.name,
            input.earnPer,
            input.pointValue,
            input.startsOn,
            input.endsOn,
            input.active,
            input.notes
          ]
        );
        await client.query("COMMIT");
        res.status(201).json(rows[0]);
      } catch (e) {
        await client.query("ROLLBACK");
        res.status(400).json({ error: e.message });
      } finally {
        client.release();
      }
    })
  );

  router.put(
    "/point-programs/:id",
    h(async (req, res) => {
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ error: "Programme is required" });
      let input;
      try {
        input = pointProgramInput(req.body);
      } catch (e) {
        return res.status(400).json({ error: e.message });
      }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows: exists } = await client.query("SELECT id FROM point_programs WHERE id = $1 FOR UPDATE", [id]);
        if (exists.length === 0) {
          await client.query("ROLLBACK");
          return res.status(404).json({ error: "Programme not found" });
        }
        await assertNoPointProgramOverlap(client, {
          id,
          startsOn: input.startsOn,
          endsOn: input.endsOn,
          active: input.active
        });
        const { rows } = await client.query(
          `UPDATE point_programs
              SET name = $1, earn_per = $2, point_value = $3, starts_on = $4,
                  ends_on = $5, active = $6, notes = $7, updated_at = LOCALTIMESTAMP
            WHERE id = $8 RETURNING *`,
          [
            input.name,
            input.earnPer,
            input.pointValue,
            input.startsOn,
            input.endsOn,
            input.active,
            input.notes,
            id
          ]
        );
        await client.query("COMMIT");
        res.json(rows[0]);
      } catch (e) {
        await client.query("ROLLBACK");
        res.status(400).json({ error: e.message });
      } finally {
        client.release();
      }
    })
  );

  router.delete(
    "/point-programs/:id",
    h(async (req, res) => {
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ error: "Programme is required" });
      const { rowCount } = await pool.query("DELETE FROM point_programs WHERE id = $1", [id]);
      if (rowCount === 0) return res.status(404).json({ error: "Programme not found" });
      res.json({ deleted: true });
    })
  );

  // Points balance plus the full audit trail behind it.
  router.get(
    "/customers/:id/points",
    h(async (req, res) => {
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ error: "Customer is required" });
      const { rows: cust } = await pool.query(
        "SELECT id, name, points FROM customers WHERE id = $1",
        [id]
      );
      if (cust.length === 0) return res.status(404).json({ error: "Customer not found" });
      const { rows: lots } = await pool.query(
        `SELECT point_value,
                SUM(remaining)::int AS points,
                MIN(earned_at) AS first_earned,
                bool_or(program_id IS NULL) AS legacy
           FROM customer_point_lots
          WHERE customer_id = $1 AND remaining > 0
          GROUP BY point_value
          ORDER BY first_earned ASC, point_value ASC`,
        [id]
      );
      const active = await getActivePointProgram(pool);
      const { rows: ledger } = await pool.query(
        `SELECT l.id, l.sale_id, l.change, l.balance, l.reason, l.created_at,
                l.kind, l.point_value, s.invoice_no, p.name AS program_name
           FROM customer_points_ledger l
           LEFT JOIN sales s ON s.id = l.sale_id
           LEFT JOIN point_programs p ON p.id = l.program_id
          WHERE l.customer_id = $1
          ORDER BY l.created_at DESC, l.id DESC
          LIMIT 200`,
        [id]
      );
      const redeemableValue =
        Math.round(lots.reduce((sum, l) => sum + (Number(l.points) || 0) * (Number(l.point_value) || 0), 0) * 100) / 100;
      res.json({
        customer_id: id,
        name: cust[0].name,
        points: Number(cust[0].points) || 0,
        redeemable_value: redeemableValue,
        lots: lots.map((l) => ({
          point_value: Number(l.point_value) || 0,
          points: Number(l.points) || 0,
          legacy: Boolean(l.legacy)
        })),
        active_program: active
          ? {
              id: active.id,
              name: active.name,
              earn_per: Number(active.earn_per) || 0,
              point_value: Number(active.point_value) || 0,
              starts_on: active.starts_on,
              ends_on: active.ends_on
            }
          : null,
        ledger
      });
    })
  );

  // Manual correction (e.g. goodwill points, fixing a typo). Positive adds,
  // negative removes; the balance can never go below zero.
  router.post(
    "/customers/:id/points",
    h(async (req, res) => {
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ error: "Customer is required" });
      const change = Math.trunc(Number(req.body?.change));
      if (!Number.isFinite(change) || change === 0) {
        return res.status(400).json({ error: "Enter a non-zero whole number of points" });
      }
      const reason = String(req.body?.reason || "").trim() || "Manual adjustment";
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows } = await client.query("SELECT points FROM customers WHERE id = $1 FOR UPDATE", [id]);
        if (rows.length === 0) {
          await client.query("ROLLBACK");
          return res.status(404).json({ error: "Customer not found" });
        }
        const current = Math.trunc(Number(rows[0].points) || 0);
        if (current + change < 0) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            error: `Customer only has ${current} point${current === 1 ? "" : "s"}`
          });
        }
        const program = await getActivePointProgram(client);
        const balance = await adjustCustomerPoints(client, {
          customerId: id,
          change,
          reason,
          program
        });
        await client.query("COMMIT");
        res.json({ updated: true, points: balance, change });
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
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
      const validDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || "");
      const today = todayStr();
      let from = validDate(req.query.from) ? String(req.query.from).trim() : null;
      let to = validDate(req.query.to) ? String(req.query.to).trim() : null;
      if (!from && !to) {
        from = today.slice(0, 8) + "01";
        to = today;
      }
      const customerId = Number(req.query.customer_id) || null;
      const q = String(req.query.q || "").trim().slice(0, 100);
      const { page, limit, offset } = pageParams(req, 20);
      const sortMap = {
        newest: "s.created_at DESC, s.id DESC",
        oldest: "s.created_at ASC, s.id ASC",
        name: "COALESCE(c.name, NULLIF(s.online_customer_name, ''), 'Walk-in') ASC, s.created_at DESC, s.id DESC",
        amount_high: "s.total DESC, s.id DESC",
        amount_low: "s.total ASC, s.id ASC"
      };
      const orderBy = sortMap[String(req.query.sort || "newest")] || sortMap.newest;

      const params = [];
      let where = "WHERE s.total <= s.paid AND s.paid > 0";
      if (from) {
        params.push(from);
        where += ` AND s.created_at >= ($${params.length}::date + ${BIZ_SHIFT})`;
      }
      if (to) {
        params.push(to);
        where += ` AND s.created_at < ($${params.length}::date + 1 + ${BIZ_SHIFT})`;
      }
      if (customerId) {
        params.push(customerId);
        where += ` AND s.customer_id = $${params.length}`;
      }
      if (q) {
        params.push(`%${q}%`);
        where += ` AND (
          s.invoice_no ILIKE $${params.length}
          OR COALESCE(c.name, NULLIF(s.online_customer_name, '')) ILIKE $${params.length}
          OR COALESCE(NULLIF(s.online_customer_phone, ''), c.phone) ILIKE $${params.length}
        )`;
      }

      const summarySql = `
        SELECT COUNT(*)::int AS count,
               COALESCE(SUM(s.total),0) AS total_billed,
               COALESCE(SUM(s.paid),0) AS total_received
          FROM sales s
          LEFT JOIN customers c ON c.id = s.customer_id
          ${where}`;

      const rowsSql = `
        SELECT s.id, s.invoice_no, s.customer_id, s.total, s.paid, s.status,
               s.payment_method, s.created_at,
               0 AS due,
               COALESCE(c.name, NULLIF(s.online_customer_name, ''), 'Walk-in') AS customer,
               COALESCE(NULLIF(s.online_customer_phone, ''), c.phone) AS customer_phone,
               pay.payments
          FROM sales s
          LEFT JOIN customers c ON c.id = s.customer_id
          LEFT JOIN LATERAL (
            SELECT COALESCE(
                     json_agg(json_build_object(
                       'id', cp.id, 'amount', cp.amount, 'method', cp.method,
                       'paid_on', cp.paid_on, 'note', cp.note, 'created_at', cp.created_at
                     ) ORDER BY cp.created_at ASC, cp.id ASC),
                     '[]'::json
                   ) AS payments
              FROM customer_payments cp WHERE cp.sale_id = s.id
          ) pay ON TRUE
          ${where}
          ORDER BY ${orderBy}
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;

      const [{ rows: [summary] }, { rows }] = await Promise.all([
        pool.query(summarySql, params),
        pool.query(rowsSql, [...params, limit, offset])
      ]);

      res.json({
        rows,
        total: Number(summary.count) || 0,
        page,
        limit,
        summary: {
          count: Number(summary.count) || 0,
          totalBilled: Number(summary.total_billed) || 0,
          totalReceived: Number(summary.total_received) || 0
        }
      });
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
        `SELECT sp.id, sp.supplier_id, sp.invoice_no, sp.additional_charges, sp.grand_total, sp.paid_amount, sp.due_date, sp.bill_image, sp.bill_images, sp.purchased_at, sp.created_at,
                s.name AS supplier_name,
                s.company_name AS supplier_company,
                (SELECT COUNT(*) FROM supplier_purchase_items spi WHERE spi.purchase_id = sp.id) AS item_count,
                (SELECT string_agg(DISTINCT COALESCE(p.name, spi.item_name), ' ')
                 FROM supplier_purchase_items spi
                 LEFT JOIN products p ON p.id = spi.product_id
                 WHERE spi.purchase_id = sp.id) AS item_names,
                GREATEST(
                  jsonb_array_length(COALESCE(sp.bill_images, '[]'::jsonb)),
                  CASE WHEN COALESCE(sp.bill_image, '') <> '' THEN 1 ELSE 0 END
                ) AS bill_image_count
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
      purchase.bill_images = purchaseImageList(purchase);
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
        const billImages = saveBillImages(b.bill_images, b.bill_image);
        const invoiceNo =
          typeof b.invoice_no === "string" && b.invoice_no.trim() !== "" ? b.invoice_no.trim() : "";
        const { rows: spRows } = await client.query(
          `INSERT INTO supplier_purchases (supplier_id, invoice_no, additional_charges, grand_total, paid_amount, due_date, bill_image, bill_images, purchased_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, COALESCE($9::timestamp, LOCALTIMESTAMP)) RETURNING id, invoice_no`,
          [
            b.supplier_id || null,
            invoiceNo,
            Number(b.additional_charges) || 0,
            Number(b.grand_total) || 0,
            Math.max(0, Number(b.paid_amount) || 0),
            b.due_date || null,
            billImages[0] || null,
            JSON.stringify(billImages),
            b.purchased_at || null
          ]
        );
        const purchaseId = spRows[0].id;

        for (const it of b.items) {
          const qty = Number(it.quantity) || 1;
          const packSize = Number(it.pack_size) || 1;
          // Total stock received = pack quantity × pack size, exactly what the
          // form shows and the grand total is computed from. Quantities can be
          // fractions as small as 0.000001 (e.g. 0.0012 kg of saffron), so the
          // old round-up-to-whole-packs would have booked such a purchase as a
          // full unit. Rounded to six decimals only to shake off float dust.
          const totalQty = Math.round(qty * packSize * 1000000) / 1000000;

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
                 VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
                [
                  it.item_name.trim(),
                  Number(it.purchase_price) || 0,
                  Number(it.selling_price) || 0,
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
               (purchase_id, product_id, item_name, purchase_price, selling_price, quantity, unit_id, pack_size, pack_sub_unit, pack_price, hsn_code, tax, discount)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [
              purchaseId, productId, it.item_name,
              Number(it.purchase_price) || 0, Number(it.selling_price) || 0, totalQty,
              it.unit_id || null, packSize, it.pack_sub_unit || null,
              Number(it.pack_price) || Number(it.purchase_price) || 0,
              it.hsn_code || null, Number(it.tax) || 0, Number(it.discount) || 0
            ]
          );

          if (productId) {
            await insertPurchasePacks(client, {
              productId,
              purchaseId,
              totalQty
            });
            await client.query(
              "UPDATE products SET stock = stock + $1 WHERE id = $2",
              [totalQty, productId]
            );
            await resetOversoldAllowance(client, productId);
            const rate = Number(it.purchase_price) || 0;
            if (rate > 0) {
              await client.query("UPDATE products SET purchase_price = $1 WHERE id = $2", [rate, productId]);
            }
            const sellingRate = Number(it.selling_price) || 0;
            if (sellingRate > 0) {
              await client.query("UPDATE products SET selling_price = $1 WHERE id = $2", [sellingRate, productId]);
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
          "SELECT bill_image, bill_images, invoice_no FROM supplier_purchases WHERE id = $1 FOR UPDATE",
          [req.params.id]
        );
        if (prev.length === 0) {
          await client.query("ROLLBACK");
          return res.status(404).json({ error: "Purchase not found" });
        }
        const prevImages = purchaseImageList(prev[0]);
        const billImages = saveBillImages(b.bill_images, b.bill_image);
        // Bill numbers are normally generated on insert; an edit only overrides
        // the number when the operator typed a new one. Leaving it blank keeps
        // the number the purchase already carries.
        const invoiceNo =
          typeof b.invoice_no === "string" && b.invoice_no.trim() !== ""
            ? b.invoice_no.trim()
            : prev[0].invoice_no || "";
        const result = await client.query(
          `UPDATE supplier_purchases SET supplier_id = $1, invoice_no = $2, additional_charges = $3, grand_total = $4, paid_amount = $5, due_date = $6, bill_image = $7, bill_images = $8::jsonb, purchased_at = $9 WHERE id = $10`,
          [
            b.supplier_id || null,
            invoiceNo,
            Number(b.additional_charges) || 0,
            Number(b.grand_total) || 0,
            Math.max(0, Number(b.paid_amount) || 0),
            b.due_date || null,
            billImages[0] || null,
            JSON.stringify(billImages),
            b.purchased_at || null,
            req.params.id
          ]
        );
        if (result.rowCount === 0) {
          await client.query("ROLLBACK");
          return res.status(404).json({ error: "Purchase not found" });
        }
        for (const url of prevImages) {
          if (!billImages.includes(url)) removeBillImageUrl(url);
        }

        const oldUsage = await loadPurchaseStockUsage(client, req.params.id);
        const stockDeltas = new Map();
        for (const [productId, usage] of oldUsage) {
          stockDeltas.set(productId, -usage.qty);
        }
        await client.query("DELETE FROM product_packs WHERE purchase_id = $1", [req.params.id]);
        await client.query("DELETE FROM supplier_purchase_items WHERE purchase_id = $1", [req.params.id]);

        const newTotals = new Map();
        for (const it of b.items) {
          const qty = Number(it.quantity) || 1;
          const packSize = Number(it.pack_size) || 1;
          const totalQty = Math.round(qty * packSize * 1000000) / 1000000;

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
                 VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
                [
                  it.item_name.trim(),
                  Number(it.purchase_price) || 0,
                  Number(it.selling_price) || 0,
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
               (purchase_id, product_id, item_name, purchase_price, selling_price, quantity, unit_id, pack_size, pack_sub_unit, pack_price, hsn_code, tax, discount)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [
              req.params.id, productId, it.item_name,
              Number(it.purchase_price) || 0, Number(it.selling_price) || 0, totalQty,
              it.unit_id || null, packSize, it.pack_sub_unit || null,
              Number(it.pack_price) || Number(it.purchase_price) || 0,
              it.hsn_code || null, Number(it.tax) || 0, Number(it.discount) || 0
            ]
          );

          if (productId) {
            newTotals.set(productId, (newTotals.get(productId) || 0) + totalQty);
            const rate = Number(it.purchase_price) || 0;
            if (rate > 0) {
              await client.query("UPDATE products SET purchase_price = $1 WHERE id = $2", [rate, productId]);
            }
            const sellingRate = Number(it.selling_price) || 0;
            if (sellingRate > 0) {
              await client.query("UPDATE products SET selling_price = $1 WHERE id = $2", [sellingRate, productId]);
            }
          }
        }

        for (const [productId, usage] of oldUsage) {
          const newQty = newTotals.get(productId) || 0;
          if (usage.consumed > 0 && newQty + 0.0000005 < usage.consumed) {
            const error = new Error(
              `Cannot set "${usage.name}" below ${usage.consumed}${usage.unit ? ` ${usage.unit}` : ""} — that quantity has already been sold or removed`
            );
            error.status = 400;
            throw error;
          }
        }

        for (const [productId, totalQty] of newTotals) {
          const usage = oldUsage.get(productId);
          const consumed = usage?.consumed || 0;
          const remaining = Math.max(0, totalQty - consumed);
          await insertPurchasePacks(client, {
            productId,
            purchaseId: req.params.id,
            totalQty,
            remaining
          });
          stockDeltas.set(productId, (stockDeltas.get(productId) || 0) + totalQty);
        }

        for (const [productId, delta] of stockDeltas) {
          if (delta === 0) continue;
          await client.query("UPDATE products SET stock = stock + $1 WHERE id = $2", [
            delta,
            productId
          ]);
          if (delta > 0) await resetOversoldAllowance(client, productId);
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
          "SELECT bill_image, bill_images FROM supplier_purchases WHERE id = $1 FOR UPDATE",
          [req.params.id]
        );
        const usage = await loadPurchaseStockUsage(client, req.params.id);
        const used = [...usage.values()].filter((u) => u.consumed > 0.0000005);
        if (used.length > 0) {
          await client.query("ROLLBACK");
          const detail = used
            .map((u) => `${u.name} (${u.consumed}${u.unit ? ` ${u.unit}` : ""})`)
            .join(", ");
          return res.status(400).json({
            error: `Cannot delete this purchase — stock has already been sold or removed: ${detail}`
          });
        }
        await client.query("DELETE FROM product_packs WHERE purchase_id = $1", [req.params.id]);
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
        if (prev.length > 0) {
          for (const url of purchaseImageList(prev[0])) removeBillImageUrl(url);
        }
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
      const params = [];
      let where = "WHERE 1=1";
      if (TASK_STATUSES.includes(status)) {
        params.push(status);
        where += ` AND t.status = $${params.length}`;
      }
      const { rows } = await pool.query(
        `SELECT t.*
         FROM tasks t
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
        `SELECT t.* FROM tasks t WHERE t.id = $1`,
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
        `INSERT INTO tasks (title, description, priority, status, due_date)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [title, b.description || null, priority, status, b.due_date || null]
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
        `UPDATE tasks SET title = $1, description = $2, priority = $3, status = $4,
           due_date = $5,
           completed_at = CASE WHEN $4::varchar = 'completed' THEN LOCALTIMESTAMP ELSE NULL END
         WHERE id = $6`,
        [title, b.description || null, priority, status, b.due_date || null, req.params.id]
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
          `SELECT t.id, t.title, t.priority, t.due_date, t.status
           FROM tasks t
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
            "Task",
            null,
            t.due_date,
            "tasks",
            { priority: t.priority, status: t.status }
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
    "notes",
    "status",
    "last_working_date",
    "bank_name",
    "bank_account_no",
    "bank_ifsc",
    "upi_id",
    "date_of_birth",
    "emergency_contact_name",
    "emergency_contact_phone",
    "id_proof_type",
    "id_proof_number"
  ];

  const EMP_STATUSES = ["active", "inactive", "resigned", "terminated"];
  const EMP_SELECT = `id, name, phone, email, address, designation, salary_type, salary_rate,
    joining_date, starting_date, rank, stars, shift_start, shift_end,
    pf_enabled, pf_rate, notes, status, last_working_date, bank_name,
    bank_account_no, bank_ifsc, upi_id, date_of_birth, emergency_contact_name,
    emergency_contact_phone, id_proof_type, id_proof_number, photo_path, created_at`;

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
    RANKS.includes(b.rank) ? b.rank : "noob",
    Math.min(5, Math.max(1, Math.round(Number(b.stars) || 1))),
    b.shift_start || null,
    b.shift_end || null,
    b.pf_enabled === true || b.pf_enabled === "true" || b.pf_enabled === 1,
    Number(b.pf_rate) || 0,
    b.notes ? String(b.notes).trim() : null,
    EMP_STATUSES.includes(b.status) ? b.status : "active",
    b.last_working_date || null,
    b.bank_name ? String(b.bank_name).trim() : null,
    b.bank_account_no ? String(b.bank_account_no).trim() : null,
    b.bank_ifsc ? String(b.bank_ifsc).trim().toUpperCase() : null,
    b.upi_id ? String(b.upi_id).trim() : null,
    b.date_of_birth || null,
    b.emergency_contact_name ? String(b.emergency_contact_name).trim() : null,
    b.emergency_contact_phone ? String(b.emergency_contact_phone).trim() : null,
    b.id_proof_type ? String(b.id_proof_type).trim() : null,
    b.id_proof_number ? String(b.id_proof_number).trim() : null
  ];

  const validMonth = (m) => /^\d{4}-\d{2}$/.test(String(m || ""));

  async function loadPayrollData() {
    const [att, pays] = await Promise.all([
      pool.query(
        `SELECT employee_id, date, status, time_in, time_out,
                to_char(date, 'YYYY-MM') AS month
         FROM attendance ORDER BY employee_id, date`
      ),
      pool.query(
        `SELECT employee_id, type, amount, payment_method, note, date,
                to_char(date, 'YYYY-MM') AS month
         FROM employee_payments ORDER BY date, id`
      )
    ]);
    return { att: att.rows, pays: pays.rows };
  }

  function withPayroll(emp, data, month) {
    const myAtt = data.att.filter((a) => String(a.employee_id) === String(emp.id));
    const myPays = data.pays.filter((p) => String(p.employee_id) === String(emp.id));
    const monthRows = myAtt.filter((a) => a.month === month);
    const monthPays = myPays.filter((p) => p.month === month);

    const byMonth = new Map();
    for (const a of myAtt) {
      if (!a.month) continue;
      if (!byMonth.has(a.month)) byMonth.set(a.month, []);
      byMonth.get(a.month).push(a);
    }
    const allMonths = [...byMonth.entries()].map(([key, rows]) => ({
      month: key,
      accrual: monthAccrual(emp, rows).accrual
    }));

    return { ...emp, payroll: payrollFor(emp, monthRows, monthPays, allMonths, myPays) };
  }

  async function monthLocked(month) {
    const { rows } = await pool.query(
      "SELECT 1 FROM employee_payrolls WHERE month = $1 LIMIT 1",
      [month]
    );
    return rows.length > 0;
  }

  async function ensureMonthOpen(month, res) {
    if (await monthLocked(month)) {
      res.status(400).json({
        error: "This payroll month is finalized. Reopen it before changing attendance or payments."
      });
      return false;
    }
    return true;
  }

  router.get(
    "/employees",
    h(async (req, res) => {
      const month = validMonth(req.query.month) ? String(req.query.month) : todayStr().slice(0, 7);
      const { rows } = await pool.query(`SELECT ${EMP_SELECT} FROM employees ORDER BY name`);
      const data = await loadPayrollData();
      const docRows = await pool.query(
        "SELECT employee_id, count(*)::int AS documents FROM employee_documents GROUP BY employee_id"
      );
      const docs = new Map(docRows.rows.map((d) => [String(d.employee_id), d.documents]));

      res.json(
        rows.map((e) => ({
          ...withPayroll(e, data, month),
          month,
          documents: docs.get(String(e.id)) || 0
        }))
      );
    })
  );

  router.get(
    "/employees/:id",
    h(async (req, res) => {
      const { rows } = await pool.query(
        `SELECT ${EMP_SELECT} FROM employees WHERE id = $1`,
        [req.params.id]
      );
      if (rows.length === 0) return res.status(404).json({ error: "Employee not found" });

      const month = validMonth(req.query.month) ? String(req.query.month) : todayStr().slice(0, 7);
      const data = await loadPayrollData();
      const { rows: documents } = await pool.query(
        `SELECT id, employee_id, category, label, file_path, file_type, file_size, uploaded_at
         FROM employee_documents WHERE employee_id = $1 ORDER BY uploaded_at DESC, id DESC`,
        [req.params.id]
      );

      res.json({ ...withPayroll(rows[0], data, month), month, documents });
    })
  );

  router.get(
    "/employees/:id/ledger",
    h(async (req, res) => {
      const month = validMonth(req.query.month) ? String(req.query.month) : todayStr().slice(0, 7);
      const { rows } = await pool.query(
        `SELECT id, name, salary_type, salary_rate, starting_date, pf_enabled, pf_rate
         FROM employees WHERE id = $1`,
        [req.params.id]
      );
      if (rows.length === 0) return res.status(404).json({ error: "Employee not found" });

      const data = await loadPayrollData();
      const mine = (list) => list.filter((x) => String(x.employee_id) === String(req.params.id));
      const led = ledgerFor(
        rows[0],
        mine(data.att).filter((a) => a.month === month),
        mine(data.pays).filter((p) => p.month === month)
      );

      const snapshot = await pool.query(
        `SELECT id, status, accrual, pf_employee, pf_employer, paid_before, net_payable,
                finalized_at, paid_at, note
         FROM employee_payrolls WHERE employee_id = $1 AND month = $2`,
        [req.params.id, month]
      );

      res.json({
        employee_id: Number(req.params.id),
        month,
        ...led,
        payroll: snapshot.rows[0] || null
      });
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
      const { rows } = await pool.query(
        "SELECT photo_path FROM employees WHERE id = $1",
        [req.params.id]
      );
      if (rows.length === 0) return res.status(404).json({ error: "Employee not found" });
      const { rows: docs } = await pool.query(
        "SELECT file_path FROM employee_documents WHERE employee_id = $1",
        [req.params.id]
      );
      await pool.query("DELETE FROM employees WHERE id = $1", [req.params.id]);
      if (rows[0].photo_path) removeEmployeeDocPath(rows[0].photo_path);
      for (const d of docs) removeEmployeeDocPath(d.file_path);
      res.json({ deleted: true });
    })
  );

  router.post(
    "/employees/:id/photo",
    raw({ type: "application/octet-stream", limit: "8mb" }),
    h(async (req, res) => {
      const { rows } = await pool.query(
        "SELECT photo_path FROM employees WHERE id = $1",
        [req.params.id]
      );
      if (rows.length === 0) return res.status(404).json({ error: "Employee not found" });
      let rawName = "";
      try {
        rawName = decodeURIComponent(String(req.get("x-file-name") || ""));
      } catch {
        rawName = String(req.get("x-file-name") || "");
      }
      const saved = await persistEmployeePhoto(
        req.params.id,
        req.body,
        req.get("x-file-type"),
        rawName
      );
      await pool.query("UPDATE employees SET photo_path = $1 WHERE id = $2", [
        saved.file_path,
        req.params.id
      ]);
      if (rows[0].photo_path) removeEmployeeDocPath(rows[0].photo_path);
      res.status(201).json(saved);
    })
  );

  router.delete(
    "/employees/:id/photo",
    h(async (req, res) => {
      const { rows } = await pool.query(
        "SELECT photo_path FROM employees WHERE id = $1",
        [req.params.id]
      );
      if (rows.length === 0) return res.status(404).json({ error: "Employee not found" });
      await pool.query("UPDATE employees SET photo_path = NULL WHERE id = $1", [req.params.id]);
      if (rows[0].photo_path) removeEmployeeDocPath(rows[0].photo_path);
      res.json({ deleted: true });
    })
  );

  // ─── Employee documents ────────────────────────────────────
  router.get(
    "/employee-documents",
    h(async (req, res) => {
      const { employee_id } = req.query;
      const { rows } = await pool.query(
        `SELECT d.id, d.employee_id, d.category, d.label, d.file_path, d.file_type,
                d.file_size, d.uploaded_at, e.name AS employee_name
         FROM employee_documents d JOIN employees e ON e.id = d.employee_id
         WHERE ($1::int IS NULL OR d.employee_id = $1::int)
         ORDER BY d.uploaded_at DESC, d.id DESC`,
        [employee_id || null]
      );
      res.json(rows);
    })
  );

  router.post(
    "/employees/:id/documents/upload",
    raw({ type: "application/octet-stream", limit: "12mb" }),
    h(async (req, res) => {
      const { rows } = await pool.query("SELECT id FROM employees WHERE id = $1", [req.params.id]);
      if (rows.length === 0) return res.status(404).json({ error: "Employee not found" });

      let rawName = "";
      try {
        rawName = decodeURIComponent(String(req.get("x-file-name") || ""));
      } catch {
        rawName = String(req.get("x-file-name") || "");
      }
      const saved = await persistEmployeeDoc(
        req.params.id,
        req.body,
        req.get("x-file-type"),
        rawName
      );

      const label = String(req.get("x-file-label") || "").trim() || null;
      const category = String(req.get("x-file-category") || "").trim() || "Other";
      const inserted = await pool.query(
        `INSERT INTO employee_documents (employee_id, category, label, file_path, file_type, file_size)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id, employee_id, category, label, file_path, file_type, file_size, uploaded_at`,
        [req.params.id, category, label, saved.file_path, saved.file_type, saved.file_size]
      );
      res.status(201).json(inserted.rows[0]);
    })
  );

  router.delete(
    "/employee-documents/:id",
    h(async (req, res) => {
      const { rows } = await pool.query("SELECT file_path FROM employee_documents WHERE id = $1", [
        req.params.id
      ]);
      const result = await pool.query("DELETE FROM employee_documents WHERE id = $1", [
        req.params.id
      ]);
      if (result.rowCount === 0) return res.status(404).json({ error: "Document not found" });
      if (rows[0]) removeEmployeeDocPath(rows[0].file_path);
      res.json({ deleted: true });
    })
  );

  // ─── Attendance ────────────────────────────────────────────
  router.get(
    "/attendance",
    h(async (req, res) => {
      const { from, to, employee_id } = req.query;
      const { rows } = await pool.query(
        `SELECT a.*, e.name AS employee_name
         FROM attendance a JOIN employees e ON e.id = a.employee_id
         WHERE ($1::date IS NULL OR a.date >= $1::date)
           AND ($2::date IS NULL OR a.date <= $2::date)
           AND ($3::int IS NULL OR a.employee_id = $3::int)
         ORDER BY a.date DESC, e.name ASC`,
        [from || null, to || null, employee_id || null]
      );
      res.json(rows);
    })
  );

  router.post(
    "/attendance",
    h(async (req, res) => {
      const b = req.body || {};
      if (!b.employee_id || !b.date) {
        return res.status(400).json({ error: "employee_id and date are required" });
      }
      const day = String(b.date).slice(0, 10);
      if (!(await ensureMonthOpen(day.slice(0, 7), res))) return;
      const status = DAY_FRACTION[b.status] != null ? b.status : "present";
      const { rows } = await pool.query(
        `INSERT INTO attendance (employee_id, date, time_in, time_out, status, notes)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (employee_id, date)
         DO UPDATE SET time_in = EXCLUDED.time_in, time_out = EXCLUDED.time_out,
           status = EXCLUDED.status, notes = EXCLUDED.notes
         RETURNING id`,
        [b.employee_id, day, b.time_in || null, b.time_out || null, status, b.notes || null]
      );
      res.status(201).json({ id: rows[0].id, updated: true });
    })
  );

  router.put(
    "/attendance/:id",
    h(async (req, res) => {
      const b = req.body || {};
      const existing = await pool.query("SELECT date FROM attendance WHERE id = $1", [
        req.params.id
      ]);
      if (existing.rows.length === 0) return res.status(404).json({ error: "Attendance not found" });
      const day = dstr(existing.rows[0].date);
      if (!(await ensureMonthOpen(day.slice(0, 7), res))) return;
      const status = DAY_FRACTION[b.status] != null ? b.status : "present";
      await pool.query(
        `UPDATE attendance SET time_in = $1, time_out = $2, status = $3, notes = $4 WHERE id = $5`,
        [b.time_in || null, b.time_out || null, status, b.notes || null, req.params.id]
      );
      res.json({ updated: true });
    })
  );

  router.delete(
    "/attendance/:id",
    h(async (req, res) => {
      const existing = await pool.query("SELECT date FROM attendance WHERE id = $1", [
        req.params.id
      ]);
      if (existing.rows.length === 0) return res.status(404).json({ error: "Attendance not found" });
      if (!(await ensureMonthOpen(dstr(existing.rows[0].date).slice(0, 7), res))) return;
      await pool.query("DELETE FROM attendance WHERE id = $1", [req.params.id]);
      res.json({ deleted: true });
    })
  );

  // ─── Employee payments ─────────────────────────────────────
  const employeePaymentList = h(async (req, res) => {
    const { from, to, employee_id } = req.query;
    const { rows } = await pool.query(
      `SELECT p.*, e.name AS employee_name
       FROM employee_payments p JOIN employees e ON e.id = p.employee_id
       WHERE ($1::date IS NULL OR p.date::date >= $1::date)
         AND ($2::date IS NULL OR p.date::date <= $2::date)
         AND ($3::int IS NULL OR p.employee_id = $3::int)
       ORDER BY p.date DESC, p.id DESC`,
      [from || null, to || null, employee_id || null]
    );
    res.json(rows);
  });

  router.get("/employee-payments", employeePaymentList);
  router.get("/payments", employeePaymentList);

  router.post(
    "/employees/:id/payments",
    h(async (req, res) => {
      const b = req.body || {};
      const amount = Number(b.amount);
      if (!amount || amount <= 0) return res.status(400).json({ error: "amount is required" });
      if (!PAYMENT_TYPES.includes(b.type)) {
        return res.status(400).json({ error: `type must be one of ${PAYMENT_TYPES.join(", ")}` });
      }
      if (!(await ensureMonthOpen(String(b.date || todayStr()).slice(0, 7), res))) return;
      const { rows } = await pool.query(
        `INSERT INTO employee_payments (employee_id, type, amount, payment_method, note, date)
         VALUES ($1,$2,$3,$4,$5, COALESCE($6::timestamp, LOCALTIMESTAMP)) RETURNING id`,
        [
          req.params.id,
          b.type,
          amount,
          b.payment_method || "cash",
          b.note || null,
          b.date || null
        ]
      );
      res.status(201).json({ id: rows[0].id, ...b });
    })
  );

  const deleteEmployeePayment = h(async (req, res) => {
    const existing = await pool.query("SELECT date FROM employee_payments WHERE id = $1", [
      req.params.id
    ]);
    if (existing.rows.length === 0) return res.status(404).json({ error: "Payment not found" });
    if (!(await ensureMonthOpen(dstr(existing.rows[0].date).slice(0, 7), res))) return;
    await pool.query("DELETE FROM employee_payments WHERE id = $1", [req.params.id]);
    res.json({ deleted: true });
  });

  router.delete("/employee-payments/:id", deleteEmployeePayment);
  router.delete("/payments/:id", deleteEmployeePayment);

  // ─── Payroll month: draft → finalize → paid ─────────────────
  router.get(
    "/employee-payroll",
    h(async (req, res) => {
      const month = validMonth(req.query.month) ? String(req.query.month) : todayStr().slice(0, 7);
      const { rows: employees } = await pool.query(
        `SELECT ${EMP_SELECT} FROM employees ORDER BY name`
      );
      const data = await loadPayrollData();
      const { rows: snapshots } = await pool.query(
        `SELECT employee_id, status, accrual, pf_employee, pf_employer, paid_before,
                net_payable, finalized_at, paid_at, note
         FROM employee_payrolls WHERE month = $1`,
        [month]
      );
      const snapMap = new Map(snapshots.map((s) => [String(s.employee_id), s]));

      const rows = employees.map((emp) => {
        const live = withPayroll(emp, data, month).payroll;
        const snap = snapMap.get(String(emp.id));
        const finalized = !!snap;
        return {
          ...emp,
          month,
          payroll: live,
          accrual: finalized ? Number(snap.accrual) : live.accrual,
          pf_employee: finalized ? Number(snap.pf_employee) : live.pf.employee,
          pf_employer: finalized ? Number(snap.pf_employer) : live.pf.employer,
          paid_before: finalized ? Number(snap.paid_before) : live.paid.total,
          net_payable: finalized ? Number(snap.net_payable) : live.balance,
          balance: finalized ? Number(snap.net_payable) : live.balance,
          paid_days: live.paidDays,
          daily: live.daily,
          payroll_status: finalized ? snap.status : "draft",
          finalized_at: snap?.finalized_at || null,
          paid_at: snap?.paid_at || null,
          payroll_note: snap?.note || null
        };
      });

      res.json({
        month,
        locked: snapshots.length > 0,
        has_paid: snapshots.some((s) => s.status === "paid"),
        rows
      });
    })
  );

  router.post(
    "/employee-payroll/finalize",
    h(async (req, res) => {
      const month = String(req.body?.month || "").trim();
      if (!validMonth(month)) return res.status(400).json({ error: "A valid month is required" });

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const paid = await client.query(
          "SELECT employee_id FROM employee_payrolls WHERE month = $1 AND status = 'paid'",
          [month]
        );
        const paidIds = new Set(paid.rows.map((r) => String(r.employee_id)));
        await client.query(
          "DELETE FROM employee_payrolls WHERE month = $1 AND status <> 'paid'",
          [month]
        );

        const { rows: employees } = await client.query(`SELECT ${EMP_SELECT} FROM employees`);
        const [att, pays] = await Promise.all([
          client.query(
            `SELECT employee_id, date, status FROM attendance
             WHERE to_char(date, 'YYYY-MM') = $1`,
            [month]
          ),
          client.query(
            `SELECT employee_id, type, amount, date FROM employee_payments
             WHERE to_char(date, 'YYYY-MM') = $1`,
            [month]
          )
        ]);

        let count = 0;
        for (const emp of employees) {
          if (paidIds.has(String(emp.id))) continue;
          const monthAtt = att.rows.filter((a) => String(a.employee_id) === String(emp.id));
          const monthPays = pays.rows.filter((p) => String(p.employee_id) === String(emp.id));
          const earned = monthAccrual(emp, monthAtt);
          const pf = payrollFor(emp, monthAtt, monthPays).pf;
          const paidBefore = monthPays.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
          const net = Math.round((earned.accrual - pf.employee - paidBefore) * 100) / 100;
          await client.query(
            `INSERT INTO employee_payrolls
             (employee_id, month, accrual, pf_employee, pf_employer, paid_before, net_payable)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [emp.id, month, earned.accrual, pf.employee, pf.employer, paidBefore, net]
          );
          count += 1;
        }
        await client.query("COMMIT");
        res.status(201).json({ finalized: count, month });
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    })
  );

  router.delete(
    "/employee-payroll/:month",
    h(async (req, res) => {
      const month = String(req.params.month || "");
      if (!validMonth(month)) return res.status(400).json({ error: "A valid month is required" });
      const paid = await pool.query(
        "SELECT 1 FROM employee_payrolls WHERE month = $1 AND status = 'paid' LIMIT 1",
        [month]
      );
      if (paid.rows.length) {
        return res.status(400).json({
          error: "This month has paid payslips. Reopening it would orphan the payments already recorded."
        });
      }
      await pool.query("DELETE FROM employee_payrolls WHERE month = $1", [month]);
      res.json({ reopened: true, month });
    })
  );

  router.post(
    "/employee-payroll/:employeeId/pay",
    h(async (req, res) => {
      const month = String(req.body?.month || "").trim();
      if (!validMonth(month)) return res.status(400).json({ error: "A valid month is required" });

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows } = await client.query(
          `SELECT id, employee_id, net_payable, status
           FROM employee_payrolls WHERE employee_id = $1 AND month = $2 FOR UPDATE`,
          [req.params.employeeId, month]
        );
        if (rows.length === 0) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "Finalize this payroll month first." });
        }
        const payroll = rows[0];
        if (payroll.status === "paid") {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "This payslip is already marked paid." });
        }

        const amount = Math.round((Number(payroll.net_payable) || 0) * 100) / 100;
        if (amount > 0) {
          await client.query(
            `INSERT INTO employee_payments (employee_id, type, amount, payment_method, note, date)
             VALUES ($1, 'salary', $2, $3, $4,
                     (($5 || '-01')::date + interval '1 month - 1 day'))`,
            [
              payroll.employee_id,
              amount,
              req.body?.payment_method || "cash",
              req.body?.note || `Salary for ${month}`,
              month
            ]
          );
        }
        await client.query(
          `UPDATE employee_payrolls SET status = 'paid', paid_at = LOCALTIMESTAMP, note = $1
           WHERE id = $2`,
          [req.body?.note || null, payroll.id]
        );
        await client.query("COMMIT");
        res.json({ paid: true, amount: Math.max(0, amount), month });
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
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
                       AND CURRENT_DATE > (COALESCE(c.month_count_start, date_trunc('month', c.start_date))
                                           + (c.months || ' months')::interval - interval '1 day')::date
                       THEN 'ended'
                  WHEN c.start_date IS NOT NULL AND c.start_date > CURRENT_DATE THEN 'upcoming'
                  ELSE 'active'
                END AS computed_status,
                CASE
                  WHEN c.start_date IS NOT NULL AND COALESCE(c.months,0) > 0
                       THEN (COALESCE(c.month_count_start, date_trunc('month', c.start_date))
                             + (c.months || ' months')::interval - interval '1 day')::date
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
        `INSERT INTO voucher_campaigns (name, discount_type, discount_value, quantity, issue_limit, min_total, months, start_date, end_date, month_count_start, tiers)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) RETURNING id`,
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
          b.month_count_start || null,
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
               tiers = CASE WHEN $13::boolean THEN $14::jsonb ELSE tiers END,
               month_count_start = CASE WHEN $16::boolean THEN $15::date ELSE month_count_start END
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
          hasTiers ? JSON.stringify(tiers || []) : null,
          b.month_count_start || null,
          Object.prototype.hasOwnProperty.call(b, "month_count_start")
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
                c.months, c.month_count_start,
                c.start_date AS valid_from, c.end_date
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
      const countAnchor = dstr(v.month_count_start);
      //-windows counting: anchored when the campaign set a start, else calendar
      const curMonth = voucherMonthKey(countAnchor, todayStr);
      const usedThisMonth = curMonth != null && v.uses.some((u) => u.month_key === curMonth);
      const months = Number(v.months) || 0;
      const remainingUses = Math.max(0, months - v.uses.length);
      let error = null;
      if (v.status !== "issued") error = `This voucher has already been used (${v.uses.length} times)`;
      else if (from && todayStr < from) error = `This voucher starts on ${from}`;
      else if (countAnchor && todayStr < countAnchor) error = `The monthly count for this voucher starts on ${countAnchor}`;
      else if (curMonth != null && usedThisMonth) error = "This voucher is already used this month — try again next month";
      else if (curMonth == null) error = `The monthly count for this voucher starts on ${countAnchor}`;
      else if (through && todayStr > through) error = `This voucher expired on ${through}`;
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
        `SELECT v.id, v.campaign_id, v.code, v.status, v.bill_id, v.customer_name, v.customer_phone,
                v.is_manual, v.sale_total, v.issued_at, v.redeemed_at, v.redeemed_bill_id,
                c.name AS campaign_name,
                COALESCE(v.discount_type, c.discount_type) AS discount_type,
                COALESCE(v.discount_value, c.discount_value) AS discount_value,
                COALESCE(v.min_total, c.min_total) AS min_total,
                c.months, c.month_count_start,
                c.start_date AS valid_from, c.end_date
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
            // "This month ✓" respects the campaign's month-count anchor.
            used_this_month:
              r.month_count_start != null
                ? uses.some((u) => u.month_key === voucherMonthKey(dstr(r.month_count_start), todayStr))
                : uses.some((u) => u.month_key === monthKeyOf(todayStr))
          };
        })
      );
    })
  );

  router.post(
    "/vouchers/manual",
    h(async (req, res) => {
      const b = req.body || {};
      const campaignId = Number(b.campaign_id) || null;
      if (!campaignId) return res.status(400).json({ error: "Choose a voucher building" });
      const customerId = Number(b.customer_id) || null;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows: [campaign] } = await client.query(
          `SELECT c.*,
                  CASE
                    WHEN c.start_date IS NOT NULL AND COALESCE(c.months,0) > 0
                         AND CURRENT_DATE > (COALESCE(c.month_count_start, date_trunc('month', c.start_date))
                                             + (c.months || ' months')::interval - interval '1 day')::date
                         THEN 'ended'
                    WHEN c.start_date IS NOT NULL AND c.start_date > CURRENT_DATE THEN 'upcoming'
                    ELSE 'active'
                  END AS computed_status,
                  CASE
                    WHEN c.start_date IS NOT NULL AND COALESCE(c.months,0) > 0
                         THEN (COALESCE(c.month_count_start, date_trunc('month', c.start_date))
                               + (c.months || ' months')::interval - interval '1 day')::date
                    ELSE c.end_date
                  END AS valid_through
           FROM voucher_campaigns c WHERE c.id = $1 FOR UPDATE`,
          [campaignId]
        );
        if (!campaign) {
          await client.query("ROLLBACK");
          return res.status(404).json({ error: "Voucher building not found" });
        }
        const { rows: [{ d: todayStr }] } = await client.query("SELECT CURRENT_DATE::text AS d");
        const through = dstr(campaign.valid_through);
        if (campaign.computed_status === "ended" || (through && todayStr > through)) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "This voucher building has ended" });
        }
        if (Number(campaign.issued_count) >= Number(campaign.issue_limit)) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "This voucher building has reached its issue limit" });
        }

        let customerName = String(b.customer_name || "").trim();
        let customerPhone = String(b.customer_phone || "").trim();
        if (customerId) {
          const { rows: [customer] } = await client.query(
            "SELECT name, phone FROM customers WHERE id = $1",
            [customerId]
          );
          if (!customer) {
            await client.query("ROLLBACK");
            return res.status(400).json({ error: "Customer not found" });
          }
          customerName = String(customer.name || customerName).trim();
          customerPhone = String(customer.phone || customerPhone).trim();
        }
        if (!customerName) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "Enter the customer name" });
        }

        let rawTiers = campaign.tiers;
        if (typeof rawTiers === "string") {
          try {
            rawTiers = JSON.parse(rawTiers);
          } catch {
            rawTiers = [];
          }
        }
        const parsedTiers = normalizeVoucherTiers(Array.isArray(rawTiers) ? rawTiers : [], campaign.discount_type);
        if (parsedTiers.error) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: parsedTiers.error });
        }
        const tiers = parsedTiers.tiers && parsedTiers.tiers.length
          ? parsedTiers.tiers
          : [{
              min_total: Number(campaign.min_total) || 0,
              discount_type: campaign.discount_type === "percent" ? "percent" : "rupee",
              discount_value: Number(campaign.discount_value) || 0
            }];
        const requestedMin = Number(b.min_total) || 0;
        const requestedValue = Number(b.discount_value) || 0;
        const requestedType = b.discount_type === "percent" ? "percent" : "rupee";
        const tier = tiers.find(
          (t) =>
            Number(t.min_total) === requestedMin &&
            Number(t.discount_value) === requestedValue &&
            t.discount_type === requestedType
        );
        if (!tier) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "Choose an offer from this voucher building" });
        }

        let inserted = null;
        for (let attempt = 0; attempt < 20 && !inserted; attempt++) {
          const code = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
          try {
            const { rows } = await client.query(
              `INSERT INTO vouchers (campaign_id, code, status, bill_id, customer_name, customer_phone, is_manual, sale_total, discount_type, discount_value, min_total)
               VALUES ($1,$2,'issued',NULL,$3,$4,TRUE,NULL,$5,$6,$7)
               RETURNING id, code, issued_at`,
              [campaignId, code, customerName, customerPhone || null, tier.discount_type, tier.discount_value, tier.min_total]
            );
            inserted = rows[0];
          } catch (e) {
            if (e.code !== "23505") throw e;
          }
        }
        if (!inserted) throw new Error("Could not allocate a unique voucher code");

        await client.query(
          "UPDATE voucher_campaigns SET issued_count = issued_count + 1 WHERE id = $1",
          [campaignId]
        );
        await client.query("COMMIT");

        res.status(201).json({
          ...inserted,
          campaign_id: campaignId,
          status: "issued",
          bill_id: null,
          customer_id: customerId,
          customer_name: customerName,
          customer_phone: customerPhone || null,
          is_manual: true,
          sale_total: null,
          campaign_name: campaign.name,
          discount_type: tier.discount_type,
          discount_value: Number(tier.discount_value),
          min_total: Number(tier.min_total) || 0,
          months: Number(campaign.months) || 0,
          valid_from: dstr(campaign.start_date) || null,
          valid_through: through || null,
          use_count: 0,
          uses_left: Number(campaign.months) || 0
        });
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
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
