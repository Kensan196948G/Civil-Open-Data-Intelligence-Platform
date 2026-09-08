#!/usr/bin/env bash
#
# 本番ローカルPostgreSQLの日次バックアップ (Issue #218)。
#
# ■ 設計上の決まりごと
#
# 1. このスクリプトは git 管理下に置き、secret を一切含めない。
#    旧 scripts/local-cron/run-backup.sh は接続文字列を内包していたため
#    .gitignore で除外され、git 操作で消えた際に復元できなかった。復元不能な
#    場所に本番バックアップの実行主体を置かない (Issue #218 の構造的原因)。
#
# 2. サーバのメジャーバージョンに一致する pg_dump / pg_restore を使う。
#    PATH 上の pg_dump(17) / pg_restore(16) / psql(18) は互いに異なるため、
#    PATH 任せにすると「取得はできるが、サーバに合う pg_restore では
#    ヘッダバージョン非対応で開けない」ダンプが出来上がる (Issue #218 で実際に
#    2026-08-30〜09-01 の3世代がこの状態だった)。
#
# 3. 取得したダンプを毎回 pg_restore --list で検証してから成功と記録する。
#    「取得できた」は「復元できる」の証拠ではない。検証を通らないダンプは
#    残さず、非ゼロ終了する (静かな失敗を作らない)。
#
# ■ 必要な環境変数
#   DATABASE_URL                    バックアップ対象の接続文字列 (必須)
#   CODIP_BACKUP_DIR                出力先 (既定: $HOME/backups/codip)
#   CODIP_BACKUP_PASSPHRASE_FILE    GPG passphrase ファイル
#                                   (既定: $HOME/.config/codip/backup-passphrase.txt)
#   CODIP_BACKUP_RETENTION_DAYS     保持日数 (既定: 14)
#
set -euo pipefail
umask 077

BACKUP_DIR="${CODIP_BACKUP_DIR:-$HOME/backups/codip}"
PASSPHRASE_FILE="${CODIP_BACKUP_PASSPHRASE_FILE:-$HOME/.config/codip/backup-passphrase.txt}"
RETENTION_DAYS="${CODIP_BACKUP_RETENTION_DAYS:-14}"
LOG_FILE="$BACKUP_DIR/backup.log"

log() {
  local message
  message="[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
  echo "$message"
  mkdir -p "$BACKUP_DIR"
  echo "$message" >> "$LOG_FILE"
}

fail() {
  log "ERROR: $*"
  exit 1
}

[ -n "${DATABASE_URL:-}" ] || fail "DATABASE_URL is not set (systemd の EnvironmentFile を確認してください)"
[ -r "$PASSPHRASE_FILE" ] || fail "passphrase file not readable: $PASSPHRASE_FILE"
command -v gpg >/dev/null 2>&1 || fail "gpg command not found"

# --- サーバのメジャーバージョンに一致する pg_dump / pg_restore を選ぶ ---------
#
# server_version_num は 160014 のような整数。先頭の主要部を取り出す。
# psql 自体はどのバージョンでも問い合わせできるので PATH のものを使う。
server_version_num="$(psql "$DATABASE_URL" -tAX -c 'SHOW server_version_num' 2>/dev/null || true)"
[ -n "$server_version_num" ] || fail "サーバへ接続できず server_version_num を取得できませんでした"
server_major="$(( server_version_num / 10000 ))"

PG_DUMP=""
PG_RESTORE=""
for candidate_dir in "/usr/lib/postgresql/${server_major}/bin" "/usr/local/pgsql-${server_major}/bin"; do
  if [ -x "$candidate_dir/pg_dump" ] && [ -x "$candidate_dir/pg_restore" ]; then
    PG_DUMP="$candidate_dir/pg_dump"
    PG_RESTORE="$candidate_dir/pg_restore"
    break
  fi
done
[ -n "$PG_DUMP" ] || fail "サーバのメジャーバージョン ${server_major} に一致する pg_dump/pg_restore が見つかりません"

# --- 取得 ---------------------------------------------------------------------
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP_PATH="$BACKUP_DIR/codip-${STAMP}.dump"
ENCRYPTED_PATH="${DUMP_PATH}.gpg"

mkdir -p "$BACKUP_DIR"
# 途中終了時に平文ダンプを残さない。
trap 'rm -f "$DUMP_PATH"' EXIT

log "Starting pg_dump (server major=${server_major}, pg_dump=$("$PG_DUMP" --version | awk '{print $NF}'))..."
"$PG_DUMP" --format=custom --no-owner --no-privileges --file="$DUMP_PATH" "$DATABASE_URL" \
  || fail "pg_dump failed"

# --- 検証: サーバに一致する pg_restore で読めることを確かめる -----------------
log "Verifying dump with $(basename "$PG_RESTORE") $("$PG_RESTORE" --version | awk '{print $NF}')..."
object_count="$("$PG_RESTORE" --list "$DUMP_PATH" 2>/dev/null | grep -c '^[0-9]' || true)"
[ "${object_count:-0}" -gt 0 ] \
  || fail "検証に失敗しました (pg_restore --list がオブジェクトを読み取れません)。復元できないダンプは保存しません"
log "Verified: ${object_count} objects readable"

# --- 暗号化 -------------------------------------------------------------------
log "Encrypting..."
gpg --batch --yes --quiet --symmetric --cipher-algo AES256 \
    --passphrase-file "$PASSPHRASE_FILE" \
    --output "$ENCRYPTED_PATH" "$DUMP_PATH" \
  || fail "gpg encryption failed"

rm -f "$DUMP_PATH"
trap - EXIT

# --- 保持期間の適用 -----------------------------------------------------------
deleted="$(find "$BACKUP_DIR" -maxdepth 1 -name 'codip-*.dump.gpg' -type f \
  -mtime "+${RETENTION_DAYS}" -print -delete | wc -l)"
[ "$deleted" -eq 0 ] || log "Retention: removed ${deleted} backup(s) older than ${RETENTION_DAYS} days"

log "Backup complete: $ENCRYPTED_PATH"
