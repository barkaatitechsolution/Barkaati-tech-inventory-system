# Barkaati Tech Inventory System

A local-first shop management suite made up of three connected apps:

- **Web manager** (`client/` + `server/`) — inventory, billing, purchases, employees, finance, reports, settings, and backups.
- **Android app** (`mobile/`) — offline shop manager with encrypted local storage, Bluetooth printing, and web sync.
- **Public online store** (`store/`) — customer-facing catalog and order flow that shares the same `store_master` database.

The web manager runs on the shop's own computer or LAN. The Android app can work fully offline. The online store is optional and should be published separately from the private web manager.

## Contents

- [Screenshots](#screenshots)
- [Feature overview](#feature-overview)
- [Web manager features](#web-manager-features)
- [Android app features](#android-app-features)
- [Online store features](#online-store-features)
- [Sync between web and phone](#sync-between-web-and-phone)
- [Printing, barcodes, and sharing](#printing-barcodes-and-sharing)
- [Security and access](#security-and-access)
- [Backups and restore](#backups-and-restore)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [NPM scripts](#npm-scripts)
- [Production build](#production-build)
- [Online store setup](#online-store-setup)
- [Android build](#android-build)
- [Podman deployment](#podman-deployment)
- [Environment variables](#environment-variables)
- [Project layout](#project-layout)
- [Operational notes](#operational-notes)

## Screenshots

Screenshots can be added later. Put image files under `docs/screenshots/` and replace each placeholder with Markdown such as `![Dashboard](docs/screenshots/dashboard.png)`.

| Area | Screenshot |
| --- | --- |
| Dashboard | _Screenshot placeholder — add `docs/screenshots/dashboard.png`_ |
| Sales billing | _Screenshot placeholder — add `docs/screenshots/sales.png`_ |
| Products and stock | _Screenshot placeholder — add `docs/screenshots/products.png`_ |
| Supplier purchase bill | _Screenshot placeholder — add `docs/screenshots/supplier-purchase.png`_ |
| Reports | _Screenshot placeholder — add `docs/screenshots/reports.png`_ |
| Settings and sync devices | _Screenshot placeholder — add `docs/screenshots/settings.png`_ |
| Android app | _Screenshot placeholder — add `docs/screenshots/mobile.png`_ |
| Online store | _Screenshot placeholder — add `docs/screenshots/online-store.png`_ |

## Feature overview

### Web manager

- Dashboard with today and lifetime sales, monthly profit and expenses, revenue/profit chart, low-stock alerts, stock value, top products, recent sales, and recent expenses.
- Product catalog with categories, subcategories, quality grades, measuring units, HSN codes, tax, MRP, selling price, images, stock, reorder levels, and product packs.
- Customer category pricing, customer price lists, price comparisons, and market-price savings.
- POS-style sales billing with automatic pack deduction, per-line tax and profit, paid/partial/credit status, returns, customer payments, completed bills, and customer barcode lookup.
- Supplier directory, multi-item purchase bills, payment status, due dates, reminders, broker enquiries, and automatic stock/pack updates.
- Employees with attendance, attendance sheet, payroll, salary calculation, payments, advances, documents, and exportable employee reports.
- Expenses, asset register with depreciation value, cheques, tasks, reminders, call notes, business documents, and non-sale inventory.
- Vouchers, voucher campaigns, point programs, quotations, online orders, WhatsApp broadcasts, and SMS/email broadcasts.
- Reports for revenue, profit, expenses, best sellers, and category/expense breakdowns over custom date ranges.
- Settings for shop identity, invoice numbering, online store, UPI QR, receipt footer, action password, sync devices, and backup/import.
- Browser printing, PDF output, remote laptop printing, barcode labels, weight barcodes, and customer cards.

### Android app

- Offline-first shop manager using React, Capacitor, and encrypted SQLite/SQLCipher.
- PIN unlock, optional biometric unlock, encrypted local database, and full local data wipe/reset.
- Sell screen, products, sales, customers, purchases, suppliers, expenses, reports, reminders, assets, cheques, tasks, call notes, business documents, brokers, vouchers, employees, attendance, payroll, online orders, and more.
- Generic weight barcodes, product barcode scanning, customer barcodes, Bluetooth ESC/POS printing, and WhatsApp/SMS/email sharing.
- Web sync with pairing, manual sync, auto-sync, change events, snapshots, pending counts, conflict review, and download-from-web replacement.

### Online store

- Public catalog of products marked **Online** with available stock.
- Product search by name, SKU, HSN, and category.
- Cart with delivery or pickup, phone validation, delivery address validation, and configurable delivery fee.
- Checkout creates an order in the same database and appears in the web manager under **Online Orders**.
- Order tracking by invoice number and phone number with WhatsApp confirmation links.
- Store settings are controlled from the web manager under **Settings → Online store**.

## Web manager features

### Dashboard and reporting

- Live business KPIs: sales, revenue, profit, cost of goods, expenses, credit outstanding, stock value, and reorder count.
- Charts for revenue and profit trends.
- Low-stock alerts and recent activity panels.
- Reports page with date-range filters, per-day trends, best sellers, and category/expense breakdown.
- Employee reports with CSV, Excel, and PDF/print export.
- Performance reports are also available in `docs/web-performance-report-2026-11-19.md`.

### Products, pricing, and stock

- Product catalog with image upload, barcode, SKU, HSN, tax, MRP, purchase price, selling price, category, subcategory, quality, and unit.
- Product options and search endpoints for fast picking in bills.
- Categories, subcategories, measuring units, packs, weight barcodes, and generic `WT:` labels.
- Stock levels, low-stock reporting, stock removal/write-off, and non-sale inventory.
- Product prices and customer-category pricing so sales automatically use the right price for Retailer, Hotel, Caterer, or custom categories.
- Product barcode lookup and printable barcode label sheets.

### Sales and customers

- Quick sales entry with product picker, barcode scanner, quantity, pack size, unit, tax, discount, and profit calculation.
- Paid, partial, and credit sale statuses with due amounts and due dates.
- Sales returns and customer payments.
- 58 mm thermal receipts, A4 invoices, WhatsApp sale sharing, and printable receipt history.
- Customer directory with phone, address, credit limit, category tags, customer barcodes, membership cards, and per-customer balances.
- Completed bills, customer bills, call notes, point programs, voucher redemption, and quotation creation.
- Online orders created by the public storefront, with confirm/cancel workflows in the manager.

### Purchases and suppliers

- Supplier directory with company/contact details, phone, email, address, notes, and products sold.
- Multi-item supplier purchase bills with tax, charges, grand total, paid amount, due date, and payment status.
- Multiple bill images per purchase with automatic browser-side compression before save; long edges are capped at 1800 px and output is tuned for small, readable JPEGs.
- Automatic product creation/matching, purchase price updates, stock and pack updates.
- Purchase reminders and overdue/partial/paid/credit filtering.
- Brokers directory with WhatsApp numbers and saved enquiries with Sent / Ordered / Received / Cancelled statuses.
- Purchase bill PDF/print output and downloadable bill-image PDFs.

### Employees and payroll

- Employee directory with contact details, role, salary, and documents.
- Attendance marking for present, half day, leave, holiday, and absent.
- Attendance sheet view.
- Automatic monthly salary calculation using the configured daily-rate model.
- Payroll, payments, advances, payslips, and WhatsApp payslip messages.
- Employee reports and exports.

### Finance and operations

- Expense entry with expense categories.
- Asset register with asset categories and depreciation value.
- Cheque tracking for cheques given or received, with bank, number, drawer, payee, amount, issue date, clearing date, and Pending / Overdue / Cleared / Bounced statuses.
- Tasks with assignee, priority, due date, and Pending / In Progress / Overdue / Completed status.
- Reminders for dues, cheques, tasks, and follow-ups.
- Call notes with callback tracking.
- Business documents uploaded by category, stored on disk, and opened/downloaded from the app.

### Marketing and promotions

- Discount voucher campaigns with fixed amount or percentage discounts and monthly usage limits.
- Vouchers issued with bills and redeemed on later purchases.
- Coupon/card printing.
- Point programs with balance tracking.
- WhatsApp broadcast and SMS/email broadcast tools.
- WhatsApp quotation and sale sharing.

### Settings

- Store name, address, phone, logo, tax number, bank details, UPI ID, footer text, tagline, WhatsApp number, and delivery fee.
- Invoice next number and store receipt configuration.
- Online store enable/disable and public store URL.
- Scan command barcodes and printable command card for `CMD:SALE`, `CMD:NEW`, `CMD:PRT`, and `CMD:PAY`.
- Action password setup/change/remove and protection toggle.
- Sync device pairing, paired phone list, disconnect, conflict review, and conflict marking.
- SQL backup, Excel backup, backup inspection, and backup import in replace or merge mode.

## Android app features

- Bottom tabs: Home, Sell, Products, Sales, and More.
- More menu groups: Shop, Sales and marketing, Team, Records, and Insights.
- Screens include Dashboard, POS, Products, Sales, Customers, Purchases, Expenses, Reports, Settings, Reminders, Assets, Cheques, Tasks, Call Notes, Business Docs, Brokers, Vouchers, Employees, Attendance Sheet, Employee Reports, Returns, Quotation, Prices, Stock Levels, Stock Removal, Packs, Suppliers, Online Orders, Customer Payments, Completed Bills, WhatsApp Broadcast, SMS and Email, Categories, Measuring Units, and Weight Barcodes.
- PIN-based app lock with 6-digit PIN, PBKDF2-SHA256 hashing, SQLCipher encryption, optional biometrics, and reset/forgot-PIN recovery.
- Local ZIP backup and SQL backup/import, including database and optionally images/documents.
- Web sync setup from **Settings → Sync with web** and local data replacement from web backup.
- Native barcode scanning using ML Kit.
- Bluetooth ESC/POS 58 mm receipt and weight-label printing.
- Capacitor Share, filesystem, biometric, status bar, haptics, and HTTP plugins.
- Keyboard-safe layouts, fixed bottom navigation above the keyboard, and tested reset/recovery flows.
- Android test notes are in `docs/mobile-app-test-report.md`; performance notes are in `docs/android-performance-report-2026-11-19.md`.

## Online store features

- Storefront pages: home/catalog, product detail, cart, order success, order tracking, and not found.
- Only products marked **Online** with stock are shown.
- Stock respects product packs first, then plain product stock.
- Delivery or pickup checkout with customer phone and delivery address validation.
- Orders are stored as online-channel sales with `ONL-####` invoice numbers and appear in the web manager.
- Server re-checks prices and stock before accepting an order.
- Public order tracking by invoice number and phone.
- WhatsApp confirmation link for every order.
- Shop manager can confirm or cancel online orders.

## Sync between web and phone

- Stable `sync_id` and `updated_at` fields on synced rows.
- Database triggers record changes in `sync_changes`, including tombstones for deletes.
- Pairing-code flow with one-time codes and device tokens.
- Manual sync, auto-sync, pull, push, snapshot, and Server-Sent Events for live updates.
- Server-wins conflict resolution using base timestamps.
- Web Settings page lists paired devices, pairing codes, pending sync conflicts, and conflict groups.
- Mobile Settings shows sync status, pending count, last error, and sync actions.
- Synced data includes store info, catalog, customers, suppliers, purchases, packs, sales, returns, payments, call notes, stock removals, employees, attendance, payroll, tasks, assets, expenses, cheques, documents, non-sale inventory, vouchers, and brokers.
- Old sync changes are purged after the configured retention period, default 90 days.

## Printing, barcodes, and sharing

- 58 mm thermal receipts, A4 invoices, voucher coupons, customer cards, and purchase bill PDFs.
- Remote printing: the web or mobile client sends receipt/label HTML to the server, which renders a PDF with headless Chrome and queues it on a CUPS printer.
- Default remote printer queue: `Netum58`.
- Barcode SVG generation for products, customers, weight labels, and label sheets.
- Generic weight barcodes such as `WT:250`, `WT:500`, and `WT:1000`.
- Android ML Kit scanner for product and command barcodes.
- Android Bluetooth ESC/POS printing for receipts and weight labels.
- UPI ID in Settings adds an amount-specific QR code to printed bills.
- WhatsApp helpers for sales, vouchers, quotations, broker enquiries, payslips, online orders, and broadcasts.
- SMS and email broadcast tools.

## Security and access

- The web manager has no login screen and is intended for a private local network.
- An optional action password gates web edit/delete actions in the client API layer and unlocks actions for a short window.
- Sync device and conflict administration routes enforce the action password on the server.
- Store info API excludes password hashes.
- The mobile app uses a 6-digit PIN, PBKDF2-SHA256, SQLCipher encryption, optional biometrics, and complete local wipe on Forgot PIN.
- Android cleartext traffic is kept enabled only so the app can reach the local web API over the LAN.
- Never expose the web manager port `3001` through a public tunnel. Only expose the online store port `3002` when using Cloudflare Tunnel.

## Backups and restore

- Web Settings can download a compressed SQL dump and an Excel backup ZIP.
- Web Settings can inspect and import backups in replace or merge mode.
- `scripts/backup.sh` creates a compressed `pg_dump` backup, archives uploads, writes SHA256 checksums, verifies the archive, applies retention, and locks concurrent runs.
- Mobile Settings can export ZIP backups, export SQL backups, import ZIP backups, import web SQL dumps, and erase all app data.
- Mobile SQL import maps web column names, skips unknown tables/columns, and rebuilds invoice numbering and totals.
- SQL backups contain data only; file backups are needed for images and documents.

## Requirements

| Component | Requirement |
| --- | --- |
| Node.js | 18+ for web/server; 20+ recommended for mobile build |
| PostgreSQL | Local or LAN database, default name `store_master` |
| Browser | Modern Chrome/Chromium/Edge/Firefox for the web manager |
| Printing | CUPS and Chrome/Chromium for remote PDF printing |
| Android build | JDK 17 or 21, Android SDK 35, Android Build-Tools 35.0.0 |
| Optional public store | Cloudflare Tunnel or another reverse tunnel for port `3002` only |

## Quick start

```sh
# 1. Create the database (or set DATABASE_URL / PGDATABASE)
createdb store_master

# 2. Configure the server
cd server
cp .env.example .env
cd ..

# 3. Install everything
npm run setup

# 4. Run web manager and API
npm run dev
```

Open `http://localhost:5173` for development.

The API runs on `http://localhost:3001`. `APP-URL.txt` is refreshed with the current LAN address and localhost URLs while the server is running.

The server auto-creates empty tables on first run. Existing data is not wiped on normal restarts.

### Demo data

A small demo dataset can be loaded on a brand-new database:

```sh
SEED_DEMO=true npm run dev --prefix server
```

It is off by default. Set `SEED_DEMO=true` in `server/.env` to enable it.

### Resetting the database

This deletes all data and recreates the schema:

```sh
RESET_DB=true npm run dev --prefix server
# or
node server/index.js --reset
```

## NPM scripts

| Script | Purpose |
| --- | --- |
| `npm run setup` | Install dependencies for web, server, and online store |
| `npm run dev` | Run web manager on `5173` and API on `3001` |
| `npm run dev:store` | Run online store dev server on `5174` and store API on `3002` |
| `npm run build` | Build the web manager into `client/dist` |
| `npm run store:build` | Build the online store into `store/client/dist` |
| `npm start` | Serve built web manager and API together on `3001` |
| `npm run store:start` | Serve built online store on `3002` |

## Production build

```sh
npm run build
NODE_ENV=production npm start
```

Open `http://localhost:3001`.

Express serves the built front-end from `client/dist`. Hashed assets are cached for 7 days as immutable; uploaded images are cached for 1 day.

## Online store setup

```sh
cp store/server/.env.example store/server/.env
npm run dev:store
```

Development URLs:

- Online store: `http://localhost:5174`
- Store API: `http://localhost:3002`

Built store:

```sh
npm run store:build
npm run store:start
```

Open `http://localhost:3002`.

The store shares `store_master` with the web manager. Products marked **Online** and settings under **Settings → Online store** apply immediately. Orders appear under **Online Orders** in the web manager.

To publish the store with Cloudflare Tunnel:

```sh
npm run store:build
npm run store:start
cloudflared tunnel --url http://localhost:3002 --no-autoupdate
```

Paste the public URL into **Settings → Online store → Public store URL**. The URL changes on every restart unless a named tunnel is used.

## Android build

See `mobile/BUILD.md` for the complete guide. Short version:

```bash
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
export PATH="$JAVA_HOME/bin:$PATH"

cd mobile
npm install
npm run build
npx cap sync android
cd android
./gradlew assembleDebug
```

Debug APK output:

```text
mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

Install on a connected device:

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Do not use JDK 25 with Gradle 8.11.1. JDK 17 or 21 is supported.

## Podman deployment

Recommended containers: `store-db` and `store-manager`.

```bash
podman start store-db
podman start store-manager
```

Open `http://localhost:3001`.

If the containers do not exist yet:

```bash
podman network create store-net
podman run -d --name store-db --network store-net \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres \
  -v store-db-data:/var/lib/postgresql/data docker.io/library/postgres:17
podman run -d --name store-manager --network store-net \
  -p 0.0.0.0:3001:3001 \
  -e PGHOST=store-db -e PGUSER=postgres -e PGPASSWORD=postgres \
  -e PGDATABASE=store_master -e SEED_DEMO=true \
  -v store-uploads:/app/server/uploads localhost/store-manager:latest
```

Rebuild the image after code changes:

```bash
podman build -t store-manager:latest .
```

## Environment variables

### Web/server — `server/.env`

| Variable | Default | Description |
| --- | --- | --- |
| `PGHOST` | `127.0.0.1` | PostgreSQL host |
| `PGPORT` | `5432` | PostgreSQL port |
| `PGUSER` | `postgres` | PostgreSQL user |
| `PGPASSWORD` | `postgres` | PostgreSQL password |
| `PGDATABASE` | `store_master` | Database name |
| `DATABASE_URL` | — | Full PostgreSQL URL; overrides individual `PG*` values |
| `SHOP_TZ` | `Asia/Kolkata` | Timezone used for shop dates and bill timestamps |
| `SEED_DEMO` | `false` | Load demo data on a fresh database |
| `RESET_DB` | `false` | Wipe and recreate all tables on startup |
| `PRINTER_NAME` | `Netum58` | CUPS queue for remote receipt printing |
| `CHROME_BIN` | `/usr/bin/google-chrome-stable` | Optional Chrome/Chromium binary for PDF rendering |
| `SYNC_RETENTION_DAYS` | `90` | Days of sync changes kept before purge |

### Online store — `store/server/.env`

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3002` | Public store API port |
| `INVENTORY_DATABASE_URL` | — | Full database URL for `store_master` |
| `PGHOST` | `127.0.0.1` | Database host when URL is not set |
| `PGPORT` | `5432` | Database port when URL is not set |
| `PGUSER` | `postgres` | Database user when URL is not set |
| `PGPASSWORD` | `postgres` | Database password when URL is not set |
| `INVENTORY_DB_NAME` | `store_master` | Database name when URL is not set |
| `INVENTORY_UPLOADS_DIR` | `<repo>/server/uploads` | Folder for product/bill images |

## Project layout

- `client/` — React web manager.
- `client/src/pages/` — one page per module, including Sales, Products, SupplierPurchases, Reports, and Settings.
- `client/src/components/` — shared UI such as Modal, SearchableSelect, Pagination, and DraftBanner.
- `client/src/lib/receipt.js` — 58 mm/A4 receipt and invoice printing.
- `client/src/lib/imageCompression.js` — browser-side bill image compression.
- `client/src/lib/whatsapp.js` — WhatsApp message builders.
- `server/index.js` — Express startup, static serving, seed/reset gating, sync mounting, and LAN URL updates.
- `server/api.js` — main REST API.
- `server/db.js` — connection pool, idempotent schema, indexes, and demo seed.
- `server/sync.js` — phone/server sync endpoints and change tracking.
- `server/backup.js` — SQL/Excel backup and import.
- `server/print.js` — headless Chrome PDF rendering and CUPS queueing.
- `server/uploads/` — product and bill images stored on disk.
- `mobile/` — Capacitor Android app with encrypted local SQLite.
- `store/` — public online storefront and store API.
- `scripts/backup.sh` — scheduled-style compressed backup with checksums and retention.
- `deploy/` — systemd service files.
- `docs/` — test and performance reports.

## Operational notes

- Receipt header, footer, UPI QR, tax details, and bank details are set in **Settings**.
- `GET /api/product-packs` returns `{ packs, stats }` with a 500-row cap.
- The web manager has no login; keep it on the shop LAN only.
- The Android app uses cleartext LAN access to the web API for sync; keep that network trusted.
- `install.sh` is an OpenCode installer and is not used to install this app. Use `setup.sh`, `npm run setup`, or the Podman instructions instead.
- Existing bill images are not reprocessed automatically; the new compression applies to newly added web bill images.
