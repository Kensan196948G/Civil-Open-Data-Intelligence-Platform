#!/usr/bin/env bash
#
# ローカル本番 (codip-production.service) へのリリース (Issue #231)。
#
# ■ なぜ必要か
#
# 本番は以前、開発の作業ディレクトリから直接 `next start` していた。
#   WorkingDirectory=<開発リポジトリ>
#   ExecStart=... next start -H 0.0.0.0 -p 18810
#
# `next start` は起動時のビルドを前提に HTML を組み立てるため、稼働中に `.next` が
# 作り直されると、配信中の HTML が参照する chunk がディスクから消える。2026-09-09 に
# 実際これが起き、HTML が参照する JS が 400 を返す状態になった (Issue #231)。
# `npm ci` が node_modules を作り直す、`git checkout` がソースを入れ替える、といった
# 通常の開発操作がすべて本番へ直撃していた。
#
# ■ 方式
#
# リリースごとに独立したディレクトリを作り、`current` シンボリックリンクを
# 原子的に張り替える。
#
#   ~/deploy/codip/releases/<short-sha>/   … clone + npm ci + build 済みの完全な木
#   ~/deploy/codip/current -> releases/<short-sha>
#
# 開発ディレクトリで何をしても本番へ影響しない。ロールバックはリンクの張り替えと
# 再起動だけで済み、再ビルドを要しない。
#
# ■ 使い方
#   scripts/deploy/deploy-local-production.sh            # origin/main を配備
#   scripts/deploy/deploy-local-production.sh <commit>   # 指定 commit を配備
#   scripts/deploy/deploy-local-production.sh --build [ref]  # 作るだけ (切替なし)
#   scripts/deploy/deploy-local-production.sh --rollback # 直前のリリースへ戻す
#   scripts/deploy/deploy-local-production.sh --status   # 現在の配備状況
#
set -euo pipefail

DEPLOY_ROOT="${CODIP_DEPLOY_ROOT:-$HOME/deploy/codip}"
RELEASES_DIR="$DEPLOY_ROOT/releases"
CURRENT_LINK="$DEPLOY_ROOT/current"
PREVIOUS_LINK="$DEPLOY_ROOT/previous"
SERVICE="${CODIP_PRODUCTION_SERVICE:-codip-production.service}"
HEALTH_URL="${CODIP_HEALTH_URL:-http://127.0.0.1:18810/api/ready}"
RELEASE_ENV_FILE="${CODIP_RELEASE_ENV_FILE:-$HOME/.config/codip/release.env}"
KEEP_RELEASES="${CODIP_KEEP_RELEASES:-3}"
SOURCE_REPO="${CODIP_SOURCE_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

log() { echo "[deploy] $*"; }
fail() { echo "[deploy][error] $*" >&2; exit 1; }

resolve_link() { readlink -f "$1" 2>/dev/null || true; }

show_status() {
  log "deploy root : $DEPLOY_ROOT"
  log "current     : $(resolve_link "$CURRENT_LINK" || echo '(未設定)')"
  log "previous    : $(resolve_link "$PREVIOUS_LINK" || echo '(なし)')"
  log "service     : $(systemctl --user is-active "$SERVICE" 2>/dev/null || echo unknown)"
  if command -v curl >/dev/null 2>&1; then
    log "health      : $(curl -s --max-time 10 "${HEALTH_URL%/api/ready}/api/health" 2>/dev/null || echo '(取得失敗)')"
  fi
  log "releases    :"
  # 新しい順に見たいので ls -1t を使う (find は mtime 順を直接出せない)。
  # リリース名は short-sha なので非英数字は混じらない。
  # shellcheck disable=SC2012
  ls -1t "$RELEASES_DIR" 2>/dev/null | sed 's/^/              /' || echo "              (なし)"
}

# 起動後にヘルスチェックが通るまで待つ。通らなければ非ゼロ。
HEALTH_ATTEMPTS="${CODIP_HEALTH_ATTEMPTS:-20}"
wait_healthy() {
  for _ in $(seq 1 "$HEALTH_ATTEMPTS"); do
    if curl -sf --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}

switch_to() {
  local target="$1"
  [ -d "$target" ] || fail "リリースが存在しません: $target"

  local before
  before="$(resolve_link "$CURRENT_LINK")"

  # ln -sfn + mv -T で原子的に張り替える (一瞬でも current が消えないようにする)。
  ln -sfn "$target" "$CURRENT_LINK.tmp"
  mv -T "$CURRENT_LINK.tmp" "$CURRENT_LINK"

  if [ -n "$before" ] && [ "$before" != "$target" ]; then
    ln -sfn "$before" "$PREVIOUS_LINK.tmp"
    mv -T "$PREVIOUS_LINK.tmp" "$PREVIOUS_LINK"
  fi

  # release 識別子を systemd の EnvironmentFile へ書く (/api/health が申告する)。
  mkdir -p "$(dirname "$RELEASE_ENV_FILE")"
  umask 077
  {
    echo "CODIP_RELEASE_SHA=$(basename "$target")"
    echo "CODIP_RELEASE_DEPLOYED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } > "$RELEASE_ENV_FILE"

  log "restarting $SERVICE ..."
  systemctl --user restart "$SERVICE"

  if ! wait_healthy; then
    return 1
  fi
  return 0
}

rollback() {
  local prev
  prev="$(resolve_link "$PREVIOUS_LINK")"
  [ -n "$prev" ] || fail "previous が無いためロールバックできません"
  log "rolling back to $prev"
  switch_to "$prev" || fail "ロールバック後もヘルスチェックが通りません。手動確認が必要です"
  log "rollback 完了: $(resolve_link "$CURRENT_LINK")"
}

# リリースディレクトリを作るだけ。current は切り替えない。
# 初回導入時のように「先に成果物を用意してから systemd を張り替えたい」場面で使う。
build_release() {
  local ref="${1:-origin/main}"
  command -v git >/dev/null 2>&1 || fail "git が必要です"
  command -v npm >/dev/null 2>&1 || fail "npm が必要です"

  log "source repo: $SOURCE_REPO"
  git -C "$SOURCE_REPO" fetch --quiet origin || fail "origin の fetch に失敗しました"

  local sha short target
  sha="$(git -C "$SOURCE_REPO" rev-parse "$ref")" || fail "commit を解決できません: $ref"
  short="$(git -C "$SOURCE_REPO" rev-parse --short "$sha")"
  target="$RELEASES_DIR/$short"

  if [ -d "$target" ]; then
    log "既存リリースを再利用します: $target"
  else
    log "リリースを作成します: $target ($sha)"
    mkdir -p "$RELEASES_DIR"
    # 作りかけを current にしないよう、一時ディレクトリで完成させてから移す。
    local staging="$RELEASES_DIR/.staging-$short.$$"
    rm -rf "$staging"
    git clone --quiet --no-checkout "$SOURCE_REPO" "$staging" || fail "clone に失敗しました"
    git -C "$staging" checkout --quiet "$sha" || fail "checkout に失敗しました"

    log "npm ci ..."
    (cd "$staging" && npm ci --no-audit --no-fund >/dev/null) || fail "npm ci に失敗しました"
    log "npm run build ..."
    (cd "$staging" && npm run build >/dev/null) || fail "build に失敗しました"

    mv -T "$staging" "$target"
  fi

  BUILT_RELEASE="$target"
}

deploy() {
  build_release "${1:-origin/main}"
  local target="$BUILT_RELEASE"

  local before
  before="$(resolve_link "$CURRENT_LINK")"

  if switch_to "$target"; then
    log "デプロイ成功: $short"
  else
    log "ヘルスチェックが通りませんでした。切り戻します。"
    if [ -n "$before" ]; then
      switch_to "$before" || fail "切り戻し後もヘルスチェックが通りません。手動確認が必要です"
      fail "デプロイ失敗のため $before へ切り戻しました"
    fi
    fail "デプロイ失敗、かつ切り戻し先がありません"
  fi

  # 古いリリースを整理する (current / previous は必ず残す)。
  local keep_current keep_previous
  keep_current="$(basename "$(resolve_link "$CURRENT_LINK")")"
  keep_previous="$(basename "$(resolve_link "$PREVIOUS_LINK")" 2>/dev/null || echo "")"
  local index=0
  # shellcheck disable=SC2012
  while IFS= read -r entry; do
    if [ -z "$entry" ]; then continue; fi
    if [ "$entry" = "$keep_current" ]; then continue; fi
    if [ -n "$keep_previous" ] && [ "$entry" = "$keep_previous" ]; then continue; fi
    index=$((index + 1))
    if [ "$index" -ge "$KEEP_RELEASES" ]; then
      log "古いリリースを削除: $entry"
      rm -rf "${RELEASES_DIR:?}/${entry:?}"
    fi
  done < <(ls -1t "$RELEASES_DIR" 2>/dev/null)

  show_status
}

case "${1:-}" in
  --status) show_status ;;
  --build) build_release "${2:-origin/main}"; log "ビルド完了 (current は未変更): $BUILT_RELEASE" ;;
  --rollback) rollback ;;
  --help|-h) sed -n '/^# ■ 使い方/,/^set -euo/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' | head -n -1 ;;
  *) deploy "${1:-origin/main}" ;;
esac
