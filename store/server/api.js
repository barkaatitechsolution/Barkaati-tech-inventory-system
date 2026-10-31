import { Router } from "express";
import { pool } from "./db.js";

const router = Router();

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const fmtMoney = (value) => `₹${(Number(value) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const MAX_ITEMS = 100;
const MAX_QTY = 999;

function normalizePhone(raw) {
  let digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (digits.startsWith("91") && digits.length === 12) return digits;
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

// Bills and product photos are served by this same public server, so the stored
// /uploads/... path is already reachable for a phone on the tunnel. Absolute
// URLs and inline data URLs are left untouched.
function imageUrl(url) {
  const value = String(url || "");
  if (!value) return "";
  // Older rows may store an absolute http://localhost:3001/uploads/... URL.
  // Reduce those to /uploads/... so the same image works through the tunnel.
  const local = value.match(/^https?:\/\/[^/]+(\/uploads\/.*)$/i);
  return local ? local[1] : value;
}

function productImagesToClient(images) {
  const list = Array.isArray(images) ? images : [];
  return list.map((img) => ({ id: img.id, url: imageUrl(img.url) })).filter((img) => !!img.url);
}

// The shop app treats the remaining quantity inside product packs as the real
// stock level. Only products stocked without packs fall back to products.stock.
const AVAILABLE_STOCK_SQL = "COALESCE(NULLIF(packs.total_stock, 0), p.stock)";

const PRODUCT_SELECT = `
  SELECT p.id, p.name, p.sku, p.unit, p.unit_id, p.barcode,
         p.category_id, p.subcategory_id, p.online,
         c.name AS category, sc.name AS subcategory,
         p.selling_price, p.market_price, p.tax, p.discount, p.hsn_code,
         p.description, p.reorder_level, ${AVAILABLE_STOCK_SQL} AS stock,
         COALESCE(images.images, '[]') AS images,
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
  LEFT JOIN LATERAL (
    SELECT SUM(pp.remaining) AS total_stock
    FROM product_packs pp WHERE pp.product_id = p.id
  ) packs ON TRUE
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN subcategories sc ON sc.id = p.subcategory_id
  LEFT JOIN LATERAL (
    SELECT COALESCE(
      json_agg(json_build_object('id', pi.id, 'url', pi.url) ORDER BY pi.sort_order, pi.id),
      '[]'
    ) AS images
    FROM product_images pi WHERE pi.product_id = p.id
  ) images ON TRUE
`;

function productToClient(row) {
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    unit: row.unit,
    unit_id: row.unit_id,
    barcode: row.barcode,
    category_id: row.category_id,
    subcategory_id: row.subcategory_id,
    online: row.online,
    category: row.category,
    subcategory: row.subcategory,
    selling_price: Number(row.selling_price) || 0,
    market_price: Number(row.market_price) || 0,
    tax: Number(row.tax) || 0,
    discount: Number(row.discount) || 0,
    hsn_code: row.hsn_code,
    reorder_level: Number(row.reorder_level) || 0,
    purchase_cost: Number(row.unit_cost) || 0,
    stock: Number(row.stock) || 0,
    description: row.description || "",
    images: productImagesToClient(
      typeof row.images === "string" ? JSON.parse(row.images) : row.images
    )
  };
}

async function storeSettings() {
  const { rows } = await pool.query("SELECT * FROM store_info WHERE id = 1");
  const row = rows[0] || {};
  return {
    name: row.name || "Barkaati Tech",
    tagline: row.tagline || "Order online, pay on delivery",
    phone: row.phone || "",
    whatsappNumber: row.whatsapp_number || row.phone || "",
    address: row.address || "",
    logo: imageUrl(row.logo || ""),
    deliveryFee: Number(row.delivery_fee) || 0,
    currency: "INR",
    footerText: row.footer_text || "",
    onlineStoreEnabled: row.online_store_enabled !== false,
    onlineStoreUrl: row.online_store_url || ""
  };
}

function buildWhatsAppText(store, order, items) {
  const lines = [];
  lines.push(`*${store.name}*`);
  if (store.address) lines.push(store.address);
  if (store.phone) lines.push(`Tel: ${store.phone}`);
  lines.push("");
  lines.push(`*ONLINE ORDER ${order.invoice_no}*`);
  if (order.customer_name) lines.push(`Customer: ${order.customer_name}`);
  if (order.customer_phone) lines.push(`Phone: ${order.customer_phone}`);
  if (order.delivery_type === "delivery" && order.address) {
    lines.push(`Delivery address: ${order.address}`);
  } else {
    lines.push("Pickup from the shop");
  }
  lines.push("");
  lines.push("*Items*");
  items.forEach((it, i) => {
    lines.push(`${i + 1}. ${it.product_name}`);
    lines.push(`   ${it.qty} x ${fmtMoney(it.unit_price)} = ${fmtMoney(it.line_total)}`);
  });
  lines.push("");
  lines.push(`Subtotal: ${fmtMoney(order.subtotal)}`);
  if (Number(order.delivery_fee) > 0) lines.push(`Delivery: ${fmtMoney(order.delivery_fee)}`);
  lines.push(`*Total: ${fmtMoney(order.total)}*`);
  lines.push("");
  lines.push(
    order.delivery_type === "delivery" ? "Payment: Pay on delivery." : "Payment: Pay at pickup."
  );
  lines.push("");
  lines.push(store.footerText || "Thank you for shopping with us!");
  return lines.join("\n");
}

async function findOrCreateCustomer(client, { name, phone, address }) {
  if (phone) {
    const { rows } = await client.query(
      "SELECT id FROM customers WHERE phone = $1 ORDER BY id LIMIT 1",
      [phone]
    );
    if (rows.length > 0) return rows[0].id;
  }
  const { rows } = await client.query(
    "INSERT INTO customers (name, phone, address) VALUES ($1, $2, $3) RETURNING id",
    [name || "Online customer", phone || null, address || null]
  );
  return rows[0].id;
}

async function createOrder(body) {
  const store = await storeSettings();
  if (!store.onlineStoreEnabled) {
    return { status: 409, error: "The online store is currently closed." };
  }

  const deliveryType = body.delivery_type === "pickup" ? "pickup" : "delivery";
  const name = String(body.customer_name || "").trim();
  const phone = String(body.customer_phone || "").trim();
  const address = String(body.address || "").trim();
  const note = String(body.note || "").trim();

  if (!phone) {
    return {
      status: 400,
      error: "Please enter a phone number so the shop can confirm your order."
    };
  }
  if (deliveryType === "delivery" && !address) {
    return { status: 400, error: "Delivery address is required for delivery orders." };
  }

  const requested = Array.isArray(body.items) ? body.items : [];
  if (requested.length === 0) return { status: 400, error: "Your cart is empty." };
  if (requested.length > MAX_ITEMS) {
    return { status: 400, error: `An order can have at most ${MAX_ITEMS} different items.` };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Prices and availability are always read from the database. The browser
    // can send whatever it likes; it is only trusted for product id and qty.
    const items = [];
    for (const it of requested) {
      const productId = Number(it.product_id);
      const qty = Math.floor(Number(it.qty) || 0);
      if (!productId || qty <= 0) {
        await client.query("ROLLBACK");
        return { status: 400, error: "One of the cart items has an invalid quantity." };
      }
      if (qty > MAX_QTY) {
        await client.query("ROLLBACK");
        return { status: 400, error: `Maximum quantity per item is ${MAX_QTY}.` };
      }

      const { rows } = await client.query(
        `${PRODUCT_SELECT} WHERE p.id = $1 AND p.online = TRUE`,
        [productId]
      );
      const p = rows[0];
      if (!p) {
        await client.query("ROLLBACK");
        return { status: 400, error: "One of the products is no longer available online." };
      }

      const available = Number(p.stock) || 0;
      if (available <= 0) {
        await client.query("ROLLBACK");
        return {
          status: 400,
          error: `"${p.name}" is out of stock. Please remove it from your cart.`
        };
      }
      if (available < qty) {
        await client.query("ROLLBACK");
        return {
          status: 400,
          error: `Only ${available} ${p.unit || "pcs"} of "${p.name}" left in stock.`
        };
      }

      const selling = Number(p.selling_price) || 0;
      const disc = Number(p.discount) || 0;
      const tax = Number(p.tax) || 0;
      const taxable = Math.max(0, selling - disc);
      const unitPrice = round2(taxable + (taxable * tax) / 100);
      const lineTotal = round2(unitPrice * qty);
      const cost = Number(p.unit_cost) || 0;

      items.push({
        product_id: p.id,
        product_name: p.name,
        qty,
        unit_price: unitPrice,
        market_price: Number(p.market_price) || 0,
        unit_id: p.unit_id || null,
        purchase_price: cost,
        profit: round2((unitPrice - cost) * qty),
        hsn_code: p.hsn_code || null,
        tax,
        tax_amt: round2(taxable * (tax / 100) * qty),
        line_total: lineTotal
      });
    }

    if (items.length === 0) {
      await client.query("ROLLBACK");
      return { status: 400, error: "No valid order items." };
    }

    const subtotal = round2(items.reduce((a, it) => a + it.line_total, 0));
    const deliveryFee = deliveryType === "delivery" ? round2(Number(store.deliveryFee) || 0) : 0;
    const total = round2(subtotal + deliveryFee);
    const customerId = await findOrCreateCustomer(client, { name, phone, address });

    // Serialise invoice numbers so two people ordering at once cannot pick the
    // same ONL- number.
    await client.query("SELECT pg_advisory_xact_lock(918273)");
    const { rows: numberRows } = await client.query(
      `SELECT COALESCE(MAX(
                CASE WHEN invoice_no ~ '^ONL-[0-9]+$'
                     THEN SUBSTRING(invoice_no FROM 5)::INTEGER ELSE 0 END
              ), 0) + 1 AS next_no
       FROM sales`
    );
    const invoiceNo = `ONL-${String(numberRows[0].next_no).padStart(4, "0")}`;

    const { rows: saleRows } = await client.query(
      `INSERT INTO sales
         (invoice_no, customer_id, total, paid, status, payment_method, note, channel,
          online_customer_name, online_customer_phone, online_delivery_type, online_address)
       VALUES ($1, $2, $3, 0, 'booking', 'online', $4, 'online', $5, $6, $7, $8)
       RETURNING id, invoice_no, created_at`,
      [
        invoiceNo,
        customerId,
        total,
        note || null,
        name || "Online customer",
        phone || null,
        deliveryType,
        deliveryType === "delivery" ? address : null
      ]
    );
    const sale = saleRows[0];

    for (const it of items) {
      await client.query(
        `INSERT INTO sale_items
           (sale_id, product_id, qty, unit_price, market_price, unit_id,
            conversion_factor, purchase_price, profit, hsn_code, tax, tax_amt)
         VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8, $9, $10, $11)`,
        [
          sale.id,
          it.product_id,
          it.qty,
          it.unit_price,
          it.market_price,
          it.unit_id,
          it.purchase_price,
          it.profit,
          it.hsn_code,
          it.tax,
          it.tax_amt
        ]
      );
    }

    await client.query("COMMIT");

    const order = {
      id: sale.id,
      invoice_no: sale.invoice_no,
      order_no: sale.invoice_no,
      created_at: sale.created_at,
      status: "booking",
      customer_name: name || "Online customer",
      customer_phone: phone,
      delivery_type: deliveryType,
      address: deliveryType === "delivery" ? address : "",
      note,
      subtotal,
      delivery_fee: deliveryFee,
      total,
      items
    };
    const text = buildWhatsAppText(store, order, items);
    const whatsappUrl = `https://wa.me/${normalizePhone(
      store.whatsappNumber || store.phone
    )}?text=${encodeURIComponent(text)}`;
    return { order, whatsappUrl };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function findOnlineOrder(invoice, phone) {
  const invoiceNo = String(invoice || "").trim().toUpperCase();
  const digits = normalizePhone(phone);
  if (!invoiceNo || !digits) return null;

  const { rows } = await pool.query(
    `SELECT s.*, c.name AS customer_record_name
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
      WHERE s.channel = 'online' AND UPPER(s.invoice_no) = $1
      ORDER BY s.id DESC
      LIMIT 1`,
    [invoiceNo]
  );
  const row = rows[0];
  if (!row) return null;

  // The phone is the shared secret for a lookup, so compare in normalized form
  // and never reveal whether the invoice existed when the phone does not match.
  const savedPhone = normalizePhone(row.online_customer_phone || "");
  if (!savedPhone || savedPhone !== digits) return null;

  const { rows: itemRows } = await pool.query(
    `SELECT si.*, p.name AS product_name, p.unit AS unit_name
       FROM sale_items si
       LEFT JOIN products p ON p.id = si.product_id
      WHERE si.sale_id = $1
      ORDER BY si.id`,
    [row.id]
  );

  const items = itemRows.map((item) => ({
    id: item.id,
    product_id: item.product_id,
    product_name: item.product_name || "Item",
    qty: Number(item.qty) || 0,
    unit: item.unit_name || "",
    unit_price: Number(item.unit_price) || 0,
    line_total: round2((Number(item.unit_price) || 0) * (Number(item.qty) || 0))
  }));
  const subtotal = round2(items.reduce((a, it) => a + it.line_total, 0));
  const total = round2(row.total);
  const deliveryFee = Math.max(0, round2(total - subtotal));

  return {
    id: row.id,
    invoice_no: row.invoice_no,
    order_no: row.invoice_no,
    created_at: row.created_at,
    status: row.status,
    paid: Number(row.paid) || 0,
    customer_name: row.online_customer_name || row.customer_record_name || "Online customer",
    customer_phone: row.online_customer_phone || "",
    delivery_type: row.online_delivery_type || "delivery",
    address: row.online_address || "",
    note: row.note || "",
    subtotal,
    delivery_fee: deliveryFee,
    total,
    items
  };
}

export function register(app) {
  router.get("/health", (_req, res) => res.json({ ok: true }));

  router.get(
    "/store-info",
    h(async (_req, res) => {
      res.json(await storeSettings());
    })
  );

  router.get(
    "/products",
    h(async (req, res) => {
      const q = String(req.query.q || "").trim();
      const categoryId = req.query.category_id ? Number(req.query.category_id) : null;
      const params = [];
      let where = `WHERE p.online = TRUE AND ${AVAILABLE_STOCK_SQL} > 0`;
      if (q) {
        params.push(`%${q}%`);
        where += ` AND (p.name ILIKE $${params.length} OR p.sku ILIKE $${params.length}
                        OR p.hsn_code ILIKE $${params.length} OR c.name ILIKE $${params.length})`;
      }
      if (categoryId) {
        params.push(categoryId);
        where += ` AND p.category_id = $${params.length}`;
      }
      const { rows } = await pool.query(
        `${PRODUCT_SELECT} ${where} ORDER BY p.name LIMIT 2000`,
        params
      );
      res.json(rows.map(productToClient));
    })
  );

  router.get(
    "/products/:id",
    h(async (req, res) => {
      const { rows } = await pool.query(
        `${PRODUCT_SELECT} WHERE p.id = $1 AND p.online = TRUE AND ${AVAILABLE_STOCK_SQL} > 0`,
        [Number(req.params.id)]
      );
      if (rows.length === 0) return res.status(404).json({ error: "Product not found" });
      res.json(productToClient(rows[0]));
    })
  );

  router.get(
    "/categories",
    h(async (_req, res) => {
      const { rows } = await pool.query(
        `SELECT DISTINCT c.id, c.name
         FROM categories c
         JOIN products p ON p.category_id = c.id AND p.online = TRUE
         LEFT JOIN LATERAL (
           SELECT SUM(pp.remaining) AS total_stock
           FROM product_packs pp WHERE pp.product_id = p.id
         ) packs ON TRUE
         WHERE ${AVAILABLE_STOCK_SQL} > 0
         ORDER BY c.name`
      );
      res.json(rows);
    })
  );

  router.post(
    "/orders/lookup",
    h(async (req, res) => {
      const invoice = String(req.body?.invoice_no || "").trim();
      const phone = String(req.body?.phone || "").trim();
      if (!invoice || !phone) {
        return res.status(400).json({ error: "Enter your invoice number and phone number." });
      }
      const order = await findOnlineOrder(invoice, phone);
      if (!order) {
        return res.status(404).json({
          error: "No order found for that invoice number and phone. Check both and try again."
        });
      }
      const store = await storeSettings();
      const text = buildWhatsAppText(store, order, order.items);
      const whatsappUrl = `https://wa.me/${normalizePhone(
        store.whatsappNumber || store.phone
      )}?text=${encodeURIComponent(text)}`;
      res.set("Cache-Control", "no-store");
      res.json({ order, whatsappUrl });
    })
  );

  router.post(
    "/orders",
    h(async (req, res) => {
      const result = await createOrder(req.body || {});
      if (result.error) return res.status(result.status || 400).json({ error: result.error });
      res.set("Cache-Control", "no-store");
      res.status(201).json({ order: result.order, whatsappUrl: result.whatsappUrl });
    })
  );

  app.use("/api", router);
}
