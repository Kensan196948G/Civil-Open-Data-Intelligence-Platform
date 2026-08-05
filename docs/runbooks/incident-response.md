# 🚨 インシデント対応 Runbook

CODIP本番（`odip.mirai-dx-platform.com` / Worker `codip-production` / Neon `falling-dawn-93620497`）で異常を検知した場合の対応フロー。詳細手順は `docs/runbooks/monitoring.md`・`docs/runbooks/rollback.md` を正本とする。

## 1. 重大度定義

| 重大度 | 条件 | 初動目標 | 初動担当 | 復旧目標 |
| --- | --- | ---: | --- | ---: |
| P1 | `/api/ready` 503継続、認証バイパス疑い、データ破損疑い、Cloudflare本番routing障害 | 15分 | ReleaseManager / DevOps | 60分 |
| P2 | 主要API 5xx増加、Workers error増加、Neon接続遅延、read-only smoke失敗 | 30分 | DevOps / QA | 4時間 |
| P3 | console warn、低頻度外部API timeout、監査ログ欠落疑い、性能劣化傾向 | 1営業日 | QA / Developer | 次回改善サイクル |

## 2. 検知経路

- `.github/workflows/production-smoke.yml`（15分毎）の失敗
- `.github/workflows/neon-backup.yml`（毎日03:17 JST）の失敗
- Workers Logs / Traces、Neon Console、ユーザー報告
- 手動 `npm run release:post-release-status -- --strict-production`

## 3. 初動フロー

1. **事象確認**: `release:post-release-status --strict-production` でDNS/health/readyを確認。302はAccess境界（正常）、522はWorker route診断を実施。
2. **切り分け**: Worker / DB / Access / DNS / 依存サービスの順に確認。
   - Worker: `wrangler deployments list --env production`、`wrangler tail codip --env production --status error`
   - DB: Neon Console（branch、容量、接続、slow query）、`/api/ready` の `checks.database`
   - Access: policy / service token / Secrets状態
3. **連絡**: P1は直ちに human kensan へ連絡。P2/P3はGitHub Issue化。通知先・通知テストは未設定のため、検知はGitHub Actionsデフォルト通知に依存（運用台帳で改善予定）。
4. **復旧判断**: `docs/runbooks/rollback.md` §1 の判断フローで「コードのみ / DBのみ / 両方」を決定。
5. **実行**: Workersは `wrangler rollback`、NeonはPITR restore（上書き・人間承認必須）、Docker/GHCRはdigest固定で差し戻し。
6. **検証**: 復旧後は `/api/ready=200`、主要画面/API、管理negative、smoke成功を確認。
7. **記録**: `docs/operations/operations-ledger.md` の実行記録へ追記し、Issueへ証跡を残す。

## 4. メンテナンス方針

- 本番メンテナンスは原則 **03:00〜05:00 JST（日次バックアップ後）** に実施する（要human確認）。
- 破壊的migration・データ訂正・Access変更は、バックアップ取得・rollback手順確認後にhuman承認で実施する。
- メンテナンス前後で `/api/ready` とproduction smokeを必ず確認する。

## 5. データ訂正ポリシー

- 原則 **forward-fix**（SQL/アプリ修正で正しく直す）とする。audit_logsとともにIssue・PRへ証跡を残す。
- 一括UPDATE/DELETEは事前に `pg_dump` またはPITR復元可能時点を確保し、dry-run→実行者・確認者を明記する。
- PITR restoreは最終手段（上書きであり取り消し不可に近い）。`rollback.md` §4に従い、復旧前に必ず現状branchを保存する。
- 個人情報・会社データに関わる訂正はhuman承認必須。

## 6. ポストモーテム

- P1/P2インシデントは、復旧後7日以内に「事象・影響・原因・対応・防止策」をIssueへ記録する。
- 再発防止策は `docs/operations/operations-ledger.md` の定期点検へ組み込み、四半期に振り返る。
