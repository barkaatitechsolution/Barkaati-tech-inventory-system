#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
APP_DIR="$SCRIPT_DIR"
SERVICE_NAME="barkaati-inventory.service"
LEGACY_VITE_SERVICE="barkaati-vite.service"
SERVICE_TEMPLATE="$APP_DIR/deploy/$SERVICE_NAME"
ENV_FILE="$APP_DIR/server/.env"
APP_PORT="${APP_PORT:-3001}"

SKIP_APT=0
SKIP_DEPS=0
SKIP_BUILD=0
NO_START=0

if [[ -t 1 ]]; then
  BOLD=$'\033[1m'
  GREEN=$'\033[0;32m'
  YELLOW=$'\033[0;33m'
  RED=$'\033[0;31m'
  BLUE=$'\033[0;34m'
  NC=$'\033[0m'
else
  BOLD=""
  GREEN=""
  YELLOW=""
  RED=""
  BLUE=""
  NC=""
fi

log() { printf '%s==>%s %s\n' "$BLUE" "$NC" "$*"; }
ok() { printf '%s  ok%s %s\n' "$GREEN" "$NC" "$*"; }
warn() { printf '%swarn%s %s\n' "$YELLOW" "$NC" "$*" >&2; }
die() { printf '%serror%s %s\n' "$RED" "$NC" "$*" >&2; exit 1; }

usage() {
  cat <<EOF
Barkaati Tech Inventory System - automatic setup

Usage:
  sudo ./setup.sh [options]

Options:
  -h, --help       Show this help and exit
      --skip-apt   Do not install Node.js/PostgreSQL system packages
      --skip-deps  Do not run npm ci / npm install
      --skip-build Do not rebuild the client
      --no-start   Install/enable the service but do not start or restart it
      --port PORT  Production port (default: 3001)

What it does:
  - Installs missing Node.js 18+ and PostgreSQL packages on Debian/Ubuntu
  - Installs client/server npm dependencies
  - Builds the production client
  - Reuses server/.env and creates the database if it is missing
  - Installs and starts one systemd service on the production port
  - Removes the old barkaati-vite.service if it exists

The database is never reset by this script. Set RESET_DB=false in
server/.env before running if it is currently true.
EOF
}

for arg in "$@"; do
  case "$arg" in
    -h|--help) usage; exit 0 ;;
  esac
done

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  if command -v sudo >/dev/null 2>&1; then
    log "Root access is required; re-running with sudo..."
    exec sudo -E bash "$SCRIPT_DIR/$(basename -- "$0")" "$@"
  fi
  die "Run this script as root (for example: sudo ./setup.sh)."
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-apt) SKIP_APT=1; shift ;;
    --skip-deps) SKIP_DEPS=1; shift ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    --no-start) NO_START=1; shift ;;
    --port)
      [[ -n "${2:-}" ]] || die "--port requires a value"
      APP_PORT="$2"; shift 2 ;;
    --port=*) APP_PORT="${1#*=}"; shift ;;
    *) die "Unknown option: $1 (use --help)" ;;
  esac
done

[[ "$APP_PORT" =~ ^[0-9]+$ ]] || die "Invalid port: $APP_PORT"
(( APP_PORT >= 1 && APP_PORT <= 65535 )) || die "Invalid port: $APP_PORT"

command -v systemctl >/dev/null 2>&1 || die "systemd is required."
[[ -f "$SERVICE_TEMPLATE" ]] || die "Missing service template: $SERVICE_TEMPLATE"

if [[ -n "${SUDO_USER:-}" && "${SUDO_USER}" != "root" ]]; then
  APP_USER="$SUDO_USER"
else
  APP_USER="$(stat -c '%U' "$APP_DIR")"
fi
id "$APP_USER" >/dev/null 2>&1 || die "Application user does not exist: $APP_USER"
APP_GROUP="$(id -gn "$APP_USER")"
APP_HOME="$(getent passwd "$APP_USER" | cut -d: -f6)"
[[ -n "$APP_HOME" ]] || APP_HOME="/home/$APP_USER"
if [[ "$APP_USER" == "root" ]]; then
  warn "The repository is owned by root; the service will run as root. Chown it to a normal user to avoid this."
fi

run_as_app() {
  if [[ "$(id -un)" == "$APP_USER" ]]; then
    "$@"
  elif command -v runuser >/dev/null 2>&1; then
    runuser -u "$APP_USER" -- env HOME="$APP_HOME" PATH="$PATH" "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo -u "$APP_USER" -H -- "$@"
  else
    die "Cannot run commands as $APP_USER (need runuser or sudo)."
  fi
}

apt_install() {
  DEBIAN_FRONTEND=noninteractive apt-get install -y "$@"
}

install_system_packages() {
  command -v apt-get >/dev/null 2>&1 || die "Full bootstrap needs apt-get. Re-run with --skip-apt after installing Node.js 18+ and PostgreSQL manually."

  log "Refreshing apt package lists..."
  DEBIAN_FRONTEND=noninteractive apt-get update -y

  log "Installing base tools..."
  apt_install ca-certificates curl gnupg lsb-release

  local node_major=0
  if command -v node >/dev/null 2>&1; then
    node_major="$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)"
  fi

  if (( node_major < 18 )); then
    log "Installing Node.js 22..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt_install nodejs
  fi

  if ! command -v npm >/dev/null 2>&1; then
    log "Installing npm..."
    apt_install npm
  fi

  if ! command -v psql >/dev/null 2>&1 || ! command -v pg_isready >/dev/null 2>&1; then
    log "Installing PostgreSQL..."
    apt_install postgresql postgresql-contrib
  fi

  systemctl enable --now postgresql.service
  for _ in {1..30}; do
    pg_isready -q && break
    sleep 1
  done
  pg_isready -q || die "PostgreSQL did not become ready."

  node_major="$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)"
  (( node_major >= 18 )) || die "Node.js 18 or newer is required (found $node_major)."
  command -v npm >/dev/null 2>&1 || die "npm is not available."
  command -v psql >/dev/null 2>&1 || die "psql is not available."
  ok "System packages ready."
}

check_runtime() {
  command -v node >/dev/null 2>&1 || die "Node.js is missing. Run without --skip-apt or install Node.js 18+."
  command -v npm >/dev/null 2>&1 || die "npm is missing."
  command -v psql >/dev/null 2>&1 || die "PostgreSQL client (psql) is missing."
  local node_major
  node_major="$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)"
  (( node_major >= 18 )) || die "Node.js 18 or newer is required (found $node_major)."
}

install_dependencies() {
  local npm_bin
  npm_bin="$(command -v npm)"

  for package_dir in client server; do
    log "Installing $package_dir dependencies..."
    if [[ -f "$APP_DIR/$package_dir/package-lock.json" ]]; then
      run_as_app "$npm_bin" ci --prefix "$APP_DIR/$package_dir" --no-audit --no-fund
    else
      run_as_app "$npm_bin" install --prefix "$APP_DIR/$package_dir" --no-audit --no-fund
    fi
  done
  ok "Dependencies installed."
}

build_client() {
  local npm_bin
  npm_bin="$(command -v npm)"
  log "Building the production client..."
  run_as_app "$npm_bin" run build --prefix "$APP_DIR/client"
  [[ -f "$APP_DIR/client/dist/index.html" ]] || die "Client build did not produce client/dist/index.html."
  ok "Client build complete."
}

load_env() {
  if [[ ! -f "$ENV_FILE" ]]; then
    [[ -f "$APP_DIR/server/.env.example" ]] || die "Missing server/.env and server/.env.example."
    cp "$APP_DIR/server/.env.example" "$ENV_FILE"
    chown "$APP_USER:$APP_GROUP" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    warn "Created server/.env from server/.env.example. Edit it if your PostgreSQL credentials differ."
  fi

  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a

  local name value
  for name in DATABASE_URL PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE SHOP_TZ RESET_DB; do
    if [[ -n "${!name:-}" ]]; then
      value="${!name%$'\r'}"
      printf -v "$name" '%s' "$value"
      export "$name"
    fi
  done

  if [[ "${RESET_DB:-false}" == "true" ]]; then
    die "RESET_DB=true would wipe the database. Set RESET_DB=false in server/.env before running setup."
  fi
}

psql_local_admin() {
  local psql_bin
  psql_bin="$(command -v psql)"
  if command -v runuser >/dev/null 2>&1; then
    runuser -u postgres -- "$psql_bin" "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo -u postgres -- "$psql_bin" "$@"
  else
    return 1
  fi
}

is_local_host() {
  case "${PGHOST:-127.0.0.1}" in
    127.0.0.1|localhost|::1|"") return 0 ;;
    *) return 1 ;;
  esac
}

configure_local_postgres() {
  is_local_host || return 1
  command -v psql >/dev/null 2>&1 || return 1

  log "Local database login failed; configuring the local PostgreSQL role..."
  psql_local_admin -d postgres -v ON_ERROR_STOP=1 \
    -v role="$PGUSER" -v pass="$PGPASSWORD" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN CREATEDB PASSWORD %L', :'role', :'pass')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'role') \gexec
SELECT format('ALTER ROLE %I WITH LOGIN CREATEDB PASSWORD %L', :'role', :'pass') \gexec
SQL
  ok "PostgreSQL role ready: $PGUSER"
}

ensure_database() {
  load_env
  command -v psql >/dev/null 2>&1 || die "psql is required to prepare the database."

  if [[ -n "${DATABASE_URL:-}" ]]; then
    log "Checking DATABASE_URL connection..."
    psql "$DATABASE_URL" -Atqc "SELECT 1" >/dev/null || die "Could not connect using DATABASE_URL."
    ok "Database connection OK."
    return 0
  fi

  PGHOST="${PGHOST:-127.0.0.1}"
  PGPORT="${PGPORT:-5432}"
  PGUSER="${PGUSER:-postgres}"
  PGPASSWORD="${PGPASSWORD:-}"
  PGDATABASE="${PGDATABASE:-store_master}"
  export PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE

  if is_local_host && systemctl cat postgresql.service >/dev/null 2>&1; then
    systemctl enable --now postgresql.service >/dev/null 2>&1 || warn "Could not start the PostgreSQL service."
    for _ in {1..15}; do
      pg_isready -q && break
      sleep 1
    done
  fi

  local psql_admin=(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres)
  local psql_db=(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE")

  log "Checking PostgreSQL connection to $PGHOST:$PGPORT as $PGUSER..."
  if ! "${psql_admin[@]}" -Atqc "SELECT 1" >/dev/null 2>&1; then
    configure_local_postgres || die "Could not login to PostgreSQL. Check the PG* values in server/.env."
    "${psql_admin[@]}" -Atqc "SELECT 1" >/dev/null || die "PostgreSQL login still failed after local configuration."
  fi

  local db_literal db_ident db_exists
  db_literal="$(printf '%s' "$PGDATABASE" | sed "s/'/''/g")"
  db_ident="$(printf '%s' "$PGDATABASE" | sed 's/"/""/g')"
  db_exists="$("${psql_admin[@]}" -Atqc "SELECT 1 FROM pg_database WHERE datname = '$db_literal'")"

  if [[ "$db_exists" != "1" ]]; then
    log "Creating database $PGDATABASE..."
    if ! "${psql_admin[@]}" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$db_ident\""; then
      configure_local_postgres || die "Could not create database $PGDATABASE."
      psql_local_admin -d postgres -v ON_ERROR_STOP=1 \
        -c "CREATE DATABASE \"$db_ident\" OWNER \"$(printf '%s' "$PGUSER" | sed 's/"/""/g')\"" \
        || die "Could not create database $PGDATABASE."
    fi
    ok "Database created."
  fi

  "${psql_db[@]}" -Atqc "SELECT 1" >/dev/null || die "Could not connect to database $PGDATABASE."
  ok "Database connection OK."
}

write_service() {
  local node_bin template content unit_tmp fragment
  node_bin="$(command -v node)"
  template="$(<"$SERVICE_TEMPLATE")"
  content="${template//__APP_DIR__/$APP_DIR}"
  content="${content//__APP_USER__/$APP_USER}"
  content="${content//__APP_GROUP__/$APP_GROUP}"
  content="${content//__APP_PORT__/$APP_PORT}"
  content="${content//__NODE_BIN__/$node_bin}"

  if systemctl cat "$LEGACY_VITE_SERVICE" >/dev/null 2>&1; then
    log "Removing legacy Vite development service..."
    systemctl disable --now "$LEGACY_VITE_SERVICE" >/dev/null 2>&1 || warn "Could not stop $LEGACY_VITE_SERVICE."
    fragment="$(systemctl show -p FragmentPath --value "$LEGACY_VITE_SERVICE" 2>/dev/null || true)"
    [[ -n "$fragment" ]] && rm -f "$fragment"
  fi
  rm -f "/etc/systemd/system/$LEGACY_VITE_SERVICE"

  log "Installing systemd service..."
  unit_tmp="$(mktemp "/etc/systemd/system/.${SERVICE_NAME}.XXXXXX")"
  printf '%s\n' "$content" > "$unit_tmp"
  chmod 644 "$unit_tmp"
  mv "$unit_tmp" "/etc/systemd/system/$SERVICE_NAME"

  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME" >/dev/null
  ok "Service installed: /etc/systemd/system/$SERVICE_NAME"
}

start_service() {
  log "Starting $SERVICE_NAME..."
  systemctl restart "$SERVICE_NAME"

  local url="http://127.0.0.1:${APP_PORT}/api/health"
  local ready=0
  for _ in {1..30}; do
    if command -v curl >/dev/null 2>&1; then
      curl -fsS "$url" >/dev/null 2>&1 && { ready=1; break; }
    else
      node -e "fetch('$url').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1 && { ready=1; break; }
    fi
    sleep 1
  done

  if (( ready == 0 )); then
    warn "Health check did not pass. Recent service logs:"
    journalctl -u "$SERVICE_NAME" -n 80 --no-pager >&2 || true
    die "Service failed to become healthy on port $APP_PORT."
  fi

  ok "Service is healthy on port $APP_PORT."
}

print_urls() {
  local lan_ip=""
  lan_ip="$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -v '^$' | head -n 1 || true)"
  printf '\n%sSetup complete%s\n' "$BOLD" "$NC"
  printf '  Local:  http://localhost:%s\n' "$APP_PORT"
  if [[ -n "$lan_ip" ]]; then
    printf '  LAN:    http://%s:%s\n' "$lan_ip" "$APP_PORT"
  fi
  printf '\n  Service: %s\n' "$SERVICE_NAME"
  printf '  Status:  systemctl status %s\n' "$SERVICE_NAME"
  printf '  Logs:    journalctl -u %s -f\n\n' "$SERVICE_NAME"
}

if (( SKIP_APT == 0 )); then
  install_system_packages
else
  warn "Skipping system package installation."
fi

check_runtime

if (( SKIP_DEPS == 0 )); then
  install_dependencies
else
  warn "Skipping dependency installation."
fi

if (( SKIP_BUILD == 0 )); then
  build_client
else
  warn "Skipping client build."
fi

ensure_database
write_service

if (( NO_START == 0 )); then
  start_service
else
  warn "Service was not started (--no-start). Run: systemctl restart $SERVICE_NAME"
fi

print_urls
