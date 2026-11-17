import { recalcSaleProfits } from "./db.js";

// Parents must come before the tables that reference them, otherwise a dump
// cannot be replayed in order (sale_return_items before sale_returns and
// vouchers before sales both failed on restore).
const TABLE_ORDER = [
  "measuring_units",
  "categories",
  "subcategories",
  "customer_categories",
  "asset_categories",
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
  "broker_enquiries",
  "broker_enquiry_items",
  "sales",
  "sale_items",
  "sale_returns",
  "sale_return_items",
  "customer_payments",
  "call_notes",
  "stock_removals",
  "stock_removal_items",
  "vouchers",
  "voucher_uses",
  "purchases",
  "purchase_items",
  "employees",
  "tasks",
  "assets",
  "expenses",
  "cheques",
  "business_documents"
];

const QUOTED_TYPES = new Set([
  "character varying",
  "character",
  "text",
  "name",
  "timestamp without time zone",
  "timestamp with time zone",
  "time without time zone",
  "time with time zone",
  "date",
  "interval",
  "uuid",
  "inet",
  "cidr",
  "macaddr",
  "json",
  "jsonb",
  "xml",
  "bit",
  "bit varying",
  "bytea"
]);

const PAGER_SIZE = 2000;

function ident(s) {
  return `"${String(s).replace(/"/g, '""')}"`;
}

function sqlQuote(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

function cellValue(v, type) {
  if (v === null || v === undefined) return "NULL";
  const s = String(v);
  if (type === "boolean") return s === "t" ? "true" : s === "f" ? "false" : s;
  if (QUOTED_TYPES.has(type) || QUOTED_TYPES.has(type.split(" ")[0])) return sqlQuote(s);
  return /^[-+]?[0-9]+(\.[0-9]+)?$/.test(s) ? s : sqlQuote(s);
}

// Transient tables that must not be dumped: sync_changes is a device sync queue
// that is rebuilt on the fly and can hold tens of millions of rows of JSONB,
// dominating both dump size and time.
const EXCLUDED_FROM_BACKUP = new Set(["sync_changes"]);

async function listTables(pool) {
  const { rows } = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
  );
  const present = new Set(
    rows.map((r) => r.table_name).filter((t) => !EXCLUDED_FROM_BACKUP.has(t))
  );
  const ordered = TABLE_ORDER.filter((t) => present.has(t));
  const extra = [...present].filter((t) => !TABLE_ORDER.includes(t)).sort();
  return [...ordered, ...extra];
}

async function tableColumns(pool, table) {
  const { rows } = await pool.query(
    `SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [table]
  );
  return rows.map((c) => ({
    name: c.column_name,
    data_type: c.data_type,
    is_nullable: c.is_nullable,
    column_default: c.column_default
  }));
}

async function primaryKey(pool, table) {
  const { rows } = await pool.query(
    `SELECT kcu.column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
     WHERE tc.table_schema = 'public' AND tc.table_name = $1 AND tc.constraint_type = 'PRIMARY KEY'
     ORDER BY kcu.ordinal_position`,
    [table]
  );
  return rows.map((r) => r.column_name);
}

function serialKind(def) {
  const m = def && def.match(/^nextval\(.+\)$/);
  return m ? true : false;
}

function tableDdl(table, columns, pk) {
  const lines = columns.map((c) => {
    const name = ident(c.name);
    if (serialKind(c.column_default)) {
      const kind = c.data_type === "bigint" ? "BIGSERIAL" : c.data_type === "smallint" ? "SMALLSERIAL" : "SERIAL";
      return `  ${name} ${kind}`;
    }
    let line = `  ${name} ${c.data_type}`;
    if (c.column_default) line += ` DEFAULT ${c.column_default}`;
    if (c.is_nullable === "NO" && !pk.includes(c.name)) line += " NOT NULL";
    return line;
  });
  if (pk.length) lines.push(`  PRIMARY KEY (${pk.map(ident).join(", ")})`);
  return `CREATE TABLE IF NOT EXISTS ${ident(table)} (\n${lines.join(",\n")}\n);`;
}

async function* rowsOf(pool, table, columns, pk = []) {
  const cols = columns.map((c) => `${ident(c.name)}::text AS ${ident(c.name)}`).join(", ");
  const key = pk.length === 1 ? pk[0] : null;

  // Keyset paging on the primary key. The old OFFSET form had to sort the
  // whole table on every page because the selected key was cast to text;
  // on a sales table with tens of millions of rows a backup never finished.
  if (key) {
    // Qualify the key: the SELECT list aliases the text-cast column to the same
    // name, and an unqualified ORDER BY would sort by that text expression
    // instead of the real (indexed) primary-key column.
    const keyRef = `${ident(table)}.${ident(key)}`;
    let last = null;
    for (;;) {
      const { rows } = await pool.query(
        last === null
          ? `SELECT ${cols} FROM ${ident(table)} ORDER BY ${keyRef} LIMIT $1`
          : `SELECT ${cols} FROM ${ident(table)}
              WHERE ${keyRef} > $2 ORDER BY ${keyRef} LIMIT $1`,
        last === null ? [PAGER_SIZE] : [PAGER_SIZE, last]
      );
      if (rows.length === 0) break;
      for (const r of rows) yield r;
      if (rows.length < PAGER_SIZE) break;
      last = rows[rows.length - 1][key];
    }
    return;
  }

  // Composite/no primary key: keep the old fallback. No current table needs it.
  let offset = 0;
  for (;;) {
    const { rows } = await pool.query(
      `SELECT ${cols} FROM ${ident(table)} ORDER BY 1 OFFSET $1 LIMIT $2`,
      [offset, PAGER_SIZE]
    );
    if (rows.length === 0) break;
    for (const r of rows) yield r;
    offset += rows.length;
    if (rows.length < PAGER_SIZE) break;
  }
}

function writeTo(res) {
  const write = (chunk) =>
    new Promise((resolve, reject) => {
      if (res.writableEnded || res.destroyed) return resolve(false);
      res.write(chunk, (err) => (err ? reject(err) : resolve(true)));
    });
  return write;
}

export async function streamSqlBackup(pool, res) {
  const tables = await listTables(pool);
  const meta = await Promise.all(
    tables.map(async (t) => {
      const [columns, pk] = await Promise.all([tableColumns(pool, t), primaryKey(pool, t)]);
      return { columns, pk };
    })
  );

  const dbName = (res.req.headers.host || "") && process.env.PGDATABASE ? process.env.PGDATABASE : "store_master";
  const stamp = new Date().toISOString();

  res.status(200);
  res.setHeader("Content-Type", "application/sql; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="storemanager-backup-${stamp.slice(0, 10)}.sql"`
  );
  res.setHeader("Cache-Control", "no-store");

  const write = writeTo(res);

  await write(`-- Store Manager database backup
-- Generated: ${stamp}
-- Database: ${dbName}
-- Restore: psql -U postgres -d store_master -f "${stamp.slice(0, 10)}.sql"

BEGIN;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;

`);

  for (let i = 0; i < tables.length; i++) {
    const table = tables[i];
    const { columns, pk } = meta[i];

    await write(`--\n-- Table: ${table}\n--\n\n`);
    await write(`${tableDdl(table, columns, pk)}\n\n`);

    const colList = columns.map((c) => ident(c.name)).join(", ");
    const insertHead = `INSERT INTO ${ident(table)} (${colList}) VALUES (`;
    let any = false;
    for await (const row of rowsOf(pool, table, columns)) {
      const values = columns.map((c) => cellValue(row[c.name], c.data_type)).join(", ");
      await write(`${insertHead}${values});\n`);
      any = true;
    }
    if (any) await write("\n");

    const idCol = columns.find((c) => c.name === "id");
    if (idCol) {
      await write(
        `SELECT pg_catalog.setval(pg_catalog.pg_get_serial_sequence(${sqlQuote(table)}, 'id'), GREATEST((SELECT COALESCE(MAX(id), 1) FROM ${ident(table)}), 1), true) FROM ${ident(table)};\n\n`
      );
    }
  }

  await write("COMMIT;\n");
  res.end();
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

function zipLocalHeader(name, data, crc) {
  const nameBuf = Buffer.from(name, "utf8");
  const { time, date } = dosDateTime();
  const buf = Buffer.alloc(30);
  buf.writeUInt32LE(0x04034b50, 0);
  buf.writeUInt16LE(20, 4);
  buf.writeUInt16LE(0, 6);
  buf.writeUInt16LE(0, 8);
  buf.writeUInt16LE(time, 10);
  buf.writeUInt16LE(date, 12);
  buf.writeUInt32LE(crc, 14);
  buf.writeUInt32LE(data.length, 18);
  buf.writeUInt32LE(data.length, 22);
  buf.writeUInt16LE(nameBuf.length, 26);
  buf.writeUInt16LE(0, 28);
  return Buffer.concat([buf, nameBuf]);
}

function zipCentralEntry(meta) {
  const nameBuf = Buffer.from(meta.name, "utf8");
  const { time, date } = dosDateTime();
  const buf = Buffer.alloc(46);
  buf.writeUInt32LE(0x02014b50, 0);
  buf.writeUInt16LE(20, 4);
  buf.writeUInt16LE(20, 6);
  buf.writeUInt16LE(0, 8);
  buf.writeUInt16LE(0, 10);
  buf.writeUInt16LE(time, 12);
  buf.writeUInt16LE(date, 14);
  buf.writeUInt32LE(meta.crc, 16);
  buf.writeUInt32LE(meta.size, 20);
  buf.writeUInt32LE(meta.size, 24);
  buf.writeUInt16LE(nameBuf.length, 28);
  buf.writeUInt16LE(0, 30);
  buf.writeUInt16LE(0, 32);
  buf.writeUInt16LE(0, 34);
  buf.writeUInt16LE(0, 36);
  buf.writeUInt32LE(0, 38);
  buf.writeUInt32LE(meta.offset, 42);
  return Buffer.concat([buf, nameBuf]);
}

function zipEocd(count, cdSize, cdOffset) {
  const buf = Buffer.alloc(22);
  buf.writeUInt32LE(0x06054b50, 0);
  buf.writeUInt16LE(0, 4);
  buf.writeUInt16LE(0, 6);
  buf.writeUInt16LE(count, 8);
  buf.writeUInt16LE(count, 10);
  buf.writeUInt32LE(cdSize, 12);
  buf.writeUInt32LE(cdOffset, 16);
  buf.writeUInt16LE(0, 20);
  return buf;
}

const XL_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const XL_RNS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACK_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const OFF_DOC = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";

function columnLetter(n) {
  let s = "";
  n++;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function escXml(s) {
  return String(s ?? "")
    .replace(/[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function sheetXml(columns, records) {
  const rows = [];
  rows.push(
    `<row r="1">` +
      columns
        .map((c, i) => `<c r="${columnLetter(i)}1" t="inlineStr" s="1"><is><t>${escXml(c.name)}</t></is></c>`)
        .join("") +
      `</row>`
  );
  let r = 1;
  for (const rec of records) {
    r++;
    const cells = [];
    for (let i = 0; i < columns.length; i++) {
      const v = rec[columns[i].name];
      const ref = columnLetter(i) + r;
      if (v === null || v === undefined) {
        cells.push(`<c r="${ref}"/>`);
      } else if (typeof v === "number" && Number.isFinite(v)) {
        cells.push(`<c r="${ref}"><v>${v}</v></c>`);
      } else {
        let s = escXml(String(v));
        if (s.length > 32767) s = s.slice(0, 32767);
        cells.push(`<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${s}</t></is></c>`);
      }
    }
    rows.push(`<row r="${r}">${cells.join("")}</row>`);
  }
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="${XL_NS}"><sheetData>${rows.join(
      ""
    )}</sheetData></worksheet>`
  );
}

const MAX_XLS_ROWS = 1048576;

// Rows per generated .xlsx part. Kept well below the sheet limit so a single
// huge table (e.g. sale_items) becomes many small files instead of one
// multi-hundred-MB buffer held in memory.
const EXCEL_CHUNK_ROWS = Math.min(
  MAX_XLS_ROWS,
  Math.max(1000, parseInt(process.env.EXCEL_CHUNK_ROWS || "100000", 10) || 100000)
);

// Build one complete, single-sheet .xlsx in memory and return its bytes. The
// caller writes it straight into the outer .zip and drops the buffer, so peak
// memory is bounded by one chunk rather than the whole database.
function buildXlsx(sheetName, columns, records) {
  const parts = [];
  parts.push([
    "xl/worksheets/sheet1.xml",
    sheetXml(columns, records)
  ]);
  parts.push([
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `</Types>`
  ]);
  parts.push([
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="${PACK_REL}"><Relationship Id="rId1" Type="${OFF_DOC}" Target="xl/workbook.xml"/></Relationships>`
  ]);
  parts.push([
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<workbook xmlns="${XL_NS}" xmlns:r="${XL_RNS}"><sheets>` +
      `<sheet name="${escXml(String(sheetName || "table")).slice(0, 31)}" sheetId="1" r:id="rId1"/>` +
      `</sheets></workbook>`
  ]);
  parts.push([
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="${PACK_REL}">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      `</Relationships>`
  ]);
  parts.push([
    "xl/styles.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<styleSheet xmlns="${XL_NS}">` +
      `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
      `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
      `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
      `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>` +
      `</styleSheet>`
  ]);

  const chunks = [];
  const metas = [];
  let offset = 0;
  for (const [name, content] of parts) {
    const data = Buffer.from(content, "utf8");
    const crc = crc32(data);
    const lh = zipLocalHeader(name, data, crc);
    metas.push({ name, crc, size: data.length, offset });
    chunks.push(lh, data);
    offset += lh.length + data.length;
  }
  const cdParts = metas.map((m) => zipCentralEntry(m));
  const cdSize = cdParts.reduce((n, b) => n + b.length, 0);
  chunks.push(Buffer.concat(cdParts), zipEocd(metas.length, cdSize, offset));
  return Buffer.concat(chunks);
}

export async function streamExcelBackup(pool, res) {
  const tables = await listTables(pool);
  const meta = await Promise.all(
    tables.map(async (t) => ({
      table: t,
      columns: await tableColumns(pool, t),
      pk: await primaryKey(pool, t)
    }))
  );

  const stamp = new Date().toISOString();
  res.status(200);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="storemanager-data-${stamp.slice(0, 10)}.zip"`
  );
  res.setHeader("Cache-Control", "no-store");

  const write = writeTo(res);
  const metas = [];
  let offset = 0;

  const addEntry = async (name, data) => {
    const crc = crc32(data);
    const lh = zipLocalHeader(name, data, crc);
    metas.push({ name, crc, size: data.length, offset });
    await write(lh);
    await write(data);
    offset += lh.length + data.length;
  };

  // Outer archive is a .zip of standalone .xlsx files (one per table chunk) so
  // no single workbook exceeds the sheet-row limit and each file opens on its
  // own.
  for (const { table, columns, pk } of meta) {
    let records = [];
    let part = 0;
    const flush = async (force = false) => {
      if (records.length === 0 && !force) return;
      part += 1;
      const safe = String(table).replace(/[\\/:*?"<>|]/g, "_");
      const name = part > 1 ? `${safe}_${part}.xlsx` : `${safe}.xlsx`;
      await addEntry(name, buildXlsx(table, columns, records));
      records = [];
    };
    for await (const row of rowsOf(pool, table, columns, pk)) {
      const rec = {};
      for (const c of columns) rec[c.name] = row[c.name];
      records.push(rec);
      if (records.length >= EXCEL_CHUNK_ROWS) await flush();
    }
    if (part === 0) await flush(true);
  }

  const cdParts = metas.map((m) => zipCentralEntry(m));
  const cdSize = cdParts.reduce((n, b) => n + b.length, 0);
  await write(Buffer.concat(cdParts));
  await write(zipEocd(metas.length, cdSize, offset));
  res.end();
}


// ─── Restore (import) ────────────────────────────────────────────────
// Only the dialect produced above is accepted. SET/BEGIN/COMMIT,
// CREATE TABLE, INSERT and the setval fixups are recognised; anything else is
// refused, so an uploaded file can never run arbitrary DDL/DML. Every table
// and column name is checked against the live schema and re-quoted, and every
// value is bound as a query parameter.

const SKIP_RE = /^(?:BEGIN|COMMIT|ROLLBACK|SET|CREATE\s+TABLE|SELECT\s+pg_catalog\.setval)\b/i;
const IDENT = '(?:"(?:[^"]|"")*"|[A-Za-z_][A-Za-z0-9_$]*)';
const INSERT_RE = new RegExp(
  `^INSERT\\s+INTO\\s+(${IDENT})\\s*\\(\\s*(${IDENT}(?:\\s*,\\s*${IDENT})*)\\s*\\)\\s*VALUES\\s*`,
  "i"
);
const CREATE_RE = new RegExp(
  `^CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+(${IDENT})`,
  "i"
);

// Splits on top-level semicolons only. Comments are tracked so that a comment
// containing a quote or a semicolon cannot break statement detection, but their
// text is discarded.
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
    if (c === "-" && next === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === "'") { inSingle = true; buf += c; i++; continue; }
    if (c === '"') { inDouble = true; buf += c; i++; continue; }
    if (c === ";") { yield buf; buf = ""; i++; continue; }
    buf += c; i++;
  }
  if (buf.trim()) yield buf;
}

function parseIdent(token) {
  const t = token.trim();
  if (t.startsWith('"')) return t.slice(1, -1).replace(/""/g, '"');
  return t;
}

const skipWs = (s, i) => {
  while (i < s.length && /\s/.test(s[i])) i++;
  return i;
};

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
    // Skip past the separator and any whitespace, so the next "(" is seen.
    if (s[i] === ",") { i = skipWs(s, i + 1); continue; }
    break;
  }
  if (tuples.length === 0) throw new Error("INSERT statement without VALUES in the backup file");
  return { tuples, end: i };
}

// Yields one INSERT at a time instead of building an array of every row: a
// full backup can contain hundreds of thousands of statements, and holding
// them all (plus their parsed columns) is what used to exhaust the heap.
export function* parseSqlBackup(sql, declared = new Set()) {
  for (const raw of splitStatements(String(sql || ""))) {
    const stmt = raw.trim();
    if (!stmt) continue;
    // The exporter writes a CREATE TABLE for every table, even the ones with
    // no rows. Remember those names so a replace import can clear them too;
    // otherwise stale rows from the old data set would survive a restore.
    const created = CREATE_RE.exec(stmt);
    if (created) {
      declared.add(parseIdent(created[1]));
      continue;
    }
    if (SKIP_RE.test(stmt)) continue;
    const m = INSERT_RE.exec(stmt);
    if (!m) {
      throw new Error(
        `"${stmt.replace(/\s+/g, " ").slice(0, 40)}" is not supported. ` +
          `Only SQL files created by this app's "Download SQL backup" button can be imported.`
      );
    }
    const table = parseIdent(m[1]);
    const columns = m[2].split(",").map(parseIdent);
    const { tuples, end } = readValueTuples(stmt, m[0].length);
    const trailing = stmt.slice(end).trim();
    if (trailing) throw new Error(`Unexpected text after VALUES in an INSERT into "${table}"`);
    yield { table, columns, tuples };
  }
}

const MAX_PARAMS = 60000;

async function liveSchema(q) {
  const { rows: tables } = await q.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
  );
  const { rows: columns } = await q.query(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`
  );
  const cols = new Map();
  for (const r of columns) {
    if (!cols.has(r.table_name)) cols.set(r.table_name, new Set());
    cols.get(r.table_name).add(r.column_name);
  }
  return { tables: new Set(tables.map((r) => r.table_name)), columns: cols };
}

// Parses, validates against the live schema and returns one entry per table:
//   { table: { columns: string[], rows: value[][] } }
// Throws if the file contains anything outside this module's own backup dialect.
export async function readBackupFile(q, sql) {
  const schema = await liveSchema(q);
  const grouped = new Map();
  const columnCache = new Map();
  const declared = new Set();
  let sawInsert = false;

  for (const ins of parseSqlBackup(sql, declared)) {
    sawInsert = true;
    if (!schema.tables.has(ins.table)) {
      throw new Error(`The file contains table "${ins.table}", which this database does not have.`);
    }
    const known = schema.columns.get(ins.table);
    let columns = columnCache.get(ins.table);
    if (!columns) {
      for (const c of ins.columns) {
        if (!known.has(c)) {
          throw new Error(`The file contains column "${ins.table}.${c}", which this database does not have.`);
        }
      }
      columns = ins.columns;
      columnCache.set(ins.table, columns);
    } else if (
      columns.length !== ins.columns.length ||
      columns.some((c, i) => c !== ins.columns[i])
    ) {
      throw new Error(`The file contains rows for "${ins.table}" with different columns.`);
    }
    for (const tuple of ins.tuples) {
      if (tuple.length !== columns.length) {
        throw new Error(`A row for "${ins.table}" has ${tuple.length} values but ${columns.length} columns.`);
      }
    }
    const g = grouped.get(ins.table);
    if (g) g.rows.push(...ins.tuples);
    else grouped.set(ins.table, { columns, rows: ins.tuples });
  }

  if (!sawInsert && declared.size === 0) {
    throw new Error("No data rows found in that file.");
  }

  // Tables that were empty when the backup was taken have no INSERT rows, but
  // they are still part of the file and a replace import must clear them.
  for (const table of declared) {
    if (!schema.tables.has(table)) {
      throw new Error(`The file contains table "${table}", which this database does not have.`);
    }
    if (!grouped.has(table)) grouped.set(table, { columns: [], rows: [] });
  }
  return grouped;
}

export function backupSummary(grouped) {
  const tables = [...grouped.entries()]
    .filter(([, g]) => g.rows.length > 0)
    .map(([table, g]) => ({ table, rows: g.rows.length }))
    .sort((a, b) => b.rows - a.rows);
  return { tables, totalRows: tables.reduce((n, t) => n + t.rows, 0) };
}

// Orders the tables so that referenced ones are inserted first, using the live
// foreign keys. This makes a restore correct regardless of the order the rows
// appear in the file, so dumps written by an older build still replay.
async function foreignKeyMap(q) {
  const { rows } = await q.query(
    `SELECT tc.table_name AS child, ccu.table_name AS parent
     FROM information_schema.table_constraints tc
     JOIN information_schema.constraint_column_usage ccu
       ON ccu.constraint_name = tc.constraint_name
      AND ccu.constraint_schema = tc.constraint_schema
     WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`
  );
  return rows;
}

async function orderByDependencies(q, tables) {
  const wanted = new Set(tables);
  const rows = await foreignKeyMap(q);
  const pending = new Set(tables);
  const parents = new Map(tables.map((t) => [t, new Set()]));
  for (const r of rows) {
    if (wanted.has(r.child) && wanted.has(r.parent) && r.parent !== r.child) {
      parents.get(r.child).add(r.parent);
    }
  }
  const ordered = [];
  while (pending.size) {
    const ready = [...pending].filter((t) => [...parents.get(t)].every((p) => !pending.has(p)));
    // A cycle would stall the walk; fall back to the original order for the rest.
    const batch = ready.length ? ready : [...pending];
    for (const t of batch) {
      pending.delete(t);
      ordered.push(t);
    }
  }
  return ordered;
}

// Tables that hold rows pointing at the ones in the file but are not part of it.
// Replacing those pointed-at tables would destroy rows the file never mentions,
// so the caller surfaces this before asking the user to confirm.
export async function tablesReferencingMissing(q, tables) {
  const wanted = new Set(tables);
  const rows = await foreignKeyMap(q);
  const missing = new Set();
  const queue = [...wanted];
  while (queue.length) {
    const parent = queue.shift();
    for (const r of rows) {
      if (r.parent !== parent || wanted.has(r.child) || missing.has(r.child)) continue;
      missing.add(r.child);
      queue.push(r.child);
    }
  }
  return [...missing].sort();
}

// Empties exactly the tables the file contains, children before parents.
// TRUNCATE ... CASCADE must not be used here: it would also clear every table
// that merely *references* the ones being replaced, silently dropping data the
// file never contained.
async function clearFileTables(client, tables) {
  const order = await orderByDependencies(client, tables);
  for (const table of [...order].reverse()) {
    try {
      await client.query(`DELETE FROM ${ident(table)}`);
    } catch (err) {
      if (err.code === "23503") {
        const holder = err.table ? ` in "${err.table}"` : " in another table";
        throw new Error(
          `Cannot replace "${table}" because it still has rows${holder}, and that table is not part of this file, ` +
          `so replacing it would delete them as well. Use a backup exported from this app (which contains every ` +
          `table), or choose merge mode. Nothing was changed.`
        );
      }
      throw err;
    }
  }
}

// A restore must write the rows exactly as they were exported. Application
// triggers would otherwise stamp a new updated_at, assign missing barcodes and
// bump invoice counters, and the sync triggers would log every restored row as
// a fresh change. Foreign-key constraint triggers are internal, not "USER", so
// they stay active and still reject an inconsistent file.
async function setUserTriggers(client, tables, enable) {
  const verb = enable ? "ENABLE" : "DISABLE";
  for (const table of tables) {
    await client.query(`ALTER TABLE ${ident(table)} ${verb} TRIGGER USER`);
  }
}

// mode "replace": clears the tables the file mentions, then loads it.
// mode "merge":   keeps existing rows and adds only ids that are free.
export async function importSqlBackup(pool, sql, mode) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const grouped = await readBackupFile(client, sql);
    const tables = await orderByDependencies(client, [...grouped.keys()]);

    let affected = tables;
    if (mode === "replace" && tables.length) {
      // Also clear tables outside the file that reference the replaced ones:
      // keeping them would fail FK checks, and they belong to the old data set
      // anyway. The inspect endpoint already warns the user about these.
      const missing = await tablesReferencingMissing(client, tables);
      affected = [...new Set([...tables, ...missing])];
      await setUserTriggers(client, affected, false);
      await clearFileTables(client, affected);
    } else {
      await setUserTriggers(client, affected, false);
    }

    const summary = { tables: [], inserted: 0, skipped: 0 };
    for (const table of tables) {
      const { columns, rows } = grouped.get(table);
      const perStatement = Math.max(1, Math.min(500, Math.floor(MAX_PARAMS / columns.length)));
      let inserted = 0;
      for (let i = 0; i < rows.length; i += perStatement) {
        const chunk = rows.slice(i, i + perStatement);
        const params = [];
        const tuples = chunk.map((row) => {
          const base = params.length;
          params.push(...row);
          return `(${row.map((_, k) => `$${base + k + 1}`).join(",")})`;
        });
        const stmt =
          `INSERT INTO ${ident(table)} (${columns.map(ident).join(", ")}) VALUES ${tuples.join(",")}` +
          (mode === "merge" ? " ON CONFLICT DO NOTHING" : "");
        const res = await client.query(stmt, params);
        inserted += res.rowCount || 0;
      }
      summary.inserted += inserted;
      summary.skipped += rows.length - inserted;
      summary.tables.push({ table, rows: rows.length, inserted });
    }

    // Keep serial sequences ahead of the highest imported value so the next
    // insert does not collide with a restored row. Not every table keys on
    // "id" (app_migrations/invoice_counters have no serial, sync_changes uses
    // "seq"), so discover the sequence owned by each column instead of
    // assuming one.
    for (const table of tables) {
      const { rows: serials } = await client.query(
        `SELECT c.column_name,
                pg_catalog.pg_get_serial_sequence($1, c.column_name) AS seq
           FROM information_schema.columns c
          WHERE c.table_schema = 'public' AND c.table_name = $1`,
        [table]
      );
      for (const { column_name: column, seq } of serials) {
        if (!seq) continue;
        await client.query(
          `SELECT pg_catalog.setval(
             $1::regclass,
             GREATEST((SELECT COALESCE(MAX(${ident(column)}), 1) FROM ${ident(table)}), 1), true
           )`,
          [seq]
        );
      }
    }

    // A backup made before sales.profit existed does not contain the column,
    // so its rows arrive with the column default. Rebuild the stored profit
    // from the restored items, vouchers and points before committing. Current
    // backups already carry profit; re-deriving it there is both unnecessary
    // and a full rewrite of every restored sale.
    const salesBackup = grouped.get("sales");
    if (salesBackup && !salesBackup.columns.includes("profit")) {
      const { columns, rows } = salesBackup;
      const idIndex = columns.indexOf("id");
      if (idIndex >= 0) {
        const ids = rows
          .map((row) => Number(row[idIndex]))
          .filter((id) => Number.isInteger(id) && id > 0);
        for (let i = 0; i < ids.length; i += 5000) {
          await recalcSaleProfits(client, ids.slice(i, i + 5000));
        }
      }
    }

    await setUserTriggers(client, affected, true);
    await client.query("COMMIT");
    return summary;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export { TABLE_ORDER };