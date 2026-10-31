import "dotenv/config";
import pg from "pg";

const { Pool, types } = pg;

// Match the shop app's type parsing so numeric columns arrive as plain numbers
// and DATE columns stay as "YYYY-MM-DD" strings instead of shifting a day.
types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
types.setTypeParser(1082, (v) => v);

const databaseName = process.env.INVENTORY_DB_NAME || process.env.PGDATABASE || "store_master";

const baseConfig = process.env.INVENTORY_DATABASE_URL
  ? { connectionString: process.env.INVENTORY_DATABASE_URL }
  : process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.PGHOST || "127.0.0.1",
        port: Number(process.env.PGPORT || 5432),
        user: process.env.PGUSER || "postgres",
        password: process.env.PGPASSWORD || "postgres",
        database: databaseName
      };

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

// The public storefront reads and writes the same database as the shop app.
// Products, categories, settings, customers and sales all live there, so there
// is no second copy of the catalogue to keep in sync.
export const pool = new Pool({
  ...baseConfig,
  max: 20,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000
});
