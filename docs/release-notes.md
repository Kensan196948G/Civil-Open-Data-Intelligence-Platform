# リリースノート

## 2026-08-09: 統合リリース候補 (terrain + weather-marine)

- ⛰️ 地形分析 (Civil-Terrain-Slope-Risk-Viewer 統合):
  - GSI DEM 標高タイル (DEM1A/5A/5B/5C/10B) のサーバー側取得・PNG復号
  - Horn法 3x3 傾斜・TPI 地形分類・断面分析・確認支援カード (Unknown is not Safe)
  - `/api/v1/terrain/{elevation,analysis,section,confirm,export}`
  - `/terrain` UI (MapLibre + 共有URL + レポート出力)
- 🌦️ 気象・海象・施工判定 (wmcdss 統合):
  - `ConstructionSite` / `WeatherThreshold` / `WeatherObservation` /
    `MarineObservation` / `DecisionRecord` モデル + マイグレーション
  - AMeDAS / Open-Meteo Marine 取り込みスクリプト + 10分毎ワークフロー
  - fail-closed 判定エンジン (`src/lib/decision/engine.ts`)
  - 50年確率波 (Gumbel/Weibull) / 履歴統計 / ETL状態 / レポート API
  - `/weather`, `/decisions`, `/sites`, `/reports` UI
- 🗄️ 統合元2リポジトリの Git bundle + GitHub メタデータ保全
  (`docs/migration/preservation/`)

## 2026-08-09 (2): 統合ギャップ解消

- 📅 週間予報 `/api/v1/weather/forecast` (Open-Meteo 7日間・参考情報)
- 🗾 全国地図 (現場タブ・Leaflet マーカー選択)
- 🎚️ 閾値管理 UI (一覧/登録/削除)
- 💾 地形案件保存 `TerrainAnalysisRun` + `/api/v1/terrain/runs`
- ▶️ ETL手動実行 `/api/v1/etl/run/{id}` (Node環境) + 取得状況タブ
- 🤖 AI参考解説 `/api/v1/weather/ai-analysis` (ルールベース)
- 🗄️ 本番Neonへのマイグレーション自動適用を weather 取り込みワークフローへ追加

## 2026-08-09 (3): 本番デプロイ完了

- 🚀 Cloudflare Worker `codip-production` へ main `7daf15e` をデプロイ
  (Version `57b17ee1`, gzip 2.96MiB, Hyperdrive 実バインディング)
- 🗄️ 本番 Neon (falling-dawn-93620497) へ weather/marine + terrain_analysis_runs マイグレーション適用
- ✅ Production Smoke: `/api/health` 200 / `/api/ready` 200 (status=ready, db=ok) / DNS・Access 正常

## 2026-08-05 P0 本番デプロイ・実データ収集開始

| 区分 | 内容 |
| --- | --- |
| Production deploy | main `41400dc` 相当を `codip-production` へデプロイ（Version `0eaaaafa-9995-4607-afdb-6e34801f9c9e`、2026-08-05T04:58Z、gzip 2492.69 KiB） |
| Migration | Neon productionへ `providers.ingestionRateLimitMinutes` / `ingestion_runs.schemaFingerprint・schemaChanged・deadLetterReason` を適用 |
| Smoke | デプロイ後 run 30976480258 成功 |
| 実データ収集 | CSV/GeoJSON/JSON・APIキー不要ソース20件へジョブを作成・有効化。初回一括実行で11 success / 7 dead_letter / 2 retrying。デッドレター7件は無効化し、13件の定期収集を継続 |
| DNS修正 | `node:dns/promises` の `lookup` コールバック誤用を修正（#105）。全取得がタイムアウトしていた問題を解消し、JMA JSON 等を実取得 |

## 2026-08-05 P0 quality & spatial expansion（レート制御・スキーマドリフト・デッドレター・空間評価・品質監視）

| 区分 | 内容 |
| --- | --- |
| 収集エンジン | `providers.ingestionRateLimitMinutes` による提供元別レート制御、`ingestion_runs.schemaFingerprint/schemaChanged` によるスキーマドリフト検出、`dead_letter` ステータスと `deadLetterReason` |
| 品質監視 | `scripts/ingestion/quality-monitor.cjs`（data-ingestion.ymlに統合）と `GET /api/admin/ingestion/quality-summary`（デッドレター・スキーマ変化・停滞ジョブ・件数急減/急増） |
| 空間評価 | `POST /api/v1/assessments/geometry`（circle/bbox/polygon・バッファ・キーワード・最近傍）、`/api/v1/layers/{id}/features?q=` 属性絞込 |
| GIS UI | 矩形検索（2点指定）、属性検索結果一覧、時間範囲フィルタ |
| ジョブ展開 | `scripts/ingestion/seed-jobs.cjs` でCSV/GeoJSON/JSON・APIキー不要ソースへ定期収集ジョブを自動作成可能 |

## 2026-08-05 v2 data intelligence 本番デプロイ

| 区分 | 内容 |
| --- | --- |
| Production deploy | main `056b772` を `codip-production` へデプロイ（Version `df4809a3-7f17-4f80-be27-63f1798d0cd7`、2026-08-05T03:58Z、gzip 2386.71 KiB） |
| Migration | Neon productionへ `ingestion_jobs` / `ingestion_runs` / `standard_records.ingestionRunId` を適用（非破壊） |
| Smoke | デプロイ後 run 30973772209 成功（health 200 / ready 200 db=ok）。scheduled run 30972974222 も成功 |

## 2026-08-05 v2 data intelligence（定期収集・地点横断・GIS・AI推薦・リネージュ）

| 区分 | 内容 |
| --- | --- |
| 定期収集 | `ingestion_jobs` / `ingestion_runs` モデル、管理API（一覧/作成/更新/削除/手動実行/履歴）、GitHub Actions `data-ingestion.yml` 30分毎実行 |
| 収集エンジン | ETag/Last-Modified差分、SSRFガード（静的検証＋接続時DNSピン留め）、サイズ/レコード上限、指数バックオフリトライ、CSV/GeoJSON/JSON解析、標準レコードupsert |
| クレンジング | 日付/数値/座標（Web Mercator簡易変換）正規化、dedupe key、欠損・上限チェック |
| 地点横断 | `GET /api/v1/assessments/point` でカテゴリ・レイヤー別件数と最短距離を返す |
| リネージュ | `GET /api/v1/sources/{id}/lineage` で出典→ジョブ→実行→標準レコードを追跡 |
| AIコンシェルジュ | `GET /api/v1/recommendations` ルールベース推薦（キーワード・品質・利用シーン・根拠・地図URL） |
| GISビューア | レイヤー一覧・重ね合わせ・凡例・透明度・GeoJSON/CSV出力・距離/面積計測 |
| Secret | `CODIP_INGESTION_DATABASE_URL` をGitHub Actions Secretへ登録 |

## 2026-08-05 production monitoring established（Access service token・smoke green・運用台帳）

| 区分 | 内容 |
| --- | --- |
| Production monitoring | Access service token `codip-production-smoke-20260805` を発行し、Service Auth policy `odip-service-auth`（decision `non_identity`）を設定。`CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` をGitHub Actions Secretsへ登録 |
| Smoke | Production Smoke run 30969524446 成功（2026-08-05T02:30Z、`/api/health` 200 / `/api/ready` 200 `status=ready` `db=ok`）。以降15分間隔scheduled runがstrict判定 |
| Production deploy | main `579d9ea` を `codip-production` へデプロイ（Version `71fdfb11-d97c-4278-bad1-632b8630d06b`、2026-08-05T02:54Z、gzip 2351.63 KiB）。デプロイ後smoke run 30970704615 で `/api/health` 200（576ms）・`/api/ready` 200（336ms、db=ok）を確認 |
| Backup | Neon pg_dump初回成功（2026-08-04T21:05Z workflow_dispatch run 30950851419、AES256暗号化artifact `codip-neon-pgdump-20260804T210642Z.dump.gpg`、証跡JSON `neon-backup-evidence`）。scheduled初回は2026-08-06 03:17 JSTに確認予定 |
| Ops | 運用台帳 `docs/operations/operations-ledger.md`（日次・週次・月次・四半期点検、SLO、Secret棚卸し）、インシデント対応Runbook `docs/runbooks/incident-response.md` を追加 |
| Cleanup | Access検証用の一時service token 3件を削除し、本番tokenのみ残置 |
| 残課題 | Cloudflare/Neonアラート通知先・通知テスト、GitHub Actions失敗通知先、証明書/APIキー有効期限棚卸し（運用台帳に記録） |

## 2026-08-04 production readiness（Access対応・依存更新）

| 区分 | 内容 |
| --- | --- |
| 本番状態 | `codip-production` はmain `5f76656` 相当で稼働中。Cloudflare Access app `odip` が未認証アクセスを302でloginへ誘導 |
| Monitoring | `release:post-release-status` にAccess service token対応を追加。`production-smoke.yml` は `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` をprobeへ付与可能に。未設定時は302を「Cloudflare Access boundary」診断として報告し、アプリ障害と誤判定しない |
| Security | `/settings` は未認証時に管理用設定・APIキーUIを描画せず、管理セッション開始の案内のみ表示（認証後のみDB読取） |
| Dependencies | `undici` 8.10.0 / `postcss` 8.5.25 / `wrangler` 4.118.0、`brace-expansion` 1.1.18 / 2.1.4 / 5.0.9 override。`npm audit` 全グラフ0件・本番依存0件 |
| Neon backup | `neon-backup.yml` がPGDGの `postgresql-client-17` を導入し、Neon PostgreSQL 17 とのpg_dumpバージョン不一致を解消。GitHub Actions Secrets/Variablesを設定し、restore drill `restore-drill-20260804` を実施 |
| Docs | README、docs/13、docs/16、monitoring / production runbookを実状態（Access・稼働deployment・監視方式）へ更新 |
| 残課題 | Access service token作成とGitHub Actions Secret登録、通知テスト (Issue #90) は人間承認・設定待ち。Neon backupはSecrets/restore drill設定済みで、main merge後のscheduled初回成功を確認予定 (Issue #63) |

## 2026-08-01 post-release stabilization (未デプロイ)

| 区分 | 内容 |
| --- | --- |
| Production incident | `https://odip.mirai-dx-platform.com/api/health` は200だが `/api/ready` は503、主要DB画面/APIは500。稼働Workerがnative Prisma engineを探索して初期化失敗 |
| Root cause | 稼働deploymentは2026-07-27 10:51 UTC。Workers wasm修正 `83b1b91` は同日12:23 UTCで、現行deploymentに未反映 |
| Application fix | Hyperdrive-only WorkersをPostgreSQL runtimeとして扱い、`standard_records` 経路がcatalog fallbackへ誤縮退する回帰を修正。明示DB URLがあるNode実行ではURL側providerを優先。回帰テスト追加 |
| CI / monitoring | 通常PR verifyでCloudflare artifactをbuild/検査。15分間隔のstrict read-only production smoke workflowを追加 |
| Cloudflare bundle blocker | OpenNext成果物へPostgreSQL用とSQLite用のPrisma WASM engineが同時混入し、Wrangler dry-runのgzipが `3235.38 KiB` となってWorkers Freeの3 MB上限を超過。再デプロイを停止 |
| Bundle fix / regression guard | Cloudflare build時だけ`@prisma/client`をPostgreSQL WASMへ解決し、通常Node/SQLite buildは維持。修正後dry-runはgzip `2350.09 KiB`。artifact checkerはPostgreSQL WASMを必須とし、未使用のSQLite WASM再混入を拒否 |
| Neon | mainへread-only接続成功。migration 2/2、重複official URL・外部キー孤児・不正geometryはいずれも0。DB rollback不要 |
| Backup blocker | scheduled backup 12/12失敗、artifact 0。証跡branchを`main`へ固定し、Secret URLのhostnameと`CODIP_NEON_PGDUMP_HOST`をdump前に照合するfail-closed gateを追加。Secret/Variable登録とrestore drillは人間承認境界 (Issue #63) |
| Deploy status | 本変更はローカルbranchのみ。通常CI、CodeQL、Cloudflare build/artifact検査、3 MB未満のWrangler dry-runを同一immutable SHAで確認後、承認済みCI/CD経路からのみ再デプロイする。DNS、Secrets、Access、DB変更は未実施 |

## 2026-07-27 production subdomain change (civilopendata → odip)

| 区分 | 内容 |
| --- | --- |
| Cloudflare | ユーザー指示により本番サブドメインを `civilopendata` から `odip` へ変更。FQDNは `odip.mirai-dx-platform.com`。zone route方式 (route pattern + proxied AAAA `100::`)、Worker名 `codip`、Hyperdrive、Neon構成は変更なし |
| Cloudflare | `wrangler.jsonc` production routes、deploy pipeline、placeholder/evidence/契約チェック、runbook、README、テストのproduction FQDN参照を `odip.mirai-dx-platform.com` へ更新 |
| Access boundary | アクセス制御 (Cloudflare Access application / policy) はユーザー側で設定する運用へ変更。設定完了までは管理系導線のfail-closed全拒否を維持 |
| DNS削除 | 旧 `civilopendata` のproxied AAAAレコード (`100::`) は2026-08-01にユーザー操作で削除済み (`dig` NXDOMAIN確認)。`odip` 側レコードは残置 |
| Security deps | 2026-07-21/22公開のadvisory群に対応: `next` 15.5.22 (GHSA-q8wf-6r8g-63ch / GHSA-955p-x3mx-jcvp は15.5.21修正済み)、`sharp` 0.35.3 (`overrides` でnextネスト依存も強制、libvips CVE-2026-33327/33328/35590/35591)、`@opennextjs/cloudflare` 1.20.2、`wrangler` 4.114.0 / `miniflare` 4.20260722.0。本番依存 (`npm audit --omit=dev`) は0件 |
| CI audit gate | `Dependency audit` を「本番依存 (--omit=dev) ゼロ許容ブロッキング + 全依存はallowlistゲート (`scripts/tools/check-dependency-audit.js`)」へ再構成。allowlistは理由・追跡Issue・担当・期限つきで、allowlist外の新規moderate+検出、期限切れエントリ、監査実行エラーはすべてCI失敗。現在の許容は `GHSA-mh99-v99m-4gvg` (brace-expansion OOM-DoS、devチェーンのみ、期限2026-09-30、Issue #82) の1件 |

## 2026-07-19 post-release preview hardening

| 区分 | 内容 |
| --- | --- |
| 稼働確認 | `http://192.168.0.185:3100/` のダッシュボード表示、主要read-only API、管理系negative応答を確認。`release-smoke --read-only` は63 checks OK |
| Security | `CODIP_DISABLE_TOKEN_AUTH` を追加し、Cloudflare Access等のproxy auth配下で直接token経路を閉じられるようにした |
| Workers互換 | `assertSafeUrl()` のDNS事前検証を `resolve4` / `resolve6` へ変更。接続時DNSピン留めを保証できないCloudflare Workers runtimeでは外部URL取得を `unsupported_runtime` で安全停止 |
| Data | `standardRecordsAvailable()` を60秒TTL + single-flight化し、運用ロールバックと並行アクセス時の不整合を抑制 |
| Audit | データソース登録・更新・削除、タグ追加・削除、接続確認、サンプル取得、品質再計算は主操作と `audit_logs` 記録を同一transaction化。クライアント起点監査イベントは記録失敗時に503を返す |
| Audit contract | ADR 0002として監査ログ記録保証を文書化し、短時間mutationは同一transaction、クライアント起点イベントは同期POST + 503、長時間/非同期処理は将来outbox移行という判断を固定。`release:check-audit-contract` を追加 |
| Production evidence | `npm run release:production-evidence -- --strict` を追加。Cloudflare/Neon実ターゲット、Wrangler本番構成、監視・アラート、バックアップ・リストアのEvidence入力をSecret値なしMarkdownで出力し、未充足時は失敗する |
| Access evidence | `CODIP_CLOUDFLARE_ACCESS_EVIDENCE` をproduction evidence必須項目に追加し、Cloudflare Access application/policy/allowlist/proxy secret設定済み証跡なしではstrict gateを通さない |
| GitHub Actions production evidence | `production-target-env` 手動jobに `CODIP_CLOUDFLARE_ACCESS_EVIDENCE` を渡し、Access証跡を実Cloudflare/Neon target検証で欠落させないようにした |
| Cloudflare deploy gate | `npm run release:check-production-placeholders -- --env production` を追加。production Hyperdrive ID等の未解決placeholderが残る状態で本番検証を進めない |
| Cloudflare artifact gate | `npm run release:check-cloudflare-build-artifact` を追加。`cf:build` 後にOpenNextのWorker entrypointと静的assetsが存在することをdeploy前に確認する |
| Cloudflare production deploy | `npm run cf:deploy:production` を追加し、production deploy時に実target env検証、production evidence strict、placeholder検査、Cloudflare build、artifact検査、OpenNext deploy `--env production` を固定順序で実行する |
| Read-only smoke | `release:smoke --read-only` に v1 records/layers のinvalid queryと存在しないlayer/sourceの404確認を追加し、staging/productionでもDB非破壊で異常系を検証できるようにした |
| Windows scripts | `DATABASE_URL=...` 形式のnpm scriptsをWindows互換ラッパーへ変更。`npm run build` がWindows/UNC環境でも実行可能になった |
| Docs | README、運用設計、監視runbook、Cloudflare/Neon runbook、リリースノートを更新 |
| CI/契約 | Windows/UNCでOpenAPI route coverageが全APIをmissing扱いするパス正規化不具合を修正 |
| CI/De-dockerization | GitHub Actionsに `node-preview` jobを追加。Dockerを使わずSQLite preview DBをmigrate/seedし、`next start` + `release:smoke` で直接起動経路を検証する。Docker job削除前のbranch protection差し替え候補 |
| Cloudflare | production FQDNを `odip.mirai-dx-platform.com` に固定し、Workers Custom Domain、Access Terraform例、Cloudflare/Neon Runbook、契約チェックへ反映 |
| Cloudflare | `docs/runbooks/cloudflare-production.md` を追加し、DNS/Access/Secrets/Hyperdrive/production evidenceの停止条件を本番専用Runbookとして分離 |
| Cloudflare | 新規サブドメイン `civilopendata` の初回Custom Domain gateを追加。DNS未解決、hostname衝突、zone active、Access境界、証明書/validation証跡を確認するまでDNS変更・deployを停止する |
| Cloudflare | `wrangler.jsonc` のproduction varsに `CODIP_DISABLE_TOKEN_AUTH=true` を固定し、Cloudflare Access/proxy auth配下で直接token経路を閉じる設定を契約チェック対象に追加 |
| Cloudflare monitoring | `npm run release:post-release-status` を追加。`odip.mirai-dx-platform.com` のDNS/health、応答時間、`/api/ready` DB状態、共有previewを読み取り専用で証跡化し、`--strict-production` では本番未接続やslow responseを失敗扱いにする |
| Cloudflare 522 diagnosis | `release:post-release-status` に `Production Route Diagnosis` を追加。Cloudflare edge header付き522を、Worker route/deploy/logs確認へ誘導する |
| Cloudflare 522 evidence | `release:cloudflare-522-diagnostics` を追加。既定はCloudflareへ接続せず、`wrangler.jsonc` のproduction route/Hyperdrive/observability契約と、承認済み認証で実行する `deployments status/list`・tail・Dashboard証跡をMarkdown化する |
| Neon backup evidence | `npm run release:create-neon-backup-evidence` を追加。`pg_dump` artifact metadataまたはartifact IDから非Secret証跡JSONを生成し、既存の鮮度ゲートへ渡せるようにした |
| Neon backup evidence | `npm run release:check-neon-backup-evidence` を追加。Secretを含まない `CODIP_NEON_BACKUP_EVIDENCE_JSON` からPITR window、pg_dump 24h鮮度、restore drill 30日鮮度を検査する |
| Neon scheduled backup | `.github/workflows/neon-backup.yml` を追加。毎日03:17 JSTにNeon `pg_dump` を暗号化artifact化して非Secret証跡JSONを生成し、Secret未設定・restore drill未記録・鮮度NGではfail-closedにする |
| CI証跡 | PR #49 のCloudflare target反映commit `040c7bc` に対して CI #82 / CodeQL #64 が success。verify、e2e、postgresql-compat、docker-preview、docker-image-security が全てsuccess |
| Dependency maintenance | PR #52で `undici` 8.7.0、`@eslint/eslintrc` 3.3.6、`@types/node` 22.20.1、`autoprefixer` 10.5.4、`eslint` 9.39.5、`tailwindcss` 3.4.19、`tsx` 4.23.1、`vitest` 3.2.7、`wrangler` 4.112.0へ更新 |
| CI証跡 | dependency更新後のmain commit `1d66e48` に対して CI `29693346265` / CodeQL `29693346235` が success。verify、e2e、postgresql-compat、docker-preview、docker-image-security、docker-supply-chain が全てsuccess |
| Cloudflare deployment | routingを zone route方式 (`pattern` + `zone_name` + proxied AAAA `100::`) へ変更 (決定記録: `docs/runbooks/cloudflare-production.md` §1.1)。Hyperdrive `codip-production` (caching disabled) を `scripts/deploy/create-hyperdrive.mjs` で作成し実IDを `wrangler.jsonc` へ反映。secrets-safeな本番デプロイパイプライン `scripts/deploy/deploy-production.mjs` を追加 |

### 確認URL

| URL | 結果 |
| --- | --- |
| `/` | 200。ダッシュボード表示成功 |
| `/api/health` | 200 |
| `/api/ready` | 200 |
| `/api/dashboard` | 200 |
| `/api/sources` | 200 |
| `/api/openapi` | 200 |
| `/api/fetch-logs` | 401。未認証で保護 |
| `/api/admin/audit-events` | 405。GET不可 |
| `https://odip.mirai-dx-platform.com` | `release:post-release-status` の対象。DNSはCloudflareへ解決済みだが、2026-07-20時点で `/api/health` / `/api/ready` は522。Worker route/deployment/logs、Secrets、Access、Hyperdrive実行時接続の証跡確認が完了するまで本番正常稼働とは判定しない |

### 残課題

| 優先度 | 項目 | 方針 |
| --- | --- | --- |
| P1 | Issue #18 の残り: 実Hyperdrive/Neon証跡、外部URL取得の専用egress設計 | Prisma Hyperdrive driver adapter側は `@prisma/adapter-pg` で実装済み。Cloudflare Workersでは接続時DNSピン留め不可のため外部URL取得を安全停止 |
| P1 | Cloudflare本番522継続 | Worker route/deployment/logs、DNS proxied `AAAA 100::`、Secrets、Access、Hyperdrive実行時接続を承認済みCloudflare認証で確認し、復旧またはrollback判断をIssue #18へ証跡化 |
| P2 | Issue #46 監査記録の原子性 | 主要な台帳・タグ・接続確認・サンプル取得・品質再計算は同一transaction化済み。クライアント起点イベントは記録失敗を503化済み。残りは将来の長時間外部処理増加時にoutbox方式を採用するかの設計判断 |
| P2 | 本番Evidence自動取得 | `production-evidence` はSecret非表示の入力状態と手動貼付欄まで。Cloudflare/Neon APIからの実ログ自動収集は認証・権限確認後に追加 |
| P2 | Issue #63 Neon pg_dump定期ジョブ登録 | GitHub Actions定期jobは追加済み。`CODIP_NEON_PGDUMP_DATABASE_URL` / `CODIP_NEON_BACKUP_ENCRYPTION_PASSPHRASE` Secret登録、restore drill日時、初回成功artifactの証跡化が残る |
| P2 | De-dockerization #35 | `node-preview` 代替CIゲートを追加済み。green実績確認後、branch protectionを `docker-preview` から `node-preview` へ差し替え、Docker job/docsを段階撤去 |
