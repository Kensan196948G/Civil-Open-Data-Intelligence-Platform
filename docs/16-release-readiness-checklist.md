# リリース直前チェックリスト

CODIPを共有プレビューまたは本番相当環境へ出す前に、次の項目を必ず確認する。

## 1. ビルド・テスト

| 区分 | コマンド | 合格条件 |
| --- | --- | --- |
| 静的解析 | `npm run lint` | エラー0件 |
| 型検査 | `npx tsc --noEmit` | エラー0件 |
| 単体テスト | `npm run test` | 全テスト成功 |
| 依存監査 | `npm audit --audit-level=moderate` | moderate以上0件 |
| DB事前確認 | `DATABASE_URL=file:./dev.db npm run db:check-duplicates` | 公式URL重複0件 |
| 標準レコード方針 | `npm run db:check-standard-record-policy` | SQLite fallbackとPostgreSQL/PostGIS `standard_records` 読取MVPの契約がDB状態と一致 |
| PostgreSQL schema確認 | `npm run db:compare-schemas && npm run db:pg:validate && npm run db:pg:generate` | 中核モデルとPostgreSQL schemaが妥当 |
| PostgreSQL drift確認 | `npm run db:pg:check-drift` | 適用済みDBと `prisma/postgresql/schema.prisma` に差分がない |
| PostGIS DDL確認 | `npm run db:pg:check-postgis-ddl` | `standard_records` のPostGIS extension、SRID、index、JSONB defaultが一致 |
| API契約確認 | `npm run release:check-v1-contract && npm run release:check-doc-api-contract && npm run release:check-openapi-coverage` | v1契約、docs/API整合、OpenAPI route掲載が妥当 |
| Docker契約確認 | `npm run release:check-docker-contract` | Dockerfile、`.dockerignore`、image scan、GHCR push、SBOM/provenance設定が妥当 |
| Cloudflare/Neon契約確認 | `npm run release:check-cloudflare-contract` | staging runbook、環境変数、PostGIS/Hyperdrive前提が文書化済み |
| GitHub Actions契約確認 | `npm run release:check-github-actions-contract` | actionlint、危険なworkflow trigger、Trivy action固定、主要ActionsのSHA固定が妥当 |
| env検証 | `npm run release:validate-env:preview` | 共有プレビュー必須設定が妥当 |
| production env形状検証 | `npm run release:gate` 内の合成production env | PostgreSQL/PostGIS前提、外部DBのSSL指定、本番管理トークン強度、SQLite/未対応DB URL/起動時migration禁止の検査ロジックを確認 |
| production実ターゲットenv検証 | 実デプロイ環境のSecrets/Variablesを読み込んで `npm run release:validate-env:production-target` | `CODIP_DEPLOY_TARGET`、実HTTPS `CODIP_BASE_URL`、Cloudflare Hyperdrive、Neon branch、migration direct URL、外部PostgreSQL SSL、管理トークンまたはProxy認証設定、起動時migration禁止が実値で妥当 |
| ログ保持dry-run | `npm run db:prune -- --dry-run` | 取得ログ・サンプル保持期間の削除候補を確認できる |
| 本番ビルド | `npm run build` | 成功 |
| リリースゲート | `npm run release:gate` | ブラウザ非依存ゲートが一括成功 |
| 起動スモーク | `CODIP_ADMIN_TOKEN=... npm run release:smoke -- --base-url http://127.0.0.1:3100` | 主要画面、未認証管理UI非表示、CSP/HSTS、監視API、OpenAPI v1 schema、seed最小件数、公開DTO、後続API契約、v1 warning契約、地点照会の不正入力、管理APIガード、管理セッションCSRF、悪性URL複数種の登録拒否が成功 |
| 実ターゲットread-onlyスモーク | `npm run release:smoke -- --read-only --base-url https://...` | staging/production DBへ書き込まず、主要画面、監視API、後続API、管理ガードを確認 |
| Docker preview | GitHub Actions `docker-preview` job | production runner / preview runner build、production runner + PostgreSQL smoke、SQLite/PostgreSQL compose config、preview起動、ready、release smokeが成功 |
| Docker image scan | GitHub Actions `docker-image-security` job | Trivyでproduction runner imageに固定可能なHigh/Critical CVEがない |
| Docker supply chain | GitHub Actions `docker-supply-chain` job | GHCR image push、SBOM attestation、`mode=max` provenance、sha tag/digestが確認できる |
| PostGIS service image | CI service / PostgreSQL preview compose | `postgis/postgis@sha256:...` でdigest固定されている |
| Secret scan | GitHub Actions verify job | gitleaksと `.env` 追跡検出が成功 |
| SAST | GitHub Actions CodeQL | CodeQL workflowが成功。code scanning alert gateとして扱う場合はリポジトリ側でcode scanningを有効化し、`continue-on-error` の扱いをrelease前に再確認 |
| E2E | `npm run test:e2e` | CIまたはブラウザ実行可能環境で成功 |

## 1.1 リリース証跡

### 2026-07-13 Draft PR #17 記録済みgreen baseline

| 項目 | 記録 |
| --- | --- |
| PR | #17 `agent/release-readiness-postgis-ci` |
| commit SHA | `e2c007f4772235b77f9228805714d8aee4f8404d` |
| commit message | `align docker smoke admin token` |
| CI run | `29232542066` success |
| CodeQL run | `29232541952` success |
| verify | pass |
| e2e | pass |
| postgresql-compat | pass。PostGIS migration、seed、`/api/v1` standard_records smokeを確認 |
| docker-preview | pass。preview-runner migration/seed、production runner smokeを確認 |
| docker-image-security | pass。Trivy High/Critical CVE checkを確認 |
| production-target-env | skipped。PRでは実ターゲットSecretsを読まず、`workflow_dispatch` 実行時に記録 |
| docker-supply-chain | skipped。PRではpushせず、`main` push後にGHCR tag/digest/SBOM/provenanceを記録 |
| CodeRabbit | Draft PRのためreview skipped。Ready化後または `@coderabbitai review` で実レビュー |
| ローカルread-only smoke | `http://127.0.0.1:3104` に対して63 checks成功 |
| ローカルDocker | Docker daemon未接続のためローカル実行不可。CI `docker-preview` を証跡に採用 |

最新のPR headに対するCI状態はGitHub PR checksを正とする。実ターゲットstaging/production release時は、下の記録欄へ対象環境のSecrets/Variables、GHCR digest、SBOM/provenance、read-only smoke結果を追記する。

### 実ターゲットリリース時の記録欄

| 項目 | 記録 |
| --- | --- |
| 確認日 |  |
| 確認者 |  |
| commit SHA |  |
| GHCR image tag |  |
| image digest |  |
| Neon branch |  |
| migration ID |  |
| 実ターゲット `release:validate-env:production-target` 結果 |  |
| `db:pg:check-drift` 結果 |  |
| `db:pg:check-postgis-ddl` 結果 |  |
| `/api/ready` 結果 |  |
| `release:smoke` 結果 |  |
| read-only `release:smoke` 結果 |  |
| rollback owner |  |

## 2. ランタイム確認

| URL | 目的 | 合格条件 |
| --- | --- | --- |
| `/api/health` | プロセス生存確認 | `200` と `status: ok` |
| `/api/ready` | DB接続を含むレディネス | `200` と `status: ready` |
| `/api/openapi` | API契約公開 | OpenAPI `3.1.0` を返す |
| `/api/v1/records/search` | 後続システム向け検索 | PostGIS投入時は `standard_records` 由来の `data.records` を返す。SQLite/未投入時も `data.records`、`meta.requestId`、`warnings` を返す |
| `/api/v1/records/point` | 地点照会 | PostGIS投入時は空間評価を返す。未投入時は `records=[]`、`spatialEvaluation.evaluated=false`、`not_standardized` warningを返す |
| `/api/v1/sources/{id}/freshness` | 鮮度API | 品質状態、最終成功日時、連続失敗数を返す |
| `/api/v1/layers` | レイヤー一覧 | `data.layers`、`dataAvailability`、`geometryStatus`、`featuresUrl` を返す |
| `/api/v1/layers/{id}/features` | レイヤー地物 | PostGIS投入時はGeoJSON FeatureCollectionに地物を返す。未標準化時は `not_standardized` warningを返す |
| `/` | ダッシュボード | `200` |
| `/sources` | 台帳検索 | `200` |
| `/map` | 地図プレビュー | `200` |
| `/settings` | 管理設定 | `200` |

## 3. セキュリティ確認

| 項目 | 合格条件 |
| --- | --- |
| 管理操作保護 | 本番・共有プレビューでは `CODIP_ADMIN_TOKEN`、または `CODIP_TRUST_PROXY_AUTH=true`、`CODIP_TRUST_PROXY_SECRET`、管理者メールallowlistを設定 |
| 管理トークン強度 | `CODIP_ADMIN_TOKEN` は32文字以上の十分ランダムな値を使い、共有チャットやGitに貼らない |
| 管理セッション | HTTPSでは `__Host-` Cookie。HTTPローカル検証で `CODIP_ALLOW_INSECURE_LOCAL_COOKIES=true` の場合のみ通常Cookie。CookieはHttpOnly、SameSite Strict、署名付き期限、nonceを持つ |
| CSRF | Cookie認証の変更系管理APIで同一Origin検証が動作し、管理セッション開始・終了ではOrigin/Referer欠落も拒否する |
| プロキシCSRF | Cloudflare Access等のプロキシ認証による変更系管理APIでも同一Origin検証が動作する |
| ローカル解除 | `CODIP_ALLOW_INSECURE_ADMIN=true` はローカル開発以外で使用しない |
| プロキシ信頼 | `cf-access-authenticated-user-email` 単独では管理操作を許可しない |
| 秘密情報 | `.env`、APIキー、認証ヘッダー、接続文字列をGitに含めない。URL内の秘密系クエリは台帳登録時に拒否する |
| Docker context | `.dockerignore` で `.env*` を除外し、`.env.example` のみ許可する |
| Docker runtime | production `runner` はdevDependenciesを含めず、migration/seedは `preview-runner` またはone-off release jobで実行する |
| Secret scan | GitHub Actionsでgitleaksと `.env` 追跡検出を実行する |
| ログ | APIキー、トークン、認証ヘッダーを保存しない |
| ログ・サンプル閲覧 | 取得ログとサンプルレスポンス本文は管理者のみ閲覧可能 |
| APIキー必須データ | サンプル本文をDBへ保存しない |
| 取得URL | SSRF対策により private / loopback / metadata IP を拒否 |
| URL資格情報 | 非HTTPスキーム、内部ホスト、`user:password@host` 形式、秘密系クエリ付きURLを登録拒否し、ログでも除去する |
| 運用ログ返却 | 管理者向けログ・サンプルも返却直前に再マスクする |
| GSI標高API | 台帳URLがGSI正規HTTPSホスト・パスに一致する場合だけ `/api/map/elevation` から取得する |
| 公開検索 | 内部メモ `note` を公開検索条件に含めない |
| ready詳細 | `/api/ready` 障害時に内部例外や接続先を公開しない |
| レート制限 | `/api/dashboard`, `/api/sources`, `/api/tags`, `/api/map/elevation`, `/api/admin/session`, 取得系管理APIで `429` が返る |
| APIキー付きコネクタ | e-Stat等はHTTPSかつ正規ホストだけに実行時APIキーを付与する |
| プロキシヘッダー | `CODIP_TRUST_PROXY_HEADERS=true` 以外ではForwarded系IP/host/protoヘッダーを信頼しない |
| セキュリティヘッダー | release smokeでCSP主要値、`unsafe-eval` 不在、HSTSを検査する |
| キャッシュ | 標高APIの同一点再取得で外部API・ログ書き込みを抑制 |
| ログ保持 | `npm run db:prune -- --dry-run` で削除候補を確認できる |

## 3.1 アクセシビリティ確認

| 項目 | 合格条件 |
| --- | --- |
| フォームラベル | 台帳検索、ログ絞り込み、データソース登録/編集、管理トークン、GeoJSON入力の主要入力に `label` と入力要素の関連付けがある |
| 共通ナビ | スキップリンク、main focus、現在ページ `aria-current` がある |
| データ表 | 検索結果、取得ログ、品質履歴にcaptionとscope付き見出しがある |
| エラー通知 | 保存エラー、管理セッションエラー、接続確認エラー、削除エラー、タグ追加エラー、GeoJSONエラー、座標入力エラーは `role=\"alert\"` または同等の通知を持つ |
| 地図代替操作 | クリック操作に加え、緯度経度入力で標高確認できる |
| 管理UI | 未認証時はタグ追加、登録、編集、削除、接続確認等の管理操作UIを表示せず、設定画面へ案内する |

## 4. 運用確認

| 項目 | 合格条件 |
| --- | --- |
| データソース台帳 | MVP対象の公式データソースが登録済み |
| 出典・ライセンス | 登録データの出典と利用条件が確認可能 |
| 品質状態 | 品質スコアまたは要確認状態が画面で確認可能 |
| 取得ログ | 接続確認・サンプル取得の実行結果が記録される |
| GitHub Project | 既知課題、リリース前残件、レビュー結果がIssue化されている |

## 5. 現時点の既知制約

| 制約 | 対応方針 |
| --- | --- |
| ローカルPlaywright Chromiumが一部環境で `SIGTRAP` になる | CIではE2E成功済み。ローカル実行不能環境はIssue証跡で追跡 |
| ローカルDBはSQLite preview | 本番スケール時はNeon PostgreSQL/PostGISへ移行。PostGIS migration/seed/runtime smokeはCIで検証済み |
| ローカルSQLite seedは `standard_records` 未投入 | PostGIS seed/CIでは検証用標準レコードを投入し、`--expect-standard-records` smokeで読取APIを確認 |
| PostgreSQL runtime smoke | CIまたはPostGIS利用可能なstagingで、PostgreSQL Clientによる `/api/ready`、`/api/sources`、`/api/v1` standard_records modeを確認 |
| Docker previewはSQLite単一インスタンス | 関係者検証用に限定し、本番利用しない。起動時migrationはpreviewのみ許可 |
| 3D都市モデル表示は未実装 | PLATEAU連携フェーズで扱う |
| AIによる判断機能は未実装 | 検索支援・要約補助に限定して将来導入 |

## 5.1 Known Release Documentation Gaps

| Gap | Project issue化の粒度 |
| --- | --- |
| Cloudflare Pages/Workersは目標構成で、現行共有previewはNode.jsコンテナ中心 | staging導入時に `wrangler` / adapter / Access / Hyperdrive の実設定証跡を追加 |
| 標準レコード本体と原本保存基盤はstaging未投入 | `/api/v1` のPostGIS読取パスとCI用標準レコードsmokeは実装済み。実データ投入、原本保存先、移行手順はstaging導入時に追加 |
| Cloudflare/Neon staging smokeはrunbook準備済みで実環境証跡は未記録 | 初回staging deploy時に `/api/ready`、`/api/sources`、migration、rollback ownerを記録 |
