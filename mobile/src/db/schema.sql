-- Barkaati Inventory — offline schema (SQLite / SQLCipher)
-- Money is REAL, timestamps are shop-local wall-clock text.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS store_info (
  id                     INTEGER PRIMARY KEY CHECK (id = 1),
  name                   TEXT DEFAULT '',
  address                TEXT DEFAULT '',
  phone                  TEXT DEFAULT '',
  logo                   TEXT DEFAULT '',
  qr_code                TEXT DEFAULT '',
  tax_no                 TEXT DEFAULT '',
  bank_holder            TEXT DEFAULT '',
  bank_name              TEXT DEFAULT '',
  bank_account_no        TEXT DEFAULT '',
  ifsc                   TEXT DEFAULT '',
  upi_id                 TEXT DEFAULT '',
  footer_text            TEXT DEFAULT '',
  tagline                TEXT DEFAULT '',
  whatsapp_number        TEXT DEFAULT '',
  delivery_fee           REAL NOT NULL DEFAULT 0,
  online_store_enabled   INTEGER NOT NULL DEFAULT 1,
  online_store_url       TEXT DEFAULT '',
  action_password        TEXT,
  action_password_enabled INTEGER NOT NULL DEFAULT 0,
  printer_name           TEXT DEFAULT '',
  printer_address        TEXT DEFAULT '',
  paper_width_mm         INTEGER NOT NULL DEFAULT 58,
  updated_at             TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  created_at  TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS subcategories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  quality_stars INTEGER NOT NULL DEFAULT 0,
  UNIQUE (category_id, name)
);

CREATE TABLE IF NOT EXISTS measuring_units (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT NOT NULL,
  short_name        TEXT DEFAULT '',
  category          TEXT DEFAULT 'count',
  conversion_factor REAL NOT NULL DEFAULT 1,
  created_at        TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS products (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  sku            TEXT DEFAULT '',
  barcode        TEXT DEFAULT '',
  unit           TEXT DEFAULT 'pcs',
  unit_id        INTEGER REFERENCES measuring_units(id) ON DELETE SET NULL,
  category_id    INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  subcategory_id INTEGER REFERENCES subcategories(id) ON DELETE SET NULL,
  selling_price  REAL NOT NULL DEFAULT 0,
  market_price   REAL NOT NULL DEFAULT 0,
  purchase_price REAL NOT NULL DEFAULT 0,
  tax            REAL NOT NULL DEFAULT 0,
  discount       REAL NOT NULL DEFAULT 0,
  hsn_code       TEXT DEFAULT '',
  description    TEXT DEFAULT '',
  reorder_level  REAL NOT NULL DEFAULT 0,
  stock          REAL NOT NULL DEFAULT 0,
  online         INTEGER NOT NULL DEFAULT 1,
  oversold_qty   REAL NOT NULL DEFAULT 0,
  created_at     TEXT DEFAULT (datetime('now','localtime')),
  updated_at     TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);

CREATE TABLE IF NOT EXISTS product_images (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id);

CREATE TABLE IF NOT EXISTS weight_barcodes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  weight_g   REAL NOT NULL CHECK (weight_g > 0),
  barcode    TEXT NOT NULL UNIQUE,
  copies     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_weight_barcodes_weight ON weight_barcodes(weight_g);
CREATE INDEX IF NOT EXISTS idx_weight_barcodes_barcode ON weight_barcodes(barcode);

CREATE TABLE IF NOT EXISTS customer_categories (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS customers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  phone       TEXT DEFAULT '',
  email       TEXT DEFAULT '',
  address     TEXT DEFAULT '',
  credit_limit REAL NOT NULL DEFAULT 0,
  category_id INTEGER REFERENCES customer_categories(id) ON DELETE SET NULL,
  notes       TEXT DEFAULT '',
  created_at  TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);

CREATE TABLE IF NOT EXISTS customer_prices (
  product_id          INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  customer_category_id INTEGER NOT NULL REFERENCES customer_categories(id) ON DELETE CASCADE,
  price               REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, customer_category_id)
);

CREATE TABLE IF NOT EXISTS suppliers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  company    TEXT DEFAULT '',
  phone      TEXT DEFAULT '',
  email      TEXT DEFAULT '',
  address    TEXT DEFAULT '',
  notes      TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS supplier_purchases (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id       INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  invoice_no        TEXT DEFAULT '',
  purchased_at      TEXT DEFAULT (datetime('now','localtime')),
  due_date          TEXT DEFAULT '',
  subtotal          REAL NOT NULL DEFAULT 0,
  discount          REAL NOT NULL DEFAULT 0,
  tax               REAL NOT NULL DEFAULT 0,
  additional_charges REAL NOT NULL DEFAULT 0,
  total             REAL NOT NULL DEFAULT 0,
  paid              REAL NOT NULL DEFAULT 0,
  payment_method    TEXT DEFAULT 'cash',
  bill_image        TEXT DEFAULT '',
  notes             TEXT DEFAULT '',
  created_at        TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS supplier_purchase_items (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id    INTEGER NOT NULL REFERENCES supplier_purchases(id) ON DELETE CASCADE,
  product_id     INTEGER REFERENCES products(id) ON DELETE SET NULL,
  item_name      TEXT DEFAULT '',
  hsn_code       TEXT DEFAULT '',
  qty            REAL NOT NULL DEFAULT 0,
  unit           TEXT DEFAULT 'pcs',
  purchase_price REAL NOT NULL DEFAULT 0,
  discount       REAL NOT NULL DEFAULT 0,
  tax            REAL NOT NULL DEFAULT 0,
  line_total     REAL NOT NULL DEFAULT 0,
  created_at     TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS product_packs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  purchase_id  INTEGER REFERENCES supplier_purchases(id) ON DELETE SET NULL,
  qty          REAL NOT NULL DEFAULT 0,
  remaining    REAL NOT NULL DEFAULT 0,
  unit_cost    REAL NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'open',
  created_at   TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_packs_product ON product_packs(product_id);

CREATE TABLE IF NOT EXISTS sales (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no            TEXT NOT NULL UNIQUE,
  customer_id           INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  customer_name         TEXT DEFAULT '',
  customer_phone        TEXT DEFAULT '',
  subtotal              REAL NOT NULL DEFAULT 0,
  discount              REAL NOT NULL DEFAULT 0,
  tax                   REAL NOT NULL DEFAULT 0,
  total                 REAL NOT NULL DEFAULT 0,
  paid                  REAL NOT NULL DEFAULT 0,
  status                TEXT NOT NULL DEFAULT 'paid',
  payment_method        TEXT NOT NULL DEFAULT 'cash',
  note                  TEXT DEFAULT '',
  channel               TEXT NOT NULL DEFAULT 'counter',
  online_customer_name  TEXT DEFAULT '',
  online_customer_phone TEXT DEFAULT '',
  online_delivery_type  TEXT DEFAULT '',
  online_address        TEXT DEFAULT '',
  voucher_id            INTEGER,
  bill_image            TEXT DEFAULT '',
  created_at            TEXT DEFAULT (datetime('now','localtime')),
  updated_at            TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_sales_created ON sales(created_at);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(status);

CREATE TABLE IF NOT EXISTS sale_items (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id           INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id        INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_name      TEXT DEFAULT '',
  qty               REAL NOT NULL DEFAULT 0,
  unit_price        REAL NOT NULL DEFAULT 0,
  market_price      REAL NOT NULL DEFAULT 0,
  unit_id           INTEGER,
  unit_name         TEXT DEFAULT '',
  conversion_factor REAL NOT NULL DEFAULT 1,
  purchase_price    REAL NOT NULL DEFAULT 0,
  profit            REAL NOT NULL DEFAULT 0,
  hsn_code          TEXT DEFAULT '',
  tax               REAL NOT NULL DEFAULT 0,
  tax_amt           REAL NOT NULL DEFAULT 0,
  line_total        REAL NOT NULL DEFAULT 0,
  oversold_qty      REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items(product_id);

CREATE TABLE IF NOT EXISTS sale_returns (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id     INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  amount      REAL NOT NULL DEFAULT 0,
  profit      REAL NOT NULL DEFAULT 0,
  reason      TEXT DEFAULT '',
  created_at  TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sale_return_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id     INTEGER NOT NULL REFERENCES sale_returns(id) ON DELETE CASCADE,
  sale_item_id  INTEGER REFERENCES sale_items(id) ON DELETE SET NULL,
  product_id    INTEGER REFERENCES products(id) ON DELETE SET NULL,
  qty           REAL NOT NULL DEFAULT 0,
  unit_price    REAL NOT NULL DEFAULT 0,
  line_total    REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS customer_payments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  sale_id     INTEGER REFERENCES sales(id) ON DELETE SET NULL,
  amount      REAL NOT NULL DEFAULT 0,
  method      TEXT NOT NULL DEFAULT 'cash',
  note        TEXT DEFAULT '',
  paid_on     TEXT DEFAULT (date('now','localtime')),
  created_at  TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_customer_payments_customer ON customer_payments(customer_id);

CREATE TABLE IF NOT EXISTS stock_removals (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id   INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT DEFAULT '',
  qty          REAL NOT NULL DEFAULT 0,
  unit_cost    REAL NOT NULL DEFAULT 0,
  value        REAL NOT NULL DEFAULT 0,
  reason       TEXT DEFAULT '',
  created_at   TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS expense_categories (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS expenses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER REFERENCES expense_categories(id) ON DELETE SET NULL,
  category    TEXT DEFAULT '',
  amount      REAL NOT NULL DEFAULT 0,
  method      TEXT NOT NULL DEFAULT 'cash',
  note        TEXT DEFAULT '',
  date        TEXT DEFAULT (date('now','localtime')),
  created_at  TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);

CREATE TABLE IF NOT EXISTS non_sale_inventory (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  size         TEXT DEFAULT '',
  unit         TEXT DEFAULT 'pcs',
  qty          REAL NOT NULL DEFAULT 0,
  remaining    REAL NOT NULL DEFAULT 0,
  amount       REAL NOT NULL DEFAULT 0,
  purchase_date TEXT DEFAULT (date('now','localtime')),
  notes        TEXT DEFAULT '',
  created_at   TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS asset_categories (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS assets (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  category       TEXT DEFAULT '',
  purchase_date  TEXT DEFAULT (date('now','localtime')),
  cost           REAL NOT NULL DEFAULT 0,
  current_value  REAL NOT NULL DEFAULT 0,
  condition      TEXT DEFAULT 'good',
  location       TEXT DEFAULT '',
  notes          TEXT DEFAULT '',
  created_at     TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS cheques (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  cheque_no   TEXT DEFAULT '',
  bank_name   TEXT DEFAULT '',
  drawer_name TEXT DEFAULT '',
  payee       TEXT DEFAULT '',
  amount      REAL NOT NULL DEFAULT 0,
  cheque_date TEXT DEFAULT (date('now','localtime')),
  clearing_date TEXT DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'pending',
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  notes       TEXT DEFAULT '',
  created_at  TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  description TEXT DEFAULT '',
  priority    TEXT NOT NULL DEFAULT 'normal',
  due_date    TEXT DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'pending',
  completed_at TEXT DEFAULT '',
  created_at  TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS call_notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_name TEXT DEFAULT '',
  phone       TEXT DEFAULT '',
  note        TEXT DEFAULT '',
  call_back_at TEXT DEFAULT '',
  priority    TEXT NOT NULL DEFAULT 'normal',
  status      TEXT NOT NULL DEFAULT 'pending',
  created_at  TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS business_document_categories (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS business_documents (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  category    TEXT DEFAULT 'Other',
  file_path   TEXT DEFAULT '',
  file_type   TEXT DEFAULT '',
  file_size   INTEGER NOT NULL DEFAULT 0,
  notes       TEXT DEFAULT '',
  created_at  TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS employees (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  phone         TEXT DEFAULT '',
  email         TEXT DEFAULT '',
  address       TEXT DEFAULT '',
  role          TEXT DEFAULT '',
  designation   TEXT DEFAULT '',
  salary_type   TEXT NOT NULL DEFAULT 'salary',
  salary_rate   REAL NOT NULL DEFAULT 0,
  starting_date TEXT DEFAULT '',
  joining_date  TEXT DEFAULT '',
  rank          TEXT NOT NULL DEFAULT 'noob',
  stars         INTEGER NOT NULL DEFAULT 1,
  shift_start   TEXT DEFAULT '',
  shift_end     TEXT DEFAULT '',
  pf_enabled    INTEGER NOT NULL DEFAULT 0,
  pf_rate       REAL NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'active',
  last_working_date TEXT DEFAULT '',
  bank_name     TEXT DEFAULT '',
  bank_account_no TEXT DEFAULT '',
  bank_ifsc     TEXT DEFAULT '',
  upi_id        TEXT DEFAULT '',
  date_of_birth TEXT DEFAULT '',
  emergency_contact_name TEXT DEFAULT '',
  emergency_contact_phone TEXT DEFAULT '',
  id_proof_type TEXT DEFAULT '',
  id_proof_number TEXT DEFAULT '',
  photo_path    TEXT DEFAULT '',
  notes         TEXT DEFAULT '',
  created_at    TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS employee_attendance (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'present',
  time_in     TEXT DEFAULT '',
  time_out    TEXT DEFAULT '',
  notes       TEXT DEFAULT '',
  UNIQUE (employee_id, date)
);

CREATE TABLE IF NOT EXISTS employee_payments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type        TEXT NOT NULL DEFAULT 'salary',
  amount      REAL NOT NULL DEFAULT 0,
  date        TEXT DEFAULT (date('now','localtime')),
  method      TEXT NOT NULL DEFAULT 'cash',
  notes       TEXT DEFAULT '',
  created_at  TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS employee_documents (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  category    TEXT DEFAULT 'Other',
  label       TEXT DEFAULT '',
  file_path   TEXT DEFAULT '',
  file_type   TEXT DEFAULT '',
  file_size   INTEGER NOT NULL DEFAULT 0,
  uploaded_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS employee_payrolls (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id  INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  month        TEXT NOT NULL,
  accrual      REAL NOT NULL DEFAULT 0,
  pf_employee  REAL NOT NULL DEFAULT 0,
  pf_employer  REAL NOT NULL DEFAULT 0,
  paid_before  REAL NOT NULL DEFAULT 0,
  net_payable  REAL NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'finalized',
  finalized_at TEXT DEFAULT (datetime('now','localtime')),
  paid_at      TEXT DEFAULT '',
  note         TEXT DEFAULT '',
  UNIQUE (employee_id, month)
);

CREATE TABLE IF NOT EXISTS voucher_campaigns (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  discount_type   TEXT NOT NULL DEFAULT 'percent',
  discount_value  REAL NOT NULL DEFAULT 0,
  min_total       REAL NOT NULL DEFAULT 0,
  valid_from      TEXT DEFAULT '',
  valid_through   TEXT DEFAULT '',
  months          INTEGER NOT NULL DEFAULT 1,
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS vouchers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id   INTEGER REFERENCES voucher_campaigns(id) ON DELETE SET NULL,
  campaign_name TEXT DEFAULT '',
  code          TEXT NOT NULL UNIQUE,
  customer_id   INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  customer_name TEXT DEFAULT '',
  discount_type TEXT NOT NULL DEFAULT 'percent',
  discount_value REAL NOT NULL DEFAULT 0,
  min_total     REAL NOT NULL DEFAULT 0,
  valid_from    TEXT DEFAULT '',
  valid_through TEXT DEFAULT '',
  months        INTEGER NOT NULL DEFAULT 1,
  uses_left     INTEGER NOT NULL DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS brokers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  phone      TEXT DEFAULT '',
  company    TEXT DEFAULT '',
  address    TEXT DEFAULT '',
  notes      TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS broker_enquiries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  broker_id   INTEGER REFERENCES brokers(id) ON DELETE SET NULL,
  reference_no TEXT DEFAULT '',
  product_name TEXT DEFAULT '',
  qty         REAL NOT NULL DEFAULT 0,
  unit        TEXT DEFAULT 'pcs',
  status      TEXT NOT NULL DEFAULT 'pending',
  notes       TEXT DEFAULT '',
  created_at  TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  action     TEXT NOT NULL,
  entity     TEXT DEFAULT '',
  entity_id  INTEGER,
  detail     TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

INSERT OR IGNORE INTO store_info (id, name) VALUES (1, 'Barkaati Tech');
INSERT OR IGNORE INTO expense_categories (name) VALUES ('Rent'), ('Utilities'), ('Salaries'), ('Transport'), ('Other');
INSERT OR IGNORE INTO customer_categories (name) VALUES ('Retail'), ('Wholesale'), ('VIP');
