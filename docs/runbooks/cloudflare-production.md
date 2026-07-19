# Cloudflare Production Runbook

`civilopendata.mirai-dx-platform.com` をCloudflare Workers + Neon/PostGISの本番入口として有効化するための手順である。
このRunbookは **DNS、Custom Domain、Access、Secrets、Hyperdrive、Neon本番接続を無断で変更しない** ことを前提に、承認済み作業者が本番化の証跡を揃えるための入口として使う。

## 0. Production target

| 項目 | 値 |
| --- | --- |
| Zone | `mirai-dx-platform.com` |
| Subdomain | `civilopendata` |
| FQDN | `civilopendata.mirai-dx-platform.com` |
| URL | `https://civilopendata.mirai-dx-platform.com` |
| Worker | `codip` (`wrangler.jsonc`) |
| Routing | Workers Custom Domain (`routes[].custom_domain=true`, production `workers_dev=false`) |
| DB | Neon PostgreSQL/PostGIS via Cloudflare Hyperdrive |
| Secrets | Cloudflare/GitHub Secrets only. Do not commit secret values |

## 1. Stop conditions

次のいずれかが未完了なら、DNS変更、Custom Domain接続、Secret更新、production deployを停止する。

| Gate | 合格条件 |
| --- | --- |
| Production Hyperdrive | `wrangler.jsonc` の `REPLACE_WITH_PRODUCTION_HYPERDRIVE_ID` を承認済みの実IDへ置換済み |
| Target env | `CODIP_DEPLOY_TARGET=production`、`CODIP_BASE_URL=https://civilopendata.mirai-dx-platform.com`、Neon branch、Hyperdrive binding、migration direct URL、認証設定が実値 |
| Evidence | Cloudflare Access、logs、alert policy、Neon monitoring、backup/restore、rollback owner、smoke schedule の証跡が揃っている |
| Migration | Neon本番branchでPostGIS preflight、`prisma migrate status/deploy`、drift checkが成功 |
| Smoke | `release:smoke --read-only` が本番URLに対して成功 |
| Rollback | 直前Worker version、Neon復旧手段、担当者、判断時刻を記録済み |

## 2. Required checks

```bash
CODIP_DEPLOY_TARGET="production" \
CODIP_BASE_URL="https://civilopendata.mirai-dx-platform.com" \
npm run release:validate-env:production-target

npm run release:production-evidence -- --strict
npm run release:check-production-placeholders -- --env production
npm run cf:build
npm run release:check-cloudflare-build-artifact
```

WindowsのUNC共有から実行する場合は、npmのカレントディレクトリ問題を避けるため次の形を使う。

```powershell
cmd /c "pushd \\192.168.0.185\kensan\Projects\Mirai-DX-Project\Civil-Open-Data-Intelligence-Platform && npm run release:production-evidence -- --strict"
```

## 3. Deploy command

本番deployは承認済みCI/CD経路、または承認済み作業者の端末でのみ実行する。

```bash
npm run cf:deploy:production
```

`cf:deploy:production` は target env、production evidence、placeholder、Cloudflare build artifact をすべて検査してから `deploy --env production` へ進む。いずれかが失敗した場合は、本番変更を行わず、不足証跡を §5 Evidence に記録する。

## 4. Smoke and rollback

```bash
CODIP_ADMIN_TOKEN="$CODIP_ADMIN_TOKEN" \
npm run release:smoke -- --read-only --base-url "https://civilopendata.mirai-dx-platform.com"
```

失敗時の復旧判断は [rollback.md](rollback.md) と [cloudflare-neon-staging.md](cloudflare-neon-staging.md) §5 に従う。DB破壊、認証不全、重大なデータ不整合の疑いがある場合は追加変更より復旧を優先する。

## 5. Evidence

| 項目 | 記録 |
| --- | --- |
| Approval / change ticket |  |
| commit SHA |  |
| Cloudflare Worker version |  |
| Custom Domain status |  |
| DNS status |  |
| Access application / policy evidence |  |
| Hyperdrive binding name / ID evidence |  |
| Neon project / branch evidence |  |
| Migration result |  |
| `release:validate-env:production-target` result |  |
| `release:production-evidence -- --strict` result |  |
| `release:check-production-placeholders -- --env production` result |  |
| Cloudflare logs / alert policy evidence |  |
| Neon monitoring evidence |  |
| Backup / restore evidence |  |
| Smoke monitoring schedule |  |
| `release:smoke --read-only` result |  |
| Rollback owner / rollback target |  |
