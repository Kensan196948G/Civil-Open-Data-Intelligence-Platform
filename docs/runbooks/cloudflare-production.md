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
| Routing | Zone route (`routes[].pattern=civilopendata.mirai-dx-platform.com/*` + `zone_name`) + proxied AAAA `100::` DNSレコード、production `workers_dev=false` |
| DB | Neon PostgreSQL/PostGIS via Cloudflare Hyperdrive (`codip-production`, ID `1da7b81807374ec190addf146717d275`, caching disabled) |
| Neon | project `falling-dawn-93620497` (Civil-Open-Data-Intelligence-Platform, PG17, aws-us-west-2) default branch |
| Secrets | Cloudflare/GitHub Secrets only. Do not commit secret values |

## 1. Stop conditions

次のいずれかが未完了なら、DNS変更、Custom Domain接続、Secret更新、production deployを停止する。

| Gate | 合格条件 |
| --- | --- |
| Production Hyperdrive | `wrangler.jsonc` production env のHyperdrive IDが実ID (`scripts/deploy/create-hyperdrive.mjs` で払い出し) へ置換済み |
| Target env | `CODIP_DEPLOY_TARGET=production`、`CODIP_BASE_URL=https://civilopendata.mirai-dx-platform.com`、Neon branch、Hyperdrive binding、migration direct URL、認証設定が実値 |
| Evidence | Cloudflare Access、logs、alert policy、Neon monitoring、backup/restore、rollback owner、smoke schedule の証跡が揃っている |
| Migration | Neon本番branchでPostGIS preflight、`prisma migrate status/deploy`、drift checkが成功 |
| Smoke | `release:smoke --read-only` が本番URLに対して成功 |
| Rollback | 直前Worker version、Neon復旧手段、担当者、判断時刻を記録済み |

## 1.1 New subdomain / routing gate

`civilopendata` は `mirai-dx-platform.com` 配下の新規サブドメインとして扱う。

**決定記録 (2026-07-20)**: 当初計画はWorkers Custom Domain (`custom_domain=true`) だったが、現行APIトークンにはaccount-levelのWorkers Custom Domains APIスコープがなく (`/accounts/{id}/workers/domains` がerror 10000)、付与済みのZone Workers Routes + Zone DNSスコープで完結する **zone route方式** (route pattern + proxied AAAA `100::` レコード) へ変更した。TLSはUniversal SSLが第1階層サブドメインをカバーする。Custom Domain方式への移行はトークンへのスコープ付与後にIssueで扱う。この変更は `~/.claude/CLAUDE.md` §27.1の特則 (ユーザー指定サブドメインの追加DNSレコード作成 + Worker紐付け) の範囲内である。

| Check | 合格条件 |
| --- | --- |
| Zone ownership | Cloudflare zone `mirai-dx-platform.com` が対象accountでactive |
| Hostname conflict | `civilopendata.mirai-dx-platform.com` に既存CNAME / Worker route / Pages custom domain / Access application の衝突がない |
| Local DNS before change | `civilopendata.mirai-dx-platform.com` が未解決、または未接続状態として記録済み |
| Worker route | `wrangler.jsonc` production env が `routes[].pattern=civilopendata.mirai-dx-platform.com/*`、`zone_name=mirai-dx-platform.com`、`workers_dev=false` |
| DNS record | proxied AAAA `100::` を `scripts/deploy/deploy-production.mjs` が冪等に作成 (既存レコードがあれば変更しない) |
| DNS after action | 作成したDNS recordとTLS (Universal SSL) statusをEvidenceへ記録 |
| Access boundary | 公開後、管理系導線がCloudflare Access + `CODIP_TRUST_PROXY_SECRET` + allowlistで保護されるまでは、fail-closed全拒否状態を維持する |

このゲートが未充足の場合は、DNS recordを追加しない。候補は `civilopendata.mirai-dx-platform.com` として本Runbookに記録し、実変更は承認済みCloudflare操作へ移す。

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

`release:production-evidence -- --strict` は、Secrets値を出さずにEvidence入力の有無と `wrangler.jsonc` のproduction静的構成を検査するゲートである。Cloudflare API / Neon APIへ接続してCustom Domain、Access application、Hyperdrive config、Neon projectの実在を自動確認するものではない。strictが通っても、§1.1 と §5 のCloudflare Dashboard / Wrangler / Neon Consoleでの実リソース証跡を別途記録する。

WindowsのUNC共有から実行する場合は、npmのカレントディレクトリ問題を避けるため次の形を使う。

```powershell
cmd /c "pushd \\192.168.0.185\kensan\Projects\Mirai-DX-Project\Civil-Open-Data-Intelligence-Platform && npm run release:production-evidence -- --strict"
```

## 3. Deploy command

本番deployは承認済みCI/CD経路、または承認済み作業者の端末でのみ実行する。標準経路は secrets-safe なパイプラインスクリプトである。

```bash
# 標準経路: Neon URI解決(in-process) -> migrate status -> DNS -> cf:deploy:production -> secrets
# (secretsは初回deploy後に登録。それまで管理系はfail-closed全拒否)
source ~/.bashrc && node scripts/deploy/deploy-production.mjs --with-secrets

# workerdを起動できないホスト向け (hard ulimit -v によりminiflare/V8 sandboxが
# 起動不能な環境): 同一のゲート群を個別実行後、wrangler deployで直接デプロイする。
# 本プロジェクトはR2/KVキャッシュbindingを持たないため両経路は等価。
source ~/.bashrc && node scripts/deploy/deploy-production.mjs --with-secrets --wrangler-direct

# 個別実行する場合 (evidence/DB URLは環境変数で与える)
npm run cf:deploy:production
```

`cf:deploy:production` は target env、production evidence、placeholder、Cloudflare build artifact をすべて検査してから `deploy --env production` へ進む。いずれかが失敗した場合は、本番変更を行わず、不足証跡を §5 Evidence に記録する。

直接経路 (`--wrangler-direct`) の変更証跡 (PR #67): 制約の実測は「`ulimit -Hv`=20000000 (hard、root無しで引き上げ不可)、miniflare起動時に `Fatal process out of memory: SegmentedTable::InitializeTable`」。ゲート群 (validate-env / evidence --strict / placeholders / cf:build / artifact check) はPR #66デプロイ試行時に全PASS実績あり。`wrangler deploy` 単体の実環境検証は初回本番デプロイをもって証跡化し、結果を §5 Evidence へ記録する。失敗時は §4 と [rollback.md](rollback.md) に従う (初回デプロイはroute無効化/DNSレコード削除で公開停止)。

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
| Hostname conflict check |  |
| Cloudflare zone status |  |
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
