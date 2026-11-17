#!/usr/bin/env bash
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$APP_DIR/server/.env"
UPLOADS_DIR="$APP_DIR/server/uploads"
DEST="${BARKAATI_BACKUP_DIR:-$HOME/BarkaatiBackups}"
RETENTION_DAYS="${BARKAATI_BACKUP_RETENTION_DAYS:-30}"
STAMP="$(date +%Y-%m-%d_%H%M%S)"
DB_FINAL="$DEST/db-$STAMP.dump"
UPLOADS_FINAL="$DEST/uploads-$STAMP.tar.gz"
CHECKSUMS_FINAL="$DEST/backup-$STAMP.sha256"
DB_TMP="$DEST/.db-$STAMP.tmp"
UPLOADS_TMP="$DEST/.uploads-$STAMP.tmp"
CHECKSUMS_TMP="$DEST/.checksums-$STAMP.tmp"

log() {
  printf '%s %s\n' "$(date --iso-8601=seconds)" "$*"
}

fail() {
  log "ERROR: $*" >&2
  exit 1
}

cleanup() {
  rm -f -- "$DB_TMP" "$UPLOADS_TMP" "$CHECKSUMS_TMP"
}
trap cleanup EXIT

command -v pg_dump >/dev/null 2>&1 || fail "pg_dump is not installed"
command -v pg_restore >/dev/null 2>&1 || fail "pg_restore is not installed"
command -v tar >/dev/null 2>&1 || fail "tar is not installed"
command -v flock >/dev/null 2>&1 || fail "flock is not installed"
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is not installed"

[[ -r "$ENV_FILE" ]] || fail "Cannot read $ENV_FILE"
[[ -d "$UPLOADS_DIR" ]] || fail "Uploads directory not found: $UPLOADS_DIR"

set -a
source "$ENV_FILE"
set +a

for name in PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE; do
  value="${!name:-}"
  value="${value%$'\r'}"
  printf -v "$name" '%s' "$value"
  [[ -n "$value" ]] || fail "$name is not set in $ENV_FILE"
done

mkdir -p -- "$DEST"
chmod 700 -- "$DEST"

exec 9>"$DEST/.backup.lock"
flock -n 9 || fail "Another backup is already running"

log "Starting backup of $PGDATABASE and uploads into $DEST"

pg_dump \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-privileges \
  --file="$DB_TMP" \
  --dbname="$PGDATABASE"

[[ -s "$DB_TMP" ]] || fail "Database backup is empty"
pg_restore --list "$DB_TMP" >/dev/null || fail "Database backup failed verification"
mv -- "$DB_TMP" "$DB_FINAL"
chmod 600 -- "$DB_FINAL"

tar -C "$APP_DIR/server" -czf "$UPLOADS_TMP" uploads
[[ -s "$UPLOADS_TMP" ]] || fail "Uploads backup is empty"
tar -tzf "$UPLOADS_TMP" >/dev/null || fail "Uploads backup failed verification"
mv -- "$UPLOADS_TMP" "$UPLOADS_FINAL"
chmod 600 -- "$UPLOADS_FINAL"

(
  cd -- "$DEST"
  sha256sum "$(basename -- "$DB_FINAL")" "$(basename -- "$UPLOADS_FINAL")" >"$CHECKSUMS_TMP"
)
chmod 600 -- "$CHECKSUMS_TMP"
mv -- "$CHECKSUMS_TMP" "$CHECKSUMS_FINAL"

find "$DEST" -maxdepth 1 -type f \
  \( -name 'db-*.dump' -o -name 'uploads-*.tar.gz' -o -name 'backup-*.sha256' \) \
  -mtime +"$RETENTION_DAYS" -delete

log "Backup complete: db=$(du -h "$DB_FINAL" | cut -f1) uploads=$(du -h "$UPLOADS_FINAL" | cut -f1)"
