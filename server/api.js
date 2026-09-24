import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { streamSqlBackup, streamExcelBackup } from "./backup.js";

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
  fs.writeFileSync(path.join(UPLOADS_DIR, name), buf);
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
  fs.writeFileSync(path.join(dir, name), buf);
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

const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

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

  router.get("/backup/sql", h(async (_req, res) => await streamSqlBackup(pool, res)));
  router.get("/backup/excel", h(async (_req, res) => await streamExcelBackup(pool, res)));

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
        monthExpenseRow,
        stockRow,
        retailRow,
        lowStock,
        outstandingRow,
        counts,
        assetsRow
      ] = await Promise.all([
        pool.query(
          "SELECT COALESCE(SUM(total),0) AS total, COALESCE(SUM(paid),0) AS paid FROM sales WHERE created_at::date = $1::date",
          [day]
        ).then((r) => r.rows[0]),
        pool.query("SELECT COALESCE(SUM(total),0) AS total FROM sales WHERE created_at::date = $1::date", [yestStr]).then((r) => r.rows[0]),
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
        pool.query("SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE date >= $1::date", [month]).then((r) => r.rows[0].total),
        pool.query(`SELECT COALESCE(SUM(COALESCE(ss.total_stock, 0) * COALESCE(lp.purchase_price, p.purchase_price)),0) AS total FROM products p LEFT JOIN LATERAL (SELECT spi.purchase_price FROM supplier_purchase_items spi WHERE spi.product_id = p.id ORDER BY spi.created_at DESC LIMIT 1) lp ON true LEFT JOIN LATERAL (SELECT COALESCE(SUM(pp.remaining), 0) AS total_stock FROM product_packs pp WHERE pp.product_id = p.id) ss ON true`).then((r) => r.rows[0].total),
        pool.query(`SELECT COALESCE(SUM(COALESCE(ss.total_stock, 0) * p.selling_price),0) AS total FROM products p LEFT JOIN LATERAL (SELECT COALESCE(SUM(pp.remaining), 0) AS total_stock FROM product_packs pp WHERE pp.product_id = p.id) ss ON true`).then((r) => r.rows[0].total),
        pool
          .query(
            `SELECT p.id, p.name, p.unit, COALESCE(ss.total_stock, 0) AS stock, p.reorder_level, c.name AS category, p.selling_price
             FROM products p LEFT JOIN categories c ON c.id = p.category_id
             LEFT JOIN LATERAL (SELECT COALESCE(SUM(pp.remaining), 0) AS total_stock FROM product_packs pp WHERE pp.product_id = p.id) ss ON true
             WHERE COALESCE(ss.total_stock, 0) <= p.reorder_level
             ORDER BY (COALESCE(ss.total_stock, 0) / (p.reorder_level + 0.0001)) ASC`
          )
          .then((r) => r.rows),
        pool.query("SELECT COALESCE(SUM(total - paid),0) AS total FROM sales WHERE total > paid").then((r) => r.rows[0].total),
        Promise.all([
          pool.query("SELECT COUNT(*) AS c FROM customers").then((r) => r.rows[0].c),
          pool.query("SELECT COUNT(*) AS c FROM suppliers").then((r) => r.rows[0].c),
          pool.query("SELECT COUNT(*) AS c FROM products").then((r) => r.rows[0].c),
          pool.query("SELECT COUNT(*) AS c FROM assets").then((r) => r.rows[0].c)
        ]).then(([customers, suppliers, products, assets]) => ({ customers, suppliers, products, assets })),
        pool.query("SELECT COALESCE(SUM(current_value),0) AS total FROM assets").then((r) => r.rows[0].total)
      ]);

      const last30 = [];
      for (let i = 29; i >= 0; i--) last30.push(addDays(-i));

      const [revenueRows, expenseRows] = await Promise.all([
        pool.query(
          `SELECT to_char(created_at::date, 'YYYY-MM-DD') AS day, SUM(total) AS revenue
           FROM sales WHERE created_at::date = ANY($1::date[]) GROUP BY 1`,
          [last30]
        ).then((r) => r.rows),
        pool.query(
          `SELECT to_char(date::date, 'YYYY-MM-DD') AS day, SUM(amount) AS amount
           FROM expenses WHERE date::date = ANY($1::date[]) GROUP BY 1`,
          [last30]
        ).then((r) => r.rows)
      ]);

      const revMap = Object.fromEntries(revenueRows.map((r) => [r.day, r.revenue]));
      const expMap = Object.fromEntries(expenseRows.map((r) => [r.day, r.amount]));
      const revenueSeries = last30.map((d) => ({
        day: d.slice(5),
        revenue: Math.round(revMap[d] || 0),
        expenses: Math.round(expMap[d] || 0)
      }));

      const categorySales = (
        await pool.query(
          `SELECT COALESCE(c.name, 'Other') AS category, SUM(si.qty * si.unit_price) AS value
           FROM sale_items si
           JOIN products p ON p.id = si.product_id
           LEFT JOIN categories c ON c.id = p.category_id
           JOIN sales s ON s.id = si.sale_id
           WHERE to_char(s.created_at, 'YYYY-MM') = $1
           GROUP BY 1 ORDER BY value DESC`,
          [day.slice(0, 7)]
        )
      ).rows;

      const topProducts = (
        await pool.query(
          `SELECT p.name, COALESCE(c.name, 'Other') AS category, SUM(si.qty) AS qty,
                  SUM(si.qty * si.unit_price) AS revenue
           FROM sale_items si
           JOIN sales s ON s.id = si.sale_id
           JOIN products p ON p.id = si.product_id
           LEFT JOIN categories c ON c.id = p.category_id
           WHERE to_char(s.created_at, 'YYYY-MM') = $1
           GROUP BY p.id, p.name, c.name ORDER BY qty DESC LIMIT 6`,
          [day.slice(0, 7)]
        )
      ).rows.map((r) => ({ ...r, qty: Math.round(r.qty), revenue: Math.round(r.revenue) }));

      const recentSales = (
        await pool.query(
          `SELECT s.id, s.invoice_no, s.total, s.status, s.payment_method, s.created_at,
                  COALESCE(cu.name, 'Walk-in') AS customer
           FROM sales s LEFT JOIN customers cu ON cu.id = s.customer_id
           ORDER BY s.created_at DESC LIMIT 8`
        )
      ).rows;

      const recentExpenses = (
        await pool.query(
          "SELECT id, category, amount, description, payment_method, date FROM expenses ORDER BY date DESC LIMIT 6"
        )
      ).rows;

      res.json({
        kpis: {
          todaySales: Math.round(todaySales.total),
          todaySalesPaid: Math.round(todaySales.paid),
          yestSales: Math.round(yestSales.total),
          monthSales: Math.round(monthSales.total),
          monthProfit: Math.round((Number(monthProfitRow) || 0) - (Number(monthDiscountRow) || 0)),
          monthCost: Math.round(monthCost),
          monthExpenses: Math.round(monthExpenseRow),
          monthPaid: Math.round(monthSales.paid),
          stockValue: Math.round(stockRow),
          retailValue: Math.round(retailRow),
          lowStockCount: lowStock.length,
          outstanding: Math.round(outstandingRow),
          assetsValue: Math.round(assetsRow)
        },
        counts,
        lowStock,
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
                              WHERE sv.created_at >= $1::date AND sv.created_at < $2::date),0) AS profit,
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
          `SELECT to_char(date::date, 'YYYY-MM-DD') AS day, SUM(COALESCE(amount,0)) AS v
           FROM expenses WHERE date >= $1::date AND date < $2::date GROUP BY 1`,
          [from, endExcl]
        )
      ]);

      const mkMap = (rows) => Object.fromEntries(rows.map((r) => [r.day, Number(r.v) || 0]));
      const revMap = mkMap(dailyRev.rows);
      const profMap = mkMap(dailyProfit.rows);
      const expMap = mkMap(dailyExp.rows);

      const series = days.map((day) => ({
        day: day.slice(5),
        revenue: Math.round(revMap[day] || 0),
        profit: Math.round(profMap[day] || 0),
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
    h(async (_req, res) => {
      const { rows } = await pool.query(
        `SELECT p.*, c.name AS category, sc.name AS subcategory,
                COALESCE(latest_price.purchase_price, p.purchase_price) AS purchase_price,
                COALESCE(stock_sum.total_stock, 0) AS stock,
                COALESCE(stock_sum.total_stock, 0) * COALESCE(latest_price.purchase_price, p.purchase_price) AS stock_value,
                COALESCE(images.images, '[]') AS images,
                (SELECT COUNT(*) FROM product_packs pp WHERE pp.product_id = p.id AND pp.status <> 'empty') AS open_packs,
                (SELECT COALESCE(SUM(pp.remaining),0) FROM product_packs pp WHERE pp.product_id = p.id AND pp.status <> 'empty') AS pack_remaining
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
         ORDER BY p.name`
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
                COALESCE(images.images, '[]') AS images
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
               market_price = $14
             WHERE id = $15`,
            [
              name, b.sku || null, b.category_id || null, b.subcategory_id || null,
              b.unit || "pcs", b.unit_id || null,
              Number(b.selling_price) || 0, Number(b.reorder_level) || 0,
              b.hsn_code || null, Number(b.discount) || 0, Number(b.tax) || 0,
              b.expiry_date || null, b.description || null,
              Number(b.market_price) || 0, id
            ]
          );
          return res.json({ id, updated: true });
        }
        const { rows } = await pool.query(
          `INSERT INTO products (name, sku, category_id, subcategory_id, unit, unit_id, purchase_price, selling_price, stock, reorder_level, hsn_code, discount, tax, expiry_date, description, market_price)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
          [
            name, b.sku || null, b.category_id || null, b.subcategory_id || null,
            b.unit || "pcs", b.unit_id || null,
            0, Number(b.selling_price) || 0,
            0, Number(b.reorder_level) || 0,
            b.hsn_code || null, Number(b.discount) || 0, Number(b.tax) || 0,
            b.expiry_date || null, b.description || null,
            Number(b.market_price) || 0
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
             market_price = $14
           WHERE id = $15`,
          [
            b.name, b.sku || null, b.category_id || null, b.subcategory_id || null,
            b.unit || "pcs", b.unit_id || null,
            Number(b.selling_price) || 0, Number(b.reorder_level) || 0,
            b.hsn_code || null, Number(b.discount) || 0, Number(b.tax) || 0,
            b.expiry_date || null, b.description || null,
            Number(b.market_price) || 0, req.params.id
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
  router.get(
    "/sales",
    h(async (_req, res) => {
      const { rows } = await pool.query(
        `SELECT s.*, COALESCE(cu.name, 'Walk-in') AS customer, cu.phone AS customer_phone,
                (SELECT COALESCE(SUM(si.profit),0) FROM sale_items si WHERE si.sale_id = s.id)
                  - (SELECT COALESCE(SUM(vu.discount_applied),0) FROM voucher_uses vu WHERE vu.bill_id = s.id) AS profit,
                (SELECT COALESCE(string_agg(DISTINCT si.hsn_code, ', ' ORDER BY si.hsn_code), '') FROM sale_items si WHERE si.sale_id = s.id AND si.hsn_code IS NOT NULL) AS hsn_codes,
                (SELECT COALESCE(string_agg(DISTINCT si.tax::text, ', ' ORDER BY si.tax::text), '') FROM sale_items si WHERE si.sale_id = s.id AND COALESCE(si.tax,0) > 0) AS tax_rates,
                (SELECT COALESCE(SUM(si.tax_amt),0) FROM sale_items si WHERE si.sale_id = s.id) AS tax_amt
         FROM sales s LEFT JOIN customers cu ON cu.id = s.customer_id
         ORDER BY s.created_at DESC`
      );
      res.json(rows);
    })
  );

  router.get(
    "/sales/:id",
    h(async (req, res) => {
      const { rows } = await pool.query(
        `SELECT s.*, COALESCE(cu.name, 'Walk-in') AS customer, cu.phone AS customer_phone
         FROM sales s LEFT JOIN customers cu ON cu.id = s.customer_id WHERE s.id = $1`,
        [req.params.id]
      );
      if (rows.length === 0) return res.status(404).json({ error: "Sale not found" });
      const sale = rows[0];
      sale.items = (
        await pool.query(
          `SELECT si.*, p.name AS product_name, p.unit,
                  u.short_name AS unit_name, su.short_name AS sale_unit_name,
                  pp.pack_size, pp.remaining AS pack_remaining, pp.status AS pack_status,
                  pr.name AS pack_supplier
           FROM sale_items si
           JOIN products p ON p.id = si.product_id
           LEFT JOIN measuring_units u ON u.id = si.unit_id
           LEFT JOIN measuring_units su ON su.id = si.unit_id
           LEFT JOIN product_packs pp ON pp.id = si.product_pack_id
           LEFT JOIN supplier_purchases sp ON sp.id = pp.purchase_id
           LEFT JOIN suppliers pr ON pr.id = sp.supplier_id
           WHERE si.sale_id = $1`,
          [sale.id]
        )
      ).rows;
      const totals = sale.items.reduce((acc, it) => {
        acc.profit += Number(it.profit) || 0;
        return acc;
      }, { profit: 0 });
      const { rows: [vuRow] } = await pool.query(
        "SELECT COALESCE(SUM(discount_applied),0) AS d FROM voucher_uses WHERE bill_id = $1",
        [sale.id]
      );
      const voucherDiscount = Number(vuRow.d) || 0;
      sale.total_profit = totals.profit - voucherDiscount;
      sale.voucher_discount = voucherDiscount;
      const { rows: vr } = await pool.query(
        `SELECT v.id, v.code, v.status, v.customer_name, v.issued_at,
                c.id AS campaign_id, c.name AS campaign_name, c.discount_type, c.discount_value,
                c.min_total, c.months, c.start_date AS valid_from, c.end_date
         FROM vouchers v JOIN voucher_campaigns c ON c.id = v.campaign_id
         WHERE v.bill_id = $1 LIMIT 1`,
        [sale.id]
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
      res.json(sale);
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
        for (const it of b.items) {
          const { rows } = await client.query(
            `SELECT p.selling_price, p.stock, p.discount, p.tax, p.hsn_code, p.market_price,
                    COALESCE(
                      (SELECT spi.purchase_price FROM supplier_purchase_items spi
                        WHERE spi.product_id = p.id AND COALESCE(spi.purchase_price, 0) > 0
                        ORDER BY spi.id DESC LIMIT 1),
                      p.purchase_price
                    ) AS unit_cost
             FROM products p WHERE p.id = $1 FOR UPDATE`,
            [it.product_id]
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
                    c.id AS campaign_id, c.name AS campaign_name, c.discount_type, c.discount_value,
                    c.min_total, c.months, c.start_date AS valid_from, c.end_date
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
             AND issued_count < issue_limit
           ORDER BY id ASC
           LIMIT 200 FOR UPDATE`
        );
        let pick = null;
        for (const c of campaignRows) {
          const through = validThroughDate(c);
          if (through && todayStr > through) continue;
          if (!pick || !through || (pick.__through && through < pick.__through)) {
            pick = c;
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
          issue = {
            campaign_id: pick.id,
            campaign_name: pick.name,
            discount_type: pick.discount_type,
            discount_value: Number(pick.discount_value),
            min_total: Number(pick.min_total) || 0,
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
                `INSERT INTO vouchers (campaign_id, code, status, bill_id, customer_name, sale_total)
                 VALUES ($1,$2,'issued',$3,$4,$5)`,
                [issue.campaign_id, code, saleId, issue.customer_name, issue.sale_total]
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
          let packId = it.product_pack_id || null;

          let remainingQty = it.qty;
          while (remainingQty > 0) {
            const { rows: packs } = await client.query(
              "SELECT id, remaining FROM product_packs WHERE product_id = $1 AND status <> 'empty' AND remaining > 0 ORDER BY created_at ASC, id ASC LIMIT 1 FOR UPDATE",
              [it.product_id]
            );
            if (packs.length === 0) break;
            if (!packId) packId = packs[0].id;
            const take = Math.min(Number(packs[0].remaining), remainingQty);
            await client.query(
              `UPDATE product_packs
               SET remaining = remaining - $1,
                   status = CASE
                     WHEN remaining - $1 <= 0 THEN 'empty'
                     WHEN status = 'closed' THEN 'open'
                     ELSE status
                   END,
                   opened_at = CASE WHEN status = 'closed' THEN LOCALTIMESTAMP ELSE opened_at END
               WHERE id = $2`,
              [take, packs[0].id]
            );
            remainingQty = Math.round((remainingQty - take) * 10000) / 10000;
          }

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
      const result = await pool.query(
        "UPDATE sales SET customer_id = $1, payment_method = $2, note = $3 WHERE id = $4",
        [b.customer_id || null, b.payment_method || "cash", b.note || null, req.params.id]
      );
      if (result.rowCount === 0) return res.status(404).json({ error: "Sale not found" });
      res.json({ updated: true });
    })
  );

  router.put(
    "/sales/:id/status",
    h(async (req, res) => {
      const b = req.body || {};
      const { rows } = await pool.query("SELECT total FROM sales WHERE id = $1", [req.params.id]);
      if (rows.length === 0) return res.status(404).json({ error: "Sale not found" });
      const total = Number(rows[0].total);
      const status = b.status || "paid";
      const paid = status === "paid" ? total : Number(b.paid) || 0;
      await pool.query("UPDATE sales SET status = $1, paid = $2 WHERE id = $3", [status, paid, req.params.id]);
      res.json({ updated: true });
    })
  );

  router.delete(
    "/sales/:id",
    h(async (req, res) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows: items } = await client.query(
          "SELECT product_id, qty, product_pack_id FROM sale_items WHERE sale_id = $1",
          [req.params.id]
        );
        const result = await client.query("DELETE FROM sales WHERE id = $1", [req.params.id]);
        if (result.rowCount === 0) {
          await client.query("ROLLBACK");
          return res.status(404).json({ error: "Sale not found" });
        }
        for (const it of items) {
          await client.query("UPDATE products SET stock = stock + $1 WHERE id = $2", [it.qty, it.product_id]);
          let toRestore = Number(it.qty) || 0;
          if (it.product_pack_id && toRestore > 0) {
            const open = await client.query(
              `SELECT id, pack_size, remaining FROM product_packs
               WHERE product_id = $1 AND status <> 'empty' AND remaining < pack_size
               ORDER BY created_at ASC, id ASC`,
              [it.product_id]
            );
            const candidates = open.rows;
            if (!candidates.some((p) => p.id === it.product_pack_id)) {
              candidates.push({ id: it.product_pack_id, pack_size: 1, remaining: 0 });
            }
            for (const pk of candidates) {
              if (toRestore <= 0) break;
              const room = Math.max(0, Number(pk.pack_size) - Number(pk.remaining));
              if (room <= 0) continue;
              const give = Math.min(toRestore, room);
              await client.query(
                `UPDATE product_packs
                 SET remaining = remaining + $1,
                     status = CASE WHEN status = 'empty' THEN 'open' ELSE status END,
                     opened_at = CASE WHEN status = 'empty' THEN LOCALTIMESTAMP ELSE opened_at END
                 WHERE id = $2`,
                [give, pk.id]
              );
              toRestore = Math.round((toRestore - give) * 10000) / 10000;
            }
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

  // ─── Customers ──────────────────────────────────────────────
  router.get(
    "/customers",
    h(async (_req, res) => {
      const { rows } = await pool.query(
        `SELECT c.*,
          (SELECT COUNT(*) FROM sales s WHERE s.customer_id = c.id) AS sales_count,
          (SELECT COALESCE(SUM(s.total - s.paid),0) FROM sales s WHERE s.customer_id = c.id) AS balance
         FROM customers c ORDER BY c.name`
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
        "INSERT INTO customers (name, phone, email, address, credit_limit) VALUES ($1,$2,$3,$4,$5) RETURNING id",
        [b.name, b.phone || null, b.email || null, b.address || null, Number(b.credit_limit) || 0]
      );
      res.status(201).json({ id: rows[0].id, ...b });
    })
  );

  router.put(
    "/customers/:id",
    h(async (req, res) => {
      const b = req.body || {};
      const result = await pool.query(
        "UPDATE customers SET name = $1, phone = $2, email = $3, address = $4, credit_limit = $5 WHERE id = $6",
        [b.name, b.phone, b.email, b.address, Number(b.credit_limit) || 0, req.params.id]
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
            for (let i = 0; i < packCount; i++) {
              await client.query(
                `INSERT INTO product_packs (product_id, purchase_id, pack_size, remaining, status)
                 VALUES ($1, $2, $3, $3, 'closed')`,
                [productId, purchaseId, packSize]
              );
            }
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
            for (let i = 0; i < packCount; i++) {
              await client.query(
                `INSERT INTO product_packs (product_id, purchase_id, pack_size, remaining, status)
                 VALUES ($1, $2, $3, $3, 'closed')`,
                [productId, req.params.id, packSize]
              );
            }
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

  // ─── Expense & Asset Categories ───────────────────────
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
  router.get(
    "/employees",
    h(async (_req, res) => {
      const { rows } = await pool.query(
        `SELECT e.*,
          (SELECT COALESCE(SUM(p.amount),0) FROM employee_payments p WHERE p.employee_id = e.id AND p.type = 'salary') AS salary_paid,
          (SELECT COALESCE(SUM(p.amount),0) FROM employee_payments p WHERE p.employee_id = e.id AND p.type = 'advance') AS advances_paid,
          (SELECT COALESCE(SUM(p.amount),0) FROM employee_payments p WHERE p.employee_id = e.id AND p.type = 'advance_recovery') AS advance_repaid,
          (SELECT COALESCE(SUM(p.amount),0) FROM employee_payments p WHERE p.employee_id = e.id AND p.type = 'advance') - (SELECT COALESCE(SUM(p.amount),0) FROM employee_payments p WHERE p.employee_id = e.id AND p.type = 'advance_recovery') AS advances_pending,
          (SELECT COALESCE(SUM(p.amount),0) FROM employee_payments p WHERE p.employee_id = e.id AND p.type = 'bonus') AS bonuses_paid,
          (SELECT COALESCE(SUM(p.amount),0) FROM employee_payments p WHERE p.employee_id = e.id AND p.type = 'deduction') AS deductions_total,
          (SELECT COUNT(*) FROM attendance a WHERE a.employee_id = e.id AND a.status = 'present') AS days_present
         FROM employees e ORDER BY e.name`
      );
      res.json(rows);
    })
  );

  router.post(
    "/employees",
    h(async (req, res) => {
      const b = req.body || {};
      if (!b.name) return res.status(400).json({ error: "name is required" });
      const { rows } = await pool.query(
        `INSERT INTO employees (name, phone, email, address, designation, salary_type, salary_rate, joining_date, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [
          b.name,
          b.phone || null,
          b.email || null,
          b.address || null,
          b.designation || null,
          b.salary_type || "monthly",
          Number(b.salary_rate) || 0,
          b.joining_date || null,
          b.notes || null
        ]
      );
      res.status(201).json({ id: rows[0].id, ...b });
    })
  );

  router.put(
    "/employees/:id",
    h(async (req, res) => {
      const b = req.body || {};
      const result = await pool.query(
        `UPDATE employees SET name = $1, phone = $2, email = $3, address = $4, designation = $5,
           salary_type = $6, salary_rate = $7, joining_date = $8, notes = $9
         WHERE id = $10`,
        [
          b.name,
          b.phone || null,
          b.email || null,
          b.address || null,
          b.designation || null,
          b.salary_type || "monthly",
          Number(b.salary_rate) || 0,
          b.joining_date || null,
          b.notes || null,
          req.params.id
        ]
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
      if (!b.employee_id || !b.date) return res.status(400).json({ error: "employee_id and date are required" });
      const { rows } = await pool.query(
        `INSERT INTO attendance (employee_id, date, time_in, time_out, status, notes)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (employee_id, date)
         DO UPDATE SET time_in = EXCLUDED.time_in, time_out = EXCLUDED.time_out,
           status = EXCLUDED.status, notes = EXCLUDED.notes
         RETURNING id`,
        [b.employee_id, b.date, b.time_in || null, b.time_out || null, b.status || "present", b.notes || null]
      );
      res.status(201).json({ id: rows[0].id, updated: true });
    })
  );

  router.put(
    "/attendance/:id",
    h(async (req, res) => {
      const b = req.body || {};
      const result = await pool.query(
        `UPDATE attendance SET time_in = $1, time_out = $2, status = $3, notes = $4 WHERE id = $5`,
        [b.time_in || null, b.time_out || null, b.status || "present", b.notes || null, req.params.id]
      );
      if (result.rowCount === 0) return res.status(404).json({ error: "Attendance not found" });
      res.json({ updated: true });
    })
  );

  router.delete(
    "/attendance/:id",
    h(async (req, res) => {
      const result = await pool.query("DELETE FROM attendance WHERE id = $1", [req.params.id]);
      if (result.rowCount === 0) return res.status(404).json({ error: "Attendance not found" });
      res.json({ deleted: true });
    })
  );

  // ─── Employee payments (salary / advance / bonus / deduction) ──
  router.get(
    "/employees/:id/payments",
    h(async (req, res) => {
      const { rows } = await pool.query(
        `SELECT p.*, e.name AS employee_name
         FROM employee_payments p JOIN employees e ON e.id = p.employee_id
         WHERE p.employee_id = $1
         ORDER BY p.date DESC, p.id DESC`,
        [req.params.id]
      );
      res.json(rows);
    })
  );

  router.post(
    "/employees/:id/payments",
    h(async (req, res) => {
      const b = req.body || {};
      if (!b.amount) return res.status(400).json({ error: "amount is required" });
      const { rows } = await pool.query(
        `INSERT INTO employee_payments (employee_id, type, amount, payment_method, note, date)
         VALUES ($1,$2,$3,$4,$5, COALESCE($6::timestamp, LOCALTIMESTAMP)) RETURNING id`,
        [
          req.params.id,
          b.type || "salary",
          Number(b.amount) || 0,
          b.payment_method || "cash",
          b.note || null,
          b.date || null
        ]
      );
      res.status(201).json({ id: rows[0].id, ...b });
    })
  );

  router.get(
    "/payments",
    h(async (req, res) => {
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
    })
  );

  router.delete(
    "/payments/:id",
    h(async (req, res) => {
      const result = await pool.query("DELETE FROM employee_payments WHERE id = $1", [req.params.id]);
      if (result.rowCount === 0) return res.status(404).json({ error: "Payment not found" });
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
      const discountType = b.discount_type === "percent" ? "percent" : "rupee";
      const discountValue = Number(b.discount_value) || 0;
      if (discountValue <= 0) return res.status(400).json({ error: "Discount value must be greater than zero" });
      const minTotal = Math.max(0, Number(b.min_total) || 0);
      const months = Number(b.months) != null ? Math.round(Number(b.months)) : 5;
      if (Number.isNaN(months) || months < 1 || months > 24) {
        return res.status(400).json({ error: "Months must be between 1 and 24" });
      }
      if (b.start_date && b.end_date && b.start_date > b.end_date) {
        return res.status(400).json({ error: "Start date must be before end date" });
      }
      const { rows } = await pool.query(
        `INSERT INTO voucher_campaigns (name, discount_type, discount_value, quantity, issue_limit, min_total, months, start_date, end_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [
          name,
          discountType,
          discountValue,
          Math.max(0, Number(b.quantity) || 0),
          Math.max(0, Number(b.issue_limit) || 0),
          minTotal,
          months,
          b.start_date || null,
          b.end_date || null
        ]
      );
      res.status(201).json(rows[0]);
    })
  );

  router.put(
    "/voucher-campaigns/:id",
    h(async (req, res) => {
      const b = req.body || {};
      const result = await pool.query(
        `UPDATE voucher_campaigns
           SET name = COALESCE($2, name),
               discount_type = $3,
               discount_value = COALESCE($4, discount_value),
               quantity = COALESCE($5, quantity),
               issue_limit = COALESCE($6, issue_limit),
               min_total = COALESCE($7, min_total),
               months = COALESCE($8, months),
               start_date = COALESCE($9, start_date),
               end_date = COALESCE($10, end_date)
         WHERE id = $1::int`,
        [
          req.params.id,
          b.name != null ? String(b.name).trim() || null : null,
          b.discount_type === "percent" ? "percent" : b.discount_type === "rupee" ? "rupee" : null,
          b.discount_value != null ? Number(b.discount_value) : null,
          b.quantity != null ? Math.max(0, Number(b.quantity)) : null,
          b.issue_limit != null ? Math.max(0, Number(b.issue_limit)) : null,
          b.min_total != null ? Math.max(0, Number(b.min_total)) : null,
          b.months != null ? Math.round(Number(b.months)) : null,
          b.start_date || null,
          b.end_date || null
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
                c.id AS campaign_id, c.name AS campaign_name, c.discount_type, c.discount_value,
                c.min_total, c.months, c.start_date AS valid_from, c.end_date
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
          params.push("issued");
          where += ` AND v.status = 'issued'`;
        } else {
          where += ` AND v.status IN ('used','redeemed')`;
        }
      }
      const { rows } = await pool.query(
        `SELECT v.*, c.name AS campaign_name, c.discount_type, c.discount_value, c.min_total,
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

  router.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: err.message || "Internal server error" });
  });

  app.use("/api", router);
}
