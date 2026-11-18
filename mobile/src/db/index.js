import { Capacitor } from "@capacitor/core";
import { CapacitorSQLite, SQLiteConnection } from "@capacitor-community/sqlite";
import schemaSql from "./schema.sql?raw";
import { applySyncMigrations } from "./syncSchema.js";

export const DB_NAME = "barkaati_inventory";

let sqlite = null;
let db = null;
let opening = null;
let encrypted = false;
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

/**
 * Open the encrypted database using a passphrase (derived from the PIN).
 * On first run this creates the database and applies the schema.
 */
export async function openDatabase(passphrase) {
  if (db) return db;
  if (opening) return opening;

  opening = (async () => {
    if (!isNative()) {
      throw new Error(
        "The offline database only runs on an Android/iOS build. Use `npx cap run android` instead of a browser."
      );
    }
    const sql = connection();
    const exists = await connectionExists();
    if (!exists && !passphrase) throw new Error("A passphrase is required to create the database.");
    if (passphrase) {
      try {
        await sql.setEncryptionSecret(passphrase);
      } catch (e) {
        if (!/passphrase has already been set/i.test(e?.message || "")) throw e;
      }
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
      await conn.execute(schemaSql);
      await applyMigrations(conn);
      await conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_barcode ON customers(barcode) WHERE barcode <> ''");
      await applySyncMigrations(conn);
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
