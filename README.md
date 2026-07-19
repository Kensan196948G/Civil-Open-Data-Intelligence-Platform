# 🏗️ Civil Open Data Intelligence Platform

## Civil土木建設オープンデータ統合分析基盤 | CODIP

![Status](https://img.shields.io/badge/status-MVP%20release%20hardening-green)
![Stack](https://img.shields.io/badge/stack-Next.js%20%2B%20Prisma-blue)
![GIS](https://img.shields.io/badge/GIS-GeoJSON%20%2F%20PostGIS%20ready-orange)
![Security](https://img.shields.io/badge/security-Access%20%2B%20Token%20Guard-red)
![Policy](https://img.shields.io/badge/policy-Human%20Decision%20First-purple)

**CODIP** は、国土交通省、国土地理院、気象庁、自治体、道路、河川、防災、都市計画、インフラ、環境などに分散している公開データを、土木建設業務で再利用しやすい形に整理するための共通データ基盤です。

現行MVPは **データソース台帳、取得確認、取得ログ、地図プレビュー、品質状態、後続API、PostgreSQL/PostGIS標準レコード読取経路** を中心に実装しています。2026-07-19 時点で共有preview `http://192.168.0.185:3100/` は稼働確認済みです。ローカルSQLiteは台帳中心の軽量preview、CI/PostGIS previewは検証用 `standard_records` を投入した後続API smoke、本番Cloudflare/Neonと実データ原本保存は次フェーズで段階投入します。

> 公開データを探すだけのサイトではなく、土木建設システムが公開データを安全に再利用するための共通データハブです。

---

## 🧭 まず何のシステムか

```mermaid
flowchart TD
    A["🌐 国・自治体・公共機関の公開データ"] --> B["📚 データソース台帳"]
    B --> C["🔌 取得確認・サンプル取得"]
    C --> D["🧾 取得ログ・品質状態"]
    D --> E["🧹 標準化設計・後続API契約"]
    E --> F["🗺️ 横断検索・地図表示"]
    E --> G["🔗 後続システム向け共通API"]
    F --> H["👤 人による確認"]
    G --> I["🏗️ リスク・気象・地形・物流等のDXシステム"]
```

現在の公開データは、API、CSV、GeoJSON、Shapefile、XML、PDFなど形式がばらばらです。CODIPはまずそれらを台帳化し、取得できるかを確認し、出典・ライセンス・更新日・品質状態を見える化します。

---

## 👥 読む人別の見方

### 1. 👤 非エンジニア向け

CODIPは「土木建設に使える公開データの案内所」です。

| よくある困りごと | CODIPでできること |
| --- | --- |
| どの公開データを見ればよいか分からない | データ名、分野、提供元、利用目的で探せます |
| 情報が古いか不安 | 最終確認日、データ基準日、取得日時を確認できます |
| 出典や利用条件が分からない | ライセンス、出典表記、商用利用可否を確認できます |
| 複数サイトを見るのが大変 | 横断検索と地図表示でまとめて確認できます |

⚠️ CODIPは確認支援システムです。施工可否、安全性、法令適合を自動で断定しません。最終判断は担当者が行います。

### 2. 👷 土木建設現場管理者向け

現場周辺の気象、警報、河川、道路、周辺施設などを素早く確認する入口になります。

```mermaid
flowchart LR
    A["📍 現場住所・緯度経度"] --> B["🔍 周辺データ検索"]
    B --> C["🌦️ 気象・警報"]
    B --> D["🌊 河川・浸水"]
    B --> E["🛣️ 道路・規制"]
    B --> F["🏥 医療機関・避難施設"]
    C --> G["✅ 出典と更新日を確認"]
    D --> G
    E --> G
    F --> G
```

### 3. 🧑‍🔧 土木建設技術者向け

候補地、道路、河川、用途地域、標高、災害リスクなどを初期調査するための基盤です。

| 確認軸 | 現行MVP | 次フェーズ |
| --- | --- | --- |
| 台帳 | ✅ 実装済み | 拡充 |
| 取得確認 | ✅ 実装済み | 定期取得 |
| 地図 | ✅ 2Dプレビュー | 実データレイヤー拡充 |
| 標準レコード | ✅ PostGIS読取MVP | 実データ投入・履歴管理 |
| 空間判定 | ✅ PostGIS環境で地点照会MVP | 範囲検索・重複判定拡充 |

### 4. 🔬 土木建設研究者向け

データソースの所在、形式、更新頻度、ライセンス、品質状態を比較できます。APIキー付きデータはHTTPSかつ正規ホストのみへ秘密値を付与する設計です。

### 5. 🏢 会社経営層向け

公開データ調査の重複を減らし、後続システムが同じ形式でデータを使える状態を目指します。仕様変更やURL変更の影響を基盤側へ集約できます。

### 6. 🧑‍💻 社内IT部門スタッフ向け

管理API、取得ログ、品質再計算、後続API、Docker preview、PostgreSQL/PostGIS移行、Cloudflare/Neon staging runbookを整備しています。

---

## 🧱 システム構成

```mermaid
flowchart TD
    A["Next.js Web UI"] --> B["API Routes"]
    B --> C["Prisma"]
    C --> D["SQLite Preview"]
    C --> E["PostgreSQL/PostGIS Target"]
    B --> F["URL Guard / Rate Limit / Admin Guard"]
    B --> G["Connectors<br>GSI / JMA / e-Stat / generic"]
    H["GitHub Actions"] --> I["Release Gate"]
    I --> J["Docker Preview"]
    I --> K["Trivy Image Scan"]
    I --> L["GHCR SBOM / Provenance"]
```

| 領域 | 現在 | 本番目標 |
| --- | --- | --- |
| UI | Next.js | Cloudflare Workers目標 (`@opennextjs/cloudflare`) |
| API | Next.js Route Handlers | Cloudflare Workers分離候補 |
| DB | SQLite preview / PostgreSQL schema | Neon PostgreSQL + PostGIS |
| 認証 | 管理トークン / HttpOnly Cookie | Cloudflare Access + proxy secret |
| CI | GitHub Actions | SHA固定Actions、CodeQL、Trivy、SBOM/provenance |
| 本番URL | 共有preview `http://192.168.0.185:3100/` | `https://civilopendata.mirai-dx-platform.com` |

---

## ✅ 実装済みの主な機能

| 区分 | 内容 |
| --- | --- |
| 📚 台帳 | データソース、提供元、カテゴリ、形式、ライセンス、タグ |
| 🔍 検索 | キーワード、カテゴリ、提供元、形式、APIキー要否、状態、タグ |
| 🗺️ 地図 | 地理院タイル、GeoJSON貼り付け、標高取得 |
| 🧾 運用ログ | 接続確認ログ、サンプルレスポンス、保持期間dry-run |
| 🛡️ セキュリティ | 管理API保護、CSRF、Rate Limit、SSRF対策、秘密URL拒否 |
| 🔗 後続API | `/api/v1/records/search`, `/point`, `/layers`, `/freshness` |
| 🐳 Docker | production runner / preview runner / PostgreSQL preview |
| 🚦 CI | lint、型、単体、build、release smoke、PostGIS、Docker、CodeQL |

---

## 🚦 記録済みリリースゲート証跡

2026-07-13時点のDraft PR #17で取得したgreen baselineです。最新のPR headに対する状態はGitHub PR checksを正とし、run IDはリリース時に [docs/16-release-readiness-checklist.md](docs/16-release-readiness-checklist.md) へ追記します。

| 区分 | 状態 | 証跡 |
| --- | --- | --- |
| PR | 🟢 Draft PR #17 | `agent/release-readiness-postgis-ci` |
| commit | 🟢 `e2c007f` | `align docker smoke admin token` |
| CI run | 🟢 success | `29232542066` |
| CodeQL run | 🟢 success | `29232541952` |
| verify | 🟢 pass | lint、型、単体、契約、build、smoke |
| e2e | 🟢 pass | Playwright CI browser |
| postgresql-compat | 🟢 pass | PostGIS migration、seed、`/api/v1` standard_records smoke |
| docker-preview | 🟢 pass | preview-runner migration/seed、production runner smoke |
| docker-image-security | 🟢 pass | Trivy High/Critical CVE check |
| production-target-env | ⚪ skipped | `workflow_dispatch` で実staging/production Secretsを読む手動ゲート |
| docker-supply-chain | ⚪ skipped | `main` push後のGHCR push、SBOM、provenance gate |
| CodeRabbit | ⚪ draft skipped | PRをReady化後、または `@coderabbitai review` でレビュー対象 |

⚠️ `production-target-env` と `docker-supply-chain` はPR greenだけでは完了しません。Cloudflare/Neon実ターゲット検証とGHCR供給網証跡は、staging/production移行時に別途記録します。

---

## ✅ リリース後preview確認 (2026-07-19)

| 区分 | 確認結果 |
| --- | --- |
| URL | `http://192.168.0.185:3100/` |
| 主要画面 | ダッシュボード表示成功。登録データソース56件、カテゴリ別集計、最近登録データ表示を確認 |
| ブラウザログ | Chrome console error/warn 0件 |
| API | `/api/health` 200、`/api/ready` 200、`/api/dashboard` 200、`/api/sources` 200、`/api/openapi` 200 |
| 管理保護 | `/api/fetch-logs` は未認証401、`/api/admin/audit-events` のGETは405 |
| DB | `/api/ready` 200でアプリからDB接続を確認。共有previewは正本Neonではなくローカル/preview DB |
| Cloudflare/Neon | production targetは `civilopendata.mirai-dx-platform.com`。`wrangler.jsonc` と `infra/cloudflare/` は準備済み。Hyperdrive IDはplaceholderで、DNS/Access/Secret/Neon実リソースは人間承認後に確定 |

### 🔧 2026-07-19 安定化改善

| 区分 | 内容 |
| --- | --- |
| Workers互換 | SSRF事前DNS検証を `dns.lookup` から `resolve4` / `resolve6` へ変更。Workers上のfail-closed範囲を縮小 |
| 標準レコード | `standardRecordsAvailable()` を60秒TTL + single-flight化し、標準データのロールバック/空化と並行アクセス競合へ対応 |
| 管理認証 | `CODIP_DISABLE_TOKEN_AUTH=true` を追加。Cloudflare Access等のproxy authを正とする環境で、直接token経路とtokenによる新規セッション開始を閉じられる |
| テスト | URL guard、標準レコード可用性、管理認証、環境変数検証、管理セッションAPIの回帰テストを追加 |

## ✅ リリース準備状況 (2026-07-18 再検証)

`branch agent/release-readiness-postgis-ci` (PR #17 Draft, commit `1f1d570`) を 2026-07-18 に再検証した結果。すべての単体ゲートがgreen、PostgreSQL/PostGIS Docker previewの起動とruntime smokeも成功しました。GitHub Actions CI も同一 commit に対して全 job green です。

| 区分 | コマンド | 結果 |
| --- | --- | --- |
| 静的解析 | `npm run lint` | 🟢 0 errors |
| 型検査 | `npx tsc --noEmit` | 🟢 0 errors |
| 単体テスト | `npm run test` | 🟢 222 passed / 21 files |
| 契約チェック | `release:check-{v1-contract,doc-api-contract,openapi-coverage,docker-contract,cloudflare-contract,github-actions-contract}` | 🟢 all OK (19 API routes covered) |
| 本番ビルド | `npm run build` | 🟢 success (27 routes) |
| リリースゲート | `npm run release:gate` | 🟢 OK |
| SQLite duplicate公式URL | `db:check-duplicates` | 🟢 no duplicates |
| 標準レコード方針 | `db:check-standard-record-policy` (PostgreSQL) | 🟢 standard_records=1 |
| Prisma model parity | `db:compare-schemas` | 🟢 OK |
| PostgreSQL schema検証 | `db:pg:validate` | 🟢 schema valid |
| PostgreSQL drift | `db:pg:check-drift` (PostGIS docker上) | 🟢 OK (GiST index ignoredは仕様) |
| PostGIS DDL | `db:pg:check-postgis-ddl` | 🟢 OK |
| env検証 (local) | `validate-env --mode local` | 🟢 OK (警告のみ) |
| env検証 (preview) | `validate-env --mode preview` | 🟢 OK |
| Docker PostGIS preview | `docker compose -f docker-compose.postgresql-preview.yml up --build` | 🟢 healthy (port 3102) |
| `release:smoke` (PostGIS環境) | `npm run release:smoke -- --base-url http://127.0.0.1:3102 --expect-standard-records --expect-seed-standard-record` | 🟢 80 checks passed |
| 秘密情報混入確認 | `grep -E "password|api[_-]?key|secret|token" --include="*.ts"` | 🟢 ソース内の機密値ゼロ (URL safety regex, label, placeholder のみ) |
| TODO/FIXME | `grep -E "TODO|FIXME|XXX|HACK"` src/ scripts/ docs/ | 🟢 検出0件 |
| E2E (ローカル) | `npm run test:e2e` | ⚪ Chromium `SIGTRAP` で18件失敗。CI `e2e` ジョブは `pass` 実績。本制約は §既知制約 に既載 |

### 🏗️ 本番インフラの状態

2026-07-18 時点で **Cloudflare / Neon の実リソースは未作成**です (Worker `codip` 不在、Hyperdrive config 0 件、CODIP の Neon project 不在)。CODIP はまだ一度もデプロイされていません。本番化には以下が順に必要で、**いずれも人間の承認・実行が前提**です。

2026-07-19 にCloudflare本番サブドメインを `civilopendata.mirai-dx-platform.com` として確定しました。`wrangler.jsonc` には Workers Custom Domain (`routes[].custom_domain=true`) と production `workers_dev=false` を設定済みですが、Cloudflare側のCustom Domain/DNS/Access/Secrets/Hyperdrive/Neon実リソース作成は未実行です。

| # | 作業 | 承認が必要な理由 |
| --- | --- | --- |
| 1 | Neon project / branch の作成 | 課金発生・リソース作成 |
| 2 | `wrangler hyperdrive create` と `wrangler.jsonc` の id 置換 | 課金発生・リソース作成 |
| 3 | `wrangler secret put` による秘密情報登録 | Secrets の登録 |
| 4 | Issue #18 の解消 | Workers 上で外部URL取得とDB接続が動作しないため |
| 5 | `infra/cloudflare/` の `terraform apply` | 本番アクセス制御の変更 |
| 6 | `wrangler deploy --env production` | 本番デプロイ |

### ⚠️ 残課題

- **Codex review (通常・対抗)**: `disable-model-invocation` により自律 CTO から起動不可。人間実行待ち ([Issue #19](https://github.com/Kensan196948G/Civil-Open-Data-Intelligence-Platform/issues/19))
- **Cloudflare Workers ランタイム互換**: [Issue #18](https://github.com/Kensan196948G/Civil-Open-Data-Intelligence-Platform/issues/18)。SSRF事前DNS検証は `dns.promises.resolve4` / `resolve6` へ変更済み。PostgreSQL Prisma Clientは `@prisma/adapter-pg` によりHyperdrive `connectionString` を消費できる構成へ変更済み。Prisma 6.19系ではdriver adapterのpreview flagは不要。残りは接続時ピン留め側のWorkers最終設計と実Cloudflare/Neon証跡
- **main の branch protection 未設定**: 「CI 未通過 merge 禁止」「main 直 push 禁止」が技術的に強制されていない。PR #17 merge 前の設定を推奨
- **PR #17 Draft → Ready**: Codex レビュー結果待ち。main への merge は人間判断待ち。**merge すると `docker-supply-chain` job が GHCR へイメージを push する** (リポジトリが private のためイメージも既定 private)

🔒 **本番リリース・本番デプロイは未実施**。リリース直前の完成状態まで整え、承認待ちで停止しています。
切り戻し手順は [`docs/runbooks/rollback.md`](docs/runbooks/rollback.md) を参照してください。

---

## 🔐 セキュリティ方針

| 項目 | 方針 |
| --- | --- |
| 管理操作 | `CODIP_ADMIN_TOKEN` またはCloudflare Access相当の前段保護が必須 |
| 管理UI | トークンをlocalStorageへ保存せず、署名済みHttpOnly Cookieを使用 |
| CSRF | 管理セッションCookie/Proxy認証の変更系操作は同一Origin必須 |
| SSRF | private / loopback / metadata IP、非HTTP、認証情報付きURLを拒否 |
| APIキー | DB・ログに保存しない。e-Stat等はHTTPS正規ホストのみへ実行時付与 |
| Proxy認証 | `CODIP_DISABLE_TOKEN_AUTH=true` で直接token経路を無効化し、Cloudflare Access + proxy secret + allowlist を正本にできる |
| Rate Limit | 公開API、管理API、取得系API、タグAPIに適用 |
| Supply Chain | Docker base image digest固定、GitHub Actions SHA固定、Trivy scan |
| Preview DB image | PostGIS service imageもdigest固定 |

---

## 🚀 ローカル起動

```bash
npm ci
DATABASE_URL='file:./dev.db' npm run db:migrate
DATABASE_URL='file:./dev.db' npx prisma db seed
DATABASE_URL='file:./dev.db' npm run dev
```

WebUI:

```text
http://localhost:3000
```

Docker preview (compose が公開するポート):

```text
http://127.0.0.1:3100   # docker-compose.preview.yml (SQLite)
http://127.0.0.1:3102   # docker-compose.postgresql-preview.yml (PostgreSQL/PostGIS)
```

管理操作をローカルで試す場合:

```bash
export CODIP_ADMIN_TOKEN="change-this-very-long-random-token-32"
DATABASE_URL='file:./dev.db' npm run dev
```

`/settings` で管理操作トークンを入力し、管理セッションを開始します。

---

## 🧪 主要コマンド

| コマンド | 用途 |
| --- | --- |
| `npm run dev` | 開発サーバー起動 |
| `npm run start:checked` | 環境変数検査後に本番サーバー起動 |
| `npm run build` | 本番ビルド |
| `npm run lint` | 静的チェック |
| `npx tsc --noEmit` | 型検査 |
| `npm run test` | 単体テスト |
| `npm run test:e2e` | Playwright E2E。保護preview相当で管理セッションも確認 |
| `npm run release:gate` | audit、契約、schema、env、lint、型、単体、build |
| `CODIP_ADMIN_TOKEN=... npm run release:smoke -- --base-url http://127.0.0.1:3100` | 起動中アプリのHTTPスモーク |
| `npm run release:smoke -- --read-only --base-url https://...` | staging/production向けの非破壊HTTPスモーク |
| `npm run release:smoke -- --base-url http://127.0.0.1:3102 --expect-standard-records` | PostGIS投入環境で `/api/v1` の `standard_records` modeを強制確認 |
| `npm run release:smoke -- --base-url http://127.0.0.1:3102 --expect-standard-records --expect-seed-standard-record` | PostgreSQL seed入りCI/previewで検証用標準レコードとproperties sanitizationも確認 |
| `npm run db:migrate` | SQLite preview/localへ既存migrationを適用 |
| `npm run db:migrate:dev` | schema作成者向け。新規migration生成時のみ使用 |
| `npm run release:check-docker-contract` | Dockerfile、`.dockerignore`、image scan、SBOM/provenance契約 |
| `npm run release:check-cloudflare-contract` | Cloudflare/Neon staging runbook契約 |
| `npm run release:check-github-actions-contract` | actionlint、危険trigger、Action SHA固定契約 |
| `npm run release:validate-env:production-target` | 実Cloudflare/Neon targetのSecrets/Variables検証 |
| `npm run db:pg:check-postgis-ddl` | PostGIS DDL確認 |
| `npm run db:pg:check-drift` | PostgreSQL schema drift確認 |
| `npm run db:prune -- --dry-run` | 運用ログ保持期間の削除候補確認 |

---

## 🐳 Docker Preview

SQLite preview:

```bash
export CODIP_ADMIN_TOKEN="change-this-very-long-random-token-32"
export CODIP_SEED_ON_START=true
docker compose -f docker-compose.preview.yml up --build
```

Preview URL: `http://localhost:3100`

PostgreSQL/PostGIS preview:

```bash
export CODIP_ADMIN_TOKEN="change-this-very-long-random-token-32"
export CODIP_SEED_ON_START=true
docker compose -f docker-compose.postgresql-preview.yml up --build
```

Preview URL: `http://localhost:3102`

production `runner` は `npm ci --omit=dev` を使い、起動時migrationを行いません。migration/seedはone-off release jobで実行します。

---

## 🔗 後続システム向けAPI

| API | 用途 | 現行MVPの注意 |
| --- | --- | --- |
| `/api/v1/records/search` | 標準レコード検索 | PostGIS環境は `standard_records`、SQLite/未投入時は `catalog_metadata_only` warning |
| `/api/v1/records/point` | 地点照会 | PostGIS環境は空間評価、SQLite/未投入時は `not_standardized` warning |
| `/api/v1/layers` | レイヤー一覧 | PostGIS環境は標準レコード由来、SQLite/未投入時は `catalog_only` |
| `/api/v1/layers/{id}/features` | GeoJSON FeatureCollection | PostGIS環境はFeature返却、SQLite/未投入時は未標準化を明示 |
| `/api/v1/sources/{id}/freshness` | 鮮度・品質状態 | 出典と品質確認用 |

---

## 📁 ドキュメント

| ファイル | 内容 |
| --- | --- |
| [docs/01-requirements-definition.md](docs/01-requirements-definition.md) | 要件定義 |
| [docs/02-detailed-design-specification.md](docs/02-detailed-design-specification.md) | 詳細仕様設計 |
| [docs/03-system-architecture.md](docs/03-system-architecture.md) | アーキテクチャ |
| [docs/04-api-design.md](docs/04-api-design.md) | API設計 |
| [docs/05-data-model-and-database.md](docs/05-data-model-and-database.md) | データモデル・DB |
| [docs/09-security-and-compliance.md](docs/09-security-and-compliance.md) | セキュリティ・コンプライアンス |
| [docs/12-test-plan.md](docs/12-test-plan.md) | テスト計画 |
| [docs/13-deployment-and-operations.md](docs/13-deployment-and-operations.md) | デプロイ・運用 |
| [docs/16-release-readiness-checklist.md](docs/16-release-readiness-checklist.md) | リリース直前チェック |
| [docs/release-notes.md](docs/release-notes.md) | リリース後確認・安定化履歴 |
| [docs/runbooks/cloudflare-neon-staging.md](docs/runbooks/cloudflare-neon-staging.md) | Cloudflare/Neon staging runbook |
| [docs/runbooks/monitoring.md](docs/runbooks/monitoring.md) | 監視・アラート・初動確認手順 |
| [docs/runbooks/database-deployment.md](docs/runbooks/database-deployment.md) | DBデプロイ、バックアップ、SQLite復元、PostgreSQL/PostGIS移行前チェック |
| [docs/runbooks/rollback.md](docs/runbooks/rollback.md) | 障害時の切り戻し手順 (判断フロー、Workers、GHCR、Neon PITR、Prisma、SQLite) |

---

## 🎯 MVP成功条件

| 指標 | 目標 |
| --- | --- |
| 公式データソース | 20件以上 |
| 出典表示率 | 100% |
| ライセンス登録率 | 100% |
| 取得ログ記録率 | 100% |
| 後続API | 3種類以上 |
| 重大な秘密情報ログ出力 | 0件 |
| release gate | 成功 |
| release smoke | 成功 |

---

## ⚠️ 現時点の既知制約

| 制約 | 対応方針 |
| --- | --- |
| ローカルSQLite previewは `standard_records` 未投入 | PostGIS seed/CIでは検証用標準レコードを投入し、`--expect-standard-records` smokeで `/api/v1` の実地物返却を確認 |
| Cloudflare Workersは目標構成 | staging runbook準備済み。実環境証跡は初回deploy時に記録 |
| 3D都市モデル表示は未実装 | PLATEAU連携フェーズで扱う |
| AI判断機能は未実装 | 検索支援・要約補助に限定して将来導入 |
| E2Eはブラウザ環境依存 | CIまたはブラウザ実行可能環境で再検証 |

---

## 🧑‍⚖️ 判断方針

AIやシステムは確認支援までです。施工可否、安全性、災害発生、法令適合を断定しません。出典、基準日、取得日時、ライセンス、品質状態を確認したうえで、最終判断は人が行います。
