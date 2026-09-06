# Cloudflare Production Runbook

`odip.mirai-dx-platform.com` をCloudflare Workers + Neon/PostGISの本番入口として有効化するための手順である。
このRunbookは **DNS、Custom Domain、Access、Secrets、Hyperdrive、Neon本番接続を無断で変更しない** ことを前提に、承認済み作業者が本番化の証跡を揃えるための入口として使う。

> ⚠️ **実態との整合（2026-08-30移行 / 2026-09-06 Access再設定）**
> 本ドキュメント（§0〜§5）はCloudflare Workers + Hyperdrive + Neon構成での本番化手順の記録である。
> Neon本番DBのパスワードローテーションに起因する認証失効（[Issue #190](https://github.com/Kensan196948G/Civil-Open-Data-Intelligence-Platform/issues/190)）を機に、
> **2026-08-30以降の現行公開経路は Cloudflare Tunnel + ローカル `next start`（PostgreSQL、開発機常駐）** であり、
> Worker `codip` のproduction envとHyperdrive binding（`1da7b81807374ec190addf146717d275`）は現行トラフィックには使われていない。
>
> ```text
> odip.mirai-dx-platform.com
>   └─ DNS: CNAME → 4f7b805d-302a-4548-8cf8-058533298944.cfargotunnel.com（proxied）
>        └─ Cloudflare Tunnel（systemd: codip-production-cloudflared.service）
>             └─ ingress: http://localhost:18810
>                  └─ systemd: codip-production.service（next start -p 18810、DATABASE_URL=ローカルPostgreSQL）
> pg-odip.mirai-dx-platform.com（開発者リモートpsql用の直結ルート、同一Tunnel）
>   └─ ingress: tcp://localhost:5432
> ```
>
> 2026-08-30の移行時、以前 `odip` に設定されていた Cloudflare Access Application（旧ID `9af09a69-6338-4e9b-ad31-8434aa0a3f1e`）が引き継がれておらず、
> 一時的にAccess保護なしで一般公開される状態が発生していた（本番API/UIが未認証で200を返す状態を実測で検知）。
> **2026-09-06に検知し、`odip`（app id `5281c2ba-e50f-477e-b277-e31cabaa617d`）と `pg-odip`（app id `92b121e2-7cc7-4c80-91eb-9b2d9c243e9e`）双方に
> Access Application（allow policy: mirai-const.co.jp + kensan1969@gmail.com、Service Auth policyで監視用service tokenを許可）を再作成し復旧済み。**
> 以下§0〜§5のHyperdrive/Neon固有の記述は、将来Workers配信へ戻す場合の参考として保持する。運用中の手順は
> [docs/runbooks/database-deployment.md](database-deployment.md) §4.1 を正とする。

## 0. Production target

| 項目 | 値 |
| --- | --- |
| Zone | `mirai-dx-platform.com` |
| Subdomain | `odip` |
| FQDN | `odip.mirai-dx-platform.com` |
| URL | `https://odip.mirai-dx-platform.com` |
| Worker | `codip` (`wrangler.jsonc`) |
| Routing | Zone route (`routes[].pattern=odip.mirai-dx-platform.com/*` + `zone_name`) + proxied AAAA `100::` DNSレコード、production `workers_dev=false` |
| DB | Neon PostgreSQL/PostGIS via Cloudflare Hyperdrive (`codip-production`, ID `1da7b81807374ec190addf146717d275`, caching disabled) |
| Neon | project `falling-dawn-93620497` (Civil-Open-Data-Intelligence-Platform, PG17, aws-us-west-2) default branch |
| Access | Cloudflare Access app `odip`（allow policy: mirai-const.co.jp + kensan1969@gmail.com、Service Auth policy `odip-service-auth` は監視用service tokenのみ）。未認証は302→login |
| Deployed | `codip-production` 2026-08-05T04:58Z（Version `0eaaaafa-9995-4607-afdb-6e34801f9c9e`、main `41400dc` 相当、gzip 2492.69 KiB） |
| Secrets | Cloudflare/GitHub Secrets only. Do not commit secret values |

## 1. Stop conditions

次のいずれかが未完了なら、DNS変更、Custom Domain接続、Secret更新、production deployを停止する。

| Gate | 合格条件 |
| --- | --- |
| Production Hyperdrive | `wrangler.jsonc` production env のHyperdrive IDが実ID (`scripts/deploy/create-hyperdrive.mjs` で払い出し) へ置換済み |
| Target env | `CODIP_DEPLOY_TARGET=production`、`CODIP_BASE_URL=https://odip.mirai-dx-platform.com`、Neon branch、Hyperdrive binding、migration direct URL、認証設定が実値 |
| Evidence | Cloudflare Access、logs、alert policy、Neon monitoring、backup/restore、rollback owner、smoke schedule の証跡が揃っている |
| Migration | Neon本番branchでPostGIS preflight、`prisma migrate status/deploy`、drift checkが成功 |
| Smoke | `release:smoke --read-only` が本番URLに対して成功 |
| Rollback | 直前Worker version、Neon復旧手段、担当者、判断時刻を記録済み |

### 1.0.1 Access service token（監視用・設定済み 2026-08-05）

本番URLはCloudflare Access配下のため、未認証の `/api/health` / `/api/ready` は302を返す。2026-08-05に監視用Access service tokenを発行し、Service Auth policyへ追加してGitHub Actions Secretへ登録した。Secrets値はCloudflare/GitHub Secretsのみに保持し、画面・ログ・commitへ出力しない。

| 項目 | 値 |
| --- | --- |
| Service token | `codip-production-smoke-20260805`（id `8e38737a-d75e-4c69-bbb3-c7dee5a13230`、client_id `362ab9507b561cf59b8f1b4850213c96.access`） |
| Access app | `odip`（id `9af09a69-6338-4e9b-ad31-8434aa0a3f1e`） |
| Service Auth policy | `odip-service-auth`（id `eaa7686f-f0b3-452c-a2da-87996d70b57c`、decision `non_identity`、precedence 2、include=本番tokenのみ） |
| GitHub Actions Secrets | `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` |
| 初回成功証跡 | Production Smoke run 30969524446（2026-08-05T02:30Z、`/api/health` 200 / `/api/ready` 200 `status=ready` `db=ok`） |
| 後片付け | 検証用一時token 3件は削除済み（policyにも含めていない） |

ローテーションは「新token発行 → Secrets更新 → 旧tokenをpolicyから除外 → 旧token削除」の順で行う。policyのdecision値はAPI上 `non_identity`（Service Auth）である点に注意する。

## 1.1 New subdomain / routing gate

`odip` は `mirai-dx-platform.com` 配下の新規サブドメインとして扱う。

**決定記録 (2026-07-20)**: 当初計画はWorkers Custom Domain (`custom_domain=true`) だったが、現行APIトークンにはaccount-levelのWorkers Custom Domains APIスコープがなく (`/accounts/{id}/workers/domains` がerror 10000)、付与済みのZone Workers Routes + Zone DNSスコープで完結する **zone route方式** (route pattern + proxied AAAA `100::` レコード) へ変更した。TLSはUniversal SSLが第1階層サブドメインをカバーする。Custom Domain方式への移行はトークンへのスコープ付与後にIssueで扱う。この変更は `~/.claude/CLAUDE.md` §27.1の特則 (ユーザー指定サブドメインの追加DNSレコード作成 + Worker紐付け) の範囲内である。

**決定記録 (2026-07-27)**: ユーザー指示により本番サブドメインを `civilopendata` から `odip` へ変更した。routing方式 (zone route + proxied AAAA `100::`)、Worker名 `codip`、Hyperdrive、Neon構成は変更しない。アクセス制御 (Cloudflare Access application / policy) はユーザー側で設定するため、本Runbookのデプロイ作業には含めない。旧 `civilopendata` のDNSレコード (proxied AAAA `100::`) は **2026-08-01にユーザー操作で削除済み** (`dig` でNXDOMAINを確認、`odip` 側のレコードは残置)。

| Check | 合格条件 |
| --- | --- |
| Zone ownership | Cloudflare zone `mirai-dx-platform.com` が対象accountでactive |
| Hostname conflict | `odip.mirai-dx-platform.com` に既存CNAME / Worker route / Pages custom domain / Access application の衝突がない |
| Local DNS before change | `odip.mirai-dx-platform.com` が未解決、または未接続状態として記録済み |
| Worker route | `wrangler.jsonc` production env が `routes[].pattern=odip.mirai-dx-platform.com/*`、`zone_name=mirai-dx-platform.com`、`workers_dev=false` |
| DNS record | proxied AAAA `100::` を `scripts/deploy/deploy-production.mjs` が冪等に作成 (既存レコードがあれば変更しない) |
| DNS after action | 作成したDNS recordとTLS (Universal SSL) statusをEvidenceへ記録 |
| Access boundary | 公開後、管理系導線がCloudflare Access + `CODIP_TRUST_PROXY_SECRET` + allowlistで保護されるまでは、fail-closed全拒否状態を維持する |

このゲートが未充足の場合は、DNS recordを追加しない。候補は `odip.mirai-dx-platform.com` として本Runbookに記録し、実変更は承認済みCloudflare操作へ移す。

## 2. Required checks

```bash
CODIP_DEPLOY_TARGET="production" \
CODIP_BASE_URL="https://odip.mirai-dx-platform.com" \
npm run release:validate-env:production-target

npm run release:production-evidence -- --strict
npm run release:check-production-placeholders -- --env production
npm run cf:build
npm run release:check-cloudflare-build-artifact
```

`release:production-evidence -- --strict` は、Secrets値を出さずにEvidence入力の有無と `wrangler.jsonc` のproduction静的構成を検査するゲートである。Cloudflare API / Neon APIへ接続してCustom Domain、Access application、Hyperdrive config、Neon projectの実在を自動確認するものではない。strictが通っても、§1.1 と §5 のCloudflare Dashboard / Wrangler / Neon Consoleでの実リソース証跡を別途記録する。

### 2.1 Worker bundle size gate

2026-08-01の再デプロイ試行では、OpenNext成果物にPostgreSQL用 (`2297601 bytes`) と未使用のSQLite用 (`2171299 bytes`) のPrisma WASM engineが同時混入し、`wrangler deploy --dry-run --env production` がgzip `3235.38 KiB`となった。これはWorkers Freeの圧縮後3 MB上限を超えるため、production deployを停止した。

Cloudflare build時だけ`@prisma/client`をPostgreSQL WASMへ解決し、通常のNode/SQLite buildを変えない修正後は、PostgreSQL WASM 1個のみとなり、同じdry-runでgzip `2350.09 KiB`を確認した。`npm run release:check-cloudflare-build-artifact` はPostgreSQL WASMの存在を必須とし、SQLite WASMが再混入した場合は失敗する。

再デプロイは、次を同一immutable commit SHAで満たした場合のみ承認済みCI/CD経路から実行する。

1. 通常CIとCodeQLが成功する。
2. `npm run cf:build`と`npm run release:check-cloudflare-build-artifact`が成功する。
3. `npx wrangler deploy --dry-run --env production`のgzipが3 MB未満である。
4. §1のtarget env、Evidence、migration、rollback等の既存停止条件をすべて満たす。

サイズ超過やSQLite WASM再混入を検知した場合はdeployせず、依存解決とOpenNext成果物を再調査する。上限回避を目的とした課金プラン変更は本手順に含めない。Cloudflareの現行上限とdry-run確認方法は[Workers limits](https://developers.cloudflare.com/workers/platform/limits/#worker-size)を参照する。

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
npm run release:smoke -- --read-only --base-url "https://odip.mirai-dx-platform.com"
```

本番URLが `522` の場合は `npm run release:post-release-status -- --production-url https://odip.mirai-dx-platform.com --max-response-ms 5000` の `Production Route Diagnosis` を先に確認する。Cloudflare edge header付きの `522` は、DNSはCloudflareへ到達しているが、Worker route/deploymentが対象hostを処理していない、またはrouteよりorigin解決が優先されている疑いとして扱う。続いて `npm run release:cloudflare-522-diagnostics` で Cloudflare に接続しない read-only 証跡チェックリストを作成する。承認済みCloudflare認証情報がある担当者のみ `npm run release:cloudflare-522-diagnostics -- --execute-wrangler` で `deployments status/list` を実行し、`wrangler tail codip --env production --status error`、Dashboardのzone route (`odip.mirai-dx-platform.com/*`) とDNS (`proxied AAAA 100::`) を確認し、証跡を §5 へ記録する。DNSやSecretsの変更はこの確認後に限定する。

失敗時の復旧判断は [rollback.md](rollback.md) と [cloudflare-neon-staging.md](cloudflare-neon-staging.md) §5 に従う。DB破壊、認証不全、重大なデータ不整合の疑いがある場合は追加変更より復旧を優先する。

## 5. Evidence

| 項目 | 記録 |
| --- | --- |
| Approval / change ticket | PR #93 (2026-08-04)、本番デプロイ承認済みパイプライン |
| commit SHA | `41400dc`（Worker反映）。収集ランナー修正 `87bc3c1` はCI/workflow側へ反映済み |
| Cloudflare Worker version | `codip-production` Version ID `0eaaaafa-9995-4607-afdb-6e34801f9c9e` (2026-08-05T04:58Z) |
| Custom Domain status | 非使用（zone route方式） |
| DNS status | `odip.mirai-dx-platform.com` proxied AAAA `100::`、A 104.21.57.65 / 172.67.189.96、NXDOMAIN→旧 civilopendata 削除済 |
| Hostname conflict check | 2026-07-20 に既存CNAME/Pages/Access衝突なしを確認 |
| Cloudflare zone status | `mirai-dx-platform.com` active |
| Access application / policy evidence | app `odip` (9af09a69-6338-4e9b-ad31-8434aa0a3f1e)、allow policy `odip` (ec96655a-d8c3-4354-bd08-596a5b7cc740) mirai-const.co.jp + kensan1969@gmail.com、Service Auth policy `odip-service-auth` (eaa7686f-f0b3-452c-a2da-87996d70b57c, non_identity, token 8e38737a-d75e-4c69-bbb3-c7dee5a13230)、未認証302、service token付きprobe 200 (2026-08-05) |
| Hyperdrive binding name / ID evidence | `codip-production` / `1da7b81807374ec190addf146717d275` (caching disabled) |
| Neon project / branch evidence | project `falling-dawn-93620497`、branch `main`、PG17.10 / PostGIS 3.5、staging-20260804・restore-drill-20260804 作成済 |
| Migration result | 2/2適用済み、driftなし（2026-08-01/04確認） |
| `release:validate-env:production-target` result | PASS（実ターゲット値） |
| `release:production-evidence -- --strict` result | PASS（2026-08-04） |
| `release:check-production-placeholders -- --env production` result | PASS |
| Cloudflare logs / alert policy evidence | Observability enabled、専用alert policyはIssue #90追跡 |
| Neon monitoring evidence | PITR window 24h、restore drill 2026-08-04 実施 |
| Backup / restore evidence | Secrets/Variables設定済み、`restore-drill-20260804` (br-wild-shape-aff21r0u) |
| Smoke monitoring schedule | 15分間隔 production-smoke。Access service token設定済み。初回成功 2026-08-05T02:30Z (run 30969524446)、デプロイ後再確認 02:55Z (run 30970704615) |
| `release:smoke --read-only` result | 本番はAccess service token付き `release:post-release-status --strict-production` で `/api/health` 200・`/api/ready` 200 (db=ok) を確認 (2026-08-05)。ローカルpreview 85 checks OK、PR CI green |
| Rollback owner / rollback target | human kensan / `wrangler rollback --env production` で直前version (2026-08-01T15:33:31Z) |
