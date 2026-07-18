# 📡 監視手順書 (LAN / systemd 配信)

現行の配信形態 (systemd user unit による LAN 配信、Docker 不使用) に対する監視・確認手順。
Cloudflare Workers 本番化後は Workers Observability (`observability.enabled=true` 設定済み) を正とし、本書へ追記する。

## 1. 監視対象と手段

| 対象 | 手段 | 間隔 |
| --- | --- | --- |
| WebUI プロセス | systemd `codip-webui.service` (`Restart=on-failure`) | 常時 (クラッシュ時自動再起動) |
| HTTP 健全性 | systemd timer `codip-healthcheck.timer` → `/api/ready` を確認し、200 以外なら `codip-webui` を再起動 + journal へ警告 | 5 分 |
| DB 到達性 | `/api/ready` が内部で DB へ `SELECT 1` (失敗時 503) | 上に含まれる |
| アプリログ | journald (`journalctl --user -u codip-webui`) | 随時 |

## 2. 日常確認コマンド

```bash
# サービス状態
systemctl --user status codip-webui.service --no-pager

# ヘルスチェックの実行履歴 (ok / restarting の別)
journalctl --user -u codip-healthcheck.service --since today --no-pager | tail -20

# アプリのエラーログ (直近1時間)
journalctl --user -u codip-webui.service --since "1 hour ago" -p err --no-pager

# 次回ヘルスチェック予定
systemctl --user list-timers codip-healthcheck.timer --no-pager

# 手動スモーク (read-only。書き込み検証は使い捨て DB 以外で行わない)
CODIP_ADMIN_TOKEN=$(grep CODIP_ADMIN_TOKEN ~/.config/codip/codip-webui.env | cut -d= -f2) \
  npm run release:smoke -- --read-only --base-url http://127.0.0.1:3100
```

## 3. アラート条件と初動

| 事象 | 検知 | 初動 |
| --- | --- | --- |
| `/api/ready` 非 200 | healthcheck が journal へ `restarting codip-webui` を記録 | 自動再起動される。頻発する場合は §4 |
| 再起動ループ | `systemctl --user status` の restart カウント増加 | `journalctl --user -u codip-webui -n 100` で起動時エラーを確認 (env 不備 / DB 破損 / ポート競合) |
| DB エラー | ready 503 + journal の Prisma エラー | SQLite: `docs/runbooks/rollback.md` §6 で復旧。PostgreSQL: 接続先を確認 |
| ディスク逼迫 | `df -h` / journal 警告 | `npm run db:prune -- --dry-run` で保持期限超過ログの削除候補を確認 |

## 4. 障害時のエスカレーション

1. `docs/13-deployment-and-operations.md` §4 (障害対応の初動) を参照
2. リリース起因が疑われる場合は `docs/runbooks/rollback.md` §1 の判断フローへ
3. 復旧後は read-only スモーク (上記) で確認し、`docs/16` の証跡欄へ記録

## 5. unit 定義の正本

systemd unit はホスト側 (`~/.config/systemd/user/`) にあり Git 管理外。内容の正本は本書とする。

- `codip-webui.service`: `WorkingDirectory=<repo>` / `EnvironmentFile=%h/.config/codip/codip-webui.env` (600) / `ExecStart=<node> node_modules/next/dist/bin/next start -H 0.0.0.0 -p 3100` / `Restart=on-failure`
- `codip-healthcheck.service` (oneshot): `/api/ready` が 200 以外なら `systemctl --user restart codip-webui.service`
- `codip-healthcheck.timer`: `OnBootSec=2min` / `OnUnitActiveSec=5min`

再作成する場合は上記どおりに配置し `systemctl --user daemon-reload && systemctl --user enable --now <unit>` を実行する。
