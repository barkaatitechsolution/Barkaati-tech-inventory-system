const TABLE_ORDER = [
  "measuring_units",
  "categories",
  "subcategories",
  "products",
  "suppliers",
  "customers",
  "assets",
  "expenses",
  "purchases",
  "purchase_items",
  "supplier_purchases",
  "supplier_purchase_items",
  "product_packs",
  "sales",
  "sale_items"
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

async function listTables(pool) {
  const { rows } = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
  );
  const present = new Set(rows.map((r) => r.table_name));
  const ordered = TABLE_ORDER.filter((t) => present.has(t));
  const extra = rows.map((r) => r.table_name).filter((t) => !TABLE_ORDER.includes(t)).sort();
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

async function* rowsOf(pool, table, columns) {
  const cols = columns.map((c) => `${ident(c.name)}::text AS ${ident(c.name)}`).join(", ");
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

export async function streamExcelBackup(pool, res) {
  const tables = await listTables(pool);
  const meta = await Promise.all(
    tables.map(async (t) => ({ table: t, columns: await tableColumns(pool, t) }))
  );

  const stamp = new Date().toISOString();
  res.status(200);
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="storemanager-data-${stamp.slice(0, 10)}.xlsx"`
  );
  res.setHeader("Cache-Control", "no-store");

  const write = writeTo(res);
  const entries = [];
  const ENTRY = (name, content) => {
    const data = Buffer.from(content, "utf8");
    entries.push({ name, data });
  };

  ENTRY(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      meta
        .map(
          (_m, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
        )
        .join("") +
      `</Types>`
  );

  ENTRY(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="${PACK_REL}"><Relationship Id="rId1" Type="${OFF_DOC}" Target="xl/workbook.xml"/></Relationships>`
  );

  ENTRY(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<workbook xmlns="${XL_NS}" xmlns:r="${XL_RNS}"><sheets>` +
      meta
        .map(
          (_m, i) =>
            `<sheet name="${escXml(meta[i].table).slice(0, 31)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
        )
        .join("") +
      `</sheets></workbook>`
  );

  ENTRY(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="${PACK_REL}">` +
      meta
        .map(
          (_m, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
        )
        .join("") +
      `<Relationship Id="rId${meta.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      `</Relationships>`
  );

  ENTRY(
    "xl/styles.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<styleSheet xmlns="${XL_NS}">` +
      `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
      `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
      `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
      `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>` +
      `</styleSheet>`
  );

  for (let i = 0; i < meta.length; i++) {
    const { table, columns } = meta[i];
    const records = [];
    let truncated = false;
    for await (const row of rowsOf(pool, table, columns)) {
      if (records.length >= MAX_XLS_ROWS) {
        truncated = true;
        break;
      }
      const rec = {};
      for (const c of columns) rec[c.name] = row[c.name];
      records.push(rec);
    }
    ENTRY(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(columns, records));
    if (truncated) console.error(`[backup] ${table} exceeded Excel row limit, truncated`);
  }

  const metas = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const crc = crc32(data);
    const lh = zipLocalHeader(name, data, crc);
    metas.push({ name, crc, size: data.length, offset });
    await write(lh);
    await write(data);
    offset += lh.length + data.length;
  }

  const cdParts = metas.map((m) => zipCentralEntry(m));
  const cdSize = cdParts.reduce((n, b) => n + b.length, 0);
  await write(Buffer.concat(cdParts));
  await write(zipEocd(metas.length, cdSize, offset));
  res.end();
}

export { TABLE_ORDER };