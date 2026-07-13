# デプロイ・運用設計

## 1. 環境

| 環境 | 目的 | 構成 |
| --- | --- | --- |
| Local | 開発 | Next.js, SQLite |
| 現行共有Preview | 関係者検証 | Node.jsコンテナ、SQLiteまたはPostgreSQL/PostGIS compose、Cloudflare Access相当の前段保護 |
| 将来Staging | Cloudflare/Neon検証 | Cloudflare Pages/Workers、Access、Neon PostgreSQL/PostGIS staging branch |
| Production目標 | 本番 | Cloudflare Pages/Workers、Access、Neon PostgreSQL/PostGIS、Cloudflare Cron Triggers |

## 2. デプロイ方針

MVPではローカル、CI、Docker previewで品質を確認する。Cloudflare Pages/WorkersとNeon/PostGISは本番目標構成であり、現行リポジトリには `wrangler`、OpenNext、Cloudflare Pages adapterはまだ導入していない。取得処理は将来Cloudflare Cron TriggersとWorkersへ分離する。

## 2.1 環境変数

| 変数 | 必須 | 内容 |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Prisma接続先。MVPはSQLite、本番はPostgreSQL/PostGIS。外部production PostgreSQLは `sslmode=require` または `sslmode=verify-full` 必須 |
| `CODIP_ACCEPT_SQLITE_PREVIEW` | Preview only | SQLiteを共有プレビューで使うことを明示するフラグ。本番では使用禁止 |
| `CODIP_SEED_ON_START` | Preview only | Docker preview起動時にseedを投入するか |
| `CODIP_RUN_MIGRATIONS_ON_START` | Preview only | Docker previewの単一インスタンス検証でのみ、起動時migrationを許可する |
| `CODIP_BASE_URL` | Smoke | release smokeの対象URL |
| `CODIP_DEPLOY_TARGET` | Staging/Production evidence | 実ターゲット検証時に `staging` または `production` を設定 |
| `CODIP_ALLOWED_ORIGINS` | Preview/Production | 管理セッションCSRF検証で許可するOrigin |
| `CODIP_ALLOW_INSECURE_LOCAL_COOKIES` | Local only | HTTPローカル検証でのみ通常Cookieを許可する |
| `CODIP_FETCH_LOG_RETENTION_DAYS` | Optional | 取得ログ保持日数。既定90日 |
| `CODIP_SAMPLE_RETENTION_DAYS` | Optional | サンプルレスポンス保持日数。既定30日 |
| `CODIP_ADMIN_TOKEN` | Preview/Production | 管理操作APIの保護トークン。32文字以上の十分ランダムな値 |
| `CODIP_ALLOW_INSECURE_ADMIN` | Local only | ローカル開発でのみ管理操作を無認証許可する明示フラグ |
| `CODIP_TRUST_PROXY_AUTH` | Optional | Cloudflare Access等の認証済みプロキシを信頼する場合のみ `true` |
| `CODIP_TRUST_PROXY_HEADERS` | Optional | 信頼済みプロキシ配下でのみ、レート制限にForwarded系IPヘッダーを使う |
| `CODIP_TRUST_PROXY_SECRET` | Proxy auth時 | プロキシから `x-codip-proxy-secret` として送る共有シークレット |
| `CODIP_ADMIN_EMAILS` | Proxy auth時 | 管理者として許可するメールアドレス |
| `CODIP_ADMIN_EMAIL_DOMAINS` | Proxy auth時 | 管理者として許可するメールドメイン |
| `CODIP_HYPERDRIVE_BINDING` | Future Cloudflare | RuntimeからNeonへ接続するCloudflare Hyperdrive binding名 |
| `CODIP_NEON_BRANCH` | Staging/Production evidence | Neon branch名を証跡として記録 |
| `CODIP_MIGRATION_DATABASE_URL` | Migration | Hyperdriveを経由しないNeon direct endpoint。CI/CD secretで管理 |
| `ESTAT_APP_ID` | Optional | e-Stat API利用時のアプリケーションID |

## 2.2 現在のCIゲート

| ゲート | 内容 |
| --- | --- |
| install | `npm ci` |
| audit | `npm audit --audit-level=moderate` |
| lint | `npm run lint` |
| unit | `npm run test` |
| db smoke | `prisma migrate deploy` と `prisma db seed` |
| db preflight | `npm run db:check-duplicates` |
| standard record policy | `npm run db:check-standard-record-policy` |
| v1 contract | `npm run release:check-v1-contract` |
| docs/API contract | `npm run release:check-doc-api-contract` |
| OpenAPI route coverage | `npm run release:check-openapi-coverage` |
| Docker release contract | `npm run release:check-docker-contract` |
| Docker image scan | GitHub Actions `docker-image-security` job |
| PostGIS service image | CI service / PostgreSQL preview compose ともにdigest固定 |
| GitHub Actions contract | `npm run release:check-github-actions-contract` |
| Cloudflare/Neon contract | `npm run release:check-cloudflare-contract` |
| postgres schema | `npm run db:compare-schemas`, `npm run db:pg:validate`, `npm run db:pg:generate` |
| postgis ddl | `npm run db:pg:check-postgis-ddl` |
| postgres drift | `npm run db:pg:check-drift` |
| log retention dry-run | `npm run db:prune -- --dry-run` |
| build | `npm run build` |
| env validation | local/preview検証と、CI合成値によるproduction形状検証。実ターゲットproduction envはデプロイ環境のSecrets/Variablesを読み込んで別途 `npm run release:validate-env:production-target` |
| release gate | `npm run release:gate` |
| preview start smoke | `npm run start:checked` 後に `npm run release:smoke` |
| production target smoke | GitHub Actions `production-target-env` 手動jobで `release:validate-env:production-target` と read-only smoke |
| e2e | Playwright Chromium |
| SAST | CodeQL |

CIではpreview検証に加え、SSL付きPostgreSQL URLの合成値で `npm run release:validate-env:production` を実行し、production環境変数検査ロジックの形状を確認する。これは実Neon/本番Secretsの検証ではないため、stagingまたはproduction deploy前には、対象環境のSecrets/Variablesを読み込んだジョブで `npm run release:validate-env:production-target` を実行し、その結果をリリース証跡へ記録する。この実ターゲット検証は `CODIP_DEPLOY_TARGET`、実HTTPS `CODIP_BASE_URL`、Cloudflare Hyperdrive binding、Neon branch、migration direct URL、外部PostgreSQL SSLを必須にし、example/ci/placeholder/local値を拒否する。Docker imageの起動時も `node scripts/tools/validate-env.js --mode ${CODIP_ENV_MODE:-production}` を先に実行する。本番コンテナは `runner` stage を使い、`npm ci --omit=dev` により開発依存を含めない。migrationとseedはone-off release jobで実行し、共有previewの単一インスタンス検証時だけ `preview-runner` stage と `CODIP_RUN_MIGRATIONS_ON_START=true` を明示する。CIの `docker-preview` job では、preview-runnerでPostgreSQL/PostGISへmigration/seedを適用した後、production `runner` imageを `CODIP_ENV_MODE=production` で起動し、`/api/ready` と `release:smoke` を実行する。`docker-image-security` job はproduction runner imageをpush前にTrivyで固定可能なHigh/Critical CVE検査にかける。main push時の `docker-supply-chain` job は主要ゲート成功後にGHCRへproduction runner imageをpushし、BuildxのSBOM attestationと `mode=max` provenanceを付与する。GitHub ActionsはタグではなくコミットSHAへ固定し、`release:check-github-actions-contract` で再混入を検出する。

## 2.3 共有プレビュー構成

正式な本番構成はCloudflare Pages/WorkersとNeon PostgreSQL/PostGISを目標にする。ただし、MVPの画面・API・運用手順を関係者へ確認してもらう共有プレビューでは、Node.jsコンテナと永続ボリューム上のSQLiteを限定利用できる。

```bash
export CODIP_ADMIN_TOKEN="change-this-very-long-random-token-32"
export CODIP_SEED_ON_START=true
docker compose -f docker-compose.preview.yml up --build
```

PostgreSQL/PostGISのコンテナ経路を確認する場合は、PostGIS service付きのpreview composeを使う。

```bash
export CODIP_ADMIN_TOKEN="change-this-very-long-random-token-32"
export CODIP_SEED_ON_START=true
docker compose -f docker-compose.postgresql-preview.yml up --build
```

制約:

| 項目 | 方針 |
| --- | --- |
| DB | `codip-data` volume にSQLiteを保存。単一インスタンス限定 |
| スケール | 水平スケール不可 |
| 本番利用 | 禁止。`npm run release:validate-env:production` はSQLiteを拒否する |
| 管理認証 | `CODIP_ADMIN_TOKEN` またはCloudflare Access相当の前段保護を必須 |
| 起動確認 | compose healthcheck、`/api/ready`、`release:smoke` で確認 |

`docker-compose.preview.yml` は `CODIP_ENV_MODE=preview`、`CODIP_RUN_MIGRATIONS_ON_START=true`、Docker build target `preview-runner` を明示する。`docker-compose.postgresql-preview.yml` はPostGIS serviceとアプリコンテナのPostgreSQL接続経路を検証する。production manifestでは `runner` stage、`CODIP_ENV_MODE` 未指定または `production`、PostgreSQL/PostGIS接続を必須化し、外部DBでは `sslmode=require` または `sslmode=verify-full` を付与する。migrationはアプリ起動とは別のrelease jobで実行する。

アプリ実行時は `DATABASE_URL` に応じてSQLite ClientまたはPostgreSQL Clientを選択する。production deploy前には、CIのPostgreSQL runtime smoke、Docker PostgreSQL preview smoke、staging `/api/ready`、`/api/sources`、`/api/v1` standard_records mode、管理API確認を必須にする。PostGIS投入環境では `release:smoke -- --expect-standard-records` を使い、標準レコード検索、地点照会、レイヤー、FeatureCollection、properties sanitizationを確認する。Docker build context は `.env*` を除外し、`.env.example` だけを許可する。SBOM/provenance attestationはregistry push時の成果物として扱い、local `docker build --load` の代替証跡にはしない。

## 2.4 監視エンドポイント

| URL | 用途 | アラート条件 |
| --- | --- | --- |
| `/api/health` | アプリプロセスの生存確認 | 連続して `200` 以外 |
| `/api/ready` | DB接続を含むレディネス確認 | `503` または応答遅延 |
| `/api/openapi` | API契約の公開確認 | `200` 以外またはOpenAPIバージョン欠落 |

デプロイ直後は、画面表示に加えて `/api/ready` を確認し、DB migrationと接続設定が正しく反映されていることを確認する。`release:smoke` は各HTTPリクエストにタイムアウトを設け、CI側の `curl` も `--connect-timeout` / `--max-time` を指定する。staging/production相当の実ターゲットへ向ける場合は `--read-only` を付け、管理トークン付きの書き込み系negative testは使い捨てCI/preview DBでのみ実行する。

既存DBへ `officialUrl` 一意制約を適用する前に、必ず `npm run db:check-duplicates` を実行する。重複がある場合は、どちらを正本にするかを人が判断し、削除または統合してからmigrationを適用する。

## 3. 運用監視

| 監視対象 | 監視内容 |
| --- | --- |
| 取得成功率 | 連続失敗、成功率低下 |
| 更新遅延 | 最終成功日時、データ基準日 |
| API仕様変更 | parse_error増加、レスポンス形式変化 |
| DB容量 | 原本、標準化データ、ログ |
| レスポンス | 検索APIの応答時間 |
| セキュリティ | 秘密情報ログ、アクセス制御 |
| レート制限 | `429 rate_limited` の増加、外部API制限 |
| キャッシュ | `/api/map/elevation` の `X-CODIP-Cache` |

## 3.1 レート制限運用

| 対象 | アプリ内制限 | 本番前段制御 |
| --- | --- | --- |
| ダッシュボードAPI | 120 req/min/IP | Cloudflare WAF/Rate Limiting Rules |
| データソース検索API | 120 req/min/IP | Cloudflare WAF/Rate Limiting Rules |
| 標高API | 60 req/min/IP | Cloudflare WAF/Rate Limiting Rules |
| 接続確認 | 12 req/min/IP/source | Cloudflare Access配下に限定 |
| サンプル取得 | 6 req/min/IP/source | Cloudflare Access配下に限定 |
| 取得ログ | 60 req/min/IP | Cloudflare Access配下に限定 |
| タグ作成・削除 | 30 req/min/IP | Cloudflare Access配下に限定 |
| 品質再計算 | 20 req/min/IP | Cloudflare Access配下に限定 |

アプリ内制限は単一プロセスのメモリで管理するため、複数インスタンス本番ではCloudflare側の制限を正とする。

## 4. 障害対応

| 事象 | 初動 |
| --- | --- |
| 公開API停止 | 取得ログを確認し、台帳ステータスを要確認にする |
| URL変更 | 公式ページを確認し、台帳を更新する |
| ライセンス変更 | 利用条件を再確認し、再配布を停止する |
| DB障害 | バックアップから復旧する |
| 地図表示障害 | 背景タイル、GeoJSON、ブラウザエラーを切り分ける |

## 5. バックアップ

| 対象 | 方針 |
| --- | --- |
| 台帳DB | 定期バックアップ |
| 原本ファイル | オブジェクト保存のバージョニング |
| マイグレーション | Gitで管理 |
| ドキュメント | Gitで管理 |

## 6. ログ保持期限

取得ログとサンプルレスポンスは運用情報を含み、DB容量も増やすため保持期限を設ける。

```bash
npm run db:prune -- --dry-run
npm run db:prune -- --log-days 90 --sample-days 30
```

| 対象 | 既定保持 |
| --- | --- |
| `fetch_logs` | 90日 |
| `sample_responses` | 30日 |

削除前には `--dry-run` とDBバックアップを実行する。
