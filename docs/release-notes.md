# リリースノート

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
| Cloudflare | production FQDNを `civilopendata.mirai-dx-platform.com` に固定し、Workers Custom Domain、Access Terraform例、Cloudflare/Neon Runbook、契約チェックへ反映 |
| Cloudflare | `docs/runbooks/cloudflare-production.md` を追加し、DNS/Access/Secrets/Hyperdrive/production evidenceの停止条件を本番専用Runbookとして分離 |
| Cloudflare | 新規サブドメイン `civilopendata` の初回Custom Domain gateを追加。DNS未解決、hostname衝突、zone active、Access境界、証明書/validation証跡を確認するまでDNS変更・deployを停止する |
| Cloudflare | `wrangler.jsonc` のproduction varsに `CODIP_DISABLE_TOKEN_AUTH=true` を固定し、Cloudflare Access/proxy auth配下で直接token経路を閉じる設定を契約チェック対象に追加 |
| CI証跡 | PR #49 のCloudflare target反映commit `040c7bc` に対して CI #82 / CodeQL #64 が success。verify、e2e、postgresql-compat、docker-preview、docker-image-security が全てsuccess |
| Dependency maintenance | PR #52で `undici` 8.7.0、`@eslint/eslintrc` 3.3.6、`@types/node` 22.20.1、`autoprefixer` 10.5.4、`eslint` 9.39.5、`tailwindcss` 3.4.19、`tsx` 4.23.1、`vitest` 3.2.7、`wrangler` 4.112.0へ更新 |
| CI証跡 | dependency更新後のmain commit `1d66e48` に対して CI `29693346265` / CodeQL `29693346235` が success。verify、e2e、postgresql-compat、docker-preview、docker-image-security、docker-supply-chain が全てsuccess |

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
| `https://civilopendata.mirai-dx-platform.com` | 未実行。`Resolve-DnsName` では未解決。Cloudflare Custom Domain / DNS / Access / Hyperdrive / Secrets / Neon実リソース作成は人間承認待ち |

### 残課題

| 優先度 | 項目 | 方針 |
| --- | --- | --- |
| P1 | Issue #18 の残り: 実Hyperdrive/Neon証跡、外部URL取得の専用egress設計 | Prisma Hyperdrive driver adapter側は `@prisma/adapter-pg` で実装済み。Cloudflare Workersでは接続時DNSピン留め不可のため外部URL取得を安全停止 |
| P1 | Cloudflare/Neon実リソース未確定 | 人間承認後に Worker、Hyperdrive、Access、Secrets、Neon branch を作成し証跡化 |
| P2 | Issue #46 監査記録の原子性 | 主要な台帳・タグ・接続確認・サンプル取得・品質再計算は同一transaction化済み。クライアント起点イベントは記録失敗を503化済み。残りは将来の長時間外部処理増加時にoutbox方式を採用するかの設計判断 |
| P2 | 本番Evidence自動取得 | `production-evidence` はSecret非表示の入力状態と手動貼付欄まで。Cloudflare/Neon APIからの実ログ自動収集は認証・権限確認後に追加 |
| P2 | De-dockerization #35 | CI/branch protection/docsを確認し、Docker依存ゲートを段階的に置換 |
