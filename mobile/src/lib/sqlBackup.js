import { now, query, run, transaction } from "../db/index.js";

// Table order: parents first, children after. Mirrors the web app's backup order
// but only includes tables that exist in the offline schema.
export const TABLE_ORDER = [
  "app_meta",
  "measuring_units",
  "categories",
  "subcategories",
  "customer_categories",
  "expense_categories",
  "business_document_categories",
  "voucher_campaigns",
  "suppliers",
  "customers",
  "brokers",
  "products",
  "supplier_purchases",
  "supplier_purchase_items",
  "product_images",
  "product_packs",
  "customer_prices",
  "broker_enquiries",
  "sales",
  "sale_items",
  "sale_returns",
  "sale_return_items",
  "customer_payments",
  "call_notes",
  "stock_removals",
  "vouchers",
  "employees",
  "employee_attendance",
  "employee_payments",
  "employee_documents",
  "tasks",
  "assets",
  "expenses",
  "cheques",
  "business_documents",
  "non_sale_inventory",
  "store_info",
  "audit_log"
];

// Older PostgreSQL dumps used different column names for the same idea. Map
// them onto the offline schema while importing so the data stays useful.
const ALIASES = {
  suppliers: { company_name: "company", detail: "notes" },
  supplier_purchases: { grand_total: "total", paid_amount: "paid" },
  supplier_purchase_items: { quantity: "qty" },
  sale_returns: { total_refund: "amount" },
  expenses: { description: "note", payment_method: "method" },
  non_sale_inventory: {
    quantity_purchased: "qty",
    total_amount: "amount",
    stock_remaining: "remaining"
  },
  product_packs: { pack_size: "qty" },
  stock_removals: { total_qty: "qty", total_value: "value" },
  customer_prices: { category_id: "customer_category_id", selling_price: "price" },
  business_documents: { uploaded_at: "created_at" },
  employees: { designation: "role" },
  employee_payments: { payment_method: "method", note: "notes" },
  voucher_campaigns: { start_date: "valid_from", end_date: "valid_through" },
  brokers: { company_name: "company", detail: "notes" },
  assets: { purchase_cost: "cost", note: "notes" },
  cheques: { issue_date: "cheque_date" }
};

const SKIP_RE = /^(?:BEGIN|COMMIT|ROLLBACK|SET|CREATE\s+TABLE|SELECT\s+pg_catalog\.setval)\b/i;
const IDENT = '(?:"(?:[^"]|"")*"|[A-Za-z_][A-Za-z0-9_$]*)';
const INSERT_RE = new RegExp(
  `^INSERT\\s+INTO\\s+(${IDENT})\\s*\\(\\s*(${IDENT}(?:\\s*,\\s*${IDENT})*)\\s*\\)\\s*VALUES\\s*`,
  "i"
);

function* splitStatements(sql) {
  let buf = "";
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];
    if (inSingle) {
      if (c === "'" && next === "'") { buf += "''"; i += 2; continue; }
      if (c === "'") inSingle = false;
      buf += c; i++; continue;
    }
    if (inDouble) {
      if (c === '"' && next === '"') { buf += '""'; i += 2; continue; }
      if (c === '"') inDouble = false;
      buf += c; i++; continue;
    }
    if (c === "-" && next === "-") { while (i < sql.length && sql[i] !== "\n") i++; continue; }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i += 2; continue;
    }
    if (c === "'") { inSingle = true; buf += c; i++; continue; }
    if (c === '"') { inDouble = true; buf += c; i++; continue; }
    if (c === ";") { yield buf; buf = ""; i++; continue; }
    buf += c; i++;
  }
  if (buf.trim()) yield buf;
}

const parseIdent = (token) => {
  const t = token.trim();
  return t.startsWith('"') ? t.slice(1, -1).replace(/""/g, '"') : t;
};
const skipWs = (s, i) => { while (i < s.length && /\s/.test(s[i])) i++; return i; };

function readQuoted(s, i) {
  let out = "";
  let j = i + 1;
  for (;;) {
    if (j >= s.length) throw new Error("Unterminated string in backup file");
    const c = s[j];
    if (c === "'") {
      if (s[j + 1] === "'") { out += "'"; j += 2; continue; }
      return [out, j + 1];
    }
    out += c; j++;
  }
}

function readValue(s, i) {
  if (s[i] === "'") return readQuoted(s, i);
  let j = i;
  while (j < s.length && !/[,)\s]/.test(s[j])) j++;
  const tok = s.slice(i, j);
  if (!tok) throw new Error(`Unexpected character at position ${i} of the backup file`);
  if (/^null$/i.test(tok)) return [null, j];
  if (/^true$/i.test(tok)) return [true, j];
  if (/^false$/i.test(tok)) return [false, j];
  if (/^[-+]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][-+]?[0-9]+)?$/.test(tok)) return [Number(tok), j];
  throw new Error(`Unsupported value ${JSON.stringify(tok)} in the backup file`);
}

function readValueTuples(s, start) {
  const tuples = [];
  let i = skipWs(s, start);
  for (;;) {
    if (s[i] !== "(") break;
    i++;
    const tuple = [];
    for (;;) {
      i = skipWs(s, i);
      if (s[i] === ")") { i++; break; }
      if (i >= s.length) throw new Error("Unterminated VALUES list in backup file");
      const [value, next] = readValue(s, i);
      tuple.push(value);
      i = skipWs(s, next);
      if (s[i] === ",") { i++; continue; }
      if (s[i] === ")") { i++; break; }
      throw new Error(`Unexpected character ${JSON.stringify(s[i] || "<end>")} in the backup file`);
    }
    tuples.push(tuple);
    i = skipWs(s, i);
    if (s[i] === ",") { i = skipWs(s, i + 1); continue; }
    break;
  }
  if (tuples.length === 0) throw new Error("INSERT statement without VALUES in the backup file");
  return { tuples, end: i };
}

// Yields one INSERT at a time so a large dump never has every parsed statement
// and every parsed row held in memory at once.
export function* parseSqlBackup(sql) {
  for (const raw of splitStatements(String(sql || ""))) {
    const stmt = raw.trim();
    if (!stmt || SKIP_RE.test(stmt)) continue;
    const m = INSERT_RE.exec(stmt);
    if (!m) {
      throw new Error(
        `"${stmt.replace(/\s+/g, " ").slice(0, 40)}" is not supported. ` +
          "Only SQL files created by this app's Download SQL backup button can be imported."
      );
    }
    const table = parseIdent(m[1]);
    const columns = m[2].split(",").map(parseIdent);
    const { tuples, end } = readValueTuples(stmt, m[0].length);
    if (stmt.slice(end).trim()) throw new Error(`Unexpected text after VALUES in an INSERT into "${table}"`);
    yield { table, columns, tuples };
  }
}

async function tableMeta() {
  const rows = await query("SELECT name FROM sqlite_master WHERE type = 'table'");
  const map = new Map();
  for (const { name } of rows) {
    if (name === "sqlite_sequence") continue;
    const cols = await query(`PRAGMA table_info("${name.replace(/"/g, '""')}")`);
    map.set(
      name,
      new Map(
        cols.map((c) => [
          c.name,
          { notnull: !!c.notnull, dflt: c.dflt_value, type: String(c.type || "") }
        ])
      )
    );
  }
  return map;
}

async function tableColumns() {
  const meta = await tableMeta();
  return new Map([...meta].map(([table, cols]) => [table, new Set(cols.keys())]));
}

const toSqlite = (v) => {
  if (v === true) return 1;
  if (v === false) return 0;
  return v;
};

async function syncInvoiceSeq() {
  const invoiceRows = await query("SELECT invoice_no FROM sales");
  let maxSeq = 0;
  for (const r of invoiceRows) {
    const digits = String(r.invoice_no || "").match(/(\d+)\s*$/);
    if (digits) maxSeq = Math.max(maxSeq, Number(digits[1]));
  }
  await run(
    "INSERT INTO app_meta (key, value) VALUES ('invoice_seq', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [String(maxSeq)]
  );
}

/** Replace the offline database with the contents of a web-app SQL dump. */
export async function importSqlBackup(sql, { wipe = true } = {}) {
  const meta = await tableMeta();
  const known = new Map([...meta].map(([table, cols]) => [table, new Set(cols.keys())]));
  const grouped = new Map();
  let skippedTables = 0;
  let totalRows = 0;
  let sawInsert = false;
  for (const ins of parseSqlBackup(sql)) {
    sawInsert = true;
    const cols = known.get(ins.table);
    if (!cols) { skippedTables += 1; continue; }
    const aliases = ALIASES[ins.table] || {};
    const mapped = ins.columns.map((c) => aliases[c] || c);
    if (!mapped.some((c) => cols.has(c))) { skippedTables += 1; continue; }
    if (!grouped.has(ins.table)) grouped.set(ins.table, []);
    const rows = grouped.get(ins.table);
    for (const tuple of ins.tuples) {
      if (tuple.length !== ins.columns.length) {
        throw new Error(`A row for "${ins.table}" has ${tuple.length} values but ${ins.columns.length} columns.`);
      }
      const row = {};
      mapped.forEach((column, i) => {
        if (cols.has(column)) row[column] = toSqlite(tuple[i]);
      });
      if (Object.keys(row).length) {
        rows.push(row);
        totalRows += 1;
      }
    }
  }
  if (!sawInsert) throw new Error("No data rows found in that file.");
  if (!grouped.size) throw new Error("None of the tables in that file match this app.");

  await transaction(async () => {
    if (wipe) {
      for (const table of [...TABLE_ORDER].reverse()) {
        if (known.has(table)) await run(`DELETE FROM "${table}"`);
      }
    }
    for (const table of TABLE_ORDER) {
      const rows = grouped.get(table);
      if (!rows?.length) continue;
      if (table === "sales") {
        const seen = new Set();
        rows.forEach((row, index) => {
          let invoice = String(row.invoice_no ?? "").trim();
          if (!invoice || seen.has(invoice)) {
            invoice = `INV-IMP-${row.id ?? index + 1}`;
            while (seen.has(invoice)) invoice += "X";
          }
          seen.add(invoice);
          row.invoice_no = invoice;
        });
      }
      const tableMetaMap = meta.get(table);
      if (!tableMetaMap) continue;
      const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) =>
        tableMetaMap.has(k)
      );
      if (!keys.length) continue;
      for (const row of rows) {
        const rowKeys = [];
        const values = [];
        for (const key of keys) {
          const column = tableMetaMap.get(key);
          let value = row[key];
          if (value === undefined || value === null) {
            if (!column.notnull) continue;
            if (column.dflt !== null && column.dflt !== undefined) continue;
            value = /INT|REAL|NUM|DOUBLE|FLOAT|DECIMAL/i.test(column.type) ? 0 : "";
          }
          rowKeys.push(key);
          values.push(value);
        }
        if (!rowKeys.length) continue;
        await run(
          `INSERT INTO "${table}" (${rowKeys.map((k) => `"${k.replace(/"/g, '""')}"`).join(", ")})
           VALUES (${rowKeys.map(() => "?").join(", ")})`,
          values
        );
      }
    }

    // Fill in the derived columns the web schema did not store.
    await run(
      `UPDATE sale_items SET product_name = COALESCE(
         NULLIF(product_name, ''),
         (SELECT name FROM products WHERE products.id = sale_items.product_id),
         'Item'
       )`
    );
    await run("UPDATE sale_items SET line_total = ROUND(qty * unit_price, 2) WHERE line_total = 0");
    await run(
      `UPDATE sales SET subtotal = COALESCE(
         (SELECT SUM(line_total) FROM sale_items WHERE sale_items.sale_id = sales.id), 0
       ) WHERE subtotal = 0`
    );
    await run(
      `UPDATE sales SET customer_name = COALESCE(
         NULLIF(customer_name, ''),
         (SELECT name FROM customers WHERE customers.id = sales.customer_id),
         ''
       ) WHERE customer_name = ''`
    );
    await run(
      "UPDATE supplier_purchase_items SET line_total = ROUND(qty * purchase_price, 2) WHERE line_total = 0"
    );
    await run(
      `UPDATE supplier_purchases SET subtotal = COALESCE(
         (SELECT SUM(line_total) FROM supplier_purchase_items
          WHERE supplier_purchase_items.purchase_id = supplier_purchases.id), total
       ) WHERE subtotal = 0`
    );

    // Keep the invoice counter ahead of imported invoice numbers.
    await syncInvoiceSeq();
    await run("INSERT INTO audit_log (action, entity, detail) VALUES ('backup.import','backup',?)", [
      `Imported ${totalRows} rows`
    ]);
  });

  return {
    tables: [...grouped.entries()].map(([table, rows]) => ({ table, rows: rows.length })),
    totalRows,
    skippedTables
  };
}

const sqlQuote = (v) => {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  return `'${String(v).replace(/'/g, "''")}'`;
};

/** Dump the offline database to the same SQL dialect the web app exports. */
export async function exportSql() {
  const lines = [
    "-- Barkaati Inventory offline backup",
    `-- Generated: ${now()}`,
    "BEGIN;",
    ""
  ];
  for (const table of TABLE_ORDER) {
    const cols = await query(`PRAGMA table_info("${table}")`);
    if (!cols.length) continue;
    const names = cols.map((c) => c.name);
    const rows = await query(`SELECT * FROM "${table}"`);
    if (!rows.length) continue;
    lines.push(`-- Table: ${table}`);
    for (const row of rows) {
      const values = names.map((n) => sqlQuote(row[n])).join(", ");
      lines.push(`INSERT INTO "${table}" (${names.map((n) => `"${n}"`).join(", ")}) VALUES (${values});`);
    }
    lines.push("");
  }
  lines.push("COMMIT;", "");
  return lines.join("\n");
}

export async function allTableRows() {
  const out = {};
  for (const table of TABLE_ORDER) {
    try {
      out[table] = await query(`SELECT * FROM "${table}"`);
    } catch {
      out[table] = [];
    }
  }
  return out;
}

export async function importTableRows(tables, { wipe = true } = {}) {
  const known = await tableColumns();
  let total = 0;
  await transaction(async () => {
    if (wipe) {
      for (const table of [...TABLE_ORDER].reverse()) {
        if (known.has(table)) await run(`DELETE FROM "${table}"`);
      }
    }
    for (const table of TABLE_ORDER) {
      const rows = tables[table];
      if (!Array.isArray(rows) || !rows.length || !known.has(table)) continue;
      const cols = known.get(table);
      for (const row of rows) {
        const keys = Object.keys(row).filter((k) => cols.has(k));
        if (!keys.length) continue;
        await run(
          `INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`,
          keys.map((k) => toSqlite(row[k]))
        );
        total += 1;
      }
    }
    await syncInvoiceSeq();
  });
  return total;
}
