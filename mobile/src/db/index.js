import { Capacitor } from "@capacitor/core";
import { CapacitorSQLite, SQLiteConnection } from "@capacitor-community/sqlite";
import schemaSql from "./schema.sql?raw";
import { applySyncMigrations } from "./syncSchema.js";

export const DB_NAME = "barkaati_inventory";
const SCHEMA_VERSION = 1;

let sqlite = null;
let db = null;
let opening = null;
let encrypted = false;
let secretSet = false;
let txQueue = Promise.resolve();
let txDepth = 0;

const ADDED_COLUMNS = {
  customers: {
    barcode: "TEXT DEFAULT ''"
  },
  supplier_purchases: {
    due_date: "TEXT DEFAULT ''"
  },
  cheques: {
    drawer_name: "TEXT DEFAULT ''",
    supplier_id: "INTEGER",
    customer_id: "INTEGER"
  },
  tasks: {
    completed_at: "TEXT DEFAULT ''"
  },
  employees: {
    email: "TEXT DEFAULT ''",
    address: "TEXT DEFAULT ''",
    role: "TEXT DEFAULT ''",
    salary_type: "TEXT NOT NULL DEFAULT 'salary'",
    salary_rate: "REAL NOT NULL DEFAULT 0",
    starting_date: "TEXT DEFAULT ''",
    pf_enabled: "INTEGER NOT NULL DEFAULT 0",
    pf_rate: "REAL NOT NULL DEFAULT 0",
    status: "TEXT NOT NULL DEFAULT 'active'",
    photo_path: "TEXT DEFAULT ''",
    notes: "TEXT DEFAULT ''",
    designation: "TEXT DEFAULT ''",
    joining_date: "TEXT DEFAULT ''",
    rank: "TEXT NOT NULL DEFAULT 'noob'",
    stars: "INTEGER NOT NULL DEFAULT 1",
    shift_start: "TEXT DEFAULT ''",
    shift_end: "TEXT DEFAULT ''",
    last_working_date: "TEXT DEFAULT ''",
    bank_name: "TEXT DEFAULT ''",
    bank_account_no: "TEXT DEFAULT ''",
    bank_ifsc: "TEXT DEFAULT ''",
    upi_id: "TEXT DEFAULT ''",
    date_of_birth: "TEXT DEFAULT ''",
    emergency_contact_name: "TEXT DEFAULT ''",
    emergency_contact_phone: "TEXT DEFAULT ''",
    id_proof_type: "TEXT DEFAULT ''",
    id_proof_number: "TEXT DEFAULT ''"
  },
  broker_enquiries: {
    reference_no: "TEXT DEFAULT ''"
  }
};

async function applyMigrations(conn) {
  for (const [table, columns] of Object.entries(ADDED_COLUMNS)) {
    let existing = [];
    try {
      const res = await conn.query(`PRAGMA table_info(${table})`);
      existing = (res?.values || []).map((r) => r.name);
    } catch {
      existing = [];
    }
    if (!existing.length) continue;
    for (const [column, definition] of Object.entries(columns)) {
      if (existing.includes(column)) continue;
      try {
        await conn.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      } catch {
        /* column already present or table unavailable */
      }
    }
  }
}

export const isNative = () => Capacitor.isNativePlatform();

function connection() {
  if (!sqlite) sqlite = new SQLiteConnection(CapacitorSQLite);
  return sqlite;
}

async function connectionExists() {
  try {
    const res = await connection().isConnection(DB_NAME, false);
    return !!res?.result;
  } catch {
    return false;
  }
}

async function databaseExists(sql) {
  try {
    return !!(await sql.isDatabase(DB_NAME))?.result;
  } catch {
    return false;
  }
}

export async function wipeEncryptedDatabase() {
  const sql = connection();
  if (!(await connectionExists())) {
    try {
      await sql.createConnection(DB_NAME, true, "secret", 1, false);
    } catch {}
  }
  try {
    await CapacitorSQLite.deleteDatabase({ database: DB_NAME, readonly: false });
  } catch {}
  try {
    await CapacitorSQLite.clearEncryptionSecret();
  } catch {}
  try {
    await sql.closeConnection(DB_NAME, false);
  } catch {}
  db = null;
  encrypted = false;
  secretSet = false;
}

/**
 * Open the encrypted database using a passphrase (derived from the PIN).
 * On first run this creates the database and applies the schema.
 */
export async function openDatabase(passphrase, { resetOnSecretMismatch = false } = {}) {
  if (db) return db;
  if (opening) return opening;

  opening = (async () => {
    if (!isNative()) {
      throw new Error(
        "The offline database only runs on an Android/iOS build. Use `npx cap run android` instead of a browser."
      );
    }
    const sql = connection();
    let exists = await connectionExists();
    let dbFileExists = await databaseExists(sql);
    if (!exists && !passphrase) throw new Error("A passphrase is required to create the database.");
    if (passphrase && !secretSet) {
      let alreadySet = false;
      if (dbFileExists) {
        try {
          const check = await sql.checkEncryptionSecret(passphrase);
          alreadySet = !!check?.result;
        } catch {}
      }
      if (!alreadySet && dbFileExists && resetOnSecretMismatch) {
        await wipeEncryptedDatabase();
        exists = false;
        dbFileExists = false;
      }
      if (!alreadySet) {
        try {
          await sql.setEncryptionSecret(passphrase);
        } catch (e) {
          if (!/passphrase has already been set/i.test(e?.message || "")) throw e;
          if (dbFileExists) throw e;
          await sql.clearEncryptionSecret();
          await sql.setEncryptionSecret(passphrase);
        }
      }
      secretSet = true;
    }

    let conn = null;
    try {
      if (exists) {
        conn = await sql.retrieveConnection(DB_NAME, false);
      } else {
        conn = await sql.createConnection(DB_NAME, true, "secret", 1, false);
      }
      const openRes = await conn.isDBOpen();
      if (!openRes?.result) await conn.open();
      let currentVersion = 0;
      try {
        const versionRows = await conn.query("SELECT value FROM app_meta WHERE key = 'schema_version'");
        const versionRow = versionRows?.values?.[0];
        currentVersion = Number(versionRow?.value ?? versionRow?.[0] ?? 0);
      } catch {
        currentVersion = 0;
      }
      if (currentVersion < SCHEMA_VERSION) {
        await conn.execute(schemaSql);
        await applyMigrations(conn);
        await conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_barcode ON customers(barcode) WHERE barcode <> ''");
        await applySyncMigrations(conn);
        await conn.execute(
          "UPDATE sale_items SET line_total = ROUND(qty * unit_price, 2) WHERE COALESCE(line_total, 0) = 0 AND COALESCE(unit_price, 0) <> 0"
        );
        await conn.execute(
          "UPDATE sales SET subtotal = COALESCE((SELECT SUM(line_total) FROM sale_items WHERE sale_items.sale_id = sales.id), 0), tax = COALESCE((SELECT SUM(tax_amt) FROM sale_items WHERE sale_items.sale_id = sales.id), 0) WHERE COALESCE(subtotal, 0) = 0"
        );
        await conn.execute(
          `INSERT INTO app_meta (key, value) VALUES ('schema_version', '${SCHEMA_VERSION}')
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`
        );
      }
      db = conn;
      encrypted = true;
      return db;
    } catch (e) {
      try {
        if (conn) await conn.close();
      } catch {
        /* ignore */
      }
      try {
        await sql.closeConnection(DB_NAME, false);
      } catch {
        /* ignore */
      }
      db = null;
      throw e;
    }
  })();

  try {
    return await opening;
  } finally {
    opening = null;
  }
}

export async function closeDatabase() {
  if (!db) return;
  try {
    await db.close();
  } catch {
    /* ignore */
  }
  try {
    await connection().closeConnection(DB_NAME, false);
  } catch {
    /* ignore */
  }
  db = null;
}

export async function changePassphrase(newPassphrase, oldPassphrase) {
  await connection().changeEncryptionSecret(newPassphrase, oldPassphrase);
}

export function isEncrypted() {
  return encrypted;
}

export function resetEncryptionSecret() {
  secretSet = false;
  encrypted = false;
}

function requireDb() {
  if (!db) throw new Error("Database is locked. Unlock the app first.");
  return db;
}

export async function query(sql, params = []) {
  const res = await requireDb().query(sql, params);
  return res?.values || [];
}

export async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

export async function run(sql, params = []) {
  const res = await requireDb().run(sql, params, false);
  return { changes: res?.changes?.changes ?? 0, lastId: res?.changes?.lastId ?? null };
}

export async function execute(sql) {
  return requireDb().execute(sql);
}

async function beginTransaction(database, options) {
  try {
    await database.beginTransaction();
  } catch (e) {
    if (!/within a transaction/i.test(e?.message || "")) throw e;
    try {
      await database.rollbackTransaction();
    } catch {
      /* ignore */
    }
    if (options?.foreignKeys === false) await run("PRAGMA foreign_keys = OFF");
    await database.beginTransaction();
  }
}

async function runTransaction(fn, options) {
  const database = requireDb();
  let started = false;
  let restoreForeignKeys = false;
  if (options?.foreignKeys === false) {
    const row = await queryOne("PRAGMA foreign_keys");
    restoreForeignKeys = !!row?.foreign_keys;
    await run("PRAGMA foreign_keys = OFF");
  }
  try {
    await beginTransaction(database, options);
    started = true;
    txDepth = 1;
    const result = await fn();
    await database.commitTransaction();
    return result;
  } catch (e) {
    if (started) {
      try {
        await database.rollbackTransaction();
      } catch {
        /* ignore */
      }
    }
    throw e;
  } finally {
    txDepth = 0;
    if (restoreForeignKeys) {
      try {
        await run("PRAGMA foreign_keys = ON");
      } catch {
        /* ignore */
      }
    }
  }
}

export async function transaction(fn, options = {}) {
  if (txDepth > 0) return fn();
  const job = txQueue.then(
    () => runTransaction(fn, options),
    () => runTransaction(fn, options)
  );
  txQueue = job.then(
    () => undefined,
    () => undefined
  );
  return job;
}

export const now = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}:${pad(d.getSeconds())}`;
};

export const today = () => now().slice(0, 10);
