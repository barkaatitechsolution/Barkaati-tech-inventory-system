// Sync metadata and change capture for the offline SQLite database.
//
// Every synced table gets a stable sync_id plus two bookkeeping columns:
//   sync_dirty            1 when a local write still needs to be pushed
//   sync_base_updated_at  the server updated_at this device last saw
//
// Triggers mark rows dirty and write local deletes into sync_tombstones. While
// the sync engine is applying a server snapshot/pull it sets app_meta
// sync_applying=1, which makes the triggers stay quiet.

const UUID_SQL = `lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1,1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))`;

export const SYNC_TABLES = [
  { table: "store_info", order: 1, singleton: true, refs: {} },
  { table: "measuring_units", order: 2, refs: {} },
  { table: "categories", order: 3, refs: {} },
  { table: "subcategories", order: 4, refs: { category_id: "categories" } },
  { table: "customer_categories", order: 5, refs: {} },
  { table: "expense_categories", order: 6, refs: {} },
  { table: "business_document_categories", order: 7, refs: {} },
  { table: "asset_categories", order: 8, refs: {} },
  { table: "voucher_campaigns", order: 9, refs: {} },
  { table: "suppliers", order: 10, refs: {} },
  { table: "customers", order: 11, refs: { category_id: "customer_categories" } },
  { table: "brokers", order: 12, refs: {} },
  { table: "products", order: 13, refs: { category_id: "categories", subcategory_id: "subcategories", unit_id: "measuring_units" } },
  { table: "supplier_purchases", order: 14, refs: { supplier_id: "suppliers" } },
  { table: "supplier_purchase_items", order: 15, refs: { purchase_id: "supplier_purchases", product_id: "products" } },
  { table: "product_images", order: 16, refs: { product_id: "products" } },
  { table: "weight_barcodes", order: 17, refs: {} },
  { table: "product_packs", order: 17, refs: { product_id: "products", purchase_id: "supplier_purchases" } },
  { table: "customer_prices", order: 18, refs: { product_id: "products", customer_category_id: "customer_categories" } },
  { table: "broker_enquiries", order: 19, refs: { broker_id: "brokers" } },
  { table: "vouchers", order: 19, refs: { campaign_id: "voucher_campaigns", customer_id: "customers", bill_id: "sales", redeemed_bill_id: "sales" } },
  { table: "sales", order: 20, refs: { customer_id: "customers", voucher_id: "vouchers" } },
  { table: "sale_items", order: 21, refs: { sale_id: "sales", product_id: "products", unit_id: "measuring_units" } },
  { table: "sale_returns", order: 22, refs: { sale_id: "sales" } },
  { table: "sale_return_items", order: 23, refs: { return_id: "sale_returns", sale_item_id: "sale_items", product_id: "products" } },
  { table: "customer_payments", order: 24, refs: { customer_id: "customers", sale_id: "sales" } },
  { table: "call_notes", order: 25, refs: { customer_id: "customers", supplier_id: "suppliers" } },
  { table: "stock_removals", order: 26, refs: { product_id: "products" } },
  { table: "employees", order: 28, refs: {} },
  { table: "employee_attendance", order: 29, refs: { employee_id: "employees" } },
  { table: "employee_payments", order: 30, refs: { employee_id: "employees" } },
  { table: "employee_documents", order: 31, refs: { employee_id: "employees" } },
  { table: "employee_payrolls", order: 32, refs: { employee_id: "employees" } },
  { table: "tasks", order: 33, refs: { assigned_to: "employees" } },
  { table: "assets", order: 34, refs: {} },
  { table: "expenses", order: 35, refs: { category_id: "expense_categories" } },
  { table: "cheques", order: 36, refs: { supplier_id: "suppliers", customer_id: "customers" } },
  { table: "business_documents", order: 37, refs: {} },
  { table: "non_sale_inventory", order: 38, refs: {} }
];

export const SYNC_TABLE_NAMES = SYNC_TABLES.map((t) => t.table);
export const SYNC_BY_TABLE = new Map(SYNC_TABLES.map((t) => [t.table, t]));

const ADDED_COLUMNS = {
  // Fields the web app has that the first offline schema did not need yet.
  measuring_units: { base_unit: "TEXT DEFAULT ''" },
  products: { sync_base_stock: "REAL NOT NULL DEFAULT 0" },
  categories: { description: "TEXT DEFAULT ''", quality_stars: "INTEGER NOT NULL DEFAULT 0" },
  product_images: { created_at: "TEXT DEFAULT (datetime('now','localtime'))" },
  customer_prices: { created_at: "TEXT DEFAULT (datetime('now','localtime'))" },
  suppliers: { contact_person: "TEXT DEFAULT ''", products_sold: "TEXT DEFAULT ''" },
  supplier_purchases: {
    grand_total: "REAL NOT NULL DEFAULT 0",
    paid_amount: "REAL NOT NULL DEFAULT 0"
  },
  supplier_purchase_items: {
    selling_price: "REAL NOT NULL DEFAULT 0",
    pack_size: "REAL NOT NULL DEFAULT 1",
    pack_sub_unit: "TEXT DEFAULT ''",
    pack_price: "REAL NOT NULL DEFAULT 0",
    unit_id: "INTEGER"
  },
  product_packs: { opened_at: "TEXT DEFAULT ''" },
  sales: { updated_at: "TEXT DEFAULT ''" },
  sale_items: { product_pack_id: "INTEGER" },
  sale_returns: { invoice_no: "TEXT DEFAULT ''", customer: "TEXT DEFAULT ''" },
  sale_return_items: {
    product_name: "TEXT DEFAULT ''",
    unit_name: "TEXT DEFAULT ''",
    line_total: "REAL NOT NULL DEFAULT 0"
  },
  customer_payments: { invoice_no: "TEXT DEFAULT ''", customer: "TEXT DEFAULT ''" },
  stock_removals: { note: "TEXT DEFAULT ''" },
  tasks: { assigned_to: "INTEGER" },
  call_notes: {
    contact_type: "TEXT DEFAULT 'customer'",
    customer_id: "INTEGER",
    supplier_id: "INTEGER",
    subject: "TEXT DEFAULT ''",
    called_at: "TEXT DEFAULT ''"
  },
  employees: { role: "TEXT DEFAULT ''" },
  employee_attendance: { created_at: "TEXT DEFAULT (datetime('now','localtime'))" },
  voucher_campaigns: {
    quantity: "INTEGER NOT NULL DEFAULT 1000",
    issue_limit: "INTEGER NOT NULL DEFAULT 300",
    issued_count: "INTEGER NOT NULL DEFAULT 0",
    redeemed_count: "INTEGER NOT NULL DEFAULT 0",
    month_count_start: "TEXT DEFAULT ''",
    tiers: "TEXT DEFAULT '[]'"
  },
  vouchers: {
    customer_phone: "TEXT DEFAULT ''",
    bill_id: "INTEGER",
    sale_total: "REAL",
    issued_at: "TEXT DEFAULT ''",
    redeemed_at: "TEXT DEFAULT ''",
    redeemed_bill_id: "INTEGER",
    is_manual: "INTEGER NOT NULL DEFAULT 0"
  },
  brokers: { speciality: "TEXT DEFAULT ''" },
  broker_enquiries: { unit: "TEXT DEFAULT 'pcs'" }
};

async function tableColumns(conn, table) {
  try {
    const res = await conn.query(`PRAGMA table_info("${table}")`);
    return (res?.values || []).map((r) => r.name);
  } catch {
    return [];
  }
}

export async function applySyncMigrations(conn) {
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS sync_tombstones (
      table_name TEXT NOT NULL,
      sync_id TEXT NOT NULL,
      base_updated_at TEXT,
      deleted_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      PRIMARY KEY (table_name, sync_id)
    );
  `);

  for (const spec of SYNC_TABLES) {
    const { table } = spec;
    let cols = await tableColumns(conn, table);
    if (!cols.length) continue;

    for (const [column, definition] of Object.entries(ADDED_COLUMNS[table] || {})) {
      if (cols.includes(column)) continue;
      try {
        await conn.execute(`ALTER TABLE "${table}" ADD COLUMN ${column} ${definition}`);
      } catch {
        /* already present */
      }
    }
    cols = await tableColumns(conn, table);

    if (!cols.includes("sync_id")) {
      await conn.execute(`ALTER TABLE "${table}" ADD COLUMN sync_id TEXT`);
    }
    if (!cols.includes("sync_dirty")) {
      await conn.execute(`ALTER TABLE "${table}" ADD COLUMN sync_dirty INTEGER NOT NULL DEFAULT 0`);
    }
    if (!cols.includes("sync_base_updated_at")) {
      await conn.execute(`ALTER TABLE "${table}" ADD COLUMN sync_base_updated_at TEXT`);
    }

    await conn.execute(
      `UPDATE "${table}" SET sync_id = ${UUID_SQL} WHERE sync_id IS NULL OR sync_id = ''`
    );
    await conn.execute(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_${table}_sync_id" ON "${table}"(sync_id)`
    );
    await conn.execute(
      `CREATE INDEX IF NOT EXISTS "idx_${table}_sync_dirty" ON "${table}"(sync_dirty)`
    );

    const key = spec.singleton ? "id" : "sync_id";
    const newKey = spec.singleton ? "NEW.id" : "NEW.sync_id";
    const oldKey = spec.singleton ? "OLD.id" : "OLD.sync_id";

    await conn.execute(`DROP TRIGGER IF EXISTS "sync_bi_${table}"`);
    await conn.execute(`DROP TRIGGER IF EXISTS "sync_ai_${table}"`);
    await conn.execute(`DROP TRIGGER IF EXISTS "sync_au_${table}"`);
    await conn.execute(`DROP TRIGGER IF EXISTS "sync_ad_${table}"`);

    await conn.execute(`
      CREATE TRIGGER "sync_ai_${table}"
      AFTER INSERT ON "${table}"
      FOR EACH ROW
      WHEN NEW.sync_id IS NULL OR NEW.sync_id = ''
      BEGIN
        UPDATE "${table}"
           SET sync_id = ${UUID_SQL},
               sync_dirty = CASE
                 WHEN COALESCE((SELECT value FROM app_meta WHERE key = 'sync_applying'), '0') = '1' THEN 0
                 ELSE 1
               END
         WHERE rowid = NEW.rowid;
      END;
    `);

    await conn.execute(`
      CREATE TRIGGER "sync_au_${table}"
      AFTER UPDATE ON "${table}"
      FOR EACH ROW
      WHEN COALESCE((SELECT value FROM app_meta WHERE key = 'sync_applying'), '0') <> '1'
      BEGIN
        UPDATE "${table}" SET sync_dirty = 1 WHERE ${key} = ${newKey};
      END;
    `);

    await conn.execute(`
      CREATE TRIGGER "sync_ad_${table}"
      AFTER DELETE ON "${table}"
      FOR EACH ROW
      WHEN OLD.sync_id IS NOT NULL
       AND COALESCE((SELECT value FROM app_meta WHERE key = 'sync_applying'), '0') <> '1'
      BEGIN
        INSERT INTO sync_tombstones (table_name, sync_id, base_updated_at)
        VALUES ('${table}', ${oldKey}, OLD.sync_base_updated_at)
        ON CONFLICT(table_name, sync_id) DO UPDATE SET
          base_updated_at = excluded.base_updated_at,
          deleted_at = datetime('now','localtime');
      END;
    `);
  }
}
