# 🏗️ Civil Open Data Intelligence Platform

## Civil土木建設オープンデータ統合分析基盤 | CODIP

![Status](https://img.shields.io/badge/status-MVP%20release%20hardening-green)
![Stack](https://img.shields.io/badge/stack-Next.js%20%2B%20Prisma-blue)
![GIS](https://img.shields.io/badge/GIS-GeoJSON%20%2F%20PostGIS%20ready-orange)
![Security](https://img.shields.io/badge/security-Access%20%2B%20Token%20Guard-red)
![Policy](https://img.shields.io/badge/policy-Human%20Decision%20First-purple)

**CODIP** は、国土交通省、国土地理院、気象庁、自治体、道路、河川、防災、都市計画、インフラ、環境などに分散している公開データを、土木建設業務で再利用しやすい形に整理するための共通データ基盤です。

現行MVPは **データソース台帳、取得確認、取得ログ、地図プレビュー、品質状態、後続API、PostgreSQL/PostGIS標準レコード読取経路** を中心に実装しています。ローカルSQLiteは台帳中心の軽量preview、CI/PostGIS previewは検証用 `standard_records` を投入した後続API smoke、本番Cloudflare/Neonと実データ原本保存は次フェーズで段階投入します。

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

## 🔐 セキュリティ方針

| 項目 | 方針 |
| --- | --- |
| 管理操作 | `CODIP_ADMIN_TOKEN` またはCloudflare Access相当の前段保護が必須 |
| 管理UI | トークンをlocalStorageへ保存せず、署名済みHttpOnly Cookieを使用 |
| CSRF | 管理セッションCookie/Proxy認証の変更系操作は同一Origin必須 |
| SSRF | private / loopback / metadata IP、非HTTP、認証情報付きURLを拒否 |
| APIキー | DB・ログに保存しない。e-Stat等はHTTPS正規ホストのみへ実行時付与 |
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

現在の共有確認用ローカルpreview:

```text
http://localhost:3104
http://192.168.0.185:3104
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
| [docs/runbooks/cloudflare-neon-staging.md](docs/runbooks/cloudflare-neon-staging.md) | Cloudflare/Neon staging runbook |

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
