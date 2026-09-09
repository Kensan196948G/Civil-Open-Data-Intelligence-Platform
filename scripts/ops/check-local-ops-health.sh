#!/usr/bin/env bash
#
# ローカル運用の健全性チェック (Issue #223)。
#
# ■ なぜ必要か
#
# 本番DBの日次バックアップが 2026-09-01 から 09-08 までの 7 日間停止していたが、
# 誰も気づかなかった (Issue #218)。codip-backup.timer は毎日発火し、毎回
# 203/EXEC で失敗していた。原因は単純で、**ローカル systemd ユニットに失敗時の
# 通知経路が一つも無かった**。失敗は journald に残るだけで、人間が能動的に
# `systemctl --user list-units --state=failed` を叩かない限り可視化されない。
#
# 運用文書は「バックアップ鮮度: 24時間以内の成功、日次確認」と書いていたが、
# それは人間の手順であって機械的なゲートではなかった。結果として
# **文書は ✅ のまま実体は 7 日間停止**という状態が成立した。
#
# ~/backups も systemd の状態もこのホストにしか無いため、GitHub Actions からは
# 検査できない。ローカルで走らせる以外に手段がないことが、この欠陥が生まれた
# 構造的な理由でもある。
#
# ■ 何を見るか
#
#   1. codip 系ユニットの failed 状態
#   2. OnFailure が残した失敗マーカー (直近の失敗を取りこぼさない)
#   3. バックアップの鮮度 (最新 dump.gpg の更新時刻)
#
# 1 と 2 の両方を見るのは、failed 状態が次の成功で消えるため。oneshot が
# 「失敗 → 次回成功」を繰り返していると、状態だけ見ていると常に正常に見える。
#
# ■ 使い方
#   scripts/ops/check-local-ops-health.sh          # 異常があれば非ゼロ終了
#   scripts/ops/check-local-ops-health.sh --quiet  # 異常時のみ出力
#
set -euo pipefail

BACKUP_DIR="${CODIP_BACKUP_DIR:-$HOME/backups/codip}"
MARKER_DIR="${CODIP_UNIT_FAILURE_DIR:-$HOME/.local/state/codip/failed-units}"
MAX_BACKUP_AGE_HOURS="${CODIP_MAX_BACKUP_AGE_HOURS:-26}"
UNIT_PREFIX="${CODIP_UNIT_PREFIX:-codip-}"

QUIET=0
[ "${1:-}" = "--quiet" ] && QUIET=1

problems=0
say() { [ "$QUIET" -eq 1 ] || echo "$*"; }
problem() { echo "[ops-health][NG] $*" >&2; problems=$((problems + 1)); }

# --- 1. failed 状態のユニット -------------------------------------------------
failed_units="$(systemctl --user list-units --state=failed --plain --no-legend 2>/dev/null \
  | awk '{print $1}' | grep "^${UNIT_PREFIX}" || true)"
if [ -n "$failed_units" ]; then
  while IFS= read -r unit; do
    [ -n "$unit" ] || continue
    problem "unit が failed: $unit"
  done <<< "$failed_units"
else
  say "[ops-health][OK] failed 状態の ${UNIT_PREFIX}* ユニットなし"
fi

# --- 2. 失敗マーカー ----------------------------------------------------------
# failed 状態は次の成功で消える。oneshot が「失敗→成功」を繰り返していると
# 状態だけでは常に正常に見えるため、発生を残しておく。
if [ -d "$MARKER_DIR" ]; then
  markers="$(find "$MARKER_DIR" -maxdepth 1 -type f -printf '%f\n' 2>/dev/null || true)"
  if [ -n "$markers" ]; then
    while IFS= read -r marker; do
      [ -n "$marker" ] || continue
      problem "失敗マーカーが残っている: $marker ($(head -n1 "$MARKER_DIR/$marker" 2>/dev/null || echo '内容不明'))"
    done <<< "$markers"
    say "     → 対処後に rm \"$MARKER_DIR/<unit>\" で消す"
  else
    say "[ops-health][OK] 失敗マーカーなし"
  fi
else
  say "[ops-health][--] マーカー保存先が未作成: $MARKER_DIR (OnFailure 未設定の可能性)"
fi

# --- 3. バックアップ鮮度 ------------------------------------------------------
if [ ! -d "$BACKUP_DIR" ]; then
  problem "バックアップ保存先が存在しない: $BACKUP_DIR"
else
  latest="$(find "$BACKUP_DIR" -maxdepth 1 -name 'codip-*.dump.gpg' -type f -printf '%T@ %p\n' 2>/dev/null \
    | sort -rn | head -n1 | cut -d' ' -f2- || true)"
  if [ -z "$latest" ]; then
    problem "バックアップが 1 つも無い: $BACKUP_DIR"
  else
    age_hours=$(( ( $(date +%s) - $(stat -c %Y "$latest") ) / 3600 ))
    if [ "$age_hours" -gt "$MAX_BACKUP_AGE_HOURS" ]; then
      problem "バックアップが古い: $(basename "$latest") (${age_hours}時間前 > 上限 ${MAX_BACKUP_AGE_HOURS}時間)"
    else
      say "[ops-health][OK] バックアップ鮮度 ${age_hours}時間 ($(basename "$latest"))"
    fi
  fi
fi

if [ "$problems" -gt 0 ]; then
  echo "[ops-health] 異常 ${problems} 件" >&2
  exit 1
fi
say "[ops-health] 異常なし"
