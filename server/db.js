import "dotenv/config";
import pg from "pg";

const { Pool, types } = pg;

types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));

// A DATE has no time and no zone. Left to itself pg turns it into a JS Date at
// local midnight, which JSON then renders in UTC -- so a 2026-03-10 row reaches
// the browser as "2026-03-09T18:30:00.000Z" and every `.slice(0, 10)` in the
// client reads the day before. Hand back the plain "YYYY-MM-DD" string that
// Postgres already sent; that is what the rest of the app assumes.
types.setTypeParser(1082, (v) => v);

const baseConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.PGHOST || "127.0.0.1",
      port: Number(process.env.PGPORT || 5432),
      user: process.env.PGUSER || "postgres",
      password: process.env.PGPASSWORD || "postgres",
      database: process.env.PGDATABASE || "store_master"
    };

const databaseName = process.env.PGDATABASE || "store_master";

export async function ensureDatabase() {
  const admin = new Pool({ ...baseConfig, database: "postgres" });
  try {
    const { rows } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
    if (rows.length === 0) {
      await admin.query(`CREATE DATABASE "${databaseName}"`);
      console.log(`Created database "${databaseName}"`);
    }
  } finally {
    await admin.end();
  }
}

export const pool = new Pool({
  ...baseConfig,
  max: 50,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000
});

const DROP_TABLES = `
DROP TABLE IF EXISTS sale_items CASCADE;
DROP TABLE IF EXISTS sale_return_items CASCADE;
DROP TABLE IF EXISTS sale_returns CASCADE;
DROP TABLE IF EXISTS purchases CASCADE;
DROP TABLE IF EXISTS purchase_items CASCADE;
DROP TABLE IF EXISTS product_packs CASCADE;
DROP TABLE IF EXISTS supplier_purchase_items CASCADE;
DROP TABLE IF EXISTS supplier_purchases CASCADE;
DROP TABLE IF EXISTS cheques CASCADE;
DROP TABLE IF EXISTS sales CASCADE;
DROP TABLE IF EXISTS product_images CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS categories CASCADE;
DROP TABLE IF EXISTS subcategories CASCADE;
DROP TABLE IF EXISTS suppliers CASCADE;
DROP TABLE IF EXISTS customers CASCADE;
DROP TABLE IF EXISTS customer_prices CASCADE;
DROP TABLE IF EXISTS customer_categories CASCADE;
DROP TABLE IF EXISTS assets CASCADE;
DROP TABLE IF EXISTS expenses CASCADE;
DROP TABLE IF EXISTS expense_categories CASCADE;
DROP TABLE IF EXISTS asset_categories CASCADE;
DROP TABLE IF EXISTS measuring_units CASCADE;
DROP TABLE IF EXISTS attendance CASCADE;
DROP TABLE IF EXISTS employee_documents CASCADE;
DROP TABLE IF EXISTS employee_payments CASCADE;
DROP TABLE IF EXISTS employees CASCADE;
DROP TABLE IF EXISTS tasks CASCADE;
DROP TABLE IF EXISTS business_documents CASCADE;
DROP TABLE IF EXISTS business_document_categories CASCADE;
DROP TABLE IF EXISTS broker_enquiry_items CASCADE;
DROP TABLE IF EXISTS broker_enquiries CASCADE;
DROP TABLE IF EXISTS brokers CASCADE;
DROP TABLE IF EXISTS voucher_uses CASCADE;
DROP TABLE IF EXISTS vouchers CASCADE;
DROP TABLE IF EXISTS voucher_campaigns CASCADE;
DROP TABLE IF EXISTS store_info CASCADE;
`;

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS measuring_units (
  id SERIAL PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE,
  short_name VARCHAR(20) NOT NULL UNIQUE,
  category VARCHAR(40) NOT NULL DEFAULT 'count',
  base_unit VARCHAR(80),
  conversion_factor NUMERIC(14,4) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT LOCALTIMESTAMP
);

CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE,
  description TEXT,
  quality_stars INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT LOCALTIMESTAMP
);

CREATE TABLE IF NOT EXISTS subcategories (
  id SERIAL PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  created_at TIMESTAMP DEFAULT LOCALTIMESTAMP,
  UNIQUE (category_id, name)
);

CREATE TABLE IF NOT EXISTS customer_categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT LOCALTIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  sku VARCHAR(60) UNIQUE,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  subcategory_id INTEGER REFERENCES subcategories(id) ON DELETE SET NULL,
  barcode VARCHAR(60),
  unit VARCHAR(20) DEFAULT 'pcs',
  unit_id INTEGER REFERENCES measuring_units(id) ON DELETE SET NULL,
  purchase_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  selling_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  market_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  stock NUMERIC(14,2) NOT NULL DEFAULT 0,
  reorder_level NUMERIC(14,2) NOT NULL DEFAULT 0,
  hsn_code VARCHAR(40),
  discount NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax NUMERIC(5,2) NOT NULL DEFAULT 0,
  expiry_date DATE,
  description TEXT,
  created_at TIMESTAMP DEFAULT LOCALTIMESTAMP
);

CREATE TABLE IF NOT EXISTS product_images (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT LOCALTIMESTAMP
);

CREATE TABLE IF NOT EXISTS suppliers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  company_name TEXT,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  detail TEXT,
  products_sold TEXT,
  created_at TIMESTAMP DEFAULT LOCALTIMESTAMP
);

CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  credit_limit NUMERIC(14,2) NOT NULL DEFAULT 0,
  category_id INTEGER REFERENCES customer_categories(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT LOCALTIMESTAMP
);

CREATE TABLE IF NOT EXISTS customer_prices (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES customer_categories(id) ON DELETE CASCADE,
  selling_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT LOCALTIMESTAMP,
  UNIQUE (product_id, category_id)
);

CREATE TABLE IF NOT EXISTS sales (
  id SERIAL PRIMARY KEY,
  invoice_no VARCHAR(30) UNIQUE,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  paid NUMERIC(14,2) NOT NULL DEFAULT 0,
  status VARCHAR(20) DEFAULT 'paid',
  payment_method VARCHAR(20) DEFAULT 'cash',
  note TEXT,
  created_at TIMESTAMP DEFAULT LOCALTIMESTAMP
);

CREATE TABLE IF NOT EXISTS supplier_purchases (
  id SERIAL PRIMARY KEY,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  additional_charges NUMERIC(14,2) NOT NULL DEFAULT 0,
  grand_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  due_date DATE,
  bill_image TEXT,
  purchased_at TIMESTAMP DEFAULT LOCALTIMESTAMP,
  created_at TIMESTAMP DEFAULT LOCALTIMESTAMP
);

CREATE TABLE IF NOT EXISTS supplier_purchase_items (
  id SERIAL PRIMARY KEY,
  purchase_id INTEGER NOT NULL REFERENCES supplier_purchases(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  item_name TEXT NOT NULL,
  purchase_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  quantity NUMERIC(14,2) NOT NULL DEFAULT 1,
  unit_id INTEGER REFERENCES measuring_units(id) ON DELETE SET NULL,
  pack_size NUMERIC(14,4) NOT NULL DEFAULT 1,
  pack_sub_unit VARCHAR(40),
  pack_price NUMERIC(14,2) DEFAULT 0,
  hsn_code VARCHAR(40),
  tax NUMERIC(5,2) NOT NULL DEFAULT 0,
  discount NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT LOCALTIMESTAMP
);

CREATE TABLE IF NOT EXISTS product_packs (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  purchase_id INTEGER REFERENCES supplier_purchases(id) ON DELETE SET NULL,
  pack_size NUMERIC(14,2) NOT NULL DEFAULT 1,
  remaining NUMERIC(14,4) NOT NULL DEFAULT 0,
  status VARCHAR(20) DEFAULT 'closed',
  opened_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT LOCALTIMESTAMP
);

CREATE TABLE IF NOT EXISTS sale_items (
  id SERIAL PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  product_pack_id INTEGER REFERENCES product_packs(id) ON DELETE SET NULL,
  qty NUMERIC(14,2) NOT NULL,
  unit_price NUMERIC(14,2) NOT NULL,
  market_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  unit_id INTEGER REFERENCES measuring_units(id) ON DELETE SET NULL,
  conversion_factor NUMERIC(14,4) DEFAULT 1,
  purchase_price NUMERIC(14,2) DEFAULT 0,
  profit NUMERIC(14,2) DEFAULT 0,
  hsn_code VARCHAR(50),
  tax NUMERIC(8,2) DEFAULT 0,
  tax_amt NUMERIC(14,2) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS purchases (
  id SERIAL PRIMARY KEY,
  reference_no VARCHAR(30) UNIQUE,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  paid NUMERIC(14,2) NOT NULL DEFAULT 0,
  status VARCHAR(20) DEFAULT 'paid',
  created_at TIMESTAMP DEFAULT LOCALTIMESTAMP
);

CREATE TABLE IF NOT EXISTS purchase_items (
  id SERIAL PRIMARY KEY,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty NUMERIC(14,2) NOT NULL,
  unit_price NUMERIC(14,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  category VARCHAR(60) DEFAULT 'Equipment',
  purchase_date DATE,
  purchase_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  current_value NUMERIC(14,2),
  condition VARCHAR(30) DEFAULT 'Good',
  location TEXT,
  note TEXT
);

CREATE TABLE IF NOT EXISTS expenses (
  id SERIAL PRIMARY KEY,
  category VARCHAR(60) NOT NULL,
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  description TEXT,
  payment_method VARCHAR(20) DEFAULT 'cash',
  date TIMESTAMP DEFAULT LOCALTIMESTAMP
);

CREATE TABLE IF NOT EXISTS cheques (
  id SERIAL PRIMARY KEY,
  cheque_no VARCHAR(40) NOT NULL,
  bank_name VARCHAR(120),
  drawer_name VARCHAR(120),
  payee VARCHAR(120),
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  issue_date DATE,
  clearing_date DATE,
  status VARCHAR(12) NOT NULL DEFAULT 'pending',
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMP DEFAULT LOCALTIMESTAMP
);

CREATE TABLE IF NOT EXISTS expense_categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT LOCALTIMESTAMP
);

CREATE TABLE IF NOT EXISTS asset_categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT LOCALTIMESTAMP
);

CREATE TABLE IF NOT EXISTS employees (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  designation TEXT,
  -- How the employee is paid, which decides how a day's attendance turns into money:
  --   salary     -> amount is the monthly figure, accrued at (amount * 12 / 364.5)/day
  --   wages      -> amount IS the daily wage, accrued per day with no monthly cap
  --   freelancer -> no daily accrual; only payments are recorded against him
  salary_type VARCHAR(20) NOT NULL DEFAULT 'salary',
  salary_rate NUMERIC(14,2) NOT NULL DEFAULT 0,
  joining_date DATE,
  -- First day he counts for pay. Can be later than joining_date when someone is
  -- hired but only starts drawing after probation or training.
  starting_date DATE,
  -- Skill rating shown as a badge. Rank is the headline label, stars the detail.
  rank VARCHAR(20) NOT NULL DEFAULT 'noob',
  stars INTEGER NOT NULL DEFAULT 1,
  -- Expected shift. Recorded and reported, but it never changes what he is paid;
  -- only the attendance marks do.
  shift_start TIME,
  shift_end TIME,
  -- Provident fund. Off per employee by default; when on, the employee's share is
  -- withheld from his pay and the employer's share is added as a cost to the shop.
  pf_enabled BOOLEAN NOT NULL DEFAULT false,
  pf_rate NUMERIC(6,2) NOT NULL DEFAULT 12,
  notes TEXT,
  created_at TIMESTAMP DEFAULT LOCALTIMESTAMP
);

-- Added after the table was first shipped, so existing installs need these too.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS starting_date DATE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS rank VARCHAR(20) NOT NULL DEFAULT 'noob';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS stars INTEGER NOT NULL DEFAULT 1;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS shift_start TIME;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS shift_end TIME;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS pf_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS pf_rate NUMERIC(6,2) NOT NULL DEFAULT 12;
-- "monthly" was the original name for what is now "salary".
UPDATE employees SET salary_type = 'salary' WHERE salary_type = 'monthly';

-- The employee attendance, payroll and employee-document features were removed
  -- from the app, so their tables are no longer created here. The employees
  -- table itself stays: Tasks still assigns work to a person by employee_id.
  -- Any attendance rows that existed were dumped before removal -- see the
  -- commit message for the restore file.

CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  assigned_to INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  priority VARCHAR(10) NOT NULL DEFAULT 'normal',
  status VARCHAR(12) NOT NULL DEFAULT 'pending',
  due_date DATE,
  created_at TIMESTAMP DEFAULT LOCALTIMESTAMP,
  completed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS business_documents (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  category VARCHAR(80) DEFAULT 'Other',
  file_path TEXT NOT NULL,
  file_type VARCHAR(30),
  file_size BIGINT NOT NULL DEFAULT 0,
  notes TEXT,
  uploaded_at TIMESTAMP DEFAULT LOCALTIMESTAMP
);

CREATE TABLE IF NOT EXISTS business_document_categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT LOCALTIMESTAMP
);

CREATE TABLE IF NOT EXISTS voucher_campaigns (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  discount_type VARCHAR(6) NOT NULL DEFAULT 'rupee',
  discount_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  quantity INTEGER NOT NULL DEFAULT 1000,
  issue_limit INTEGER NOT NULL DEFAULT 300,
  issued_count INTEGER NOT NULL DEFAULT 0,
  redeemed_count INTEGER NOT NULL DEFAULT 0,
  min_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  months INTEGER NOT NULL DEFAULT 5,
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMP DEFAULT LOCALTIMESTAMP
);

CREATE TABLE IF NOT EXISTS vouchers (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES voucher_campaigns(id) ON DELETE CASCADE,
  code VARCHAR(4) NOT NULL UNIQUE,
  status VARCHAR(12) NOT NULL DEFAULT 'issued',
  bill_id INTEGER REFERENCES sales(id) ON DELETE SET NULL,
  customer_name VARCHAR(120),
  sale_total NUMERIC(14,2),
  issued_at TIMESTAMP DEFAULT LOCALTIMESTAMP,
  redeemed_at TIMESTAMP,
  redeemed_bill_id INTEGER REFERENCES sales(id) ON DELETE SET NULL
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vouchers' AND column_name = 'month_label'
  ) THEN
    DROP TABLE IF EXISTS vouchers CASCADE;
    CREATE TABLE IF NOT EXISTS vouchers (
      id SERIAL PRIMARY KEY,
      campaign_id INTEGER NOT NULL REFERENCES voucher_campaigns(id) ON DELETE CASCADE,
      code VARCHAR(4) NOT NULL UNIQUE,
      status VARCHAR(12) NOT NULL DEFAULT 'issued',
      bill_id INTEGER REFERENCES sales(id) ON DELETE SET NULL,
      customer_name VARCHAR(120),
      sale_total NUMERIC(14,2),
      issued_at TIMESTAMP DEFAULT LOCALTIMESTAMP,
      redeemed_at TIMESTAMP,
      redeemed_bill_id INTEGER REFERENCES sales(id) ON DELETE SET NULL
    );
  END IF;
END $$;

ALTER TABLE voucher_campaigns ADD COLUMN IF NOT EXISTS min_total NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE voucher_campaigns ADD COLUMN IF NOT EXISTS months INTEGER NOT NULL DEFAULT 5;

CREATE TABLE IF NOT EXISTS voucher_uses (
  id SERIAL PRIMARY KEY,
  voucher_id INTEGER NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  bill_id INTEGER REFERENCES sales(id) ON DELETE SET NULL,
  month_key VARCHAR(7) NOT NULL,
  discount_applied NUMERIC(14,2) NOT NULL DEFAULT 0,
  used_at TIMESTAMP DEFAULT LOCALTIMESTAMP,
  UNIQUE (voucher_id, month_key)
);

INSERT INTO expense_categories (name) VALUES
  ('Rent'),
  ('Utilities'),
  ('Salaries'),
  ('Transport'),
  ('Marketing'),
  ('Office Supplies'),
  ('Maintenance'),
  ('Insurance'),
  ('Taxes'),
  ('Other')
ON CONFLICT (name) DO NOTHING;

INSERT INTO asset_categories (name) VALUES
  ('Equipment'),
  ('Furniture'),
  ('Vehicle'),
  ('Electronics'),
  ('Building'),
  ('Other')
ON CONFLICT (name) DO NOTHING;

INSERT INTO business_document_categories (name) VALUES
  ('Taxation'),
  ('License & Registration'),
  ('Insurance'),
  ('Bank & Finance'),
  ('Purchase Invoices'),
  ('Sales & Clients'),
  ('Warranty & Repair'),
  ('Employee Records'),
  ('Property & Rental'),
  ('Other')
ON CONFLICT (name) DO NOTHING;

INSERT INTO customer_categories (name) VALUES
  ('Retailer'),
  ('Hotel'),
  ('Caterer'),
  ('Distributor'),
  ('Wholesale'),
  ('Other')
ON CONFLICT (name) DO NOTHING;

ALTER TABLE customers ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES customer_categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sales_created ON sales(created_at);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
CREATE INDEX IF NOT EXISTS idx_supplier_purchases_supplier ON supplier_purchases(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_purchases_date ON supplier_purchases(purchased_at);
CREATE INDEX IF NOT EXISTS idx_product_packs_product ON product_packs(product_id);
CREATE INDEX IF NOT EXISTS idx_product_packs_status ON product_packs(status);
CREATE INDEX IF NOT EXISTS idx_vouchers_campaign ON vouchers(campaign_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_status ON vouchers(status);
CREATE INDEX IF NOT EXISTS idx_vouchers_bill ON vouchers(bill_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items(product_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_pack ON sale_items(product_pack_id);
CREATE INDEX IF NOT EXISTS idx_supplier_purchase_items_purchase ON supplier_purchase_items(purchase_id);
CREATE INDEX IF NOT EXISTS idx_supplier_purchase_items_product ON supplier_purchase_items(product_id);
CREATE INDEX IF NOT EXISTS idx_product_packs_product_purchase ON product_packs(product_id, purchase_id);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_voucher_uses_bill ON voucher_uses(bill_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_code ON vouchers(code);
CREATE INDEX IF NOT EXISTS idx_cheques_status ON cheques(status);
CREATE INDEX IF NOT EXISTS idx_cheques_clearing_date ON cheques(clearing_date);
CREATE INDEX IF NOT EXISTS idx_cheques_supplier ON cheques(supplier_id);
CREATE INDEX IF NOT EXISTS idx_cheques_customer ON cheques(customer_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_business_documents_category ON business_documents(category);
CREATE INDEX IF NOT EXISTS idx_customer_prices_product ON customer_prices(product_id);
CREATE INDEX IF NOT EXISTS idx_customer_prices_category ON customer_prices(category_id);
CREATE INDEX IF NOT EXISTS idx_customers_category ON customers(category_id);

ALTER TABLE products ADD COLUMN IF NOT EXISTS market_price NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS market_price NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE supplier_purchases ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE supplier_purchases ADD COLUMN IF NOT EXISTS due_date DATE;

CREATE TABLE IF NOT EXISTS sale_returns (
  id SERIAL PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  invoice_no VARCHAR(120),
  customer VARCHAR(200),
  total_refund NUMERIC(14,2) NOT NULL DEFAULT 0,
  profit NUMERIC(14,2) NOT NULL DEFAULT 0,
  reason TEXT,
  created_at TIMESTAMP DEFAULT LOCALTIMESTAMP
);

-- Must come after the CREATE TABLE above: on a fresh database this ALTER would
-- otherwise fail and roll back the whole schema batch.
ALTER TABLE sale_returns ADD COLUMN IF NOT EXISTS profit NUMERIC(14,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS sale_return_items (
  id SERIAL PRIMARY KEY,
  return_id INTEGER NOT NULL REFERENCES sale_returns(id) ON DELETE CASCADE,
  sale_item_id INTEGER NOT NULL REFERENCES sale_items(id) ON DELETE CASCADE,
  product_id INTEGER,
  product_name VARCHAR(300),
  unit_name VARCHAR(20),
  qty NUMERIC(14,2) NOT NULL,
  unit_price NUMERIC(14,2) NOT NULL,
  refund_amount NUMERIC(14,2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sale_returns_sale ON sale_returns(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_return_items_return ON sale_return_items(return_id);
CREATE INDEX IF NOT EXISTS idx_sale_return_items_sale_item ON sale_return_items(sale_item_id);

-- Brokers are the middlemen goods are sourced from when a supplier is not
-- reachable. An enquiry is a "please send me 2 bags of rice" request that gets
-- WhatsApped to the broker; the items are copied onto the row so the request
-- still reads correctly after the product is renamed or deleted.
CREATE TABLE IF NOT EXISTS brokers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  company_name TEXT,
  phone TEXT NOT NULL,
  area TEXT,
  speciality TEXT,
  detail TEXT,
  created_at TIMESTAMP DEFAULT LOCALTIMESTAMP
);

CREATE TABLE IF NOT EXISTS broker_enquiries (
  id SERIAL PRIMARY KEY,
  broker_id INTEGER NOT NULL REFERENCES brokers(id) ON DELETE CASCADE,
  reference_no VARCHAR(40),
  notes TEXT,
  status VARCHAR(12) NOT NULL DEFAULT 'sent',
  created_at TIMESTAMP DEFAULT LOCALTIMESTAMP
);

CREATE TABLE IF NOT EXISTS broker_enquiry_items (
  id SERIAL PRIMARY KEY,
  enquiry_id INTEGER NOT NULL REFERENCES broker_enquiries(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_name VARCHAR(300) NOT NULL,
  qty NUMERIC(14,2) NOT NULL DEFAULT 1,
  unit_name VARCHAR(30),
  rate NUMERIC(14,2) NOT NULL DEFAULT 0,
  note TEXT
);

CREATE INDEX IF NOT EXISTS idx_broker_enquiries_broker ON broker_enquiries(broker_id);
CREATE INDEX IF NOT EXISTS idx_broker_enquiries_status ON broker_enquiries(status);
CREATE INDEX IF NOT EXISTS idx_broker_enquiry_items_enquiry ON broker_enquiry_items(enquiry_id);

-- Single-row table (id = 1) holding the shop's identity as it appears on receipts,
-- invoices, quotations and vouchers. It used to live in the browser's localStorage,
-- which meant the name/logo/bank details were per-browser and vanished on cache
-- clear -- a second device in the same shop printed a different header.
CREATE TABLE IF NOT EXISTS store_info (
  id INTEGER PRIMARY KEY DEFAULT 1,
  name VARCHAR(200) NOT NULL DEFAULT '',
  address TEXT,
  phone VARCHAR(60),
  logo TEXT,
  qr_code TEXT,
  tax_no VARCHAR(80),
  bank_holder VARCHAR(120),
  bank_name VARCHAR(120),
  bank_account_no VARCHAR(60),
  ifsc VARCHAR(20),
  footer_text TEXT,
  updated_at TIMESTAMP DEFAULT LOCALTIMESTAMP
);
`;

export async function initSchema({ reset = false } = {}) {
  if (reset) await pool.query(DROP_TABLES);
  await pool.query(SCHEMA);
}

export async function mergeDuplicateProducts() {
  const groups = await pool.query(
    `SELECT lower(regexp_replace(trim(name), '\s{2,}', ' ', 'g')) AS norm,
            array_agg(id ORDER BY id) AS ids
     FROM products
     GROUP BY 1
     HAVING COUNT(*) > 1`
  );

  for (const g of groups.rows) {
    const ids = g.ids;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows: prods } = await client.query(
        "SELECT id, stock FROM products WHERE id = ANY($1::int[])",
        [ids]
      );
      let primaryId = prods[0].id;
      let maxStock = Number(prods[0].stock) || 0;
      for (const p of prods) {
        const st = Number(p.stock) || 0;
        if (st > maxStock) {
          maxStock = st;
          primaryId = p.id;
        }
      }
      const dups = ids.filter((i) => i !== primaryId);

      for (const d of dups) {
        await client.query("UPDATE supplier_purchase_items SET product_id = $1 WHERE product_id = $2", [primaryId, d]);
        await client.query("UPDATE product_packs SET product_id = $1 WHERE product_id = $2", [primaryId, d]);
        await client.query("UPDATE sale_items SET product_id = $1 WHERE product_id = $2", [primaryId, d]);
      }

      await client.query(
        `UPDATE products SET
           stock = (SELECT COALESCE(SUM(stock), 0) FROM products WHERE id = ANY($2::int[])),
           selling_price = COALESCE(
             (SELECT MAX(selling_price) FROM products WHERE id = ANY($2::int[]) AND selling_price > 0),
             selling_price
           )
         WHERE id = $1`,
        [primaryId, ids]
      );

      await client.query("DELETE FROM products WHERE id = ANY($1::int[])", [dups]);
      await client.query("COMMIT");
      console.log(`Merged duplicate product "${g.norm}" → product #${primaryId}`);
    } catch (e) {
      await client.query("ROLLBACK");
      console.error(`Failed merging product "${g.norm}":`, e.message);
    } finally {
      client.release();
    }
  }
}

const MEASURING_UNITS = [
  ["Kilogram", "kg", "weight", "kg", 1],
  ["Gram", "g", "weight", "kg", 0.001],
  ["Milligram", "mg", "weight", "kg", 0.000001],
  ["Quintal", "qtl", "weight", "kg", 100],
  ["Metric Ton", "mt", "weight", "kg", 1000],
  ["Pound", "lb", "weight", "kg", 0.453592],
  ["Ounce", "oz", "weight", "kg", 0.0283495],
  ["Tola", "tola", "weight", "kg", 0.0116638],
  ["Pav", "pav", "weight", "kg", 0.125],
  ["250 Gram", "250g", "weight", "kg", 0.25],
  ["500 Gram", "500g", "weight", "kg", 0.5],
  ["Litre", "L", "volume", "L", 1],
  ["Millilitre", "ml", "volume", "L", 0.001],
  ["Gallon", "gal", "volume", "L", 3.78541],
  ["Quart", "qt", "volume", "L", 0.946353],
  ["Pint", "pt", "volume", "L", 0.473176],
  ["Fluid Ounce", "fl oz", "volume", "L", 0.0295735],
  ["Cup", "cup", "volume", "L", 0.236588],
  ["Tablespoon", "tbsp", "volume", "L", 0.0147868],
  ["Teaspoon", "tsp", "volume", "L", 0.00492892],
  ["Centimetre", "cm", "length", "m", 0.01],
  ["Millimetre", "mm", "length", "m", 0.001],
  ["Metre", "m", "length", "m", 1],
  ["Inch", "in", "length", "m", 0.0254],
  ["Foot", "ft", "length", "m", 0.3048],
  ["Yard", "yd", "length", "m", 0.9144],
  ["Piece", "pc", "count", null, 1],
  ["Packet", "pkt", "count", null, 1],
  ["Box", "box", "count", null, 1],
  ["Carton", "ctn", "count", null, 1],
  ["Bag", "bag", "count", null, 1],
  ["Bottle", "btl", "count", null, 1],
  ["Can", "can", "count", null, 1],
  ["Cane", "cane", "count", null, 1],
  ["Dozen", "doz", "count", null, 12],
  ["Pair", "pair", "count", null, 2],
  ["Set", "set", "count", null, 1],
  ["Roll", "roll", "count", null, 1],
  ["Bundle", "bdl", "count", null, 1],
  ["Sack", "sack", "count", null, 1],
  ["Tin", "tin", "count", null, 1],
  ["Jar", "jar", "count", null, 1],
  ["Pouch", "pouch", "count", null, 1],
  ["Bar", "bar", "count", null, 1],
  ["Sheet", "sheet", "count", null, 1]
];

const CATEGORIES = [
  { name: "Groceries", description: "Daily kitchen essentials and staple foods.", stars: 5, subs: ["Rice & Grains", "Flour", "Cooking Oil", "Dairy", "Sugar & Salt"] },
  { name: "Beverages", description: "Tea, coffee, soft drinks and juices.", stars: 4, subs: ["Tea & Coffee", "Soft Drinks", "Water", "Juices"] },
  { name: "Snacks", description: "Chips, biscuits and treats for every craving.", stars: 4, subs: ["Chips", "Biscuits", "Chocolate", "Nuts"] },
  { name: "Household", description: "Cleaning and home care products.", stars: 3, subs: ["Cleaning", "Laundry", "Kitchen"] },
  { name: "Personal Care", description: "Hygiene and grooming essentials.", stars: 4, subs: ["Oral Care", "Hair Care", "Bath & Body"] },
  { name: "Stationery", description: "School and office supplies.", stars: 3, subs: ["Notebooks", "Pens & Pencils"] },
  { name: "Electronics", description: "Small electricals and accessories.", stars: 3, subs: ["Lighting", "Electricals"] }
];

const PRODUCTS = [
  ["Basmati Rice", "G-001", "Groceries", "Rice & Grains", "kg", "kg", 1050, 1350, 0, 15, "HS-1001", "Fine long-grain basmati rice"],
  ["Sugar", "G-002", "Groceries", "Sugar & Salt", "kg", "kg", 125, 155, 0, 40, "HS-1002", "Refined white sugar"],
  ["Cooking Oil", "G-003", "Groceries", "Cooking Oil", "pkt", "L", 1650, 1890, 0, 10, "HS-1003", "Premium cooking oil"],
  ["Wheat Flour", "G-004", "Groceries", "Flour", "kg", "kg", 950, 1180, 0, 8, "HS-1004", "Fine milled wheat flour"],
  ["Milk Powder", "G-005", "Groceries", "Dairy", "pack", "g", 780, 940, 0, 6, "HS-1005", "Full cream milk powder"],
  ["Green Tea", "B-001", "Beverages", "Tea & Coffee", "pack", "g", 420, 540, 0, 12, "HS-2001", "Premium loose green tea"],
  ["Cola", "B-002", "Beverages", "Soft Drinks", "btl", "L", 130, 175, 0, 30, "HS-2002", "Carbonated cola"],
  ["Mineral Water", "B-003", "Beverages", "Water", "btl", "L", 55, 75, 0, 60, "HS-2003", "Packaged drinking water"],
  ["Instant Coffee", "B-004", "Beverages", "Tea & Coffee", "jar", "g", 360, 460, 0, 8, "HS-2004", "Instant coffee granules"],
  ["Fruit Juice", "B-005", "Beverages", "Juices", "pkt", "L", 190, 245, 0, 20, "HS-2005", "Mixed fruit juice"],
  ["Potato Chips", "S-001", "Snacks", "Chips", "pkt", "g", 85, 120, 0, 40, "HS-3001", "Salted potato chips"],
  ["Biscuits", "S-002", "Snacks", "Biscuits", "pack", "pack", 140, 185, 0, 24, "HS-3002", "Cream biscuits family pack"],
  ["Chocolate Bar", "S-003", "Snacks", "Chocolate", "pcs", "g", 110, 150, 0, 50, "HS-3003", "Milk chocolate bar"],
  ["Peanuts", "S-004", "Snacks", "Nuts", "pack", "g", 230, 295, 0, 12, "HS-3004", "Roasted & salted peanuts"],
  ["Dishwash Liquid", "H-001", "Household", "Cleaning", "btl", "ml", 160, 215, 0, 10, "HS-4001", "Lemon scented dishwash"],
  ["Detergent Powder", "H-002", "Household", "Laundry", "pack", "kg", 190, 250, 0, 12, "HS-4002", "Washing detergent powder"],
  ["Floor Cleaner", "H-003", "Household", "Cleaning", "btl", "L", 175, 230, 0, 8, "HS-4003", "Pine floor cleaner"],
  ["Toothpaste", "P-001", "Personal Care", "Oral Care", "tube", "g", 150, 195, 0, 20, "HS-5001", "Herbal toothpaste"],
  ["Shampoo", "P-002", "Personal Care", "Hair Care", "btl", "ml", 260, 340, 0, 10, "HS-5002", "Nourishing shampoo"],
  ["Soap", "P-003", "Personal Care", "Bath & Body", "pack", "pack", 180, 240, 0, 15, "HS-5003", "Bath soaps value pack"],
  ["Notebook", "ST-001", "Stationery", "Notebooks", "pcs", "pc", 90, 130, 0, 20, "HS-6001", "Spiral bound notebook"],
  ["Gel Pen", "ST-002", "Stationery", "Pens & Pencils", "pack", "pc", 85, 120, 0, 25, "HS-6002", "Pack of 10 gel pens"],
  ["LED Bulb", "E-001", "Electronics", "Lighting", "pcs", "pc", 180, 260, 0, 8, "HS-7001", "9W LED bulb"],
  ["Extension Board", "E-002", "Electronics", "Electricals", "pcs", "pc", 550, 720, 0, 4, "HS-7002", "4-outlet extension board"]
];

const SUPPLIERS = [
  { name: "Al-Noor Trading Co.", company: "Al-Noor Trading (Pvt) Ltd", contact: "Imran Ahmed", phone: "0300-1234567", email: "alnoor@example.com", address: "Shop #12, Grain Market, Saddar", detail: "Wholesale grocery supplier.", products: "Rice, flour, cooking oil, sugar" },
  { name: "Pak Foods Wholesale", company: "Pak Foods Distribution (Pvt) Ltd", contact: "Sana Malik", phone: "0321-9876543", email: "pakfoods@example.com", address: "Plot 5, Industrial Area", detail: "Bulk foods distributor.", products: "Flour, dairy, packaged foods" },
  { name: "City Hardware & General", company: "City Hardware & General Store", contact: "Rashid Khan", phone: "0333-5551212", email: "cityhardware@example.com", address: "Main Bazaar, Civil Lines", detail: "Hardware and general store supplies.", products: "Tools, cleaning items, plastics" },
  { name: "Prime Distributors", company: "Prime Distributors (Pvt) Ltd", contact: "Ayesha Siddiqui", phone: "0345-1112233", email: "prime@example.com", address: "Warehouse 3, Port Road", detail: "FMCG brand distributor.", products: "Beverages, snacks, personal care" },
  { name: "Sunrise Beverages", company: "Sunrise Beverages Co.", contact: "Bilal Hussain", phone: "0311-4445566", email: "sunrise@example.com", address: "22-A, Mehran Chowk", detail: "Cold drinks and juices distributor.", products: "Soft drinks, water, juices" },
  { name: "Metro Household", company: "Metro Household Supplies (Pvt) Ltd", contact: "Farah Naz", phone: "0322-7778899", email: "metro@example.com", address: "Shopping Mall, Block C", detail: "Household and cleaning products.", products: "Detergents, cleaners, kitchenware" }
];

const CUSTOMERS = [
  ["Ahmed Raza", "0301-1112233", "raza@gmail.com", "House 4, Street 7, Gulshan", 0],
  ["Fatima Noor", "0302-2223344", "fatima.noor@gmail.com", "Flat 8, Bahria Tower", 30000],
  ["Muhammad Usman", "0303-3334455", "usman@outlook.com", "House 12, Phase 3, DHA", 0],
  ["Zainab Ali", "0304-4445566", "zainab.ali@gmail.com", "Apt 15, Eden Residency", 20000],
  ["Hamza Sheikh", "0305-5556677", "hamza.s@gmail.com", "House 22, Model Town", 0],
  ["Ayesha Begum", "0306-6667788", "ayesha.b@gmail.com", "Street 3, Liaquatabad", 50000],
  ["Omar Farooq", "0307-7778899", "omar.f@gmail.com", "Plot 9, Nazimabad", 0],
  ["Sara Khan", "0308-8889900", "sara.khan@gmail.com", "House 2, Clifton Block 5", 25000]
];

const ASSETS = [
  ["Refrigerator (Display)", "Equipment", "2023-06-15", 85000, 68000, "Good", "Main floor"],
  ["Frozen Section Freezer", "Equipment", "2022-11-02", 120000, 90000, "Good", "Back wall"],
  ["POS Machine Terminal", "Electronics", "2024-01-20", 45000, 40000, "Good", "Counter"],
  ["Weighing Scale", "Equipment", "2023-03-10", 18000, 14000, "Good", "Counter"],
  ["Delivery Van", "Vehicle", "2021-09-30", 750000, 520000, "Fair", "Parking"],
  ["Cash Register", "Electronics", "2023-08-05", 15000, 11000, "Good", "Counter"],
  ["Cart / Baskets Set", "Furniture", "2022-05-18", 25000, 15000, "Fair", "Storefront"],
  ["Shelving Racks", "Furniture", "2022-04-12", 95000, 70000, "Good", "Throughout store"]
];

const EXPENSES = [
  ["Rent", 25000, "Monthly shop rent", "bank", 30],
  ["Utilities", 8500, "Electricity bill", "bank", 28],
  ["Utilities", 3200, "Internet + phone bill", "card", 25],
  ["Salaries", 35000, "Staff salaries", "bank", 28],
  ["Salaries", 18000, "Helper salary", "cash", 28],
  ["Transport", 5000, "Delivery fuel", "cash", 20],
  ["Transport", 3500, "Supplier pickup fare", "cash", 15],
  ["Maintenance", 2000, "AC filter replacement", "cash", 12],
  ["Maintenance", 4500, "Shelf repair", "cash", 8],
  ["Marketing", 6000, "Flyers and banners", "card", 10],
  ["Marketing", 3000, "Social media ads", "online", 7],
  ["Miscellaneous", 1500, "Store supplies", "cash", 5],
  ["Miscellaneous", 2500, "Packaging bags stock", "cash", 3]
];

function pad(n) {
  return String(n).padStart(2, "0");
}

function dtStr(daysAgo, hour, minute) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour || 0, minute || 0, 0, 0);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export async function seed() {
  const { rows: existing } = await pool.query("SELECT COUNT(*) AS c FROM products");
  if (existing[0].c > 0) return;
  const start = Date.now();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const uid = {};
    for (const [name, short, cat, base, factor] of MEASURING_UNITS) {
      const { rows } = await client.query(
        "INSERT INTO measuring_units (name, short_name, category, base_unit, conversion_factor) VALUES ($1,$2,$3,$4,$5) RETURNING id",
        [name, short, cat, base, factor]
      );
      uid[short] = rows[0].id;
    }

    const cid = {}, sid = {};
    for (const c of CATEGORIES) {
      const { rows } = await client.query(
        "INSERT INTO categories (name, description, quality_stars) VALUES ($1,$2,$3) RETURNING id",
        [c.name, c.description, c.stars]
      );
      cid[c.name] = rows[0].id;
      for (const s of c.subs) {
        const { rows: sr } = await client.query(
          "INSERT INTO subcategories (category_id, name) VALUES ($1,$2) RETURNING id",
          [rows[0].id, s]
        );
        sid[`${c.name}:${s}`] = sr[0].id;
      }
    }

    const pid = [];
    for (const [name, sku, cat, sub, unit, uShort, pp, sp, _stock, reorder, hsn, desc] of PRODUCTS) {
      const { rows } = await client.query(
        `INSERT INTO products (name, sku, category_id, subcategory_id, unit, unit_id, purchase_price, selling_price, stock, reorder_level, hsn_code, description)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [name, sku, cid[cat], sid[`${cat}:${sub}`], unit, uid[uShort] || null, pp, sp, 0, reorder, hsn, desc]
      );
      pid.push(rows[0].id);
    }

    const supid = [];
    for (const s of SUPPLIERS) {
      const { rows } = await client.query(
        `INSERT INTO suppliers (name, company_name, contact_person, phone, email, address, detail, products_sold)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [s.name, s.company, s.contact, s.phone, s.email, s.address, s.detail, s.products]
      );
      supid.push(rows[0].id);
    }

    const custid = [];
    for (const c of CUSTOMERS) {
      const { rows } = await client.query(
        "INSERT INTO customers (name, phone, email, address, credit_limit) VALUES ($1,$2,$3,$4,$5) RETURNING id",
        c
      );
      custid.push(rows[0].id);
    }

    for (const a of ASSETS) {
      await client.query(
        "INSERT INTO assets (name, category, purchase_date, purchase_cost, current_value, condition, location) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        a
      );
    }

    for (const [cat, amt, desc, method, daysAgo] of EXPENSES) {
      await client.query(
        "INSERT INTO expenses (category, amount, description, payment_method, date) VALUES ($1,$2,$3,$4,$5)",
        [cat, amt, desc, method, dtStr(daysAgo, 9, 0)]
      );
    }

    const purchases = [
      { supIdx: 0, daysAgo: 12, addl: 500, items: [
        { pi: 0, qty: 10, packSize: 30, subUnit: "kg", tax: 0, discount: 0 },
        { pi: 1, qty: 40, packSize: 1, subUnit: "kg", tax: 0, discount: 0 },
        { pi: 2, qty: 5, packSize: 5, subUnit: "L", tax: 0, discount: 0 },
        { pi: 3, qty: 20, packSize: 5, subUnit: "kg", tax: 0, discount: 0 }
      ]},
      { supIdx: 1, daysAgo: 8, addl: 0, items: [
        { pi: 4, qty: 12, packSize: 6, subUnit: "pack", tax: 5, discount: 0 },
        { pi: 3, qty: 30, packSize: 5, subUnit: "kg", tax: 0, discount: 0 }
      ]},
      { supIdx: 3, daysAgo: 5, addl: 200, items: [
        { pi: 5, qty: 20, packSize: 1, subUnit: "pack", tax: 10, discount: 0 },
        { pi: 10, qty: 50, packSize: 1, subUnit: "pkt", tax: 10, discount: 0 },
        { pi: 11, qty: 30, packSize: 1, subUnit: "pack", tax: 10, discount: 0 }
      ]},
      { supIdx: 4, daysAgo: 3, addl: 0, items: [
        { pi: 6, qty: 80, packSize: 1, subUnit: "btl", tax: 10, discount: 500 },
        { pi: 7, qty: 100, packSize: 1, subUnit: "btl", tax: 5, discount: 0 },
        { pi: 9, qty: 40, packSize: 1, subUnit: "pkt", tax: 10, discount: 200 }
      ]},
      { supIdx: 5, daysAgo: 1, addl: 100, items: [
        { pi: 14, qty: 24, packSize: 1, subUnit: "btl", tax: 0, discount: 0 },
        { pi: 15, qty: 30, packSize: 1, subUnit: "pack", tax: 0, discount: 0 },
        { pi: 16, qty: 18, packSize: 1, subUnit: "btl", tax: 0, discount: 0 }
      ]}
    ];

    const packIdMap = {};
    for (const p of purchases) {
      let grandTotal = 0;
      for (const it of p.items) {
        const pp = Number(PRODUCTS[it.pi][6]);
        const totalQty = it.qty * it.packSize;
        const lineSub = pp * totalQty;
        const lineTax = Math.round(lineSub * it.tax / 100);
        grandTotal += lineSub + lineTax - it.discount;
      }
      grandTotal += p.addl;

      const { rows: spr } = await client.query(
        `INSERT INTO supplier_purchases (supplier_id, additional_charges, grand_total, purchased_at)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [supid[p.supIdx], p.addl, grandTotal, dtStr(p.daysAgo, 10, 0)]
      );
      const spId = spr[0].id;

      for (const it of p.items) {
        const pp = Number(PRODUCTS[it.pi][6]);
        const totalQty = it.qty * it.packSize;
        const uShort = PRODUCTS[it.pi][5];
        const { rows: spi } = await client.query(
          `INSERT INTO supplier_purchase_items
             (purchase_id, product_id, item_name, purchase_price, quantity, unit_id, pack_size, pack_sub_unit, pack_price, hsn_code, tax, discount)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
          [spId, pid[it.pi], PRODUCTS[it.pi][0], pp, totalQty, uid[uShort] || null, it.packSize, it.subUnit, pp, PRODUCTS[it.pi][10], it.tax, it.discount]
        );

        packIdMap[`${spId}:${it.pi}`] = [];
        for (let i = 0; i < it.qty; i++) {
          const { rows: pk } = await client.query(
            `INSERT INTO product_packs (product_id, purchase_id, pack_size, remaining, status)
             VALUES ($1,$2,$3,$4,'closed') RETURNING id`,
            [pid[it.pi], spId, it.packSize, it.packSize]
          );
          packIdMap[`${spId}:${it.pi}`].push(pk[0].id);
        }

        await client.query(
          "UPDATE products SET stock = stock + $1 WHERE id = $2",
          [totalQty, pid[it.pi]]
        );
      }
    }

    const sales = [
      { ci: 0, days: 10, h: 10, m: "cash", items: [{ pi: 0, qty: 25, packKey: "1:0" }, { pi: 1, qty: 1, packKey: "1:1" }] },
      { ci: 1, days: 9, h: 11, m: "card", items: [{ pi: 6, qty: 1, packKey: "4:6" }, { pi: 7, qty: 1, packKey: "4:7" }] },
      { ci: null, days: 8, h: 9, m: "cash", items: [{ pi: 10, qty: 1, packKey: "3:10" }, { pi: 11, qty: 1, packKey: "3:11" }] },
      { ci: 3, days: 7, h: 14, m: "cash", items: [{ pi: 0, qty: 28, packKey: "1:0" }, { pi: 3, qty: 1, packKey: "1:3" }] },
      { ci: null, days: 6, h: 10, m: "cash", items: [{ pi: 14, qty: 1, packKey: "5:14" }, { pi: 15, qty: 1, packKey: "5:15" }] },
      { ci: 5, days: 5, h: 15, m: "card", items: [{ pi: 5, qty: 1, packKey: "3:5" }, { pi: 9, qty: 1, packKey: "4:9" }, { pi: 2, qty: 1, packKey: "1:2" }] },
      { ci: null, days: 4, h: 11, m: "cash", items: [{ pi: 7, qty: 1, packKey: "4:7" }, { pi: 6, qty: 1, packKey: "4:6" }] },
      { ci: 2, days: 3, h: 10, m: "transfer", items: [{ pi: 1, qty: 1, packKey: "1:1" }, { pi: 3, qty: 1, packKey: "2:3" }] },
      { ci: null, days: 2, h: 13, m: "cash", items: [{ pi: 11, qty: 1, packKey: "3:11" }, { pi: 10, qty: 1, packKey: "3:10" }] },
      { ci: 7, days: 1, h: 14, m: "card", items: [{ pi: 6, qty: 1, packKey: "4:6" }, { pi: 7, qty: 1, packKey: "4:7" }, { pi: 9, qty: 1, packKey: "4:9" }] },
      { ci: 4, days: 0, h: 9, m: "cash", items: [{ pi: 0, qty: 15, packKey: "1:0" }, { pi: 15, qty: 1, packKey: "5:15" }] },
      { ci: null, days: 0, h: 11, m: "cash", items: [{ pi: 16, qty: 1, packKey: "5:16" }, { pi: 14, qty: 1, packKey: "5:14" }] },
      { ci: 0, days: 0, h: 14, m: "cash", items: [{ pi: 7, qty: 1, packKey: "4:7" }, { pi: 1, qty: 1, packKey: "1:1" }] }
    ];

    let invNum = 20000;
    const stockDeductions = {};
    for (const pi of pid) stockDeductions[pi] = 0;
    const packUsage = {};

    for (const s of sales) {
      let total = 0;
      const saleItems = [];
      for (const it of s.items) {
        const sp = Number(PRODUCTS[it.pi][7]);
        const pp = Number(PRODUCTS[it.pi][6]);
        const profit = (sp - pp) * it.qty;
        total += sp * it.qty;
        saleItems.push({ pi: it.pi, qty: it.qty, price: sp, pp: pp, profit: profit, packKey: it.packKey });
      }

      const { rows: sr } = await client.query(
        `INSERT INTO sales (invoice_no, customer_id, total, paid, status, payment_method, created_at)
         VALUES ($1,$2,$3,$3,'paid',$4,$5) RETURNING id`,
        [`INV-${String(invNum++).padStart(5, "0")}`, s.ci !== null ? custid[s.ci] : null, total, s.m, dtStr(s.days, s.h, 0)]
      );
      const saleId = sr[0].id;

      for (const it of saleItems) {
        const packs = packIdMap[it.packKey] || [];
        const idx = packUsage[it.packKey] || 0;
        const ppId = idx < packs.length ? packs[idx] : null;
        if (ppId) packUsage[it.packKey] = idx + 1;

        await client.query(
          `INSERT INTO sale_items (sale_id, product_id, product_pack_id, qty, unit_price, unit_id, conversion_factor, purchase_price, profit)
           VALUES ($1,$2,$3,$4,$5,$6,1,$7,$8)`,
          [saleId, pid[it.pi], ppId, it.qty, it.price, uid[PRODUCTS[it.pi][5]] || null, it.pp, it.profit]
        );

        if (ppId) {
          await client.query(
            "UPDATE product_packs SET remaining = remaining - $1, status = CASE WHEN remaining - $1 <= 0 THEN 'empty' WHEN status = 'closed' THEN 'open' ELSE status END, opened_at = CASE WHEN status = 'closed' THEN LOCALTIMESTAMP ELSE opened_at END WHERE id = $2",
            [it.qty, ppId]
          );
        }

        stockDeductions[pid[it.pi]] += it.qty;
      }
    }

    for (const [pi, deduction] of Object.entries(stockDeductions)) {
      if (deduction > 0) {
        await client.query("UPDATE products SET stock = stock - $1 WHERE id = $2", [deduction, Number(pi)]);
      }
    }

    await client.query("COMMIT");
    console.log(`Seeded ${pid.length} products, ${sales.length} sales in ${Date.now() - start}ms`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
