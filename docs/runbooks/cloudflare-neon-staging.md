# Cloudflare / Neon Staging Runbook

CODIPをCloudflare + Neon/PostGISへ出す前のstaging確認手順である。現行MVPの正式デプロイ可否は、このrunbookの証跡が揃ってから判断する。

## 0. Cloudflare target

| 項目 | 値 |
| --- | --- |
| Zone | `mirai-dx-platform.com` |
| Production subdomain | `civilopendata` |
| Production FQDN | `civilopendata.mirai-dx-platform.com` |
| Production URL | `https://civilopendata.mirai-dx-platform.com` |
| Worker | `codip` (`wrangler.jsonc`) |
| Routing | Workers Custom Domain (`routes[].custom_domain=true`, production `workers_dev=false`) |

Cloudflare公式docsでは、Workers Custom Domainは `wrangler.jsonc` の `routes` に `pattern` と `custom_domain=true` を設定し、`wrangler deploy` でWorkerへ接続する構成である。CODIPでは本番URLを `civilopendata.mirai-dx-platform.com` に固定し、production `workers_dev=false` で `*.workers.dev` 直公開経路を閉じる。Custom Domain、DNSレコード、Access application、Hyperdrive、Secretsの作成・更新は本番影響を持つため、人間承認済みのCI/CDまたはCloudflare操作手順でのみ実行する。

## 1. 接続方針

| 用途 | 接続先 | 方針 |
| --- | --- | --- |
| Runtime | Cloudflare Hyperdrive経由Neon pooled endpoint | `CODIP_HYPERDRIVE_BINDING` をCloudflare側Binding名として管理。未設定時は `HYPERDRIVE`。Prisma Client側は `@prisma/adapter-pg` を導入済み。Prisma 6.19系ではdriver adapterのpreview flagは不要 |
| Migration | Neon direct endpoint | `CODIP_MIGRATION_DATABASE_URL` をCI/CD secretで管理し、`sslmode=require` または `verify-full` を必須 |
| Staging DB | Neon branch | `CODIP_NEON_BRANCH` にbranch名を記録 |
| 管理入口 | Cloudflare Access | Access allowlist + `x-codip-proxy-secret` + 管理メールallowlist |

runtimeとmigrationの接続文字列は分離する。migrationはHyperdriveを経由せず、Neon branchに対して一回限りのrelease jobで実行する。

## 1.1 Build & Deploy

```bash
npm run cf:typegen
npm run cf:build
npm run cf:preview   # ローカルでWorkersランタイムを模したプレビュー確認
npm run cf:deploy    # 実際のCloudflareアカウントへdeploy (人間が実行)
```

`wrangler.jsonc` の `env.preview` / `env.production` named environmentを使う場合は `--env preview` / `--env production` を各コマンドに付与する。productionでは `https://civilopendata.mirai-dx-platform.com` を `CODIP_BASE_URL` とし、`routes[].custom_domain=true` で同FQDNをWorker Custom Domainへ割り当てる。Hyperdrive binding IDは `wrangler hyperdrive create <name> --connection-string="$CODIP_MIGRATION_DATABASE_URL"` で払い出し、`wrangler.jsonc` のプレースホルダーを置き換えてから `cf:deploy` する。秘密情報は `wrangler secret put <name> [--env preview|production]` で登録し、`wrangler.jsonc` にはコミットしない。

Workers runtimeでは `src/lib/db.ts` がOpenNextのCloudflare contextから `CODIP_HYPERDRIVE_BINDING` 名のbindingを読み、bindingの `connectionString` を `@prisma/adapter-pg` へ渡す。bindingが取得できないNode.js/Docker/CIでは `DATABASE_URL` を使うため、共有previewとCI smokeは従来どおり動作する。

Cloudflare Access保護は `infra/cloudflare/` のTerraformテンプレートを使う (`infra/cloudflare/README.md` 参照)。`terraform apply` は人間が実行する。

## 2. 事前Freeze

| 項目 | 合格条件 |
| --- | --- |
| commit SHA | GitHub Actions対象のSHAを記録 |
| image | GHCRの `sha-*` tagまたはdigestを記録 |
| DB branch | Neon staging branch名と作成時刻を記録 |
| secrets | `DATABASE_URL`, `CODIP_MIGRATION_DATABASE_URL`, `CODIP_ADMIN_TOKEN`, `CODIP_TRUST_PROXY_SECRET` がGitHub/Cloudflare secretで管理されている |
| Access | Cloudflare Accessでstaging URLが保護されている |

## 3. Migration

### 3.0 PostGIS capability preflight (migration 実行前に必須)

初回 migration (`20260713113000_init`) は先頭で `CREATE EXTENSION IF NOT EXISTS postgis` を実行する。
対象 DB で PostGIS 拡張が利用できない場合 (拡張ポリシーが制限された managed PostgreSQL 等)、
migration が途中失敗して中途半端な状態が残るため、**適用前に必ず拡張の利用可否を確認する**。

```bash
# postgis が利用可能な拡張として提供されているか (1行返れば OK)
DATABASE_URL="$CODIP_MIGRATION_DATABASE_URL" \
  psql "$CODIP_MIGRATION_DATABASE_URL" -c \
  "SELECT name, default_version FROM pg_available_extensions WHERE name = 'postgis';"

# 権限も含めて実際に有効化できるか (migration と同じ文。冪等)
psql "$CODIP_MIGRATION_DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS postgis;"
```

- Neon は PostGIS を標準サポートしており `CREATE EXTENSION postgis` で有効化できる
- preflight が失敗する環境では migration を実行しない。拡張が有効化できる DB を用意するか、
  対象 DB の選定をやり直す (Codex adversarial review 指摘: 拡張前提の migration は
  環境非依存ではないため、能力確認を deploy 手順の必須ステップとする)
- migration 失敗時の復旧は §5 Rollback と `docs/runbooks/rollback.md` §4/§5 を参照
  (Prisma に down migration はなく、branch 破棄 / PITR / forward fix で戻す)

```bash
DATABASE_URL="$CODIP_MIGRATION_DATABASE_URL" \
  npx prisma migrate status --schema prisma/postgresql/schema.prisma

DATABASE_URL="$CODIP_MIGRATION_DATABASE_URL" \
  npx prisma migrate deploy --schema prisma/postgresql/schema.prisma

DATABASE_URL="$CODIP_MIGRATION_DATABASE_URL" \
  npm run db:pg:check-drift

DATABASE_URL="$CODIP_MIGRATION_DATABASE_URL" \
  npm run db:pg:check-postgis-ddl

DATABASE_URL="$CODIP_MIGRATION_DATABASE_URL" \
  npm run db:pg:seed
```

## 3.1 実ターゲット環境変数検証

Cloudflare/Neon stagingまたはproductionのSecrets/Variablesを読み込んだ状態で、合成値ではない実ターゲット検証を実行する。

```bash
CODIP_DEPLOY_TARGET="production" \
CODIP_BASE_URL="https://civilopendata.mirai-dx-platform.com" \
npm run release:validate-env:production-target
```

`DATABASE_URL`、`CODIP_MIGRATION_DATABASE_URL`、`CODIP_HYPERDRIVE_BINDING`、`CODIP_NEON_BRANCH`、管理トークンまたはProxy認証設定は、対象環境の実値を使う。`example.com`、localhost、CI用token、placeholder値が混入している場合は失敗させる。

Secrets/Variablesの実値を読み込んだ端末では、次のread-only証跡レポートも取得する。接続文字列、管理トークン、proxy secretは値を出さず、set/unsetとSSL条件だけを記録する。

```bash
npm run release:production-evidence -- --strict
```

`--strict` は実ターゲットに必要なEvidence入力が欠けている場合に失敗する。失敗時はDNS/Secrets/Deployを進めず、不足項目を本runbook §6 Evidenceへ記録する。

合格条件:

| 確認 | 合格条件 |
| --- | --- |
| migrate status | 未適用migrationが想定どおり |
| migrate deploy | 成功 |
| drift | 差分なし |
| PostGIS DDL | extension、SRID 4326、GIST index、JSONB defaultが一致 |
| seed | stagingで必要な台帳件数を確認。既存stagingデータを使う場合はseedを省略し、件数確認結果をEvidenceへ記録 |

## 4. Smoke

```bash
CODIP_ADMIN_TOKEN="$CODIP_ADMIN_TOKEN" \
  npm run release:smoke -- --read-only --base-url "https://civilopendata.mirai-dx-platform.com"
```

標準レコードをstagingへ投入済みの場合は、追加で次を実行する。

```bash
npm run release:smoke -- --read-only --base-url "https://civilopendata.mirai-dx-platform.com" --expect-standard-records
```

`--expect-seed-standard-record` は使い捨てCI/preview DBのseed検証用である。実stagingで本物の標準レコードを扱う場合は、特定seed IDに依存しない `--expect-standard-records` のみを使う。

管理トークン付きの悪性URL登録拒否テストなど、DBへ書き込む可能性があるsecurity negative testは、使い捨てCI/preview DBでのみ `--read-only` なしで実行する。

追加で確認するURL:

| URL | 合格条件 |
| --- | --- |
| `/api/ready` | `status=ready`, `checks.database=ok` |
| `/api/sources?take=1` | `items` が返り、秘密系フィールドがない |
| `/api/openapi` | OpenAPI `3.1.0` |
| `/api/v1/records/search?limit=1` | `warnings[].code` が構造化形式 |

## 5. Rollback

| 事象 | 対応 |
| --- | --- |
| migration失敗 | Neon branchを破棄、またはsnapshotから復旧。`migrate resolve` は原因と対象migrationをIssueに記録してから実行 |
| runtime smoke失敗 | 直前のGHCR digestへ戻す。DB破壊を伴わない場合のみ再deploy |
| Access/認証失敗 | Cloudflare Access policyとproxy secretを戻し、直アクセス経路を遮断 |
| PostGIS DDL不一致 | deploy停止。schema/migrationの差分を修正して再branchで検証 |

## 6. Evidence

| 項目 | 記録 |
| --- | --- |
| commit SHA |  |
| GHCR image digest |  |
| Neon branch |  |
| migration ID |  |
| `migrate status` 結果 |  |
| `db:pg:check-drift` 結果 |  |
| `db:pg:check-postgis-ddl` 結果 |  |
| `release:validate-env:production-target` 結果 |  |
| `/api/ready` 結果 |  |
| `release:smoke` 結果 |  |
| rollback owner |  |
