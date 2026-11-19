import crypto from "node:crypto";
import { recalcSaleProfits } from "./db.js";

// Two-way sync between the offline phone app and this Postgres database.
//
// The phone speaks in its own table/column names; this module translates to the
// server schema. Every synced row carries a stable `sync_id` plus an
// `updated_at`, and a trigger records each insert/update/delete in
// `sync_changes`. A phone keeps a cursor into that log, so it only receives
// changes it has not seen yet.
//
// Conflict rule: the server wins. A phone sends the `updated_at` it last saw for
// a row as `base_updated_at`. If the server row has moved on since then, the
// phone change is rejected and both copies are written to `sync_conflicts` for
// review under Settings -> Sync.

const f = (name) => [name, name];

const SPECS = [
  {
    table: "store_info",
    mobile: "store_info",
    order: 1,
    singleton: true,
    fields: [
      f("name"), f("address"), f("phone"), f("logo"), f("qr_code"), f("tax_no"),
      f("bank_holder"), f("bank_name"), f("bank_account_no"), f("ifsc"), f("upi_id"),
      f("footer_text"), f("tagline"), f("whatsapp_number"), f("delivery_fee"),
      f("online_store_enabled"), f("online_store_url"), f("action_password"),
      f("action_password_enabled"), f("printer_name"), f("printer_address"), f("paper_width_mm")
    ],
    addColumns: [
      "ALTER TABLE store_info ADD COLUMN IF NOT EXISTS printer_name TEXT DEFAULT ''",
      "ALTER TABLE store_info ADD COLUMN IF NOT EXISTS printer_address TEXT DEFAULT ''",
      "ALTER TABLE store_info ADD COLUMN IF NOT EXISTS paper_width_mm INTEGER NOT NULL DEFAULT 58"
    ]
  },
  {
    table: "categories",
    mobile: "categories",
    order: 10,
    fields: [f("name"), f("description"), f("quality_stars"), f("created_at")]
  },
  {
    table: "subcategories",
    mobile: "subcategories",
    order: 11,
    fields: [f("category_id"), f("name"), f("quality_stars"), f("created_at")],
    refs: { category_id: "categories" },
    addColumns: ["ALTER TABLE subcategories ADD COLUMN IF NOT EXISTS quality_stars INTEGER NOT NULL DEFAULT 0"]
  },
  {
    table: "measuring_units",
    mobile: "measuring_units",
    order: 12,
    fields: [f("name"), f("short_name"), f("category"), f("conversion_factor"), f("created_at")]
  },
  {
    table: "weight_barcodes",
    mobile: "weight_barcodes",
    order: 13,
    fields: [f("weight_g"), f("barcode"), f("copies"), f("created_at")]
  },
  {
    table: "customer_categories",
    mobile: "customer_categories",
    order: 13,
    fields: [f("name"), f("created_at")]
  },
  {
    table: "products",
    mobile: "products",
    order: 20,
    fields: [
      f("name"), f("sku"), f("barcode"), f("unit"), f("unit_id"), f("category_id"),
      f("subcategory_id"), f("selling_price"), f("market_price"), f("purchase_price"),
      f("tax"), f("discount"), f("hsn_code"), f("description"), f("reorder_level"),
      f("stock"), f("online"), f("oversold_qty"), f("created_at")
    ],
    refs: {
      category_id: "categories",
      subcategory_id: "subcategories",
      unit_id: "measuring_units"
    }
  },
  {
    table: "product_images",
    mobile: "product_images",
    order: 21,
    fields: [f("product_id"), f("url"), f("sort_order"), f("created_at")],
    refs: { product_id: "products" }
  },
  {
    table: "customers",
    mobile: "customers",
    order: 22,
    fields: [f("name"), f("phone"), f("email"), f("address"), f("credit_limit"), f("category_id"), f("notes"), f("barcode"), f("created_at")],
    refs: { category_id: "customer_categories" },
    addColumns: ["ALTER TABLE customers ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT ''"]
  },
  {
    table: "customer_prices",
    mobile: "customer_prices",
    order: 23,
    fields: [["product_id", "product_id"], ["customer_category_id", "category_id"], ["price", "selling_price"], f("created_at")],
    refs: { product_id: "products", customer_category_id: "customer_categories" },
    addColumns: ["ALTER TABLE customer_prices ADD COLUMN IF NOT EXISTS id BIGSERIAL"]
  },
  {
    table: "suppliers",
    mobile: "suppliers",
    order: 24,
    fields: [
      f("name"), ["company", "company_name"], ["contact_person", "contact_person"],
      f("phone"), f("email"), f("address"), ["notes", "detail"], ["products_sold", "products_sold"], f("created_at")
    ],
    addColumns: [
      "ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS contact_person TEXT DEFAULT ''",
      "ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS products_sold TEXT DEFAULT ''"
    ]
  },
  {
    table: "supplier_purchases",
    mobile: "supplier_purchases",
    order: 30,
    fields: [
      f("supplier_id"), f("invoice_no"), f("purchased_at"), f("due_date"), f("subtotal"),
      f("discount"), f("tax"), f("additional_charges"), ["total", "grand_total"],
      ["paid", "paid_amount"], f("payment_method"), f("bill_image"), f("notes"), f("created_at")
    ],
    refs: { supplier_id: "suppliers" },
    addColumns: [
      "ALTER TABLE supplier_purchases ADD COLUMN IF NOT EXISTS invoice_no TEXT DEFAULT ''",
      "ALTER TABLE supplier_purchases ADD COLUMN IF NOT EXISTS subtotal NUMERIC(14,2) NOT NULL DEFAULT 0",
      "ALTER TABLE supplier_purchases ADD COLUMN IF NOT EXISTS discount NUMERIC(14,2) NOT NULL DEFAULT 0",
      "ALTER TABLE supplier_purchases ADD COLUMN IF NOT EXISTS tax NUMERIC(14,2) NOT NULL DEFAULT 0",
      "ALTER TABLE supplier_purchases ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20) DEFAULT 'cash'",
      "ALTER TABLE supplier_purchases ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT ''"
    ]
  },
  {
    table: "supplier_purchase_items",
    mobile: "supplier_purchase_items",
    order: 31,
    fields: [
      f("purchase_id"), f("product_id"), f("item_name"), f("hsn_code"), ["qty", "quantity"],
      f("unit"), f("purchase_price"), f("selling_price"), f("pack_size"), f("pack_sub_unit"),
      f("pack_price"), f("discount"), f("tax"), f("line_total"), f("created_at")
    ],
    refs: { purchase_id: "supplier_purchases", product_id: "products", unit_id: "measuring_units" },
    addColumns: [
      "ALTER TABLE supplier_purchase_items ADD COLUMN IF NOT EXISTS unit TEXT DEFAULT 'pcs'",
      "ALTER TABLE supplier_purchase_items ADD COLUMN IF NOT EXISTS line_total NUMERIC(14,2) NOT NULL DEFAULT 0"
    ]
  },
  {
    table: "product_packs",
    mobile: "product_packs",
    order: 32,
    fields: [f("product_id"), f("purchase_id"), ["qty", "pack_size"], f("remaining"), f("unit_cost"), f("status"), f("opened_at"), f("created_at")],
    refs: { product_id: "products", purchase_id: "supplier_purchases" },
    addColumns: ["ALTER TABLE product_packs ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(14,2) NOT NULL DEFAULT 0"]
  },
  {
    table: "sales",
    mobile: "sales",
    order: 40,
    fields: [
      f("invoice_no"), f("customer_id"), f("customer_name"), f("customer_phone"),
      f("subtotal"), f("discount"), f("tax"), f("total"), f("paid"), f("status"),
      f("payment_method"), f("note"), f("channel"), f("online_customer_name"),
      f("online_customer_phone"), f("online_delivery_type"), f("online_address"),
      f("voucher_id"), f("bill_image"), f("created_at")
    ],
    refs: { customer_id: "customers", voucher_id: "vouchers" },
    addColumns: [
      "ALTER TABLE sales ADD COLUMN IF NOT EXISTS subtotal NUMERIC(14,2) NOT NULL DEFAULT 0",
      "ALTER TABLE sales ADD COLUMN IF NOT EXISTS discount NUMERIC(14,2) NOT NULL DEFAULT 0",
      "ALTER TABLE sales ADD COLUMN IF NOT EXISTS tax NUMERIC(14,2) NOT NULL DEFAULT 0",
      "ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_name TEXT DEFAULT ''",
      "ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_phone TEXT DEFAULT ''",
      "ALTER TABLE sales ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'counter'",
      "ALTER TABLE sales ADD COLUMN IF NOT EXISTS online_customer_name TEXT DEFAULT ''",
      "ALTER TABLE sales ADD COLUMN IF NOT EXISTS online_customer_phone TEXT DEFAULT ''",
      "ALTER TABLE sales ADD COLUMN IF NOT EXISTS online_delivery_type TEXT DEFAULT ''",
      "ALTER TABLE sales ADD COLUMN IF NOT EXISTS online_address TEXT DEFAULT ''",
      "ALTER TABLE sales ADD COLUMN IF NOT EXISTS voucher_id INTEGER",
      "ALTER TABLE sales ADD COLUMN IF NOT EXISTS bill_image TEXT DEFAULT ''"
    ]
  },
  {
    table: "sale_items",
    mobile: "sale_items",
    order: 41,
    fields: [
      f("sale_id"), f("product_id"), f("product_pack_id"), f("product_name"), f("qty"),
      f("unit_price"), f("market_price"), f("unit_id"), f("unit_name"), f("conversion_factor"),
      f("purchase_price"), f("profit"), f("hsn_code"), f("tax"), f("tax_amt"), f("line_total"),
      f("oversold_qty")
    ],
    refs: { sale_id: "sales", product_id: "products", product_pack_id: "product_packs", unit_id: "measuring_units" },
    addColumns: [
      "ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS product_name TEXT DEFAULT ''",
      "ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS unit_name TEXT DEFAULT ''",
      "ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS line_total NUMERIC(14,2) NOT NULL DEFAULT 0"
    ]
  },
  {
    table: "sale_returns",
    mobile: "sale_returns",
    order: 42,
    fields: [f("sale_id"), f("invoice_no"), f("customer"), ["amount", "total_refund"], f("profit"), f("reason"), f("created_at")],
    refs: { sale_id: "sales" }
  },
  {
    table: "sale_return_items",
    mobile: "sale_return_items",
    order: 43,
    fields: [
      f("return_id"), f("sale_item_id"), f("product_id"), f("product_name"), f("unit_name"),
      f("qty"), f("unit_price"), ["line_total", "refund_amount"]
    ],
    refs: { return_id: "sale_returns", sale_item_id: "sale_items", product_id: "products" },
    addColumns: [
      "ALTER TABLE sale_return_items ADD COLUMN IF NOT EXISTS product_name VARCHAR(300)",
      "ALTER TABLE sale_return_items ADD COLUMN IF NOT EXISTS unit_name VARCHAR(20)",
      "ALTER TABLE sale_return_items ADD COLUMN IF NOT EXISTS line_total NUMERIC(14,2) NOT NULL DEFAULT 0"
    ]
  },
  {
    table: "customer_payments",
    mobile: "customer_payments",
    order: 44,
    fields: [f("sale_id"), f("customer_id"), f("invoice_no"), f("customer"), f("amount"), ["method", "method"], f("paid_on"), f("note"), f("created_at")],
    refs: { sale_id: "sales", customer_id: "customers" }
  },
  {
    table: "stock_removals",
    mobile: "stock_removals",
    order: 45,
    fields: [
      f("product_id"), f("product_name"), f("qty"), f("unit_cost"), f("value"),
      f("reason"), f("note"), f("created_at")
    ],
    refs: { product_id: "products" },
    addColumns: [
      "ALTER TABLE stock_removals ADD COLUMN IF NOT EXISTS product_id INTEGER",
      "ALTER TABLE stock_removals ADD COLUMN IF NOT EXISTS product_name VARCHAR(300)",
      "ALTER TABLE stock_removals ADD COLUMN IF NOT EXISTS qty NUMERIC(14,2) NOT NULL DEFAULT 0",
      "ALTER TABLE stock_removals ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(14,2) NOT NULL DEFAULT 0",
      "ALTER TABLE stock_removals ADD COLUMN IF NOT EXISTS value NUMERIC(14,2) NOT NULL DEFAULT 0"
    ],
    toServer: (row) => ({ ...row, total_qty: row.qty, total_value: row.value }),
    toMobile: (row) => ({ ...row, qty: row.qty || row.total_qty, value: row.value || row.total_value })
  },
  {
    table: "expense_categories",
    mobile: "expense_categories",
    order: 50,
    fields: [f("name"), f("created_at")]
  },
  {
    table: "expenses",
    mobile: "expenses",
    order: 51,
    fields: [f("category_id"), f("category"), f("amount"), ["method", "payment_method"], ["note", "description"], f("date"), f("created_at")],
    refs: { category_id: "expense_categories" },
    addColumns: [
      "ALTER TABLE expenses ADD COLUMN IF NOT EXISTS category_id INTEGER",
      "ALTER TABLE expenses ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT LOCALTIMESTAMP"
    ]
  },
  {
    table: "non_sale_inventory",
    mobile: "non_sale_inventory",
    order: 52,
    fields: [
      f("name"), f("size"), f("unit"), ["qty", "quantity_purchased"], ["remaining", "stock_remaining"],
      ["amount", "amount_per_unit"], f("purchase_date"), f("notes"), f("created_at")
    ],
    addColumns: ["ALTER TABLE non_sale_inventory ADD COLUMN IF NOT EXISTS purchase_date DATE"],
    toServer: (row) => ({ ...row, total_amount: (Number(row.qty) || 0) * (Number(row.amount) || 0) })
  },
  {
    table: "asset_categories",
    mobile: "asset_categories",
    order: 53,
    fields: [f("name"), f("created_at")]
  },
  {
    table: "assets",
    mobile: "assets",
    order: 54,
    fields: [f("name"), f("category"), f("purchase_date"), ["cost", "purchase_cost"], f("current_value"), f("condition"), f("location"), ["notes", "note"], f("created_at")],
    addColumns: ["ALTER TABLE assets ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT LOCALTIMESTAMP"]
  },
  {
    table: "cheques",
    mobile: "cheques",
    order: 55,
    fields: [f("cheque_no"), f("bank_name"), f("drawer_name"), f("payee"), f("amount"), ["cheque_date", "issue_date"], f("clearing_date"), f("status"), f("supplier_id"), f("customer_id"), f("notes"), f("created_at")],
    refs: { supplier_id: "suppliers", customer_id: "customers" }
  },
  {
    table: "tasks",
    mobile: "tasks",
    order: 56,
    fields: [f("title"), f("description"), f("assigned_to"), f("priority"), f("status"), f("due_date"), f("created_at"), f("completed_at")],
    refs: { assigned_to: "employees" }
  },
  {
    table: "call_notes",
    mobile: "call_notes",
    order: 57,
    fields: [
      f("contact_type"), f("customer_id"), f("supplier_id"), f("contact_name"), f("phone"),
      f("subject"), ["note", "note"], f("call_back_at"), f("priority"), f("status"),
      f("called_at"), f("created_at")
    ],
    refs: { customer_id: "customers", supplier_id: "suppliers" }
  },
  {
    table: "business_document_categories",
    mobile: "business_document_categories",
    order: 60,
    fields: [f("name"), f("created_at")]
  },
  {
    table: "business_documents",
    mobile: "business_documents",
    order: 61,
    fields: [f("name"), f("category"), f("file_path"), f("file_type"), f("file_size"), f("notes"), ["created_at", "uploaded_at"]]
  },
  {
    table: "employees",
    mobile: "employees",
    order: 70,
    fields: [
      f("name"), f("phone"), f("email"), f("address"), f("role"), f("designation"),
      f("salary_type"), f("salary_rate"), f("starting_date"), f("joining_date"), f("rank"),
      f("stars"), f("shift_start"), f("shift_end"), f("pf_enabled"), f("pf_rate"),
      f("status"), f("last_working_date"), f("bank_name"), f("bank_account_no"),
      f("bank_ifsc"), f("upi_id"), f("date_of_birth"), f("emergency_contact_name"),
      f("emergency_contact_phone"), f("id_proof_type"), f("id_proof_number"),
      f("photo_path"), f("notes"), f("created_at")
    ],
    addColumns: ["ALTER TABLE employees ADD COLUMN IF NOT EXISTS role TEXT DEFAULT ''"]
  },
  {
    table: "attendance",
    mobile: "employee_attendance",
    order: 71,
    fields: [f("employee_id"), f("date"), f("status"), f("time_in"), f("time_out"), f("notes"), f("created_at")],
    refs: { employee_id: "employees" }
  },
  {
    table: "employee_payments",
    mobile: "employee_payments",
    order: 72,
    fields: [f("employee_id"), f("type"), f("amount"), f("date"), ["method", "payment_method"], ["notes", "note"], f("created_at")],
    refs: { employee_id: "employees" }
  },
  {
    table: "employee_documents",
    mobile: "employee_documents",
    order: 73,
    fields: [f("employee_id"), f("category"), f("label"), f("file_path"), f("file_type"), f("file_size"), f("uploaded_at")],
    refs: { employee_id: "employees" }
  },
  {
    table: "employee_payrolls",
    mobile: "employee_payrolls",
    order: 74,
    fields: [f("employee_id"), f("month"), f("accrual"), f("pf_employee"), f("pf_employer"), f("paid_before"), f("net_payable"), f("status"), f("finalized_at"), f("paid_at"), f("note")],
    refs: { employee_id: "employees" }
  },
  {
    table: "voucher_campaigns",
    mobile: "voucher_campaigns",
    order: 80,
    fields: [
      f("name"), f("discount_type"), f("discount_value"), f("quantity"), f("issue_limit"),
      f("issued_count"), f("redeemed_count"), f("min_total"), f("months"),
      ["valid_from", "start_date"], ["valid_through", "end_date"], f("month_count_start"),
      f("tiers"), f("active"), f("created_at")
    ],
    addColumns: [
      "ALTER TABLE voucher_campaigns ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE"
    ],
    toMobile: (row) => ({ ...row, valid_from: row.start_date, valid_through: row.end_date, active: row.active === false ? 0 : 1 }),
    toServer: (row) => ({ ...row, start_date: row.valid_from, end_date: row.valid_through })
  },
  {
    table: "vouchers",
    mobile: "vouchers",
    order: 81,
    fields: [
      f("campaign_id"), f("campaign_name"), f("code"), f("customer_id"), f("customer_name"),
      f("customer_phone"), f("discount_type"), f("discount_value"), f("min_total"),
      f("valid_from"), f("valid_through"), f("months"), f("uses_left"), f("status"),
      f("bill_id"), f("sale_total"), ["created_at", "issued_at"], f("redeemed_at"),
      f("redeemed_bill_id"), f("is_manual")
    ],
    refs: { campaign_id: "voucher_campaigns", customer_id: "customers", bill_id: "sales", redeemed_bill_id: "sales" },
    addColumns: [
      "ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS campaign_name TEXT DEFAULT ''",
      "ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS customer_id INTEGER",
      "ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS valid_from DATE",
      "ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS valid_through DATE",
      "ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS months INTEGER NOT NULL DEFAULT 1",
      "ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS uses_left INTEGER NOT NULL DEFAULT 1"
    ],
    toMobile: (row) => ({
      ...row,
      status: row.status === "redeemed" ? "used" : row.status === "issued" ? "active" : row.status,
      created_at: row.issued_at
    }),
    toServer: (row) => ({
      ...row,
      status: row.status === "active" ? "issued" : row.status === "used" ? "redeemed" : row.status
    })
  },
  {
    table: "brokers",
    mobile: "brokers",
    order: 90,
    fields: [f("name"), ["company", "company_name"], f("phone"), ["address", "area"], f("speciality"), ["notes", "detail"], f("created_at")]
  },
  {
    table: "broker_enquiries",
    mobile: "broker_enquiries",
    order: 91,
    fields: [f("broker_id"), f("reference_no"), f("product_name"), f("qty"), f("unit"), f("status"), f("notes"), f("created_at")],
    refs: { broker_id: "brokers" },
    addColumns: [
      "ALTER TABLE broker_enquiries ADD COLUMN IF NOT EXISTS product_name VARCHAR(300)",
      "ALTER TABLE broker_enquiries ADD COLUMN IF NOT EXISTS qty NUMERIC(14,2) NOT NULL DEFAULT 0",
      "ALTER TABLE broker_enquiries ADD COLUMN IF NOT EXISTS unit VARCHAR(30) DEFAULT 'pcs'"
    ],
    toMobile: (row) => ({
      ...row,
      status: row.status === "sent" ? "pending" : row.status
    }),
    toServer: (row) => ({
      ...row,
      status: row.status === "pending" ? "sent" : row.status
    })
  }
];

const BY_MOBILE = new Map(SPECS.map((s) => [s.mobile, s]));
const BY_SERVER = new Map(SPECS.map((s) => [s.table, s]));
const ORDERED = [...SPECS].sort((a, b) => a.order - b.order);

const q = (name) => `"${String(name).replace(/"/g, '""')}"`;

const dateColumnsCache = new Map();

async function normalizeDates(client, table, row) {
  let cols = dateColumnsCache.get(table);
  if (!cols) {
    const { rows } = await client.query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
          AND data_type IN ('date', 'timestamp without time zone', 'timestamp with time zone', 'time without time zone')`,
      [table]
    );
    cols = new Set(rows.map((r) => r.column_name));
    dateColumnsCache.set(table, cols);
  }
  for (const col of cols) {
    if (row[col] === "") row[col] = null;
  }
}

function parseBase(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function nowIso() {
  return new Date().toISOString();
}

function randomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 8; i += 1) out += alphabet[crypto.randomInt(alphabet.length)];
  return out;
}

function randomToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function randomPrefix() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return `${alphabet[crypto.randomInt(alphabet.length)]}${alphabet[crypto.randomInt(alphabet.length)]}`;
}

async function actionPasswordRequired(pool) {
  const { rows } = await pool.query("SELECT action_password, action_password_enabled FROM store_info WHERE id = 1");
  const row = rows[0] || {};
  return { stored: row.action_password || null, enabled: !!row.action_password_enabled };
}

function checkActionPassword(password, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = crypto.scryptSync(String(password), salt, 64);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

async function requireActionPassword(pool, req, res) {
  const { stored, enabled } = await actionPasswordRequired(pool);
  if (!stored || !enabled) return true;
  const password = String(req.get("x-action-password") || req.body?.actionPassword || "");
  if (checkActionPassword(password, stored)) return true;
  res.status(403).json({ error: "Action password required" });
  return false;
}

async function ensureSyncSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sync_devices (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL DEFAULT '',
      prefix VARCHAR(8) NOT NULL UNIQUE,
      token_hash TEXT NOT NULL UNIQUE,
      last_seen_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      revoked_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS sync_pairing_codes (
      code VARCHAR(12) PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      device_id UUID REFERENCES sync_devices(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS sync_changes (
      seq BIGSERIAL PRIMARY KEY,
      table_name TEXT NOT NULL,
      sync_id UUID NOT NULL,
      op VARCHAR(10) NOT NULL,
      payload JSONB,
      device_id UUID,
      changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_sync_changes_seq ON sync_changes(seq);
    CREATE INDEX IF NOT EXISTS idx_sync_changes_row ON sync_changes(table_name, sync_id);
    CREATE INDEX IF NOT EXISTS idx_sync_changes_changed_at ON sync_changes(changed_at);

    CREATE TABLE IF NOT EXISTS sync_conflicts (
      id BIGSERIAL PRIMARY KEY,
      device_id UUID REFERENCES sync_devices(id) ON DELETE SET NULL,
      table_name TEXT NOT NULL,
      sync_id UUID NOT NULL,
      op VARCHAR(10) NOT NULL,
      base_updated_at TIMESTAMPTZ,
      server_updated_at TIMESTAMPTZ,
      client_payload JSONB,
      server_payload JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      resolved_at TIMESTAMPTZ,
      resolution TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sync_conflicts_open ON sync_conflicts(created_at DESC) WHERE resolved_at IS NULL;
  `);

  await pool.query(`
    WITH ranked AS (
      SELECT id,
             row_number() OVER (
               PARTITION BY COALESCE(device_id, '00000000-0000-0000-0000-000000000000'::uuid),
                            table_name,
                            sync_id,
                            op,
                            COALESCE(base_updated_at, 'epoch'::timestamptz)
               ORDER BY created_at DESC, id DESC
             ) AS rn
        FROM sync_conflicts
       WHERE resolved_at IS NULL
    )
    UPDATE sync_conflicts c
       SET resolved_at = now(), resolution = 'duplicate'
      FROM ranked r
     WHERE c.id = r.id AND r.rn > 1
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_conflicts_open_unique
      ON sync_conflicts (
        COALESCE(device_id, '00000000-0000-0000-0000-000000000000'::uuid),
        table_name,
        sync_id,
        op,
        COALESCE(base_updated_at, 'epoch'::timestamptz)
      )
     WHERE resolved_at IS NULL
  `);

  for (const spec of ORDERED) {
    const table = q(spec.table);
    await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS sync_id UUID DEFAULT gen_random_uuid()`);
    await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT LOCALTIMESTAMP`);
    await pool.query(`UPDATE ${table} SET sync_id = gen_random_uuid() WHERE sync_id IS NULL`);
    await pool.query(`ALTER TABLE ${table} ALTER COLUMN sync_id SET NOT NULL`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS ${q(`idx_${spec.table}_sync_id`)} ON ${table}(sync_id)`);
    for (const sql of spec.addColumns || []) {
      await pool.query(sql);
    }
  }

  // Old rows written before the sync columns existed need their mobile-shaped
  // columns filled from the child rows the web UI created.
  await pool.query(`
    UPDATE stock_removals r
       SET product_id = i.product_id,
           product_name = COALESCE(NULLIF(r.product_name, ''), i.product_name),
           qty = CASE WHEN r.qty = 0 THEN i.qty ELSE r.qty END,
           unit_cost = CASE WHEN r.unit_cost = 0 THEN i.unit_cost ELSE r.unit_cost END,
           value = CASE WHEN r.value = 0 THEN i.amount ELSE r.value END
      FROM (
        SELECT DISTINCT ON (removal_id) removal_id, product_id, product_name, qty, unit_cost, amount
          FROM stock_removal_items ORDER BY removal_id, id
      ) i
     WHERE i.removal_id = r.id
       AND (r.product_name IS NULL OR r.qty = 0 OR r.value = 0)
  `);

  await pool.query(`
    UPDATE broker_enquiries e
       SET product_name = COALESCE(NULLIF(e.product_name, ''), i.product_name),
           qty = CASE WHEN e.qty = 0 THEN i.qty ELSE e.qty END,
           unit = COALESCE(NULLIF(e.unit, ''), i.unit_name)
      FROM (
        SELECT DISTINCT ON (enquiry_id) enquiry_id, product_name, qty, unit_name
          FROM broker_enquiry_items ORDER BY enquiry_id, id
      ) i
     WHERE i.enquiry_id = e.id
       AND (e.product_name IS NULL OR e.qty = 0)
  `);

  await pool.query(`
    CREATE OR REPLACE FUNCTION sync_touch_updated_at()
    RETURNS trigger AS $$
    BEGIN
      NEW.updated_at := LOCALTIMESTAMP;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE OR REPLACE FUNCTION sync_capture_change()
    RETURNS trigger AS $$
    DECLARE
      sid UUID;
      did UUID;
    BEGIN
      IF TG_OP = 'DELETE' THEN
        sid := OLD.sync_id;
      ELSE
        sid := NEW.sync_id;
      END IF;
      IF sid IS NULL THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
      END IF;
      BEGIN
        did := NULLIF(current_setting('sync.device_id', true), '')::uuid;
      EXCEPTION WHEN others THEN
        did := NULL;
      END;
      INSERT INTO sync_changes (table_name, sync_id, op, payload, device_id)
      VALUES (
        TG_TABLE_NAME,
        sid,
        lower(TG_OP),
        CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
        did
      );
      RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END;
    $$ LANGUAGE plpgsql;
  `);

  for (const spec of ORDERED) {
    const table = q(spec.table);
    await pool.query(`DROP TRIGGER IF EXISTS sync_touch_updated_at ON ${table}`);
    await pool.query(`CREATE TRIGGER sync_touch_updated_at BEFORE UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION sync_touch_updated_at()`);
    await pool.query(`DROP TRIGGER IF EXISTS sync_capture_change ON ${table}`);
    await pool.query(`CREATE TRIGGER sync_capture_change AFTER INSERT OR UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION sync_capture_change()`);
  }
}

// Old change rows are useless to phones that have already pulled them, and the
// log grows by every synced sale forever. Delete in small batches so the first
// run on a large database does not hold one enormous transaction or lock.
export async function purgeSyncChanges(db, retentionDays = 90) {
  const days = Math.max(1, Math.trunc(Number(retentionDays) || 90));
  const batchSize = 10000;
  let deleted = 0;
  for (;;) {
    const { rowCount } = await db.query(
      `DELETE FROM sync_changes
        WHERE seq IN (
          SELECT seq FROM sync_changes
           WHERE changed_at < now() - ($1::int * interval '1 day')
           ORDER BY seq
           LIMIT $2
        )`,
      [days, batchSize]
    );
    deleted += rowCount;
    if (rowCount < batchSize) break;
  }
  return deleted;
}

async function loadIdMaps(client) {
  const maps = new Map();
  for (const spec of ORDERED) {
    const { rows } = await client.query(`SELECT id, sync_id FROM ${q(spec.table)}`);
    const byId = new Map();
    const bySync = new Map();
    for (const row of rows) {
      byId.set(Number(row.id), row.sync_id);
      bySync.set(String(row.sync_id), Number(row.id));
    }
    maps.set(spec.table, { byId, bySync });
  }
  return maps;
}

function wall(value) {
  if (!(value instanceof Date)) return value;
  const p = (n) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())} ${p(value.getHours())}:${p(value.getMinutes())}:${p(value.getSeconds())}`;
}

function mapToMobile(spec, row, maps) {
  const out = {};
  for (const [mobileKey, serverKey] of spec.fields) {
    let value = row[serverKey];
    if (spec.refs?.[mobileKey] && value != null) {
      value = maps.get(spec.refs[mobileKey])?.byId.get(Number(value)) ?? null;
    }
    out[mobileKey] = wall(value);
  }
  out.sync_id = row.sync_id;
  out.updated_at = wall(row.updated_at);
  const extra = spec.toMobile ? spec.toMobile({ ...out, ...row }) : out;
  return extra;
}

function mapToServer(spec, data, maps) {
  const out = {};
  for (const [mobileKey, serverKey] of spec.fields) {
    let value = data?.[mobileKey];
    if (spec.refs?.[mobileKey] && value != null) {
      value = maps.get(spec.refs[mobileKey])?.bySync.get(String(value)) ?? null;
    }
    out[serverKey] = value;
  }
  const extra = spec.toServer ? spec.toServer({ ...data, ...out }) : out;
  for (const key of Object.keys(extra)) {
    if (extra[key] === undefined) delete extra[key];
  }
  return extra;
}

async function currentCursor(client) {
  const { rows } = await client.query("SELECT COALESCE(MAX(seq), 0)::bigint AS seq FROM sync_changes");
  return Number(rows[0].seq);
}

async function snapshot(pool) {
  const client = await pool.connect();
  try {
    const maps = await loadIdMaps(client);
    const tables = [];
    for (const spec of ORDERED) {
      const { rows } = await client.query(`SELECT * FROM ${q(spec.table)}`);
      tables.push({ table: spec.mobile, rows: rows.map((row) => mapToMobile(spec, row, maps)) });
    }
    const cursor = await currentCursor(client);
    return { cursor, tables, serverTime: nowIso() };
  } finally {
    client.release();
  }
}

async function pull(pool, after, limit = 500) {
  const client = await pool.connect();
  try {
    const { rows: [bounds] } = await client.query(
      "SELECT MIN(seq)::bigint AS min_seq FROM sync_changes"
    );
    const minSeq = bounds?.min_seq == null ? 0 : Number(bounds.min_seq);
    if (minSeq > 0 && after < minSeq - 1) {
      const err = new Error(
        "Sync history expired. Download the web data again on this phone before syncing."
      );
      err.status = 409;
      err.resetRequired = true;
      throw err;
    }
    const maps = await loadIdMaps(client);
    const { rows } = await client.query(
      `SELECT seq, table_name, sync_id, op, payload, changed_at
         FROM sync_changes
        WHERE seq > $1
        ORDER BY seq ASC
        LIMIT $2`,
      [after, limit + 1]
    );
    const hasMore = rows.length > limit;
    const slice = hasMore ? rows.slice(0, limit) : rows;
    const changes = [];
    for (const row of slice) {
      const spec = BY_SERVER.get(row.table_name);
      if (!spec) continue;
      const payload = row.payload || {};
      const data = row.op === "delete" ? null : mapToMobile(spec, payload, maps);
      changes.push({
        seq: Number(row.seq),
        table: spec.mobile,
        op: row.op,
        sync_id: row.sync_id,
        data,
        changed_at: new Date(row.changed_at).toISOString()
      });
    }
    return {
      cursor: changes.length ? changes[changes.length - 1].seq : after,
      changes,
      hasMore,
      serverTime: nowIso()
    };
  } finally {
    client.release();
  }
}

async function resolveStockProductId(client, value) {
  if (value == null) return null;
  if (typeof value === "number") return value;
  const { rows } = await client.query("SELECT id FROM products WHERE sync_id = $1", [value]);
  return rows[0]?.id ?? null;
}

async function applyStockDelta(client, productSyncId, delta) {
  const productId = await resolveStockProductId(client, productSyncId);
  if (!productId) return;
  await client.query(
    "UPDATE products SET stock = GREATEST(0, stock + $1) WHERE id = $2",
    [Number(delta) || 0, productId]
  );
}

async function applyChange(client, device, change, affectedSaleIds = new Set()) {
  const spec = BY_MOBILE.get(change.table);
  if (!spec) throw new Error(`Unknown sync table: ${change.table}`);
  const trackSale = (id) => {
    const n = Number(id);
    if (Number.isInteger(n) && n > 0) affectedSaleIds.add(n);
  };
  const syncId = change.sync_id || crypto.randomUUID();
  const op = String(change.op || "update").toLowerCase();
  const keyWhere = spec.singleton ? "id = 1" : "sync_id = $1";
  const keyArgs = spec.singleton ? [] : [syncId];
  const { rows: existingRows } = await client.query(
    `SELECT * FROM ${q(spec.table)} WHERE ${keyWhere} FOR UPDATE`,
    keyArgs
  );
  const existing = existingRows[0] || null;
  const base = parseBase(change.base_updated_at);

  if (existing && base) {
    const serverAt = existing.updated_at ? new Date(existing.updated_at) : null;
    if (serverAt && serverAt.getTime() > base.getTime() + 1000) {
      await client.query(
        `INSERT INTO sync_conflicts
           (device_id, table_name, sync_id, op, base_updated_at, server_updated_at, client_payload, server_payload)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
          ON CONFLICT DO NOTHING`,

        [
          device?.id || null,
          spec.mobile,
          existing.sync_id || syncId,
          op,
          base,
          serverAt,
          change.data || null,
          existing
        ]
      );
      return { status: "conflict", table: spec.mobile, sync_id: syncId };
    }
  }

  if (op === "delete") {
    if (!existing) return { status: "ok", table: spec.mobile, sync_id: syncId, deleted: false };
    if (spec.table === "sale_items") trackSale(existing.sale_id);
    if (spec.table === "sales") trackSale(existing.id);
    await client.query(`DELETE FROM ${q(spec.table)} WHERE ${keyWhere}`, keyArgs);
    return { status: "ok", table: spec.mobile, sync_id: syncId, deleted: true };
  }

  const maps = await loadIdMaps(client);
  const row = mapToServer(spec, change.data || {}, maps);
  await normalizeDates(client, spec.table, row);
  if (spec.table === "products" && change.data?.stock_delta != null) {
    const delta = Number(change.data.stock_delta || 0);
    row.stock = existing ? Math.max(0, Number(existing.stock) + delta) : Math.max(0, delta);
  }
  if (spec.singleton) row.id = 1;
  else row.sync_id = syncId;

  let savedId = existing?.id || null;
  if (existing) {
    const columns = Object.keys(row).filter((k) => k !== "sync_id" && k !== "id" && k !== "updated_at");
    if (columns.length) {
      const sets = columns.map((col, i) => `${q(col)} = $${i + 1}`).join(", ");
      const args = columns.map((col) => row[col]);
      args.push(existing.id);
      const updated = await client.query(
        `UPDATE ${q(spec.table)} SET ${sets} WHERE id = $${args.length} RETURNING id`,
        args
      );
      savedId = updated.rows[0]?.id ?? savedId;
    }
  } else {
    const columns = Object.keys(row).filter((k) => k !== "updated_at");
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
    const args = columns.map((col) => row[col]);
    const inserted = await client.query(
      `INSERT INTO ${q(spec.table)} (${columns.map(q).join(", ")}) VALUES (${placeholders}) RETURNING id`,
      args
    );
    savedId = inserted.rows[0]?.id ?? null;
  }

  if (spec.table === "sale_items") {
    if (existing?.sale_id) trackSale(existing.sale_id);
    trackSale(row.sale_id);
  } else if (spec.table === "sales") {
    trackSale(savedId);
  }

  // Stock movements are derived from the line rows, not trusted from the
  // product's stock field. That keeps two phones selling the same product from
  // overwriting each other's stock counts.
  if (op === "insert") {
    if (spec.mobile === "sale_items" && row.qty) {
      await applyStockDelta(client, change.data?.product_id, -Number(row.qty));
    } else if (spec.mobile === "sale_return_items" && row.qty) {
      await applyStockDelta(client, change.data?.product_id, Number(row.qty));
    } else if (spec.mobile === "supplier_purchase_items" && row.quantity) {
      await applyStockDelta(client, change.data?.product_id, Number(row.quantity));
    } else if (spec.mobile === "stock_removals" && row.qty) {
      await applyStockDelta(client, change.data?.product_id, -Number(row.qty));
    }
  }

  return { status: "ok", table: spec.mobile, sync_id: syncId };
}

async function push(pool, device, changes) {
  const client = await pool.connect();
  const results = [];
  const affectedSaleIds = new Set();
  try {
    await client.query("BEGIN");
    const before = await currentCursor(client);
    await client.query("SELECT set_config('sync.device_id', $1, true)", [device.id]);
    const ordered = [...changes].sort((a, b) => {
      const ao = BY_MOBILE.get(a.table)?.order ?? 999;
      const bo = BY_MOBILE.get(b.table)?.order ?? 999;
      if (ao !== bo) return ao - bo;
      return Number(a.seq || 0) - Number(b.seq || 0);
    });
    for (const change of ordered) {
      try {
        results.push(await applyChange(client, device, change, affectedSaleIds));
      } catch (e) {
        results.push({
          status: "error",
          table: change.table,
          sync_id: change.sync_id,
          error: e.message || String(e)
        });
      }
    }
    if (affectedSaleIds.size > 0) {
      await recalcSaleProfits(client, [...affectedSaleIds]);
    }
    await client.query("COMMIT");
    return { cursor: before, results, serverTime: nowIso() };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

function authDevice(pool) {
  return async (req, res, next) => {
    try {
      const header = String(req.get("authorization") || "");
      const token = header.toLowerCase().startsWith("bearer ")
        ? header.slice(7).trim()
        : String(req.query.token || req.get("x-sync-token") || "");
      if (!token) return res.status(401).json({ error: "Sync token required" });
      const { rows } = await pool.query(
        `SELECT id, name, prefix, last_seen_at, created_at, revoked_at
           FROM sync_devices WHERE token_hash = $1`,
        [hashToken(token)]
      );
      const device = rows[0];
      if (!device || device.revoked_at) return res.status(401).json({ error: "Sync device is not authorised" });
      await pool.query("UPDATE sync_devices SET last_seen_at = now() WHERE id = $1", [device.id]);
      req.syncDevice = device;
      next();
    } catch (e) {
      next(e);
    }
  };
}

function registerSync(app, pool) {
  const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  app.post(
    "/api/sync/pairing-code",
    h(async (req, res) => {
      if (!(await requireActionPassword(pool, req, res))) return;
      const code = randomCode();
      const minutes = Math.max(1, Math.min(60, Number(req.body?.minutes) || 10));
      const { rows } = await pool.query(
        `INSERT INTO sync_pairing_codes (code, expires_at)
         VALUES ($1, now() + ($2 || ' minutes')::interval)
         RETURNING code, created_at, expires_at`,
        [code, minutes]
      );
      res.status(201).json(rows[0]);
    })
  );

  app.post(
    "/api/sync/pair",
    h(async (req, res) => {
      const code = String(req.body?.code || "").trim().toUpperCase();
      const name = String(req.body?.device_name || req.body?.name || "Phone").trim().slice(0, 80) || "Phone";
      if (!code) return res.status(400).json({ error: "Pairing code required" });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows } = await client.query(
          `SELECT * FROM sync_pairing_codes
            WHERE code = $1 AND used_at IS NULL AND expires_at > now()
            FOR UPDATE`,
          [code]
        );
        const pairing = rows[0];
        if (!pairing) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "Pairing code is invalid or expired" });
        }
        let prefix = randomPrefix();
        for (let i = 0; i < 20; i += 1) {
          const exists = await client.query("SELECT 1 FROM sync_devices WHERE prefix = $1", [prefix]);
          if (!exists.rowCount) break;
          prefix = randomPrefix();
        }
        const token = randomToken();
        const deviceRows = await client.query(
          `INSERT INTO sync_devices (name, prefix, token_hash)
           VALUES ($1, $2, $3) RETURNING id, name, prefix, created_at`,
          [name, prefix, hashToken(token)]
        );
        const device = deviceRows.rows[0];
        await client.query(
          "UPDATE sync_pairing_codes SET used_at = now(), device_id = $1 WHERE code = $2",
          [device.id, code]
        );
        await client.query("COMMIT");
        res.status(201).json({ ...device, token });
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    })
  );

  app.get(
    "/api/sync/status",
    authDevice(pool),
    h(async (req, res) => {
      const cursor = await currentCursor(pool);
      const { rows } = await pool.query(
        "SELECT COUNT(*)::int AS open_conflicts FROM sync_conflicts WHERE resolved_at IS NULL"
      );
      res.json({
        device: req.syncDevice,
        cursor,
        open_conflicts: rows[0]?.open_conflicts || 0,
        tables: ORDERED.map((s) => s.mobile),
        serverTime: nowIso()
      });
    })
  );

  app.get(
    "/api/sync/snapshot",
    authDevice(pool),
    h(async (_req, res) => {
      res.json(await snapshot(pool));
    })
  );

  app.get(
    "/api/sync/pull",
    authDevice(pool),
    h(async (req, res) => {
      const after = Math.max(0, Number(req.query.cursor) || 0);
      const limit = Math.max(1, Math.min(2000, Number(req.query.limit) || 500));
      res.json(await pull(pool, after, limit));
    })
  );

  app.post(
    "/api/sync/push",
    authDevice(pool),
    h(async (req, res) => {
      const changes = Array.isArray(req.body?.changes) ? req.body.changes : [];
      if (changes.length > 5000) return res.status(413).json({ error: "Too many changes in one push" });
      res.json(await push(pool, req.syncDevice, changes));
    })
  );

  app.get(
    "/api/sync/events",
    authDevice(pool),
    h(async (req, res) => {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();
      let last = Math.max(0, Number(req.query.cursor) || 0);
      let closed = false;
      const send = (event, data) => {
        if (closed) return;
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      send("ready", { cursor: last, serverTime: nowIso() });
      const timer = setInterval(async () => {
        try {
          const { rows } = await pool.query("SELECT COALESCE(MAX(seq), 0)::bigint AS seq FROM sync_changes");
          const seq = Number(rows[0]?.seq || 0);
          if (seq > last) {
            last = seq;
            send("change", { cursor: seq, serverTime: nowIso() });
          } else {
            send("ping", { serverTime: nowIso() });
          }
        } catch {
          send("ping", { serverTime: nowIso() });
        }
      }, 3000);
      req.on("close", () => {
        closed = true;
        clearInterval(timer);
        res.end();
      });
    })
  );

  app.get(
    "/api/sync/devices",
    h(async (req, res) => {
      if (!(await requireActionPassword(pool, req, res))) return;
      const { rows } = await pool.query(
        `SELECT id, name, prefix, last_seen_at, created_at, revoked_at
           FROM sync_devices ORDER BY created_at DESC`
      );
      res.json(rows);
    })
  );

  app.delete(
    "/api/sync/devices/:id",
    h(async (req, res) => {
      if (!(await requireActionPassword(pool, req, res))) return;
      const { rowCount } = await pool.query(
        "UPDATE sync_devices SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL",
        [req.params.id]
      );
      if (!rowCount) return res.status(404).json({ error: "Device not found or already revoked" });
      res.json({ revoked: true });
    })
  );

  app.get(
    "/api/sync/conflicts",
    h(async (req, res) => {
      if (!(await requireActionPassword(pool, req, res))) return;
      const open = req.query.open !== "false";
      const { rows } = await pool.query(
        `SELECT c.*, d.name AS device_name, d.prefix AS device_prefix
           FROM sync_conflicts c
           LEFT JOIN sync_devices d ON d.id = c.device_id
          WHERE ($1::boolean = false OR c.resolved_at IS NULL)
          ORDER BY c.created_at DESC
          LIMIT 500`,
        [open]
      );
      res.json(rows);
    })
  );

  app.post(
    "/api/sync/conflicts/:id/resolve",
    h(async (req, res) => {
      if (!(await requireActionPassword(pool, req, res))) return;
      const resolution = String(req.body?.resolution || "reviewed").slice(0, 200);
      const { rowCount } = await pool.query(
        "UPDATE sync_conflicts SET resolved_at = now(), resolution = $1 WHERE id = $2 AND resolved_at IS NULL",
        [resolution, req.params.id]
      );
      if (!rowCount) return res.status(404).json({ error: "Conflict not found or already resolved" });
      res.json({ resolved: true });
    })
  );
}

export { ensureSyncSchema, registerSync, SPECS };
