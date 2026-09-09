#!/usr/bin/env bash
#
# systemd ユニットの失敗を機械可読なマーカーとして残す (Issue #223)。
#
# systemd の `OnFailure=` から呼ばれる。失敗した側のユニット名を第1引数で受け取る。
#
#   [Unit]
#   OnFailure=codip-unit-failed@%n.service
#
#   # codip-unit-failed@.service
#   [Service]
#   Type=oneshot
#   ExecStart=<repo>/scripts/ops/record-unit-failure.sh %i
#
# ■ なぜマーカーを残すのか
#
# `systemctl list-units --state=failed` の failed 状態は**次の成功で消える**。
# oneshot が「失敗 → 次回成功」を繰り返していると、状態だけを見ている監視には
# 常に正常に見える。発生そのものを残さないと取りこぼす。
#
# ■ なぜ外部通知しないのか
#
# 通知先 (メール / Webhook / Slack) の追加は宛先の選択を伴う人間の判断であり、
# CLAUDE.md §5 の承認事項。ここではローカルに痕跡を残すだけにし、拾い上げは
# scripts/ops/check-local-ops-health.sh が担う。外部通知は別途。
#
set -euo pipefail
umask 077

MARKER_DIR="${CODIP_UNIT_FAILURE_DIR:-$HOME/.local/state/codip/failed-units}"
unit="${1:-unknown.service}"

# ユニット名をファイル名に使うため、パス区切りになりうる文字を落とす。
safe_unit="$(printf '%s' "$unit" | tr -c 'A-Za-z0-9._@-' '_')"

mkdir -p "$MARKER_DIR"
{
  echo "unit=$unit"
  echo "failedAt=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "result=$(systemctl --user show "$unit" -p Result --value 2>/dev/null || echo unknown)"
  echo "exitStatus=$(systemctl --user show "$unit" -p ExecMainStatus --value 2>/dev/null || echo unknown)"
} > "$MARKER_DIR/$safe_unit"

# journal にも残す。マーカーを消したあとでも経緯を追えるようにする。
echo "[unit-failure] $unit failed; marker written to $MARKER_DIR/$safe_unit" >&2
