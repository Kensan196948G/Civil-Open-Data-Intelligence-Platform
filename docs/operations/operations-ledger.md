# 📋 運用台帳（Operations Ledger）

CODIP本番（`odip.mirai-dx-platform.com` / Worker `codip-production` / Neon `falling-dawn-93620497`）の継続運用を管理する台帳。監視Runbook（`docs/runbooks/monitoring.md`）、ロールバックRunbook（`docs/runbooks/rollback.md`）、インシデント対応Runbook（`docs/runbooks/incident-response.md`）を正本として参照する。

## 0. 運用体制（2026-08-05時点）

| 役割 | 担当 | 連絡先 |
| --- | --- | --- |
| 本番最終責任者 | human kensan | GitHub / メール（通知経路は未設定） |
| CTO代行（自律運用） | Codex / Claude Code | 本リポジトリ |
| DevOps / 初動対応 | CTO代行 + human kensan | GitHub Actions失敗通知（未設定） |
| エスカレーション | P1→human kensan、P2→DevOps、P3→週次改善Issue | 要設定 |

## 1. SLO・アラート基準（暫定）

| 指標 | 目標 | 計測 |
| --- | --- | --- |
| 可用性 | 月間 99.9% | production-smoke 成功割合（15分毎） |
| `/api/ready` | 監視時刻 100% `status=ready` / `db=ok` | `release:post-release-status --strict-production` |
| 応答時間 | P95 5秒以内 | probe responseTimeMs |
| 検知〜初動 | P1: 15分 / P2: 30分 / P3: 1営業日 | アラート（未設定） |
| 復旧 | P1: 60分 / P2: 4時間 / P3: 次回改善サイクル | rollback / forward-fix |

## 2. バックアップ・復旧基準

| 項目 | 値 |
| --- | --- |
| Neon PITR | 24時間（PITR履歴ウィンドウ。変更は週次確認） |
| 定期pg_dump | 毎日 03:17 JST（`.github/workflows/neon-backup.yml`） |
| 暗号化 | GPG AES256（`CODIP_NEON_BACKUP_ENCRYPTION_PASSPHRASE`） |
| 保持 | 暗号化dump 14日 / 証跡JSON 30日 |
| RPO（目標） | 24時間以内（PITR + 日次dump） |
| RTO（目標） | Worker切戻し 60分以内 / DB復元 4時間以内（要実測） |
| 復元試験 | restore drill 2026-08-04（branch `restore-drill-20260804`、`br-wild-shape-aff21r0u`）実施済み |

## 3. 定期点検表

### 3.1 日次

| 項目 | 実行方法 | 判定基準 | 担当 | 証跡 | 次回予定 |
| --- | --- | --- | --- | --- | --- |
| production smoke | GitHub Actions（15分毎自動） | `/api/health` 200・`/api/ready` 200 | 自動 | Actions run / artifact | 自動 |
| バックアップ成功 | `neon-backup.yml`（03:17 JST） | workflow success・証跡JSON鮮度OK | 自動 | Actions run / artifact | 自動 |
| Workers error / ログ | Workers Logs / Traces | error 0 or 既知 | CTO代行 | `CODIP_CLOUDFLARE_LOGS_EVIDENCE` | 毎日 09:00 JST |

### 3.2 週次

| 項目 | 実行方法 | 判定基準 | 担当 | 証跡 | 次回予定 |
| --- | --- | --- | --- | --- | --- |
| PITR window | Neon API `describe_project` | 24h維持 | CTO代行 | `CODIP_NEON_MONITORING_EVIDENCE` | 2026-08-12 |
| pg_dump鮮度 | `release:check-neon-backup-evidence` | 24h以内・status success | CTO代行 | `CODIP_NEON_BACKUP_EVIDENCE_JSON` | 2026-08-12 |
| restore drill 鮮度 | 同上 | 30日以内 | CTO代行 | 同上 | 2026-08-12 |
| 監査ログ抽出 | `/api/admin/audit-events` | 記録欠落なし | QA | Issue/証跡 | 2026-08-12 |
| 依存監査 | `npm audit` / CI | 本番0件・allowlist一致 | Developer | CI run | 2026-08-12 |
| Secret/証明書棚卸し | 本台帳 §4 | 期限切れなし・担当明確 | DevOps | 本台帳 | 2026-08-12 |

### 3.3 月次

| 項目 | 実行方法 | 判定基準 | 担当 | 証跡 | 次回予定 |
| --- | --- | --- | --- | --- | --- |
| Cloudflare使用量・予算 | Cloudflare Dashboard | 無料枠内 or 通知 | DevOps | スクリーンショット/メモ | 2026-09-05 |
| Neon容量・接続数 | Neon Console | 上限80%未満 | DevOps | `CODIP_NEON_MONITORING_EVIDENCE` | 2026-09-05 |
| バックアップ復元試験 | 安全なbranchへrestore | 復元・検証成功 | DevOps | `CODIP_BACKUP_RESTORE_EVIDENCE` | 2026-09-05 |
| 権限棚卸し | Cloudflare/Neon/GitHub | 不要権限なし | Security | 本台帳/Issue | 2026-09-05 |
| 通知試験 | アラート通知先へテスト | 受信確認 | DevOps | `CODIP_CLOUDFLARE_ALERT_POLICY` | 2026-09-05（初回は2026-08-12） |

### 3.4 四半期

| 項目 | 実行方法 | 判定基準 | 担当 | 証跡 | 次回予定 |
| --- | --- | --- | --- | --- | --- |
| 障害復旧訓練（DR） | stagingまたはsafe branchでPITR+Worker rollback | 手順どおり復旧 | ReleaseManager | Issue / 本台帳 | 2026-11-05 |
| EOL・ライセンス棚卸し | Node/Prisma/Next/依存のEOL確認 | EOL 3ヶ月以内なし | Developer | Issue | 2026-11-05 |
| Runbook更新 | rollback/incident/monitoringレビュー | 実状態一致 | CTO代行 | commit/PR | 2026-11-05 |
| インシデント振り返り | 発生時+四半期 | 改善Issue化 | CTO | Issue | 2026-11-05 |

## 4. 資格情報・有効期限台帳

| 資格情報 | 用途 | 有効期限 | 更新・ローテーション | 担当 |
| --- | --- | --- | --- | --- |
| Cloudflare API token（環境） | Worker/DNS/Access/Deploy | 不明（要確認） | 再発行→環境更新→旧無効化 | human kensan |
| GitHub token（環境） | gh/git操作 | 不明（要確認） | 再発行→環境更新 | human kensan |
| `NEON_API_KEY`（環境） | Neon API | 不明（要確認） | Neon Consoleで再発行 | human kensan |
| `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` | production-smoke | tokenは既定で無期限 | 90日毎ローテーション推奨：新token→Secrets更新→旧token削除 | DevOps |
| `CODIP_NEON_PGDUMP_DATABASE_URL` | 日次pg_dump | 不明（要確認） | Neon password再発行→Secrets更新 | human kensan |
| `CODIP_INGESTION_DATABASE_URL` | 定期収集ジョブ（GitHub Actions） | 不明（要確認） | Neon password再発行→Secrets更新。write権限を持つ専用ロール化を推奨 | human kensan |
| `CODIP_NEON_BACKUP_ENCRYPTION_PASSPHRASE` | dump暗号化 | なし（任意変更） | 変更時は旧dump復号不可に注意 | human kensan |
| 本番DBロール | Neon main接続 | なし | 最小権限維持・棚卸し月次 | DevOps |
| TLS証明書 | Universal SSL | Cloudflare自動更新 | 自動（Dashboardで確認） | Cloudflare |
| ドメイン | mirai-dx-platform.com | 要確認（レジストラ） | 更新はhuman kensan | human kensan |

## 5. 実行記録

| 日時 | 項目 | 結果 | 証跡 |
| --- | --- | --- | --- |
| 2026-08-04 | Neon restore drill | ✅ | `restore-drill-20260804`（`br-wild-shape-aff21r0u`） |
| 2026-08-04T21:05Z | Neon pg_dump初回（workflow_dispatch） | ✅ | run 30950851419、`codip-neon-pgdump-20260804T210642Z.dump.gpg` |
| 2026-08-07 03:44 JST | Neon pg_dump scheduled初回 | ❌ 失敗 | run 31126295159。原因: GitHub hosted runnerが獲得できずjob未実行（アプリ/DB起因ではない）。翌日以降は成功 |
| 2026-08-07 03:31 JST | Neon pg_dump scheduled | ✅ | run 31207338589 |
| 2026-08-08 03:26 JST | Neon pg_dump scheduled | ✅ | run 31271930146 |
| 2026-08-09 16:21 UTC | Production Smoke（直近） | ✅ | run 31322616071。15分毎に継続成功 |
| 2026-08-09 16:18 UTC ほか | Weather-Marine Data Ingestion（直近） | ✅ | run 31323451526 / 31322767842 / 31322036351。10分毎に継続成功 |
| 2026-08-10 | 統合後新画面のE2E回帰テスト追加 | ✅ | `tests/e2e/integrated-screens.spec.ts`（16件・CI検証予定） |
| 2026-08-10 | 総合評価・改善計画・監視アラートRunbook作成 | ✅ | `docs/evaluation/`、`docs/runbooks/alerts-and-notifications.md` |
| 2026-08-10 | 本番デプロイ（main `3ec5e8f`、PR #114） | ✅ | Version `d1528b5d-b5e6-47e9-aa4b-1070868161f6`。デプロイ後Production Smoke run 31325075110 success（/api/health 200 / /api/ready 200 db=ok） |
| 2026-08-10 | /reports未コミット問題の修正 | ✅ | `.gitignore` の `reports/` パターンが `src/app/reports/` と `src/app/api/v1/reports/` を誤除外していたため `/reports/`（ルート限定）へ変更し、2ファイルをコミット |
| 2026-08-10 | Cloudflareアラートポリシー作成＋テスト送信 | ✅ | `CODIP Worker Error Alert`（policy id `2731f30e7ec24927a460ebaf77515ce1`）を `workers_observability_alert` + メール `kensan1969@gmail.com` で作成。APIテスト送信 `success=true`（受信確認はhuman kensan） |
| 2026-08-10 | GitHub Actions production環境の変数・シークレット整備 | ✅ | 環境Variables 19件登録。Secrets: `CODIP_DATABASE_URL` / `CODIP_MIGRATION_DATABASE_URL` / `CODIP_ADMIN_TOKEN` / `CODIP_TRUST_PROXY_SECRET` / `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` を登録（Access service token `codip-production-smoke-20260805` をローテーションして新シークレットを取得。repo＋環境の両方を更新） |
| 2026-08-10 | Neon RTO実測ドリル | ✅ | PITR（15分前）→ branch `br-broad-meadow-af4eugg9` 作成→初回クエリまで **3.1秒**。検証: dataSource 56件・PostGIS 3.5。branch・endpoint削除済み |
| 2026-08-10 | 本番DBに現場・閾値シード投入 | ✅ | constructionSite 6件（TYO-01〜06）・weatherThreshold 11件をidempotent upsert。投入前は両方0件（本番の気象海象・判定・レポートが空の状態を解消） |
| 2026-08-10 | 気象海象データ収集の本番反映 | ✅ | run 31332165845 success後、weatherObservation 6件・marineObservation 5件を確認（10分毎の自動収集が継続） |
| 2026-08-10 | release-smokeのCloudflare Access対応 | ✅ | `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` がある場合に `CF-Access-Client-Id` / `CF-Access-Client-Secret` ヘッダーを付与。ci.yml `production-target-env` へ環境Secretsを配線 |
| 2026-08-10 | production-target-env 実ターゲット検証 | ✅ | workflow_dispatch run 31333706566 success（validate-env → production evidence → placeholders → cf:build → PostGIS DDL → migration drift → Access付きread-only smokeまで完走）。`CODIP_DISABLE_TOKEN_AUTH` のenv配線（PR #118）で解消 |
| 2026-08-10 | 公式JSONコネクタ5種を本番展開 | ✅ | 気象庁地震情報JSON・津波情報JSON・GSI住所検索API・Open-Meteo大気質（参考）・週間予報（参考）をシード（本番62ソース）し、5ジョブを有効化。収集run 31334100744後、5件すべて `lastStatus=success`（有効ジョブ18件中15 success / 1 skipped / 9 dead_letterは既存） |
| 2026-08-10 | Access proxy認証の有効化（ミドルウェア注入） | ✅ | PR #120で `src/middleware.ts` を実装。Accessユーザー識別ヘッダー付きAPIリクエストへ `x-codip-proxy-secret` を注入。ローカル統合検証: ユーザーヘッダーあり→`/api/admin/settings` 200 / なし→401。本番Worker `fc732a4a` へ反映済み |
| 2026-08-10 | Worker切戻しRTO実測ドリル | ✅ | `wrangler rollback --env production` で d1528b5d へ切戻し **4秒** → スモーク成功（run 31341608599）→ 最新版（fc732a4a）へ復旧デプロイ **25秒** → スモーク成功（run 31341677558） |
| 2026-08-10 | PWA実装（manifest + Service Worker） | ✅ | PR #120。`manifest.webmanifest`・`sw.js`・登録コンポーネントを本番へ反映。E2E `pwa.spec.ts` で配信確認 |
| 2026-08-10 | 気象庁防災情報XMLの試行 | ⚠️ エンジン対応のみ | Atom feedパース（441件抽出）は成功したが、座標・住所を含まないため標準レコード登録は全件スキップ。誤解防止のためジョブは無効化し、非空間XMLのマッピング設計を次サイクル課題とする |
| 2026-08-10 | Cloudflare通知テスト再送 | ✅ | `POST /alerting/v3/policies/2731f30e.../test` → `success=true`（受信確認はhuman kensan） |
| 2026-08-05 02:30Z | production smoke初回成功 | ✅ | run 30969524446（health 200 / ready 200 db=ok） |
| 2026-08-05 | Access service token設定 | ✅ | 本台帳 §4、`docs/runbooks/cloudflare-production.md` §1.0.1 |
| 2026-08-05 | 運用台帳・incident runbook新設 | ✅ | 本ファイル、`docs/runbooks/incident-response.md` |
| 2026-08-05T02:54Z | 本番デプロイ（main `579d9ea`） | ✅ | Version `71fdfb11-d97c-4278-bad1-632b8630d06b` |
| 2026-08-05T02:55Z | デプロイ後production smoke | ✅ | run 30970704615（health 200 / ready 200 db=ok） |
| 2026-08-05 | データ収集パイプライン実装 | ✅ | 定期ジョブ/実行履歴/ETag/リトライ/CSV・GeoJSON/リネージュ。`data-ingestion.yml` 30分毎 |
| 2026-08-05 | 地点横断・AI推薦・GIS出力実装 | ✅ | `/api/v1/assessments/point` `/recommendations`、地図レイヤー/計測/出力 |
| 2026-08-05T03:58Z | 本番デプロイ（main `056b772`） | ✅ | Version `df4809a3-7f17-4f80-be27-63f1798d0cd7` |
| 2026-08-05T03:59Z | デプロイ後production smoke | ✅ | run 30973772209（health 200 / ready 200 db=ok） |
| 2026-08-05T03:41Z | scheduled production smoke（初の自動成功） | ✅ | run 30972974222 |
| 2026-08-05 | P0品質・空間拡張実装 | ✅ | レート制御・スキーマドリフト・デッドレター・空間評価API・品質監視 |
| 2026-08-05T04:58Z | 本番デプロイ（main `41400dc` 相当） | ✅ | Version `0eaaaafa-9995-4607-afdb-6e34801f9c9e` |
| 2026-08-05 | 実データ収集開始（20ジョブ） | ✅ | 11 success / 7 dead_letter（無効化）/ 2 retrying。13ジョブ継続 |

## 6. 更新ルール

- 点検実施時は本台帳の「実行記録」へ追記し、次回予定を更新する。
- 自動化可能な項目はGitHub Actions等の定期ジョブを正とし、本台帳にはジョブ設定と次回予定を記録する。
- 実施していない点検を「実施済み」と記載しない。未実施は「未実施（予定）」と明記する。
