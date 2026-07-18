# テスト計画

## 1. テスト方針

台帳、取得、品質、地図、後続APIを壊さないことを重視する。公開APIは外部状況に左右されるため、単体テストではモックを使い、E2Eでは画面の主要導線を確認する。

## 2. テスト種別

| 種別 | 対象 | コマンド |
| --- | --- | --- |
| 単体 | バリデーション、品質計算、URLガード、コネクタ | `npm run test` |
| E2E | ダッシュボード、台帳、詳細、地図、タグ、取得ログ、アクセシビリティ基本回帰、保護previewの管理セッション | `npm run test:e2e` |
| Lint | TypeScript/React静的確認 | `npm run lint` |
| Build | Next.jsビルド | `npm run build` |
| DB | 既存migration適用、Seed | `npm run db:migrate`, `npm run db:seed` |
| DB preflight | 公式URL重複 | `npm run db:check-duplicates` |
| DB schema parity | SQLite/PostgreSQL中核モデル・フィールド差分 | `npm run db:compare-schemas` |
| PostgreSQL drift | migration適用済みDBとschema差分 | `npm run db:pg:check-drift` |
| Env contract | local/preview/production環境変数契約 | `npm run release:validate-env:*` |
| Release gate | audit、DB事前確認、v1/docs/OpenAPI/Docker/Cloudflare/GitHub Actions契約、schema、env、lint、型、単体、build | `npm run release:gate` |
| Release gate + E2E | ブラウザ実行可能環境での一括検証 | `npm run release:gate -- --include-e2e` |
| Smoke | 主要画面、未認証管理UI非表示、CSP/HSTS、監視API、OpenAPI v1 schema、seed最小件数、公開DTO、後続API契約、v1 warning契約、地点照会の不正入力、管理APIガード、管理セッションCSRF、悪性URL複数種の登録拒否 | `CODIP_ADMIN_TOKEN=... npm run release:smoke -- --base-url ...` |
| Read-only Smoke | staging/production向け。DBへ書き込む管理トークン付き悪性URL登録拒否テストをスキップ | `npm run release:smoke -- --read-only --base-url ...` |
| Standard Records Smoke | PostGIS投入環境で `/api/v1/records/search`, `/point`, `/layers`, `/features` が `standard_records` modeを返すこと、FeatureCollectionとproperties sanitizationを確認 | `npm run release:smoke -- --base-url ... --expect-standard-records` |
| Seed Standard Records Smoke | PostgreSQL seed入りCI/previewで固定検証レコードが返り、秘密系propertiesが漏れないことを確認 | `npm run release:smoke -- --base-url ... --expect-standard-records --expect-seed-standard-record` |
| Docker preview | Dockerfile/compose preview起動経路 | GitHub Actions `docker-preview` job |
| Docker supply chain | GHCR push、SBOM/provenance attestation | GitHub Actions `docker-supply-chain` job |
| Cloudflare/Neon contract | staging runbook、Hyperdrive/Neon環境例、証跡欄 | `npm run release:check-cloudflare-contract` |
| GitHub Actions contract | actionlint導入、危険なworkflow trigger、Trivy action固定、主要ActionsのSHA固定 | `npm run release:check-github-actions-contract` |
| Production target env | 実Cloudflare/Neon環境Secrets/Variablesの検証 | `npm run release:validate-env:production-target` |
| Security | 依存脆弱性、CSP/HSTS値 | `npm audit --audit-level=moderate`, `npm run release:smoke -- --base-url ...` |

## 3. 重点テスト観点

| 機能 | 観点 |
| --- | --- |
| 台帳登録 | 必須項目、http/https公開URLのみ許可、URL認証情報・秘密系クエリを保存しないこと、boolean文字列を明示解釈すること |
| 検索 | キーワード、カテゴリ、提供元、形式。公開検索では内部メモ `note` を検索対象にしない |
| 接続確認 | 成功、404、timeout、認証不足 |
| コネクタ | APIキー付きコネクタはHTTPSかつ正規ホストだけに秘密値を付与する |
| ログ | 秘密情報が出力されないこと |
| 品質 | スコア配点、境界値、最終確認日 |
| 地図 | タイル表示、標高取得、GeoJSON表示。標高APIはGSI正規HTTPSホスト・パスのみ取得する |
| タグ | 作成、削除、関連付け。タグ名・色の編集は次フェーズ |

## 4. リリース前チェック

```bash
npm run release:gate
npm run db:check-standard-record-policy
npm run release:check-v1-contract
npm run release:check-doc-api-contract
npm run release:check-openapi-coverage
CODIP_ADMIN_TOKEN=... npm run release:smoke -- --base-url http://127.0.0.1:3100
npm run release:smoke -- --read-only --base-url https://staging.example
npm run release:smoke -- --base-url http://127.0.0.1:3102 --expect-standard-records
npm run release:smoke -- --base-url http://127.0.0.1:3102 --expect-standard-records --expect-seed-standard-record
npm run release:gate -- --include-e2e
```

ローカルLinuxシェルでNext.js/webpackのWasm hashが仮想メモリ上限に当たる場合があるため、`next.config.ts` では `experimental.cpus=1` とNode cryptoベースのhashを指定している。

この環境ではPlaywrightのChromiumが `SIGTRAP` で起動できないことがある。アプリ起動、HTTP応答、ビルド、単体テストが通る場合でも、E2EはGitHub Actions等のブラウザ実行環境で再検証する。

## 5. アクセシビリティ回帰観点

| 対象 | 確認内容 |
| --- | --- |
| 台帳検索フォーム | キーワード、カテゴリ、提供元、形式、APIキー、状態、タグの各入力にラベルがある |
| データソースフォーム | 主要入力に `htmlFor` / `id`、タグチェックボックスがキーボード操作可能、保存エラーに `role=\"alert\"` がある |
| ログ画面 | 絞り込みselectにラベルがある |
| 地図画面 | マウスクリックに加え、緯度経度入力で標高取得でき、GeoJSON入力欄にラベルがある |
| 地図エラー | GeoJSON構文エラーと座標入力エラーが支援技術へ通知される |
| 管理UI | 未認証時はタグ追加、登録、編集、削除、取得実行などの管理操作UIを表示しない |
| 管理セッション | `CODIP_ADMIN_TOKEN` 設定下で `/settings` からセッションを開始し、登録・タグ・ログ導線を確認する |
| 共通ナビ | スキップリンク、mainへのフォーカス移動、現在ページの `aria-current` を確認する |
| データ表 | caption、列見出しscope、行見出しを確認する |

## 6. 受入条件

| 条件 | 判定 |
| --- | --- |
| 主要画面が表示できる | 必須 |
| 台帳登録と検索ができる | 必須 |
| 接続確認ログが残る | 必須 |
| 秘密情報がログに出ない | 必須 |
| 出典とライセンスを確認できる | 必須 |
| 地図が表示できる | MVP必須 |
