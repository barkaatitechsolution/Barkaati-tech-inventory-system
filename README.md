# Store Master — offline-first shop manager

A small inventory + billing app. React (Vite) front-end with a simple
Express + PostgreSQL API. Designed to run locally on the shop's computer,
fully offline.

## Stack

- **Client** — React 18, Vite, Tailwind CSS, Recharts (`client/`)
- **Server** — Express, `pg`, PostgreSQL (`server/`)
- **No auth, no accounts** — everything lives in the local database

## Getting started

1. Create the database:

   ```sh
   createdb store_master
   ```

2. Configure the server (copy `.env.example` to `.env` and fill in your
   PostgreSQL credentials).

3. Install and run:

   ```sh
   npm install --prefix client
   npm run dev --prefix client   # web UI on http://localhost:5173
   ```

   ```sh
   npm install --prefix server
   npm run dev --prefix server   # API on http://localhost:3001
   ```

4. First run seeds a small dataset. Tables are created if they don't exist;
   existing data is never wiped on normal restarts.

## Resetting the database

To wipe and recreate all tables (deletes all data), start the server with:

```sh
RESET_DB=true npm run dev --prefix server
# or
node server/index.js --reset
```

`RESET_DB=false` (the default) is documented in `server/.env.example`.

## Production build

```sh
npm run build --prefix client   # outputs client/dist
npm run start --prefix server   # serves the built client + API together
```

The server serves the built front-end from `client/dist` automatically.

## Project layout

- `server/db.js` — connection pool, idempotent schema, seed data
- `server/api.js` — all REST endpoints
- `server/index.js` — Express app entry
- `server/uploads/` — bill images (stored on disk, never in the DB)
- `client/src/pages/` — one page per module (Sales, Products, Reports, …)
- `client/src/lib/receipt.js` — printable 58 mm / A4 receipt generator

## Notes

- Bill images are saved to `server/uploads/` and served at `/uploads/...`
- Receipt header (store name / address / phone) is set in **Settings**
- `GET /api/product-packs` returns `{ packs, stats }` with a 500-row cap