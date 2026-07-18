#!/usr/bin/env sh
set -eu
umask 077

DB_PATH="${1:-prisma/dev.db}"
BACKUP_DIR="${2:-backups/sqlite}"

if [ ! -f "$DB_PATH" ]; then
  echo "[sqlite-backup][error] database not found: $DB_PATH" >&2
  exit 1
fi

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "[sqlite-backup][error] sqlite3 command not found; refusing unsafe raw file copy (WAL mode may corrupt a plain cp backup)" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BASE_NAME="$(basename "$DB_PATH")"
BACKUP_PATH="$(mktemp "$BACKUP_DIR/${BASE_NAME}.${STAMP}.XXXXXX")" || {
  echo "[sqlite-backup][error] failed to reserve a unique backup path" >&2
  exit 1
}

sqlite3 "$DB_PATH" ".backup '$BACKUP_PATH'"

echo "[sqlite-backup] created $BACKUP_PATH"
