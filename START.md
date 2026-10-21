# How to Start the App (Step by Step)

## Option A — Run locally with Node (development/production)

1. Start PostgreSQL (if not running):
   ```bash
   sudo service postgresql start
   ```
2. Make sure the postgres password matches the app default (`postgres`), or create a `.env` in `server/`:
   ```
   PGHOST=127.0.0.1
   PGPORT=5432
   PGUSER=postgres
   PGPASSWORD=your_password
   PGDATABASE=store_master
   ```
3. Install dependencies (first time only):
   ```bash
   npm run setup
   ```
4a. Development mode:
   ```bash
   npm run dev
   ```
   Open http://localhost:5173
4b. Production mode:
   ```bash
   npm run build
   npm start
   ```
   Open http://localhost:3001

## Option B — Run in Podman (recommended)

1. Start the database container:
   ```bash
   podman start store-db
   ```
2. Start the app container:
   ```bash
   podman start store-manager
   ```
   Open http://localhost:3001

If the containers don't exist yet, create them:
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

(Rebuild the image after code changes with `podman build -t store-manager:latest .`)

## Publish to the world with Cloudflare Tunnel

```bash
cloudflared tunnel --url http://localhost:3001 --no-autoupdate
```
It prints a public `https://....trycloudflare.com` URL — share that. Note: the URL changes every restart.

## Useful commands

| Action | Command |
|---|---|
| Container logs | `podman logs -f store-manager` |
| Stop containers | `podman stop store-manager store-db` |
| Rebuild image | `podman build -t store-manager:latest .` |
| Stop tunnel | Ctrl+C the cloudflared process |
