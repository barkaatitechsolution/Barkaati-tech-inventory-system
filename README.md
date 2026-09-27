# Store Master — offline-first shop manager

A complete inventory + billing application for a retail shop, designed to run
locally on the shop's computer — fully offline, no accounts, no cloud.

- **Client** — React 18, Vite, Tailwind CSS, Recharts, XLSX (`client/`)
- **Server** — Express, `pg`, PostgreSQL (`server/`)
- Everything lives in the local PostgreSQL database; bill/product images are
  stored on disk under `server/uploads/`.

## Features

- **Dashboard** — today/total sales, monthly profit & expenses, revenue/profit
  chart, low-stock alerts, stock value, recent sales & expenses
- **Products** — catalog with images, categories & subcategories, measuring
  units, HSN codes, tax, MRP vs. selling price (savings), stock & reorder levels
- **Prices** — price list with per-unit rates and market-price savings
- **Customer Categories & Pricing** — tag customers as Retailer / Hotel /
  Caterer / etc. and set a custom selling price per category (in Prices or
  Products); sales bill automatically at that customer's category price
- **Suppliers & Purchases** — multi-item supplier purchases with bill image,
  automatic stock/pack entry, PDF bills, and **payment tracking** (Credit /
  Partial / Paid / Overdue) with reminders and status & supplier filters
- **Customers** — customer directory with credit limits and category tags
- **Sales** — quick billing with auto pack deduction, tax & profit per line,
  **paid / partial / credit** statuses, 58 mm thermal receipts & A4 invoices,
  WhatsApp sharing, and **discount voucher** redemption
- **Vouchers** — discount-voucher campaigns (₹ / % off, monthly usage limits)
  issued with bills and redeemed on future purchases
- **Employee** — attendance (present / half / leave / holiday / absent),
  automatic monthly salary calculation (daily rate = monthly ÷ 30.5), payroll
  with payments and advances
- **Expenses & Assets** — categorized expenses and asset register with
  depreciation value
- **Cheques** — track every cheque by number, bank, drawer, issue & clearing
  dates, amount and payee (given to supplier / received from customer), with
  Pending / Overdue / Cleared / Bounced statuses
- **Reports** — revenue, profit & expenses over any date range, per-day trend,
  best sellers, category breakdown
- **Broadcast & Quotation** — WhatsApp broadcasts and A4 quotations
- **Tasks** — assign tasks to staff with priority, due date and status
  (Pending / In Progress / Overdue / Completed)
- **Business Documents** — upload and organise important files (images, PDFs,
  Word, Excel) by category, stored on disk and openable/downloadable anytime
- **Backup** — one-click SQL dump and Excel export from Settings

## Requirements

- Node.js 18+
- PostgreSQL (local, default database name `store_master`)

## Quick start

```sh
# 1. Create the database (or set DATABASE_URL / PGDATABASE)
createdb store_master

# 2. Configure the server
cd server
cp .env.example .env      # then edit PostgreSQL credentials if needed
cd ..

# 3. Install everything
npm run setup

# 4. Run the app (client http://localhost:5173 + API http://localhost:3001)
npm run dev
```

The server auto-creates empty tables on first run — no migrations to apply.
Existing data is never wiped on normal restarts.

### Demo data

A small demo dataset (products, customers, suppliers, sales, purchases, …) can
be loaded on a brand-new database:

```sh
SEED_DEMO=true npm run dev --prefix server
```

It is **off by default** — set `SEED_DEMO=true` in `server/.env` to enable.

## Resetting the database

Wipes and recreates all tables (deletes all data):

```sh
RESET_DB=true npm run dev --prefix server
# or
node server/index.js --reset
```

## Production build

```sh
npm run build            # builds client/dist
NODE_ENV=production npm start   # serves the built client + API together on :3001
```

The Express server serves the built front-end from `client/dist` automatically
(hashed assets are cached for 7 days / immutable; uploads for 1 day).

## Project layout

- `server/index.js` — Express entry point, static serving, seed gating
- `server/api.js` — all REST endpoints
- `server/db.js` — connection pool, idempotent schema, optional demo seed
- `server/backup.js` — SQL dump + Excel export
- `server/uploads/` — bill/product images (on disk, never in the DB)
- `client/src/pages/` — one page per module (Sales, Products, Employee, …)
- `client/src/components/` — shared UI (Modal, SearchableSelect, Pagination, …)
- `client/src/lib/receipt.js` — printable 58 mm / A4 receipt generator
- `client/src/lib/whatsapp.js` — WhatsApp message sharing

## Environment variables (`server/.env`)

| Variable       | Default    | Description                             |
| -------------- | ---------- | --------------------------------------- |
| `PGHOST`       | `127.0.0.1`| PostgreSQL host                          |
| `PGPORT`       | `5432`     | PostgreSQL port                          |
| `PGUSER`       | `postgres` | PostgreSQL user                          |
| `PGPASSWORD`   | `postgres` | PostgreSQL password                      |
| `PGDATABASE`   | `store_master` | Database name (created if missing)  |
| `SEED_DEMO`    | `false`    | Load demo data on a fresh database       |
| `RESET_DB`     | `false`    | Wipe & recreate all tables on startup    |

`DATABASE_URL` (e.g. `postgres://user:pass@host:5432/db`) overrides the
individual `PG*` variables when set.

## Notes

- Receipt header (store name / address / phone) is set in **Settings**.
- `GET /api/product-packs` returns `{ packs, stats }` with a 500-row cap.
- No auth — this app is intended for the shop's own private network.