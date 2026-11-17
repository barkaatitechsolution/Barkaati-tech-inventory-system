// Local API for the offline app. Every method talks to the on-device SQLite
// database; there is no network here. Method names mirror the web app so the
// shared components and receipt code keep working unchanged.
import { now, query, queryOne, run, today, transaction } from "./db/index.js";
import { deleteFile, isDataUrl, resolveFileUrl, saveDataUrl } from "./lib/files.js";
import {
  DAY_FRACTION,
  PAYMENT_TYPES,
  RANKS,
  ledgerFor,
  monthAccrual,
  payrollFor
} from "./lib/payroll.js";

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;
const bool = (v) => (v === true || v === 1 || v === "1" || v === "true" ? 1 : 0);

export function bustCache() {}
export function onPeerChange() {
  return () => {};
}

// ─── Store info ───────────────────────────────────────────────
const STORE_FIELDS = [
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
  ["onlineStoreEnabled", "online_store_enabled", 1],
  ["onlineStoreUrl", "online_store_url", ""],
  ["printerName", "printer_name", ""],
  ["printerAddress", "printer_address", ""],
  ["paperWidthMm", "paper_width_mm", 58]
];

function storeInfoFromRow(row) {
  const out = {};
  for (const [key, column, fallback] of STORE_FIELDS) {
    const value = row?.[column];
    out[key] = value === null || value === undefined ? fallback : value;
  }
  out.deliveryFee = num(out.deliveryFee);
  out.paperWidthMm = num(out.paperWidthMm) || 58;
  out.onlineStoreEnabled = !!out.onlineStoreEnabled;
  return out;
}

async function storeInfo() {
  const row = await queryOne("SELECT * FROM store_info WHERE id = 1");
  return storeInfoFromRow(row);
}

async function saveStoreInfo(data = {}) {
  const current = await storeInfo();
  const merged = { ...current, ...data };
  const cols = STORE_FIELDS.map(([, c]) => c);
  const values = STORE_FIELDS.map(([key, , fallback]) => {
    const v = merged[key];
    if (key === "onlineStoreEnabled") return bool(v);
    if (key === "deliveryFee" || key === "paperWidthMm") return num(v) || (key === "paperWidthMm" ? 58 : 0);
    return v === undefined || v === null ? fallback : String(v);
  });
  await run(
    `INSERT INTO store_info (id, ${cols.join(", ")}, updated_at)
     VALUES (1, ${cols.map(() => "?").join(", ")}, ?)
     ON CONFLICT(id) DO UPDATE SET ${cols.map((c) => `${c} = excluded.${c}`).join(", ")},
       updated_at = excluded.updated_at`,
    [...values, now()]
  );
  return storeInfo();
}

// ─── Categories / units ───────────────────────────────────────
async function categories() {
  const rows = await query("SELECT * FROM categories ORDER BY name");
  const subs = await query("SELECT * FROM subcategories ORDER BY name");
  return rows.map((c) => ({
    ...c,
    subcategories: subs.filter((s) => s.category_id === c.id)
  }));
}

async function saveCategory(id, data = {}) {
  const name = String(data.name || "").trim();
  if (!name) throw new Error("Category name is required");
  return transaction(async () => {
    let categoryId = id ? Number(id) : null;
    if (categoryId) {
      await run("UPDATE categories SET name = ? WHERE id = ?", [name, categoryId]);
    } else {
      const res = await run("INSERT INTO categories (name) VALUES (?)", [name]);
      categoryId = res.lastId;
    }
    const subs = Array.isArray(data.subcategories) ? data.subcategories : [];
    await run("DELETE FROM subcategories WHERE category_id = ?", [categoryId]);
    for (const s of subs) {
      const subName = String(typeof s === "string" ? s : s.name || "").trim();
      if (!subName) continue;
      await run(
        "INSERT INTO subcategories (category_id, name, quality_stars) VALUES (?, ?, ?)",
        [categoryId, subName, Number(typeof s === "object" ? s.quality_stars : 0) || 0]
      );
    }
    return { id: categoryId, name };
  });
}

async function deleteCategory(id) {
  await run("DELETE FROM categories WHERE id = ?", [id]);
  return { deleted: true };
}

async function measuringUnits() {
  return query("SELECT * FROM measuring_units ORDER BY name");
}

async function saveMeasuringUnit(id, data = {}) {
  const values = [
    String(data.name || "").trim(),
    String(data.short_name || data.shortName || "").trim(),
    String(data.category || "count"),
    num(data.conversion_factor ?? data.conversionFactor) || 1
  ];
  if (!values[0]) throw new Error("Unit name is required");
  if (id) {
    await run(
      "UPDATE measuring_units SET name=?, short_name=?, category=?, conversion_factor=? WHERE id=?",
      [...values, id]
    );
    return { id: Number(id) };
  }
  const res = await run(
    "INSERT INTO measuring_units (name, short_name, category, conversion_factor) VALUES (?,?,?,?)",
    values
  );
  return { id: res.lastId };
}

async function deleteMeasuringUnit(id) {
  await run("DELETE FROM measuring_units WHERE id = ?", [id]);
  return { deleted: true };
}

async function items() {
  const rows = await query(
    `SELECT DISTINCT name AS item_name FROM products WHERE name IS NOT NULL AND name <> ''
     UNION SELECT item_name FROM supplier_purchase_items
     WHERE item_name IS NOT NULL AND item_name <> '' ORDER BY item_name`
  );
  return rows.map((r) => r.item_name);
}

// ─── Products ─────────────────────────────────────────────────
const PRODUCT_COLS = [
  "name",
  "sku",
  "barcode",
  "unit",
  "unit_id",
  "category_id",
  "subcategory_id",
  "selling_price",
  "market_price",
  "purchase_price",
  "tax",
  "discount",
  "hsn_code",
  "description",
  "reorder_level",
  "stock",
  "online",
  "oversold_qty"
];

function productValues(data = {}) {
  return [
    String(data.name || "").trim(),
    String(data.sku || "").trim(),
    String(data.barcode || "").trim(),
    String(data.unit || "pcs"),
    data.unit_id ? Number(data.unit_id) : null,
    data.category_id ? Number(data.category_id) : null,
    data.subcategory_id ? Number(data.subcategory_id) : null,
    num(data.selling_price),
    num(data.market_price),
    num(data.purchase_price),
    num(data.tax),
    num(data.discount),
    String(data.hsn_code || ""),
    String(data.description || ""),
    num(data.reorder_level),
    num(data.stock),
    data.online === false ? 0 : 1,
    num(data.oversold_qty)
  ];
}

async function attachImages(rows) {
  if (!rows.length) return rows;
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => "?").join(",");
  const imgs = await query(
    `SELECT * FROM product_images WHERE product_id IN (${placeholders}) ORDER BY sort_order, id`,
    ids
  );
  const byProduct = new Map();
  for (const img of imgs) {
    if (!byProduct.has(img.product_id)) byProduct.set(img.product_id, []);
    byProduct.get(img.product_id).push({ id: img.id, url: resolveFileUrl(img.url), raw: img.url });
  }
  return rows.map((r) => ({
    ...r,
    online: !!r.online,
    images: byProduct.get(r.id) || []
  }));
}

async function products(params = {}) {
  const page = await productsPage({ ...params, limit: params.limit ?? 500, offset: params.offset ?? 0 });
  return page.rows;
}

async function productsPage(params = {}) {
  const q = String(params.q || "").trim();
  const categoryId = params.category_id ? Number(params.category_id) : null;
  const limit = Math.max(1, Math.min(500, Number(params.limit) || 50));
  const offset = Math.max(0, Number(params.offset) || 0);
  const where = [];
  const args = [];
  if (q) {
    where.push("(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ? OR p.hsn_code LIKE ?)");
    const like = `%${q}%`;
    args.push(like, like, like, like);
  }
  if (categoryId) {
    where.push("p.category_id = ?");
    args.push(categoryId);
  }
  if (params.price === "missing") where.push("COALESCE(p.selling_price,0) <= 0");
  if (params.price === "available") where.push("COALESCE(p.selling_price,0) > 0");
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM products p ${clause}`, args);
  const rows = await query(
    `SELECT p.*, c.name AS category, sc.name AS subcategory
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN subcategories sc ON sc.id = p.subcategory_id
     ${clause} ORDER BY p.name LIMIT ? OFFSET ?`,
    [...args, limit, offset]
  );
  return { rows: await attachImages(rows), total: Number(total) || 0 };
}

async function productOptions() {
  const rows = await query(
    `SELECT id, name, sku, barcode, unit, unit_id, category_id, subcategory_id,
            selling_price, market_price, purchase_price, tax, discount, hsn_code,
            stock, online
     FROM products ORDER BY name`
  );
  return rows.map((r) => ({ ...r, online: !!r.online }));
}

async function product(id) {
  const row = await queryOne(
    `SELECT p.*, c.name AS category, sc.name AS subcategory
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN subcategories sc ON sc.id = p.subcategory_id
     WHERE p.id = ?`,
    [id]
  );
  if (!row) return null;
  const [withImages] = await attachImages([row]);
  return withImages;
}

async function productByBarcode(code) {
  const value = String(code || "").trim();
  if (!value) return null;
  const row = await queryOne(
    "SELECT * FROM products WHERE barcode = ? OR sku = ? ORDER BY id LIMIT 1",
    [value, value]
  );
  if (!row) return null;
  const [withImages] = await attachImages([row]);
  return withImages;
}

async function createProduct(data = {}) {
  const name = String(data.name || "").trim();
  if (!name) throw new Error("Product name is required");
  const res = await run(
    `INSERT INTO products (${PRODUCT_COLS.join(", ")}, created_at, updated_at)
     VALUES (${PRODUCT_COLS.map(() => "?").join(", ")}, ?, ?)`,
    [...productValues(data), now(), now()]
  );
  const id = res.lastId;
  if (Array.isArray(data.images)) {
    for (let i = 0; i < data.images.length; i += 1) {
      const saved = await saveDataUrl(data.images[i]?.data_url || data.images[i]?.url || data.images[i], `images/products/${id}`);
      if (saved) await run("INSERT INTO product_images (product_id, url, sort_order) VALUES (?,?,?)", [id, saved, i]);
    }
  }
  return product(id);
}

async function updateProduct(id, data = {}) {
  const existing = await queryOne("SELECT * FROM products WHERE id = ?", [id]);
  if (!existing) throw new Error("Product not found");
  const merged = { ...existing, ...data };
  await run(
    `UPDATE products SET ${PRODUCT_COLS.map((c) => `${c} = ?`).join(", ")}, updated_at = ? WHERE id = ?`,
    [...productValues(merged), now(), id]
  );
  return product(id);
}

async function deleteProduct(id) {
  const imgs = await query("SELECT url FROM product_images WHERE product_id = ?", [id]);
  for (const img of imgs) await deleteFile(img.url);
  await run("DELETE FROM products WHERE id = ?", [id]);
  return { deleted: true };
}

async function updateProductPrices(id, data = {}) {
  await run("UPDATE products SET selling_price = ?, market_price = ?, updated_at = ? WHERE id = ?", [
    num(data.selling_price),
    num(data.market_price),
    now(),
    id
  ]);
  return { updated: true };
}

async function uploadProductImages(id, files = []) {
  const saved = [];
  const [count] = await query("SELECT COUNT(*) AS n FROM product_images WHERE product_id = ?", [id]);
  let order = Number(count?.n) || 0;
  for (const f of files) {
    const value = f?.data_url || f?.url || f;
    const path = await saveDataUrl(value, `images/products/${id}`);
    if (!path) continue;
    const res = await run("INSERT INTO product_images (product_id, url, sort_order) VALUES (?,?,?)", [
      id,
      path,
      order
    ]);
    saved.push({ id: res.lastId, url: resolveFileUrl(path) });
    order += 1;
  }
  return { images: saved };
}

async function deleteProductImages(id, ids = []) {
  if (!ids.length) return { deleted: 0 };
  const placeholders = ids.map(() => "?").join(",");
  const rows = await query(
    `SELECT * FROM product_images WHERE product_id = ? AND id IN (${placeholders})`,
    [id, ...ids]
  );
  for (const r of rows) await deleteFile(r.url);
  await run(`DELETE FROM product_images WHERE product_id = ? AND id IN (${placeholders})`, [id, ...ids]);
  return { deleted: rows.length };
}

async function orderProductImages(id, order = []) {
  for (let i = 0; i < order.length; i += 1) {
    await run("UPDATE product_images SET sort_order = ? WHERE id = ? AND product_id = ?", [i, order[i], id]);
  }
  return { updated: order.length };
}

// ─── Customers ────────────────────────────────────────────────
async function customers() {
  const rows = await query(
    `SELECT c.*,
       COALESCE((SELECT SUM(s.total - s.paid) FROM sales s WHERE s.customer_id = c.id), 0) AS balance,
       COALESCE((SELECT COUNT(*) FROM sales s WHERE s.customer_id = c.id), 0) AS total_bills
     FROM customers c ORDER BY c.name`
  );
  return rows.map((r) => ({ ...r, balance: round2(r.balance) }));
}

async function saveCustomer(id, data = {}) {
  const values = [
    String(data.name || "").trim(),
    String(data.phone || "").trim(),
    String(data.email || "").trim(),
    String(data.address || "").trim(),
    num(data.credit_limit),
    data.category_id ? Number(data.category_id) : null,
    String(data.notes || "")
  ];
  if (!values[0]) throw new Error("Customer name is required");
  if (id) {
    await run(
      "UPDATE customers SET name=?, phone=?, email=?, address=?, credit_limit=?, category_id=?, notes=? WHERE id=?",
      [...values, id]
    );
    return { id: Number(id) };
  }
  const res = await run(
    "INSERT INTO customers (name, phone, email, address, credit_limit, category_id, notes) VALUES (?,?,?,?,?,?,?)",
    values
  );
  return { id: res.lastId };
}

async function deleteCustomer(id) {
  await run("DELETE FROM customers WHERE id = ?", [id]);
  return { deleted: true };
}

async function findOrCreateCustomer(data = {}) {
  const phone = String(data.customer_phone || data.phone || "").trim();
  const name = String(data.customer_name || data.name || "").trim();
  if (!phone && !name) return null;
  if (phone) {
    const found = await queryOne("SELECT id FROM customers WHERE phone = ? ORDER BY id LIMIT 1", [phone]);
    if (found) return found.id;
  }
  const res = await run("INSERT INTO customers (name, phone) VALUES (?, ?)", [
    name || "Walk-in customer",
    phone || ""
  ]);
  return res.lastId;
}

async function customerPayments(params = {}) {
  const args = [];
  let where = "";
  if (params.customer_id) {
    where = "WHERE p.customer_id = ?";
    args.push(Number(params.customer_id));
  }
  const rows = await query(
    `SELECT p.*, c.name AS customer_name, s.invoice_no
     FROM customer_payments p
     LEFT JOIN customers c ON c.id = p.customer_id
     LEFT JOIN sales s ON s.id = p.sale_id
     ${where} ORDER BY p.created_at DESC LIMIT 500`,
    args
  );
  return rows;
}

async function createCustomerPayment(data = {}) {
  const customerId = Number(data.customer_id);
  const amount = round2(data.amount);
  if (!customerId || amount <= 0) throw new Error("Choose a customer and enter an amount");
  return transaction(async () => {
    const res = await run(
      `INSERT INTO customer_payments (customer_id, sale_id, amount, method, note, paid_on, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      [
        customerId,
        data.sale_id ? Number(data.sale_id) : null,
        amount,
        String(data.method || "cash"),
        String(data.note || ""),
        String(data.paid_on || today()),
        now()
      ]
    );
    if (data.sale_id) {
      const sale = await queryOne("SELECT * FROM sales WHERE id = ?", [data.sale_id]);
      if (sale) {
        const paid = round2(num(sale.paid) + amount);
        const status = paid >= num(sale.total) ? "paid" : paid > 0 ? "partial" : "unpaid";
        await run("UPDATE sales SET paid = ?, status = ?, updated_at = ? WHERE id = ?", [
          paid,
          status,
          now(),
          sale.id
        ]);
      }
    }
    return { id: res.lastId };
  });
}

async function deleteCustomerPayment(id) {
  const payment = await queryOne("SELECT * FROM customer_payments WHERE id = ?", [id]);
  if (!payment) return { deleted: false };
  await transaction(async () => {
    if (payment.sale_id) {
      const sale = await queryOne("SELECT * FROM sales WHERE id = ?", [payment.sale_id]);
      if (sale) {
        const paid = Math.max(0, round2(num(sale.paid) - num(payment.amount)));
        const status = paid >= num(sale.total) ? "paid" : paid > 0 ? "partial" : "unpaid";
        await run("UPDATE sales SET paid = ?, status = ?, updated_at = ? WHERE id = ?", [
          paid,
          status,
          now(),
          sale.id
        ]);
      }
    }
    await run("DELETE FROM customer_payments WHERE id = ?", [id]);
  });
  return { deleted: true };
}

async function customerBills(customerId) {
  const args = [];
  let where = "WHERE s.total > s.paid";
  if (customerId) {
    where += " AND s.customer_id = ?";
    args.push(Number(customerId));
  }
  const rows = await query(
    `SELECT s.*, c.name AS customer_record_name FROM sales s
     LEFT JOIN customers c ON c.id = s.customer_id
     ${where} ORDER BY s.created_at DESC LIMIT 500`,
    args
  );
  return rows.map((r) => ({ ...r, customer_name: r.customer_name || r.customer_record_name || "" }));
}

async function completedCustomerBills(customerId) {
  const args = [];
  let where = "WHERE s.total <= s.paid";
  if (customerId) {
    where += " AND s.customer_id = ?";
    args.push(Number(customerId));
  }
  const rows = await query(
    `SELECT s.*, c.name AS customer_record_name FROM sales s
     LEFT JOIN customers c ON c.id = s.customer_id
     ${where} ORDER BY s.created_at DESC LIMIT 500`,
    args
  );
  return rows.map((r) => ({ ...r, customer_name: r.customer_name || r.customer_record_name || "" }));
}

// ─── Sales ────────────────────────────────────────────────────
async function nextInvoiceNo() {
  // Each paired phone owns a short prefix (for example A1), so two phones can
  // bill while offline without ever handing out the same invoice number.
  const prefixRow = await queryOne(
    "SELECT value FROM app_meta WHERE key = 'device_invoice_prefix'"
  );
  const prefix =
    String(prefixRow?.value || "LOC")
      .replace(/[^A-Za-z0-9]/g, "")
      .toUpperCase()
      .slice(0, 4) || "LOC";
  const seqKey = `invoice_seq_${prefix}`;
  const row = await queryOne("SELECT value FROM app_meta WHERE key = ?", [seqKey]);
  let seq = Number(row?.value) || 0;
  let invoice;
  do {
    seq += 1;
    invoice = `INV-${prefix}-${String(seq).padStart(4, "0")}`;
  } while (await queryOne("SELECT 1 AS hit FROM sales WHERE invoice_no = ? LIMIT 1", [invoice]));
  await run(
    "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [seqKey, String(seq)]
  );
  await run(
    "INSERT INTO app_meta (key, value) VALUES ('invoice_seq', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [String(seq)]
  );
  return invoice;
}

function parseFilters(filters) {
  if (!filters) return {};
  if (typeof filters === "object") return filters;
  const out = {};
  for (const part of String(filters).split("&")) {
    if (!part) continue;
    const [k, v] = part.split("=");
    out[decodeURIComponent(k)] = decodeURIComponent(v || "");
  }
  return out;
}

async function sales(filters = {}) {
  const f = parseFilters(filters);
  const where = [];
  const args = [];
  if (f.status) {
    where.push("s.status = ?");
    args.push(f.status);
  }
  if (f.from) {
    where.push("date(s.created_at) >= date(?)");
    args.push(f.from);
  }
  if (f.to) {
    where.push("date(s.created_at) <= date(?)");
    args.push(f.to);
  }
  if (f.q) {
    where.push("(s.invoice_no LIKE ? OR s.customer_name LIKE ? OR s.customer_phone LIKE ? OR c.name LIKE ?)");
    const like = `%${f.q}%`;
    args.push(like, like, like, like);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = await query(
    `SELECT s.*, c.name AS customer_record_name
     FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
     ${clause} ORDER BY s.created_at DESC, s.id DESC LIMIT ?`,
    [...args, Math.min(1000, Number(f.limit) || 300)]
  );
  return rows.map((r) => ({
    ...r,
    customer_name: r.customer_name || r.customer_record_name || ""
  }));
}

async function sale(id) {
  const row = await queryOne(
    `SELECT s.*, c.name AS customer_record_name
     FROM sales s LEFT JOIN customers c ON c.id = s.customer_id WHERE s.id = ?`,
    [id]
  );
  if (!row) return null;
  const items = await query("SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id", [id]);
  const returns = await query("SELECT * FROM sale_returns WHERE sale_id = ? ORDER BY id", [id]);
  const returnedRows = await query(
    `SELECT i.sale_item_id, SUM(i.qty) AS qty
     FROM sale_return_items i JOIN sale_returns r ON r.id = i.return_id
     WHERE r.sale_id = ? GROUP BY i.sale_item_id`,
    [id]
  );
  const returnedMap = new Map(returnedRows.map((r) => [String(r.sale_item_id), num(r.qty)]));
  return {
    ...row,
    customer_name: row.customer_name || row.customer_record_name || "",
    items: items.map((it) => ({
      ...it,
      returned_qty: returnedMap.get(String(it.id)) || 0
    })),
    returns
  };
}

async function saleByInvoice(invoiceNo) {
  const row = await queryOne("SELECT id FROM sales WHERE UPPER(invoice_no) = UPPER(?)", [invoiceNo]);
  return row ? sale(row.id) : null;
}

async function createSale(data = {}) {
  const requested = Array.isArray(data.items) ? data.items : [];
  if (!requested.length) throw new Error("Add at least one item to the bill");
  return transaction(async () => {
    let customerId = data.customer_id ? Number(data.customer_id) : null;
    if (!customerId && (data.customer_name || data.customer_phone)) {
      customerId = await findOrCreateCustomer(data);
    }

    const items = [];
    let subtotal = 0;
    let taxTotal = 0;
    for (const raw of requested) {
      const productId = Number(raw.product_id);
      const qty = num(raw.qty);
      if (!productId || qty <= 0) throw new Error("Every bill line needs a product and quantity");
      const p = await queryOne("SELECT * FROM products WHERE id = ?", [productId]);
      if (!p) throw new Error("A product on this bill no longer exists");
      const unitPrice = raw.unit_price != null ? num(raw.unit_price) : num(p.selling_price);
      const lineTotal = round2(unitPrice * qty);
      const taxRate = raw.tax != null ? num(raw.tax) : num(p.tax);
      const taxAmt = round2((lineTotal * taxRate) / 100);
      subtotal = round2(subtotal + lineTotal);
      taxTotal = round2(taxTotal + taxAmt);
      items.push({
        product_id: productId,
        product_name: p.name,
        qty,
        unit_price: unitPrice,
        market_price: raw.market_price != null ? num(raw.market_price) : num(p.market_price),
        unit_id: p.unit_id || null,
        unit_name: raw.unit_name || p.unit || "",
        conversion_factor: num(raw.conversion_factor) || 1,
        purchase_price: num(p.purchase_price),
        profit: round2((unitPrice - num(p.purchase_price)) * qty),
        hsn_code: p.hsn_code || "",
        tax: taxRate,
        tax_amt: taxAmt,
        line_total: lineTotal
      });
    }

    const discount = num(data.discount);
    const total =
      data.total != null ? round2(data.total) : round2(Math.max(0, subtotal + taxTotal - discount));
    const paid = data.paid != null ? round2(data.paid) : total;
    const status =
      data.status ||
      (paid >= total ? "paid" : paid > 0 ? "partial" : data.payment_method === "credit" ? "unpaid" : "unpaid");
    const invoiceNo = String(data.invoice_no || "").trim() || (await nextInvoiceNo());

    const res = await run(
      `INSERT INTO sales
        (invoice_no, customer_id, customer_name, customer_phone, subtotal, discount, tax, total, paid,
         status, payment_method, note, channel, online_customer_name, online_customer_phone,
         online_delivery_type, online_address, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        invoiceNo,
        customerId,
        String(data.customer_name || ""),
        String(data.customer_phone || ""),
        subtotal,
        discount,
        taxTotal,
        total,
        paid,
        status,
        String(data.payment_method || "cash"),
        String(data.note || ""),
        String(data.channel || "counter"),
        String(data.online_customer_name || ""),
        String(data.online_customer_phone || ""),
        String(data.online_delivery_type || ""),
        String(data.online_address || ""),
        now(),
        now()
      ]
    );
    const saleId = res.lastId;

    for (const it of items) {
      await run(
        `INSERT INTO sale_items
          (sale_id, product_id, product_name, qty, unit_price, market_price, unit_id, unit_name,
           conversion_factor, purchase_price, profit, hsn_code, tax, tax_amt, line_total)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          saleId,
          it.product_id,
          it.product_name,
          it.qty,
          it.unit_price,
          it.market_price,
          it.unit_id,
          it.unit_name,
          it.conversion_factor,
          it.purchase_price,
          it.profit,
          it.hsn_code,
          it.tax,
          it.tax_amt,
          it.line_total
        ]
      );
      await run("UPDATE products SET stock = stock - ?, updated_at = ? WHERE id = ?", [
        it.qty,
        now(),
        it.product_id
      ]);
    }

    await run("INSERT INTO audit_log (action, entity, entity_id, detail) VALUES ('sale.create','sale',?,?)", [
      saleId,
      `${invoiceNo} total ${total}`
    ]);
    return sale(saleId);
  });
}

async function updateSale(id, data = {}) {
  const existing = await queryOne("SELECT * FROM sales WHERE id = ?", [id]);
  if (!existing) throw new Error("Bill not found");
  const paid = data.paid != null ? round2(data.paid) : num(existing.paid);
  const total = data.total != null ? round2(data.total) : num(existing.total);
  const status =
    data.status || (paid >= total ? "paid" : paid > 0 ? "partial" : existing.status || "unpaid");
  await run(
    `UPDATE sales SET customer_id = ?, customer_name = ?, customer_phone = ?, discount = ?,
       total = ?, paid = ?, status = ?, payment_method = ?, note = ?, updated_at = ? WHERE id = ?`,
    [
      data.customer_id != null ? Number(data.customer_id) : existing.customer_id,
      data.customer_name != null ? String(data.customer_name) : existing.customer_name,
      data.customer_phone != null ? String(data.customer_phone) : existing.customer_phone,
      data.discount != null ? num(data.discount) : existing.discount,
      total,
      paid,
      status,
      data.payment_method != null ? String(data.payment_method) : existing.payment_method,
      data.note != null ? String(data.note) : existing.note,
      now(),
      id
    ]
  );
  return sale(id);
}

async function updateSaleStatus(id, data = {}) {
  return updateSale(id, { status: data.status, paid: data.paid });
}

async function deleteSale(id) {
  return transaction(async () => {
    const items = await query("SELECT * FROM sale_items WHERE sale_id = ?", [id]);
    for (const it of items) {
      if (it.product_id) {
        await run("UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ?", [
          it.qty,
          now(),
          it.product_id
        ]);
      }
    }
    await run("DELETE FROM sales WHERE id = ?", [id]);
    await run("INSERT INTO audit_log (action, entity, entity_id) VALUES ('sale.delete','sale',?)", [id]);
    return { deleted: true };
  });
}

async function returns(params = {}) {
  const args = [];
  let where = "";
  if (params.sale_id) {
    where = "WHERE r.sale_id = ?";
    args.push(Number(params.sale_id));
  }
  return query(
    `SELECT r.*, s.invoice_no, s.customer_name,
       (SELECT COUNT(*) FROM sale_return_items i WHERE i.return_id = r.id) AS item_count,
       (SELECT GROUP_CONCAT(COALESCE(si.product_name, 'Item'), ', ')
          FROM sale_return_items i LEFT JOIN sale_items si ON si.id = i.sale_item_id
          WHERE i.return_id = r.id) AS product_names
     FROM sale_returns r
     LEFT JOIN sales s ON s.id = r.sale_id ${where} ORDER BY r.created_at DESC LIMIT 300`,
    args
  );
}

async function createReturn(saleId, data = {}) {
  const lines = Array.isArray(data.items) ? data.items : [];
  if (!lines.length) throw new Error("Choose at least one item to return");
  return transaction(async () => {
    const existingSale = await queryOne("SELECT * FROM sales WHERE id = ?", [saleId]);
    if (!existingSale) throw new Error("Bill not found");
    let amount = 0;
    let profit = 0;
    const prepared = [];
    for (const line of lines) {
      const saleItem = await queryOne("SELECT * FROM sale_items WHERE id = ? AND sale_id = ?", [
        line.sale_item_id || line.id,
        saleId
      ]);
      if (!saleItem) continue;
      const previous = await queryOne(
        "SELECT COALESCE(SUM(qty), 0) AS returned FROM sale_return_items WHERE sale_item_id = ?",
        [saleItem.id]
      );
      const remaining = round2(num(saleItem.qty) - num(previous?.returned));
      const qty = Math.min(num(line.qty), remaining);
      if (qty <= 0) continue;
      const lineTotal = round2(num(saleItem.unit_price) * qty);
      const unitProfit = round2(num(saleItem.profit) / Math.max(num(saleItem.qty), 0.000001));
      amount = round2(amount + lineTotal);
      profit = round2(profit + unitProfit * qty);
      prepared.push({ saleItem, qty, lineTotal });
    }
    if (!prepared.length) throw new Error("No valid return lines");
    const res = await run(
      "INSERT INTO sale_returns (sale_id, amount, profit, reason, created_at) VALUES (?,?,?,?,?)",
      [saleId, amount, profit, String(data.reason || ""), now()]
    );
    for (const p of prepared) {
      await run(
        "INSERT INTO sale_return_items (return_id, sale_item_id, product_id, qty, unit_price, line_total) VALUES (?,?,?,?,?,?)",
        [res.lastId, p.saleItem.id, p.saleItem.product_id, p.qty, p.saleItem.unit_price, p.lineTotal]
      );
      if (p.saleItem.product_id) {
        await run("UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ?", [
          p.qty,
          now(),
          p.saleItem.product_id
        ]);
      }
    }
    await run("UPDATE sales SET total = MAX(0, total - ?), updated_at = ? WHERE id = ?", [amount, now(), saleId]);
    return {
      id: res.lastId,
      amount,
      total_refund: amount,
      profit,
      profit_reversed: profit,
      items_returned: prepared.length
    };
  });
}

// ─── Stock removals ───────────────────────────────────────────
async function stockRemovals(params = {}) {
  const args = [];
  let where = "";
  if (params.from) {
    where = "WHERE date(created_at) >= date(?)";
    args.push(params.from);
  }
  return query(`SELECT * FROM stock_removals ${where} ORDER BY created_at DESC LIMIT 300`, args);
}

async function createStockRemoval(data = {}) {
  const productId = Number(data.product_id);
  const qty = num(data.qty);
  if (!productId || qty <= 0) throw new Error("Choose a product and a quantity");
  return transaction(async () => {
    const p = await queryOne("SELECT * FROM products WHERE id = ?", [productId]);
    if (!p) throw new Error("Product not found");
    const unitCost = data.unit_cost != null ? num(data.unit_cost) : num(p.purchase_price);
    const res = await run(
      `INSERT INTO stock_removals (product_id, product_name, qty, unit_cost, value, reason, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      [productId, p.name, qty, unitCost, round2(unitCost * qty), String(data.reason || ""), now()]
    );
    await run("UPDATE products SET stock = stock - ?, updated_at = ? WHERE id = ?", [qty, now(), productId]);
    return { id: res.lastId };
  });
}

async function deleteStockRemoval(id) {
  const row = await queryOne("SELECT * FROM stock_removals WHERE id = ?", [id]);
  if (!row) return { deleted: false };
  return transaction(async () => {
    if (row.product_id) {
      await run("UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ?", [
        num(row.qty),
        now(),
        row.product_id
      ]);
    }
    await run("DELETE FROM stock_removals WHERE id = ?", [id]);
    return { deleted: true };
  });
}

// ─── Expenses ─────────────────────────────────────────────────
async function expenses() {
  return query(
    `SELECT e.*, COALESCE(ec.name, e.category) AS category_name
     FROM expenses e LEFT JOIN expense_categories ec ON ec.id = e.category_id
     ORDER BY e.date DESC, e.id DESC LIMIT 500`
  );
}

async function createExpense(data = {}) {
  const amount = num(data.amount);
  if (amount <= 0) throw new Error("Enter an amount");
  let categoryId = data.category_id ? Number(data.category_id) : null;
  let category = String(data.category || "");
  if (categoryId && !category) {
    const cat = await queryOne("SELECT name FROM expense_categories WHERE id = ?", [categoryId]);
    category = cat?.name || "";
  }
  const res = await run(
    `INSERT INTO expenses (category_id, category, amount, method, note, date, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    [
      categoryId,
      category,
      amount,
      String(data.method || "cash"),
      String(data.note || ""),
      String(data.date || today()),
      now()
    ]
  );
  return { id: res.lastId };
}

async function deleteExpense(id) {
  await run("DELETE FROM expenses WHERE id = ?", [id]);
  return { deleted: true };
}

async function expenseCategories() {
  return query("SELECT * FROM expense_categories ORDER BY name");
}

async function saveExpenseCategory(id, data = {}) {
  const name = String(data.name || "").trim();
  if (!name) throw new Error("Category name is required");
  if (id) {
    await run("UPDATE expense_categories SET name = ? WHERE id = ?", [name, id]);
    return { id: Number(id) };
  }
  const res = await run("INSERT INTO expense_categories (name) VALUES (?)", [name]);
  return { id: res.lastId };
}

async function deleteExpenseCategory(id) {
  await run("DELETE FROM expense_categories WHERE id = ?", [id]);
  return { deleted: true };
}

// ─── Non-sale inventory ───────────────────────────────────────
async function nonSaleInventory() {
  return query("SELECT * FROM non_sale_inventory ORDER BY name");
}

async function createNonSaleItem(data = {}) {
  const name = String(data.name || "").trim();
  if (!name) throw new Error("Item name is required");
  const qty = num(data.qty);
  const res = await run(
    `INSERT INTO non_sale_inventory (name, size, unit, qty, remaining, amount, purchase_date, notes, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      name,
      String(data.size || ""),
      String(data.unit || "pcs"),
      qty,
      data.remaining != null ? num(data.remaining) : qty,
      num(data.amount),
      String(data.purchase_date || today()),
      String(data.notes || ""),
      now()
    ]
  );
  if (data.create_expense && num(data.amount) > 0) {
    await createExpense({
      amount: num(data.amount),
      category: "Non-sale inventory",
      note: `Purchase: ${name}`,
      date: data.purchase_date || today()
    });
  }
  return { id: res.lastId };
}

async function updateNonSaleItem(id, data = {}) {
  const existing = await queryOne("SELECT * FROM non_sale_inventory WHERE id = ?", [id]);
  if (!existing) throw new Error("Item not found");
  await run(
    `UPDATE non_sale_inventory SET name=?, size=?, unit=?, qty=?, remaining=?, amount=?, purchase_date=?, notes=? WHERE id=?`,
    [
      data.name != null ? String(data.name) : existing.name,
      data.size != null ? String(data.size) : existing.size,
      data.unit != null ? String(data.unit) : existing.unit,
      data.qty != null ? num(data.qty) : existing.qty,
      data.remaining != null ? num(data.remaining) : existing.remaining,
      data.amount != null ? num(data.amount) : existing.amount,
      data.purchase_date != null ? String(data.purchase_date) : existing.purchase_date,
      data.notes != null ? String(data.notes) : existing.notes,
      id
    ]
  );
  return { updated: true };
}

async function useNonSaleItem(id, data = {}) {
  const qty = num(data.qty);
  if (qty <= 0) throw new Error("Enter a quantity");
  const existing = await queryOne("SELECT * FROM non_sale_inventory WHERE id = ?", [id]);
  if (!existing) throw new Error("Item not found");
  await run("UPDATE non_sale_inventory SET remaining = MAX(0, remaining - ?) WHERE id = ?", [qty, id]);
  return { updated: true };
}

async function deleteNonSaleItem(id) {
  await run("DELETE FROM non_sale_inventory WHERE id = ?", [id]);
  return { deleted: true };
}

// ─── Suppliers & purchases ────────────────────────────────────
async function suppliers() {
  return query("SELECT * FROM suppliers ORDER BY name");
}

async function saveSupplier(id, data = {}) {
  const values = [
    String(data.name || "").trim(),
    String(data.company || ""),
    String(data.phone || ""),
    String(data.email || ""),
    String(data.address || ""),
    String(data.notes || "")
  ];
  if (!values[0]) throw new Error("Supplier name is required");
  if (id) {
    await run(
      "UPDATE suppliers SET name=?, company=?, phone=?, email=?, address=?, notes=? WHERE id=?",
      [...values, id]
    );
    return { id: Number(id) };
  }
  const res = await run(
    "INSERT INTO suppliers (name, company, phone, email, address, notes) VALUES (?,?,?,?,?,?)",
    values
  );
  return { id: res.lastId };
}

async function deleteSupplier(id) {
  await run("DELETE FROM suppliers WHERE id = ?", [id]);
  return { deleted: true };
}

async function supplierPurchases() {
  return query(
    `SELECT p.*, s.name AS supplier_name FROM supplier_purchases p
     LEFT JOIN suppliers s ON s.id = p.supplier_id ORDER BY p.purchased_at DESC, p.id DESC LIMIT 300`
  );
}

async function supplierPurchase(id) {
  const row = await queryOne(
    `SELECT p.*, s.name AS supplier_name FROM supplier_purchases p
     LEFT JOIN suppliers s ON s.id = p.supplier_id WHERE p.id = ?`,
    [id]
  );
  if (!row) return null;
  const items = await query("SELECT * FROM supplier_purchase_items WHERE purchase_id = ? ORDER BY id", [id]);
  return { ...row, items };
}

async function createSupplierPurchase(data = {}) {
  const lines = Array.isArray(data.items) ? data.items : [];
  if (!lines.length) throw new Error("Add at least one purchase line");
  return transaction(async () => {
    let subtotal = 0;
    const prepared = [];
    for (const line of lines) {
      const productId = line.product_id ? Number(line.product_id) : null;
      const qty = num(line.qty);
      if (qty <= 0) continue;
      const price = num(line.purchase_price);
      const lineTotal = round2(price * qty);
      subtotal = round2(subtotal + lineTotal);
      prepared.push({ ...line, product_id: productId, qty, purchase_price: price, line_total: lineTotal });
    }
    const discount = num(data.discount);
    const tax = num(data.tax);
    const additional = num(data.additional_charges);
    const total = round2(subtotal - discount + tax + additional);
    const paid = data.paid != null ? num(data.paid) : total;
    const res = await run(
      `INSERT INTO supplier_purchases
        (supplier_id, invoice_no, purchased_at, subtotal, discount, tax, additional_charges, total, paid,
         payment_method, bill_image, notes, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        data.supplier_id ? Number(data.supplier_id) : null,
        String(data.invoice_no || ""),
        String(data.purchased_at || now()),
        subtotal,
        discount,
        tax,
        additional,
        total,
        paid,
        String(data.payment_method || "cash"),
        String(data.bill_image || ""),
        String(data.notes || ""),
        now()
      ]
    );
    const purchaseId = res.lastId;
    for (const line of prepared) {
      await run(
        `INSERT INTO supplier_purchase_items
          (purchase_id, product_id, item_name, hsn_code, qty, unit, purchase_price, discount, tax, line_total, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [
          purchaseId,
          line.product_id,
          String(line.item_name || ""),
          String(line.hsn_code || ""),
          line.qty,
          String(line.unit || "pcs"),
          line.purchase_price,
          num(line.discount),
          num(line.tax),
          line.line_total,
          now()
        ]
      );
      if (line.product_id) {
        await run(
          "UPDATE products SET stock = stock + ?, purchase_price = ?, updated_at = ? WHERE id = ?",
          [line.qty, line.purchase_price, now(), line.product_id]
        );
        await run(
          `INSERT INTO product_packs (product_id, purchase_id, qty, remaining, unit_cost, status, created_at)
           VALUES (?,?,?,?,?,'open',?)`,
          [line.product_id, purchaseId, line.qty, line.qty, line.purchase_price, now()]
        );
      }
    }
    return supplierPurchase(purchaseId);
  });
}

async function updateSupplierPurchase(id, data = {}) {
  const existing = await queryOne("SELECT * FROM supplier_purchases WHERE id = ?", [id]);
  if (!existing) throw new Error("Purchase not found");
  await run(
    "UPDATE supplier_purchases SET paid=?, payment_method=?, notes=?, bill_image=? WHERE id=?",
    [
      data.paid != null ? num(data.paid) : existing.paid,
      data.payment_method != null ? String(data.payment_method) : existing.payment_method,
      data.notes != null ? String(data.notes) : existing.notes,
      data.bill_image != null ? String(data.bill_image) : existing.bill_image,
      id
    ]
  );
  return supplierPurchase(id);
}

async function updateSupplierPayment(id, data = {}) {
  const existing = await queryOne("SELECT * FROM supplier_purchases WHERE id = ?", [id]);
  if (!existing) throw new Error("Purchase not found");
  const paid = data.paid != null ? num(data.paid) : num(existing.paid) + num(data.amount);
  await run("UPDATE supplier_purchases SET paid = ? WHERE id = ?", [paid, id]);
  return { updated: true };
}

async function deleteSupplierPurchase(id) {
  return transaction(async () => {
    const items = await query("SELECT * FROM supplier_purchase_items WHERE purchase_id = ?", [id]);
    for (const line of items) {
      if (line.product_id) {
        await run("UPDATE products SET stock = MAX(0, stock - ?), updated_at = ? WHERE id = ?", [
          num(line.qty),
          now(),
          line.product_id
        ]);
      }
    }
    await run("DELETE FROM supplier_purchases WHERE id = ?", [id]);
    return { deleted: true };
  });
}

// ─── Product packs ────────────────────────────────────────────
async function productPacks(productId) {
  const args = [];
  let where = "";
  if (productId) {
    where = "WHERE pp.product_id = ?";
    args.push(Number(productId));
  }
  const packs = await query(
    `SELECT pp.*, p.name AS product_name FROM product_packs pp
     JOIN products p ON p.id = pp.product_id ${where}
     ORDER BY pp.created_at DESC LIMIT 500`,
    args
  );
  const stats = await queryOne(
    `SELECT COUNT(*) AS total_packs, COALESCE(SUM(remaining),0) AS total_stock_qty,
       COUNT(*) FILTER (WHERE status = 'open') AS open_packs
     FROM product_packs ${productId ? "WHERE product_id = ?" : ""}`,
    productId ? [Number(productId)] : []
  );
  return { packs, stats };
}

async function productPack(id) {
  return queryOne(
    `SELECT pp.*, p.name AS product_name FROM product_packs pp
     JOIN products p ON p.id = pp.product_id WHERE pp.id = ?`,
    [id]
  );
}

async function updateProductPack(id, data = {}) {
  const existing = await queryOne("SELECT * FROM product_packs WHERE id = ?", [id]);
  if (!existing) throw new Error("Pack not found");
  const remaining = data.remaining != null ? num(data.remaining) : num(existing.remaining);
  const status = data.status || (remaining <= 0 ? "empty" : existing.status);
  await run("UPDATE product_packs SET remaining = ?, status = ? WHERE id = ?", [remaining, status, id]);
  return { updated: true };
}

// ─── Dashboard / stats ────────────────────────────────────────
async function dashboard() {
  const day = today();
  const month = day.slice(0, 7);
  const [todayRow] = await query(
    "SELECT COALESCE(SUM(total),0) AS total, COALESCE(SUM(paid),0) AS paid, COUNT(*) AS bills FROM sales WHERE date(created_at) = date(?)",
    [day]
  );
  const [monthRow] = await query(
    "SELECT COALESCE(SUM(total),0) AS total FROM sales WHERE strftime('%Y-%m', created_at) = ?",
    [month]
  );
  const [profitRow] = await query(
    `SELECT COALESCE(SUM(si.profit),0) AS profit FROM sale_items si
     JOIN sales s ON s.id = si.sale_id WHERE strftime('%Y-%m', s.created_at) = ?`,
    [month]
  );
  const [outstandingRow] = await query(
    "SELECT COALESCE(SUM(total - paid),0) AS total FROM sales WHERE total > paid"
  );
  const [expenseRow] = await query(
    "SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE strftime('%Y-%m', date) = ?",
    [month]
  );
  const [stockRow] = await query(
    "SELECT COUNT(*) AS low FROM products WHERE reorder_level > 0 AND stock <= reorder_level"
  );
  const [productRow] = await query("SELECT COUNT(*) AS total FROM products");
  const [customerRow] = await query("SELECT COUNT(*) AS total FROM customers");
  const recent = await query(
    `SELECT s.*, c.name AS customer_record_name FROM sales s
     LEFT JOIN customers c ON c.id = s.customer_id
     ORDER BY s.created_at DESC, s.id DESC LIMIT 6`
  );
  for (const r of recent) r.customer_name = r.customer_name || r.customer_record_name || "";
  const trend = await query(
    `SELECT date(created_at) AS day, COALESCE(SUM(total),0) AS total, COUNT(*) AS bills
     FROM sales WHERE date(created_at) >= date(?, '-6 day') GROUP BY date(created_at) ORDER BY day`,
    [day]
  );
  const top = await query(
    `SELECT si.product_name, SUM(si.qty) AS qty, SUM(si.line_total) AS total
     FROM sale_items si JOIN sales s ON s.id = si.sale_id
     WHERE strftime('%Y-%m', s.created_at) = ?
     GROUP BY si.product_id, si.product_name ORDER BY qty DESC LIMIT 5`,
    [month]
  );
  return {
    today: {
      total: round2(todayRow?.total),
      paid: round2(todayRow?.paid),
      bills: Number(todayRow?.bills) || 0
    },
    month: { total: round2(monthRow?.total), profit: round2(profitRow?.profit) },
    outstanding: round2(outstandingRow?.total),
    monthExpenses: round2(expenseRow?.total),
    lowStock: Number(stockRow?.low) || 0,
    productCount: Number(productRow?.total) || 0,
    customerCount: Number(customerRow?.total) || 0,
    recent,
    trend,
    top
  };
}

async function stats(from, to) {
  const [row] = await query(
    `SELECT COALESCE(SUM(total),0) AS sales, COUNT(*) AS bills
     FROM sales WHERE date(created_at) >= date(?) AND date(created_at) <= date(?)`,
    [from, to]
  );
  const [profitRow] = await query(
    `SELECT COALESCE(SUM(si.profit),0) AS profit FROM sale_items si
     JOIN sales s ON s.id = si.sale_id
     WHERE date(s.created_at) >= date(?) AND date(s.created_at) <= date(?)`,
    [from, to]
  );
  const [expense] = await query(
    "SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE date(date) >= date(?) AND date(date) <= date(?)",
    [from, to]
  );
  const [returnsRow] = await query(
    "SELECT COALESCE(SUM(amount),0) AS total FROM sale_returns WHERE date(created_at) >= date(?) AND date(created_at) <= date(?)",
    [from, to]
  );
  return {
    sales: round2(row?.sales),
    profit: round2(profitRow?.profit),
    bills: Number(row?.bills) || 0,
    expenses: round2(expense?.total),
    returns: round2(returnsRow?.total)
  };
}

// ─── Security (app-level PIN handles this; keep API surface compatible) ──
async function securityStatus() {
  return { enabled: false, hasPassword: false };
}
async function verifyActionPassword() {
  return { required: false, valid: true };
}
async function setActionPassword() {
  return { enabled: false, hasPassword: false };
}
async function toggleSecurity(data = {}) {
  return { enabled: !!data.enabled, hasPassword: false };
}

// ─── Business documents (Phase 2, basic CRUD kept for the menu) ──
async function businessDocuments() {
  return query("SELECT * FROM business_documents ORDER BY created_at DESC");
}
async function createBusinessDocument(data = {}) {
  const name = String(data.name || "").trim();
  if (!name) throw new Error("Document name is required");
  const file = data.file;
  let filePath = String(data.file_path || "");
  let fileType = String(data.file_type || "");
  if (file && isDataUrl(file)) {
    filePath = await saveDataUrl(file, "docs/business");
    fileType = String(file).slice(5, String(file).indexOf(";"));
  }
  const res = await run(
    `INSERT INTO business_documents (name, category, file_path, file_type, file_size, notes, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    [
      name,
      String(data.category || "Other"),
      filePath,
      fileType,
      num(data.file_size),
      String(data.notes || ""),
      now()
    ]
  );
  return { id: res.lastId };
}

async function updateBusinessDocument(id, data = {}) {
  const existing = await queryOne("SELECT * FROM business_documents WHERE id = ?", [id]);
  if (!existing) throw new Error("Document not found");
  const file = data.file;
  let filePath = existing.file_path;
  let fileType = existing.file_type;
  if (file && isDataUrl(file)) {
    if (existing.file_path) await deleteFile(existing.file_path);
    filePath = await saveDataUrl(file, "docs/business");
    fileType = String(file).slice(5, String(file).indexOf(";"));
  } else if (data.file_path != null) {
    filePath = String(data.file_path);
  }
  await run(
    `UPDATE business_documents SET name=?, category=?, file_path=?, file_type=?, file_size=?, notes=? WHERE id=?`,
    [
      data.name != null ? String(data.name) : existing.name,
      data.category != null ? String(data.category) : existing.category,
      filePath,
      fileType,
      data.file_size != null ? num(data.file_size) : num(existing.file_size),
      data.notes != null ? String(data.notes) : existing.notes,
      id
    ]
  );
  return { updated: true };
}

async function saveBusinessDocumentCategory(id, data = {}) {
  const name = String(data.name || "").trim();
  if (!name) throw new Error("Category name is required");
  if (id) {
    await run("UPDATE business_document_categories SET name = ? WHERE id = ?", [name, id]);
    return { id: Number(id) };
  }
  const res = await run("INSERT INTO business_document_categories (name) VALUES (?)", [name]);
  return { id: res.lastId };
}

async function deleteBusinessDocumentCategory(id) {
  await run("DELETE FROM business_document_categories WHERE id = ?", [id]);
  return { deleted: true };
}
async function deleteBusinessDocument(id) {
  const row = await queryOne("SELECT file_path FROM business_documents WHERE id = ?", [id]);
  if (row?.file_path) await deleteFile(row.file_path);
  await run("DELETE FROM business_documents WHERE id = ?", [id]);
  return { deleted: true };
}
async function businessDocumentCategories() {
  return query("SELECT * FROM business_document_categories ORDER BY name");
}
async function customerCategories() {
  return query("SELECT * FROM customer_categories ORDER BY name");
}
async function saveCustomerCategory(id, data = {}) {
  const name = String(data.name || "").trim();
  if (!name) throw new Error("Category name is required");
  if (id) {
    await run("UPDATE customer_categories SET name = ? WHERE id = ?", [name, id]);
    return { id: Number(id) };
  }
  const res = await run("INSERT INTO customer_categories (name) VALUES (?)", [name]);
  return { id: res.lastId };
}
async function deleteCustomerCategory(id) {
  await run("DELETE FROM customer_categories WHERE id = ?", [id]);
  return { deleted: true };
}

// ─── Assets ───────────────────────────────────────────────────
async function assetCategories() {
  return query("SELECT * FROM asset_categories ORDER BY name");
}

async function saveAssetCategory(id, data = {}) {
  const name = String(data.name || "").trim();
  if (!name) throw new Error("Asset category name is required");
  if (id) {
    await run("UPDATE asset_categories SET name = ? WHERE id = ?", [name, id]);
    return { id: Number(id) };
  }
  const res = await run("INSERT INTO asset_categories (name) VALUES (?)", [name]);
  return { id: res.lastId };
}

async function deleteAssetCategory(id) {
  await run("DELETE FROM asset_categories WHERE id = ?", [id]);
  return { deleted: true };
}

async function assets() {
  return query("SELECT * FROM assets ORDER BY purchase_date DESC, id DESC");
}

async function createAsset(data = {}) {
  const name = String(data.name || "").trim();
  if (!name) throw new Error("Asset name is required");
  const cost = num(data.cost ?? data.purchase_cost);
  const res = await run(
    `INSERT INTO assets (name, category, purchase_date, cost, current_value, condition, location, notes, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      name,
      String(data.category || "Equipment"),
      String(data.purchase_date || today()),
      cost,
      data.current_value != null ? num(data.current_value) : cost,
      String(data.condition || "good"),
      String(data.location || ""),
      String(data.notes ?? data.note ?? ""),
      now()
    ]
  );
  return { id: res.lastId };
}

async function updateAsset(id, data = {}) {
  const existing = await queryOne("SELECT * FROM assets WHERE id = ?", [id]);
  if (!existing) throw new Error("Asset not found");
  const cost = data.cost != null ? num(data.cost) : num(existing.cost);
  await run(
    `UPDATE assets SET name=?, category=?, purchase_date=?, cost=?, current_value=?, condition=?, location=?, notes=? WHERE id=?`,
    [
      data.name != null ? String(data.name) : existing.name,
      data.category != null ? String(data.category) : existing.category,
      data.purchase_date != null ? String(data.purchase_date) : existing.purchase_date,
      cost,
      data.current_value != null ? num(data.current_value) : num(existing.current_value),
      data.condition != null ? String(data.condition) : existing.condition,
      data.location != null ? String(data.location) : existing.location,
      data.notes != null ? String(data.notes) : existing.notes,
      id
    ]
  );
  return { updated: true };
}

async function deleteAsset(id) {
  await run("DELETE FROM assets WHERE id = ?", [id]);
  return { deleted: true };
}

// ─── Cheques ──────────────────────────────────────────────────
const CHEQUE_STATUSES = ["pending", "cleared", "bounced"];

async function cheques(params = {}) {
  const args = [];
  const where = [];
  if (CHEQUE_STATUSES.includes(params.status)) {
    where.push("c.status = ?");
    args.push(params.status);
  }
  if (params.supplier_id) {
    where.push("c.supplier_id = ?");
    args.push(Number(params.supplier_id));
  }
  if (params.customer_id) {
    where.push("c.customer_id = ?");
    args.push(Number(params.customer_id));
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return query(
    `SELECT c.*, s.name AS supplier_name, cu.name AS customer_name
     FROM cheques c
     LEFT JOIN suppliers s ON s.id = c.supplier_id
     LEFT JOIN customers cu ON cu.id = c.customer_id
     ${clause} ORDER BY c.cheque_date DESC, c.id DESC LIMIT 500`,
    args
  );
}

async function createCheque(data = {}) {
  const chequeNo = String(data.cheque_no || "").trim();
  if (!chequeNo) throw new Error("Cheque number is required");
  if (!(num(data.amount) > 0)) throw new Error("Amount must be greater than zero");
  const status = CHEQUE_STATUSES.includes(data.status) ? data.status : "pending";
  const res = await run(
    `INSERT INTO cheques (cheque_no, bank_name, drawer_name, payee, amount, cheque_date, clearing_date,
       status, supplier_id, customer_id, notes, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      chequeNo,
      String(data.bank_name || ""),
      String(data.drawer_name || ""),
      String(data.payee || ""),
      num(data.amount),
      String(data.cheque_date || today()),
      String(data.clearing_date || ""),
      status,
      data.supplier_id ? Number(data.supplier_id) : null,
      data.customer_id ? Number(data.customer_id) : null,
      String(data.notes || ""),
      now()
    ]
  );
  return { id: res.lastId };
}

async function updateCheque(id, data = {}) {
  const existing = await queryOne("SELECT * FROM cheques WHERE id = ?", [id]);
  if (!existing) throw new Error("Cheque not found");
  const status = CHEQUE_STATUSES.includes(data.status) ? data.status : existing.status;
  await run(
    `UPDATE cheques SET cheque_no=?, bank_name=?, drawer_name=?, payee=?, amount=?, cheque_date=?,
       clearing_date=?, status=?, supplier_id=?, customer_id=?, notes=? WHERE id=?`,
    [
      data.cheque_no != null ? String(data.cheque_no) : existing.cheque_no,
      data.bank_name != null ? String(data.bank_name) : existing.bank_name,
      data.drawer_name != null ? String(data.drawer_name) : existing.drawer_name,
      data.payee != null ? String(data.payee) : existing.payee,
      data.amount != null ? num(data.amount) : num(existing.amount),
      data.cheque_date != null ? String(data.cheque_date) : existing.cheque_date,
      data.clearing_date != null ? String(data.clearing_date) : existing.clearing_date,
      status,
      data.supplier_id !== undefined ? (data.supplier_id ? Number(data.supplier_id) : null) : existing.supplier_id,
      data.customer_id !== undefined ? (data.customer_id ? Number(data.customer_id) : null) : existing.customer_id,
      data.notes != null ? String(data.notes) : existing.notes,
      id
    ]
  );
  return { updated: true };
}

async function updateChequeStatus(id, data = {}) {
  const status = CHEQUE_STATUSES.includes(data.status) ? data.status : null;
  if (!status) throw new Error("Invalid cheque status");
  await run("UPDATE cheques SET status = ? WHERE id = ?", [status, id]);
  return { updated: true };
}

async function deleteCheque(id) {
  await run("DELETE FROM cheques WHERE id = ?", [id]);
  return { deleted: true };
}

// ─── Tasks ────────────────────────────────────────────────────
const TASK_PRIORITIES = ["low", "normal", "high", "urgent"];
const TASK_STATUSES = ["pending", "in_progress", "completed", "cancelled"];

async function tasks(params = {}) {
  const args = [];
  let where = "";
  if (TASK_STATUSES.includes(params.status)) {
    where = "WHERE status = ?";
    args.push(params.status);
  }
  return query(
    `SELECT * FROM tasks ${where}
     ORDER BY CASE WHEN status IN ('pending','in_progress') THEN 0 ELSE 1 END,
              due_date ASC, id DESC LIMIT 500`,
    args
  );
}

async function createTask(data = {}) {
  const title = String(data.title || "").trim();
  if (!title) throw new Error("Task title is required");
  const priority = TASK_PRIORITIES.includes(data.priority) ? data.priority : "normal";
  const status = TASK_STATUSES.includes(data.status) ? data.status : "pending";
  const res = await run(
    "INSERT INTO tasks (title, description, priority, due_date, status, completed_at, created_at) VALUES (?,?,?,?,?,?,?)",
    [
      title,
      String(data.description || ""),
      priority,
      String(data.due_date || ""),
      status,
      status === "completed" ? now() : "",
      now()
    ]
  );
  return { id: res.lastId };
}

async function updateTask(id, data = {}) {
  const existing = await queryOne("SELECT * FROM tasks WHERE id = ?", [id]);
  if (!existing) throw new Error("Task not found");
  const status = TASK_STATUSES.includes(data.status) ? data.status : existing.status;
  await run(
    "UPDATE tasks SET title=?, description=?, priority=?, due_date=?, status=?, completed_at=? WHERE id=?",
    [
      data.title != null ? String(data.title) : existing.title,
      data.description != null ? String(data.description) : existing.description,
      TASK_PRIORITIES.includes(data.priority) ? data.priority : existing.priority,
      data.due_date != null ? String(data.due_date) : existing.due_date,
      status,
      status === "completed" ? existing.completed_at || now() : "",
      id
    ]
  );
  return { updated: true };
}

async function updateTaskStatus(id, data = {}) {
  const status = TASK_STATUSES.includes(data.status) ? data.status : null;
  if (!status) throw new Error("Invalid task status");
  await run("UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?", [
    status,
    status === "completed" ? now() : "",
    id
  ]);
  return { updated: true };
}

async function deleteTask(id) {
  await run("DELETE FROM tasks WHERE id = ?", [id]);
  return { deleted: true };
}

// ─── Call notes ───────────────────────────────────────────────
const CALL_STATUSES = ["pending", "done", "cancelled"];

async function callNotes(params = {}) {
  const args = [];
  let where = "";
  if (CALL_STATUSES.includes(params.status)) {
    where = "WHERE status = ?";
    args.push(params.status);
  }
  return query(
    `SELECT * FROM call_notes ${where}
     ORDER BY CASE WHEN status = 'pending' THEN 0 ELSE 1 END, call_back_at ASC, id DESC LIMIT 500`,
    args
  );
}

async function createCallNote(data = {}) {
  const contact = String(data.contact_name || "").trim();
  if (!contact) throw new Error("Contact name is required");
  const res = await run(
    `INSERT INTO call_notes (contact_name, phone, note, call_back_at, priority, status, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    [
      contact,
      String(data.phone || ""),
      String(data.note || ""),
      String(data.call_back_at || ""),
      TASK_PRIORITIES.includes(data.priority) ? data.priority : "normal",
      CALL_STATUSES.includes(data.status) ? data.status : "pending",
      now()
    ]
  );
  return { id: res.lastId };
}

async function updateCallNote(id, data = {}) {
  const existing = await queryOne("SELECT * FROM call_notes WHERE id = ?", [id]);
  if (!existing) throw new Error("Call note not found");
  await run(
    "UPDATE call_notes SET contact_name=?, phone=?, note=?, call_back_at=?, priority=?, status=? WHERE id=?",
    [
      data.contact_name != null ? String(data.contact_name) : existing.contact_name,
      data.phone != null ? String(data.phone) : existing.phone,
      data.note != null ? String(data.note) : existing.note,
      data.call_back_at != null ? String(data.call_back_at) : existing.call_back_at,
      TASK_PRIORITIES.includes(data.priority) ? data.priority : existing.priority,
      CALL_STATUSES.includes(data.status) ? data.status : existing.status,
      id
    ]
  );
  return { updated: true };
}

async function updateCallNoteStatus(id, data = {}) {
  const status = CALL_STATUSES.includes(data.status) ? data.status : null;
  if (!status) throw new Error("Invalid call note status");
  await run("UPDATE call_notes SET status = ? WHERE id = ?", [status, id]);
  return { updated: true };
}

async function deleteCallNote(id) {
  await run("DELETE FROM call_notes WHERE id = ?", [id]);
  return { deleted: true };
}

// ─── Reminders ────────────────────────────────────────────────
function dayNumber(value) {
  if (!value) return null;
  const parts = String(value).slice(0, 10).split("-");
  if (parts.length < 3) return null;
  const [y, m, d] = parts.map(Number);
  if (!y || !m || !d) return null;
  return Date.UTC(y, m - 1, d) / 86400000;
}

function severityOf(daysLeft) {
  if (daysLeft === null) return "unscheduled";
  if (daysLeft < 0) return "overdue";
  if (daysLeft === 0) return "today";
  if (daysLeft <= 3) return "soon";
  if (daysLeft <= 7) return "week";
  return "later";
}

async function reminders() {
  const todayNum = dayNumber(today());
  const base = (kind, id, title, subtitle, amount, dueDate, page, meta) => {
    const n = dayNumber(dueDate);
    const daysLeft = n === null ? null : n - todayNum;
    return {
      key: `${kind}:${id}`,
      kind,
      id,
      title,
      subtitle,
      amount: amount === null || amount === undefined ? null : round2(amount),
      due_date: dueDate ? String(dueDate).slice(0, 10) : null,
      days_left: daysLeft,
      severity: severityOf(daysLeft),
      page,
      meta: meta || {}
    };
  };

  const dues = await query(
    `SELECT c.id, c.name, c.phone, c.email,
       COALESCE(SUM(s.total - s.paid), 0) AS balance,
       COUNT(*) AS unpaid_bills, MIN(s.created_at) AS oldest_unpaid_at
     FROM customers c JOIN sales s ON s.customer_id = c.id
     WHERE s.total > s.paid GROUP BY c.id
     HAVING COALESCE(SUM(s.total - s.paid), 0) > 0 ORDER BY balance DESC`
  );
  const purchases = await query(
    `SELECT p.id, p.supplier_id, p.due_date, (p.total - p.paid) AS balance, s.name AS supplier_name
     FROM supplier_purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id
     WHERE p.total > p.paid ORDER BY p.due_date ASC, p.id DESC`
  );
  const pendingCheques = await query(
    `SELECT c.*, s.name AS supplier_name, cu.name AS customer_name
     FROM cheques c LEFT JOIN suppliers s ON s.id = c.supplier_id
     LEFT JOIN customers cu ON cu.id = c.customer_id
     WHERE c.status = 'pending' ORDER BY c.clearing_date ASC, c.id DESC`
  );
  const openTasks = await query(
    "SELECT * FROM tasks WHERE status IN ('pending','in_progress') ORDER BY due_date ASC, id DESC"
  );
  const openCalls = await query(
    "SELECT * FROM call_notes WHERE status = 'pending' ORDER BY call_back_at ASC, id DESC"
  );

  const out = [];
  for (const c of dues) {
    const days = dayNumber(c.oldest_unpaid_at);
    out.push(
      base("customer_due", c.id, c.name, `${c.unpaid_bills} unpaid bill${Number(c.unpaid_bills) === 1 ? "" : "s"}`,
        c.balance, null, "customers", {
          phone: c.phone || "",
          email: c.email || "",
          unpaid_bills: Number(c.unpaid_bills) || 0,
          oldest_unpaid_date: c.oldest_unpaid_at ? String(c.oldest_unpaid_at).slice(0, 10) : null,
          outstanding_days: days === null ? null : Math.abs(days - todayNum)
        })
    );
  }
  for (const p of purchases) {
    out.push(base("supplier_due", p.id, p.supplier_name || "Unknown supplier", "Purchase balance to pay",
      p.balance, p.due_date, "purchases", { supplier_id: p.supplier_id }));
  }
  for (const q of pendingCheques) {
    const party = q.supplier_name || q.customer_name || q.drawer_name || "Unnamed party";
    out.push(base("cheque", q.id, `Cheque ${q.cheque_no}`,
      q.bank_name ? `${party} · ${q.bank_name}` : party, q.amount, q.clearing_date, "cheques",
      { cheque_no: q.cheque_no, bank_name: q.bank_name || "" }));
  }
  for (const t of openTasks) {
    out.push(base("task", t.id, t.title, "Task", null, t.due_date, "tasks",
      { priority: t.priority, status: t.status }));
  }
  for (const c of openCalls) {
    out.push(base("call", c.id, c.contact_name || c.phone || "Call back", c.note || "Call note",
      null, c.call_back_at, "call-notes", { phone: c.phone, priority: c.priority }));
  }

  const rank = { overdue: 0, today: 1, soon: 2, week: 3, later: 4, unscheduled: 5 };
  out.sort((a, b) => {
    const bySeverity = rank[a.severity] - rank[b.severity];
    if (bySeverity !== 0) return bySeverity;
    if (a.days_left === null && b.days_left !== null) return 1;
    if (b.days_left === null && a.days_left !== null) return -1;
    if (a.days_left !== null && b.days_left !== null && a.days_left !== b.days_left) return a.days_left - b.days_left;
    return (b.amount || 0) - (a.amount || 0);
  });

  const overdue = out.filter((r) => r.days_left !== null && r.days_left < 0).length;
  const dueToday = out.filter((r) => r.days_left === 0).length;
  return {
    reminders: out,
    summary: { total: out.length, overdue, due_today: dueToday, needs_attention: overdue + dueToday }
  };
}

// ─── Customer prices ─────────────────────────────────────────
async function customerPrices(productId) {
  return query(
    `SELECT cp.*, cc.name AS category_name FROM customer_prices cp
     JOIN customer_categories cc ON cc.id = cp.customer_category_id
     WHERE cp.product_id = ? ORDER BY cc.name`,
    [productId]
  );
}

async function updateCustomerPrices(productId, prices = {}) {
  const exists = await queryOne("SELECT id FROM products WHERE id = ?", [productId]);
  if (!exists) throw new Error("Product not found");
  return transaction(async () => {
    for (const [catId, raw] of Object.entries(prices || {})) {
      const cat = Number(catId);
      if (!Number.isFinite(cat)) continue;
      const value = num(raw);
      if (value > 0) {
        await run(
          `INSERT INTO customer_prices (product_id, customer_category_id, price) VALUES (?,?,?)
           ON CONFLICT(product_id, customer_category_id) DO UPDATE SET price = excluded.price`,
          [productId, cat, value]
        );
      } else {
        await run("DELETE FROM customer_prices WHERE product_id = ? AND customer_category_id = ?", [
          productId,
          cat
        ]);
      }
    }
    return { updated: true };
  });
}

// ─── Suppliers ────────────────────────────────────────────────
async function supplier(id) {
  const row = await queryOne("SELECT * FROM suppliers WHERE id = ?", [id]);
  if (!row) return null;
  const purchases = await query(
    "SELECT * FROM supplier_purchases WHERE supplier_id = ? ORDER BY purchased_at DESC, id DESC",
    [id]
  );
  const balance = purchases.reduce((n, p) => n + Math.max(0, num(p.total) - num(p.paid)), 0);
  return { ...row, purchases, balance: round2(balance) };
}

// ─── Online orders ────────────────────────────────────────────
async function onlineOrders(params = {}) {
  const args = [];
  let where = "WHERE s.channel = 'online'";
  if (params.status) {
    where += " AND s.status = ?";
    args.push(params.status);
  }
  return query(
    `SELECT s.*, c.name AS customer_record_name FROM sales s
     LEFT JOIN customers c ON c.id = s.customer_id
     ${where} ORDER BY s.created_at DESC, s.id DESC LIMIT 500`,
    args
  );
}

async function confirmOnlineOrder(id, data = {}) {
  const sale = await queryOne("SELECT * FROM sales WHERE id = ?", [id]);
  if (!sale) throw new Error("Order not found");
  const total = num(sale.total);
  const paid = data.paid != null ? num(data.paid) : total;
  await run(
    "UPDATE sales SET status = ?, paid = ?, payment_method = ?, updated_at = ? WHERE id = ?",
    [paid >= total ? "paid" : "partial", paid, String(data.payment_method || "cash"), now(), id]
  );
  return { updated: true };
}

async function cancelOnlineOrder(id) {
  await run("UPDATE sales SET status = 'cancelled', updated_at = ? WHERE id = ?", [now(), id]);
  return { updated: true };
}

// ─── Employees ────────────────────────────────────────────────
const EMP_STATUSES = ["active", "inactive", "resigned", "terminated"];
const validMonth = (m) => /^\d{4}-\d{2}$/.test(String(m || ""));

function employeeValues(data = {}, existing = {}) {
  const merged = { ...existing, ...data };
  return [
    String(merged.name || "").trim(),
    String(merged.phone || ""),
    String(merged.email || ""),
    String(merged.address || ""),
    String(merged.role || merged.designation || ""),
    String(merged.designation || merged.role || ""),
    ["salary", "wages", "freelancer"].includes(merged.salary_type) ? merged.salary_type : "salary",
    num(merged.salary_rate),
    String(merged.starting_date || ""),
    String(merged.joining_date || ""),
    RANKS.includes(merged.rank) ? merged.rank : "noob",
    Math.min(5, Math.max(1, Math.round(num(merged.stars) || 1))),
    String(merged.shift_start || ""),
    String(merged.shift_end || ""),
    merged.pf_enabled === true || merged.pf_enabled === 1 || merged.pf_enabled === "true" ? 1 : 0,
    num(merged.pf_rate),
    EMP_STATUSES.includes(merged.status) ? merged.status : "active",
    String(merged.last_working_date || ""),
    String(merged.bank_name || ""),
    String(merged.bank_account_no || ""),
    String(merged.bank_ifsc || ""),
    String(merged.upi_id || ""),
    String(merged.date_of_birth || ""),
    String(merged.emergency_contact_name || ""),
    String(merged.emergency_contact_phone || ""),
    String(merged.id_proof_type || ""),
    String(merged.id_proof_number || ""),
    String(merged.photo_path || ""),
    String(merged.notes || "")
  ];
}

const EMP_COLUMNS = [
  "name", "phone", "email", "address", "role", "designation", "salary_type", "salary_rate",
  "starting_date", "joining_date", "rank", "stars", "shift_start", "shift_end", "pf_enabled",
  "pf_rate", "status", "last_working_date", "bank_name", "bank_account_no", "bank_ifsc", "upi_id",
  "date_of_birth", "emergency_contact_name", "emergency_contact_phone", "id_proof_type",
  "id_proof_number", "photo_path", "notes"
];

async function loadPayrollData() {
  const att = await query("SELECT * FROM employee_attendance ORDER BY employee_id, date");
  const pays = await query("SELECT * FROM employee_payments ORDER BY date, id");
  return { att, pays };
}

function payrollForEmployee(emp, data, month) {
  const key = (x) => String(x.employee_id) === String(emp.id);
  const myAtt = data.att.filter(key);
  const myPays = data.pays.filter(key);
  const monthRows = myAtt.filter((a) => String(a.date || "").slice(0, 7) === month);
  const monthPays = myPays.filter((p) => String(p.date || "").slice(0, 7) === month);
  const byMonth = new Map();
  for (const a of myAtt) {
    const m = String(a.date || "").slice(0, 7);
    if (!m) continue;
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(a);
  }
  const allMonths = [...byMonth.entries()].map(([keyName, rows]) => ({
    month: keyName,
    accrual: monthAccrual(emp, rows).accrual
  }));
  return { ...emp, payroll: payrollFor(emp, monthRows, monthPays, allMonths, myPays) };
}

async function employees(month = today().slice(0, 7)) {
  const m = validMonth(month) ? month : today().slice(0, 7);
  const rows = await query("SELECT * FROM employees ORDER BY name");
  const data = await loadPayrollData();
  const docRows = await query(
    "SELECT employee_id, COUNT(*) AS documents FROM employee_documents GROUP BY employee_id"
  );
  const docs = new Map(docRows.map((d) => [String(d.employee_id), d.documents]));
  return rows.map((e) => ({
    ...payrollForEmployee(e, data, m),
    month: m,
    documents: docs.get(String(e.id)) || 0
  }));
}

async function employee(id, month = today().slice(0, 7)) {
  const m = validMonth(month) ? month : today().slice(0, 7);
  const row = await queryOne("SELECT * FROM employees WHERE id = ?", [id]);
  if (!row) return null;
  const data = await loadPayrollData();
  const documents = await query(
    "SELECT * FROM employee_documents WHERE employee_id = ? ORDER BY uploaded_at DESC, id DESC",
    [id]
  );
  return { ...payrollForEmployee(row, data, m), month: m, documents };
}

async function createEmployee(data = {}) {
  if (!String(data.name || "").trim()) throw new Error("Employee name is required");
  const res = await run(
    `INSERT INTO employees (${EMP_COLUMNS.join(", ")}, created_at)
     VALUES (${EMP_COLUMNS.map(() => "?").join(", ")}, ?)`,
    [...employeeValues(data), now()]
  );
  return { id: res.lastId };
}

async function updateEmployee(id, data = {}) {
  const existing = await queryOne("SELECT * FROM employees WHERE id = ?", [id]);
  if (!existing) throw new Error("Employee not found");
  await run(
    `UPDATE employees SET ${EMP_COLUMNS.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`,
    [...employeeValues(data, existing), id]
  );
  return { updated: true };
}

async function deleteEmployee(id) {
  const docs = await query("SELECT file_path FROM employee_documents WHERE employee_id = ?", [id]);
  const row = await queryOne("SELECT photo_path FROM employees WHERE id = ?", [id]);
  for (const d of docs) await deleteFile(d.file_path);
  if (row?.photo_path) await deleteFile(row.photo_path);
  await run("DELETE FROM employees WHERE id = ?", [id]);
  return { deleted: true };
}

async function attendance(params = {}) {
  const args = [];
  const where = [];
  if (params.from) {
    where.push("a.date >= ?");
    args.push(params.from);
  }
  if (params.to) {
    where.push("a.date <= ?");
    args.push(params.to);
  }
  if (params.employee_id) {
    where.push("a.employee_id = ?");
    args.push(Number(params.employee_id));
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return query(
    `SELECT a.*, e.name AS employee_name FROM employee_attendance a
     JOIN employees e ON e.id = a.employee_id
     ${clause} ORDER BY a.date DESC, e.name ASC LIMIT 2000`,
    args
  );
}

async function saveAttendance(data = {}) {
  if (!data.employee_id || !data.date) throw new Error("Choose an employee and a date");
  const day = String(data.date).slice(0, 10);
  const status = DAY_FRACTION[data.status] != null ? data.status : "present";
  const res = await run(
    `INSERT INTO employee_attendance (employee_id, date, status, time_in, time_out, notes)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(employee_id, date) DO UPDATE SET
       status = excluded.status, time_in = excluded.time_in,
       time_out = excluded.time_out, notes = excluded.notes`,
    [Number(data.employee_id), day, status, String(data.time_in || ""), String(data.time_out || ""), String(data.notes || "")]
  );
  return { id: res.lastId, updated: true };
}

async function updateAttendance(id, data = {}) {
  const existing = await queryOne("SELECT * FROM employee_attendance WHERE id = ?", [id]);
  if (!existing) throw new Error("Attendance not found");
  const status = DAY_FRACTION[data.status] != null ? data.status : existing.status;
  await run(
    "UPDATE employee_attendance SET status=?, time_in=?, time_out=?, notes=? WHERE id=?",
    [
      status,
      data.time_in != null ? String(data.time_in) : existing.time_in,
      data.time_out != null ? String(data.time_out) : existing.time_out,
      data.notes != null ? String(data.notes) : existing.notes,
      id
    ]
  );
  return { updated: true };
}

async function deleteAttendance(id) {
  await run("DELETE FROM employee_attendance WHERE id = ?", [id]);
  return { deleted: true };
}

async function employeePayments(params = {}) {
  const args = [];
  const where = [];
  if (params.from) {
    where.push("p.date >= ?");
    args.push(params.from);
  }
  if (params.to) {
    where.push("p.date <= ?");
    args.push(params.to);
  }
  if (params.employee_id) {
    where.push("p.employee_id = ?");
    args.push(Number(params.employee_id));
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return query(
    `SELECT p.*, e.name AS employee_name FROM employee_payments p
     JOIN employees e ON e.id = p.employee_id ${clause}
     ORDER BY p.date DESC, p.id DESC LIMIT 1000`,
    args
  );
}

async function createEmployeePayment(employeeId, data = {}) {
  const amount = num(data.amount);
  if (!(amount > 0)) throw new Error("Enter an amount");
  if (!PAYMENT_TYPES.includes(data.type)) throw new Error("Choose a payment type");
  const res = await run(
    `INSERT INTO employee_payments (employee_id, type, amount, date, method, notes, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    [
      Number(employeeId),
      data.type,
      amount,
      String(data.date || today()),
      String(data.method || data.payment_method || "cash"),
      String(data.notes ?? data.note ?? ""),
      now()
    ]
  );
  return { id: res.lastId };
}

async function deleteEmployeePayment(id) {
  await run("DELETE FROM employee_payments WHERE id = ?", [id]);
  return { deleted: true };
}

async function employeeDocuments(params = {}) {
  const args = [];
  let where = "";
  if (params.employee_id) {
    where = "WHERE d.employee_id = ?";
    args.push(Number(params.employee_id));
  }
  return query(
    `SELECT d.*, e.name AS employee_name FROM employee_documents d
     JOIN employees e ON e.id = d.employee_id ${where}
     ORDER BY d.uploaded_at DESC, d.id DESC LIMIT 1000`,
    args
  );
}

async function createEmployeeDocument(employeeId, data = {}) {
  const file = data.file;
  let filePath = String(data.file_path || "");
  let fileType = String(data.file_type || "");
  if (file && isDataUrl(file)) {
    filePath = await saveDataUrl(file, `docs/employees/${employeeId}`);
    fileType = String(file).slice(5, String(file).indexOf(";"));
  }
  const res = await run(
    `INSERT INTO employee_documents (employee_id, category, label, file_path, file_type, file_size, uploaded_at)
     VALUES (?,?,?,?,?,?,?)`,
    [
      Number(employeeId),
      String(data.category || "Other"),
      String(data.label || ""),
      filePath,
      fileType,
      num(data.file_size),
      now()
    ]
  );
  return { id: res.lastId };
}

async function deleteEmployeeDocument(id) {
  const row = await queryOne("SELECT file_path FROM employee_documents WHERE id = ?", [id]);
  if (row?.file_path) await deleteFile(row.file_path);
  await run("DELETE FROM employee_documents WHERE id = ?", [id]);
  return { deleted: true };
}

async function employeePayroll(month = today().slice(0, 7)) {
  const m = validMonth(month) ? month : today().slice(0, 7);
  const rows = await query("SELECT * FROM employees ORDER BY name");
  const data = await loadPayrollData();
  const snapshots = await query("SELECT * FROM employee_payrolls WHERE month = ?", [m]);
  const snapMap = new Map(snapshots.map((s) => [String(s.employee_id), s]));
  const out = rows.map((emp) => {
    const live = payrollForEmployee(emp, data, m).payroll;
    const snap = snapMap.get(String(emp.id));
    const finalized = !!snap;
    return {
      ...emp,
      month: m,
      payroll: live,
      accrual: finalized ? num(snap.accrual) : live.accrual,
      pf_employee: finalized ? num(snap.pf_employee) : live.pf.employee,
      pf_employer: finalized ? num(snap.pf_employer) : live.pf.employer,
      paid_before: finalized ? num(snap.paid_before) : live.paid.total,
      net_payable: finalized ? num(snap.net_payable) : live.balance,
      balance: finalized ? num(snap.net_payable) : live.balance,
      paid_days: live.paidDays,
      daily: live.daily,
      payroll_status: finalized ? snap.status : "draft",
      finalized_at: snap?.finalized_at || null,
      paid_at: snap?.paid_at || null,
      payroll_note: snap?.note || null
    };
  });
  return {
    month: m,
    locked: snapshots.length > 0,
    has_paid: snapshots.some((s) => s.status === "paid"),
    rows: out
  };
}

async function finalizeEmployeePayroll(month) {
  const m = String(month || "").trim();
  if (!validMonth(m)) throw new Error("A valid month is required");
  return transaction(async () => {
    const paid = await query("SELECT employee_id FROM employee_payrolls WHERE month = ? AND status = 'paid'", [m]);
    const paidIds = new Set(paid.map((r) => String(r.employee_id)));
    await run("DELETE FROM employee_payrolls WHERE month = ? AND status <> 'paid'", [m]);
    const employeesList = await query("SELECT * FROM employees");
    const att = await query("SELECT * FROM employee_attendance WHERE substr(date, 1, 7) = ?", [m]);
    const pays = await query("SELECT * FROM employee_payments WHERE substr(date, 1, 7) = ?", [m]);
    let count = 0;
    for (const emp of employeesList) {
      if (paidIds.has(String(emp.id))) continue;
      const monthAtt = att.filter((a) => String(a.employee_id) === String(emp.id));
      const monthPays = pays.filter((p) => String(p.employee_id) === String(emp.id));
      const earned = monthAccrual(emp, monthAtt);
      const pf = payrollFor(emp, monthAtt, monthPays).pf;
      const paidBefore = monthPays.reduce((sum, p) => sum + num(p.amount), 0);
      const net = round2(earned.accrual - pf.employee - paidBefore);
      await run(
        `INSERT INTO employee_payrolls
          (employee_id, month, accrual, pf_employee, pf_employer, paid_before, net_payable, status, finalized_at)
         VALUES (?,?,?,?,?,?,?, 'finalized', ?)`,
        [emp.id, m, earned.accrual, pf.employee, pf.employer, round2(paidBefore), net, now()]
      );
      count += 1;
    }
    return { finalized: count, month: m };
  });
}

async function reopenEmployeePayroll(month) {
  const m = String(month || "");
  if (!validMonth(m)) throw new Error("A valid month is required");
  const paid = await queryOne("SELECT 1 AS hit FROM employee_payrolls WHERE month = ? AND status = 'paid' LIMIT 1", [m]);
  if (paid) throw new Error("This month has paid payslips. Reopening it would orphan those payments.");
  await run("DELETE FROM employee_payrolls WHERE month = ?", [m]);
  return { reopened: true, month: m };
}

async function payEmployeePayroll(employeeId, month, data = {}) {
  const m = String(month || "").trim();
  if (!validMonth(m)) throw new Error("A valid month is required");
  return transaction(async () => {
    const payroll = await queryOne(
      "SELECT * FROM employee_payrolls WHERE employee_id = ? AND month = ?",
      [Number(employeeId), m]
    );
    if (!payroll) throw new Error("Finalize this payroll month first.");
    if (payroll.status === "paid") throw new Error("This payslip is already marked paid.");
    const amount = round2(payroll.net_payable);
    if (amount > 0) {
      await run(
        `INSERT INTO employee_payments (employee_id, type, amount, date, method, notes, created_at)
         VALUES (?, 'salary', ?, ?, ?, ?, ?)`,
        [
          Number(employeeId),
          amount,
          today(),
          String(data.method || data.payment_method || "cash"),
          String(data.notes || data.note || `Salary for ${m}`),
          now()
        ]
      );
    }
    await run(
      "UPDATE employee_payrolls SET status = 'paid', paid_at = ?, note = ? WHERE id = ?",
      [now(), String(data.notes || data.note || ""), payroll.id]
    );
    return { paid: true, amount: Math.max(0, amount), month: m };
  });
}

async function employeeLedger(employeeId, month = today().slice(0, 7)) {
  const m = validMonth(month) ? month : today().slice(0, 7);
  const emp = await queryOne("SELECT * FROM employees WHERE id = ?", [employeeId]);
  if (!emp) throw new Error("Employee not found");
  const att = await query(
    "SELECT * FROM employee_attendance WHERE employee_id = ? AND substr(date, 1, 7) = ? ORDER BY date",
    [Number(employeeId), m]
  );
  const pays = await query(
    "SELECT * FROM employee_payments WHERE employee_id = ? AND substr(date, 1, 7) = ? ORDER BY date, id",
    [Number(employeeId), m]
  );
  const ledger = ledgerFor(emp, att, pays);
  const snapshot = await queryOne(
    "SELECT * FROM employee_payrolls WHERE employee_id = ? AND month = ?",
    [Number(employeeId), m]
  );
  return { employee_id: Number(employeeId), month: m, ...ledger, payroll: snapshot || null };
}

// ─── Vouchers ─────────────────────────────────────────────────
const VOUCHER_TYPES = ["percent", "rupee"];

function campaignStatus(c) {
  const day = today();
  const from = String(c.valid_from || "").slice(0, 10);
  const through = String(c.valid_through || "").slice(0, 10);
  if (!c.active) return "inactive";
  if (from && day < from) return "upcoming";
  if (through && day > through) return "ended";
  return "active";
}

async function voucherCampaigns() {
  const rows = await query("SELECT * FROM voucher_campaigns ORDER BY created_at DESC, id DESC");
  return rows.map((c) => ({
    ...c,
    active: !!c.active,
    computed_status: campaignStatus(c),
    valid_through: String(c.valid_through || "").slice(0, 10)
  }));
}

async function createVoucherCampaign(data = {}) {
  const name = String(data.name || "").trim();
  if (!name) throw new Error("Voucher name is required");
  const type = VOUCHER_TYPES.includes(data.discount_type) ? data.discount_type : "percent";
  const value = num(data.discount_value);
  if (value <= 0) throw new Error("Discount value must be greater than zero");
  const months = Math.max(1, Math.min(24, Math.round(num(data.months) || 1)));
  if (data.valid_from && data.valid_through && data.valid_from > data.valid_through) {
    throw new Error("Start date must be before end date");
  }
  const res = await run(
    `INSERT INTO voucher_campaigns
      (name, discount_type, discount_value, min_total, valid_from, valid_through, months, active, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      name,
      type,
      value,
      num(data.min_total),
      String(data.valid_from || ""),
      String(data.valid_through || ""),
      months,
      data.active === false ? 0 : 1,
      now()
    ]
  );
  return { id: res.lastId };
}

async function updateVoucherCampaign(id, data = {}) {
  const existing = await queryOne("SELECT * FROM voucher_campaigns WHERE id = ?", [id]);
  if (!existing) throw new Error("Campaign not found");
  await run(
    `UPDATE voucher_campaigns SET name=?, discount_type=?, discount_value=?, min_total=?,
       valid_from=?, valid_through=?, months=?, active=? WHERE id=?`,
    [
      data.name != null ? String(data.name) : existing.name,
      VOUCHER_TYPES.includes(data.discount_type) ? data.discount_type : existing.discount_type,
      data.discount_value != null ? num(data.discount_value) : num(existing.discount_value),
      data.min_total != null ? num(data.min_total) : num(existing.min_total),
      data.valid_from != null ? String(data.valid_from) : existing.valid_from,
      data.valid_through != null ? String(data.valid_through) : existing.valid_through,
      data.months != null ? Math.max(1, Math.min(24, Math.round(num(data.months)))) : existing.months,
      data.active != null ? (data.active ? 1 : 0) : existing.active,
      id
    ]
  );
  return { updated: true };
}

async function deleteVoucherCampaign(id) {
  await run("DELETE FROM voucher_campaigns WHERE id = ?", [id]);
  return { deleted: true };
}

async function vouchers(params = {}) {
  const args = [];
  const where = [];
  if (params.campaign_id) {
    where.push("v.campaign_id = ?");
    args.push(Number(params.campaign_id));
  }
  if (params.status === "active") where.push("v.status = 'active'");
  if (params.status === "used") where.push("v.status <> 'active'");
  if (params.customer_id) {
    where.push("v.customer_id = ?");
    args.push(Number(params.customer_id));
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return query(
    `SELECT v.*, COALESCE(c.name, v.campaign_name) AS campaign_name,
       c.discount_type AS campaign_discount_type, c.discount_value AS campaign_discount_value
     FROM vouchers v LEFT JOIN voucher_campaigns c ON c.id = v.campaign_id
     ${clause} ORDER BY v.created_at DESC, v.id DESC LIMIT 2000`,
    args
  );
}

async function createVoucher(data = {}) {
  const campaignId = Number(data.campaign_id);
  if (!campaignId) throw new Error("Choose a voucher campaign");
  const campaign = await queryOne("SELECT * FROM voucher_campaigns WHERE id = ?", [campaignId]);
  if (!campaign) throw new Error("Campaign not found");
  if (campaignStatus(campaign) === "ended") throw new Error("This voucher campaign has ended");
  let customerName = String(data.customer_name || "").trim();
  let customerId = data.customer_id ? Number(data.customer_id) : null;
  if (customerId) {
    const customer = await queryOne("SELECT name FROM customers WHERE id = ?", [customerId]);
    if (!customer) throw new Error("Customer not found");
    customerName = String(customer.name || customerName);
  }
  if (!customerName) throw new Error("Enter the customer name");
  const months = Math.max(1, Number(campaign.months) || 1);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const code = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
    const hit = await queryOne("SELECT 1 AS hit FROM vouchers WHERE code = ? LIMIT 1", [code]);
    if (hit) continue;
    const res = await run(
      `INSERT INTO vouchers
        (campaign_id, campaign_name, code, customer_id, customer_name, discount_type, discount_value,
         min_total, valid_from, valid_through, months, uses_left, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'active', ?)`,
      [
        campaignId,
        campaign.name,
        code,
        customerId,
        customerName,
        campaign.discount_type,
        num(campaign.discount_value),
        num(campaign.min_total),
        String(campaign.valid_from || ""),
        String(campaign.valid_through || ""),
        months,
        months,
        now()
      ]
    );
    return { id: res.lastId, code };
  }
  throw new Error("Could not allocate a unique voucher code");
}

async function validateVoucher(code, total) {
  const value = String(code || "").trim();
  if (!/^\d{4}$/.test(value)) return { valid: false, error: "Enter a valid 4-digit voucher code" };
  const row = await queryOne(
    `SELECT v.*, COALESCE(c.name, v.campaign_name) AS campaign_name
     FROM vouchers v LEFT JOIN voucher_campaigns c ON c.id = v.campaign_id
     WHERE v.code = ?`,
    [value]
  );
  if (!row) return { valid: false, error: "Unknown voucher code" };
  const day = today();
  const from = String(row.valid_from || "").slice(0, 10);
  const through = String(row.valid_through || "").slice(0, 10);
  let error = null;
  if (row.status !== "active" || num(row.uses_left) <= 0) error = "This voucher has already been used";
  else if (from && day < from) error = `This voucher starts on ${from}`;
  else if (through && day > through) error = `This voucher expired on ${through}`;
  else if (total != null && num(row.min_total) > 0 && num(total) < num(row.min_total)) {
    error = `Minimum shopping of Rs ${num(row.min_total)} required to use this voucher`;
  }
  if (error) return { valid: false, error };
  return { valid: true, voucher: row };
}

async function redeemVoucher(id) {
  const row = await queryOne("SELECT * FROM vouchers WHERE id = ?", [id]);
  if (!row) throw new Error("Voucher not found");
  const left = Math.max(0, num(row.uses_left) - 1);
  await run("UPDATE vouchers SET uses_left = ?, status = ? WHERE id = ?", [
    left,
    left <= 0 ? "used" : "active",
    id
  ]);
  return { updated: true, uses_left: left };
}

async function deleteVoucher(id) {
  await run("DELETE FROM vouchers WHERE id = ?", [id]);
  return { deleted: true };
}

// ─── Brokers ──────────────────────────────────────────────────
const ENQUIRY_STATUSES = ["pending", "sent", "ordered", "received", "cancelled"];

async function brokers() {
  return query(
    `SELECT b.*,
       (SELECT COUNT(*) FROM broker_enquiries e WHERE e.broker_id = b.id) AS enquiry_count,
       (SELECT MAX(e.created_at) FROM broker_enquiries e WHERE e.broker_id = b.id) AS last_enquiry_at
     FROM brokers b ORDER BY b.name`
  );
}

async function createBroker(data = {}) {
  const name = String(data.name || "").trim();
  const phone = String(data.phone || "").trim();
  if (!name) throw new Error("Broker name is required");
  if (!phone) throw new Error("Broker phone is required to send WhatsApp");
  const res = await run(
    "INSERT INTO brokers (name, phone, company, address, notes, created_at) VALUES (?,?,?,?,?,?)",
    [name, phone, String(data.company || ""), String(data.address || ""), String(data.notes || ""), now()]
  );
  return { id: res.lastId };
}

async function updateBroker(id, data = {}) {
  const existing = await queryOne("SELECT * FROM brokers WHERE id = ?", [id]);
  if (!existing) throw new Error("Broker not found");
  const name = data.name != null ? String(data.name).trim() : existing.name;
  const phone = data.phone != null ? String(data.phone).trim() : existing.phone;
  if (!name) throw new Error("Broker name is required");
  if (!phone) throw new Error("Broker phone is required to send WhatsApp");
  await run("UPDATE brokers SET name=?, phone=?, company=?, address=?, notes=? WHERE id=?", [
    name,
    phone,
    data.company != null ? String(data.company) : existing.company,
    data.address != null ? String(data.address) : existing.address,
    data.notes != null ? String(data.notes) : existing.notes,
    id
  ]);
  return { updated: true };
}

async function deleteBroker(id) {
  await run("DELETE FROM brokers WHERE id = ?", [id]);
  return { deleted: true };
}

async function brokerEnquiries(params = {}) {
  const args = [];
  const where = [];
  if (ENQUIRY_STATUSES.includes(params.status)) {
    where.push("e.status = ?");
    args.push(params.status);
  }
  if (params.broker_id) {
    where.push("e.broker_id = ?");
    args.push(Number(params.broker_id));
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return query(
    `SELECT e.*, b.name AS broker_name, b.phone AS broker_phone, b.company AS broker_company
     FROM broker_enquiries e LEFT JOIN brokers b ON b.id = e.broker_id
     ${clause} ORDER BY e.created_at DESC, e.id DESC LIMIT 500`,
    args
  );
}

async function brokerEnquiry(id) {
  return queryOne(
    `SELECT e.*, b.name AS broker_name, b.phone AS broker_phone, b.company AS broker_company
     FROM broker_enquiries e LEFT JOIN brokers b ON b.id = e.broker_id WHERE e.id = ?`,
    [id]
  );
}

async function createBrokerEnquiry(data = {}) {
  const brokerId = Number(data.broker_id);
  if (!brokerId) throw new Error("Select a broker to send the enquiry to");
  const productName = String(data.product_name || "").trim();
  const qty = num(data.qty);
  if (!productName || qty <= 0) throw new Error("Add a product and a quantity");
  const ref = `BR-${today().replace(/-/g, "").slice(2)}-${String(Date.now()).slice(-4)}`;
  const res = await run(
    `INSERT INTO broker_enquiries (broker_id, reference_no, product_name, qty, unit, status, notes, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      brokerId,
      ref,
      productName,
      qty,
      String(data.unit || "pcs"),
      ENQUIRY_STATUSES.includes(data.status) ? data.status : "sent",
      String(data.notes || ""),
      now()
    ]
  );
  return { id: res.lastId, reference_no: ref };
}

async function updateBrokerEnquiryStatus(id, data = {}) {
  const status = ENQUIRY_STATUSES.includes(data.status) ? data.status : null;
  if (!status) throw new Error("Invalid enquiry status");
  await run("UPDATE broker_enquiries SET status = ? WHERE id = ?", [status, id]);
  return { updated: true };
}

async function deleteBrokerEnquiry(id) {
  await run("DELETE FROM broker_enquiries WHERE id = ?", [id]);
  return { deleted: true };
}

// ─── Export ───────────────────────────────────────────────────
export const api = {
  storeInfo,
  saveStoreInfo,
  securityStatus,
  verifyActionPassword,
  setActionPassword,
  toggleSecurity,
  dashboard,
  stats,
  categories,
  createCategory: (data) => saveCategory(null, data),
  updateCategory: (id, data) => saveCategory(id, data),
  deleteCategory,
  items,
  products,
  productsPage,
  productOptions,
  productByBarcode,
  product,
  createProduct,
  updateProduct,
  deleteProduct,
  updateProductPrices,
  uploadProductImages,
  deleteProductImages,
  orderProductImages,
  measuringUnits,
  createMeasuringUnit: (data) => saveMeasuringUnit(null, data),
  updateMeasuringUnit: (id, data) => saveMeasuringUnit(id, data),
  deleteMeasuringUnit,
  suppliers,
  createSupplier: (data) => saveSupplier(null, data),
  updateSupplier: (id, data) => saveSupplier(id, data),
  deleteSupplier,
  supplierPurchases,
  supplierPurchase,
  createSupplierPurchase,
  updateSupplierPurchase,
  updateSupplierPayment,
  deleteSupplierPurchase,
  productPacks,
  productPack,
  updateProductPack,
  sales,
  sale,
  saleByInvoice,
  createSale,
  updateSale,
  updateSaleStatus,
  deleteSale,
  returns,
  createReturn,
  stockRemovals,
  createStockRemoval,
  deleteStockRemoval,
  customers,
  createCustomer: (data) => saveCustomer(null, data),
  updateCustomer: (id, data) => saveCustomer(id, data),
  deleteCustomer,
  customerPayments,
  createCustomerPayment,
  deleteCustomerPayment,
  customerBills,
  completedCustomerBills,
  expenses,
  createExpense,
  deleteExpense,
  expenseCategories,
  createExpenseCategory: (data) => saveExpenseCategory(null, data),
  updateExpenseCategory: (id, data) => saveExpenseCategory(id, data),
  deleteExpenseCategory,
  nonSaleInventory,
  createNonSaleItem,
  updateNonSaleItem,
  useNonSaleItem,
  deleteNonSaleItem,
  businessDocuments,
  createBusinessDocument,
  updateBusinessDocument,
  deleteBusinessDocument,
  businessDocumentCategories,
  createBusinessDocumentCategory: (data) => saveBusinessDocumentCategory(null, data),
  updateBusinessDocumentCategory: (id, data) => saveBusinessDocumentCategory(id, data),
  deleteBusinessDocumentCategory,
  customerCategories,
  createCustomerCategory: (data) => saveCustomerCategory(null, data),
  updateCustomerCategory: (id, data) => saveCustomerCategory(id, data),
  deleteCustomerCategory,
  assetCategories,
  createAssetCategory: (data) => saveAssetCategory(null, data),
  updateAssetCategory: (id, data) => saveAssetCategory(id, data),
  deleteAssetCategory,
  assets,
  createAsset,
  updateAsset,
  deleteAsset,
  cheques,
  createCheque,
  updateCheque,
  updateChequeStatus,
  deleteCheque,
  tasks,
  createTask,
  updateTask,
  updateTaskStatus,
  deleteTask,
  callNotes,
  createCallNote,
  updateCallNote,
  updateCallNoteStatus,
  deleteCallNote,
  reminders,
  customerPrices,
  updateCustomerPrices,
  supplier,
  onlineOrders,
  confirmOnlineOrder,
  cancelOnlineOrder,
  employees,
  employee,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  attendance,
  saveAttendance,
  updateAttendance,
  deleteAttendance,
  employeePayments,
  createEmployeePayment,
  deleteEmployeePayment,
  employeeDocuments,
  createEmployeeDocument,
  deleteEmployeeDocument,
  employeePayroll,
  finalizeEmployeePayroll,
  reopenEmployeePayroll,
  payEmployeePayroll,
  employeeLedger,
  voucherCampaigns,
  createVoucherCampaign,
  updateVoucherCampaign,
  deleteVoucherCampaign,
  vouchers,
  createVoucher,
  validateVoucher,
  redeemVoucher,
  deleteVoucher,
  brokers,
  createBroker,
  updateBroker,
  deleteBroker,
  brokerEnquiries,
  brokerEnquiry,
  createBrokerEnquiry,
  updateBrokerEnquiryStatus,
  deleteBrokerEnquiry
};
