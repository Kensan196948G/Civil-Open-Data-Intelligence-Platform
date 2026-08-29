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

> 📎 **実装が実際に判定している閾値**は
> [`docs/runbooks/incident-response.md`](../runbooks/incident-response.md) §7（SLI/SLO）・§8（RPO/RTO）を
> 正本とする（閾値の出典を実ファイルの行へ紐付けてある）。
> 本節は**運用体制側の管理目標**であり、粒度が異なる。下表で対応関係を明示する。

| 管理目標（本節） | 実装が判定している閾値（正本 §7/§8） | 関係 | 現状 |
| --- | --- | --- | --- |
| 可用性 月間 99.9% | 15分毎 probe の成功／失敗 | 本節は probe 成功率の**月次集計**。実装は個々の probe しか見ない | ⚠️ **集計は未実装**。月次可用性を算出する仕組みが無い |
| `/api/ready` 監視時刻 100% `ready` / `db=ok` | `checks.database=ok` | 同一 | ✅ 実装が判定 |
| 応答時間 P95 5秒以内 | **単一 probe** `responseTimeMs ≤ 5000ms` | 別物。実装は P95 を計算していない | ⚠️ **P95 は未計測**。実効は「1回でも 5000ms 超なら not ready」 |
| 検知〜初動 P1: 15分 | 連続2回以上で P1 昇格＋incident Issue 起票 | 起票までは自動。**初動の開始時刻は記録されない** | ⚠️ 計測不能（下記注記） |
| 復旧 P1: 60分 / P2: 4時間 | RTO: コードのみ 30分 / DB 含む 4時間 | 本節は**インシデント全体**、§8 は**復旧操作単体** | ⚠️ どちらも未実測 |

> ⚠️ **数値が食い違って見える箇所は、粒度が違うだけで矛盾ではない。**
> ただし「月間 99.9%」「P95 5秒」は**集計する仕組みが無いため現在は測れていない**。
> 目標値は維持するが、達成を主張しない。集計を実装した時点で本表の「現状」列を更新する。

> ⚠️ **「検知〜初動」が計測不能である理由（2026-08-11 read-only 検証、Issue #90）**
>
> 従来この計測欄はアラート未設定とだけ記載していたが、実態は「通知先が未設定」ではなく**通知経路そのものが実装されていない**。
>
> 1. ~~`production-smoke.yml` に失敗時の通知step・Issue起票stepが存在しない~~
>    → **是正済み（2026-08-21 時点で実装あり）**。`production-smoke.yml:81-224` が
>    incident Issue を起票する。ただし**外部通知先（メール / Webhook）は依然として未設定**であり、
>    到達範囲は GitHub Issue と Actions の既定通知に限られる。
> 2. ~~「連続2回以上」を評価する自動化が存在しない~~
>    → **是正済み**。`production-smoke.yml:109-136` が GitHub の run 履歴から
>    連続失敗数を算出し、2回以上で P1 へ昇格させる。
> 3. 通知テストの受信記録が存在しない（送信APIの成功のみが記録されている）。
>
> したがって P1: 15分 という目標値は**現時点では達成/未達を判定できない**。目標値そのものは維持し、計測可能になるまで「未達」ではなく「計測不能」として扱う。
>
> - 検証の詳細と権限不足で確認できなかった項目: `docs/runbooks/monitoring.md` §0.1
> - 必要な実装（backend担当・未実装）: `docs/runbooks/monitoring.md` §1.1.4
> - 通知テストの記録様式と現在の判定: [`docs/runbooks/notification-test-record.md`](../runbooks/notification-test-record.md) §3（3経路すべて `NOT RUN` または `BLOCKED`）

## 2. バックアップ・復旧基準

| 項目 | 値 |
| --- | --- |
| Neon PITR | 24時間（`history_retention_seconds=86400`。2026-08-11 実測。現行Launchプランでは0〜7日で可変であり、24時間は下限固定ではない。詳細と引き上げ判断材料は `docs/runbooks/monitoring.md` §1.2.1） |
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

**実施状況（2026-08-21T16:12Z UTC = 2026-08-22 01:12 JST 時点）**

| 項目 | 最終実施 | 状態 | 次回予定 |
| --- | --- | --- | --- |
| PITR window | 2026-08-11 | 🔴 **期限超過**（11日） | 要実施 |
| pg_dump鮮度 | **2026-08-21Z** | 🔴 **判定 NG**（§5 参照） | 2026-08-29 |
| restore drill 鮮度 | 2026-08-12 | 🟡 基準内。ただし pg_restore 型は未実施 | 2026-09-11 |
| 監査ログ抽出 | 2026-08-12 | 🔴 **期限超過**（10日） | 要実施 |
| 依存監査 | **2026-08-21Z** | ✅ **本番0件へ是正**（§5 参照） | 2026-08-29 |
| Secret/証明書棚卸し | 2026-08-12 | 🔴 **期限超過**（10日）。§4 は10件中6件が「不明」のまま | 要実施 |

> 2026-08-21Z（JST 08-22）のサイクルで実施したのは **依存監査** と **pg_dump鮮度** の2項目のみである。
> 残る4項目は未実施のため「期限超過」と明記する（§6 の更新ルールに従い、
> 実施していない点検を実施済みと記載しない）。

**実行方法・判定基準・担当・証跡**（変更なし）

| 項目 | 実行方法 | 判定基準 | 担当 | 証跡 |
| --- | --- | --- | --- | --- |
| PITR window | Neon API `describe_project` の `history_retention_seconds` を**目視**（`release:check-neon-backup-evidence` は実測せず定数比較のため代替にならない。`monitoring.md` §1.2.1(4)） | `86400` 以上を維持 | CTO代行 | `CODIP_NEON_MONITORING_EVIDENCE` |
| pg_dump鮮度 | `release:check-neon-backup-evidence` | 24h以内・status success | CTO代行 | `CODIP_NEON_BACKUP_EVIDENCE_JSON` |
| restore drill 鮮度 | 同上 | 30日以内 | CTO代行 | 同上 |
| 監査ログ抽出 | `/api/admin/audit-events` | 記録欠落なし | QA | Issue/証跡 |
| 依存監査 | `npm audit` / CI | 本番0件・allowlist一致 | Developer | CI run |
| Secret/証明書棚卸し | 本台帳 §4 | 期限切れなし・担当明確 | DevOps | 本台帳 |

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
| 2026-08-21Z | 週次点検「依存監査」 | 🔴→✅ 是正 | `npm audit --audit-level=moderate --omit=dev` が **exit 1**（GHSA-2v37-7h3g-55p8 / nanoid、GHSA-ggr8-5vv4-36mx / deepmerge-ts。いずれも high）。`verify` と `docker-image-security` が失敗し **2026-08-13 以降 main への統合が停止**していた。override を実アップグレードして解消し `found 0 vulnerabilities` / `[dependency-audit] OK` を実測。PR #171 |
| 2026-08-21Z | 週次点検「pg_dump鮮度」 | ❌ **判定 NG** | `neon-backup.yml` が **2026-08-13 から8回連続 failure**。失敗 step は `Validate backup inputs` で、必須 Secrets/Variables 未登録による fail-closed 停止（設計どおりの挙動）。**欠けていたのは通知経路**であり9日間誰も気づかなかった。失敗時 incident Issue 起票を追加（PR #173）。本体の復旧は Secrets 登録（人間決裁事項・PR #144）待ち |
| 2026-08-21Z | 監視「SLA monitor」の実態確認 | ❌ **一度も成功していない** | `sla-monitor.yml` 直近10回すべて failure。実ログの原因は `POST /repos/{owner}/{repo}/labels` の **HTTP 403 `Resource not accessible by integration`**。job に `issues: write` が無かった。付与して是正（PR #173）。README が謳う日次ダイジェストは**一度も利用者に届いていない**（`data-watch-digest` ラベルの Issue が 0 件） |
| 2026-08-21Z | 復旧手順の実行可能性検証 | ❌ **動作しない手順を検出** | `cloudflare-mvp.md` の公開MVP切り戻し `npx wrangler rollback codip-mvp --env mvp` は、位置引数が **version-id** であるため失敗する（wrangler 4.120.0 の `--help` で実測）。`--name` 形へ修正し `rollback.md` へ codip-mvp の手順を追加（PR #181） |
| 2026-08-21Z | インシデント Runbook の実行可能性検証 | ⚠️ **コードフェンス0** | 障害時に最初に開く `incident-response.md` にコマンドが名前としてしか出ていなかった（0→14フェンス）。Docker/GHCR の誤った復旧経路・陳腐化した通知記述・codip-mvp の不在を是正。SLI/SLO と RPO/RTO を実装から導出して追加（PR #181） |
| 2026-08-21Z | main 統合経路の復旧 | ✅ | 停止は3つの独立した原因の重なりだった。(1) 依存 advisory (2) ruleset の実在しないチェック名 `"verify\n"` (3) commit が GitHub ユーザーに未帰属。いずれも実測で切り分けて解消し、PR 11本が `CLEAN` に到達 |
| 2026-08-11 | 監視・通知実態の read-only 再検証（Issue #90） | ⚠️ 一部BLOCKED | `docs/runbooks/monitoring.md` §0.1。確認できた事実（zone active / DNS解決 / Access境界302 / production smoke直近20件success / Neon PITR 86400秒 / ローカル品質ゲートPASS）と、Cloudflare read権限不足で検証できなかった項目（Access設定・通知ポリシー・Workers Observability等）を分離して記録。**AC#7「/api/ready継続失敗がP1として通知される」は不成立**のためIssue #90はクローズせず |
| 2026-08-11 | 通知テスト記録様式の新設 | ✅ | [`docs/runbooks/notification-test-record.md`](../runbooks/notification-test-record.md)。送信API成功ではなく**人間の受信**を合否条件とする様式。現在の台帳は `cloudflare-alert-policy`=`NOT RUN`（受信記録なし）/ `github-actions-failure`=`BLOCKED` / `neon-alert`=`BLOCKED` |
| 2026-08-11 | 監視Runbookの契約テスト追加 | ✅ | `tests/unit/monitoring-runbook-contract.test.ts`。runbookの記述とworkflow・probe scriptの実装が乖離したらCIで落ちる。特に「通知stepは存在しない」という記述は、実装されると同時にテストが失敗して文書更新を強制する |
| 2026-08-11 | Neon PITR retention とゲート閾値の調査（read-only） | ⚠️ 欠陥検出 | `docs/runbooks/monitoring.md` §1.2.1。実測 `history_retention_seconds=86400`、org plan=`launch`（上限7日）。`check-neon-backup-evidence` の `historyWindowHours >= 24` は**Neon APIを読まない定数同士の比較**であり、retentionが実際に短縮されても検知しない（偽陰性）。閾値の引き下げではなく実測値取得が是正策。設定変更・プラン変更はいずれも未実施 |
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
| 2026-08-12 07:15 JST (22:15Z) | Neon PITR復旧訓練 | ✅ | PITR 2026-08-11T20:15:00Z → 一時branch `br-blue-wave-afeh7gyq` 作成。検証: data_sources=62（期待62）・PG 17.10・PostGIS 3.5・migrations 6・tables 23。約14分で完了。endpoint2本・branchを削除済み。記録: `docs/runbooks/restore-drill-record.md#2026-08-12` |
| 2026-08-12 09:52 JST (00:52Z) | GitHub Actions通知受信テスト | 🟡 | `run_notification_test=true` のdispatch専用経路でincident Issue #152（`[TEST]`）の**作成経路**を実測・内容確認・クローズ済み。本番probeは通常どおり成功。**人間のメール受信確認は別途**（当番・通知先設定待ち）。記録: `docs/runbooks/notification-test-record.md#2026-08-12` |
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
