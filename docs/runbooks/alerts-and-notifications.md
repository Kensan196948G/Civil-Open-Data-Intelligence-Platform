# 🔔 アラート・通知設定 Runbook

> 🗓️ 最終更新: 2026-08-10 ｜ 状態: **Cloudflare通知ポリシー作成・テスト送信済み（GitHub/Neon通知とTeams連携は設定待ち）** ｜ 正本: 本ファイル＋[運用台帳](../operations/operations-ledger.md)

CODIPの障害検知（Production Smoke 15分毎・Neonバックアップ日次・データ収集10/30分毎）はGitHub Actionsで自動実行されているが、**失敗時に誰へ通知するかは未設定**。本Runbookは、少人数（IT/DX 7名）で確実に気づける通知経路を確立するための手順書である。

---

## 1. 現状（2026-08-10）

| 監視対象 | 頻度 | 検知 | 通知 |
| --- | --- | --- | --- |
| 本番health/ready | 15分 | ✅ Production Smoke（`post-release-status --strict-production`）+ ローカル `codip-healthcheck.timer`（`/api/ready`） | 🟡 GitHub既定通知のみ（専用Webhook未設定） |
| DBバックアップ | 日次 03:17 JST | ✅ ローカル `codip-backup.timer`（`scripts/local-cron/run-backup.sh`） | 🟡 ローカルログのみ（`~/backups/codip/backup.log`） |
| データ収集 | 10/30分 | ✅ ローカル `codip-weather.timer` / `codip-ingestion.timer` | 🟡 ローカルログのみ |
| CI/ビルド | PR/merge毎 | ✅ `ci.yml` | 🟡 GitHub既定通知のみ |
| Workersエラー | 日次確認 | ✅ Workers Logs/Traces（手動） | ✅ Cloudflare policy `CODIP Worker Error Alert`（2026-08-10作成・テスト送信済み） |
| Neon容量・接続 | 月次確認 | ❌ 手動予定 | ❌ 未設定 |

**結論**: Cloudflare側のWorkerエラー通知ポリシーは作成・テスト送信済み。GitHub Actions失敗の専用通知（Teams Webhook等）とNeonアラートは未設定であり、通知先の決定後に §3 を完了する。

### 2026-08-10 実施済み

| 項目 | 結果 |
| --- | --- |
| Cloudflare通知ポリシー | ✅ `CODIP Worker Error Alert`（`workers_observability_alert`、policy id `2731f30e7ec24927a460ebaf77515ce1`、宛先 `kensan1969@gmail.com`）を作成 |
| 通知テスト | ✅ API `POST /alerting/v3/policies/{id}/test` が `success=true` を返却（2026-08-10 再送含む。メール受信確認は human kensan） |
| GitHub Actions環境 | ✅ production environment Variables 19件・Secrets 6件を登録（`release-smoke` はAccess service token対応済み） |
| 未実施 | GitHub Actions失敗のTeams/メール専用通知、Neonアラート、月次通知試験 |

---

## 2. 目標構成

```mermaid
flowchart LR
    A["GitHub Actions 失敗<br>(smoke/backup/ingestion/CI)"] --> B["GitHub Notification<br>(メール + Teams/Slack Webhook)"]
    C["Cloudflare Alert Policies<br>(5xx/エラー率/Worker例外)"] --> D["メール + Webhook"]
    E["Neon Alerts<br>(容量/接続数/ストレージ)"] --> F["メール + Webhook"]
    B --> G["IT/DX 7名 共有チャネル"]
    D --> G
    F --> G
    G --> H["初動担当（当番）"]
```

## 3. 設定手順

### 3.1 GitHub Actions 失敗通知（即時実施・最小構成）

1. 通知先の決定（人間承認）
   - メール: IT/DX部門共有メールボックス（例: `it-dx@mirai-const.co.jp`）
   - チャット: Microsoft Teams チャネルWebhook（Microsoft 365環境に整合）
2. GitHub Repository Settings → Notifications で失敗通知のメール設定を確認
3. 各ワークフロー（`production-smoke.yml` / `ci.yml`）とローカルsystemdタイマー（`codip-ingestion.timer` / `codip-weather.timer` / `codip-backup.timer`）の失敗時に通知する仕組みを追加
   - GitHub Actions側: メール・Teams Webhook（SHA固定Action）
   - ローカル側: ログ監視（`~/backups/codip/backup.log`、`~/logs/codip-ingestion/`）から失敗を検知する監視の追加
4. **通知テスト**: `production-smoke.yml` を `workflow_dispatch` で `run_notification_test=true` にして実行する。本番probeは通常どおり実行され、通知stepだけがテスト専用incident Issue（`[TEST]` 接頭辞・`production-smoke-test` label）を起票する。本番を故意に落とす必要はない。起票後、受信確認してテストIssueをクローズする（`notification-test-record.md` §3）

### 3.2 Cloudflare Alert Policies

1. Cloudflare Dashboard → Notifications → Alert Policies を開く
2. 最低限、以下を作成する:

| Policy名 | 種別 | 閾値 | 通知先 |
| --- | --- | --- | --- |
| CODIP Worker 5xx | HTTP traffic anomaly / 5xx | 連続5件 or 1分で10件 | メール＋Webhook |
| CODIP Worker exception | Workers exception | 1件以上 | メール＋Webhook |
| CODIP Zone down | zone down | 即時 | メール＋Webhook |

3. 通知先へWebhook用の署名シークレットを設定し、Gitへ保存しない
4. **通知テスト**: 通知先へのテスト配信（Dashboardの「Send test notification」）を実施し、受信を記録

### 3.3 Neon Alerts

1. Neon Console → Project → Settings → Notifications を開く
2. 以下を設定:
   - Storage usage 80%
   - Connection limits 80%
   - Compute active hours（コスト監視）
3. 通知先: メール＋Webhook（Cloudflare/Teamsと同一チャネル推奨）

### 3.4 エスカレーション基準（運用台帳 §0 と連携）

| レベル | 検知 | 初動 | 通知 |
| --- | --- | --- | --- |
| P1 | 本番ダウン・DB接続不可・バックアップ2日連続失敗 | 15分以内 | 即時: メール＋Teams |
| P2 | Smoke不安定・データ収集停滞・容量80% | 30分以内 | 即時: メール＋Teams |
| P3 | CI失敗・既知の警告・月次点検項目 | 1営業日 | 日次ダイジェスト |

---

## 4. 月次通知試験（運用台帳 §3.3 と連携）

| 項目 | 方法 | 合格基準 |
| --- | --- | --- |
| メール | テスト配信 | 共有メールボックスで受信確認 |
| Teams Webhook | テスト投稿 | 共有チャネルで受信確認 |
| Cloudflare Policy | Send test notification | 受信確認 |
| Neon Alert | テストアラート | 受信確認 |
| GitHub Actions | `run_notification_test=true` のdispatch専用経路（本番probeを故意に落とす旧方式は廃止済み） | 受信確認 |

実施後は、`CODIP_CLOUDFLARE_ALERT_POLICY` と `CODIP_MONITORING_CONTACTS` の証跡変数を更新し、運用台帳「実行記録」へ追記する。

---

## 5. 未実施のまま運用する場合のリスク（受容条件）

通知未設定のまま運用を継続する場合は、以下を**明示的に受容**する必要がある。

- 🔴 障害検知から人間の認知まで最大で「次の手動確認まで」遅延する
- 🔴 夜間・休日・連休中の長期障害に気づけない
- 🟡 バックアップ失敗（2026-08-06実績）が翌日まで気づかれない可能性

受容しない場合は、§3の手順をP0として実施する。
