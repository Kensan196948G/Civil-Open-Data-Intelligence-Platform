#!/usr/bin/env sh
set -eu

DB_PATH="${1:-prisma/dev.db}"
BACKUP_DIR="${2:-backups/sqlite}"

if [ ! -f "$DB_PATH" ]; then
  echo "[sqlite-backup][error] database not found: $DB_PATH" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BASE_NAME="$(basename "$DB_PATH")"
BACKUP_PATH="$BACKUP_DIR/${BASE_NAME}.${STAMP}.bak"

if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB_PATH" ".backup '$BACKUP_PATH'"
else
  cp "$DB_PATH" "$BACKUP_PATH"
fi

echo "[sqlite-backup] created $BACKUP_PATH"
